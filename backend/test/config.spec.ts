import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

import { afterEach, describe, expect, it } from "bun:test";

import { createDataSource, resolveMigrationsGlob, validateInstallationIdentityEncryption } from "../src/config";
import { createTestConfig } from "./test-helpers";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

const createTempRoots = () => {
  const root = mkdtempSync(join(tmpdir(), "backend-config-"));
  tempRoots.push(root);

  return {
    projectRoot: join(root, "backend"),
  };
};

describe("resolveMigrationsGlob", () => {
  it("uses packaged backend migrations when they exist", () => {
    const { projectRoot } = createTempRoots();
    mkdirSync(join(projectRoot, "migrations"), { recursive: true });

    const migrationsGlob = resolveMigrationsGlob(projectRoot);

    expect(migrationsGlob).toBe(
      resolve(projectRoot, "migrations", "*{.ts,.js}"),
    );
  });

  it("defaults to packaged backend migrations even before the directory exists", () => {
    const { projectRoot } = createTempRoots();

    const migrationsGlob = resolveMigrationsGlob(projectRoot);

    expect(migrationsGlob).toBe(
      resolve(projectRoot, "migrations", "*{.ts,.js}"),
    );
  });

  it("honors an explicit override when present", () => {
    const { projectRoot } = createTempRoots();
    mkdirSync(join(projectRoot, "custom-migrations"), { recursive: true });

    const migrationsGlob = resolveMigrationsGlob(
      projectRoot,
      "custom-migrations",
    );

    expect(migrationsGlob).toBe(
      resolve(projectRoot, "custom-migrations", "*{.ts,.js}"),
    );
  });
});

describe("installation identity encryption configuration", () => {
  it("requires a master key only when the deployment policy enables it", () => {
    expect(() => validateInstallationIdentityEncryption({
      VERIQORN_REQUIRE_ENCRYPTED_INSTALLATION_IDENTITY: "true",
    })).toThrow("VERIQORN_INSTALLATION_KEY_ENCRYPTION_KEY is required");
    expect(() => validateInstallationIdentityEncryption({})).not.toThrow();
  });

  it("rejects malformed configured master keys before startup", () => {
    expect(() => validateInstallationIdentityEncryption({
      VERIQORN_INSTALLATION_KEY_ENCRYPTION_KEY: "too-short",
    })).toThrow("32-byte base64url");
  });
});

describe("Core database composition", () => {
  it("does not statically compose Enterprise AI entities", () => {
    const dataSource = createDataSource(createTestConfig());
    const names = ((dataSource.options.entities || []) as Array<{ name?: string }>).map((entity) => entity.name);

    expect(names).not.toContain("AiAnalysisResult");
    expect(names).not.toContain("AiAnalysisChatMessage");
    expect(names).not.toContain("KbArticle");
  });
});
