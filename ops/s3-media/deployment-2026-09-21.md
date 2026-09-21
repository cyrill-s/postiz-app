# VK Cloud S3 media deployment — 2026-09-21

Postiz now stores new media in the existing VK Cloud bucket `mk-ai-bot`, under
the exclusive `postiz/` prefix. Public media base URL:
`https://mk-ai-bot.hb.ru-msk.vkcloud-storage.ru/postiz`.

The existing key cannot create buckets. The bucket's access policy was not
changed; Postiz uploads set object-level `public-read`. The previously absent
CORS configuration now allows GET, HEAD, PUT and POST from
`https://poster.generationl.ru`, all request headers, and exposes ETag. It does
not grant unauthenticated writes or listing.

## Application

Production: `/opt/postiz-next` on `185.119.58.121`.
Release: `/opt/postiz-next/releases/s3-media-20260921`.
Image: `local/postiz:s3-media-20260921`, ID
`sha256:d996c8e5abfefe872458084071bd5c544456ee355840c401b3bdc0118c8611c2`.

This is a storage-only overlay on the previously running
`local/postiz:facebook-media-af1ca73e`. It replaces the four compiled upload
modules in backend and orchestrator plus matching TypeScript sources. It does
not redeploy the rejected `4f1612b0` Facebook changes. Frontend server layouts
already read storage configuration dynamically; no frontend rebuild was needed.

The existing `cloudflare` provider is the S3-compatible upload implementation.
`S3_ENDPOINT` overrides its R2 endpoint; `S3_KEY_PREFIX` applies consistently to
server uploads, multipart parts, signing, reading and removal. Multipart
completion builds the public URL from the requested key instead of parsing the
provider's encoded Location, avoiding duplicated `postiz/postiz%2F...` paths.
Without the overrides, the original R2 endpoint and unprefixed keys remain.

Credentials are in `s3.env` in the release directory, mode 600, referenced by
the compose override. They are not committed or included in the source archive.
The source archive is based on `af1ca73e` with these storage files overlaid;
SHA-256: `f24e2bba6df3f3b83e4cff068cbff7a573535d53fafdcb0f3203a8a03d3f643d`.

## Existing media

148 files / 58,632,298 bytes were copied to S3. Every public object was downloaded
and compared by SHA-256. Local originals were retained. Basenames were checked
for collisions before flattening the old dated directory structure.

One transaction updated 135 Media records and image URLs in 144 Post records.
It changed no publication state, schedule or post content. Conditional updates
guarded against concurrent edits. No Media.path or Post.image references to
`poster.generationl.ru/uploads/` remained after migration.

Private rollback artifacts in the release directory:

- `database-before.dump` — 426,502-byte custom-format database backup;
- `links-before.json` — exact before/after fields for the 279 changed records;
- `files-manifest.json` — original paths, public S3 URLs, sizes and hashes;
- `previous-compose.override.yaml` — prior deployment configuration.

## Verification

- Backend and orchestrator production compilation passed.
- `smoke.cjs` passed against the new Linux image and real S3: server file/data
  URL/stream uploads, signed PUT, browser-style multipart upload and completion,
  public HTTPS content, namespace, CORS and removal. Test objects were removed.
- Production `/public/v1/upload` returned 201 with an S3 URL.
- Meta Graph API v25.0 accepted both that fresh upload and the migrated original
  failing PNG, returning HTTP 200. Both were unpublished tests and deleted.
- `/auth`, `/api/integrations`, and `https://jsia.ru/health` returned 200.
  The frontend HTML exposes the configured public S3 URL.
- Only `postiz-next-app-1` was recreated. It is healthy with zero restarts;
  frontend, backend and orchestrator are online, with Temporal workers RUNNING.

## Rollback

Restore `previous-compose.override.yaml` to
`/opt/postiz-next/docker-compose.vk-community.yaml`, then recreate only `app`
with the two compose files. Existing S3 URLs stay readable with the prior app;
restoring the entire database is unnecessary for an application rollback.

If original media URLs must also be restored, use the exact field snapshots in
`links-before.json` with compare-and-set updates against their `after` values.
Do not overwrite publication state or changes made after this deployment.
Retain S3 copies and local originals until the rollback is verified.
