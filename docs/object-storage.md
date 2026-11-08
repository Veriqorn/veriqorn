# MinIO and Amazon S3 storage

Administrators can configure object storage under **Settings > Storage**.
The feature belongs to Community Core and is also available in Enterprise
images based on a Core version containing it.

## Setup

1. Generate a stable encryption key:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
   ```

2. Set `VERIQORN_STORAGE_ENCRYPTION_KEY` in the backend environment (or the
   deployment `.env`) and recreate the backend with the updated environment.
   The value must decode to exactly 32 bytes. Back it up separately from the
   database; saved credentials cannot be read without the same key.
3. Apply backend migrations. The Compose deployment sets
   `BACKEND_RUN_MIGRATIONS=true`. Other deployments must run with that setting
   when upgrading. The new nullable `storageConnectionId` column preserves
   existing records and does not transfer any objects.
4. Create a private S3 bucket in the intended region. In Storage settings, add
   the name, region, bucket, optional prefix, access key, secret key, and (for
   temporary credentials) session token. Static credentials must remain valid;
   automatic IAM role discovery/credential refresh is not part of this version.
   MinIO connections additionally accept a server URL such as
   `https://minio.example.com:9000` and also use an existing bucket.
5. Use **Check connection**, then **Activate**. Activation performs another
   check before committing the change. Each check writes, reads, compares,
   and deletes a random test object. AWS buckets are never created by the app.

Grant object read/write/delete access beneath the chosen prefix, including
`.veriqorn-check/`. Typical S3 actions are `s3:GetObject`, `s3:PutObject`, and
`s3:DeleteObject`; large uploads also require the appropriate multipart upload
permissions (`s3:AbortMultipartUpload`, `s3:ListMultipartUploadParts`).
The application uses the configured region, so it does not need to enumerate
all buckets. KMS-encrypted buckets additionally require permissions for the
configured KMS key. An S3 deployment check is still required against your own
AWS bucket and policy.

New object keys are `<prefix>/<category>/<run>/<attachment>-<filename>` where
category is `artifacts`, `traces`, or `screenshots`. Downloads and trace previews
continue through authenticated application endpoints; the bucket stays private
and no browser CORS configuration is needed for these operations.

Small text/JSON attachments retain the existing database storage policy.
If an object upload fails, the existing importer fallback keeps that attachment
in PostgreSQL. Connection settings and encrypted credentials are accessible only
through the administrator storage API; the generic settings API blocks direct
access to the internal document.

## Switching an existing installation

Activation affects new uploads and does not move old objects. Every new external
attachment stores its connection ID and actual bucket/key. Attachments created
before this feature always resolve through the original `MINIO_*` environment
connection, even after S3 is activated. An upload already in progress keeps the
connection it captured before network I/O.

Keep the original MinIO service, volume, environment credentials, and
`MINIO_ENABLED=true` while it contains referenced files. Saved connection
destinations are immutable and cannot be deleted through this API; create a new
connection to change a destination. Keep the old credentials valid while files
reference that connection. A later migration feature will support checksummed,
resumable transfer and credential rotation.

The migration rollback refuses to drop `storageConnectionId` while attachments
reference saved connections. Older application images do not understand those
references; move such attachments back to legacy storage before downgrading.

## Fresh deployment without bundled MinIO

Use Docker Compose 2.24.4 or later, copy `deploy/.env.example` to `.env`, fill
the application secrets, and set the encryption key. Retain the template's
MinIO variables for base-file interpolation, even though its services are
disabled by the overlay. From `deploy/`, run:

```sh
docker compose -f docker-compose.yml -f compose.s3.yml up -d
```

This starts the application without a MinIO dependency. Before an administrator
activates a connection, attachments are kept in PostgreSQL. The overlay is
included in subsequent in-app updates. For Enterprise, apply
`compose.enterprise.yml` before `compose.s3.yml`, and set:

```dotenv
UPDATE_COMPOSE_FILES=/install/docker-compose.yml,/install/compose.enterprise.yml,/install/compose.s3.yml
```

Do not apply the S3-only overlay to an existing MinIO installation until its
referenced files have been migrated. Activating S3 in the UI does not stop the
MinIO container or remove its volume.

## API

- `GET /api/v1/system/storage/`: connection summaries and active connection.
- `POST /api/v1/system/storage/connections`: save a new immutable destination.
- `POST /api/v1/system/storage/connections/:id/check`: write/read/delete check.
- `POST /api/v1/system/storage/connections/:id/activate`: check and activate.

All endpoints require the platform `admin` role. Stored access keys, secret keys,
and session tokens are AES-256-GCM encrypted with the connection ID bound as
authenticated data; they are never returned in API summaries or SDK errors.
