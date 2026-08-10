import { randomUUID } from "crypto";

import { Elysia } from "elysia";

import type { AppConfig } from "./config";
import { HttpError, normalizeError, toErrorPayload } from "./errors";
import { getOriginHeaders, getSecurityHeaders, readAuthToken, type AuthUser } from "./http";
import { registerBackendExtensionRoutes, type InitializedBackendExtension } from "./extensions";
import { registerRoutes } from "./routes";
import type { AppServices } from "./services";

// â”€â”€â”€ Realtime WebSocket â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Maintains a registry of active WebSocket connections for broadcasting
// run-lifecycle events to the frontend realtime layer.

type WsSubscription = { projectId?: string; runId?: string };
type RuntimeWsClient = { projectIds: Set<string>; ws: WebSocket; sub: WsSubscription };

const wsClients = new Map<string, RuntimeWsClient>();

export const broadcastRunEvent = (
  event: "testRunStarted" | "testRunUpdated" | "testRunFinished" | "testRunDeleted" | "newTestResult",
  payload: { id?: number | string; projectId?: number | string; testRun?: { id?: number | string; projectId?: number | string } },
): void => {
  const message = JSON.stringify({ event, data: payload });
  const projectId = String(payload.projectId ?? payload.testRun?.projectId ?? "");
  for (const [, client] of wsClients) {
    try {
      if (projectId && client.projectIds.has(projectId) && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    } catch {
      // ignore send errors for disconnected clients
    }
  }
};

const cleanupWsClient = (id: string) => wsClients.delete(id);

export const __realtimeTestHooks = {
  clearClients(): void {
    wsClients.clear();
  },
  registerClient(
    id: string,
    ws: Pick<WebSocket, "readyState" | "send">,
    sub: WsSubscription = {},
    projectIds: Iterable<string> = sub.projectId ? [sub.projectId] : [],
  ): void {
    wsClients.set(id, { projectIds: new Set(projectIds), ws: ws as WebSocket, sub });
  },
  unregisterClient(id: string): void {
    cleanupWsClient(id);
  },
};

export const attachWebSocketHandler = (app: Elysia, services: AppServices): Elysia => {
  (app as any).ws("/ws", {
    async beforeHandle(context: { request: Request; [key: string]: unknown }) {
      const token = readAuthToken(context.request);
      if (!token) throw new HttpError(401, "AUTH_REQUIRED", "Authentication is required");
      context.authUser = await services.auth.verify(token);
    },
    async open(ws: any) {
      const user = ws.data.authUser as AuthUser | undefined;
      if (!user) {
        ws.close(1008, "Authentication is required");
        return;
      }
      const id = randomUUID();
      ws.data = { id };
      const projects = await services.projects.listProjects(false);
      const projectIds = user.role === "admin"
        ? projects.map((project) => project.id)
        : (await Promise.all(projects.map(async (project) =>
            (await services.projectAccess.hasProjectAccess(user.sub, project.id)) ? project.id : undefined,
          ))).filter((projectId): projectId is string => Boolean(projectId));
      wsClients.set(id, { projectIds: new Set(projectIds), ws: ws.raw ?? ws, sub: {} });
    },
    message(ws: any, message: unknown) {
      const id = ws.data?.id;
      if (!id) return;
      const client = wsClients.get(id);
      if (!client) return;

      try {
        const parsed = typeof message === "string" ? JSON.parse(message) : message;
        if (parsed?.event === "subscribeToTestRun") {
          client.sub.runId = String(parsed.testRunId ?? "");
        } else if (parsed?.event === "unsubscribeFromTestRun") {
          client.sub.runId = undefined;
        }
      } catch {
        // ignore invalid messages
      }
    },
    close(ws: any) {
      const id = ws.data?.id;
      if (id) cleanupWsClient(id);
    },
  });

  return app;
};

const requestBuckets = new Map<string, { count: number; resetAt: number }>();
let lastRateLimitCleanupAt = 0;

const enforceRateLimit = (request: Request, trustProxy: boolean, server: unknown) => {
  const url = new URL(request.url);
  const remoteAddress = (server as { requestIP?: (input: Request) => { address: string } | null } | null)?.requestIP?.(request)?.address;
  const ip = trustProxy
    ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    : remoteAddress || "direct";
  const key = `${ip}:${url.pathname}`;
  const now = Date.now();
  if (now - lastRateLimitCleanupAt >= 60_000) {
    lastRateLimitCleanupAt = now;
    for (const [bucketKey, bucket] of requestBuckets) {
      if (bucket.resetAt <= now) requestBuckets.delete(bucketKey);
    }
  }
  const isLogin = ["/api/v1/auth/login", "/api/v1/auth/session"].includes(url.pathname);
  const ttl = 60_000;
  const limit = isLogin ? 20 : 120;
  const entry = requestBuckets.get(key);

  if (!entry || entry.resetAt <= now) {
    requestBuckets.set(key, { count: 1, resetAt: now + ttl });
    return;
  }

  if (entry.count >= limit) {
    throw new HttpError(429, "RATE_LIMITED", "Too many requests, please try again later");
  }

  entry.count += 1;
};

export const createApp = (
  config: AppConfig,
  services: AppServices,
  extensions: ReadonlyArray<InitializedBackendExtension> = [],
) => {
  const app = new Elysia();

  app.onRequest(({ request, server }) => {
    enforceRateLimit(request, config.trustProxy, server);
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...getOriginHeaders(request, config),
          ...getSecurityHeaders(config),
        },
      });
    }
  });

  app.onAfterHandle(({ request, set }) => {
    const headers = {
      ...getOriginHeaders(request, config),
      ...getSecurityHeaders(config),
    };

    for (const [key, value] of Object.entries(headers)) {
      set.headers[key] = value;
    }
  });

  app.onError(({ error, request, set }) => {
    const correlationId = randomUUID();
    const handled = normalizeError(error);
    set.status = handled.status;
    // Add CORS headers to error responses too (onAfterHandle is not called for errors)
    const corsHeaders = getOriginHeaders(request, config);
    for (const [key, value] of Object.entries(corsHeaders)) {
      set.headers[key] = value;
    }
    return toErrorPayload(handled, correlationId, request);
  });

  for (const extension of extensions) {
    const routes = registerBackendExtensionRoutes(extension);
    if (routes) app.use(routes as never);
  }
  registerRoutes(app, services, extensions);
  attachWebSocketHandler(app, services);
  return app;
};
