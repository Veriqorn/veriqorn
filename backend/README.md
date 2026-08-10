# backend

`backend` is the Bun-first API shell for EPIC-1505.

Current direction:
- Bun runtime + Elysia transport;
- normalized `/api/v1` routing;
- TypeORM + PostgreSQL persistence on the current product schema;
- project-scoped resources moved to path-first routing;
- imports consolidated under `projects/:projectId/imports/allure/*` instead of legacy `upload/*` and `allure-import/*` duplication.

This package is self-contained for the target stack runtime. Transport, auth, domain services, static assets, and migrations live under `backend`.

## Scripts

- `bun run dev`
- `bun run start`
- `bun run build`
- `bun run typecheck`
- `bun run test:run`

## Environment

`backend` loads environment variables from `backend/.env`.

Required values for a functional API runtime include at least:

- `DATABASE_URL`
- `JWT_SECRET`
- `TRACE_TOKEN_SECRET` (a distinct secret in production)
- `BACKEND_BOOTSTRAP_ADMIN_EMAIL` and `BACKEND_BOOTSTRAP_ADMIN_PASSWORD` for a new production database

Useful optional values:

- `PORT`
- `CORS_ORIGINS`
- `COOKIE_DOMAIN`
- `BACKEND_RUN_MIGRATIONS`
- `BACKEND_BOOTSTRAP_EMPTY_DATABASE`
- `BACKEND_SECURE_COOKIES`
- `BACKEND_MIGRATIONS_DIR`
- `MINIO_ENABLED`
- `MINIO_ENDPOINT`
- `MINIO_PORT`
- `MINIO_USE_SSL`
- `MINIO_ACCESS_KEY`
- `MINIO_SECRET_KEY`
- `TRACE_TOKEN_SECRET`
- `TRACE_TOKEN_TTL_SECONDS`

## Migrations

`backend` uses packaged migrations from `backend/migrations`. Set
`BACKEND_MIGRATIONS_DIR` to override that lookup explicitly.

On an empty PostgreSQL database, `backend` can bootstrap the current schema
with TypeORM `synchronize` and baseline the existing migration history. In
production, it will refuse an empty database unless the initial administrator
email and password are supplied through the bootstrap environment variables;
there are no built-in credentials.
