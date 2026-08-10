FROM oven/bun:1.3.11-alpine AS deps
WORKDIR /app

COPY package.json bun.lock ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/extension-sdk/package.json ./packages/extension-sdk/package.json

RUN bun install --frozen-lockfile

FROM deps AS builder
COPY frontend ./frontend
COPY packages/contracts ./packages/contracts
COPY packages/extension-sdk ./packages/extension-sdk

RUN bun run --cwd packages/contracts build && bun run --cwd packages/extension-sdk build

WORKDIR /app/frontend
RUN bun run build

FROM oven/bun:1.3.11-alpine AS runner
WORKDIR /app

# Refresh Alpine security packages included by the upstream Bun image.
RUN apk upgrade --no-cache

ENV NODE_ENV=production
ENV PORT=3000

COPY frontend/package.json ./package.json
COPY frontend/server.js ./server.js
COPY --from=builder /app/frontend/dist ./dist

RUN chown -R bun:bun /app
USER bun

EXPOSE 3000

CMD ["bun", "run", "serve"]
