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

interface Tracker {
  ewma: number;
  errorRate: number;
  failures: number;
  samples: number;
}

const ALPHA = 0.3;

export class HealthTracker {
  private data = new Map<string, Tracker>();

  private get(id: string): Tracker {
    let t = this.data.get(id);
    if (!t) {
      t = { ewma: 200, errorRate: 0, failures: 0, samples: 0 };
      this.data.set(id, t);
    }
    return t;
  }

  recordSuccess(id: string, latencyMs: number): void {
    const t = this.get(id);
    t.ewma = t.samples === 0 ? latencyMs : ALPHA * latencyMs + (1 - ALPHA) * t.ewma;
    t.errorRate = ALPHA * 0 + (1 - ALPHA) * t.errorRate;
    t.failures = 0;
    t.samples += 1;
  }

  recordFailure(id: string): void {
    const t = this.get(id);
    t.errorRate = ALPHA * 1 + (1 - ALPHA) * t.errorRate;
    t.failures += 1;
    t.samples += 1;
  }

  snapshot(id: string, circuitOpen: boolean, circuitState: string, costPer1k: number): ProviderSnapshot {
    const t = this.get(id);
    return {
      id,
      ewmaLatencyMs: Math.round(t.ewma),
      errorRate: Number(t.errorRate.toFixed(3)),
      consecutiveFailures: t.failures,
      circuitOpen,
      circuitState,
      samples: t.samples,
      costPer1k,
    };
  }
}
