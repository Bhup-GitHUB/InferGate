import type { RoutingRule } from "@infergate/routing";
import { PgRuleStore } from "@infergate/db";

export class RuleCache {
  private cache = new Map<string, { rules: RoutingRule[]; at: number }>();
  private memory = new Map<string, RoutingRule[]>();
  private ttlMs: number;
  private pg: PgRuleStore | null;

  constructor(pg: PgRuleStore | null, ttlMs = 30000) {
    this.pg = pg;
    this.ttlMs = ttlMs;
  }

  get backend(): string {
    return this.pg ? "postgres" : "memory";
  }

  async forOrg(orgId: string): Promise<RoutingRule[]> {
    const now = Date.now();
    const hit = this.cache.get(orgId);
    if (hit && now - hit.at < this.ttlMs) {
      return hit.rules;
    }
    let rules: RoutingRule[];
    if (this.pg) {
      const stored = await this.pg.list(orgId);
      rules = stored.map((s) => ({
        id: s.id,
        orgId: s.orgId,
        modelAlias: s.modelAlias,
        strategy: s.strategy as RoutingRule["strategy"],
        weights: s.weights,
        priority: s.priority,
        maxAttempts: Math.min(Math.max(s.maxAttempts, 1), 5),
      }));
    } else {
      rules = this.memory.get(orgId) ?? [];
    }
    this.cache.set(orgId, { rules, at: now });
    return rules;
  }

  async add(orgId: string, rule: RoutingRule): Promise<void> {
    if (this.pg) {
      await this.pg.create({
        orgId,
        modelAlias: rule.modelAlias,
        strategy: rule.strategy,
        weights: rule.weights,
        priority: rule.priority,
        maxAttempts: rule.maxAttempts,
      });
    } else {
      const list = this.memory.get(orgId) ?? [];
      list.push(rule);
      this.memory.set(orgId, list);
    }
    this.cache.delete(orgId);
  }

  async remove(orgId: string, id: string): Promise<boolean> {
    if (this.pg) {
      const ok = await this.pg.remove(orgId, id);
      this.cache.delete(orgId);
      return ok;
    }
    return false;
  }

  invalidate(orgId: string): void {
    this.cache.delete(orgId);
  }
}
