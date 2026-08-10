import { describe, expect, it } from "bun:test";

import { createTestApp, createTestConfig, defaultAuthUser } from "./test-helpers";

describe("backend app harness", () => {
  it("serves the health check with the normalized success envelope", async () => {
    const app = createTestApp();

    const response = await app.handle(new Request("http://localhost/healthz"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      success: true,
      data: {
        runtime: "bun",
        service: "backend",
        status: "ok",
      },
    });
  });

  it("creates an auth session and sets the auth cookie", async () => {
    const app = createTestApp({
      config: createTestConfig({
        cookieDomain: "example.com",
        secureCookies: true,
      }),
      auth: {
        login: async (email, password) => ({
          accessToken: `issued-for:${email}:${password}`,
          user: defaultAuthUser,
        }),
      },
    });

    const response = await app.handle(
      new Request("http://localhost/api/v1/auth/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          email: "admin@example.com",
          password: "secret",
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      success: true,
      data: {
        user: {
          email: "admin@example.com",
          id: "1",
          name: "Admin",
          role: "admin",
        },
      },
    });

    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain("auth_token=issued-for%3Aadmin%40example.com%3Asecret");
    expect(setCookie).toContain("Domain=example.com");
    expect(setCookie).toContain("Secure");
  });

  it("clears the auth cookie on logout", async () => {
    const app = createTestApp();

    const response = await app.handle(
      new Request("http://localhost/api/v1/auth/logout", {
        method: "POST",
        headers: { Authorization: "Bearer test-token" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("returns normalized auth errors with CORS headers on protected routes", async () => {
    const app = createTestApp();

    const response = await app.handle(
      new Request("http://localhost/api/v1/me", {
        headers: {
          Origin: "http://localhost:3000",
        },
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    expect(payload).toMatchObject({
      success: false,
      error: {
        code: "AUTH_REQUIRED",
        message: "Authentication is required",
      },
      path: "/api/v1/me",
    });
  });
});
