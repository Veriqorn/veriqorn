# Test case ID registry

Veriqorn assigns a test-case ID to exactly one test identity within a project. The ID is not an Allure result UUID; it is the stable ID placed in the test source and emitted as an Allure label.

## Reserve before writing a test

`POST /api/v1/projects/:projectId/test-case-ids/reservations` requires maintainer or owner access.

```json
{
  "testIdentity": "e2e/checkout.spec.ts::guest can pay by card",
  "testName": "Guest can pay by card"
}
```

The response contains the next unused digits-only `testCaseId` in the project sequence: `1`, then `2`, then `3`, and so on. Add both values to the test's Allure output:

```ts
// Framework-specific equivalent is fine; these labels are the contract.
allure.label("allure.id", "42")
allure.label("veriqorn.test.identity", "e2e/checkout.spec.ts::guest can pay by card")
```

`GET /api/v1/projects/:projectId/test-case-ids` lists reservations and claims. It accepts `?status=reserved|claimed|conflicted`.

## Import behaviour

On an Allure import, Veriqorn reads `allure.id`, `testCaseId`, and the compatible aliases already accepted by the importer. A previously unseen ID is claimed by its first imported test. A reserved ID is confirmed when its `veriqorn.test.identity` matches. Existing test suites without the identity label remain supported: their identity falls back to Allure `historyId`, then `fullName`, then the test name.

If a different test sends an occupied ID, Veriqorn still imports the result. It marks the result with labels `veriqorn.testCaseId.status=conflict` and `veriqorn.testCaseId.owner=<owner identity>`, and marks the registry entry `conflicted` with conflict metadata. This makes conflicts queryable without losing test evidence.
