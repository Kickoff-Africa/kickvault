FROM node:20-alpine AS base
WORKDIR /app

# ── Dependencies ──────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
# npm install instead of npm ci: @node-rs/argon2 has platform-specific native
# bindings that cause npm ci to fail when the lock file was generated on a
# different platform (e.g. macOS → Linux).
RUN npm install --omit=dev

# ── Build ─────────────────────────────────────────────────────────────────────
FROM base AS build
COPY package.json package-lock.json ./
RUN npm install
COPY prisma ./prisma
COPY src ./src
COPY tsconfig.json ./
RUN npm run build

# ── Production image ──────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY package.json ./

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
