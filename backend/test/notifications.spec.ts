import { describe, expect, it } from "bun:test";

import { NotificationsNativeService } from "../src/services";
import { createMockRun } from "./test-helpers";

describe("backend notification dispatch regressions", () => {
  it("dispatches enabled run-completion rules and records delivery history", async () => {
    const originalFetch = globalThis.fetch;
    const savedDeliveries: Array<Record<string, unknown>> = [];
    const requests: Array<{ body: unknown; url: string }> = [];
    let requestedSetting: { key: string; projectId?: string } | undefined;

    globalThis.fetch = (async (input, init) => {
      requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    try {
      const service = new NotificationsNativeService(
        {
          create: (record: Record<string, unknown>) => record,
          findOne: async () => null,
          save: async (record: Record<string, unknown>) => {
            savedDeliveries.push(record);
            return record;
          },
        } as any,
        {
          find: async () => [],
        } as any,
        {
          get: async (key: string, projectId?: string) => {
            requestedSetting = { key, projectId };
            return JSON.stringify({
              enabled: true,
              events: ["run-failed"],
              deliveryMode: "summary",
              deliveryDelaySeconds: 0,
              destinations: [
                {
                  enabled: true,
                  id: "webhook-primary",
                  type: "webhook",
                  url: "https://example.com/notifications",
                },
              ],
            });
          },
        } as any,
        ["example.com"],
      );

      const result = await service.dispatchRunCompleted(
        createMockRun({
          id: 42,
          name: "Checkout",
          stats: {
            broken: 0,
            failed: 1,
            passRate: 50,
            passed: 1,
            skipped: 0,
            total: 2,
          },
        }) as any,
        "resolved-project",
      );

      expect(requestedSetting).toEqual({ key: "notification:rules", projectId: "resolved-project" });
      expect(result).toMatchObject({
        failed: 0,
        sent: 1,
        skipped: 0,
      });
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        url: "https://example.com/notifications",
        body: {
          event: "run-failed",
          chart: {
            kind: "donut",
            mimeType: "image/svg+xml",
          },
          projectId: "resolved-project",
          run: {
            id: 42,
            name: "Checkout",
          },
        },
      });
      expect((requests[0].body as Record<string, unknown>).chart).toMatchObject({
        dataUrl: expect.stringContaining("data:image/svg+xml;base64,"),
      });
      expect(savedDeliveries[0]).toMatchObject({
        dedupeKey: "notification:resolved-project:run-failed:42:webhook-primary:summary",
        destinationId: "webhook-primary",
        destinationType: "webhook",
        event: "run-failed",
        projectId: "resolved-project",
        runId: 42,
        status: "sent",
        triggeredBy: "run-completion",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
