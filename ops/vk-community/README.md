# VK community provider

Base: upstream Postiz v2.23.0, commit 1e4c8dd5c4f70c4d0abd01e23cc42d5b533d1ab9.
Production: https://poster.generationl.ru, /opt/postiz-next on 185.119.58.121.

## Authentication prerequisite

The existing VK ID application issues tokens that return VK error 1051 for
groups.get and account.getAppPermissions. Its client ID also returns HTTP 401
from oauth.vk.com/authorize. It cannot power community publishing.

Configure a VK API OAuth application with user publishing permissions in the
server's private `/opt/postiz-next/.env`:

```
VK_COMMUNITY_ID=<VK API application ID>
VK_COMMUNITY_SECRET=<VK API application secret>
```

The application must allow `https://poster.generationl.ru/integrations/social/vk`
as its redirect URI. The new provider requests wall, groups, photos and video
through oauth.vk.com authorization-code flow. VK must actually grant
these permissions to the application: creating a VK ID login app is insufficient.
Do not use credentials from unofficial third-party applications.

Until configured, Add Channel → VK — сообщество displays an actionable setup
message. Once configured: sign into VK, select one administered/edited community,
save; repeat for another channel. The server rechecks admin_level >= 2.
The existing personal VK channel remains separate.

Tokens from legacy OAuth have no refresh endpoint; expired/revoked access prompts
reconnection. OAuth reconnection preserves the original channel identity.
The generic callback correction preserves the actual OAuth token lifetime and
refresh token instead of overwriting them with a query-string value.

## Build and checks

Use Node 22 and pnpm 10.6.1. No dependencies were changed.

```
pnpm install --frozen-lockfile
pnpm exec jest --config jest.vk-community.config.cjs --runInBand
pnpm run build:backend
NEXT_PUBLIC_BACKEND_URL=https://poster.generationl.ru/api \
FRONTEND_URL=https://poster.generationl.ru \
BACKEND_INTERNAL_URL=http://127.0.0.1:3000 STORAGE_PROVIDER=local \
NEXT_PUBLIC_UPLOAD_DIRECTORY=/uploads NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY=/uploads \
NEXT_PUBLIC_VERSION=v2.23.0-vk-community NODE_OPTIONS=--max-old-space-size=4096 \
pnpm run build:frontend
python3 ops/vk-community/package.py
```

The packaging script copies only changed compiled JS into both backend and
orchestrator, the frontend build, source changes, and icon. Existing Linux native
dependencies stay in the pinned base image. Next's build cache is excluded.
`package.py` requires a committed working tree and includes the matching source
archive at `/source/postiz-vk-community.tar.gz`.

## Deployment and rollback

Transfer `.local-build/release` to a new release directory on the server; assemble
the overlay image using the Dockerfile there. This only copies already compiled
artifacts. Never run pnpm install, tsc or Next build on this shared VPS.

Copy compose.override.yaml to /opt/postiz-next/docker-compose.vk-community.yaml.
Start only app, with both compose files, from /opt/postiz-next:

```
docker compose -f docker-compose.yaml -f docker-compose.vk-community.yaml up -d --no-deps app
```

The override changes only app image and the two VK environment variables. All
memory, CPU, swap, pids, OOM priority and log limits come from the existing base
compose file. Postiz app remains 3 GiB / 1.25 CPUs. No DB migrations are needed.
All other Postiz services and AI-bot containers must retain their container IDs
and start times. Verify /auth, /api/integrations, jsia.ru/health and app Docker health.
This version does not expose /api/health (it returns 404).

Rollback (same directory):

```
docker compose -f docker-compose.yaml up -d --no-deps app
```

This returns to the pinned official image without deleting volumes or changing
other containers. New community channels require the custom image to publish.

## Validation limits

Unit tests cover OAuth configuration/scopes, distinct community IDs, server-side
permission validation, text/photo/video/comment routing, API errors and revocation.
The requested live test target is https://vk.ru/faberlicglobal (102697991).
No live test publication has been performed: a suitable VK API app is required.

Sources: [VK OAuth SDK](https://github.com/VKCOM/vk-php-sdk/blob/master/README.md#4-authorization),
[VK API schema](https://github.com/VKCOM/vk-api-schema),
[upstream VK ID issue](https://github.com/gitroomhq/postiz-app/issues/1408).
