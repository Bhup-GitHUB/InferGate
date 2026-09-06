#!/usr/bin/env bash
set -euo pipefail

export API_KEY_PEPPER="${API_KEY_PEPPER:-demo-pepper-please-rotate-000000}"
export RATE_LIMIT_PER_MINUTE="${RATE_LIMIT_PER_MINUTE:-100000}"
export PORT="${PORT:-3000}"
export PRINT_SEED_KEY=1

if [ -n "${DATABASE_URL:-}" ]; then
  bun run packages/db/src/migrate.ts
fi

echo "console: bun run --cwd apps/web dev  # then open http://localhost:3001"
echo "smoke:   GATEWAY_URL=http://localhost:$PORT GATEWAY_KEY=\$SEED bun run tests/compat/openai-sdk.ts"
bun run apps/gateway/src/index.ts
