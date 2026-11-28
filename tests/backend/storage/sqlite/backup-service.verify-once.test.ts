import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it, vi } from "vitest";
import { AuthorityBackupService, backupLogPaths } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { inspectVerifiedBackupCopyReadOnly } from "../../../../src/backend/storage/sqlite/backup-inspection.js";
import { AUTHORITY_APPLICATION_ID, CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { manualClock } from "../../../../src/rules/time/clock.js";

vi.mock("../../../../src/backend/storage/admission/admission-identity.js", () => ({ requireRuntimeAdmission: (input: unknown) => input }));
vi.mock("../../../../src/backend/storage/sqlite/backup-inspection.js", () => ({ inspectVerifiedBackupCopyReadOnly: vi.fn() }));
vi.mock("../../../../src/backend/storage/sqlite/backup-inspection-worker.js", async actual => ({
  ...await actual<typeof import("../../../../src/backend/storage/sqlite/backup-inspection-worker.js")>(),
  buildBackupLogsOffThread: (_source: string, root: string) => Promise.resolve().then(() => {
    for (const name of ["timeline.db", "dashboard.db"]) writeFileSync(join(root, name), name, { mode: 0o600 });
  }),
}));

const reads = vi.hoisted(() => ({ log: [] as { path: string; manifests: number }[], directory: "" }));
vi.mock("node:fs", async actual => {
  const fs = await actual<typeof import("node:fs")>();
  return { ...fs, createReadStream: ((path: string, ...rest: unknown[]) => {
    if (reads.directory !== "") reads.log.push({ path: String(path), manifests: fs.readdirSync(reads.directory).filter(name => name.endsWith(".manifest.json")).length });
    return (fs.createReadStream as (...args: unknown[]) => unknown)(path, ...rest);
  }) as typeof fs.createReadStream };
});

const roots: string[] = [];
afterEach(() => { reads.directory = ""; reads.log.length = 0; vi.mocked(inspectVerifiedBackupCopyReadOnly).mockReset(); for (const root of roots.splice(0)) rmSync(root, { recursive: true }); });

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "backup-verify-once-"))), directory = join(root, "backups", "authority");
  roots.push(root);
  const installationId = randomUUID(), profileId = randomUUID(), binding = { installationId, profileId };
  const admission = { stateRoot: root, profileBinding: binding,
    assertAuthorityBackupWrite: (path: string) => assert.equal(path, directory), assertStateRoot: () => undefined,
    authorityBackupExpectedSource: () => ({ kind: "profile" as const, binding }),
    verifiedReadOnlyCopy: () => ({ release: () => undefined }) };
  const meta = { authorityGeneration: 7, schemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION };
  const source = { getMeta: () => meta, getSourceDatabaseIdentity: () => "unused",
    onlineBackupTo: (path: string) => { writeFileSync(path, "synthetic authority copy bytes", { mode: 0o600 }); return Promise.resolve(); } };
  const inspection = { applicationId: AUTHORITY_APPLICATION_ID, schemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION,
    installationId, profileId, pageCount: 1, authorityGeneration: 7, authorityContentFingerprint: "b".repeat(64),
    quickCheck: "ok", foreignKeyViolations: 0, invariantViolations: [], exactTableRegistry: true } as unknown as ReturnType<typeof inspectVerifiedBackupCopyReadOnly>;
  vi.mocked(inspectVerifiedBackupCopyReadOnly).mockReturnValue(inspection);
  // @ts-expect-error This unit test replaces issued admission and the native backup source.
  const service = new AuthorityBackupService(admission, source, { directory, purpose: "clean-shutdown" }, manualClock(new Date("2026-11-14T08:00:00.000Z")));
  return { service, directory, inspection };
}

it("reads a new quit-time backup's bytes twice and inspects it once, publishing its manifest only after the final bytes verified", async () => {
  const f = fixture();
  reads.directory = f.directory;
  const report = await f.service.request({ trigger: "graceful-drain", requiredGeneration: 7 });
  const manifest = report.manifests.at(-1); assert.ok(manifest);
  assert.equal(vi.mocked(inspectVerifiedBackupCopyReadOnly).mock.calls.length, 1);
  assert.equal(reads.log.filter(entry => /\.sqlite(?:\.tmp)?$/u.test(entry.path)).length, 2);
  assert.deepEqual(reads.log.map(read => read.manifests), [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(readdirSync(f.directory).sort(),
    [manifest.backupFileName, `${manifest.backupFileName}.manifest.json`, ...backupLogPaths(manifest.backupFileName)].sort());
});

it("publishes no backup when its bytes change after the inspection", async () => {
  const f = fixture();
  vi.mocked(inspectVerifiedBackupCopyReadOnly).mockImplementation((_admission, path) => {
    writeFileSync(path, "replaced bytes after inspection", { mode: 0o600 });
    return f.inspection;
  });
  await assert.rejects(f.service.request({ trigger: "graceful-drain", requiredGeneration: 7 }), /does not match/u);
  assert.deepEqual(readdirSync(f.directory), []);
});
