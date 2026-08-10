import { DataSource, Repository } from "typeorm";
import * as fs from "fs";
import * as path from "path";
import { createHash, randomUUID } from "crypto";
import { TestResult } from "../entities/test-result.entity";
import { TestStep } from "../entities/test-step.entity";
import { TestAttachment } from "../entities/test-attachment.entity";
import { TestRun } from "../entities/test-run.entity";
import type { MinioStorageService } from "../services";

type IngestionDiagnostics = {
  correlationId?: string;
  source?: string;
};

type NormalizedDiagnostics = {
  correlationId: string;
  source: string;
};

type AttachmentStorageMode = "test_attachment" | "test_step_attachment";

type AttachmentStorageType = "database" | "minio";

type StoredAttachmentRef = {
  id: string;
  name: string;
  type: string;
  source: string;
  stepId?: string | null;
  testResultId?: string | null;
  storageType?: AttachmentStorageType | null;
  storageBucket?: string | null;
  objectKey?: string | null;
};

export class AllureImportService {
  private attachmentStorageMode: AttachmentStorageMode | null = null;
  private readonly inlineAttachmentMaxBytes = Number(
    process.env.ALLURE_ATTACHMENT_INLINE_MAX_BYTES || 256 * 1024,
  );
  private readonly inlineAttachmentTypes = new Set([
    "application/json",
    "application/xml",
    "text/html",
    "text/markdown",
    "text/plain",
    "text/xml",
  ]);

  constructor(
    private testResultRepository: Repository<TestResult>,
    private testStepRepository: Repository<TestStep>,
    private testAttachmentRepository: Repository<TestAttachment>,
    private testRunRepository: Repository<TestRun>,
    private dataSource: DataSource,
    private readonly minioService?: MinioStorageService,
  ) {}

  private normalizeDiagnostics(
    diagnostics?: IngestionDiagnostics,
  ): NormalizedDiagnostics {
    return {
      correlationId: diagnostics?.correlationId || randomUUID(),
      source: diagnostics?.source || "allure-import",
    };
  }

  private stripUtf8Bom(content: string): string {
    return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  }

  private parseJsonFile(filePath: string): any {
    const rawContent = fs.readFileSync(filePath, "utf8");
    const normalizedContent = this.stripUtf8Bom(rawContent);

    return JSON.parse(normalizedContent);
  }

