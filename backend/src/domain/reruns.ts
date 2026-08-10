import type { Repository } from "typeorm";

import { HttpError } from "../errors";
import { assertSafeOutboundUrl } from "../outbound";
import { TestRun } from "../entities/test-run.entity";
import {
  TestRerunJob,
  type TestRerunExecutionMode,
  type TestRerunFramework,
  type TestRerunJobStatus,
  type TestRerunSelectionMode,
  type TestRerunSelectorContract,
  type TestRerunSelectorKind,
  type TestRerunTriggerMode,
} from "../entities/test-rerun-job.entity";
import { TestRerunJobItem } from "../entities/test-rerun-job-item.entity";

export interface TestRerunExecutionProfile {
  id: string;
  name: string;
  framework: TestRerunFramework;
  executionMode: TestRerunExecutionMode;
  triggerMode: TestRerunTriggerMode;
  commandTemplate: string;
  ciTriggerUrl?: string;
  ciHeaders?: Record<string, string>;
  callbackSecret?: string;
  enabled: boolean;
}

export interface TestRerunSettings {
  projectId: string;
  singleFrameworkPerProject: true;
  activeProfileId?: string;
  profiles: TestRerunExecutionProfile[];
}

export interface CreateTestRerunJobInput {
  selectionMode?: TestRerunSelectionMode;
  selectors: Array<{ kind: TestRerunSelectorKind; value: string; testResultId?: string }>;
  framework?: TestRerunFramework;
  executionProfileId?: string;
  triggerMode?: TestRerunTriggerMode;
  metadata?: Record<string, unknown>;
}

export interface UpdateTestRerunJobStatusInput {
  status: TestRerunJobStatus;
  message?: string;
  childRunId?: number;
  meta?: Record<string, unknown>;
}

