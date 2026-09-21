# Facebook media upload hotfix — 2026-09-21

Production: `https://poster.generationl.ru`, `/opt/postiz-next` on
`185.119.58.121`. Source commit: `af1ca73e`. Image:
`local/postiz:facebook-media-af1ca73e`, manifest list
`sha256:d33ce5fb900987da8f7c9632270f833c64a2520a176dab4e01dc9275be8a5492`.
Release directory: `/opt/postiz-next/releases/facebook-media-af1ca73e`.

Facebook Graph API rejected media supplied through Postiz-hosted `url` and
`file_url` fields even though both files returned HTTP 200 to a
`facebookexternalhit` request. The provider now streams the same bytes to the
Graph API as multipart `source` uploads. The multipart body is rebuilt for each
retry, and source files are streamed instead of being buffered in application
memory.

The regression suite covers both photo and video publication through the full
`FacebookProvider.post()` seam. Backend and orchestrator production builds
passed. Production was recreated for the `app` service only; it became healthy
with zero restarts. `/auth`, `/api/integrations`, and `https://jsia.ru/health`
returned HTTP 200.

Live verification on the `Testforposter` Page passed for:

- image-only post: `122100600849484976`;
- video/Reel: `3776050755894016`;
- image post with an automatic comment: post `122100604695484976`, comment
  `1771212707449838`.

Rollback by restoring
`/opt/postiz-next/releases/facebook-media-af1ca73e/previous-compose.override.yaml`
as `/opt/postiz-next/docker-compose.vk-community.yaml`, then recreate only the
app service:

```sh
docker compose -f docker-compose.yaml -f docker-compose.vk-community.yaml up -d --no-deps app
```

No database migration was required.
