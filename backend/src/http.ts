import { mkdirSync, existsSync } from "fs";
import { isAbsolute, join, relative, resolve } from "path";
import { randomUUID } from "crypto";
import { serialize, parse } from "cookie";

import type { AppConfig } from "./config";
import { HttpError } from "./errors";

export type AuthUser = {
  sub: string;
  email: string;
  name: string;
  role: "admin" | "user" | "kb_viewer";
};

export type AuthResult = {
  user: AuthUser;
  accessToken: string;
};

export function ok<T>(data: T, meta?: Record<string, unknown>): {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
  path?: string;
  timestamp: string;
};
export function ok<T>(request: Request, data: T, meta?: Record<string, unknown>): {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
  path?: string;
  timestamp: string;
};
export function ok<T>(
  requestOrData: Request | T,
  dataOrMeta?: T | Record<string, unknown>,
  maybeMeta?: Record<string, unknown>,
) {
  const request = requestOrData instanceof Request ? requestOrData : undefined;
  const data = (request ? dataOrMeta : requestOrData) as T;
  const meta = (request ? maybeMeta : dataOrMeta) as Record<string, unknown> | undefined;

  return {
    success: true as const,
    data,
    meta,
    path: request ? new URL(request.url).pathname : undefined,
    timestamp: new Date().toISOString(),
  };
}

export const readJsonBody = async <T>(request: Request): Promise<T> => {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
};

export const optionalText = (value: FormDataEntryValue | null | undefined): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const parseBooleanQuery = (value: string | null): boolean =>
  value !== null && ["1", "true", "yes", "on", "force"].includes(value.toLowerCase());

export const parsePositiveInt = (value: string | null | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const parseOptionalNumber = (value: string | null | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : undefined;
};

export const parseTags = (value: string | null | undefined): string[] => {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    }
  } catch {
    // fall back to comma parsing
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

export const getSearchParams = (request: Request): URLSearchParams => new URL(request.url).searchParams;

export const getOriginHeaders = (request: Request, config: AppConfig): Record<string, string> => {
  const origin = request.headers.get("origin");
  const allowOrigin = origin && config.corsOrigins.includes(origin) ? origin : config.corsOrigins[0];

  return {
    ...(allowOrigin ? { "Access-Control-Allow-Origin": allowOrigin } : {}),
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, X-Requested-With, X-Request-Id",
    Vary: "Origin",
  };
};

export const getSecurityHeaders = (config: AppConfig): Record<string, string> => ({
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-XSS-Protection": "0",
  "Content-Security-Policy": [
    "default-src 'self'",
    `frame-ancestors 'self' ${config.corsOrigins.join(" ")}`.trim(),
    "img-src 'self' data: blob: https:",
  ].join("; "),
  ...(config.secureCookies ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
});

export const buildAuthCookie = (token: string, config: AppConfig): string =>
  serialize("auth_token", token, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "lax",
    maxAge: 60 * 60 * 24,
    path: "/",
    domain: config.cookieDomain,
  });

export const buildClearAuthCookie = (config: AppConfig): string =>
  serialize("auth_token", "", {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "lax",
    maxAge: 0,
    expires: new Date(0),
    path: "/",
    domain: config.cookieDomain,
  });

export const readAuthToken = (request: Request): string | null => {
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }

  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }

  return parse(cookieHeader).auth_token || null;
};

export const ensureDirectory = (directoryPath: string): void => {
  if (!existsSync(directoryPath)) {
    mkdirSync(directoryPath, { recursive: true });
  }
};

export const createUploadDirectory = (config: AppConfig): string => {
  const directory = join(config.uploadsDir, Date.now().toString(), randomUUID());
  ensureDirectory(directory);
  return directory;
};

export const safeJoinWithinBase = (baseDir: string, requestedPath: string): string => {
  const resolvedBase = resolve(baseDir);
  const resolvedTarget = resolve(resolvedBase, requestedPath);
  const relativePath = relative(resolvedBase, resolvedTarget);

  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new HttpError(400, "INVALID_PATH", "Directory path must stay within the workspace root");
  }

  return resolvedTarget;
};

export const resolvePublicBaseUrl = (request: Request, config?: Pick<AppConfig, "corsOrigins" | "trustProxy">): string => {
  if (!config?.trustProxy) {
    return config?.corsOrigins[0] || new URL(request.url).origin;
  }
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host") || "localhost:3002";
  const protocol = forwardedProto || new URL(request.url).protocol.replace(":", "") || "http";
  return `${protocol}://${host}`;
};
