# Juls Workspace access deployment — 2026-09-21

Production: `https://poster.generationl.ru`, `/opt/postiz-next` on
`185.119.58.121`. Source commit: `4a95ff7`. Image:
`local/postiz:v2.23.0-juls-4a95ff7`, manifest
`sha256:79351fc1b6f7eb9972c3ef07af8dbde3b9f473efa25ddd3c3f81871368f55909`.
Release directory: `/opt/postiz-next/releases/juls-workspace-4a95ff7`.
The app started at `2026-09-21T08:24:57Z`.

The backend, orchestrator and frontend production builds passed locally. A
disposable PostgreSQL 16 instance passed 32 contract tests covering HMAC replay,
concurrent provisioning and code redemption, Workspace isolation, handoff scope,
terminal revocation and credential-route telemetry. The production image contains
the Prisma 6.5.0 `debian-openssl-3.0.x` engine and loaded the `JULS` provider,
controller and lifecycle module in a network-isolated container.

Before migration, a private custom-format database backup was saved as
`database-before.dump` (348383 bytes, mode 600, SHA-256
`e2c69929fabb12e5fa89ba46e07d2ba4475fdeb2a5a2e284c1876789ad119b44`).
The prior compose override and environment file are retained in the release
directory. The additive migration `20260921120000_juls_workspace_access` ran in
one transaction with a five-second lock timeout. The new Linux Prisma client
successfully queried both lifecycle tables before application cutover.

Only `postiz-next-app-1` was recreated. Every other container retained its ID.
The app is healthy with zero restarts and no OOM event; backend, frontend and
orchestrator are online, and all Temporal queues reached `RUNNING`. Existing
Postiz, Juls and shortlink health checks return HTTP 200. An unsigned provisioning
request returns 401.

Production acceptance ran from the Juls host through the public endpoints:

- signed Workspace provisioning created an isolated organization;
- the bootstrap code exchanged for an organization-scoped `pos_` token;
- MCP initialized and listed 11 tools including `integrationList`;
- access revocation made the same token return 401;
- the pre-existing encrypted Juls connection still initialized MCP successfully
  for organization `23a366f1-fb09-4076-981d-b17d4679eccf`.

The smoke Workspace was revoked, leaving one intentional terminal tombstone and
no active managed Workspace. No social post or provider authorization was sent.
The shared HMAC configuration is installed with mode 600 on both hosts; secret
values were not logged. Juls implementation remains tracked in
`cyrill-s/juls-ai#40`.

Rollback the application by restoring `previous-compose.override.yaml` to
`/opt/postiz-next/docker-compose.vk-community.yaml` and running:

```sh
docker compose -f docker-compose.yaml -f docker-compose.vk-community.yaml up -d --no-deps app
```

The additive tables and enum value may remain during application rollback. Keep
the terminal tombstone and backup. Restore the database dump only for a separately
approved full database rollback.
