# Production and Git reconciliation — 2026-09-22

Reconciled the recent Postiz sessions against local history and read-only
production checks on `185.119.58.121`, `/opt/postiz-next`.
The canonical integration branch is `dev` in `cyrill-s/postiz-app` (`fork`);
`origin` is the upstream `gitroomhq/postiz-app` repository.

## Included work

| Change | Git reference | Production evidence |
| --- | --- | --- |
| Upstream sync, Graph API v25.0, additive migration | `44382e58`, `67bc207e` | See `upstream-sync/deployment-2026-09-21.md`; compiled Facebook provider still contains v25.0 |
| Facebook streaming media hotfix | `af1ca73e`, `52b33c08` | Retained in the current image; see `facebook-media/deployment-2026-09-21.md` |
| Namespaced VK Cloud S3 storage | `d7588458` | Runtime provider `cloudflare`, prefix `postiz/`; compiled endpoint and key-prefix support present |
| Shared Juls MAX bot | `17fcc321` | Current image `local/postiz:juls-max-20260922`; bot environment variable configured |
| Threads OAuth URL and authorization-code parameter | `f97e3da8` | Compiled provider uses `www.threads.com/oauth/authorize` and `response_type=code` |
| Facebook Compose environment mapping | `dec8ee97` | Previously uncommitted local configuration, now tracked; no credentials included |
| VK review page and registration operation | `9c6483f4` | Caddy serves `/about/`; page hash matches local file; registration API returns `{"register":true}` |

The Threads session committed and pushed `f97e3da8` while reconciliation was
running. After that session became idle, `dev` was fast-forwarded to include it.
The existing MAX and Threads topic branches remain intact. The 2,994-commit gap
to `fork/dev` before this reconciliation mostly represented the already deployed
upstream merge, not thousands of new local edits.

The rejected Facebook experiment `4f1612b0` is not an ancestor of `dev` and was
not restored. Returning the retained `af1ca73e` streaming implementation to URL
uploads was discussed in a session but was not implemented or deployed.

## Configuration outside Git

Instagram credentials were installed in the September 21 session, with backup
`/opt/postiz-next/backups/instagram-oauth-20260921T141746Z`.
Threads credentials and its OAuth patch were deployed through release directories
`threads-20260921` and `threads-oauth-20260922`.
The current MAX image layers on the Threads OAuth image, which layers on S3.

Read-only checks confirmed nonempty Facebook, Instagram and Threads app IDs and
secrets, and `JULS_MAX_BOT_TOKEN`, without printing their values. Secrets, database
backups, compiled overlays and private release files remain on the server.
The production image is a sequence of compiled overlays; this reconciliation
does not claim a fresh full-image build from the resulting Git revision.

## Verification

- App container healthy with zero restarts; no deploy or restart performed here.
- Threads regression test passed; MAX suites passed all 44 tests.
- Facebook and S3 object-key suites passed. The Jest glob also discovered the
  existing archived Facebook suite under `.local-build`, which passed as well.
- VK deployment script parsed successfully; `git diff --check` passed.
- Local and deployed VK page SHA-256:
  `beed189c8537508f5ecb8d6f4550ad88566af421e9f464b3945d30654a0a9c44`.
- Registration is intentionally enabled in production (`DISABLE_REGISTRATION=false`).

The general Compose template retains its defaults; production-only registration
and Caddy changes are recorded by `vk-review/deploy.py` and its deployment note.
That script is a historical, guarded one-time operation, not an idempotent deploy.

## Remaining product work

- VK community creation and expanded API access remain separate from the
  published review page; see `vk-review/community-copy.md`.
- Juls single-use MAX identity verification is work in the separate `juls-ai`
  project; the Postiz endpoint and shared-bot implementation are included here.
- Credential presence and deployed OAuth fixes do not prove that every social
  account has completed authorization or passed a live publication test.
