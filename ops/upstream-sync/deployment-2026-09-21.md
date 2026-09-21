# Upstream main synchronization deployment — 2026-09-21

Production: `https://poster.generationl.ru`, `/opt/postiz-next` on
`185.119.58.121`. Source merge: `44382e58` (upstream `901f84ff`). Image:
`local/postiz:upstream-44382e58`, manifest list
`sha256:6f06e9b5dc0eb43d8c7476ab2b2fa96f0bee56d614a09ad5f4ac6da8f72224cc`.
Release directory: `/opt/postiz-next/releases/upstream-44382e58`. The app
started at `2026-09-21T12:36:53Z`.

This release synchronizes 2,985 upstream commits while retaining the local
VK Community, OK Community, MAX, Telegram formatting, low-memory Temporal and
Juls Workspace changes. Major upstream additions include clipping and its
public API, MCP upload/clipping widgets, dynamic OAuth registration with PKCE,
the ChatGPT MCP endpoint, Apple login, TikTok Business, Runpod media processing,
payment-provider abstractions, publication heartbeat/finalization changes,
dependency/security updates and Meta Graph API v25.0.

Backend, frontend and orchestrator production builds passed locally and inside
the Linux image. The workflow bundle was built inside the image with Temporal
SDK 1.15.0. A network-isolated smoke test loaded the compiled Facebook,
Instagram, OK, MAX and API modules, validated the Prisma schema and verified
the MAX CA and workflow bundle.

Before migration, a private custom-format production database backup was saved
as `database-before.dump` (368928 bytes, mode 600, SHA-256
`4f9ee16649c8fd735a31afde1acae51bac9a8074423671012a24eb4922b4535d`).
The exact generated schema SQL was first applied to a restored disposable copy
of production; the resulting Prisma diff was empty. Production migration then
ran in one transaction with a five-second lock timeout and committed. It adds
the clipping and new Mastra tables plus OAuth PKCE, soft-delete, media-processing
and subscription-provider fields. It drops no table or column. The post-migration
Prisma diff is empty.

Only `postiz-next-app-1` was recreated. Every unrelated container retained its
ID and start time. The app is healthy with zero restarts and no OOM event; its
3 GiB memory, 1.25 CPU, 128 CPU shares and 1024 PID limits are unchanged. All
three PM2 processes are online and 35 Temporal workers, including main, VK, OK,
MAX and Telegram, reached `RUNNING`. Runtime Facebook/Instagram API version is
v25.0. `/auth`, `/api/integrations`, the existing public preview and
`https://jsia.ru/health` return HTTP 200; unsigned Juls provisioning returns
401. No social post was created or retried during verification.

The source archive SHA-256 is
`bc8c0fab81029bf9e7dbe078748363e9b53280be4d1eb4db9c6052b4486bc314`.
The base compose checksum remains
`4a213a386f740b6df47e4d96463827584caea5321d067f3ac64f09427cb1d249`.

Rollback the application by restoring `previous-compose.override.yaml` from
the release directory as `/opt/postiz-next/docker-compose.vk-community.yaml`
and recreating only `app`:

```sh
docker compose -f docker-compose.yaml -f docker-compose.vk-community.yaml up -d --no-deps app
```

The additive schema may remain for an application-only rollback. Preserve the
database backup; restore it only for a separately approved full database
rollback.
