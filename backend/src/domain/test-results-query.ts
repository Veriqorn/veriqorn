import { DataSource } from "typeorm";
import {
  StepNode,
  ResultHistoryItem,
  countStepAttachments,
  extractResultLabels,
  resolveAllureId,
  buildResultDiagnostics,
} from "./test-results-helpers";

export interface AttachmentMeta {
  id: string;
  name: string;
  type: string;
  source: string;
  stepId: string | null;
}

export interface EnrichedTestResult {
  [key: string]: unknown;
  historyId: string;
  labels: Array<{ name: string; value: string }>;
  allureId: string | null;
  totalAttachments: number;
  diagnostics: ReturnType<typeof buildResultDiagnostics>;
  history: ResultHistoryItem[];
  retries: ResultHistoryItem[];
  steps: StepNode[];
}

export interface TestResultsForRunResponse {
  items: EnrichedTestResult[];
  total: number;
  meta: {
    runId: string;
    generatedAt: string;
    totalResults: number;
    passedCount: number;
    failedCount: number;
    brokenCount: number;
    skippedCount: number;
    totalAttachments: number;
  };
}

export class TestResultsQueryService {

  constructor(private readonly dataSource: DataSource) {}

  async getResultsForRun(
    runId: number,
    projectId: string,
    enrichAttachment?: (
      attachment: AttachmentMeta,
      runId: number,
    ) => {
      isTrace?: boolean;
      traceViewerUrl?: string;
      traceAssetUrl?: string;
      traceTokenExpiresAt?: string;
    } | null,
  ): Promise<TestResultsForRunResponse> {
    const attachmentTables = await this.detectAttachmentTables();

    const [results, steps, attachments] = await Promise.all([
      this.fetchResults(runId),
      this.fetchSteps(runId),
      this.fetchAttachments(runId, attachmentTables),
    ]);

    const attachmentsByStep = this.groupAttachmentsByStep(
      attachments,
      runId,
      enrichAttachment,
    );
    const stepsByResult = this.buildStepTree(steps, attachmentsByStep);
    const historyByName = await this.fetchHistory(results, projectId);

    const enrichedResults = results.map((result: Record<string, unknown>) => {
      const resultSteps: StepNode[] =
        (stepsByResult.get(result.id as string) as StepNode[]) ?? [];
      const totalAttachments = countStepAttachments(resultSteps);
      const historyId = String(result.uuid || result.id);
      const history = (
        (historyByName.get(result.name as string) as ResultHistoryItem[]) ?? []
      ).slice(0, 10);
      const retries = history.filter(
        (h) =>
          String(h.id) !== String(result.id) &&
          String(h.uuid || "") === historyId,
      );

      return {
        ...result,
        historyId,
        labels: extractResultLabels(result.labels, result.parameters),
        allureId: resolveAllureId(result.labels, result.parameters),
        totalAttachments,
        diagnostics: buildResultDiagnostics(
          result.status as string,
          resultSteps,
          totalAttachments,
        ),
        history,
        retries,
        steps: resultSteps,
      } as EnrichedTestResult;
    });

    const meta = {
      runId: String(runId),
      generatedAt: new Date().toISOString(),
      totalResults: enrichedResults.length,
      passedCount: enrichedResults.filter((r) => r.status === "passed").length,
      failedCount: enrichedResults.filter((r) => r.status === "failed").length,
      brokenCount: enrichedResults.filter((r) => r.status === "broken").length,
      skippedCount: enrichedResults.filter((r) => r.status === "skipped")
        .length,
      totalAttachments: enrichedResults.reduce(
        (sum, r) => sum + (r.totalAttachments ?? 0),
        0,
      ),
    };

    console.log(`Found ${enrichedResults.length} test results with steps for run ${runId}`);

    return { items: enrichedResults, total: enrichedResults.length, meta };
  }

