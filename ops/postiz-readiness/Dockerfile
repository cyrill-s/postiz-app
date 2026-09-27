ARG POSTIZ_BASE_IMAGE=local/postiz:juls-max-20260922
FROM ${POSTIZ_BASE_IMAGE}

# Preserve the deployed frontend, orchestrator and dependencies; rebuild the
# backend against this exact source snapshot and replace the container startup.
COPY . /app
WORKDIR /app
RUN NODE_OPTIONS=--max-old-space-size=4096 pnpm --filter ./apps/backend run build

HEALTHCHECK --interval=30s --timeout=10s --start-period=4m --retries=3 \
  CMD node /app/ops/postiz-readiness/check-readiness.cjs
