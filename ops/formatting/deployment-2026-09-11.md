# Formatting deployment — 2026-09-11

Production: https://poster.generationl.ru, `/opt/postiz-next` on 185.119.58.121.
Feature commits: `5098512`, `899c5b9`; packaging commit/source archive: `2cbc871`.
Image: `local/postiz:v2.23.0-formatting-899c5b9`.
Manifest list: `sha256:e5c71b331cd99052a9c6ac098cf0000ff9e377a50ed112b2f0a997f5be1e7e1b`.
Release directory: `/opt/postiz-next/releases/formatting-899c5b9`.
App started at 2026-09-11 17:17:55 UTC; backend ready at 17:18:46 UTC.

Backend, orchestrator and frontend production builds passed locally under Node
22.23.2. The Temporal workflow bundle uses SDK 1.15.0, matching production.
Prisma client was generated locally with Prisma 6.5.0 and the
`debian-openssl-3.0.x` binary target. The copy-layer image retains the prior
release's Linux dependencies, MAX CA certificate and runtime configuration.
A network-isolated Linux container loaded the formatting helpers, Telegram,
Threads, MAX and post service modules for both backend and orchestrator, and
verified the new Prisma field. It exited successfully.

Compared production's generated Prisma schema with the release: the only
change is the nullable `Post.telegramDelivery` text column. Created a private
custom-format pg_dump at `database-before.dump` in the release directory
(336989 bytes, permissions 600), then applied the additive migration with a
five-second lock timeout. New Prisma client successfully queried the new column.
The normal application startup schema sync confirmed the schema was in sync.

Updated only the app image in `docker-compose.vk-community.yaml` and recreated
only app using `up -d --no-deps app`. Base compose checksum is unchanged.
All 17 unrelated containers retained their IDs, start times, memory and CPU
limits. App limits remain 3 GiB RAM/swap, 1.25 CPUs, shares 128, OOM score 700,
and pids 1024. No image installation or application compilation ran on the VPS.

Verification:

- Docker healthy, restart count 0, OOMKilled false.
- Frontend, backend and orchestrator running; Telegram/MAX/VK/OK/Threads/YouTube
  worker queues reached RUNNING.
- `/auth`, `/api/integrations`, the existing public preview, and the new static
  chunk containing the formatting toolbar all return HTTP 200.
- Public catalog includes all seven identifiers for the six requested platforms
  (VK has profile and community variants).
- `https://jsia.ru/health` remains HTTP 200.
- No live channel post was sent as part of deployment verification.

Rollback: restore `previous-compose.override.yaml` from this release directory
and run `docker compose -f docker-compose.yaml -f docker-compose.vk-community.yaml up -d --no-deps app`.
The added nullable column can remain for application rollback; preserve the DB
backup and delivery checkpoints. The previous image is
`local/postiz:v2.23.0-vk-ok-max-1`.
