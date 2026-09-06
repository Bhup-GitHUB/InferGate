export interface GatewayConfig {
  port: number;
  pepper: string;
  pepperVersion: number;
  rateLimitPerMinute: number;
  rateLimitFailOpen: boolean;
  streamIdleTimeoutMs: number;
  streamMaxDurationMs: number;
  bodyLimitBytes: number;
  providerAllowlist: string[];
  allowedOrigins: string[];
  defaultStrategy: string;
  breakerThreshold: number;
  breakerCooldownMs: number;
  attemptTimeoutMs: number;
  region: string;
}

export function loadConfig(env: Record<string, string | undefined>): GatewayConfig {
  const pepper = env["API_KEY_PEPPER"];
  if (!pepper || pepper.length < 16) {
    throw new Error("API_KEY_PEPPER must be set to a secret of at least 16 characters");
  }
  return {
    port: Number(env["PORT"] ?? "3000"),
    pepper,
    pepperVersion: Number(env["PEPPER_VERSION"] ?? "1"),
    rateLimitPerMinute: Number(env["RATE_LIMIT_PER_MINUTE"] ?? "120"),
    rateLimitFailOpen: (env["RATE_LIMIT_FAIL_OPEN"] ?? "false") === "true",
    streamIdleTimeoutMs: Number(env["STREAM_IDLE_TIMEOUT_MS"] ?? "60000"),
    streamMaxDurationMs: Number(env["STREAM_MAX_DURATION_MS"] ?? "300000"),
    bodyLimitBytes: Number(env["BODY_LIMIT_BYTES"] ?? String(1024 * 1024)),
    providerAllowlist: (env["PROVIDER_ALLOWLIST"] ?? "api.openai.com,api.anthropic.com,localhost").split(","),
    allowedOrigins: (env["ALLOWED_ORIGINS"] ?? "http://localhost:3001").split(","),
    defaultStrategy: env["DEFAULT_STRATEGY"] ?? "availability",
    breakerThreshold: Number(env["BREAKER_THRESHOLD"] ?? "5"),
    breakerCooldownMs: Number(env["BREAKER_COOLDOWN_MS"] ?? "30000"),
    attemptTimeoutMs: Number(env["ATTEMPT_TIMEOUT_MS"] ?? "30000"),
    region: env["REGION"] ?? "home",
  };
}
