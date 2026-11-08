FROM node:26.13.0-alpine

RUN apk upgrade --no-cache && apk add --no-cache docker-cli docker-cli-compose

WORKDIR /app
COPY server.mjs update-helpers.mjs ./

# Docker socket access is root-equivalent; this service is intentionally the
# only one in the Compose project that has it.
EXPOSE 8787
CMD ["node", "server.mjs"]
