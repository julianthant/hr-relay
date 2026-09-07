import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { DeletedRunRecordSchema } from "../../src/domain/run/deleted-run.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/authority-database.js";
import { AUTHORITY_APPLICATION_ID, SQLITE_MIGRATIONS } from "../../src/infra/sqlite/migrations.js";
import { doctorAuthorityStorage } from "../../src/infra/sqlite/storage-doctor.js";
import { backupStoppedAuthority, upgradeStorage } from "../../src/server/storage/upgrade.js";
import { QUEUED_RUN } from "../fixtures/phase1f-run-fixtures.js";

const now = "2026-09-06T12:00:00.000Z";
const clock = manualClock(new Date(now));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(kind: "root" | "reconstructed" | "missing" | "duplicate" | "mismatch") {
  const root = mkdtempSync(join(tmpdir(), "upgrade-tombstones-")); roots.push(root);
  const path = join(root, "state.db");
  const e = QUEUED_RUN.envelope;
  const deleted = { runId: e.runId, workflow: e.workflow, traceId: e.traceId, origin: "queue", commandId: randomUUID(), deletedAt: now, removed: [{ table: "tasks", rows: 1 }] };
  const raw = new DatabaseSync(path);
  try {
    for (const migration of SQLITE_MIGRATIONS.filter(({ version }) => version <= 29)) for (const sql of migration.statements) raw.exec(sql);
    raw.prepare("INSERT INTO authority_meta(singleton_id,schema_version,authority_generation,updated_at) VALUES (1,29,7,?)").run(now);
    raw.exec(`PRAGMA application_id=${String(AUTHORITY_APPLICATION_ID)}; PRAGMA user_version=29`);
    const trigger = String(raw.prepare("SELECT sql FROM sqlite_master WHERE name='deleted_runs_require_live_run_insert'").get()?.sql);
    raw.exec("DROP TRIGGER deleted_runs_require_live_run_insert");
    raw.prepare("INSERT INTO deleted_runs VALUES (?,?,?,?,?,?,?,?)").run(e.runId, e.workflow, e.traceId, "queue", deleted.commandId, now, JSON.stringify(deleted), now);
    raw.exec(trigger);
  } finally { raw.close(); }
  const event = { pid: 4242, t: "run.queued", kind: "run", ts: now, workflow: e.workflow, runId: e.runId,
    attempt: 7, traceId: e.traceId, spanPath: e.traceId, itemId: e.itemId, shape: e.shape,
    priority: e.priority, dryRun: true, actorId: "local-operator", title: "Synthetic migration fixture",
    descriptorVersion: e.descriptorVersion, contractFingerprint: e.contractFingerprint,
    resolvedInstance: e.resolvedInstance, configFingerprint: e.configFingerprint, configSnapshotId: e.configSnapshotId,
    ...(kind === "reconstructed" ? { repair: { kind: "authority-reconstruction", repairedAt: now,
      sourceAuthorityGeneration: 7, sourceAuthorityFingerprint: "a".repeat(64), priorStreamBytes: 0, priorStreamSha256: "b".repeat(64) } } : {}) };
  const span = join(root, "spans", `${e.workflow}-2026-09-06.jsonl`);
  if (kind !== "missing") {
    mkdirSync(join(root, "spans"));
    const body = JSON.stringify(kind === "mismatch" ? { ...event, traceId: "pl-120000-9999", spanPath: "pl-120000-9999" } : event) + "\n";
    writeFileSync(span, body + (kind === "duplicate" ? body : ""));
  }
  const input = { stateRoot: root, processLockRoot: join(root, "locks"), environmentFile: join(root, ".env"), plan: false };
  return { root, path, span, deleted, input };
}

