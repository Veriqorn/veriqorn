FROM oven/bun:1.3.11-alpine AS runner
WORKDIR /app

# Refresh Alpine security packages included by the upstream Bun image before
# installing the only runtime tool required for repository indexing.
RUN apk upgrade --no-cache && apk add --no-cache git

COPY package.json bun.lock ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/extension-sdk/package.json ./packages/extension-sdk/package.json

RUN bun install --frozen-lockfile --production

# TypeScript's platform compiler binary is a development-only tool. It is not
# needed to run the Bun backend and is removed so it cannot expand the
# production attack surface (or trigger scanner findings for its bundled Go).
RUN rm -rf /app/node_modules/.bun/@typescript+typescript-linux-* \
  /app/node_modules/@typescript/typescript-linux-*

COPY backend ./backend
COPY packages/contracts ./packages/contracts
COPY packages/extension-sdk ./packages/extension-sdk

ENV NODE_ENV=production
ENV PORT=3001
ENV BACKEND_RUN_MIGRATIONS=true

WORKDIR /app/backend

RUN chown -R bun:bun /app
USER bun

EXPOSE 3001

CMD ["bun", "src/index.ts"]
