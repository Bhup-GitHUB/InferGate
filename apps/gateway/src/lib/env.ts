export interface AuthContext {
  keyId: string;
  orgId: string;
  scopes: string[];
  tier: string;
}

export interface QuotaBudget {
  remainingTokens: number;
  remainingSpend: number;
}

export type AppEnv = {
  Variables: {
    auth: AuthContext;
    requestId: string;
    quota: QuotaBudget;
  };
};
