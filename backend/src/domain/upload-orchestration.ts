import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";

import { HttpError } from "../errors";

export type IngestionDiagnostics = { correlationId: string; source: string };

export interface ImportFromDirectoryParams {
  directoryPath: string;
  testRunId: number;
  parentRunId?: string;
  source: string;
}

// Interface matching AllureImportService methods used by this orchestrator
interface AllureImportAdapter {
  deleteResultsByName(testRunId: number, names: string[]): Promise<number>;
  importFromDirectory(directoryPath: string, testRunId: number, ignored: undefined, diagnostics: IngestionDiagnostics): Promise<void>;
}

export class UploadOrchestrationService {
  constructor(private readonly allureImportService: AllureImportAdapter) {}

  createDiagnostics(source: string): IngestionDiagnostics {
    return { correlationId: randomUUID(), source };
  }

  logDiagnostics(level: "log" | "warn" | "error", diagnostics: IngestionDiagnostics, message: string, metadata: Record<string, unknown> = {}): void {
    const payload = JSON.stringify({ correlationId: diagnostics.correlationId, source: diagnostics.source, message, ...metadata });
    if (level === "error") console.error(payload);
    else if (level === "warn") console.warn(payload);
    else console.log(payload);
  }

  throwValidationError(message: string, diagnostics?: IngestionDiagnostics): never {
    if (diagnostics) this.logDiagnostics("warn", diagnostics, message);
    throw new HttpError(400, "IMPORT_VALIDATION", message);
  }

  throwImportError(error: unknown, diagnostics?: IngestionDiagnostics): never {
    if (error instanceof HttpError) throw error;
    const message = error instanceof Error ? error.message : "Unknown error";
    if (diagnostics) this.logDiagnostics("error", diagnostics, "Import pipeline failed", { error: message });
    throw new HttpError(500, "IMPORT_FAILED", `Failed to import test results: ${message}`);
  }

  scanAndValidateDirectory(directoryPath: string, diagnostics: IngestionDiagnostics): { dirFiles: string[]; resultFiles: string[] } {
    const dirFiles = fs.readdirSync(directoryPath);
    const resultFiles = dirFiles.filter((f) => f.endsWith("-result.json") || f.endsWith("result.json"));
    this.logDiagnostics("log", diagnostics, "Directory scan complete", { resultFileCount: resultFiles.length, totalFileCount: dirFiles.length });
    if (resultFiles.length === 0) {
      const jsonFiles = dirFiles.filter((f) => f.endsWith(".json"));
      if (jsonFiles.length === 0) throw new Error("No result files found in the uploaded directory");
    }
    return { dirFiles, resultFiles };
  }

  async deleteOldResultsFromDirectory(directoryPath: string, testRunId: number): Promise<void> {
    const files = fs.readdirSync(directoryPath);
    const resultFiles = files.filter((f) => f.endsWith("-result.json") || f.endsWith("result.json"));
    const testNames: string[] = [];
    for (const file of resultFiles) {
      try {
        const content = fs.readFileSync(path.join(directoryPath, file), "utf8");
        const data = JSON.parse(content) as Record<string, unknown>;
        if (data.name && typeof data.name === "string") testNames.push(data.name);
      } catch { /* skip unparseable */ }
    }
    if (testNames.length > 0) {
      await this.allureImportService.deleteResultsByName(testRunId, testNames);
    }
  }

  async importFromDirectory(params: ImportFromDirectoryParams, diagnostics: IngestionDiagnostics): Promise<void> {
    this.scanAndValidateDirectory(params.directoryPath, diagnostics);
    if (params.parentRunId) {
      await this.deleteOldResultsFromDirectory(params.directoryPath, params.testRunId);
    }
    await this.allureImportService.importFromDirectory(params.directoryPath, params.testRunId, undefined, diagnostics);
  }

  parseTags(raw?: string | string[]): string[] {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
}
