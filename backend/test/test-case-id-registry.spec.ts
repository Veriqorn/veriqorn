import { describe, expect, it } from "bun:test";
import type { Repository } from "typeorm";

import { TestCaseIdRegistryService } from "../src/domain/test-case-id-registry";
import type { TestCaseIdRegistry } from "../src/entities/test-case-id-registry.entity";

const createMemoryRepository = () => {
  const entries: TestCaseIdRegistry[] = [];
  let nextValue = 1;
  const repository = {
    create: (value: Partial<TestCaseIdRegistry>) => ({ id: crypto.randomUUID(), createdAt: new Date(), updatedAt: new Date(), ...value }),
    save: async (entry: TestCaseIdRegistry) => {
      const duplicate = entries.find((item) => item.projectId === entry.projectId && item.testCaseId === entry.testCaseId && item.id !== entry.id);
      if (duplicate) throw new Error("duplicate key");
      const index = entries.findIndex((item) => item.id === entry.id);
      entry.updatedAt = new Date();
      if (index === -1) entries.push(entry); else entries[index] = entry;
      return entry;
    },
    findOneBy: async (where: Partial<TestCaseIdRegistry>) => entries.find((entry) => Object.entries(where).every(([key, value]) => entry[key as keyof TestCaseIdRegistry] === value)) ?? null,
    findOneByOrFail: async (where: Partial<TestCaseIdRegistry>) => {
      const entry = entries.find((item) => Object.entries(where).every(([key, value]) => item[key as keyof TestCaseIdRegistry] === value));
      if (!entry) throw new Error("not found");
      return entry;
    },
    find: async () => entries,
  };
  return {
    entries,
    repository: repository as unknown as Repository<TestCaseIdRegistry>,
    dataSource: { query: async () => [{ testCaseId: nextValue++ }] },
  };
};

describe("TestCaseIdRegistryService", () => {
  it("confirms its owner but records a duplicate without rejecting the second result", async () => {
    const memory = createMemoryRepository();
    const service = new TestCaseIdRegistryService(memory.repository, memory.dataSource);
    const reservation = await service.reserve("project-a", "tests/cart.spec.ts::adds product", "Adds product", "user-1");

    expect(reservation.testCaseId).toBe("1");
    const secondReservation = await service.reserve("project-a", "tests/cart.spec.ts::removes product", "Removes product", "user-1");
    expect(secondReservation.testCaseId).toBe("2");

    expect((await service.observe("project-a", reservation.testCaseId, "tests/cart.spec.ts::adds product", "Adds product")).status).toBe("claimed");
    const duplicate = await service.observe("project-a", reservation.testCaseId, "tests/cart.spec.ts::removes product", "Removes product");

    expect(duplicate).toEqual({ status: "conflict", ownerIdentity: "tests/cart.spec.ts::adds product" });
    expect(memory.entries[0]).toMatchObject({ status: "conflicted", conflictCount: 1, lastConflictingIdentity: "tests/cart.spec.ts::removes product" });
    await service.observe("project-a", reservation.testCaseId, "tests/cart.spec.ts::adds product", "Adds product");
    expect(memory.entries[0].status).toBe("conflicted");
  });

  it("claims an unknown legacy ID on its first import", async () => {
    const memory = createMemoryRepository();
    const service = new TestCaseIdRegistryService(memory.repository, memory.dataSource);

    await expect(service.observe("project-a", "42", "legacy test")).resolves.toEqual({ status: "claimed", ownerIdentity: "legacy test" });
    expect(memory.entries[0]).toMatchObject({ projectId: "project-a", testCaseId: "42", status: "claimed" });
  });

  it("skips an ID claimed by a legacy import and reserves the next sequence value", async () => {
    const memory = createMemoryRepository();
    const service = new TestCaseIdRegistryService(memory.repository, memory.dataSource);
    await service.observe("project-a", "1", "legacy test");

    const reservation = await service.reserve("project-a", "tests/new.spec.ts::new test", "New test", "user-1");

    expect(reservation.testCaseId).toBe("2");
    expect(memory.entries.map((entry) => entry.testCaseId)).toEqual(["1", "2"]);
  });
});
