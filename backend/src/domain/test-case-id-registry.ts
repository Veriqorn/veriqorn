import type { Repository } from "typeorm";

import { TestCaseIdRegistry, type TestCaseIdRegistryStatus } from "../entities/test-case-id-registry.entity";

export type TestCaseIdObservation = {
  status: "claimed" | "conflict";
  ownerIdentity: string;
};

type SequenceQueryPort = {
  query(query: string, parameters?: unknown[]): Promise<unknown>;
};

const normalize = (value: string) => value.trim();

export const isNumericTestCaseId = (value: string): boolean => /^\d+$/.test(normalize(value));

export class TestCaseIdRegistryService {
  constructor(
    private readonly repository: Repository<TestCaseIdRegistry>,
    private readonly dataSource: SequenceQueryPort,
  ) {}

  private async takeNextNumber(projectId: string): Promise<string> {
    const rows = await this.dataSource.query(
      `INSERT INTO test_case_id_sequence ("projectId", "nextValue") VALUES ($1, 2)
       ON CONFLICT ("projectId") DO UPDATE SET "nextValue" = test_case_id_sequence."nextValue" + 1
       RETURNING "nextValue" - 1 AS "testCaseId"`,
      [projectId],
    ) as Array<{ testCaseId: string | number }>;
    return String(rows[0]?.testCaseId ?? "");
  }

  async reserve(projectId: string, testIdentity: string, testName: string | undefined, reservedBy: string): Promise<TestCaseIdRegistry> {
    const identity = normalize(testIdentity);
    const name = testName ? normalize(testName) : null;
    // PostgreSQL atomically increments this per-project counter, starting from 1.
    // Old imported numeric IDs may already occupy a number, in which case skip it.
    for (;;) {
      const testCaseId = await this.takeNextNumber(projectId);
      if (!isNumericTestCaseId(testCaseId)) throw new Error("Test case ID sequence returned an invalid value");
      try {
        return await this.repository.save(this.repository.create({
          projectId,
          testCaseId,
          testIdentity: identity,
          testName: name,
          reservedBy,
          status: "reserved",
          lastSeenAt: new Date(),
          conflictCount: 0,
        }));
      } catch (error: unknown) {
        const occupied = await this.repository.findOneBy({ projectId, testCaseId });
        if (!occupied) throw error;
      }
    }
    throw new Error("Unable to reserve a test case ID");
  }

  async observe(projectId: string, testCaseId: string, testIdentity: string, testName?: string): Promise<TestCaseIdObservation> {
    const id = normalize(testCaseId);
    if (!isNumericTestCaseId(id)) {
      throw new Error("Test case ID must contain digits only");
    }
    const identity = normalize(testIdentity);
    const now = new Date();
    let record = await this.repository.findOneBy({ projectId, testCaseId: id });
    if (!record) {
      try {
        record = await this.repository.save(this.repository.create({
          projectId, testCaseId: id, testIdentity: identity, testName: testName ? normalize(testName) : null,
          status: "claimed", claimedAt: now, lastSeenAt: now, conflictCount: 0,
        }));
      } catch {
        // A competing importer may have made the first claim. Re-read and apply normal conflict handling.
        record = await this.repository.findOneByOrFail({ projectId, testCaseId: id });
      }
    }

    if (record.testIdentity === identity) {
      // Keep a prior conflict visible in the registry even when the legitimate owner runs again.
      record.status = record.conflictCount > 0 ? "conflicted" : "claimed";
      record.claimedAt ??= now;
      record.lastSeenAt = now;
      if (testName) record.testName = normalize(testName);
      await this.repository.save(record);
      return { status: "claimed", ownerIdentity: identity };
    }

    record.status = "conflicted";
    record.lastSeenAt = now;
    record.lastConflictAt = now;
    record.conflictCount += 1;
    record.lastConflictingIdentity = identity;
    record.lastConflictingName = testName ? normalize(testName) : null;
    await this.repository.save(record);
    return { status: "conflict", ownerIdentity: record.testIdentity };
  }

  async list(projectId: string, status?: TestCaseIdRegistryStatus): Promise<TestCaseIdRegistry[]> {
    return this.repository.find({ where: { projectId, ...(status ? { status } : {}) }, order: { updatedAt: "DESC" } });
  }
}
