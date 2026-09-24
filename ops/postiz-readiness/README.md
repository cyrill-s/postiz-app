# Postiz backend readiness (#97 in Juls)

The app is ready only when the frontend responds `200` on `/auth`, the backend
API responds `200` on `/api/monitor/health`, and unauthenticated MCP
responds `401` on `/api/mcp`. A frontend-only `200` previously hid backend `502`.
The probe has a four-second timeout per route and is used by both the image and
Compose. Docker marks a failed app unhealthy; Docker Compose does not restart a
container merely because its healthcheck fails.

The PM2 ecosystem runs backend, orchestrator and frontend as direct Node
processes. It loads an optional `/app/.env` with the same precedence as the old
dotenv CLI; Compose environment values take priority. A backend launcher arms a
240-second deadline before loading the backend module. The backend exits if it
does not listen by then or if bind fails. Startup milestones in its log
distinguish module loading, Nest creation, MCP registration and listen on a
future occurrence. These are recovery and diagnostic measures; the original
14:27 UTC stall did not leave enough evidence to establish its blocking call.

Do not use `pm2 restart backend` while it is online. PM2 7.0.4 produced an
untracked second listener in an isolated test even with a direct Node script.
Use `pnpm restart:backend` in the app container. It stops the backend, verifies
both that its process is gone and port 3000 is closed, then starts it and waits
for all three readiness routes. If a process or listener survives, it refuses
to start another copy and requires inspection.

For the production overlay, build the image on the Postiz host from an exact
reviewed checkout, using the deployed image as `POSTIZ_BASE_IMAGE`:

```sh
docker build -f ops/postiz-readiness/Dockerfile \
  --build-arg POSTIZ_BASE_IMAGE=local/postiz:juls-max-20260922 \
  -t local/postiz:readiness-97 .
```

Before replacing production, run the isolated smoke with no network or app
secrets. Mount this checkout's `ecosystem.config.cjs`, `check-readiness.cjs`,
`restart-backend.cjs` and `smoke-pm2-lifecycle.cjs` into a disposable image at
their matching `/app` paths, and execute the smoke script with Node. It runs
the image's actual Nginx and PM2 with tiny synthetic backend/frontend services,
checks healthy and backend-down states, then repeats controlled restarts and
asserts that no process survives a stop or duplicates the listener.

The full application can be checked against disposable PostgreSQL, Redis,
Temporal and Elasticsearch with `isolated.compose.yaml`. It uses an internal
network, synthetic credentials, an empty schema and no published ports:

```sh
docker compose -p postiz97isolated -f ops/postiz-readiness/isolated.compose.yaml up -d --wait
docker compose -p postiz97isolated -f ops/postiz-readiness/isolated.compose.yaml exec app \
  node /app/ops/postiz-readiness/check-readiness.cjs
docker compose -p postiz97isolated -f ops/postiz-readiness/isolated.compose.yaml down -v
```

On this contour, stop only its backend with `pm2 stop backend`, confirm the
readiness command fails, then run `node /app/ops/postiz-readiness/restart-backend.cjs`
and confirm readiness and exactly one port 3000 listener. The disposable
database and volumes are removed by `down -v`.

The production Compose override's old `/auth` healthcheck must be replaced
with `node /app/ops/postiz-readiness/check-readiness.cjs` in the same release as
the new image. Preserve its other settings, networks, volumes and credentials.
Check the public `/auth`, `/api/monitor/health` and `/api/mcp` status
codes after the app comes up; do not put credentials in probe output.
