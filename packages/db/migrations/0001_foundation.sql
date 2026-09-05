CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE org_members (
  org_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'member',
  PRIMARY KEY (org_id, user_id)
);

CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  prefix TEXT NOT NULL UNIQUE,
  salt TEXT NOT NULL,
  hashed_secret TEXT NOT NULL,
  pepper_version INTEGER NOT NULL DEFAULT 1,
  scopes TEXT[] NOT NULL DEFAULT ARRAY['chat:write', 'models:read'],
  expires_at TIMESTAMPTZ,
  rotated_from_id UUID,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_api_keys_org ON api_keys(org_id);

CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  base_url TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'mock',
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE models (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  alias TEXT NOT NULL UNIQUE,
  input_price_1k NUMERIC NOT NULL DEFAULT '0',
  output_price_1k NUMERIC NOT NULL DEFAULT '0',
  context_window INTEGER NOT NULL DEFAULT 128000,
  enabled BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE routing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id),
  model_alias TEXT NOT NULL,
  strategy TEXT NOT NULL DEFAULT 'availability',
  config JSONB NOT NULL DEFAULT '{}',
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_routing_rules_alias ON routing_rules(model_alias);

CREATE TABLE requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT,
  org_id UUID NOT NULL REFERENCES organizations(id),
  key_id UUID REFERENCES api_keys(id),
  provider_id TEXT,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC NOT NULL DEFAULT '0',
  status TEXT NOT NULL DEFAULT 'ok',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_requests_org_created ON requests(org_id, created_at);
CREATE UNIQUE INDEX idx_requests_org_idempotency ON requests(org_id, idempotency_key);
CREATE INDEX idx_requests_created_brin ON requests USING BRIN(created_at);

CREATE TABLE usage_daily (
  org_id UUID NOT NULL REFERENCES organizations(id),
  date TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  cost_usd NUMERIC NOT NULL DEFAULT '0',
  requests BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, date, model)
);

CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  amount_usd NUMERIC NOT NULL DEFAULT '0',
  status TEXT NOT NULL DEFAULT 'draft'
);

INSERT INTO providers (id, base_url, kind, enabled) VALUES
  ('openai', 'https://api.openai.com', 'mock', true),
  ('anthropic', 'https://api.anthropic.com', 'mock', true),
  ('local-vllm', 'http://localhost:8000', 'mock', true);

INSERT INTO models (id, provider_id, alias, input_price_1k, output_price_1k, context_window, enabled) VALUES
  ('gpt-4o-mini', 'openai', 'gpt-4o-mini', '0.0005', '0.0015', 128000, true),
  ('gpt-4o', 'openai', 'gpt-4o', '0.005', '0.015', 128000, true),
  ('claude-3-5-sonnet', 'anthropic', 'claude-3-5-sonnet', '0.003', '0.015', 200000, true),
  ('claude-3-haiku', 'anthropic', 'claude-3-haiku', '0.0008', '0.0024', 200000, true),
  ('llama-3-8b', 'local-vllm', 'llama-3-8b', '0.0001', '0.0002', 8192, true),
  ('mistral-7b', 'local-vllm', 'mistral-7b', '0.0001', '0.0002', 32768, true);
