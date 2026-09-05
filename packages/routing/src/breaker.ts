export interface BreakerOptions {
  failureThreshold: number;
  cooldownMs: number;
}

export type BreakerState = "closed" | "open" | "half-open";

export class CircuitBreaker {
  private state: BreakerState = "closed";
  private failures = 0;
  private openedAt = 0;
  private threshold: number;
  private cooldownMs: number;

  constructor(options: BreakerOptions) {
    this.threshold = options.failureThreshold;
    this.cooldownMs = options.cooldownMs;
  }

  private refresh(): void {
    if (this.state === "open" && Date.now() - this.openedAt >= this.cooldownMs) {
      this.state = "half-open";
    }
  }

  get isOpen(): boolean {
    this.refresh();
    return this.state === "open";
  }

  get snapshot(): BreakerState {
    this.refresh();
    return this.state;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = "closed";
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.state === "half-open" || this.failures >= this.threshold) {
      this.state = "open";
      this.openedAt = Date.now();
    }
  }
}
