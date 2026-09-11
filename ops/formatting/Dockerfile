# Existing production release; retain its pinned Linux dependencies and MAX CA.
FROM local/postiz:v2.23.0-vk-ok-max-1
RUN rm -rf /app/apps/frontend/.next /app/apps/backend/dist /app/apps/orchestrator/dist
COPY frontend-next/ /app/apps/frontend/.next/
COPY overlay/ /app/
COPY public/ /app/apps/frontend/public/
