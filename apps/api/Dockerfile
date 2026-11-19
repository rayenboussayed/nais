# syntax=docker/dockerfile:1
#
# Production image for the trainslator API. Multi-stage: installs and builds
# with devDependencies, then ships a lean runtime layer without them.
# Build from the REPOSITORY ROOT (the context must include packages/shared):
#   docker build -f apps/api/Dockerfile -t trainslator/api:latest .
# Run migrations once before the first start:
#   docker run --rm --env-file .env trainslator/api:latest node apps/api/bin/db-migrate.mjs

# ───────────────────────────── build stage ─────────────────────────────
FROM node:24-alpine AS build
WORKDIR /repo

# Manifests first for layer caching.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/

# Install every dependency needed to build (hoisted to the root).
RUN npm ci --workspace=@trainslator/shared --workspace=@trainslator/api \
    --include-workspace-root=false --ignore-scripts

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

RUN npm run build -w packages/shared && npm run build -w @trainslator/api
# Drop devDependencies so the runtime layer carries only production deps.
RUN npm prune --omit=dev --workspace=@trainslator/shared --workspace=@trainslator/api \
    --include-workspace-root=false --ignore-scripts

# ──────────────────────────── runtime stage ─────────────────────────────
FROM node:24-alpine AS runtime
WORKDIR /repo

ENV NODE_ENV=production

# Runtime content: compiled output, migrations, bins and the hoisted
# production dependencies (workspace symlinks inside node_modules stay valid
# because /repo layout is preserved).
COPY --from=build --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/package.json ./
COPY --from=build --chown=node:node /repo/packages/shared/package.json ./packages/shared/
COPY --from=build --chown=node:node /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=node:node /repo/apps/api/package.json ./apps/api/
COPY --from=build --chown=node:node /repo/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /repo/apps/api/bin ./apps/api/bin
COPY --from=build --chown=node:node /repo/apps/api/drizzle ./apps/api/drizzle

# Shared model-cache directory owned by the runtime uid, so a named volume
# initialized from the image is writable by both the API and the warmup.
RUN mkdir -p /hf-cache && chown node:node /hf-cache

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health > /dev/null 2>&1 || exit 1

CMD ["node", "apps/api/dist/main.js"]
