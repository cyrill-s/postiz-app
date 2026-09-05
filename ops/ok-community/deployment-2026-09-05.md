# Deployment 2026-09-05

Final source: 8931b8c on codex/ok-community.
Image: local/postiz:v2.23.0-vk-ok-5.
Manifest: sha256:60c4b40efd1a3dc541c7f1eae16d15d9698242746b38bb94f02f08556fe90c85.
Release: /opt/postiz-next/releases/vk-ok-5.

Local backend, frontend and orchestrator production builds passed. 22 OK/queue
tests and 15 VK regression tests passed. Linux provider imports passed under
512 MiB / 0.5 CPU. Prebuilt workflow bundle and production SDK versions match
(1.15.0). No dependencies or schema changed.

Initial vk-ok-1/vk-ok-2 startup reached the 3 GiB cgroup limit while starting
redundant workflow workers for every platform. PM2's pnpm wrapper can leave
orphaned child processes after restart/OOM, worsening memory pressure. The failed
rollout was rolled back temporarily; orphan orchestrator processes were stopped
before the final recreation. Do not use those intermediate images for rollback.

Final low-memory mode has workflow execution only on main; every provider queue
still runs activities. This matches all workflow starts/proxyActivities in the
source. The final image started normally, without a manual PM2 restart or runtime
Webpack compilation. Backend and worker /health/status both return 200. Queue
'ok' explicitly reached RUNNING. Observed app memory 1.304 GiB / 3 GiB; cgroup
memory.events showed max=0, oom=0, oom_kill=0 after startup.

Frontend version v2.23.0-vk-ok. Catalog includes vk, vk-community and ok-community.
Browser verified Add Channel → Одноклассники — группа, four manual fields, both
secrets rendered as password inputs. Group 70000035141015 connected successfully
as Книжная лавка Дядюшки ОМа and is visible beside the existing Telegram and VK
channels. Authentication verified current user, required API permissions and
administrator/moderator membership before persisting the channel.

All 17 unrelated container IDs, start times and resource limits remain unchanged.
App limits remain RAM/swap 3 GiB, CPU 1.25, shares 128, OOM score 700, pids 1024.
/auth, /api/integrations and jsia.ru/health return 200. Base compose is unchanged:
49618b31057cffa01f4f918601dcccec74a324e24cd87266ae805cb73678d24e.
Only image and two Temporal options are set in the existing app override.

Live OK authentication is verified; no OK post was created or published.
The direct https://ok.ru/app/setup form created OAuth app poster.genL,
ID 512004900971, shortname postergenl, with required
VALUABLE_ACCESS/GROUP_CONTENT/PHOTO_CONTENT. External metadata does not mention
the underlying software, as requested. Public and secret app keys arrived by
email. The creator UI supplies an access token, not a session secret.

The connection accepts an opaque application secret (not necessarily hex).
It derives MD5(access_token + application_secret) and stores only the derived
session secret in the encrypted credential bundle. Application secret is not
persisted. A regression test covers a non-hex application secret. Clipboard
insertion and browser inspection were performed without printing the secret.
No support email was sent. Suppress/redact credential-bearing setup iframe URLs
and filled password fields during later browser inspection.

Rollback: restore image local/postiz:v2.23.0-vk-community-3 in the override and
remove the two TEMPORAL options, then recreate only app using both existing
compose files and --no-deps. The old image has no OK provider and uses more memory.

## Follow-up: missing channel avatar

Source 4944773, image local/postiz:v2.23.0-vk-ok-6, release
/opt/postiz-next/releases/vk-ok-6, manifest list
sha256:5e67e371e87843eaea112345a18ed47290eafbc94f22f596e21a6e9345b85f96.

Live authenticate reproduced an empty picture with otherwise successful
authentication. OK accepts request field pic_avatar but returns picAvatar.
The provider now maps that response correctly. The regression test failed before
the fix and all 23 OK/queue tests pass afterward; backend production build passed.
Live authenticate now returns a picture. The existing group's avatar was imported
using LocalStorage.uploadSimple and only its Integration.picture was updated.
The local image endpoint returns HTTP 200 (1676 bytes).

The user's reported missing publication is not yet reproduced. Read-only Prisma
queries found zero Post records for this OK integration (including deleted
records), and only two older Telegram records across the database. Asked which
text/action failed, or permission for one explicit test post and cleanup.
No OK publication or deletion has been performed in this follow-up.

## Follow-up: Publish now falsely reported success

User clarified that Publish now closes the composer with success, but neither the
calendar nor OK contains the post. Production ValidationPipe with CreatePostDto
reproduced HTTP 400 for settings.__type=ok-community. Community providers were
missing from all.providers.settings.ts. The frontend ignored the failed POST
response and unconditionally announced success.

Source 9f02353, image local/postiz:v2.23.0-vk-ok-7, release
/opt/postiz-next/releases/vk-ok-7, manifest list
sha256:a5ee15ace69de67630a4936364ef8834410d57083149eb2db9f1eb3e83abe447.
Both community identifiers are now registered. Failed saves preserve the composer
and show the error; network failures ask users to check the calendar before retry.
Packaging includes compiled settings registration for backend and orchestrator.

27 OK/queue/create-validation tests pass. The new validation tests first failed
for OK now/schedule and VK community now, then passed after the fix. Unknown
provider rejection remains covered. Backend and frontend production builds pass.
The same production ValidationPipe repro now passes for both community providers.
A temporary OK draft was saved through the browser and verified in Prisma and
the calendar, then deleted through the UI. No public OK test post was sent; live
delivery through the provider is still unverified. The reported pre-persistence
failure is fixed, but this is not evidence of successful remote publication.

## 2026-09-06: public preview HTTP 500

Exact /p/cmtovkiwi0002qz84k6p8xgk6?share=true reproduced HTTP 500.
Frontend logged MIMEType is not a constructor during bundled DOMPurify/jsdom
module evaluation. Public posts API returned the post correctly; native
isomorphic-dompurify in the pinned runtime loaded and sanitized correctly.
Next config now externalizes isomorphic-dompurify.

Intermediate vk-ok-8 exposed a packaging issue: recursive cache exclusion removed
undici/lib/cache from the copied local external dependency. Packaging now points
Turbopack's hashed DOMPurify external link to /app/node_modules/isomorphic-dompurify
in the pinned Linux base, preserving its complete, matching runtime dependencies.
Do not use vk-ok-8 as rollback.

Final source 5b8ed85, image local/postiz:v2.23.0-vk-ok-9, release
/opt/postiz-next/releases/vk-ok-9, manifest list
sha256:c01b4bf9c6603a416aaf4cd8ff6246bf4cb62b8f5e0d6b282a2c56a856548ad2.
Production frontend build passed. The exact hashed external module was exercised
in the built Linux image under 512 MiB/0.5 CPU: it loads and strips script tags.
After rollout the original preview URL returns HTTP 200; rendered HTML contains
the group's name and all 654 characters of post text (after whitespace/markup
normalization). Container healthy, memory about 1.2 GiB/3 GiB, cgroup OOM events zero.
HTML sanitization remains enabled. No public posts were modified or sent.
