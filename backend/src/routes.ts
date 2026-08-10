import { randomUUID } from "crypto";
import { existsSync, readdirSync, rmSync, statSync } from "fs";
import { basename, extname, join } from "path";

import {
  allureImportJobResultSchema,
  apiKeyIdParamSchema,
  assignProjectMemberRequestSchema,
  changeMePasswordRequestSchema,
  createAllureImportJobFormSchema,
  createAllureImportJobRequestSchema,
  createApiKeyRequestSchema,
  createDashboardRequestSchema,
  createProjectRequestSchema,
  createRunRequestSchema,
  dashboardIdParamSchema,
  dashboardMetricsSearchSchema,
  launchesListSearchSchema,
  loginRequestSchema,
  meProfileSchema,
  projectAccessSearchSchema,
  projectContractSchema,
  projectDeleteSearchSchema,
  projectIdParamSchema,
  projectsListSearchSchema,
  runSchema,
  runIdParamSchema,
  runsListResponseSchema,
  sessionSchema,
  updateMeProfileRequestSchema,
  updateDashboardRequestSchema,
  updateProjectRequestSchema,
  userIdParamSchema,
  userSchema,
  type AllureImportSourceKind,
} from "@veriqorn/contracts";
import AdmZip from "adm-zip";
import { Elysia } from "elysia";
import { z } from "zod";

import { broadcastRunEvent } from "./app";
import { readValidatedJsonBody, readValidatedSearch, validateContract } from "./contracts";
import { HttpError } from "./errors";
import { getBackendExtensionStatuses, type InitializedBackendExtension } from "./extensions";
import {
  buildAuthCookie,
  buildClearAuthCookie,
  createUploadDirectory,
  ok,
  optionalText,
  parseTags,
  readAuthToken,
  resolvePublicBaseUrl,
  safeJoinWithinBase,
} from "./http";
import {
  createTraceToken,
  DEFAULT_PROJECT_ID,
  parseTraceToken,
  requireProjectRole,
  type AppServices,
} from "./services";

type RouteMethod = "delete" | "get" | "patch" | "post" | "put";
type CompatibleRoute = { method?: RouteMethod; path: string };
type ProjectRouteContext = {
  projectId: string;
  user: Awaited<ReturnType<typeof requireUser>>;
};
type ImportRunConfig = {
  branch?: string;
  commit?: string;
  environment?: string;
  parentRunId?: string;
  project?: string;
  runName?: string;
  tags?: string[];
  testRunId?: number | string;
};

const detectContentType = (fileName: string): string => {
  switch (extname(fileName).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".ttf":
      return "font/ttf";
    case ".webmanifest":
      return "application/manifest+json";
    default:
      return "application/octet-stream";
  }
};

const isTraceAttachment = (name?: string, type?: string, source?: string): boolean => {
  const value = `${name || ""} ${type || ""} ${source || ""}`.toLowerCase();
  return (
    value.includes("trace") ||
    value.includes("application/zip") ||
    value.includes("application/x-zip") ||
    value.includes(".zip") ||
    value.includes(".trace")
  );
};

const isZipFile = (file: File): boolean => file.type.includes("zip") || file.name.toLowerCase().endsWith(".zip");

const normalizeTags = (value?: string): string[] =>
  value
    ? value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];

const parseRunId = (runId: string): number => {
  const parsed = Number.parseInt(runId, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, "RUN_VALIDATION", "Invalid run id");
  }

  return parsed;
};

const toAttachmentBuffer = (content: Buffer | string): Buffer => {
  if (Buffer.isBuffer(content)) {
    return content;
  }

  if (content.startsWith("base64:")) {
    return Buffer.from(content.slice("base64:".length), "base64");
  }

  return Buffer.from(content);
};

const requireUser = async (request: Request, services: AppServices) => {
  const token = readAuthToken(request);
  if (!token) {
    throw new HttpError(401, "AUTH_REQUIRED", "Authentication is required");
  }

  return services.auth.verify(token);
};

const requireProjectContext = async (
  request: Request,
  services: AppServices,
  rawProjectId: string,
  requiredRoles: Array<"maintainer" | "owner" | "viewer"> = ["viewer", "maintainer", "owner"],
): Promise<ProjectRouteContext> => {
  const { projectId } = validateContract(
    projectIdParamSchema,
    { projectId: rawProjectId },
    "PROJECT_VALIDATION",
    "Invalid project id",
  );
  const user = await requireUser(request, services);
  const scopedProjectId = await requireProjectRole(services, user, projectId, requiredRoles);
  return { projectId: scopedProjectId, user };
};

const requireKbReadContext = async (
  request: Request,
  services: AppServices,
  rawProjectId: string,
): Promise<ProjectRouteContext> => {
  const { projectId } = validateContract(
    projectIdParamSchema,
    { projectId: rawProjectId },
    "PROJECT_VALIDATION",
    "Invalid project id",
  );
  return requireProjectContext(request, services, projectId);
};

const assertPasswordPolicy = (password: string): void => {
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
  if (password.length < 12 || password.length > 128 || classes < 3) {
    throw new HttpError(400, "PASSWORD_POLICY", "Password must be 12-128 characters and contain at least three character classes");
  }
};

const assertEmailAddress = (email: string): void => {
  if (!z.string().trim().email().safeParse(email).success) {
    throw new HttpError(400, "USER_VALIDATION", "email must be a valid email address");
  }
};

const saveFormFile = async (file: File, uploadDir: string): Promise<string> => {
  if (file.size > 100 * 1024 * 1024) {
    throw new HttpError(413, "IMPORT_TOO_LARGE", "Each import file must not exceed 100 MiB");
  }
  const targetPath = join(uploadDir, basename(file.name));
  await Bun.write(targetPath, file);
  return targetPath;
};

const extractZipAndResolveDir = (filePath: string, uploadDir: string): string => {
  const extractDir = join(uploadDir, "extracted");
  const zip = new AdmZip(filePath);
  const entries = zip.getEntries() as Array<{ entryName: string; header: { size: number } }>;
  if (entries.length > 10_000) {
    throw new HttpError(413, "IMPORT_ARCHIVE_TOO_LARGE", "Archive contains too many files");
  }
  const expandedBytes = entries.reduce((total, entry) => total + Math.max(0, entry.header.size), 0);
  if (expandedBytes > 500 * 1024 * 1024) {
    throw new HttpError(413, "IMPORT_ARCHIVE_TOO_LARGE", "Archive expands beyond the 500 MiB limit");
  }
  for (const entry of entries) {
    const entryName = entry.entryName.replace(/\\/g, "/");
    if (entryName.startsWith("/") || entryName.split("/").includes("..")) {
      throw new HttpError(400, "IMPORT_ARCHIVE_INVALID", "Archive contains an unsafe path");
    }
  }
  zip.extractAllTo(extractDir, true);

  const extractedFiles = readdirSync(extractDir);
  const hasRootResults = extractedFiles.some((file) => file.endsWith("-result.json") || file.endsWith("result.json"));
  if (hasRootResults) {
    return extractDir;
  }

  const subdirs = extractedFiles.filter((entry) => statSync(join(extractDir, entry)).isDirectory());
  if (subdirs.length === 1) {
    const nestedDir = join(extractDir, subdirs[0]);
    const nestedFiles = readdirSync(nestedDir);
    const hasNestedResults = nestedFiles.some((file) => file.endsWith("-result.json") || file.endsWith("result.json"));
    if (hasNestedResults) {
      return nestedDir;
    }
  }

  return extractDir;
};

const markLegacyRoute = (set: { headers: Record<string, string | number> }, canonicalPath: string) => {
  set.headers["Deprecation"] = "true";
  set.headers["Link"] = `<${canonicalPath}>; rel="successor-version"`;
  set.headers["X-Veriqorn-Canonical-Route"] = canonicalPath;
};

const registerCompatibleRoute = (
  router: any,
  method: RouteMethod,
  canonicalPath: string,
  handler: (context: any) => unknown,
  legacyRoutes: CompatibleRoute[] = [],
) => {
  const registry = router as Record<RouteMethod, (path: string, handler: (context: any) => unknown) => any>;
  registry[method](canonicalPath, handler);

  for (const legacyRoute of legacyRoutes) {
    const legacyMethod = legacyRoute.method ?? method;
    registry[legacyMethod](legacyRoute.path, (context) => {
      markLegacyRoute(context.set, canonicalPath);
      return handler(context);
    });
  }
};

const withLegacyHeaders = (response: Response, canonicalPath: string): Response => {
  const headers = new Headers(response.headers);
  headers.set("Deprecation", "true");
  headers.set("Link", `<${canonicalPath}>; rel="successor-version"`);
  headers.set("X-Veriqorn-Canonical-Route", canonicalPath);
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};

const forwardLegacyRequest = async (
  app: Elysia,
  request: Request,
  targetPath: string,
  canonicalPath = targetPath,
  parsedBody?: unknown,
): Promise<Response> => {
  const url = new URL(request.url);
  url.pathname = targetPath;
  const method = request.method.toUpperCase();
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  const body = method === "GET" || method === "HEAD"
    ? undefined
    : parsedBody !== undefined
      ? JSON.stringify(parsedBody)
      : await request.text();
  const forwarded = new Request(url, {
    body,
    headers,
    method: request.method,
    signal: request.signal,
  });
  const response = await app.handle(forwarded);
  return withLegacyHeaders(response, canonicalPath);
};

const toContractUser = (user: Awaited<ReturnType<typeof requireUser>>) =>
  userSchema.parse({
    avatar: null,
    email: user.email,
    id: user.sub,
    name: user.name,
    role: user.role === "admin" ? "admin" : "user",
  });

const toSessionPayload = (user: Awaited<ReturnType<typeof requireUser>>) => sessionSchema.parse({ user: toContractUser(user) });

const toIsoDateTime = (value: Date | null | undefined): null | string => (value ? value.toISOString() : null);

