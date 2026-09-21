#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
container="postiz-juls-contract-$$"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
# No persistent volume, no production env files and only a loopback port.
docker run --detach --rm --name "$container" \
  -e POSTGRES_PASSWORD=test-only -e POSTGRES_DB=juls_contract \
  -p 127.0.0.1::5432 postgres:16-alpine >/dev/null
for attempt in {1..30}; do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
port="$(docker port "$container" 5432 | sed 's/.*://')"
export JULS_TEST_DATABASE_URL="postgresql://postgres:test-only@127.0.0.1:${port}/juls_contract"
DATABASE_URL="$JULS_TEST_DATABASE_URL" node_modules/.bin/prisma db push \
  --schema libraries/nestjs-libraries/src/database/prisma/schema.prisma --skip-generate
node_modules/.bin/jest --config jest.juls.config.cjs --runInBand
