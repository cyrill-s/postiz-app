# Juls shared MAX bot deployment — 2026-09-22

Production: `https://poster.generationl.ru`, `/opt/postiz-next` on
`185.119.58.121`. Image: `local/postiz:juls-max-20260922`, manifest
`sha256:439a813b1d20522c0cbbf9f0cb6ebb50c58021f629b5122be39d5c8da11700d9`.
Release directory: `/opt/postiz-next/releases/juls-max-20260922`.

The release is a narrow overlay on `local/postiz:threads-oauth-20260922`. It
replaces the compiled Juls controller, DTO and Workspace service in backend and
the MAX provider in backend and orchestrator. There is no schema migration and
no frontend change.

Juls now has an HMAC-authenticated `POST /internal/juls/max-channel/connect`
contract. Juls supplies the MAX identity established by its single-use bot code;
Postiz verifies that identity is an owner or administrator of the requested
active channel and that the dedicated bot can publish. The integration stores an
encrypted `{ chatId, tokenSource: "juls" }` marker. The shared bot token is read
from `JULS_MAX_BOT_TOKEN` only at verification and publication time.

Local verification passed 44 MAX tests, 33 isolated PostgreSQL Juls contract
tests, backend/orchestrator production compilation, and a Linux runtime smoke
test that checked the route, marker and server-token resolution. Production is
healthy with zero process/container restarts after startup; `/auth`,
`/api/integrations` and the Juls health endpoint return 200, the unsigned new
route returns 401, and all non-app container IDs are unchanged. The first 502
checks occurred during the existing slow backend startup and recovered without
intervention once Nest finished mapping routes.

`JULS_MAX_BOT_TOKEN` is intentionally not recorded here. It was installed from
the user's clipboard into the production `.env` (mode 600), mapped explicitly by
the compose override and activated by recreating only the app container. A live
server-side `GET /me` returned 200 and identified `id691000165914_bot`; the token
value was not printed, committed or copied into logs. The app is healthy with
zero restarts, every PM2 process is online, the unsigned channel-connect route
returns 401, and the public Postiz/Juls checks return 200.

Rollback: restore `previous-compose.override.yaml` from the release directory to
`/opt/postiz-next/docker-compose.vk-community.yaml`, then run:

```sh
docker compose -f docker-compose.yaml -f docker-compose.vk-community.yaml up -d --no-deps app
```

No database rollback is required. Existing manually configured MAX channels use
their encrypted per-channel credentials and remain compatible in both directions.