const toContractRun = (run: Awaited<ReturnType<AppServices["runs"]["getTestRun"]>>) =>
  runSchema.parse({
    branch: run.branch ?? null,
    endTime: toIsoDateTime(run.endTime),
    environment: run.environment ?? null,
    id: run.id,
    name: run.name,
    projectId: run.projectId ?? null,
    startTime: toIsoDateTime(run.startTime),
    stats: run.stats,
    status: run.status,
    tags: Array.isArray(run.tags) ? run.tags : [],
    uuid: run.uuid ?? null,
  });

const toContractRunsList = (response: Awaited<ReturnType<AppServices["runs"]["getTestRuns"]>>) =>
  runsListResponseSchema.parse({
    items: response.items.map((run) => toContractRun(run)),
    limit: response.limit,
    page: response.page,
    total: response.total,
  });

const buildImportRunName = (config: ImportRunConfig, fallback: string): string => {
  const parts = [config.runName?.trim() || fallback];
  if (config.project?.trim()) {
    parts.push(`[${config.project.trim()}]`);
  }
  if (config.branch?.trim()) {
    parts.push(`[${config.branch.trim()}]`);
  }
  if (config.commit?.trim()) {
    parts.push(`[${config.commit.trim()}]`);
  }

  return parts.join(" ").trim();
};

const resolveImportRun = async (
  services: AppServices,
  projectId: string,
  config: ImportRunConfig,
  fallbackName: string,
) => {
  if (config.parentRunId) {
    return services.runs.getTestRun(config.parentRunId, projectId);
  }

  if (config.testRunId !== undefined) {
    return services.runs.getTestRun(config.testRunId, projectId);
  }

  return services.runs.createTestRun(
    {
      branch: config.branch,
      environment: config.environment,
      name: buildImportRunName(config, fallbackName),
      tags: config.tags,
    },
    projectId,
  );
};

const executeImportFromDirectory = async (
  services: AppServices,
  {
    diagnosticsKey,
    directoryPath,
    fallbackName,
    projectId,
    run,
    source,
    cleanupDirectory,
  }: {
    diagnosticsKey: string;
    directoryPath: string;
    fallbackName: string;
    projectId: string;
    run: ImportRunConfig;
    source: string;
    cleanupDirectory?: string;
  },
) => {
  const testRun = await resolveImportRun(services, projectId, run, fallbackName);
  const diagnostics = services.uploadOrchestration.createDiagnostics(diagnosticsKey);

  const isNewRun = !run.parentRunId && !run.testRunId;
  if (isNewRun) {
    broadcastRunEvent("testRunStarted", { id: testRun.id, projectId });
  }

  try {
    await services.uploadOrchestration.importFromDirectory(
      {
        directoryPath,
        parentRunId: run.parentRunId,
        source,
        testRunId: testRun.id,
      },
      diagnostics,
    );
  } catch (error) {
    if (isNewRun) {
      try {
        const failed = await services.runs.failTestRun(testRun.id, projectId);
        broadcastRunEvent("testRunFinished", { id: failed.id, projectId });
      } catch (markError) {
        console.warn(
          `Failed to mark import run ${testRun.id} as failed:`,
          markError instanceof Error ? markError.message : String(markError),
        );
      }
    }

    throw error;
  } finally {
    if (cleanupDirectory) {
      try { rmSync(cleanupDirectory, { force: true, recursive: true }); } catch { /* cleanup is best effort */ }
    }
  }

  broadcastRunEvent("newTestResult", { id: testRun.id, projectId, testRun: { id: testRun.id, projectId } });

  if (run.parentRunId) {
    const finalRun = await services.runs.getTestRun(testRun.id, projectId);
    broadcastRunEvent("testRunUpdated", { id: finalRun.id, projectId });
    return finalRun;
  }

  const finished = await services.runs.completeTestRun(testRun.id, projectId);
  broadcastRunEvent("testRunFinished", { id: finished.id, projectId });
  return finished;
};

const createImportResponse = (
  request: Request,
  sourceKind: AllureImportSourceKind,
  testRun: Awaited<ReturnType<AppServices["runs"]["getTestRun"]>>,
  parentRunId?: string,
) =>
  ok(
    request,
    allureImportJobResultSchema.parse({
      job: {
        merged: Boolean(parentRunId),
        sourceKind,
        status: "completed",
      },
      message: parentRunId ? "Test results merged into existing run" : "Test results imported successfully",
      testRun: toContractRun(testRun),
    }),
  );

const parseImportForm = async (request: Request, defaultSourceKind?: AllureImportSourceKind) => {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > 110 * 1024 * 1024) {
    throw new HttpError(413, "IMPORT_TOO_LARGE", "Import request must not exceed 110 MiB");
  }
  const form = await request.formData();
  const files = form.getAll("file").filter((entry): entry is File => entry instanceof File);
  const projectId = optionalText(form.get("projectId"));

  const payload = validateContract(
    createAllureImportJobFormSchema,
    {
      branch: optionalText(form.get("branch")),
      commit: optionalText(form.get("commit")),
      environment: optionalText(form.get("environment")),
      parentRunId: optionalText(form.get("parentRunId")),
      project: optionalText(form.get("project")),
      runName: optionalText(form.get("runName")),
      sourceKind: optionalText(form.get("sourceKind")) ?? defaultSourceKind,
      tags: parseTags(optionalText(form.get("tags"))),
      testRunId: optionalText(form.get("testRunId")),
    },
    "IMPORT_VALIDATION",
    "Invalid import job payload",
  );

  const sourceKind =
    payload.sourceKind ?? (files.length === 1 ? (isZipFile(files[0]) ? "ci_archive" : "uploaded_file") : "uploaded_batch");
  if (files.length > 100) {
    throw new HttpError(413, "IMPORT_TOO_LARGE", "An import may contain at most 100 files");
  }
  if (files.reduce((total, file) => total + file.size, 0) > 100 * 1024 * 1024) {
    throw new HttpError(413, "IMPORT_TOO_LARGE", "Import files must not exceed 100 MiB in total");
  }
  return { files, payload: { ...payload, sourceKind }, projectId };
};

const attachmentResponseHeaders = (fileName: string, suppliedType?: string): Record<string, string> => {
  const safeInlineTypes = new Set(["application/json", "image/gif", "image/jpeg", "image/png", "image/webp", "text/plain", "video/mp4", "video/webm"]);
  const contentType = suppliedType?.trim().toLowerCase() || "application/octet-stream";
  const inline = safeInlineTypes.has(contentType);
  return {
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${fileName}"`,
    "Content-Type": inline ? contentType : "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
  };
};

const buildTraceAssetUrls = (request: Request, services: AppServices, runId: number, attachmentId: string, projectId: string, userId: string) => {
  const token = createTraceToken(services.config, runId, attachmentId, projectId, userId);
  const publicBaseUrl = resolvePublicBaseUrl(request, services.config);
  const traceAssetUrl = `${publicBaseUrl}/api/v1/public/traces/${encodeURIComponent(token)}`;

  return {
    isTrace: true,
    traceAssetUrl,
    traceTokenExpiresAt: new Date(Date.now() + services.config.traceTokenTtlSeconds * 1000).toISOString(),
    traceViewerUrl: `${publicBaseUrl}/playwright-trace-viewer/index.html?trace=${encodeURIComponent(traceAssetUrl)}`,
  };
};

const serveTraceAttachment = async (services: AppServices, request: Request, token: string) => {
  const payload = parseTraceToken(services.config, token);
  if (!payload) {
    throw new HttpError(401, "TRACE_TOKEN_INVALID", "Invalid or expired trace token");
  }
  const user = await requireUser(request, services);
  if (user.sub !== payload.userId) throw new HttpError(403, "TRACE_FORBIDDEN", "Trace token is not valid for this user");
  await requireProjectRole(services, user, payload.projectId);

  const attachment = await services.testResultsQuery.findAttachmentForRun(payload.runId, payload.attachmentId);
  if (!attachment) {
    throw new HttpError(404, "TRACE_NOT_FOUND", "Trace attachment not found");
  }
  if (!isTraceAttachment(attachment.name, attachment.type, attachment.source)) {
    throw new HttpError(403, "TRACE_FORBIDDEN", "Attachment is not a Playwright trace");
  }

  let buffer: Buffer | null = attachment.content ? toAttachmentBuffer(attachment.content) : null;
  if (!buffer && attachment.storageType === "minio" && attachment.storageBucket && attachment.objectKey) {
    buffer = await services.minio.getFile(attachment.storageBucket, attachment.objectKey);
  }
  if (!buffer) {
    throw new HttpError(404, "TRACE_CONTENT_NOT_FOUND", "Trace content not available");
  }

  const fileName = (attachment.source || attachment.name || `trace-${payload.attachmentId}.zip`).replace(/[\\/:*?"<>|]+/g, "_").trim();
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Cache-Control": "private, max-age=60",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Type": "application/zip",
      "X-Content-Type-Options": "nosniff",
    },
  });
};