describe("D332 tombstone evidence conversion", () => {
  it.each(["root", "reconstructed", "missing"] as const)("recovers only evidenced ordinals from %s and preserves trigger/tally/evidence", async (kind) => {
    const f = fixture(kind);
    const spanBytes = kind === "missing" ? undefined : readFileSync(f.span);
    await backupStoppedAuthority(f.root, clock);
    const before = readFileSync(f.path);
    const plan = await upgradeStorage({ ...f.input, plan: true }, clock);
    assert.deepEqual(readFileSync(f.path), before);
    const expected = { fromRoots: kind === "root" ? 1 : 0, fromReconstructedRoots: kind === "reconstructed" ? 1 : 0, unknown: kind === "missing" ? 1 : 0, missingRunNumber: 1 };
    assert.deepEqual(plan.tombstoneBackfill, expected);
    assert.deepEqual((await upgradeStorage(f.input, clock)).tombstoneBackfill, expected);
    const database = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 500, migrationOwner: "tombstone-proof" }, clock);
    try {
      const tombstone = DeletedRunRecordSchema.parse(database.authority.deletedRuns.get(f.deleted.runId));
      assert.deepEqual(tombstone.removed, f.deleted.removed);
      assert.equal(tombstone.tallyVersion, 1);
      assert.equal(tombstone.runNumber, null);
      assert.equal(tombstone.attempt, kind === "missing" ? null : 7);
      assert.equal(tombstone.itemId, kind === "missing" ? null : QUEUED_RUN.envelope.itemId);
      assert.equal(tombstone.ordinalSource, kind === "missing" ? "unknown" : "span-root-backfill");
      assert.equal(database.authority.runs.nextItemAttempt({ workflow: f.deleted.workflow, itemId: QUEUED_RUN.envelope.itemId }), kind === "missing" ? 1 : 8);
      assert.equal(database.authority.runs.nextWorkflowRunNumber(f.deleted.workflow), 1);
    } finally { database.close(); }
    const raw = new DatabaseSync(f.path);
    try {
      for (const assignment of ["item_id='changed'", "attempt=8", "run_number=99", "ordinal_source='tombstone'", "workflow='changed'"]) {
        assert.throws(() => raw.exec(`UPDATE deleted_runs SET ${assignment}`), /immutable/u);
      }
    } finally { raw.close(); }
    if (spanBytes !== undefined) assert.deepEqual(readFileSync(f.span), spanBytes);
    const doctor = await doctorAuthorityStorage({ stateRootTrustAnchor: f.root, stateRoot: f.root, authorityPath: f.path, backupDirectory: join(f.root, "backups", "authority"), busyTimeoutMs: 500 }, clock);
    assert.deepEqual(doctor.tombstoneOrdinals, { state: "available", findings: [{ code: "tombstone-ordinal-unknown", runId: f.deleted.runId, missingFields: kind === "missing" ? ["itemId", "attempt", "runNumber"] : ["runNumber"] }] });
    const settledBytes = readFileSync(f.path);
    assert.deepEqual((await upgradeStorage(f.input, clock)).tombstoneBackfill, expected);
    assert.deepEqual(readFileSync(f.path), settledBytes);
  });
  it.each(["duplicate", "mismatch"] as const)("refuses %s evidence before any conversion or source mutation", async (kind) => {
    const f = fixture(kind); await backupStoppedAuthority(f.root, clock);
    const before = readFileSync(f.path); const span = readFileSync(f.span);
    for (const plan of [true, false]) await assert.rejects(upgradeStorage({ ...f.input, plan }, clock), /malformed-evidence/u);
    assert.deepEqual(readFileSync(f.path), before); assert.deepEqual(readFileSync(f.span), span);
  });
  it("rolls back backfill and restores the released trigger when failure occurs before COMMIT", async () => {
    const f = fixture("root"); await backupStoppedAuthority(f.root, clock);
    const before = readFileSync(f.path);
    await assert.rejects(upgradeStorage({ ...f.input, hooks: { beforeCommit: () => { throw new Error("injected-backfill-rollback"); } } }, clock), /injected-backfill-rollback/u);
    assert.deepEqual(readFileSync(f.path), before);
    assert.equal((await upgradeStorage(f.input, clock)).state, "converted");
  });
});
