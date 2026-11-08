# MinIO compatibility patch

MinIO 8.0.7 is the latest stable SDK at the 2026-11-07 audit, but still pins
query-string 7 and stream-json 1. Their dependency graph contains known
vulnerabilities. Root overrides select query-string 10.0.0 and stream-json 3.8.0.

The Bun patch adapts MinIO's source and both published module formats:
- query-string now exposes its API through a default ESM export;
- stream-json renamed jsonl/Parser.js to jsonl/parser.js and its Node stream
  constructor is now parser.asStream().

Do not remove the patch independently of these overrides. Docker dependency
stages copy this directory before bun install. The MinIO compatibility tests
exercise signed query values, object upload/download, and streamed notifications.
Re-evaluate both the patch and overrides when upgrading MinIO.
