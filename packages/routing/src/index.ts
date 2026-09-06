import { CircuitBreaker } from "./breaker";
import { HealthTracker, type ProviderSnapshot } from "./health";
import { DEFAULT_RULE, type RoutingRule, type RoutingStrategy, type ScoredCandidate } from "./types";

export * from "./types";
export { CircuitBreaker } from "./breaker";
export { HealthTracker } from "./health";

export function pickRule(rules: RoutingRule[], fallback: RoutingStrategy, orgId: string, ...aliases: string[]): RoutingRule {
  for (const alias of aliases) {
    const org = rules.find((r) => r.orgId === orgId && r.modelAlias === alias);
    if (org) {
      return org;
    }
  }
  for (const alias of aliases) {
    const global = rules.find((r) => r.orgId === null && r.modelAlias === alias);
    if (global) {
      return global;
    }
  }
  return { ...DEFAULT_RULE, modelAlias: aliases[aliases.length - 1] ?? "auto", strategy: fallback };
}

export interface EngineOptions {
  failureThreshold: number;
  cooldownMs: number;
  backoffBaseMs: number;
}

interface ProviderMeta {
  costPer1k: number;
  aliases: string[];
}

export class RoutingEngine {
  private breakers = new Map<string, CircuitBreaker>();
  private health = new HealthTracker();
  private rules: RoutingRule[] = [];
  private meta = new Map<string, ProviderMeta>();
  private backoffBaseMs: number;

  private threshold: number;
  private cooldown: number;
  private fallback: RoutingStrategy = "availability";

  constructor(options: EngineOptions) {
    this.backoffBaseMs = options.backoffBaseMs;
    this.threshold = options.failureThreshold;
    this.cooldown = options.cooldownMs;
  }

  setDefaultStrategy(strategy: RoutingStrategy): void {
    this.fallback = strategy;
  }

  getDefaultStrategy(): RoutingStrategy {
    return this.fallback;
  }

  private breaker(id: string): CircuitBreaker {
    let b = this.breakers.get(id);
    if (!b) {
      b = new CircuitBreaker({ failureThreshold: this.threshold, cooldownMs: this.cooldown });
      this.breakers.set(id, b);
    }
    return b;
  }

  registerProvider(id: string, meta: ProviderMeta): void {
    this.meta.set(id, meta);
  }

  setRules(rules: RoutingRule[]): void {
    this.rules = rules;
  }

  ruleFor(orgId: string, ...aliases: string[]): RoutingRule {
    return pickRule(this.rules, this.fallback, orgId, ...aliases);
  }

  candidatesFor(alias: string): string[] {
    const out: string[] = [];
    for (const [id, meta] of this.meta) {
      if (meta.aliases.includes(alias) || alias === "auto") {
        out.push(id);
      }
    }
    return out;
  }

  orderCandidates(ids: string[], strategy: RoutingStrategy, rule: RoutingRule): ScoredCandidate[] {
    const snaps = ids.map((id) =>
      this.health.snapshot(id, this.breaker(id).isOpen, this.breaker(id).snapshot, this.meta.get(id)?.costPer1k ?? 1),
    );
    const pool = snaps.filter((s) => !s.circuitOpen);
    switch (strategy) {
      case "cost":
        return [...pool].sort((a, b) => a.costPer1k - b.costPer1k).map((s) => ({ providerId: s.id, score: s.costPer1k }));
      case "latency":
        return [...pool]
          .sort((a, b) => (a.samples === 0 ? 1 : 0) - (b.samples === 0 ? 1 : 0) || a.ewmaLatencyMs - b.ewmaLatencyMs)
          .map((s) => ({ providerId: s.id, score: s.ewmaLatencyMs }));
      case "weighted":
        return [...pool]
          .sort((a, b) => (rule.weights[b.id] ?? 1) - (rule.weights[a.id] ?? 1))
          .map((s) => ({ providerId: s.id, score: rule.weights[s.id] ?? 1 }));
      case "priority": {
        const rank = (id: string): number => {
          const i = rule.priority.indexOf(id);
          return i === -1 ? Number.MAX_SAFE_INTEGER : i;
        };
        return [...pool].sort((a, b) => rank(a.id) - rank(b.id)).map((s) => ({ providerId: s.id, score: rank(s.id) }));
      }
      case "availability":
      default: {
        const rankState = (s: ProviderSnapshot): number => (s.circuitState === "half-open" ? 1 : 0);
        return [...pool]
          .sort((a, b) => rankState(a) - rankState(b) || a.errorRate - b.errorRate || a.ewmaLatencyMs - b.ewmaLatencyMs)
          .map((s) => ({ providerId: s.id, score: s.errorRate }));
      }
    }
  }

  backoffFor(attempt: number): number {
    return Math.min(this.backoffBaseMs * 2 ** attempt, 1000);
  }

  reportSuccess(id: string, latencyMs: number): void {
    this.health.recordSuccess(id, latencyMs);
    this.breaker(id).recordSuccess();
  }

  ingestLatency(id: string, latencyMs: number): void {
    this.health.seedLatency(id, latencyMs);
  }

  reportFailure(id: string): void {
    this.health.recordFailure(id);
    this.breaker(id).recordFailure();
  }

  snapshot(id: string): ProviderSnapshot {
    return this.health.snapshot(id, this.breaker(id).isOpen, this.breaker(id).snapshot, this.meta.get(id)?.costPer1k ?? 1);
  }

  circuitState(id: string): string {
    return this.breaker(id).snapshot;
  }

  forceOpen(id: string): void {
    const b = this.breaker(id);
    if (b.snapshot !== "open") {
      for (let i = 0; i < this.threshold; i += 1) {
        b.recordFailure();
      }
    }
  }
}
