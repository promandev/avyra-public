# syntax=docker/dockerfile:1.7
# Build context: repo root.

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /repo

# ---------- deps ----------
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
RUN pnpm install --frozen-lockfile=false

# ---------- build ----------
FROM base AS build
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /repo/packages/db/node_modules ./packages/db/node_modules
COPY . .
ENV SKIP_ENV_VALIDATION=1
RUN pnpm --filter @pradomotica/web build

# ---------- runner ----------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache libc6-compat \
 && addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public

# argon2 uses a native .node binary built via node-gyp-build. @vercel/nft
# (Next.js standalone tracer) cannot follow the dynamic require inside
# node-gyp-build, so the binary never lands in .next/standalone. Re-install
# argon2 here inside the Alpine image so prebuild-install downloads the
# correct linux-arm64-musl prebuilt binary and places it where Node can find it.
RUN npm install argon2@^0.41.1 --no-package-lock

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "apps/web/server.js"]
