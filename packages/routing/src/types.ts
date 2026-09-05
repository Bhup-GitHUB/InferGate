export type RoutingStrategy = "cost" | "latency" | "availability" | "weighted" | "priority";

export interface RoutingRule {
  orgId: string | null;
  modelAlias: string;
  strategy: RoutingStrategy;
  weights: Record<string, number>;
  priority: string[];
  maxAttempts: number;
}

export interface ProviderSnapshot {
  id: string;
  ewmaLatencyMs: number;
  errorRate: number;
  consecutiveFailures: number;
  circuitOpen: boolean;
  circuitState: string;
  samples: number;
  costPer1k: number;
}

export interface ScoredCandidate {
  providerId: string;
  score: number;
}

export const DEFAULT_RULE: RoutingRule = {
  orgId: null,
  modelAlias: "auto",
  strategy: "availability",
  weights: {},
  priority: [],
  maxAttempts: 3,
};
