# The base is the exact production v2.23.0 image. Compilation happens locally.
FROM ghcr.io/gitroomhq/postiz-app:v2.23.0@sha256:172fd235ca656b28e4f4e7a31a66b7703bf88267b4259cf9f859f10d3b3a8a6f
RUN rm -rf /app/apps/frontend/.next
COPY frontend-next/ /app/apps/frontend/.next/
COPY overlay/ /app/
COPY public/ /app/apps/frontend/public/