  private normalizeResultLabels(
    labels: unknown,
  ): Array<{ name: string; value: string }> {
    if (!Array.isArray(labels)) {
      return [];
    }

    return labels
      .map((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          return null;
        }

        const rawName = (entry as Record<string, unknown>).name;
        const rawValue = (entry as Record<string, unknown>).value;
        const name = typeof rawName === "string" ? rawName.trim() : "";
        if (!name) {
          return null;
        }

        if (
          rawValue === null ||
          rawValue === undefined ||
          (typeof rawValue === "string" && rawValue.trim().length === 0)
        ) {
          return null;
        }

        return {
          name,
          value:
            typeof rawValue === "string" ? rawValue : JSON.stringify(rawValue),
        };
      })
      .filter((item): item is { name: string; value: string } => Boolean(item));
  }

  private isDatabaseUuid(value: unknown): value is string {
    return (
      typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value.trim(),
      )
    );
  }

  private normalizeResultUuid(value: unknown): {
    originalUuid?: string;
    uuid: string;
  } {
    if (this.isDatabaseUuid(value)) {
      return { uuid: value.trim() };
    }

    const originalUuid = typeof value === "string" ? value.trim() : "";
    return {
      ...(originalUuid ? { originalUuid } : {}),
      uuid: randomUUID(),
    };
  }

  private logDiagnostics(
    level: "log" | "warn" | "error",
    diagnostics: NormalizedDiagnostics,
    message: string,
    metadata: Record<string, unknown> = {},
  ): void {
    const payload = {
      correlationId: diagnostics.correlationId,
      source: diagnostics.source,
      message,
      ...metadata,
    };

    (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(JSON.stringify(payload));
  }

  private async resolveAttachmentStorageMode(): Promise<AttachmentStorageMode> {
    if (this.attachmentStorageMode) {
      return this.attachmentStorageMode;
    }

    const tables = await this.dataSource.query(`
      SELECT
        to_regclass('public.test_attachment') as test_attachment,
        to_regclass('public.test_step_attachment') as test_step_attachment
    `);

    if (tables?.[0]?.test_attachment) {
      this.attachmentStorageMode = "test_attachment";
      return this.attachmentStorageMode;
    }

    if (tables?.[0]?.test_step_attachment) {
      this.attachmentStorageMode = "test_step_attachment";
      return this.attachmentStorageMode;
    }

    throw new Error(
      "Neither test_attachment nor test_step_attachment table exists for attachment import",
    );
  }

  private encodeLegacyAttachmentContent(content: Buffer): string {
    return `base64:${content.toString("base64")}`;
  }

  private isInlineFriendlyAttachmentType(type: string): boolean {
    return type.startsWith("text/") || this.inlineAttachmentTypes.has(type);
  }

  private canUseObjectStorage(): boolean {
    return Boolean(this.minioService?.isAvailable());
  }

  private shouldStoreAttachmentInObjectStorage(
    content: Buffer,
    type: string,
  ): boolean {
    if (!this.canUseObjectStorage()) {
      return false;
    }

    if (content.length > this.inlineAttachmentMaxBytes) {
      return true;
    }

    if (
      type.startsWith("image/") ||
      type.startsWith("video/") ||
      type.includes("zip") ||
      type === "application/octet-stream"
    ) {
      return true;
    }

    return !this.isInlineFriendlyAttachmentType(type);
  }

  private resolveAttachmentBucket(
    type: string,
    sourceId: string,
    name: string,
  ): string {
    if (this.isPlaywrightTraceAttachment(sourceId, type, name)) {
      return "traces";
    }

    if (type.startsWith("image/")) {
      return "screenshots";
    }

    return "artifacts";
  }

  private sanitizeAttachmentFileName(name: string): string {
    const sanitized = name
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .trim();

    return sanitized || "attachment.bin";
  }

  private buildObjectKey(
    testRunId: number,
    attachmentId: string,
    sourceId: string,
    name: string,
    existing?: StoredAttachmentRef,
  ): string {
    if (existing?.objectKey) {
      return existing.objectKey;
    }

    const fileName = this.sanitizeAttachmentFileName(
      sourceId || name || attachmentId,
    );

    return `${testRunId}/${attachmentId}-${fileName}`;
  }

  private async deleteStoredObject(
    attachment: StoredAttachmentRef,
  ): Promise<void> {
    if (
      attachment.storageType !== "minio" ||
      !attachment.storageBucket ||
      !attachment.objectKey ||
      !this.canUseObjectStorage()
    ) {
      return;
    }

    try {
      await this.minioService!.deleteFile(
        attachment.storageBucket,
        attachment.objectKey,
      );
    } catch (error) {
      console.warn(
        `Failed to delete previous attachment object ${attachment.storageBucket}/${attachment.objectKey}: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  private async persistAttachmentContent(params: {
    attachmentId: string;
    testRunId: number;
    sourceId: string;
    name: string;
    type: string;
    content: Buffer;
    existing?: StoredAttachmentRef;
  }): Promise<{
    content: Buffer | null;
    storageType: AttachmentStorageType;
    storageBucket: string | null;
    objectKey: string | null;
    size: number;
    checksum: string;
  }> {
    const checksum = createHash("sha256").update(params.content).digest("hex");
    const size = params.content.length;
    const normalizedType = params.type.toLowerCase();

    if (
      !this.shouldStoreAttachmentInObjectStorage(params.content, normalizedType)
    ) {
      return {
        content: params.content,
        storageType: "database",
        storageBucket: null,
        objectKey: null,
        size,
        checksum,
      };
    }

    const storageBucket = this.resolveAttachmentBucket(
      normalizedType,
      params.sourceId,
      params.name,
    );
    const objectKey = this.buildObjectKey(
      params.testRunId,
      params.attachmentId,
      params.sourceId,
      params.name,
      params.existing,
    );

    try {
      await this.minioService!.uploadBuffer(
        storageBucket,
        objectKey,
        params.content,
        params.type,
      );

      return {
        content: null,
        storageType: "minio",
        storageBucket,
        objectKey,
        size,
        checksum,
      };
    } catch (error) {
      console.warn(
        `Failed to upload attachment ${params.sourceId} to MinIO, storing inline in Postgres instead: ${error instanceof Error ? error.message : "unknown error"}`,
      );

      return {
        content: params.content,
        storageType: "database",
        storageBucket: null,
        objectKey: null,
        size,
        checksum,
      };
    }
  }

  private async findExistingAttachmentsBySource(
    sourceId: string,
    testRunId: number,
  ): Promise<StoredAttachmentRef[]> {
    const storageMode = await this.resolveAttachmentStorageMode();

    if (storageMode === "test_attachment") {
      const rows = await this.dataSource.query(
        `
        SELECT
          ta.id::text as id,
          ta.name,
          ta.type,
          ta.source,
          ta."stepId"::text as "stepId",
          ta."testResultId"::text as "testResultId",
          ta."storageType" as "storageType",
          ta."storageBucket" as "storageBucket",
          ta."objectKey" as "objectKey"
        FROM public.test_attachment ta
        LEFT JOIN public.test_step ts ON ts.id = ta."stepId"
        INNER JOIN public.test_result tr
          ON tr.id = COALESCE(ta."testResultId", ts."testResultId")
        WHERE ta.source = $1 AND tr."testRunId" = $2
        `,
        [sourceId, testRunId],
      );

      return rows as StoredAttachmentRef[];
    }

    const rows = await this.dataSource.query(
      `
      SELECT
        tsa.id::text as id,
        tsa.name,
        tsa.type,
        tsa.source,
        tsa."stepId"::text as "stepId",
        NULL::text as "testResultId"
      FROM public.test_step_attachment tsa
      INNER JOIN public.test_step ts ON ts.id = tsa."stepId"
      INNER JOIN public.test_result tr ON tr.id = ts."testResultId"
      WHERE tsa.source = $1
        AND tr."testRunId" = $2
      `,
      [sourceId, testRunId],
    );

    return rows as StoredAttachmentRef[];
  }

  private async updateAttachmentContent(
    attachment: StoredAttachmentRef,
    content: Buffer,
    sourceId: string,
    testRunId: number,
  ): Promise<void> {
    const storageMode = await this.resolveAttachmentStorageMode();
    const normalizedType = this.normalizeAttachmentType(
      sourceId,
      attachment.type,
      attachment.name,
    );

    if (storageMode === "test_attachment") {
      const previousLocation = {
        storageType: attachment.storageType,
        storageBucket: attachment.storageBucket,
        objectKey: attachment.objectKey,
      };
      const persisted = await this.persistAttachmentContent({
        attachmentId: attachment.id,
        testRunId,
        sourceId,
        name: attachment.name,
        type: normalizedType,
        content,
        existing: attachment,
      });

      await this.dataSource.query(
        `
        UPDATE public.test_attachment
        SET
          content = $1,
          type = $2,
          "storageType" = $3,
          "storageBucket" = $4,
          "objectKey" = $5,
          "size" = $6,
          checksum = $7
        WHERE id::text = $8
        `,
        [
          persisted.content,
          normalizedType,
          persisted.storageType,
          persisted.storageBucket,
          persisted.objectKey,
          persisted.size,
          persisted.checksum,
          attachment.id,
        ],
      );

      if (
        previousLocation.storageType === "minio" &&
        (persisted.storageType !== "minio" ||
          previousLocation.storageBucket !== persisted.storageBucket ||
          previousLocation.objectKey !== persisted.objectKey)
      ) {
        await this.deleteStoredObject(attachment);
      }

      return;
    }

    await this.dataSource.query(
      `
      UPDATE public.test_step_attachment
      SET content = $1, type = $2
      WHERE id::text = $3
      `,
      [
        this.encodeLegacyAttachmentContent(content),
        normalizedType,
        attachment.id,
      ],
    );
  }

  private async createAttachmentRecord(params: {
    name: string;
    type: string;
    source: string;
    stepId?: string;
    testResultId?: string;
    testRunId?: number;
    content?: Buffer;
  }): Promise<{ id: string }> {
    const storageMode = await this.resolveAttachmentStorageMode();

    if (storageMode === "test_attachment") {
      const id = randomUUID();
      if (params.content && params.testRunId === undefined) {
        throw new Error(
          "testRunId is required when storing attachment content in test_attachment",
        );
      }
      const testRunId = params.testRunId;
      const persisted = params.content
        ? await this.persistAttachmentContent({
            attachmentId: id,
            testRunId: testRunId as number,
            sourceId: params.source,
            name: params.name,
            type: params.type,
            content: params.content,
          })
        : {
            content: null,
            storageType: "database" as const,
            storageBucket: null,
            objectKey: null,
            size: null,
            checksum: null,
          };
      const rows = await this.dataSource.query(
        `
        INSERT INTO public.test_attachment (
          id,
          name,
          type,
          source,
          content,
          "testResultId",
          "stepId",
          "storageType",
          "storageBucket",
          "objectKey",
          "size",
          checksum
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id::text as id
        `,
        [
          id,
          params.name,
          params.type,
          params.source,
          persisted.content,
          params.testResultId ?? null,
          params.stepId ?? null,
          persisted.storageType,
          persisted.storageBucket,
          persisted.objectKey,
          persisted.size,
          persisted.checksum,
        ],
      );

      return {
        id: rows?.[0]?.id || id,
      };
    }

    const rows = await this.dataSource.query(
      `
      INSERT INTO public.test_step_attachment (
        name,
        type,
        source,
        content,
        "stepId"
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id::text as id
      `,
      [
        params.name,
        params.type,
        params.source,
        params.content
          ? this.encodeLegacyAttachmentContent(params.content)
          : null,
        params.stepId ?? null,
      ],
    );

    return {
      id: rows?.[0]?.id || "",
    };
  }

  async deleteResultsByName(
    testRunId: number,
    testNames: string[],
  ): Promise<number> {
    if (testNames.length === 0) {
      return 0;
    }

    const results = await this.testResultRepository.find({
      where: { testRun: { id: testRunId } },
    });

    const matchingIds = results
      .filter((r) => testNames.includes(r.name))
      .map((r) => r.id);

    if (matchingIds.length === 0) {
      return 0;
    }

    // Delete in correct order within a transaction: attachments → steps → artifacts → results
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.query(
        `DELETE FROM test_attachment WHERE "testResultId" = ANY($1) OR "stepId" IN (SELECT id FROM test_step WHERE "testResultId" = ANY($1))`,
        [matchingIds],
      );
      await queryRunner
        .query(
          `DELETE FROM test_step_attachment WHERE "stepId" IN (SELECT id FROM test_step WHERE "testResultId" = ANY($1))`,
          [matchingIds],
        )
        .catch(() => {
          /* legacy table may not exist */
        });
      await queryRunner.query(
        `DELETE FROM test_step WHERE "testResultId" = ANY($1)`,
        [matchingIds],
      );
      await queryRunner
        .query(`DELETE FROM test_artifact WHERE "testResultId" = ANY($1)`, [
          matchingIds,
        ])
        .catch(() => {
          /* table may not exist */
        });
      await queryRunner.query(`DELETE FROM test_result WHERE id = ANY($1)`, [
        matchingIds,
      ]);

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    return matchingIds.length;
  }

  async importFromDirectory(
    directoryPath: string,
    testRunId: string | number,
    onProgress?: (progress: number) => void,
    diagnostics?: IngestionDiagnostics,
  ): Promise<void> {
    const diagnosticContext = this.normalizeDiagnostics(diagnostics);
    const numericTestRunId =
      typeof testRunId === "string" ? parseInt(testRunId, 10) : testRunId;
    this.logDiagnostics("log", diagnosticContext, "Import started", {
      directoryPath,
      testRunId,
    });

    console.log(
      `Import started for test run ${testRunId} from ${directoryPath}`,
    );
    // Handle relative paths by resolving them from the project root
    if (!path.isAbsolute(directoryPath)) {
      directoryPath = path.resolve(process.cwd(), directoryPath);
    }

    console.debug(`Resolved import path: ${directoryPath}`);

    try {
      const testRun = await this.testRunRepository.findOne({
        where: { id: numericTestRunId },
      });
      if (!testRun) {
        throw new Error(`Test run with id ${testRunId} not found`);
      }
      console.debug(`Found test run: ${testRun.id}`);

      // Check if directory exists
      if (!fs.existsSync(directoryPath)) {
        throw new Error(`Directory not found: ${directoryPath}`);
      }

      // List all files in the directory
      const files = fs.readdirSync(directoryPath);
      console.debug(
        `Found ${files.length} files in directory: ${files.join(", ")}`,
      );

      // Filter for result files
      const resultFiles = files.filter((f) => f.endsWith("-result.json"));
      console.debug(
        `Found ${resultFiles.length} result files: ${resultFiles.join(", ")}`,
      );

      if (resultFiles.length === 0) throw new Error("No Allure *-result.json files found in the directory");
      if (resultFiles.length > 10_000) throw new Error("Too many Allure result files");

      const totalFiles = resultFiles.length;
      let processedFiles = 0;
      let successfulImports = 0;
      let lastError: unknown = null;

      // First pass: Import test results
      for (const file of resultFiles) {
        const filePath = path.join(directoryPath, file);
        console.debug(`Processing file: ${filePath}`);

        try {
          const content = this.stripUtf8Bom(fs.readFileSync(filePath, "utf8"));
          console.debug(`File content length: ${content.length} bytes`);

          let resultData;
          try {
            resultData = JSON.parse(content);
            console.debug(`Successfully parsed JSON from ${file}`);
          } catch (error) {
            console.error(
              `Error parsing JSON from file ${filePath}:`,
              error,
            );
            continue;
          }

          // Check if the JSON has the required fields
          if (!resultData.uuid) {
            console.warn(
              `File ${file} is missing uuid field, generating one`,
            );
          }

          const normalizedUuid = this.normalizeResultUuid(resultData.uuid);
          if (normalizedUuid.originalUuid) {
            console.warn(
              `File ${file} has non-UUID allure uuid '${normalizedUuid.originalUuid}', storing generated database uuid`,
            );
          }

          if (!resultData.name) {
            console.warn(
              `File ${file} is missing name field, using filename`,
            );
            resultData.name = file
              .replace("-result.json", "")
              .replace(".json", "");
          }

          if (!resultData.status) {
            console.warn(
              `File ${file} is missing status field, defaulting to 'unknown'`,
            );
            resultData.status = "unknown";
          }

          // Handle missing start/stop times
          if (!resultData.start) {
            console.warn(
              `File ${file} is missing start field, using current time`,
            );
            resultData.start = Date.now();
          }

          if (!resultData.stop) {
            console.warn(
              `File ${file} is missing stop field, using current time`,
            );
            resultData.stop = Date.now();
          }

          console.debug(
            `Creating test result for ${file} with name: ${resultData.name}, status: ${resultData.status}`,
          );
          // Create a test result object with only the fields that exist in the database
          // This avoids database schema mismatch errors
          const testResultData: any = {
            id: randomUUID(),
            uuid: normalizedUuid.uuid,
            name: resultData.name,
            status: resultData.status,
            startTime: new Date(resultData.start),
            endTime: new Date(resultData.stop),
            testRun,
          };

          // Add optional fields if they exist in the result data and in the database schema
          // Note: historyId, fullName, statusDetails, and stage fields have been removed from the entity
          if (resultData.parameters)
            testResultData.parameters = resultData.parameters;
          testResultData.labels = resultData.labels
            ? this.normalizeResultLabels(resultData.labels)
            : [];
          if (
            normalizedUuid.originalUuid &&
            !testResultData.labels.some(
              (l: { name: string }) => l.name.toLowerCase() === "allureuuid",
            )
          ) {
            testResultData.labels.push({
              name: "allureUuid",
              value: normalizedUuid.originalUuid,
            });
          }
          // Persist testCaseId from Allure JSON as a synthetic label so resolveAllureId can find it
          if (
            resultData.testCaseId &&
            !testResultData.labels.some(
              (l: { name: string }) => l.name.toLowerCase() === "testcaseid",
            )
          ) {
            testResultData.labels.push({
              name: "testCaseId",
              value: String(resultData.testCaseId),
            });
          }

          // Create the entity
          const testResult = this.testResultRepository.create(testResultData);

          try {
            // Save the test result
            const savedResult =
              await this.testResultRepository.save(testResult);
            // TypeORM can return an array or a single entity, handle both cases
            const resultEntity = Array.isArray(savedResult)
              ? savedResult[0]
              : savedResult;

            console.debug(`Saved test result with ID: ${resultEntity.id}`);
            successfulImports++;

            // Import steps recursively
            if (resultData.steps && Array.isArray(resultData.steps)) {
              console.debug(
                `Importing ${resultData.steps.length} steps for test result ${resultEntity.id}`,
              );
              await this.importSteps(resultData.steps, resultEntity);
            }
          } catch (saveError) {
            console.error(`Error saving test result: ${saveError.message}`);
            throw saveError;
          }
        } catch (error) {
          lastError = error;
          console.error(`Error processing file ${filePath}:`, error);
        }

        processedFiles++;
        if (onProgress) {
          onProgress(processedFiles / totalFiles);
        }
      }

      console.debug(
        `Import completed. Successfully imported ${successfulImports} out of ${totalFiles} result files.`,
      );

      if (successfulImports === 0 && totalFiles > 0) {
        if (lastError instanceof Error) {
          throw lastError;
        }
        throw new Error(
          "Failed to import any test results despite finding result files",
        );
      }
    } catch (error) {
      console.error(`Error in importFromDirectory:`, error);
      this.logDiagnostics("error", diagnosticContext, "Import failed", {
        testRunId,
        directoryPath,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }

    // Second pass: Import attachments
    try {
      // Re-read the directory to get all files
      const allFiles = fs.readdirSync(directoryPath);
      const attachmentFiles = allFiles.filter((file) => {
        if (file.endsWith("-container.json") || file.endsWith("-result.json")) {
          return false;
        }
        return file.includes("-attachment.");
      });
      console.debug(
        `Found ${attachmentFiles.length} potential attachment files`,
      );

      for (const file of attachmentFiles) {
        try {
          const filePath = path.join(directoryPath, file);
          const sourceId = path.basename(file);
          const traceArtifactDetected = this.isPlaywrightTraceAttachment(file);
          console.debug(
            `Processing attachment file: ${filePath} with sourceId: ${sourceId}`,
          );

          if (traceArtifactDetected) {
            this.logDiagnostics(
              "log",
              diagnosticContext,
              "trace-artifact-detected",
              {
                sourceId,
                file,
              },
            );
          }

          const content = fs.readFileSync(filePath);

          // First, try to update any attachments already created during step import (matched by source)
          const existingAttachments =
            await this.findExistingAttachmentsBySource(
              sourceId,
              numericTestRunId,
            );

          if (existingAttachments.length > 0) {
            console.debug(
              `Updating content for ${existingAttachments.length} existing attachments with source ${sourceId}`,
            );
            await Promise.all(
              existingAttachments.map((attachment) =>
                this.updateAttachmentContent(
                  attachment,
                  content,
                  sourceId,
                  numericTestRunId,
                ),
              ),
            );

            if (traceArtifactDetected) {
              this.logDiagnostics(
                "log",
                diagnosticContext,
                "trace-artifact-registered",
                {
                  sourceId,
                  mode: "update-existing",
                  count: existingAttachments.length,
                },
              );
            }
            continue;
          }

          // If none exist, fall back to scanning result files to create missing attachments
          const attachmentRefs = await this.findAttachmentReferences(
            directoryPath,
            sourceId,
          );
          console.debug(
            `Found ${attachmentRefs.length} references to attachment ${sourceId}`,
          );

          if (attachmentRefs.length === 0) {
            console.warn(
              `No attachment references found for ${sourceId}. Skipping creation.`,
            );
            continue;
          }

          for (const ref of attachmentRefs) {
            console.debug(
              `Creating attachment: ${ref.name} (${ref.type}) for test result: ${ref.testResult?.id || "none"}, step: ${ref.step?.id || "none"}`,
            );

            const attachment = await this.createAttachmentRecord({
              name: ref.name,
              type: this.normalizeAttachmentType(sourceId, ref.type, ref.name),
              source: sourceId,
              content,
              testRunId: numericTestRunId,
              testResultId: ref.testResult?.id,
              stepId: ref.step?.id,
            });

            if (traceArtifactDetected) {
              this.logDiagnostics(
                "log",
                diagnosticContext,
                "trace-artifact-registered",
                {
                  sourceId,
                  mode: "create-missing",
                  attachmentId: attachment.id,
                },
              );
            }
          }
        } catch (error) {
          console.error(`Error importing attachment file ${file}:`, error);
        }
      }
    } catch (error) {
      console.error("Error processing attachments:", error);
      this.logDiagnostics(
        "warn",
        diagnosticContext,
        "Attachment processing failed",
        {
          testRunId,
          error: error instanceof Error ? error.message : "Unknown error",
        },
      );
    }

    console.debug(`Import completed for test run ${testRunId}`);
    this.logDiagnostics("log", diagnosticContext, "Import completed", {
      testRunId,
      directoryPath,
    });
  }

  async getTestResults(testRunId: string | number): Promise<TestResult[]> {
    const numericId =
      typeof testRunId === "string" ? parseInt(testRunId, 10) : testRunId;
    return this.testResultRepository.find({
      where: { testRun: { id: numericId } },
      relations: ["steps", "attachments"],
      order: { startTime: "DESC" },
    });
  }

  async getTestResult(
    testRunId: string | number,
    resultId: string,
  ): Promise<TestResult> {
    const numericId =
      typeof testRunId === "string" ? parseInt(testRunId, 10) : testRunId;
    const result = await this.testResultRepository.findOne({
      where: { id: resultId, testRun: { id: numericId } },
      relations: [
        "steps",
        "attachments",
        "steps.attachments",
        "steps.childSteps",
      ],
    });

    if (!result) {
      throw new Error(`Test result not found: ${resultId}`);
    }

    return result;
  }

  async getAttachment(
    testRunId: string | number,
    resultId: string,
    attachmentId: string,
  ): Promise<TestAttachment> {
    const numericId =
      typeof testRunId === "string" ? parseInt(testRunId, 10) : testRunId;
    const attachment = await this.testAttachmentRepository.findOne({
      where: {
        id: attachmentId,
        testResult: {
          id: resultId,
          testRun: { id: numericId },
        },
      },
    });

    if (!attachment) {
      throw new Error(`Attachment not found: ${attachmentId}`);
    }

    return attachment;
  }

  /**
   * Recursively imports test steps from Allure results
   * @param steps Array of step data from Allure results
   * @param parent The parent test result or step entity
   */
  private async importSteps(
    steps: any[],
    parent: TestResult | TestStep,
    depth = 0,
  ): Promise<void> {
    if (depth > 50) throw new Error("Allure step nesting exceeds the supported depth");
    if (!steps || !Array.isArray(steps) || steps.length === 0) {
      return;
    }

    console.debug(
      `Importing ${steps.length} steps for ${parent instanceof TestResult ? "test result " + parent.id : "parent step " + parent.id}`,
    );

    for (const stepData of steps.slice(0, 1_000)) {
      try {
        // Create step entity with required fields
        const step = this.testStepRepository.create({
          name: stepData.name || "Unnamed Step",
          status: stepData.status || "unknown",
          stage: stepData.stage || "finished",
          startTime: new Date(stepData.start || Date.now()),
          endTime: new Date(stepData.stop || Date.now()),
          statusDetails: stepData.statusDetails || undefined,
          parameters: stepData.parameters || [],
          testResult: parent instanceof TestResult ? parent : parent.testResult,
          parentStep: parent instanceof TestStep ? parent : undefined,
        });

        // Save the step
        const savedStep = await this.testStepRepository.save(step);
        console.debug(
          `Saved step with ID: ${savedStep.id}, name: ${savedStep.name}`,
        );

        // Process child steps recursively if they exist
        if (
          stepData.steps &&
          Array.isArray(stepData.steps) &&
          stepData.steps.length > 0
        ) {
          await this.importSteps(stepData.steps, savedStep, depth + 1);
        }

        // Process attachments if they exist
        if (stepData.attachments && Array.isArray(stepData.attachments)) {
          for (const attachmentData of stepData.attachments) {
            try {
              const attachment = await this.createAttachmentRecord({
                name: attachmentData.name || "Unnamed Attachment",
                type: this.normalizeAttachmentType(
                  attachmentData.source || "",
                  attachmentData.type || "unknown",
                  attachmentData.name,
                ),
                source: attachmentData.source || "",
                stepId: savedStep.id,
                testResultId: savedStep.testResult?.id,
              });

              if (
                this.isPlaywrightTraceAttachment(
                  attachmentData.source,
                  attachmentData.type,
                  attachmentData.name,
                )
              ) {
                this.logDiagnostics(
                  "log",
                  this.normalizeDiagnostics({ source: "allure-import" }),
                  "trace-artifact-registered",
                  {
                    sourceId: attachmentData.source || "",
                    mode: "step-attachment",
                    attachmentId: attachment.id,
                  },
                );
              }
            } catch (attachmentError) {
              console.error(
                `Error saving attachment for step ${savedStep.id}:`,
                attachmentError,
              );
            }
          }
        }
      } catch (stepError) {
        console.error(`Error importing step:`, stepError);
      }
    }
  }

  private async findAttachmentReferences(
    directoryPath: string,
    sourceId: string,
  ): Promise<
    Array<{
      name: string;
      type: string;
      testResult?: TestResult;
      step?: TestStep;
    }>
  > {
    const refs: Array<{
      name: string;
      type: string;
      testResult?: TestResult;
      step?: TestStep;
    }> = [];

    const files = fs.readdirSync(directoryPath);

    for (const file of files) {
      if (!file.endsWith("-result.json")) continue;

      const filePath = path.join(directoryPath, file);
      const data = this.parseJsonFile(filePath);

      const testResult = data.uuid
        ? await this.testResultRepository.findOne({
            where: { uuid: data.uuid },
          })
        : null;

      const pushAttachmentRef = (attachment: any) => {
        if (attachment.source === sourceId) {
          refs.push({
            name: attachment.name,
            type: attachment.type,
            testResult: testResult ?? undefined,
            step: undefined,
          });
        }
      };

      if (data.attachments && Array.isArray(data.attachments)) {
        data.attachments.forEach(pushAttachmentRef);
      }

      const walkSteps = (steps: any[]) => {
        for (const step of steps) {
          if (step.attachments && Array.isArray(step.attachments)) {
            step.attachments.forEach(pushAttachmentRef);
          }
          if (step.steps && Array.isArray(step.steps)) {
            walkSteps(step.steps);
          }
        }
      };

      if (data.steps && Array.isArray(data.steps)) {
        walkSteps(data.steps);
      }
    }

    return refs;
  }

  private isPlaywrightTraceAttachment(
    sourceOrFileName?: string,
    attachmentType?: string,
    attachmentName?: string,
  ): boolean {
    const normalized =
      `${sourceOrFileName || ""} ${attachmentType || ""} ${attachmentName || ""}`
        .toLowerCase()
        .trim();

    return (
      normalized.includes("trace") ||
      normalized.includes("application/zip") ||
      normalized.includes("application/x-zip") ||
      normalized.includes(".zip") ||
      normalized.includes(".trace")
    );
  }

  private normalizeAttachmentType(
    sourceOrFileName: string,
    currentType?: string,
    attachmentName?: string,
  ): string {
    const normalizedCurrentType = String(currentType || "")
      .trim()
      .toLowerCase();

    if (
      this.isPlaywrightTraceAttachment(
        sourceOrFileName,
        currentType,
        attachmentName,
      )
    ) {
      return "application/zip";
    }

    if (
      normalizedCurrentType &&
      normalizedCurrentType !== "application/octet-stream" &&
      normalizedCurrentType !== "unknown"
    ) {
      return currentType as string;
    }

    const inferredType = this.inferAttachmentTypeFromFileName(
      sourceOrFileName,
      attachmentName,
    );
    if (inferredType) {
      return inferredType;
    }

    return "application/octet-stream";
  }

  private inferAttachmentTypeFromFileName(
    sourceOrFileName?: string,
    attachmentName?: string,
  ): string | null {
    const hint = `${sourceOrFileName || ""} ${attachmentName || ""}`
      .toLowerCase()
      .trim();

    if (!hint) {
      return null;
    }

    if (
      hint.includes(".png") ||
      hint.includes(".jpg") ||
      hint.includes(".jpeg") ||
      hint.includes(".gif") ||
      hint.includes(".webp") ||
      hint.includes(".bmp") ||
      hint.includes(".svg")
    ) {
      if (hint.includes(".png")) return "image/png";
      if (hint.includes(".jpg") || hint.includes(".jpeg")) return "image/jpeg";
      if (hint.includes(".gif")) return "image/gif";
      if (hint.includes(".webp")) return "image/webp";
      if (hint.includes(".bmp")) return "image/bmp";
      if (hint.includes(".svg")) return "image/svg+xml";
    }

    if (hint.includes(".webm")) {
      return "video/webm";
    }
    if (hint.includes(".mp4")) {
      return "video/mp4";
    }
    if (hint.includes(".mov")) {
      return "video/quicktime";
    }

    if (hint.includes(".json")) {
      return "application/json";
    }
    if (hint.includes(".html") || hint.includes(".htm")) {
      return "text/html";
    }
    if (hint.includes(".md")) {
      return "text/markdown";
    }
    if (
      hint.includes(".txt") ||
      hint.includes(".log") ||
      hint.includes(".csv")
    ) {
      return "text/plain";
    }

    return null;
  }
}
