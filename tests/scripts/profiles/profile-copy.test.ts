import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authoritySourceDatabaseIdentity } from "../../../src/backend/storage/sqlite/database-identity.js";
import { AUTHORITY_APPLICATION_ID, CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../src/backend/storage/sqlite/migrations.js";
import { RuntimeAlreadyRunningError, acquireRuntimeLifetimeLock } from "../../../src/backend/storage/admission/lifetime-lock.js";
import { copyVerifiedBackups, resolveSourceRef, runProfileCopy, withProfileLock } from "../../../scripts/profiles/profile-copy.js";

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

  it("refuses a person without a verified backup and clears an interrupted earlier copy", () => {
    const source = join(root, "prod"), target = join(root, "staging");
    writeBackup(source, "authority-g1-1-aaaa.sqlite", "2026-11-01T00:00:00.000Z");
    mkdirSync(join(source, ".tracker", "data", "profiles", "00000000-0000-4000-8000-000000000001"), { recursive: true });
    const stale = join(target, ".tracker", "data", "profiles", profileId, "backups", "authority");
    mkdirSync(stale, { recursive: true });
    writeFileSync(join(stale, ".half.tmp"), "x"); writeFileSync(join(stale, "authority-orphan.sqlite"), "x");
    expect(() => copyVerifiedBackups(source, target)).toThrow("source-backup-missing");
    expect(readdirSync(stale)).toEqual([]);
  });

  it("re-lists when production prunes a backup mid-copy, and refuses if it keeps pruning", () => {
    const source = join(root, "prod");
    writeBackup(source, "authority-g1-1-aaaa.sqlite", "2026-11-01T00:00:00.000Z");
    const directory = join(source, ".tracker", "data", "profiles", profileId, "backups", "authority");
    // The manifest names a database that was pruned between listing and reading.
    unlinkSync(join(directory, "authority-g1-1-aaaa.sqlite"));
    expect(() => copyVerifiedBackups(source, join(root, "staging"))).toThrow("source-backup-pruned");
  });

  it("refuses a store without backups", () => {
    expect(() => copyVerifiedBackups(join(root, "prod"), join(root, "staging"))).toThrow("source-store-missing");
  });
});

describe("withProfileLock", () => {
  it("refuses while the profile lifetime lock is held and works once it is released", async () => {
    const held = await acquireRuntimeLifetimeLock(0);
    const acquire = (port: number) => acquireRuntimeLifetimeLock(port === 3942 ? held.port : port);
    await expect(withProfileLock("staging", async () => "ran", acquire)).rejects.toThrow("profile-running");
    await held.close();
    await expect(withProfileLock("staging", async () => "ran", acquire)).resolves.toBe("ran");
  });

  it("holds the lock for the whole update and releases it on failure", async () => {
    const events: string[] = [];
    const acquire = async () => ({ close: async () => { events.push("release"); } });
    await expect(withProfileLock("development", async () => { events.push("work"); throw new Error("boom"); }, acquire)).rejects.toThrow("boom");
    expect(events).toEqual(["work", "release"]);
  });

  it("rethrows an unrelated lock failure", async () => {
    await expect(withProfileLock("staging", async () => 1, async () => { throw new Error("other"); })).rejects.toThrow("other");
  });
});

describe("resolveSourceRef", () => {
  const gitWith = (cuts: string) => (args: readonly string[]) => (args[0] === "for-each-ref" ? cuts : "");
  it("takes the only cut, refuses several without a choice, and honours a listed choice", () => {
    expect(resolveSourceRef("staging", gitWith("origin/cut/a"))).toBe("origin/cut/a");
    expect(() => resolveSourceRef("staging", gitWith("origin/cut/a\norigin/cut/b"))).toThrow("cut-branch-ambiguous");
    expect(resolveSourceRef("staging", gitWith("origin/cut/a\norigin/cut/b"), "origin/cut/b")).toBe("origin/cut/b");
    expect(() => resolveSourceRef("staging", gitWith("origin/cut/a"), "origin/cut/zzz")).toThrow("ref-refused");
    expect(() => resolveSourceRef("staging", gitWith(""))).toThrow("cut-branch-missing");
    expect(resolveSourceRef("development", gitWith(""))).toBe("origin/development");
  });
});

describe("runProfileCopy", () => {
  it("prints profile, ref, sha and ports, and touches nothing while the profile lock is held", async () => {
    const source = join(root, "prod");
    writeBackup(source, "authority-g1-1-aaaa.sqlite", "2026-11-01T00:00:00.000Z");
    const calls: string[] = [];
    const git = (args: readonly string[]) => { calls.push(args.join(" ")); return args[0] === "for-each-ref" ? "origin/cut/2026-11-22" : ""; };
    const options = { profile: "staging" as const, repository: root, copyPath: join(root, "copy"), sourceWorkspace: source, targetWorkspace: join(root, "staging"), git, gitFor: () => () => "0123abc" };
    const held = await acquireRuntimeLifetimeLock(0);
    await expect(runProfileCopy({ ...options, acquire: () => acquireRuntimeLifetimeLock(held.port) })).rejects.toThrow("profile-running");
    await held.close();
    expect(calls).toEqual([]);
    expect(existsSync(join(root, "staging"))).toBe(false);
    const report = await runProfileCopy({ ...options, acquire: async () => ({ close: async () => undefined }) });
    expect(report).toContain("profile: staging");
    expect(report).toContain("origin/cut/2026-11-22 @ 0123abc");
    expect(report).toContain("backend 3941, frontend 5175");
    expect(calls).toContain(`worktree add --detach ${join(root, "copy")} origin/cut/2026-11-22`);
  });
});