export interface TestRerunJobResponse {
  jobId: string;
  parentRunId: number;
  childRunId?: number;
  projectId: string;
  status: TestRerunJobStatus;
  framework: TestRerunFramework;
  executionMode: TestRerunExecutionMode;
  selectionMode: TestRerunSelectionMode;
  selectors: TestRerunSelectorContract[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  message?: string;
}

const RERUN_PROFILES_KEY = "testRerunProfiles";

const ACTIVE_JOB_STATUSES: TestRerunJobStatus[] = ["queued", "running"];
const TERMINAL_JOB_STATUSES: TestRerunJobStatus[] = ["canceled", "completed", "failed"];
const ALLOWED_STATUS_TRANSITIONS: Record<TestRerunJobStatus, TestRerunJobStatus[]> = {
  queued: ["canceled", "failed", "running"],
  running: ["canceled", "completed", "failed"],
  completed: [],
  failed: [],
  canceled: [],
};

const FRAMEWORKS: TestRerunFramework[] = ["junit", "playwright", "testng"];
const EXECUTION_MODES: TestRerunExecutionMode[] = ["agent", "ci-webhook"];
const TRIGGER_MODES: TestRerunTriggerMode[] = ["full_pipeline", "tests_only"];
const SELECTOR_KINDS: TestRerunSelectorKind[] = ["allureId", "frameworkId", "historyId", "testName"];

export interface RerunSettingsStore {
  get(key: string, projectId?: string): Promise<null | string>;
  set(key: string, value: string, projectId?: string): Promise<void>;
}

export interface RerunProjectResolver {
  resolveProjectId(projectId?: string): Promise<string>;
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeSelectors = (
  selectors: Array<{ kind: TestRerunSelectorKind; value: string; testResultId?: string }>,
): TestRerunSelectorContract[] =>
  selectors
    .map((selector) => ({
      kind: selector.kind,
      value: String(selector.value ?? "").trim(),
      ...(selector.testResultId ? { testResultId: selector.testResultId } : {}),
    }))
    .filter((selector) => selector.value.length > 0);

const mapSelectorsToCommandArgs = (
  framework: TestRerunFramework,
  selectors: TestRerunSelectorContract[],
): { args: string[]; selectorExpression: string } => {
  if (selectors.length === 0) return { args: [], selectorExpression: "" };

  if (framework === "playwright") {
    const tokens = selectors.map((selector) => escapeRegex(selector.value));
    const selectorExpression = tokens.join("|");
    return { args: ["--grep", selectorExpression], selectorExpression };
  }

  const normalizeJava = (selector: TestRerunSelectorContract) => {
    const value = selector.value.trim();
    if (selector.kind === "testName") return value.replace(/\s+/g, "");
    return value;
  };
  const selectorExpression = selectors.map(normalizeJava).join(",");
  return { args: [`-Dtest=${selectorExpression}`], selectorExpression };
};

const renderTemplate = (template: string, args: string[], selectorExpression: string): string => {
  const fallback = template.trim().length > 0 ? template.trim() : 'npx playwright test --grep "{{selectorExpression}}"';
  return fallback
    .replace(/\{\{selectorExpression\}\}/g, selectorExpression)
    .replace(/\{\{selectorArgs\}\}/g, args.join(" "))
    .trim();
};

export interface DispatchResult {
  accepted: boolean;
  status: "failed" | "queued" | "running";
  externalRunId?: string;
  renderedCommand: string;
  message?: string;
  responseBody?: unknown;
}

const postJson = async (url: string, allowedHosts: string[], body: unknown, headers: Record<string, string> = {}, timeoutMs = 10_000): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const safeUrl = (await assertSafeOutboundUrl(url, allowedHosts)).toString();
    return await fetch(safeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      redirect: "error",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

const dispatchCiWebhook = async (
  profile: TestRerunExecutionProfile,
  projectId: string,
  parentRunId: number,
  selectors: TestRerunSelectorContract[],
  renderedCommand: string,
  args: string[],
  allowedHosts: string[],
): Promise<DispatchResult> => {
  const triggerUrl = String(profile.ciTriggerUrl ?? "").trim();
  if (!triggerUrl) {
    return {
      accepted: false,
      status: "queued",
      renderedCommand,
      message: "Execution profile uses ci-webhook mode but ciTriggerUrl is not configured.",
    };
  }

  try {
    const response = await postJson(triggerUrl, allowedHosts, {
      projectId,
      parentRunId,
      executionProfileId: profile.id,
      framework: profile.framework,
      triggerMode: profile.triggerMode,
      command: renderedCommand,
      commandArgs: args,
      selectors,
    }, profile.ciHeaders ?? {});

    const body = await response.json().catch(() => ({})) as { externalRunId?: unknown };
    if (!response.ok) {
      return { accepted: false, status: "failed", renderedCommand, message: `CI webhook returned HTTP ${response.status}`, responseBody: body };
    }
    const externalRunId = typeof body.externalRunId === "string" ? body.externalRunId : undefined;
    return { accepted: true, status: "running", externalRunId, renderedCommand, responseBody: body };
  } catch (error) {
    return {
      accepted: false,
      status: "failed",
      renderedCommand,
      message: error instanceof Error ? error.message : "CI webhook dispatch failed",
    };
  }
};

const dispatchAgent = async (
  profile: TestRerunExecutionProfile,
  projectId: string,
  parentRunId: number,
  selectors: TestRerunSelectorContract[],
  renderedCommand: string,
  args: string[],
  allowedHosts: string[],
): Promise<DispatchResult> => {
  const endpoint = String(process.env.TEST_RERUN_AGENT_ENDPOINT ?? "").trim();
  if (!endpoint) {
    return {
      accepted: false,
      status: "queued",
      renderedCommand,
      message: "Agent endpoint is not configured (TEST_RERUN_AGENT_ENDPOINT).",
    };
  }

  try {
    const response = await postJson(endpoint, allowedHosts, {
      projectId,
      parentRunId,
      executionProfileId: profile.id,
      framework: profile.framework,
      command: renderedCommand,
      args,
      selectors,
    });
    const body = await response.json().catch(() => ({})) as { externalRunId?: unknown };
    if (!response.ok) {
      return { accepted: false, status: "failed", renderedCommand, message: `Agent returned HTTP ${response.status}`, responseBody: body };
    }
    const externalRunId = typeof body.externalRunId === "string" ? body.externalRunId : undefined;
    return { accepted: true, status: "running", externalRunId, renderedCommand, responseBody: body };
  } catch (error) {
    return {
      accepted: false,
      status: "failed",
      renderedCommand,
      message: error instanceof Error ? error.message : "Agent dispatch failed",
    };
  }
};

export class RerunsService {
  constructor(
    private readonly jobRepo: Repository<TestRerunJob>,
    private readonly itemRepo: Repository<TestRerunJobItem>,
    private readonly testRunRepo: Repository<TestRun>,
    private readonly settings: RerunSettingsStore,
    private readonly projects: RerunProjectResolver,
    private readonly outboundAllowedHosts: string[] = [],
  ) {}

  async createJob(input: {
    parentRunId: number | string;
    body: CreateTestRerunJobInput;
    requestedByUserId: string;
    projectId?: string;
  }): Promise<TestRerunJobResponse> {
    const parentRunId = typeof input.parentRunId === "string" ? Number.parseInt(input.parentRunId, 10) : input.parentRunId;
    if (!Number.isInteger(parentRunId) || parentRunId <= 0) {
      throw new HttpError(400, "RERUN_VALIDATION", "Invalid parent run id");
    }

    const selectorsRaw = Array.isArray(input.body.selectors) ? input.body.selectors : [];
    const selectors = normalizeSelectors(
      selectorsRaw.filter((entry): entry is { kind: TestRerunSelectorKind; value: string; testResultId?: string } => {
        return Boolean(entry) && SELECTOR_KINDS.includes(entry.kind);
      }),
    );

    if (selectors.length === 0) {
      throw new HttpError(400, "RERUN_VALIDATION", "At least one rerun selector is required");
    }

    const scopedProjectId = await this.projects.resolveProjectId(input.projectId);
    const parentRun = await this.findParentRun(parentRunId, scopedProjectId);
    if (!parentRun) throw new HttpError(404, "RERUN_PARENT_NOT_FOUND", "Parent run not found");

    const settings = await this.loadSettings(scopedProjectId);
    const profile = this.resolveExecutionProfile(settings, input.body.executionProfileId, input.body.framework);
    this.assertSingleFrameworkPerProject(settings, profile);

    const framework: TestRerunFramework = profile?.framework ?? input.body.framework ?? "playwright";
    const executionMode: TestRerunExecutionMode = profile?.executionMode ?? "ci-webhook";
    const triggerMode: TestRerunTriggerMode = input.body.triggerMode ?? profile?.triggerMode ?? "tests_only";
    const selectionMode: TestRerunSelectionMode = input.body.selectionMode ?? (selectors.length === 1 ? "single" : "selected");

    const now = new Date();
    const createFields: Partial<TestRerunJob> = {
      parentRunId,
      projectId: scopedProjectId,
      requestedByUserId: input.requestedByUserId || "unknown",
      status: "queued",
      framework,
      executionMode,
      selectionMode,
      triggerMode,
      selectors,
      createdAt: now,
      updatedAt: now,
    };
    if (profile?.id ?? input.body.executionProfileId) {
      createFields.executionProfileId = profile?.id ?? input.body.executionProfileId;
    }
    if (input.body.metadata) createFields.metadata = input.body.metadata;

    const created = this.jobRepo.create(createFields);
    const saved = await this.jobRepo.save(created);

    const itemRows = selectors.map((selector) =>
      this.itemRepo.create({
        rerunJobId: saved.id,
        selectorKind: selector.kind,
        selectorValue: selector.value,
        ...(selector.testResultId ? { testResultId: selector.testResultId } : {}),
        status: "queued",
        createdAt: now,
        updatedAt: now,
      }),
    );
    await this.itemRepo.save(itemRows);

    if (profile && profile.enabled !== false) {
      const { args, selectorExpression } = mapSelectorsToCommandArgs(framework, selectors);
      const renderedCommand = renderTemplate(profile.commandTemplate, args, selectorExpression);
      const dispatch = profile.executionMode === "agent"
        ? await dispatchAgent(profile, scopedProjectId, parentRunId, selectors, renderedCommand, args, this.outboundAllowedHosts)
        : await dispatchCiWebhook(profile, scopedProjectId, parentRunId, selectors, renderedCommand, args, this.outboundAllowedHosts);

      saved.status = dispatch.status === "failed" ? "failed" : dispatch.status;
      if (dispatch.message) saved.message = dispatch.message;
      if (dispatch.status === "running" && !saved.startedAt) saved.startedAt = new Date();
      if (dispatch.status === "failed") saved.completedAt = new Date();
      saved.metadata = {
        ...(saved.metadata ?? {}),
        execution: {
          renderedCommand: dispatch.renderedCommand,
          externalRunId: dispatch.externalRunId,
          accepted: dispatch.accepted,
        },
      };
      saved.updatedAt = new Date();
      await this.jobRepo.save(saved);
    }

    const refreshed = await this.getJobScoped(saved.id, scopedProjectId);
    return this.toResponse(refreshed);
  }

  async getJob(jobId: string, projectId?: string): Promise<TestRerunJobResponse> {
    const scopedProjectId = await this.projects.resolveProjectId(projectId);
    const job = await this.getJobScoped(jobId, scopedProjectId);
    return this.toResponse(job);
  }

  async cancelJob(jobId: string, projectId?: string, requestedByUserId?: string): Promise<TestRerunJobResponse> {
    const scopedProjectId = await this.projects.resolveProjectId(projectId);
    const job = await this.getJobScoped(jobId, scopedProjectId);

    if (TERMINAL_JOB_STATUSES.includes(job.status)) {
      if (job.status === "canceled") return this.toResponse(job);
      throw new HttpError(400, "RERUN_INVALID_STATE", `Cannot cancel rerun job in status '${job.status}'`);
    }

    const now = new Date();
    const message = requestedByUserId ? `Canceled by ${requestedByUserId}` : "Canceled by user";
    job.status = "canceled";
    job.message = message;
    job.completedAt = now;
    job.updatedAt = now;

    const changedItems = (job.items ?? [])
      .filter((item) => ACTIVE_JOB_STATUSES.includes(item.status))
      .map((item) => {
        item.status = "canceled";
        item.message = message;
        item.updatedAt = now;
        return item;
      });

    await this.jobRepo.save(job);
    if (changedItems.length > 0) await this.itemRepo.save(changedItems);

    const refreshed = await this.getJobScoped(jobId, scopedProjectId);
    return this.toResponse(refreshed);
  }

  async updateJobStatus(jobId: string, update: UpdateTestRerunJobStatusInput, projectId?: string): Promise<TestRerunJobResponse> {
    const scopedProjectId = await this.projects.resolveProjectId(projectId);
    const job = await this.getJobScoped(jobId, scopedProjectId);

    if (update.status !== job.status) {
      const allowed = ALLOWED_STATUS_TRANSITIONS[job.status] ?? [];
      if (!allowed.includes(update.status)) {
        throw new HttpError(400, "RERUN_INVALID_TRANSITION", `Invalid rerun job transition '${job.status}' -> '${update.status}'`);
      }
    }

    const now = new Date();
    if (update.status === "running" && !job.startedAt) job.startedAt = now;
    if (TERMINAL_JOB_STATUSES.includes(update.status)) job.completedAt = now;
    job.status = update.status;
    job.updatedAt = now;
    if (typeof update.message === "string") job.message = update.message;
    if (typeof update.childRunId === "number") job.childRunId = update.childRunId;
    if (update.meta && typeof update.meta === "object") {
      job.metadata = { ...(job.metadata ?? {}), ...update.meta };
    }

    if (TERMINAL_JOB_STATUSES.includes(update.status) && Array.isArray(job.items)) {
      const changedItems = job.items
        .filter((item) => ACTIVE_JOB_STATUSES.includes(item.status))
        .map((item) => {
          item.status = update.status;
          if (update.message) item.message = update.message;
          item.updatedAt = now;
          return item;
        });
      if (changedItems.length > 0) await this.itemRepo.save(changedItems);
    }

    await this.jobRepo.save(job);
    const refreshed = await this.getJobScoped(jobId, scopedProjectId);
    return this.toResponse(refreshed);
  }

  private async getJobScoped(jobId: string, scopedProjectId: string): Promise<TestRerunJob> {
    const job = await this.jobRepo.findOne({ where: { id: jobId }, relations: ["items"] });
    if (!job || job.projectId !== scopedProjectId) {
      throw new HttpError(404, "RERUN_NOT_FOUND", "Rerun job not found");
    }
    return job;
  }

  private async findParentRun(runId: number, scopedProjectId: string): Promise<null | TestRun> {
    return this.testRunRepo
      .createQueryBuilder("run")
      .where("run.id = :id", { id: runId })
      .andWhere("(run.projectId = :projectId OR (:projectId = 'default' AND run.projectId IS NULL))", { projectId: scopedProjectId })
      .getOne();
  }

  private async loadSettings(projectId: string): Promise<TestRerunSettings> {
    const raw = await this.settings.get(RERUN_PROFILES_KEY, projectId);
    if (!raw) return { projectId, singleFrameworkPerProject: true, profiles: [] };

    try {
      const parsed = JSON.parse(raw) as Partial<TestRerunSettings>;
      const profiles = Array.isArray(parsed?.profiles)
        ? (parsed.profiles
            .map((profile) => this.normalizeProfile(profile))
            .filter((profile): profile is TestRerunExecutionProfile => profile !== null))
        : [];
      const activeProfileId = typeof parsed?.activeProfileId === "string" ? parsed.activeProfileId.trim() : undefined;
      return {
        projectId,
        singleFrameworkPerProject: true,
        ...(activeProfileId ? { activeProfileId } : {}),
        profiles,
      };
    } catch {
      return { projectId, singleFrameworkPerProject: true, profiles: [] };
    }
  }

  private normalizeProfile(value: unknown): null | TestRerunExecutionProfile {
    if (!value || typeof value !== "object") return null;
    const source = value as Partial<TestRerunExecutionProfile>;
    const id = String(source.id ?? "").trim();
    const name = String(source.name ?? "").trim();
    const commandTemplate = String(source.commandTemplate ?? "").trim();
    if (!id || !name || !commandTemplate) return null;

    return {
      id,
      name,
      framework: FRAMEWORKS.includes(source.framework as TestRerunFramework) ? (source.framework as TestRerunFramework) : "playwright",
      executionMode: EXECUTION_MODES.includes(source.executionMode as TestRerunExecutionMode) ? (source.executionMode as TestRerunExecutionMode) : "ci-webhook",
      triggerMode: TRIGGER_MODES.includes(source.triggerMode as TestRerunTriggerMode) ? (source.triggerMode as TestRerunTriggerMode) : "tests_only",
      commandTemplate,
      ...(typeof source.ciTriggerUrl === "string" ? { ciTriggerUrl: source.ciTriggerUrl.trim() } : {}),
      ...(source.ciHeaders && typeof source.ciHeaders === "object" ? { ciHeaders: source.ciHeaders as Record<string, string> } : {}),
      ...(typeof source.callbackSecret === "string" ? { callbackSecret: source.callbackSecret } : {}),
      enabled: source.enabled !== false,
    };
  }

  private resolveExecutionProfile(
    settings: TestRerunSettings,
    requestedProfileId?: string,
    requestedFramework?: TestRerunFramework,
  ): null | TestRerunExecutionProfile {
    const profiles = settings.profiles ?? [];
    if (profiles.length === 0) return null;
    if (requestedProfileId) {
      const explicit = profiles.find((profile) => profile.id === requestedProfileId);
      if (explicit) return explicit;
    }
    if (settings.activeProfileId) {
      const active = profiles.find((profile) => profile.id === settings.activeProfileId);
      if (active) return active;
    }
    if (requestedFramework) {
      const byFramework = profiles.find((profile) => profile.framework === requestedFramework);
      if (byFramework) return byFramework;
    }
    return profiles.find((profile) => profile.enabled !== false) ?? profiles[0] ?? null;
  }

  private assertSingleFrameworkPerProject(settings: TestRerunSettings, selectedProfile: null | TestRerunExecutionProfile): void {
    if (selectedProfile && selectedProfile.enabled === false) {
      throw new HttpError(400, "RERUN_PROFILE_DISABLED", "Selected rerun execution profile is disabled");
    }
    const enabledProfiles = (settings.profiles ?? []).filter((profile) => profile.enabled !== false);
    const frameworks = new Set(enabledProfiles.map((profile) => profile.framework));
    if (frameworks.size > 1) {
      throw new HttpError(400, "RERUN_MULTIPLE_FRAMEWORKS", "Project rerun settings must use one framework per project");
    }
  }

  private toResponse(job: TestRerunJob): TestRerunJobResponse {
    return {
      jobId: job.id,
      parentRunId: job.parentRunId,
      ...(job.childRunId !== undefined && job.childRunId !== null ? { childRunId: job.childRunId } : {}),
      projectId: job.projectId,
      status: job.status,
      framework: job.framework,
      executionMode: job.executionMode,
      selectionMode: job.selectionMode,
      selectors: Array.isArray(job.selectors) ? job.selectors : [],
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      ...(job.startedAt ? { startedAt: job.startedAt.toISOString() } : {}),
      ...(job.completedAt ? { completedAt: job.completedAt.toISOString() } : {}),
      ...(job.message ? { message: job.message } : {}),
    };
  }
}