  async findAttachmentForRun(
    numericRunId: number,
    attachmentId: string,
  ): Promise<{
    id: string;
    name: string;
    type: string;
    source: string;
    content: Buffer | string | null;
    storageType?: string | null;
    storageBucket?: string | null;
    objectKey?: string | null;
    size?: number | null;
    checksum?: string | null;
  } | null> {
    const tables = await this.detectAttachmentTables();

    if (tables.hasTestAttachments) {
      const rows = await this.dataSource.query(
        `
        SELECT
          ta.id::text as id,
          ta.name,
          ta.type,
          ta.source,
          ta.content,
          ta."storageType" as "storageType",
          ta."storageBucket" as "storageBucket",
          ta."objectKey" as "objectKey",
          ta."size" as "size",
          ta.checksum
        FROM public.test_attachment ta
        LEFT JOIN test_step ts ON ts.id = ta."stepId"
        INNER JOIN test_result tr
          ON tr.id = COALESCE(ta."testResultId", ts."testResultId")
        WHERE tr."testRunId" = $1 AND ta.id::text = $2
        LIMIT 1
        `,
        [numericRunId, attachmentId],
      );
      if (rows?.[0]) return rows[0];
    }

    if (tables.hasStepAttachments) {
      const rows = await this.dataSource.query(
        `
        SELECT tsa.id::text as id, tsa.name, tsa.type, tsa.source, tsa.content
        FROM public.test_step_attachment tsa
        INNER JOIN test_step ts ON ts.id = tsa."stepId"
        INNER JOIN test_result tr ON tr.id = ts."testResultId"
        WHERE tr."testRunId" = $1 AND tsa.id::text = $2
        LIMIT 1
        `,
        [numericRunId, attachmentId],
      );
      if (rows?.[0]) return rows[0];
    }

    return null;
  }

  private async detectAttachmentTables(): Promise<{
    hasTestAttachments: boolean;
    hasStepAttachments: boolean;
  }> {
    const rows = await this.dataSource.query(`
      SELECT
        to_regclass('public.test_attachment') as test_attachment,
        to_regclass('public.test_step_attachment') as test_step_attachment
    `);
    return {
      hasTestAttachments: Boolean(rows?.[0]?.test_attachment),
      hasStepAttachments: Boolean(rows?.[0]?.test_step_attachment),
    };
  }

  private async fetchResults(
    runId: number,
  ): Promise<Array<Record<string, unknown>>> {
    return this.dataSource.query(
      `SELECT tr.* FROM test_result tr WHERE tr."testRunId" = $1 ORDER BY tr."startTime" DESC`,
      [runId],
    );
  }

  private async fetchSteps(
    runId: number,
  ): Promise<Array<Record<string, unknown>>> {
    return this.dataSource.query(
      `
      SELECT
        ts.id, ts.name, ts.status, ts.stage,
        ts."startTime" as "startTime", ts."endTime" as "endTime",
        ts."statusDetails" as "statusDetails", ts.parameters,
        ts."parentStepId" as "parentStepId", ts."testResultId" as "testResultId"
      FROM test_step ts
      INNER JOIN test_result tr ON tr.id = ts."testResultId"
      WHERE tr."testRunId" = $1
      ORDER BY ts."startTime" ASC
      `,
      [runId],
    );
  }

  private async fetchAttachments(
    runId: number,
    tables: { hasTestAttachments: boolean; hasStepAttachments: boolean },
  ): Promise<AttachmentMeta[]> {
    const selects: string[] = [];

    if (tables.hasTestAttachments) {
      selects.push(`
        SELECT ta.id::text as id, ta.name, ta.type, ta.source, ta."stepId"::text as "stepId"
        FROM public.test_attachment ta
        LEFT JOIN test_step ts ON ts.id = ta."stepId"
        INNER JOIN test_result tr
          ON tr.id = COALESCE(ta."testResultId", ts."testResultId")
        WHERE tr."testRunId" = $1
      `);
    }

    if (tables.hasStepAttachments) {
      selects.push(`
        SELECT tsa.id::text as id, tsa.name, tsa.type, tsa.source, tsa."stepId"::text as "stepId"
        FROM public.test_step_attachment tsa
        INNER JOIN test_step ts ON ts.id = tsa."stepId"
        INNER JOIN test_result tr ON tr.id = ts."testResultId"
        WHERE tr."testRunId" = $1
      `);
    }

    if (selects.length === 0) return [];

    return this.dataSource.query(selects.join("\nUNION ALL\n"), [runId]);
  }

