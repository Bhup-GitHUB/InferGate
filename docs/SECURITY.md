# Security (Phase 1 baseline)

- API secrets stored as SHA-256 hashes; prefix indexed, secret never logged.
- Constant-time comparison; rotation with grace; revocation immediate (Redis cache invalidate).
- Org scoping enforced per query (`org_id` from verified key, never from body).
- Zod validation on all inputs; body limit 1MB; no dynamic SQL (Drizzle parameterized).
- SSRF: provider `base_url` allowlist (env `PROVIDER_ALLOWLIST`), no user-controlled fetch URLs.
- Rate limit per org+model; fail-closed option via `RATE_LIMIT_FAIL_OPEN=false`.
- Secrets via env/K8s Secrets only; never in repo. Structured logs redact `authorization`.
- See SECURITY_AUDIT.md (Phase 8) for full audit.
