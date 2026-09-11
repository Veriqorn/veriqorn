import { describe, expect, it } from "bun:test";

import type { AppServices } from "../src/services";
import { createProjectScopedServices, createTestApp } from "./test-helpers";

const headers = { Authorization: "Bearer test-token", Origin: "http://localhost:3000" };

describe("test case ID routes", () => {
  it("reserves IDs in the resolved project and lists its registry", async () => {
    const calls: Array<Record<string, string | undefined>> = [];
    const app = createTestApp({
      services: createProjectScopedServices({
        testCaseIds: {
          reserve: async (projectId: string, testIdentity: string, testName: string | undefined, reservedBy: string) => {
            calls.push({ projectId, testIdentity, testName, reservedBy });
            return { id: crypto.randomUUID(), testCaseId: "1234567890123", testIdentity, testName, status: "reserved" };
          },
          list: async (projectId: string, status?: string) => [{ projectId, status: status ?? "claimed" }],
        } as unknown as AppServices["testCaseIds"],
      }, "resolved-project"),
    });

    const reserve = await app.handle(new Request("http://localhost/api/v1/projects/default/test-case-ids/reservations", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ testIdentity: "e2e/cart.spec.ts::adds product", testName: "Adds product" }),
    }));
    const list = await app.handle(new Request("http://localhost/api/v1/projects/default/test-case-ids?status=claimed", { headers }));

    expect(reserve.status).toBe(200);
    expect(calls).toEqual([{ projectId: "resolved-project", testIdentity: "e2e/cart.spec.ts::adds product", testName: "Adds product", reservedBy: "1" }]);
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({ success: true, data: [{ projectId: "resolved-project", status: "claimed" }] });
  });
});
