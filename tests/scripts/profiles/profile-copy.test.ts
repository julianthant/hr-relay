import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authoritySourceDatabaseIdentity } from "../../../src/backend/storage/sqlite/database-identity.js";
import { AUTHORITY_APPLICATION_ID, CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../src/backend/storage/sqlite/migrations.js";
import { assertNoActiveRun, copyVerifiedBackups, runProfileCopy } from "../../../scripts/profiles/profile-copy.js";

const installationId = "00000000-0000-4000-8000-000000000001";
const profileId = "00000000-0000-4000-8000-000000000002";
let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "profile-copy-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function writeBackup(workspace: string, name: string, createdAt: string, bytes = "fixture-database") {
  const directory = join(workspace, ".tracker", "data", "profiles", profileId, "backups", "authority");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, name), bytes);
  const observed = { applicationId: AUTHORITY_APPLICATION_ID, schemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, installationId, profileId,
    pageCount: 1, authorityGeneration: 3, authorityContentFingerprint: "a".repeat(64) };
  writeFileSync(join(directory, `${name}.manifest.json`), JSON.stringify({ kind: "hrauto-authority-backup", manifestVersion: 4, backupFileName: name,
    sourceDatabaseIdentity: authoritySourceDatabaseIdentity({ kind: "profile", binding: { installationId, profileId } }), ...observed, createdAt,
    byteSize: "fixture-database".length, sha256: createHash("sha256").update("fixture-database").digest("hex"),
    verification: { state: "verified", observedFrom: "backup-copy", observedAt: createdAt, ...observed, quickCheck: "ok", foreignKeyViolations: 0, invariantViolations: [], exactTableRegistry: true } }));
  mkdirSync(join(workspace, ".tracker", "data", "profiles", profileId, "credentials"), { recursive: true });
  writeFileSync(join(workspace, ".tracker", "data", "profiles", profileId, "credentials", "protected.json"), "secret");
}

describe("copyVerifiedBackups", () => {
  it("copies only the newest verified backup and never credentials", () => {
    const source = join(root, "prod"), target = join(root, "staging");
    writeBackup(source, "authority-g1-1-aaaa.sqlite", "2026-11-01T00:00:00.000Z");
    writeBackup(source, "authority-g2-2-bbbb.sqlite", "2026-11-02T00:00:00.000Z");
    const [copied] = copyVerifiedBackups(source, target);
    expect(copied?.backupFileName).toBe("authority-g2-2-bbbb.sqlite");
    const profileRoot = join(target, ".tracker", "data", "profiles", profileId);
    expect(readdirSync(join(profileRoot, "backups", "authority")).sort()).toEqual(["authority-g2-2-bbbb.sqlite", "authority-g2-2-bbbb.sqlite.manifest.json"]);
    expect(existsSync(join(profileRoot, "credentials"))).toBe(false);
  });

  it("refuses a backup that does not match its manifest", () => {
    const source = join(root, "prod");
    writeBackup(source, "authority-g1-1-aaaa.sqlite", "2026-11-01T00:00:00.000Z");
    writeFileSync(join(source, ".tracker", "data", "profiles", profileId, "backups", "authority", "authority-g1-1-aaaa.sqlite"), "tampered-database");
    expect(() => copyVerifiedBackups(source, join(root, "staging"))).toThrow("backup-unverified");
  });

  it("refuses a store without backups", () => {
    expect(() => copyVerifiedBackups(join(root, "prod"), join(root, "staging"))).toThrow("source-store-missing");
  });
});

describe("assertNoActiveRun", () => {
  const idle = { statusCounts: [{ status: "done", count: 2 }], workerCards: [{ state: "idle" }] };
  it("passes an idle dashboard and a stopped one", async () => {
    await expect(assertNoActiveRun("staging", "2026-11-22", async () => idle)).resolves.toBeUndefined();
    await expect(assertNoActiveRun("staging", "2026-11-22", async () => { throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }); })).resolves.toBeUndefined();
  });

  it("refuses an active run or worker", async () => {
    await expect(assertNoActiveRun("development", "2026-11-22", async () => ({ ...idle, statusCounts: [{ status: "running", count: 1 }] }))).rejects.toThrow("active-run");
    await expect(assertNoActiveRun("development", "2026-11-22", async () => ({ ...idle, workerCards: [{ state: "running" }] }))).rejects.toThrow("active-run");
  });

  it("fails loud when the dashboard answers badly", async () => {
    await expect(assertNoActiveRun("staging", "2026-11-22", async () => { throw new Error("timeout"); })).rejects.toThrow("dashboard-status-unreadable");
    await expect(assertNoActiveRun("staging", "2026-11-22", async () => ({}))).rejects.toThrow();
  });
});

describe("runProfileCopy", () => {
  it("prints profile, ref, sha and ports, and touches nothing while a run is active", async () => {
    const source = join(root, "prod");
    writeBackup(source, "authority-g1-1-aaaa.sqlite", "2026-11-01T00:00:00.000Z");
    const calls: string[] = [];
    const git = (args: readonly string[]) => { calls.push(args.join(" ")); return args[0] === "for-each-ref" ? "origin/cut/2026-11-22" : ""; };
    const options = { profile: "staging" as const, repository: root, copyPath: join(root, "copy"), sourceWorkspace: source, targetWorkspace: join(root, "staging"), today: "2026-11-22", git };
    await expect(runProfileCopy({ ...options, get: async () => ({ statusCounts: [{ status: "running", count: 1 }], workerCards: [] }) })).rejects.toThrow("active-run");
    expect(calls).toEqual([]);
    expect(existsSync(join(root, "staging"))).toBe(false);
    const report = await runProfileCopy({ ...options, get: async () => ({ statusCounts: [], workerCards: [] }) });
    expect(report).toContain("profile: staging");
    expect(report).toContain("origin/cut/2026-11-22");
    expect(report).toContain("backend 3941, frontend 5175");
    expect(calls).toContain(`worktree add --detach ${join(root, "copy")} origin/cut/2026-11-22`);
  });
});
