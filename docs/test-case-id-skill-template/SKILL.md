---
name: veriqorn-test-case-id
description: Reserve and apply a Veriqorn test-case ID when adding a new automated test that reports Allure results.
---

# Veriqorn test-case IDs

Use this template as a local Codex skill after replacing `VERIQORN_BASE_URL`, `PROJECT_ID`, and the authentication mechanism appropriate for the installation.

When creating a new automated test, derive a stable `testIdentity` from its repository-relative path and test title. Reserve an ID before editing the test:

```sh
curl --fail-with-body -X POST "$VERIQORN_BASE_URL/api/v1/projects/$PROJECT_ID/test-case-ids/reservations" \
  -H "Authorization: Bearer $VERIQORN_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"testIdentity":"e2e/checkout.spec.ts::guest can pay by card","testName":"Guest can pay by card"}'
```

Put the returned `testCaseId` into the framework's Allure ID field and emit the same `testIdentity` as `veriqorn.test.identity`. Do not generate IDs locally or reuse IDs from another test. If the reservation request fails, stop and report the failure rather than guessing an ID.

See [`../test-case-ids.md`](../test-case-ids.md) for the API contract and conflict behaviour.
