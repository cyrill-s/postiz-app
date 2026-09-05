# VK community channels (manual token)

Production: https://poster.generationl.ru, `/opt/postiz-next` on 185.119.58.121.
Base: upstream Postiz v2.23.0 (`1e4c8dd5c4f70c4d0abd01e23cc42d5b533d1ab9`).

## Connect a community

1. In VK: community management → API → access tokens. Create a community token
   with wall permission. Do not use an application secret, service key or VK ID token.
2. Postiz: Add Channel → VK — сообщество → paste the community token → Connect.
3. Postiz derives the group's ID, name and avatar from the token. Repeat for each
   community. Reconnecting the same group updates its key without creating a duplicate.

No OAuth application, application ID/secret, redirect URI or approval of an OAuth
app is required for this connection method. The earlier OAuth implementation has
been replaced at the user's request. VK_COMMUNITY_ID/SECRET are unused.

Supported in this provider: text and links. VK rejects photo wall-upload methods
with community auth (error 27), even with the photos permission. Photo/video uploads
are therefore blocked at scheduling validation and again at publication. The form
and editor explain this. Delete already published posts in VK itself: wall.delete
also rejected our community token with error 27. Comments are not exposed in the UI.

Live token verification on 2026-09-05 established ownership of faberlicglobal,
community 102697991, with wall/photos/docs/stories permissions. wall.post returned
post ID 148. Automatic readback/deletion could not complete with this token; manual
cleanup was requested from the user. No additional live posts should be published
until that cleanup is confirmed.

## Security and identity

- groups.getTokenPermissions rejects user/service tokens and verifies wall scope.
- groups.getById is called without a caller-supplied group_id. VK identifies the
  token's own community; public metadata is not treated as proof of ownership.
- Integration IDs are `vk-community:<group ID>`, distinct from personal VK channels.
- Integration.token is encrypted with Postiz's existing AuthService encryption;
  decryption occurs only at the VK request boundary.
- The manual form sends credentials in a POST body, not callback URLs or history.
- Connection nonces are consumed atomically with Redis GETDEL for this provider.
- VK errors are sanitized; API request_params and credentials are not logged.
- Community tokens do not have a refresh endpoint. On revocation, enter a new key.

## Build and verify locally

Node 22; pnpm 10.6.1; unchanged dependency lockfile.

```
pnpm install --frozen-lockfile
pnpm exec jest --config jest.vk-community.config.cjs --runInBand
pnpm run build:backend
pnpm run build:orchestrator
node ops/ok-community/bundle-workflows.cjs
NEXT_PUBLIC_BACKEND_URL=https://poster.generationl.ru/api \
FRONTEND_URL=https://poster.generationl.ru \
BACKEND_INTERNAL_URL=http://127.0.0.1:3000 STORAGE_PROVIDER=local \
NEXT_PUBLIC_UPLOAD_DIRECTORY=/uploads NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY=/uploads \
NEXT_PUBLIC_VERSION=v2.23.0-vk-community NODE_OPTIONS=--max-old-space-size=4096 \
pnpm run build:frontend
python3 ops/vk-community/package.py
```

Packaging requires a committed tree. It includes changed backend/orchestrator JS,
frontend production build without cache, changed source, and source archive at
`/source/postiz-vk-community.tar.gz` (requires Postiz sign-in). Linux native
libraries remain in the pinned base image.

## Deploy with resource limits preserved

Transfer `.local-build/release` to a new release directory under
`/opt/postiz-next/releases/`. Assemble image using its Dockerfile: only compiled
artifacts are copied. Never run dependency installation or application compilation
on the shared VPS.

Copy compose.override.yaml to `/opt/postiz-next/docker-compose.vk-community.yaml`.
From `/opt/postiz-next`, run:

```
docker compose -f docker-compose.yaml -f docker-compose.vk-community.yaml up -d --no-deps app
```

The override changes app's image and enables the low-memory Temporal options
documented in ../ok-community/README.md. Existing memory/swap (3 GiB), CPU (1.25), CPU shares 128,
OOM priority 700 and pids limit 1024 are inherited from the untouched base compose.
No schema change or manual DB migration is required. Verify /auth=200,
/api/integrations=200, jsia.ru/health=200 and Docker health; other container IDs and
start times must remain unchanged. /api/health is not implemented in this version.

Rollback to the previous custom image by restoring its image tag in the override
and running the same command. The official base image can be restored with:

```
docker compose -f docker-compose.yaml up -d --no-deps app
```

Returning to an older image does not delete volumes, but community-token channels
require the current provider to decrypt their credentials and publish.

Sources: [VK schema](https://github.com/VKCOM/vk-api-schema),
[community photo upload restriction](https://github.com/VKCOM/vk-api-schema/issues/242).

## Deployment verified 2026-09-05

Deployed `local/postiz:v2.23.0-vk-community-3`, implementation commit `d7e7cea`.
Both local production builds passed; 15 provider tests passed. Backend initially
stalled before Nest initialization; restarting only its PM2 process restored
startup. Docker is healthy and all three documented HTTP checks return 200.
Other container IDs/start times and all application limits are unchanged;
observed app memory 2.418 GiB / 3 GiB. Base compose checksum is unchanged.

Connected Faberlic. Косметика (`vk-community:102697991`) through the deployed
connection endpoints and confirmed it in the signed-in calendar UI. Reconnection
returns the same sole community channel; encrypted storage was verified by
decryption in server memory. Replaying the consumed nonce is rejected. The
local temporary token file was removed. Live test post 148 still requires the
manual cleanup requested above.
