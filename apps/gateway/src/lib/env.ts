export interface AuthContext {
  keyId: string;
  orgId: string;
  scopes: string[];
}

export type AppEnv = {
  Variables: {
    auth: AuthContext;
    requestId: string;
  };
};
