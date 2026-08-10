import { afterEach, describe, expect, it } from "bun:test";

import { __realtimeTestHooks, broadcastRunEvent } from "../src/app";

const openReadyState = typeof WebSocket !== "undefined" ? WebSocket.OPEN : 1;
const closedReadyState = typeof WebSocket !== "undefined" ? WebSocket.CLOSED : 3;

describe("backend realtime broadcast", () => {
  afterEach(() => {
    __realtimeTestHooks.clearClients();
  });

  it("broadcasts run lifecycle events to connected websocket clients", () => {
    const messages: string[] = [];

    __realtimeTestHooks.registerClient("open-client", {
      readyState: openReadyState,
      send(message: string) {
        messages.push(message);
      },
    }, {}, ["default"]);
    __realtimeTestHooks.registerClient("closed-client", {
      readyState: closedReadyState,
      send() {
        throw new Error("closed clients must not receive events");
      },
    });

    broadcastRunEvent("testRunFinished", {
      id: 55,
      projectId: "default",
      testRun: {
        id: 55,
        projectId: "default",
      },
    });

    expect(messages).toEqual([
      JSON.stringify({
        event: "testRunFinished",
        data: {
          id: 55,
          projectId: "default",
          testRun: {
            id: 55,
            projectId: "default",
          },
        },
      }),
    ]);
  });
});