  private groupAttachmentsByStep(
    attachments: AttachmentMeta[],
    runId: number,
    enrichFn?: (
      attachment: AttachmentMeta,
      runId: number,
    ) => {
      isTrace?: boolean;
      traceViewerUrl?: string;
      traceAssetUrl?: string;
      traceTokenExpiresAt?: string;
    } | null,
  ): Map<string, StepNode["attachments"]> {
    const map = new Map<string, NonNullable<StepNode["attachments"]>>();

    for (const att of attachments) {
      if (!att.stepId) continue;

      const extra = enrichFn?.(att, runId) ?? {};
      const normalized = {
        id: att.id,
        name: att.name,
        type: att.type,
        source: att.source,
        ...extra,
      };

      const list = map.get(att.stepId) ?? [];
      list.push(normalized);
      map.set(att.stepId, list);
    }

    return map;
  }

  private buildStepTree(
    steps: Array<Record<string, unknown>>,
    attachmentsByStep: Map<string, StepNode["attachments"]>,
  ): Map<string, StepNode[]> {
    const stepsById = new Map<string, Record<string, unknown>>();
    const stepsByResult = new Map<string, StepNode[]>();

    for (const step of steps) {
      stepsById.set(step.id as string, {
        ...step,
        attachments: attachmentsByStep.get(step.id as string) ?? [],
        childSteps: [],
      });
    }

    for (const step of stepsById.values()) {
      if (step.parentStepId) {
        const parent = stepsById.get(step.parentStepId as string);
        if (parent) {
          (parent.childSteps as StepNode[]).push(step as unknown as StepNode);
        }
        continue;
      }

      const rootList =
        stepsByResult.get(step.testResultId as string) ?? ([] as StepNode[]);
      rootList.push(step as unknown as StepNode);
      stepsByResult.set(step.testResultId as string, rootList);
    }

    const sortSteps = (list: Array<Record<string, unknown>>) => {
      list.sort(
        (a, b) =>
          new Date(a.startTime as string).getTime() -
          new Date(b.startTime as string).getTime(),
      );
      list.forEach((child) => {
        const children = child.childSteps as Array<Record<string, unknown>>;
        if (children && children.length > 0) {
          sortSteps(children);
        }
      });
    };

    stepsByResult.forEach((list) => sortSteps(list));

    return stepsByResult;
  }

  private async fetchHistory(
    results: Array<Record<string, unknown>>,
    projectId: string,
  ): Promise<Map<string, ResultHistoryItem[]>> {
    const resultNames = Array.from(
      new Set(
        results
          .map((r) => r.name as string)
          .filter((name) => typeof name === "string" && name.length > 0),
      ),
    );

    const historyByName = new Map<string, ResultHistoryItem[]>();

    if (resultNames.length === 0) return historyByName;

    const historyRows = await this.dataSource.query(
      `
      SELECT
        tr.id::text as id, tr.uuid::text as uuid, tr.status,
        tr."startTime" as "startTime", tr."endTime" as "endTime",
        tr.duration, tr."testRunId"::text as "testRunId", tr.name
      FROM test_result tr
      INNER JOIN test_run run ON run.id = tr."testRunId"
      WHERE tr.name = ANY($1) AND run."projectId" = $2
      ORDER BY tr."startTime" DESC
      `,
      [resultNames, projectId],
    );

    for (const row of historyRows as Array<
      ResultHistoryItem & { name: string }
    >) {
      if (!row.name) continue;
      const history = historyByName.get(row.name) ?? [];
      history.push({
        id: row.id,
        uuid: row.uuid,
        status: row.status,
        startTime: row.startTime,
        endTime: row.endTime,
        duration: row.duration,
        testRunId: row.testRunId,
      });
      historyByName.set(row.name, history);
    }

    return historyByName;
  }
}
