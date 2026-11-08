# Configurable object storage

Scope: administrator-managed MinIO and Amazon S3 connections. Activating a
connection changes new uploads; existing attachments retain their original
connection. Automatic data migration is a separate follow-up.

## Implementation checklist

- [x] Define storage contracts and persist a connection identifier on attachments.
- [x] Implement immutable connections, encrypted credentials, connection checks,
      and activation after a successful check.
- [x] Route imports, downloads, trace previews, and cleanup to the file's connection.
- [x] Add an administrator-only Storage settings section.
- [x] Support deployments without a required MinIO service and document setup.
- [x] Verify permissions, failed activation, old-file access, and core checks.

## Decisions

- Existing MINIO_* environment settings remain the legacy connection for old files.
- Saved connection destinations are immutable; a changed destination is a new
  connection, so old files never silently resolve against a different server.
- S3 uses an existing private bucket and optional prefix, with category prefixes
  for artifacts, traces, and screenshots. The application does not create AWS buckets.
- Secrets are encrypted with a dedicated installation-level key supplied outside
  the database. API responses never return stored credentials.
- Each upload captures its connection before network I/O. Activation affects
  subsequent uploads and survives restarts.
- Validation against a real AWS account requires operator-provided credentials.

## Follow-up

- Resumable file migration with checksums, progress, retry, and explicit source
  retirement after all references have been migrated.

## Verification completed

- `bun run check` passed with a temporary PostgreSQL database: 68 backend tests,
  36 frontend tests, 7 update-agent tests, lint, type checks, and production builds.
- The database suite verifies the upgrade from legacy attachment references,
  rollback protection, and the Allure import/download query path.
- The real MinIO SDK signs upload/download/delete requests against a local HTTP
  test server; service and UI tests cover activation failures and existing files.
- Docker Compose validates both the default and S3-only configurations; the
  latter contains no active MinIO services or backend dependency on MinIO.
- Full output: `test/test-results/s3-check.log` (ignored local test artifact).

## Operator acceptance remaining

- [ ] Deploy the changed Core, apply migrations, and configure the encryption key.
- [ ] Check and activate a connection against the operator's actual AWS bucket,
      including its IAM/KMS permissions and representative large attachments.

No running installation has been upgraded, no existing objects have been moved,
and release preparation targets the synchronized v0.2.35 release train.