export const registerRoutes = (
  app: Elysia,
  services: AppServices,
  extensions: ReadonlyArray<InitializedBackendExtension> = [],
) => {
  app.get("/healthz", () => ok({ runtime: "bun", service: "backend", status: "ok" }));

  app.get("/playwright-trace-viewer", () => Bun.file(join(services.config.backendPublicDir, "playwright-trace-viewer", "index.html")));
  app.get("/playwright-trace-viewer/:file", ({ params, set }) => {
    const filePath = join(services.config.backendPublicDir, "playwright-trace-viewer", basename(params.file));
    if (!existsSync(filePath)) {
      set.status = 404;
      return ok({ message: "Asset not found" });
    }

    return new Response(Bun.file(filePath), {
      headers: {
        "Content-Type": detectContentType(params.file),
      },
    });
  });
  app.get("/playwright-trace-viewer/assets/:file", ({ params, set }) => {
    const filePath = join(services.config.backendPublicDir, "playwright-trace-viewer", "assets", basename(params.file));
    if (!existsSync(filePath)) {
      set.status = 404;
      return ok({ message: "Asset not found" });
    }

    return new Response(Bun.file(filePath), {
      headers: {
        "Content-Type": detectContentType(params.file),
      },
    });
  });

  const legacyProjectIdFromRequest = (request: Request): string => {
    const url = new URL(request.url);
    return url.searchParams.get("projectId") || DEFAULT_PROJECT_ID;
  };

  const getLegacyRunResults = async ({ params, request, set }: { params: Record<string, string>; request: Request; set: { headers: Record<string, string | number> } }) => {
    markLegacyRoute(set, "/api/v1/projects/:projectId/runs/:runId/results");
    const rawRunId = params.runId ?? params.id;
    const { projectId, user } = await requireProjectContext(request, services, legacyProjectIdFromRequest(request));
    const numericRunId = parseRunId(rawRunId);
    await services.runs.getTestRun(rawRunId, projectId);
    return ok(
      request,
      await services.testResultsQuery.getResultsForRun(numericRunId, projectId, (attachment, traceRunId) => {
        if (!isTraceAttachment(attachment.name, attachment.type, attachment.source)) return null;
        return buildTraceAssetUrls(request, services, traceRunId, attachment.id, projectId, user.sub);
      }),
    );
  };

  const getLegacyRunAttachment = async ({ params, request, set }: { params: Record<string, string>; request: Request; set: { headers: Record<string, string | number> } }) => {
    markLegacyRoute(set, "/api/v1/projects/:projectId/runs/:runId/attachments/:attachmentId");
    const { projectId } = await requireProjectContext(request, services, legacyProjectIdFromRequest(request));
    const numericRunId = parseRunId(params.runId);
    await services.runs.getTestRun(params.runId, projectId);
    const attachment = await services.testResultsQuery.findAttachmentForRun(numericRunId, params.attachmentId);
    if (!attachment) throw new HttpError(404, "ATTACHMENT_NOT_FOUND", "Attachment not found");

    let payload: Buffer | null = attachment.content ? toAttachmentBuffer(attachment.content) : null;
    if (!payload && attachment.storageType === "minio" && attachment.storageBucket && attachment.objectKey) {
      payload = await services.minio.getFile(attachment.storageBucket, attachment.objectKey);
    }
    if (!payload) throw new HttpError(404, "ATTACHMENT_CONTENT_NOT_FOUND", "Attachment content not available");

    const fileName = (attachment.source || attachment.name || `attachment-${params.attachmentId}`)
      .replace(/[\\/:*?"<>|]+/g, "_")
      .trim();
    return new Response(new Uint8Array(payload), {
      headers: attachmentResponseHeaders(fileName, attachment.type),
    });
  };

  const importLegacyFiles = async (
    request: Request,
    set: { headers: Record<string, string | number> },
    sourceKind: "ci_archive" | "uploaded_batch" | "uploaded_file",
  ) => {
    markLegacyRoute(set, "/api/v1/projects/:projectId/imports/allure-jobs");
    const { files, payload, projectId: formProjectId } = await parseImportForm(request, sourceKind);
    const rawProjectId = formProjectId || (sourceKind === "ci_archive" ? payload.project : undefined) || legacyProjectIdFromRequest(request);
    const { projectId } = await requireProjectContext(request, services, rawProjectId, ["owner", "maintainer"]);

    if (sourceKind === "uploaded_file" && files.length !== 1) {
      throw new HttpError(400, "IMPORT_VALIDATION", "No file received in the request");
    }
    if (sourceKind === "uploaded_batch" && files.length === 0) {
      throw new HttpError(400, "IMPORT_VALIDATION", "No files uploaded");
    }
    if (sourceKind === "ci_archive" && (files.length !== 1 || !isZipFile(files[0]))) {
      throw new HttpError(400, "IMPORT_VALIDATION", "Uploaded file must be a ZIP file containing Allure results");
    }

    const uploadDir = createUploadDirectory(services.config);
    let importDir = uploadDir;
    if (sourceKind === "ci_archive") {
      const zipPath = await saveFormFile(files[0], uploadDir);
      importDir = extractZipAndResolveDir(zipPath, uploadDir);
    } else {
      await Promise.all(files.map((file) => saveFormFile(file, uploadDir)));
    }

    const testRun = await executeImportFromDirectory(services, {
      diagnosticsKey: `backend/legacy-root/${sourceKind}`,
      directoryPath: importDir,
      fallbackName: sourceKind === "ci_archive" ? "CI Run" : "Imported Run",
      projectId,
      run: payload,
      source: sourceKind === "ci_archive" ? "ci-zip" : sourceKind === "uploaded_batch" ? "upload-multiple" : "upload",
      cleanupDirectory: uploadDir,
    });

    return createImportResponse(request, sourceKind, testRun, payload.parentRunId);
  };

  const importLegacyDirectory = async (
    request: Request,
    set: { headers: Record<string, string | number> },
    diagnosticsKey: string,
    source: string,
  ) => {
    markLegacyRoute(set, "/api/v1/projects/:projectId/imports/allure-jobs");
    const rawBody = await request.json().catch(() => ({})) as Record<string, unknown>;
    const rawProjectId = typeof rawBody.projectId === "string" ? rawBody.projectId : legacyProjectIdFromRequest(request);
    const { projectId } = await requireProjectContext(request, services, rawProjectId, ["owner", "maintainer"]);
    const body = validateContract(
      createAllureImportJobRequestSchema,
      {
        run: {
          branch: typeof rawBody.branch === "string" ? rawBody.branch : undefined,
          environment: typeof rawBody.environment === "string" ? rawBody.environment : undefined,
          parentRunId: typeof rawBody.parentRunId === "string" ? rawBody.parentRunId : undefined,
          runName: typeof rawBody.runName === "string" ? rawBody.runName : undefined,
          tags: Array.isArray(rawBody.tags) ? rawBody.tags.map(String) : parseTags(typeof rawBody.tags === "string" ? rawBody.tags : undefined),
          testRunId:
            typeof rawBody.testRunId === "string" || typeof rawBody.testRunId === "number"
              ? rawBody.testRunId
              : undefined,
        },
        source: {
          directoryPath: typeof rawBody.directoryPath === "string" ? rawBody.directoryPath : undefined,
          kind: "directory_path",
        },
      },
      "IMPORT_VALIDATION",
      "Invalid import job payload",
    );

    if (body.source.kind !== "directory_path") {
      throw new HttpError(400, "IMPORT_VALIDATION", "Legacy path imports require a directory path");
    }
    const importDir = safeJoinWithinBase(services.config.importRoot, body.source.directoryPath);
    if (!existsSync(importDir) || !statSync(importDir).isDirectory()) {
      throw new HttpError(400, "IMPORT_VALIDATION", `Directory not found: ${body.source.directoryPath}`);
    }

    const testRun = await executeImportFromDirectory(services, {
      diagnosticsKey,
      directoryPath: importDir,
      fallbackName: "Imported Run",
      projectId,
      run: body.run,
      source,
    });
    return createImportResponse(request, "directory_path", testRun, body.run.parentRunId);
  };

  app.post("/auth/login", async ({ body, request, set }) => {
    markLegacyRoute(set, "/api/v1/auth/session");
    const payload = validateContract(
      loginRequestSchema,
      body && typeof body === "object" ? body : await request.json().catch(() => ({})),
      "AUTH_VALIDATION",
      "Email and password are required",
    );
    const result = await services.auth.login(payload.email, payload.password);
    set.headers["Set-Cookie"] = buildAuthCookie(result.accessToken, services.config);
    return ok(request, toSessionPayload(result.user));
  });
  app.post("/auth/logout", async ({ request, set }) => {
    markLegacyRoute(set, "/api/v1/auth/session");
    const user = await requireUser(request, services);
    await services.auth.revoke(user);
    set.headers["Set-Cookie"] = buildClearAuthCookie(services.config);
    return ok(request, { message: "Logged out successfully" });
  });
  app.get("/profile", ({ request }) => forwardLegacyRequest(app, request, "/api/v1/profile", "/api/v1/me"));
  app.put("/profile", ({ body, request }) => forwardLegacyRequest(app, request, "/api/v1/profile", "/api/v1/me", body));
  app.get("/profile/api-keys", ({ request }) => forwardLegacyRequest(app, request, "/api/v1/profile/api-keys", "/api/v1/me/api-keys"));
  app.post("/profile/api-keys", ({ body, request }) => forwardLegacyRequest(app, request, "/api/v1/profile/api-keys", "/api/v1/me/api-keys", body));
  app.delete("/profile/api-keys/:id", ({ params, request }) => forwardLegacyRequest(app, request, `/api/v1/profile/api-keys/${encodeURIComponent(params.id)}`, "/api/v1/me/api-keys/:id"));

  app.post("/upload/allure-results", ({ request, set }) => importLegacyFiles(request, set, "uploaded_file"));
  app.post("/upload/allure-results-multiple", ({ request, set }) => importLegacyFiles(request, set, "uploaded_batch"));
  app.post("/upload/ci/allure-results", ({ request, set }) => importLegacyFiles(request, set, "ci_archive"));
  app.post("/upload/allure-results-from-path", ({ request, set }) => importLegacyDirectory(request, set, "backend/legacy-root/upload-from-path", "from-path"));
  app.post("/allure-import/import", ({ request, set }) => importLegacyDirectory(request, set, "backend/legacy-root/allure-import", "allure-import"));

  app.get("/test-results/run/:runId", getLegacyRunResults);
  app.get("/test-results/run/:runId/attachments/:attachmentId", getLegacyRunAttachment);
  app.get("/test-results/traces/:token", ({ params, request }) => serveTraceAttachment(services, request, params.token));

  app.get("/settings/logo", ({ request }) => forwardLegacyRequest(app, request, "/api/v1/settings/branding/logo", "/api/v1/settings/branding/logo"));
  app.get("/settings/:key", ({ params, request }) => forwardLegacyRequest(app, request, `/api/v1/settings/${encodeURIComponent(params.key)}`, `/api/v1/settings/${params.key}`));
  app.post("/settings/:key", ({ body, params, request }) => forwardLegacyRequest(app, request, `/api/v1/settings/${encodeURIComponent(params.key)}`, `/api/v1/settings/${params.key}`, body));
  app.delete("/settings/:key", ({ params, request }) => forwardLegacyRequest(app, request, `/api/v1/settings/${encodeURIComponent(params.key)}`, `/api/v1/settings/${params.key}`));

  for (const provider of ["github", "gitlab", "bitbucket", "azure-devops", "generic"]) {
    app.post(`/webhooks/${provider}`, ({ body, request }) => forwardLegacyRequest(app, request, `/api/v1/webhooks/${provider}`, `/api/v1/webhooks/${provider}`, body));
  }

  app.get("/ai-analysis/capabilities", ({ request }) => forwardLegacyRequest(app, request, "/api/v1/ai/capabilities"));
  app.post("/ai-analysis/failures/analyze", ({ body, request }) => forwardLegacyRequest(app, request, "/api/v1/ai-analysis/failures/analyze", "/api/v1/ai/failure-analyses", body));
  app.get("/ai-analysis/failures/stored/:resultId", ({ params, request }) => forwardLegacyRequest(app, request, `/api/v1/ai-analysis/failures/stored/${encodeURIComponent(params.resultId)}`, "/api/v1/ai/failure-analyses/by-result/:resultId"));
  app.post("/ai-analysis/llm/test-connection", ({ body, request }) => forwardLegacyRequest(app, request, "/api/v1/ai/llm/test-connections", "/api/v1/ai/llm/test-connections", body));
  app.post("/ai-analysis/index/repositories", ({ body, request }) => forwardLegacyRequest(app, request, "/api/v1/ai/index-jobs", "/api/v1/ai/index-jobs", body));
  app.get("/ai-analysis/index/catalog", ({ request }) => forwardLegacyRequest(app, request, "/api/v1/ai/index-catalog"));
  app.post("/ai-analysis/retrieve/evidence", ({ body, request }) => forwardLegacyRequest(app, request, "/api/v1/ai/evidence-searches", "/api/v1/ai/evidence-searches", body));
  app.get("/ai-analysis/retrieve/diagnostics", ({ request }) => forwardLegacyRequest(app, request, "/api/v1/ai/retrieval-diagnostics"));
  app.post("/ai-analysis/retrieve/benchmark", ({ body, request }) => forwardLegacyRequest(app, request, "/api/v1/ai/retrieval-benchmarks", "/api/v1/ai/retrieval-benchmarks", body));
  app.get("/ai-analysis/connectors/types", ({ request }) => forwardLegacyRequest(app, request, "/api/v1/ai/connectors/types"));
  app.post("/ai-analysis/connectors/test", ({ body, request }) => forwardLegacyRequest(app, request, "/api/v1/ai/connectors/test-runs", "/api/v1/ai/connectors/test-runs", body));
  app.post("/ai-analysis/repositories/test-connection", ({ body, request }) => forwardLegacyRequest(app, request, "/api/v1/ai/repositories/test-connections", "/api/v1/ai/repositories/test-connections", body));

  app.get("/chat/conversations", ({ request }) => forwardLegacyRequest(app, request, "/api/v1/chat/conversations"));
  app.post("/chat/conversations", ({ body, request }) => forwardLegacyRequest(app, request, "/api/v1/chat/conversations", "/api/v1/chat/conversations", body));
  app.get("/chat/conversations/:id", ({ params, request }) => forwardLegacyRequest(app, request, `/api/v1/chat/conversations/${encodeURIComponent(params.id)}`));
  app.delete("/chat/conversations/:id", ({ params, request }) => forwardLegacyRequest(app, request, `/api/v1/chat/conversations/${encodeURIComponent(params.id)}`));
  app.get("/chat/conversations/:id/messages", ({ params, request }) => forwardLegacyRequest(app, request, `/api/v1/chat/conversations/${encodeURIComponent(params.id)}/messages`));
  app.post("/chat/conversations/:id/messages", ({ body, params, request }) => forwardLegacyRequest(app, request, `/api/v1/chat/conversations/${encodeURIComponent(params.id)}/messages`, `/api/v1/chat/conversations/${params.id}/messages`, body));
  app.post("/chat/conversations/:id/messages/stream", ({ body, params, request }) => forwardLegacyRequest(app, request, `/api/v1/chat/conversations/${encodeURIComponent(params.id)}/message-streams`, `/api/v1/chat/conversations/${params.id}/message-streams`, body));
  app.get("/mcp/sse", ({ request }) => forwardLegacyRequest(app, request, "/api/v1/mcp/sse"));
  app.post("/mcp/message", ({ body, request }) => forwardLegacyRequest(app, request, "/api/v1/mcp/messages", "/api/v1/mcp/messages", body));

  app.group("/api/v1", (api) => {
    api.group("/auth", (auth) => {
      const createSession = async ({ request, set }: { request: Request; set: { headers: Record<string, string> } }) => {
        const body = await readValidatedJsonBody(
          request,
          loginRequestSchema,
          "AUTH_VALIDATION",
          "Email and password are required",
        );
        const result = await services.auth.login(body.email, body.password);
        set.headers["Set-Cookie"] = buildAuthCookie(result.accessToken, services.config);
        return ok(request, toSessionPayload(result.user));
      };

      const destroySession = async ({ request, set }: { request: Request; set: { headers: Record<string, string> } }) => {
        const user = await requireUser(request, services);
        await services.auth.revoke(user);
        set.headers["Set-Cookie"] = buildClearAuthCookie(services.config);
        return ok(request, { message: "Logged out successfully" });
      };

      registerCompatibleRoute(auth, "post", "/session", createSession, [{ path: "/login" }]);
      auth.get("/session", async ({ request }) => {
        const user = await requireUser(request, services);
        return ok(request, toSessionPayload(user));
      });
      registerCompatibleRoute(auth, "delete", "/session", destroySession, [{ method: "post", path: "/logout" }]);

      return auth;
    });

    const getMe = async ({ request }: { request: Request }) => {
      const user = await requireUser(request, services);
      return ok(request, meProfileSchema.parse(toContractUser(user)));
    };

    const updateMe = async ({ request }: { request: Request }) => {
      const user = await requireUser(request, services);
      const body = await readValidatedJsonBody(
        request,
        updateMeProfileRequestSchema,
        "PROFILE_VALIDATION",
        "Invalid profile payload",
      );
      return ok(request, meProfileSchema.parse(await services.profile.updateProfile(user, body)));
    };

    const changeMePassword = async ({ request }: { request: Request }) => {
      const user = await requireUser(request, services);
      const body = await readValidatedJsonBody(
        request,
        changeMePasswordRequestSchema,
        "PROFILE_VALIDATION",
        "Invalid password payload",
      );
      return ok(request, await services.profile.changePassword(user, body));
    };

    const createApiKey = async ({ request }: { request: Request }) => {
      const user = await requireUser(request, services);
      const body = await readValidatedJsonBody(
        request,
        createApiKeyRequestSchema,
        "PROFILE_VALIDATION",
        "Invalid API key payload",
      );
      return ok(request, await services.profile.createApiKey(user, body));
    };

    const listApiKeys = async ({ request }: { request: Request }) => {
      const user = await requireUser(request, services);
      return ok(request, await services.profile.listApiKeys(user));
    };

    const deleteApiKey = async ({ request, params }: { params: Record<string, string>; request: Request }) => {
      const user = await requireUser(request, services);
      const { apiKeyId } = validateContract(apiKeyIdParamSchema, params, "PROFILE_VALIDATION", "Invalid API key id");
      return ok(request, await services.profile.deleteApiKey(user, apiKeyId));
    };

    registerCompatibleRoute(api, "get", "/me", getMe, [{ path: "/profile" }, { path: "/profile/" }]);
    registerCompatibleRoute(api, "post", "/me", updateMe, [{ method: "put", path: "/profile" }, { method: "put", path: "/profile/" }]);
    api.put("/me", updateMe);
    api.post("/me/password", changeMePassword);
    registerCompatibleRoute(api, "post", "/me/api-keys", createApiKey, [{ path: "/profile/api-keys" }]);
    registerCompatibleRoute(api, "get", "/me/api-keys", listApiKeys, [{ path: "/profile/api-keys" }]);
    registerCompatibleRoute(api, "delete", "/me/api-keys/:id", deleteApiKey, [{ path: "/profile/api-keys/:id" }]);

    api.group("/projects", (projects) => {
      projects.get("/contract", async ({ request }) => {
        await requireUser(request, services);
        return ok(
          request,
          projectContractSchema.parse({
            defaultProject: {
              canArchive: false,
              canDelete: false,
              id: DEFAULT_PROJECT_ID,
              isArchived: false,
            },
            lifecycle: ["active", "archived"],
            operations: ["list", "create", "update", "archive", "delete"],
          }),
        );
      });

      projects.get("/", async ({ request }) => {
        const user = await requireUser(request, services);
        const search = readValidatedSearch(
          request,
          projectsListSearchSchema,
          "PROJECT_VALIDATION",
          "Invalid projects query",
        );
        const projects = await services.projects.listProjects(search.includeArchived);
        if (user.role === "admin") return ok(request, projects);
        const accessible = await Promise.all(projects.map(async (project) =>
          (await services.projectAccess.hasProjectAccess(user.sub, project.id)) ? project : undefined,
        ));
        return ok(request, accessible.filter((project): project is NonNullable<typeof project> => Boolean(project)));
      });

      projects.post("/", async ({ request }) => {
        await requireAdmin(request);
        const body = await readValidatedJsonBody(
          request,
          createProjectRequestSchema,
          "PROJECT_VALIDATION",
          "Invalid project payload",
        );
        return ok(request, await services.projects.createProject(body));
      });

      projects.get("/access/users", async ({ request }) => {
        const user = await requireUser(request, services);
        if (user.role !== "admin") throw new HttpError(403, "ADMIN_REQUIRED", "Administrator access required");
        const search = readValidatedSearch(
          request,
          projectAccessSearchSchema,
          "PROJECT_VALIDATION",
          "Invalid project access query",
        );
        return ok(request, await services.projectAccess.listUserProjectAccess(search.userId));
      });

      projects.patch("/:projectId", async ({ params, request }) => {
        const user = await requireUser(request, services);
        const { projectId } = validateContract(
          projectIdParamSchema,
          params,
          "PROJECT_VALIDATION",
          "Invalid project id",
        );
        const body = await readValidatedJsonBody(
          request,
          updateProjectRequestSchema,
          "PROJECT_VALIDATION",
          "Invalid project payload",
        );
        await requireProjectRole(services, user, projectId, ["owner", "maintainer"]);
        return ok(request, await services.projects.updateProject(projectId, body));
      });

      projects.delete("/:projectId", async ({ params, request }) => {
        const user = await requireUser(request, services);
        const { projectId } = validateContract(
          projectIdParamSchema,
          params,
          "PROJECT_VALIDATION",
          "Invalid project id",
        );
        const search = readValidatedSearch(
          request,
          projectDeleteSearchSchema,
          "PROJECT_VALIDATION",
          "Invalid delete query",
        );
        const hardDelete = Boolean(search.hardDelete || search.permanent);
        await requireProjectRole(services, user, projectId, ["owner"]);
        const data = hardDelete
          ? await services.projects.deleteProjectPermanently(projectId)
          : await services.projects.archiveProject(projectId);
        return ok(request, data);
      });

      const listMembers = async ({ params, request }: { params: Record<string, string>; request: Request }) => {
        const { projectId } = await requireProjectContext(request, services, params.projectId);
        return ok(request, await services.projectAccess.listProjectMembers(projectId));
      };

      const assignMember = async ({ params, request }: { params: Record<string, string>; request: Request }) => {
        const { projectId, user } = await requireProjectContext(request, services, params.projectId, ["owner", "maintainer"]);
        const body = await readValidatedJsonBody(
          request,
          assignProjectMemberRequestSchema,
          "PROJECT_VALIDATION",
          "Invalid project member payload",
        );
        const existing = await services.projectAccess.getProjectMember(projectId, body.userId);
        if (body.projectRole === "owner" || existing?.projectRole === "owner") {
          await requireProjectRole(services, user, projectId, ["owner"]);
        }
        return ok(request, await services.projectAccess.assignProjectMember(projectId, body));
      };

      const removeMember = async ({ params, request }: { params: Record<string, string>; request: Request }) => {
        const { projectId, user } = await requireProjectContext(request, services, params.projectId, ["owner", "maintainer"]);
        const { userId } = validateContract(userIdParamSchema, params, "PROJECT_VALIDATION", "Invalid user id");
        const existing = await services.projectAccess.getProjectMember(projectId, userId);
        if (existing?.projectRole === "owner") await requireProjectRole(services, user, projectId, ["owner"]);
        return ok(request, await services.projectAccess.removeProjectMember(projectId, userId));
      };

      registerCompatibleRoute(projects, "get", "/:projectId/members", listMembers, [{ path: "/:projectId/memberships" }]);
      registerCompatibleRoute(projects, "post", "/:projectId/members", assignMember, [{ path: "/:projectId/memberships" }]);
      registerCompatibleRoute(projects, "delete", "/:projectId/members/:userId", removeMember, [
        { path: "/:projectId/memberships/:userId" },
      ]);

      const getDashboardMetrics = async ({ params, request }: { params: Record<string, string>; request: Request }) => {
        const { projectId, user } = await requireProjectContext(request, services, params.projectId);
        const search = readValidatedSearch(
          request,
          dashboardMetricsSearchSchema,
          "DASHBOARD_VALIDATION",
          "Invalid dashboard metrics query",
        );
        return ok(
          request,
          await services.dashboard.getDashboardMetrics(
            user.sub,
            projectId,
            {
              branch: search.branch,
              dateFrom: search.dateFrom,
              dateTo: search.dateTo,
              environment: search.environment,
              status: search.status,
              tags: normalizeTags(search.tags),
            },
            search.refresh,
          ),
        );
      };

      const getDashboardMeta = async ({ params, request }: { params: Record<string, string>; request: Request }) => {
        await requireProjectContext(request, services, params.projectId);
        return ok(request, services.dashboard.getDashboardMeta());
      };

      registerCompatibleRoute(projects, "get", "/:projectId/dashboard-metrics", getDashboardMetrics, [
        { path: "/:projectId/dashboard/metrics" },
      ]);
      registerCompatibleRoute(projects, "get", "/:projectId/dashboard-metrics/meta", getDashboardMeta, [
        { path: "/:projectId/dashboard/meta" },
      ]);

      projects.group("/:projectId/dashboards", (dashboards) => {
        dashboards.get("/", async ({ params, request }) => {
          const { projectId, user } = await requireProjectContext(request, services, params.projectId);
          return ok(request, await services.dashboard.getDashboards(user.sub, projectId));
        });

        dashboards.post("/", async ({ params, request }) => {
          const { projectId, user } = await requireProjectContext(request, services, params.projectId, ["owner", "maintainer"]);
          const body = await readValidatedJsonBody(
            request,
            createDashboardRequestSchema,
            "DASHBOARD_VALIDATION",
            "Invalid dashboard payload",
          );
          return ok(request, await services.dashboard.createDashboard(user.sub, projectId, body));
        });

        dashboards.put("/:dashboardId", async ({ params, request }) => {
          const { projectId, user } = await requireProjectContext(request, services, params.projectId, ["owner", "maintainer"]);
          const { dashboardId } = validateContract(
            dashboardIdParamSchema,
            params,
            "DASHBOARD_VALIDATION",
            "Invalid dashboard id",
          );
          const body = await readValidatedJsonBody(
            request,
            updateDashboardRequestSchema,
            "DASHBOARD_VALIDATION",
            "Invalid dashboard payload",
          );
          return ok(request, await services.dashboard.updateDashboard(user.sub, projectId, dashboardId, body));
        });

        dashboards.delete("/:dashboardId", async ({ params, request }) => {
          const { projectId, user } = await requireProjectContext(request, services, params.projectId, ["owner", "maintainer"]);
          const { dashboardId } = validateContract(
            dashboardIdParamSchema,
            params,
            "DASHBOARD_VALIDATION",
            "Invalid dashboard id",
          );
          return ok(request, await services.dashboard.deleteDashboard(user.sub, projectId, dashboardId));
        });

        return dashboards;
      });

      const getRunResults = async ({ params, request }: { params: Record<string, string>; request: Request }) => {
        const { projectId, user } = await requireProjectContext(request, services, params.projectId);
        const { runId } = validateContract(runIdParamSchema, params, "RUN_VALIDATION", "Invalid run id");
        const numericRunId = parseRunId(runId);
        await services.runs.getTestRun(runId, projectId);
        return ok(
          request,
          await services.testResultsQuery.getResultsForRun(numericRunId, projectId, (attachment, traceRunId) => {
            if (!isTraceAttachment(attachment.name, attachment.type, attachment.source)) {
              return null;
            }

            return buildTraceAssetUrls(request, services, traceRunId, attachment.id, projectId, user.sub);
          }),
        );
      };

      const getRunAttachment = async ({ params, request }: { params: Record<string, string>; request: Request }) => {
        const { projectId } = await requireProjectContext(request, services, params.projectId);
        const { runId } = validateContract(runIdParamSchema, params, "RUN_VALIDATION", "Invalid run id");
        const numericRunId = parseRunId(runId);
        await services.runs.getTestRun(runId, projectId);

        const attachment = await services.testResultsQuery.findAttachmentForRun(numericRunId, params.attachmentId);
        if (!attachment) {
          throw new HttpError(404, "ATTACHMENT_NOT_FOUND", "Attachment not found");
        }

        let payload: Buffer | null = attachment.content ? toAttachmentBuffer(attachment.content) : null;
        if (!payload && attachment.storageType === "minio" && attachment.storageBucket && attachment.objectKey) {
          payload = await services.minio.getFile(attachment.storageBucket, attachment.objectKey);
        }
        if (!payload) {
          throw new HttpError(404, "ATTACHMENT_CONTENT_NOT_FOUND", "Attachment content not available");
        }

        const fileName = (attachment.source || attachment.name || `attachment-${params.attachmentId}`)
          .replace(/[\\/:*?"<>|]+/g, "_")
          .trim();
        return new Response(new Uint8Array(payload), {
          headers: attachmentResponseHeaders(fileName, attachment.type),
        });
      };

      projects.group("/:projectId/runs", (runs) => {
        runs.get("/", async ({ params, request }) => {
          const { projectId } = await requireProjectContext(request, services, params.projectId);
          const search = readValidatedSearch(request, launchesListSearchSchema, "RUN_VALIDATION", "Invalid run query");
          const response = await services.runs.getTestRuns({
            dateFrom: search.dateFrom,
            dateTo: search.dateTo,
            limit: search.limit,
            page: search.page,
            projectId,
            search: search.search,
            sortBy: search.sortBy,
            sortOrder: search.sortOrder,
            status: search.status,
          });
          return ok(
            request,
            toContractRunsList(response),
          );
        });

        runs.post("/", async ({ params, request }) => {
          const { projectId } = await requireProjectContext(request, services, params.projectId, ["owner", "maintainer"]);
          const body = await readValidatedJsonBody(
            request,
            createRunRequestSchema,
            "RUN_VALIDATION",
            "Invalid run payload",
          );
          const run = await services.runs.createTestRun(body, projectId);
          broadcastRunEvent("testRunStarted", { id: run.id, projectId });
          return ok(request, toContractRun(run));
        });

        runs.get("/:runId/results", getRunResults);

        runs.get("/:runId/attachments/:attachmentId", getRunAttachment);

        runs.get("/:runId", async ({ params, request }) => {
          const { projectId } = await requireProjectContext(request, services, params.projectId);
          const { runId } = validateContract(runIdParamSchema, params, "RUN_VALIDATION", "Invalid run id");
          return ok(request, toContractRun(await services.runs.getTestRun(runId, projectId)));
        });

        runs.post("/:runId/complete", async ({ params, request }) => {
          const { projectId } = await requireProjectContext(request, services, params.projectId, ["owner", "maintainer"]);
          const { runId } = validateContract(runIdParamSchema, params, "RUN_VALIDATION", "Invalid run id");
          const run = await services.runs.completeTestRun(runId, projectId);
          broadcastRunEvent("testRunFinished", { id: run.id, projectId });
          return ok(request, toContractRun(run));
        });

        return runs;
      });

      projects.get("/:projectId/results/runs/:runId", ({ params, request, set }) => {
        markLegacyRoute(set, "/:projectId/runs/:runId/results");
        return getRunResults({ params, request });
      });

      projects.get("/:projectId/results/runs/:runId/attachments/:attachmentId", ({ params, request, set }) => {
        markLegacyRoute(set, "/:projectId/runs/:runId/attachments/:attachmentId");
        return getRunAttachment({ params, request });
      });

      projects.group("/:projectId/imports", (imports) => {
        imports.post("/allure-jobs", async ({ params, request }) => {
          const { projectId } = await requireProjectContext(request, services, params.projectId, ["owner", "maintainer"]);
          const contentType = request.headers.get("content-type") || "";

          if (contentType.includes("multipart/form-data")) {
            const { files, payload } = await parseImportForm(request);
            if (files.length === 0) {
              throw new HttpError(400, "IMPORT_VALIDATION", "No files uploaded");
            }

            if (payload.sourceKind === "ci_archive") {
              if (files.length !== 1 || !isZipFile(files[0])) {
                throw new HttpError(400, "IMPORT_VALIDATION", "A ci_archive import requires one ZIP file");
              }

              const uploadDir = createUploadDirectory(services.config);
              const zipPath = await saveFormFile(files[0], uploadDir);
              const importDir = extractZipAndResolveDir(zipPath, uploadDir);
              const testRun = await executeImportFromDirectory(services, {
                diagnosticsKey: "backend/imports/allure-jobs/ci-archive",
                directoryPath: importDir,
                fallbackName: "CI Run",
                projectId,
                run: payload,
                source: "ci-zip",
                cleanupDirectory: uploadDir,
              });
              return createImportResponse(request, payload.sourceKind, testRun, payload.parentRunId);
            }

            const uploadDir = createUploadDirectory(services.config);
            await Promise.all(files.map((file) => saveFormFile(file, uploadDir)));
            const testRun = await executeImportFromDirectory(services, {
              diagnosticsKey: `backend/imports/allure-jobs/${files.length > 1 ? "batch-files" : "files"}`,
              directoryPath: uploadDir,
              fallbackName: "Imported Run",
              projectId,
              run: payload,
              source: files.length > 1 ? "upload-multiple" : "upload",
              cleanupDirectory: uploadDir,
            });
            return createImportResponse(request, payload.sourceKind, testRun, payload.parentRunId);
          }

          const body = await readValidatedJsonBody(
            request,
            createAllureImportJobRequestSchema,
            "IMPORT_VALIDATION",
            "Invalid import job payload",
          );

          if (body.source.kind !== "directory_path") {
            throw new HttpError(
              400,
              "IMPORT_VALIDATION",
              "JSON import requests currently support only directory_path sources",
            );
          }

          const importDir = safeJoinWithinBase(services.config.importRoot, body.source.directoryPath);
          if (!existsSync(importDir) || !statSync(importDir).isDirectory()) {
            throw new HttpError(400, "IMPORT_VALIDATION", `Directory not found: ${body.source.directoryPath}`);
          }

          const testRun = await executeImportFromDirectory(services, {
            diagnosticsKey: "backend/imports/allure-jobs/directory-path",
            directoryPath: importDir,
            fallbackName: "Imported Run",
            projectId,
            run: body.run,
            source: "path",
          });

          return createImportResponse(request, body.source.kind, testRun, body.run.parentRunId);
        });

        imports.group("/allure", (legacyAllure) => {
          legacyAllure.post("/path", async ({ params, request, set }) => {
            markLegacyRoute(set, "/:projectId/imports/allure-jobs");
            const { projectId } = await requireProjectContext(request, services, params.projectId, ["owner", "maintainer"]);
            const rawBody = (await request.json()) as Record<string, unknown>;
            const body = validateContract(
              createAllureImportJobRequestSchema,
              {
                run: {
                  parentRunId: typeof rawBody.parentRunId === "string" ? rawBody.parentRunId : undefined,
                  runName: typeof rawBody.runName === "string" ? rawBody.runName : undefined,
                  testRunId:
                    typeof rawBody.testRunId === "string" || typeof rawBody.testRunId === "number"
                      ? rawBody.testRunId
                      : undefined,
                },
                source: {
                  directoryPath: typeof rawBody.directoryPath === "string" ? rawBody.directoryPath : undefined,
                  kind: "directory_path",
                },
              },
              "IMPORT_VALIDATION",
              "Invalid import job payload",
            );

            if (body.source.kind !== "directory_path") {
              throw new HttpError(400, "IMPORT_VALIDATION", "Legacy path imports require a directory path");
            }

            const importDir = safeJoinWithinBase(services.config.importRoot, body.source.directoryPath);
            if (!existsSync(importDir) || !statSync(importDir).isDirectory()) {
              throw new HttpError(400, "IMPORT_VALIDATION", `Directory not found: ${body.source.directoryPath}`);
            }

            const testRun = await executeImportFromDirectory(services, {
              diagnosticsKey: "backend/imports/path",
              directoryPath: importDir,
              fallbackName: "Imported Run",
              projectId,
              run: body.run,
              source: "path",
            });
            return createImportResponse(request, "directory_path", testRun, body.run.parentRunId);
          });

          legacyAllure.post("/files", async ({ params, request, set }) => {
            markLegacyRoute(set, "/:projectId/imports/allure-jobs");
            const { projectId } = await requireProjectContext(request, services, params.projectId, ["owner", "maintainer"]);
            const { files, payload } = await parseImportForm(request, "uploaded_file");
            if (files.length !== 1) {
              throw new HttpError(400, "IMPORT_VALIDATION", "No file received in the request");
            }

            const uploadDir = createUploadDirectory(services.config);
            await saveFormFile(files[0], uploadDir);
            const testRun = await executeImportFromDirectory(services, {
              diagnosticsKey: "backend/imports/files",
              directoryPath: uploadDir,
              fallbackName: "Imported Run",
              projectId,
              run: payload,
              source: "upload",
              cleanupDirectory: uploadDir,
            });
            return createImportResponse(request, "uploaded_file", testRun, payload.parentRunId);
          });

          legacyAllure.post("/batch-files", async ({ params, request, set }) => {
            markLegacyRoute(set, "/:projectId/imports/allure-jobs");
            const { projectId } = await requireProjectContext(request, services, params.projectId, ["owner", "maintainer"]);
            const { files, payload } = await parseImportForm(request, "uploaded_batch");
            if (files.length === 0) {
              throw new HttpError(400, "IMPORT_VALIDATION", "No files uploaded");
            }

            const uploadDir = createUploadDirectory(services.config);
            await Promise.all(files.map((file) => saveFormFile(file, uploadDir)));
            const testRun = await executeImportFromDirectory(services, {
              diagnosticsKey: "backend/imports/batch-files",
              directoryPath: uploadDir,
              fallbackName: "Imported Run",
              projectId,
              run: payload,
              source: "upload-multiple",
              cleanupDirectory: uploadDir,
            });
            return createImportResponse(request, "uploaded_batch", testRun, payload.parentRunId);
          });

          legacyAllure.post("/ci-zip", async ({ params, request, set }) => {
            markLegacyRoute(set, "/:projectId/imports/allure-jobs");
            const { projectId } = await requireProjectContext(request, services, params.projectId, ["owner", "maintainer"]);
            const { files, payload } = await parseImportForm(request, "ci_archive");
            if (files.length !== 1 || !isZipFile(files[0])) {
              throw new HttpError(400, "IMPORT_VALIDATION", "Uploaded file must be a ZIP file containing Allure results");
            }

            const uploadDir = createUploadDirectory(services.config);
            const zipPath = await saveFormFile(files[0], uploadDir);
            const importDir = extractZipAndResolveDir(zipPath, uploadDir);
            const testRun = await executeImportFromDirectory(services, {
              diagnosticsKey: "backend/imports/ci-zip",
              directoryPath: importDir,
              fallbackName: "CI Run",
              projectId,
              run: payload,
              source: "ci-zip",
              cleanupDirectory: uploadDir,
            });
            return createImportResponse(request, "ci_archive", testRun, payload.parentRunId);
          });

          return legacyAllure;
        });

        return imports;
      });

      return projects;
    });

    // â”€â”€â”€ Extra project-scoped routes (notifications, KB, coverage) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Added in a separate group call to avoid modifying the main projects group block.
    api.group("/projects", (projects) => {
      projects.get("/:projectId/notification-rules", async ({ request, params }) => {
        const user = await requireUser(request, services);
        await requireProjectRole(services, user, params.projectId);
        const resolvedId = await services.projects.resolveProjectId(params.projectId);
        const rules = await services.notifications.getRulesRaw(resolvedId);
        return ok(request, rules ?? {});
      });

      projects.put("/:projectId/notification-rules", async ({ request, params }) => {
        const user = await requireUser(request, services);
        await requireProjectRole(services, user, params.projectId, ["owner", "maintainer"]);
        const resolvedId = await services.projects.resolveProjectId(params.projectId);
        const body = await request.json();
        await services.notifications.setRulesRaw(resolvedId, body);
        return ok(request, body);
      });

      projects.post("/:projectId/notification-rules/test-delivery", async ({ request, params }) => {
        const user = await requireUser(request, services);
        await requireProjectRole(services, user, params.projectId, ["owner", "maintainer"]);
        const resolvedId = await services.projects.resolveProjectId(params.projectId);
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        const destinationId = typeof body.destinationId === "string" ? body.destinationId : undefined;
        return ok(request, await services.notifications.dispatchTestDelivery(resolvedId, destinationId));
      });

      projects.post("/:projectId/runs/:runId/rerun", async ({ request, params }) => {
        const user = await requireUser(request, services);
        await requireProjectRole(services, user, params.projectId, ["owner", "maintainer"]);
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        const selectors = Array.isArray(body.selectors) ? body.selectors as Array<Record<string, unknown>> : [];
        const response = await services.reruns.createJob({
          parentRunId: params.runId,
          body: {
            selectors: selectors.map((s) => ({
              kind: String(s.kind ?? "testName") as "allureId" | "frameworkId" | "historyId" | "testName",
              value: String(s.value ?? ""),
              ...(typeof s.testResultId === "string" ? { testResultId: s.testResultId } : {}),
            })),
            ...(typeof body.selectionMode === "string" ? { selectionMode: body.selectionMode as "failed_or_broken" | "selected" | "single" } : {}),
            ...(typeof body.framework === "string" ? { framework: body.framework as "junit" | "playwright" | "testng" } : {}),
            ...(typeof body.executionProfileId === "string" ? { executionProfileId: body.executionProfileId } : {}),
            ...(typeof body.triggerMode === "string" ? { triggerMode: body.triggerMode as "full_pipeline" | "tests_only" } : {}),
            ...(body.metadata && typeof body.metadata === "object" ? { metadata: body.metadata as Record<string, unknown> } : {}),
          },
          requestedByUserId: String(user.sub),
          projectId: params.projectId,
        });
        return ok(request, response);
      });

      projects.get("/:projectId/reruns/:rerunJobId", async ({ request, params }) => {
        const user = await requireUser(request, services);
        await requireProjectRole(services, user, params.projectId);
        return ok(request, await services.reruns.getJob(params.rerunJobId, params.projectId));
      });

      projects.post("/:projectId/reruns/:rerunJobId/cancel", async ({ request, params }) => {
        const user = await requireUser(request, services);
        await requireProjectRole(services, user, params.projectId, ["owner", "maintainer"]);
        return ok(request, await services.reruns.cancelJob(params.rerunJobId, params.projectId, String(user.sub)));
      });

      projects.post("/:projectId/reruns/:rerunJobId/status", async ({ request, params }) => {
        const user = await requireUser(request, services);
        await requireProjectRole(services, user, params.projectId, ["owner", "maintainer"]);
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        const status = String(body.status ?? "") as "canceled" | "completed" | "failed" | "queued" | "running";
        if (!["canceled", "completed", "failed", "queued", "running"].includes(status)) {
          throw new HttpError(400, "RERUN_VALIDATION", "status is required and must be a valid rerun status");
        }
        return ok(request, await services.reruns.updateJobStatus(params.rerunJobId, {
          status,
          ...(typeof body.message === "string" ? { message: body.message } : {}),
          ...(typeof body.childRunId === "number" ? { childRunId: body.childRunId } : {}),
          ...(body.meta && typeof body.meta === "object" ? { meta: body.meta as Record<string, unknown> } : {}),
        }, params.projectId));
      });

      projects.get("/:projectId/notification-deliveries", async ({ request, params }) => {
        const user = await requireUser(request, services);
        await requireProjectRole(services, user, params.projectId);
        const resolvedId = await services.projects.resolveProjectId(params.projectId);
        const url = new URL(request.url);
        const history = await services.notifications.listHistory(resolvedId, {
          limit: Number(url.searchParams.get("limit") ?? "50") || 50,
          status: url.searchParams.get("status") ?? undefined,
          runId: url.searchParams.get("runId") ?? undefined,
        });
        return ok(request, history);
      });

      // Temporary coverage compatibility forwarders for legacy route clients.
      projects.get("/:projectId/test-coverage/summary", async ({ request, params }) => {
        return forwardLegacyRequest(app, request, `/api/v1/ai-analysis/coverage/${encodeURIComponent(params.projectId)}/summary`);
      });

      projects.post("/:projectId/test-coverage/recommendation-jobs", async ({ request, params }) => {
        return forwardLegacyRequest(app, request, `/api/v1/ai-analysis/coverage/${encodeURIComponent(params.projectId)}/recommendation-jobs`);
      });

      return projects;
    });

    // â”€â”€â”€ Settings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    const requireAdmin = async (request: Request) => {
      const user = await requireUser(request, services);
      if (user.role !== "admin") {
        throw new HttpError(403, "ADMIN_REQUIRED", "Administrator access required");
      }
      return user;
    };

    const isSensitiveSettingKey = (key: string): boolean =>
      ["aiAnalysisLicense", "aiAnalysisRepositories", "aiEvidenceConnectors", "aiLlmConnection", "testRerunProfiles", "webhookSecrets", "notification:rules", "notification:destinations"].includes(key)
      || /(?:api[_-]?key|auth[_-]?token|password|secret)/i.test(key);

    const assertExternalSettingKey = (key: string) => {
      if (["aiLicenseInstallationId", "aiLicenseInstallationPrivateKey", "aiLicenseInstallationCreatedAt"].includes(key)) {
        throw new HttpError(403, "INTERNAL_SETTING", "This setting is managed internally.");
      }
    };

    api.group("/settings", (settings) => {
      settings.get("/branding/logo", async ({ request }) => {
        await requireUser(request, services);
        const value = await services.settings.get("logo");
        return ok(request, { value: value ?? null });
      });

      settings.put("/branding/logo", async ({ request }) => {
        await requireAdmin(request);
        const body = await request.json() as Record<string, unknown>;
        const value = typeof body.value === "string" ? body.value : null;
        if (value !== null) await services.settings.set("logo", value);
        else await services.settings.delete("logo");
        return ok(request, { value });
      });

      settings.get("/:key", async ({ request, params }) => {
        assertExternalSettingKey(params.key);
        const user = await requireUser(request, services);
        if (isSensitiveSettingKey(params.key) && user.role !== "admin") {
          throw new HttpError(403, "ADMIN_REQUIRED", "Administrator access required for sensitive settings");
        }
        const url = new URL(request.url);
        const projectId = url.searchParams.get("projectId") ?? undefined;
        if (projectId) await requireProjectRole(services, user, projectId);
        else if (user.role !== "admin") throw new HttpError(403, "ADMIN_REQUIRED", "Administrator access required");
        const value = await services.settings.get(params.key, projectId);
        if (value === null) throw new HttpError(404, "SETTING_NOT_FOUND", "Setting not found");
        let parsed: unknown = value;
        try { parsed = JSON.parse(value); } catch { /* not JSON, return raw string */ }
        return ok(request, { key: params.key, value: parsed });
      });

      settings.post("/:key", async ({ request, params }) => {
        assertExternalSettingKey(params.key);
        const user = await requireUser(request, services);
        if (isSensitiveSettingKey(params.key) && user.role !== "admin") {
          throw new HttpError(403, "ADMIN_REQUIRED", "Administrator access required for sensitive settings");
        }
        const url = new URL(request.url);
        const projectId = url.searchParams.get("projectId") ?? undefined;
        if (projectId) await requireProjectRole(services, user, projectId, ["owner", "maintainer"]);
        else if (user.role !== "admin") throw new HttpError(403, "ADMIN_REQUIRED", "Administrator access required");
        const body = await request.json() as Record<string, unknown>;
        const raw = typeof body.value === "string" ? body.value : JSON.stringify(body.value);
        await services.settings.set(params.key, raw, projectId);
        return ok(request, { key: params.key });
      });

      settings.put("/:key", async ({ request, params }) => {
        assertExternalSettingKey(params.key);
        const user = await requireUser(request, services);
        if (isSensitiveSettingKey(params.key) && user.role !== "admin") {
          throw new HttpError(403, "ADMIN_REQUIRED", "Administrator access required for sensitive settings");
        }
        const url = new URL(request.url);
        const projectId = url.searchParams.get("projectId") ?? undefined;
        if (projectId) await requireProjectRole(services, user, projectId, ["owner", "maintainer"]);
        else if (user.role !== "admin") throw new HttpError(403, "ADMIN_REQUIRED", "Administrator access required");
        const body = await request.json() as Record<string, unknown>;
        const raw = typeof body.value === "string" ? body.value : JSON.stringify(body.value);
        await services.settings.set(params.key, raw, projectId);
        return ok(request, { key: params.key });
      });

      settings.delete("/:key", async ({ request, params }) => {
        assertExternalSettingKey(params.key);
        await requireAdmin(request);
        const url = new URL(request.url);
        const projectId = url.searchParams.get("projectId") ?? undefined;
        await services.settings.delete(params.key, projectId);
        return new Response(null, { status: 204 });
      });

      return settings;
    });

    api.group("/platform-update", (updates) => {
      updates.get("/status", async ({ request }) => {
        await requireAdmin(request);
        return ok(request, await services.platformUpdate.getStatus());
      });

      updates.post("/jobs", async ({ request }) => {
        const actor = await requireAdmin(request);
        return ok(request, await services.platformUpdate.requestUpdate(actor));
      });

      return updates;
    });

    // â”€â”€â”€ Users â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    api.group("/users", (users) => {
      users.get("/", async ({ request }) => {
        await requireAdmin(request);
        const list = await services.users.list();
        return ok(request, list.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role })));
      });

      users.post("/", async ({ request }) => {
        await requireAdmin(request);
        const body = await request.json() as Record<string, unknown>;
        if (typeof body.email !== "string" || typeof body.password !== "string") {
          throw new HttpError(400, "USER_VALIDATION", "email and password are required");
        }
        assertEmailAddress(body.email);
        assertPasswordPolicy(body.password);
        if (body.role !== undefined && body.role !== "admin" && body.role !== "user" && body.role !== "kb_viewer") {
          throw new HttpError(400, "USER_VALIDATION", "Invalid user role");
        }
        const user = await services.users.create({
          name: typeof body.name === "string" ? body.name : body.email,
          email: body.email,
          password: body.password,
          role: typeof body.role === "string" ? body.role : "user",
        });
        return ok(request, { id: user.id, name: user.name, email: user.email, role: user.role });
      });

      users.put("/:id", async ({ request, params }) => {
        await requireAdmin(request);
        const id = Number.parseInt(params.id, 10);
        if (!Number.isInteger(id)) throw new HttpError(400, "USER_VALIDATION", "Invalid user id");
        const body = await request.json() as Record<string, unknown>;
        if (typeof body.email === "string") assertEmailAddress(body.email);
        if (typeof body.password === "string") assertPasswordPolicy(body.password);
        if (body.role !== undefined && body.role !== "admin" && body.role !== "user" && body.role !== "kb_viewer") {
          throw new HttpError(400, "USER_VALIDATION", "Invalid user role");
        }
        const user = await services.users.update(id, {
          name: typeof body.name === "string" ? body.name : undefined,
          email: typeof body.email === "string" ? body.email : undefined,
          password: typeof body.password === "string" ? body.password : undefined,
          role: typeof body.role === "string" ? body.role : undefined,
        });
        return ok(request, { id: user.id, name: user.name, email: user.email, role: user.role });
      });

      users.delete("/:id", async ({ request, params }) => {
        await requireAdmin(request);
        const id = Number.parseInt(params.id, 10);
        if (!Number.isInteger(id)) throw new HttpError(400, "USER_VALIDATION", "Invalid user id");
        await services.users.remove(id);
        return new Response(null, { status: 204 });
      });

      return users;
    });

    // â”€â”€â”€ Notifications â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    api.get("/notifications/contract", async ({ request }) => {
      await requireUser(request, services);
      return ok(request, await services.notifications.getContract());
    });

    api.group("/edition", (edition) => {
      edition.get("/", async ({ request }) => {
        await requireUser(request, services);
        return ok(request, await services.entitlements.snapshot());
      });

      edition.get("/extensions", async ({ request }) => {
        await requireUser(request, services);
        return ok(request, await getBackendExtensionStatuses(extensions));
      });

      edition.post("/license-activations", async ({ request }) => {
        await requireAdmin(request);
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        const result = await services.entitlements.activate(body);
        if (!result.success) throw new HttpError(400, "LICENSE_INVALID", result.message);
        return ok(request, result);
      });

      edition.get("/license-activation-request", async ({ request }) => {
        await requireAdmin(request);
        return ok(request, await services.entitlements.getActivationRequest());
      });

      return edition;
    });

    // per-project notification routes are added inside the /projects/:projectId group below

    // â”€â”€â”€ Webhooks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    // â”€â”€â”€ AI capabilities â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    api.group("/ai", (ai) => {
      ai.get("/capabilities", async ({ request }) => {
        await requireUser(request, services);
        return ok(request, await services.aiEdition.getCapabilities());
      });

      // Temporary legacy forwarders. They preserve supported payloads while
      // callers migrate to the Enterprise extension namespace.
      ai.get("/failure-analyses/by-result/:resultId", async ({ request, params }) => {
        return forwardLegacyRequest(app, request, `/api/v1/ai-analysis/failures/stored/${encodeURIComponent(params.resultId)}`);
      });

      ai.post("/failure-analyses", async ({ request }) => {
        return forwardLegacyRequest(app, request, "/api/v1/ai-analysis/failures/analyze");
      });

      ai.post("/license-activations", async ({ request }) => {
        await requireAdmin(request);
        const body = await request.json().catch(() => ({})) as unknown;
        const result = await services.aiEdition.activateLicense(body);
        if (!result.success) throw new HttpError(400, "LICENSE_INVALID", result.message);
        return ok(request, result);
      });

      ai.get("/license-activation-request", async ({ request }) => {
        await requireAdmin(request);
        return ok(request, await services.aiEdition.getLicenseActivationRequest());
      });

      ai.get("/auto-index/status", async ({ request }) => {
        return forwardLegacyRequest(app, request, "/api/v1/ai-analysis/auto-index/status");
      });

      ai.post("/auto-index/jobs", async ({ request }) => {
        return forwardLegacyRequest(app, request, "/api/v1/ai-analysis/auto-index/jobs");
      });

      return ai;
    });

    // â”€â”€â”€ Chat conversations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    api.group("/chat", (chat) => {
      chat.get("/conversations", async ({ request }) => {
        const user = await requireUser(request, services);
        const list = await services.chat.listConversations(Number(user.sub));
        return ok(request, list);
      });

      chat.post("/conversations", async ({ request }) => {
        const user = await requireUser(request, services);
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        const projectId = typeof body.projectId === "number" ? body.projectId : undefined;
        const conv = await services.chat.createConversation(Number(user.sub), projectId);
        return ok(request, conv);
      });

      chat.get("/conversations/:id", async ({ request, params }) => {
        const user = await requireUser(request, services);
        const conv = await services.chat.getConversation(Number(params.id), Number(user.sub));
        if (!conv) throw new HttpError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
        return ok(request, conv);
      });

      chat.delete("/conversations/:id", async ({ request, params }) => {
        const user = await requireUser(request, services);
        await services.chat.deleteConversation(Number(params.id), Number(user.sub));
        return new Response(null, { status: 204 });
      });

      chat.put("/conversations/:id/title", async ({ request, params }) => {
        const user = await requireUser(request, services);
        const body = await request.json() as Record<string, unknown>;
        if (typeof body.title !== "string") throw new HttpError(400, "CHAT_VALIDATION", "title is required");
        const conv = await services.chat.updateTitle(Number(params.id), Number(user.sub), body.title);
        return ok(request, conv);
      });

      chat.get("/conversations/:id/messages", async ({ request, params }) => {
        const user = await requireUser(request, services);
        const msgs = await services.chat.getMessages(Number(params.id), Number(user.sub));
        return ok(request, msgs);
      });

      chat.post("/conversations/:id/messages", async ({ request, params }) => {
        const user = await requireUser(request, services);
        const body = await request.json() as Record<string, unknown>;
        if (typeof body.content !== "string") throw new HttpError(400, "CHAT_VALIDATION", "content is required");
        const role = typeof body.role === "string" ? body.role : "user";
        const msg = await services.chat.addMessage(Number(params.id), Number(user.sub), role, body.content);
        return ok(request, msg);
      });

      chat.post("/conversations/:id/message-streams", async ({ request, params }) => {
        const user = await requireUser(request, services);
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        if (typeof body.content !== "string" || body.content.trim().length === 0) {
          throw new HttpError(400, "CHAT_VALIDATION", "content is required");
        }

        // Validate before opening the SSE stream so auth/404 surface as clean JSON.
        await services.chat.validateStreamAccess(Number(params.id), Number(user.sub));

        const conversationId = Number(params.id);
        const userId = Number(user.sub);
        const content = body.content;
        const { chat: chatSvc, llm } = services;

        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const encoder = new TextEncoder();
            const send = (event: Record<string, unknown>) => {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            };
            try {
              for await (const event of chatSvc.streamMessage(conversationId, userId, content, llm)) {
                send(event);
              }
            } catch (error) {
              send({ type: "error", message: error instanceof Error ? error.message : String(error) });
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
          },
        });
      });

      chat.delete("/messages/:messageId", async ({ request, params }) => {
        const user = await requireUser(request, services);
        await services.chat.deleteMessage(Number(params.messageId), Number(user.sub));
        return new Response(null, { status: 204 });
      });

      return chat;
    });

    // â”€â”€â”€ MCP (Model Context Protocol) â€” JSON-RPC over HTTP+SSE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    api.group("/mcp", (mcp) => {
      mcp.get("/sse", async ({ request }) => {
        const user = await requireUser(request, services);
        if (user.role === "kb_viewer") throw new HttpError(403, "MCP_FORBIDDEN", "MCP is not available to knowledge-base viewers");
        const sessionId = randomUUID();
        const encoder = new TextEncoder();
        const { mcp: mcpSvc } = services;

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const send = (event: string, data: unknown) => {
              controller.enqueue(encoder.encode(`event: ${event}\ndata: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`));
            };
            mcpSvc.registerSession(sessionId, {
              send,
              close: () => {
                try { controller.close(); } catch { /* already closed */ }
              },
            });
            // Endpoint event per MCP HTTP+SSE spec
            send("endpoint", `/api/v1/mcp/messages?sessionId=${sessionId}`);

            const heartbeat = setInterval(() => {
              try { controller.enqueue(encoder.encode(": heartbeat\n\n")); } catch { clearInterval(heartbeat); }
            }, 30_000);

            request.signal.addEventListener("abort", () => {
              clearInterval(heartbeat);
              mcpSvc.unregisterSession(sessionId);
              try { controller.close(); } catch { /* already closed */ }
            });
          },
          cancel() {
            mcpSvc.unregisterSession(sessionId);
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
          },
        });
      });

      mcp.post("/messages", async ({ request }) => {
        const user = await requireUser(request, services);
        if (user.role === "kb_viewer") throw new HttpError(403, "MCP_FORBIDDEN", "MCP is not available to knowledge-base viewers");
        const projectId = await requireProjectRole(services, user, new URL(request.url).searchParams.get("projectId") ?? DEFAULT_PROJECT_ID);
        const body = await request.json().catch(() => ({})) as unknown;
        const response = await services.mcp.handleRequest(body, projectId);

        const url = new URL(request.url);
        const sessionId = url.searchParams.get("sessionId");
        if (sessionId) {
          const session = services.mcp.getSession(sessionId);
          if (session) session.send("message", response);
        }

        return ok(request, response);
      });

      return mcp;
    });

    // â”€â”€â”€ /public/traces â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    registerCompatibleRoute(
      api,
      "get",
      "/public/traces/:token",
      ({ params, request }: { params: Record<string, string>; request: Request }) => serveTraceAttachment(services, request, params.token),
      [{ path: "/results/traces/:token" }, { path: "/test-results/traces/:token" }],
    );

    return api;
  });

  return app;
};
