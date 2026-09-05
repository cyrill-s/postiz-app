# Odnoklassniki group channels

Provider `ok-community`, displayed as `Одноклассники — группа`.
One group per channel; existing VK/Telegram channels remain independent.
Initial requested group: https://ok.ru/group/70000035141015.

## Credentials and permissions

This integration uses OK REST API, not the group messaging/Graph API token.
Each connection asks for the numeric group ID, application public key
(`application_key`), creator `access_token`, and application secret from the
registration email. Derive session_secret_key = MD5(access_token + application
secret) on connection, then store only that derived secret with the token/public
key/group ID. The application secret itself is never persisted. Legacy API
clients supplying sessionSecret directly remain accepted.

OK documents creator token generation in application settings (OAuth platform,
“Вечный access_token”). Application ID/public/secret keys are delivered by email.
The games/myuploaded screen directs mini-app creation to VK Mini Apps, but the
user found https://ok.ru/app/setup, and the signed-in UI confirms that an
OAuth application can be created directly there. Use that route for this task.
After explicit user approval, application poster.genL (shortname postergenl)
was created, ID 512004900971. Metadata contains no reference to the underlying
software name. The settings UI generated a creator token for user 910113212567
with VALUABLE_ACCESS, GROUP_CONTENT and PHOTO_CONTENT. Unlike older docs, the
new UI shows only access_token, hence deriving the session secret from the app
secret. Live API permission/ownership verification is still pending credentials.
Do not assume a VK ID login token grants OK publishing access.

Required: VALUABLE_ACCESS and GROUP_CONTENT. Photo posting additionally requires
PHOTO_CONTENT. OK says permissions are requested from api-support@ok.ru with the
application ID and an explanation. Regenerate the token pair after permissions
are granted. Draft for the owner to send (not sent by the agent):

> Здравствуйте! Прошу выдать приложению poster.genL [ID приложения OK] разрешения
> VALUABLE_ACCESS, GROUP_CONTENT и PHOTO_CONTENT для публикации текста, ссылок
> и фотографий в моей группе https://ok.ru/group/70000035141015 через мой сервис планирования публикаций https://poster.generationl.ru. Публикации создаёт и планирует
> администратор группы. Доступ к сообщениям, друзьям и email пользователей не нужен.

## Behavior and security

- Verify current user, publishing permissions and ADMIN/MODERATOR membership
  of the exact requested group before saving metadata.
- Channel ID `ok-community:<group ID>`; reconnecting updates the existing channel.
- Encrypt the credential bundle using the existing Postiz encryption service.
  Bind stored credentials to the group ID and reject cross-group publication.
- The form sends credentials only by POST; Redis consumes the connection nonce
  atomically, as for VK communities. API calls are POST with documented sorted
  MD5 request signatures. session_secret_key is used locally, never transmitted.
- Text/link posts are GROUP_THEME with onBehalfOfGroup=true.
- Up to 10 JPG/PNG photos of 10 MiB each (integration limits). Sequential upload
  bounds memory. HTTPS media URLs only, SSRF-safe DNS dispatcher and no redirects.
  Upload target must belong to OK's domains. Use photosV2.getUploadUrl(gid), then
  photo tokens in mediatopic.post without album commit.
- Unsupported video/polls/comments and empty posts are rejected, not omitted.
- Revoked credentials require reconnecting. No fabricated refresh behavior.
- No automatic retry on uncertain mediatopic.post outcome: API docs specify no
  idempotency key. The error instructs the user to inspect the group feed first.
- API errors are sanitized; tokens and request payloads are not included.

## Validation and deployment

Run `pnpm exec jest --config jest.ok-community.config.cjs --runInBand` and the
existing `jest.vk-community.config.cjs`, then local backend/frontend/orchestrator
builds and `node ops/ok-community/bundle-workflows.cjs`.
The existing `ops/vk-community/package.py` packages both custom providers into
backend and orchestrator artifacts, preserving the pinned Linux base image.
No dependencies or database schema are changed. Build only the copy-layer image
on the VPS. Recreate only app with the existing base compose and override; retain
3 GiB RAM/swap, 1.25 CPUs, CPU shares 128, OOM priority 700, pids limit 1024.
Check Docker health, /auth, /api/integrations, jsia.ru/health and unchanged IDs,
start times and limits of all unrelated containers.

Live connection/publishing requires the user's OK credentials. No public test
post is authorized for OK yet. Do not claim live publication has been verified
from mocked tests or provider catalog visibility.

## Primary sources checked 2026-09-05

- https://apiok.ru/dev/app/create (creator token pair and app setup)
- https://apiok.ru/ext/oauth/permissions (permission requests)
- https://apiok.ru/dev/methods/ (signature protocol)
- https://apiok.ru/dev/methods/rest/users/users.getCurrentUser
- https://apiok.ru/dev/methods/rest/users/users.hasAppPermission
- https://apiok.ru/dev/methods/rest/group/group.getUserGroupsByIds
- https://apiok.ru/dev/methods/rest/group/group.getInfo
- https://apiok.ru/dev/methods/rest/mediatopic/mediatopic.post
- https://apiok.ru/dev/methods/rest/photosV2/photosV2.getUploadUrl
- https://apiok.ru/dev/examples/photo_upload
- https://apiok.ru/dev/graph_api/bot_api (messaging token is separate)

The production override enables TEMPORAL_LOW_MEMORY and points
TEMPORAL_WORKFLOW_BUNDLE at the locally prebuilt workflow bundle. The installed
Temporal SDK must match the bundle SDK (verified 1.15.0 on both machines). This
avoids repeated Webpack compilation for every queue on the VPS. Low-memory mode
caps activities at 4 per queue (or the lower provider cap), workflow task
concurrency at 2, cached workflows at 10, and uses one reused V8 context thread.
All queues remain enabled; aliases share one queue, including the new `ok` root.
No queued jobs are deleted or moved.

In low-memory mode only `main` loads workflow code. All Postiz workflow starts
use `main`; platform queues handle provider activities via proxyActivities.
Keeping those workers activity-only avoids a redundant V8 workflow VM per
provider while retaining every platform queue, including `ok`.

User preference: external application metadata and support correspondence use
poster.genL, with no mention of the underlying software name.
