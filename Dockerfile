# syntax=docker/dockerfile:1.7
# Stratus production image. One image, two entry points (web / worker), plus a `migrate` target.
# No secrets are baked in: all configuration is provided at runtime via environment variables
# (e.g. from AWS Secrets Manager / ECS task definitions). Runs as an unprivileged user.

ARG NODE_IMAGE=node:24-bookworm-slim

# ── deps: full dependency tree (build tooling included) ──
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json .npmrc ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci

# ── build: Next.js production build + worker bundle ──
FROM deps AS build
COPY . .
RUN npx prisma generate && npx next build && node scripts/build-worker.mjs

# ── migrate: one-off job that applies database migrations (needs the Prisma CLI) ──
FROM deps AS migrate
COPY prisma ./prisma
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

# ── runtime: production dependencies only ──
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/dist ./dist
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/src/generated ./src/generated
RUN rm -rf .next/cache && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/sign-in').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Web by default; run the worker with: command ["node", "dist/worker.mjs"]
CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0"]
