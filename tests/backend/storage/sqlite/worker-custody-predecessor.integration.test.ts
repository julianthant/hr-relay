import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it } from "vitest";
import { requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { deriveEvidenceReceiptId } from "../../../../src/models/trust/evidence-identity.js";
import { inspectNativeAuthority } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { WORKER_CUSTODY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { restoreSchema20CompletionFixture, restoreSchema22WorkerCustodyFixture, restoreSchema23WorkerCustodyFixture } from "../../../support/fixtures/storage/historical-run-schema.js";
import { rewritePredecessorCommand, writePredecessorWorkerLifetimes } from "../../../support/fixtures/storage/predecessor-worker-custody.js";
import { createRunRecordServiceTestWorld } from "../../../support/helpers/backend/run-record-service-world.js";
import { attemptingOwnedWrite } from "../../../support/helpers/backend/worker-lifetime-world.js";
import { migrateWorkerCustody } from "../../../support/helpers/storage/worker-custody-migration.js";

const world = createRunRecordServiceTestWorld();
afterEach(() => world.cleanup());

type SourceVersion = 20 | 21 | 22 | 23;

function toSourceVersion(raw: DatabaseSync, version: SourceVersion): void {
  raw.exec("BEGIN EXCLUSIVE");
  if (version === 23) restoreSchema23WorkerCustodyFixture(raw);
  else restoreSchema22WorkerCustodyFixture(raw);
  if (version === 20) restoreSchema20CompletionFixture(raw);
  else raw.exec(`UPDATE database_states SET schema_version=${String(version)}; PRAGMA user_version=${String(version)}`);
  raw.exec("COMMIT");
}

function rows(raw: DatabaseSync, sql: string, ...parameters: string[]): unknown[] { return raw.prepare(sql).all(...parameters); }

function keptRows(raw: DatabaseSync, runId: string) {
  return { runs: rows(raw, "SELECT * FROM runs WHERE id=?", runId), results: rows(raw, "SELECT * FROM run_results WHERE run_id=?", runId),
    receipts: rows(raw, "SELECT * FROM run_receipts WHERE run_id=?", runId),
    commands: rows(raw, "SELECT * FROM commands WHERE target_id=? OR json_extract(outcome_json,'$.result.runId')=? ORDER BY id", runId, runId) };
}

/**
 * A stopped store as schemas 20-22 left it: a claimed run cancelled through crash recovery with its claim, worker transitions,
 * recover-crash journal, lifecycle-evidence result and receipt all carrying the worker lifetime, beside a kept cancelled run.
 */
async function predecessorStore(version: SourceVersion, write?: "attempting") {
  const f = await world.interruptedFixture();
  const now = f.clock.now().toISOString(), runId = f.run.envelope.runId;
  const kept = world.created(f.service, { ...f.request, commandId: randomUUID(), matchKey: "kept-item" });
  const keptCancel = randomUUID();
  requireLifecycleApplied(f.service.transition({ commandId: keptCancel, runId: kept.envelope.runId, expectedVersion: kept.version,
    lifecycle: { state: "terminal", outcome: "cancelled", endedAt: now } }));
  if (write === "attempting") await attemptingOwnedWrite({ database: f.database, fence: async input => f.database.authority.writeIntents.fenceAttempt(input) }, f.run);
  const claimed = f.database.authority.runs.get(runId); assert.ok(claimed);
  const requested = f.database.authority.runs.requestCancellation({ runId, expectedVersion: claimed.version, now });
  assert.equal(requested.state, "applied"); if (requested.state !== "applied") throw new Error("cancel-request-refused");
  const recovered = requireLifecycleApplied(f.service.recoverCrash({ ...f.recoveryRequest, expectedVersion: requested.run.version }, f.lock));
  for (const run of write === "attempting" ? [f.database.authority.runs.get(kept.envelope.runId)] : [recovered, f.database.authority.runs.get(kept.envelope.runId)]) {
    assert.ok(run?.lifecycle.state === "terminal" && run.lifecycle.outcome === "cancelled");
    f.database.authority.evidenceReceipts.insert({ composition: 5, receiptId: deriveEvidenceReceiptId(run.envelope.runId, run.envelope.attempt),
      runId: run.envelope.runId, traceId: run.envelope.traceId, workflowId: run.envelope.workflow, attempt: run.envelope.attempt, generatedAt: run.lifecycle.endedAt,
      descriptorFingerprint: run.envelope.contractFingerprint, configFingerprint: run.envelope.configFingerprint, retryOf: { state: "absent" }, failure: { state: "absent" },
      input: [], observations: [], decisions: [], actions: [], verification: [], output: [], reuse: [], warnings: [], confidence: "unknown", result: "cancelled" });
  }
  const path = join(f.root, "state.db");
  await f.closeController();
  const raw = new DatabaseSync(path);
  const lifetimes = writePredecessorWorkerLifetimes(raw, runId);
  assert.deepEqual(new Set(lifetimes.map(id => String(raw.prepare("SELECT json_extract(request_json,'$.operation') AS operation FROM commands WHERE id=?").get(id)?.operation))),
    new Set(["claim-next", "worker-transition", "recover-crash"]));
  toSourceVersion(raw, version);
  return { raw, path, runId, keptRunId: kept.envelope.runId, keptCancel, recoverId: f.recoveryRequest.commandId, now };
}

it.each([20, 21, 22, 23] as const)("admits schema %s worker-lifetime journals and their cancelled recover-crash evidence only through the predecessor reader", async version => {
  const s = await predecessorStore(version);
  try {
    assert.equal(s.raw.prepare("SELECT count(*) AS count FROM run_results WHERE run_id=? AND json_extract(payload_json,'$.result.value.kind')='lifecycle-evidence'").get(s.runId)?.count, 1);
    assert.equal(s.raw.prepare("SELECT count(*) AS count FROM run_receipts WHERE run_id=?").get(s.runId)?.count, 1);
    assert.equal(inspectNativeAuthority(s.raw, version).schemaVersion, version);
    assert.equal(s.raw.prepare("SELECT count(*) AS count FROM sqlite_schema WHERE name='timeline_worker_claim_idx'").get()?.count, version === 23 ? 1 : 0);
  } finally { s.raw.close(); }
  const variants: [string, (raw: DatabaseSync) => void][] = [
    ["malformed lifetime", raw => { rewritePredecessorCommand(raw, s.recoverId, (_operation, request) => ({ ...request, workerLifetime: { membershipRevision: 0, leaseGeneration: 1 } })); }],
    ["lifetime outside the predecessor grammar", raw => { rewritePredecessorCommand(raw, s.keptCancel, (_operation, request) => ({ ...request, workerLifetime: { membershipRevision: 1, leaseGeneration: 1 } })); }],
    ["stored fingerprint not over the stored request", raw => {
      raw.exec("DROP TRIGGER IF EXISTS commands_immutable");
      const row = raw.prepare("SELECT request_json FROM commands WHERE id=?").get(s.recoverId);
      const record = JSON.parse(String(row?.request_json)) as { request: Record<string, unknown> };
      const { workerLifetime: _removed, ...request } = record.request;
      const json = canonicalJsonStringify({ ...record, request: { ...request, workerLifetime: { membershipRevision: 2, leaseGeneration: 1 } } });
      raw.prepare("UPDATE commands SET request_json=?, request_digest=? WHERE id=?").run(json, sha256Hex(json), s.recoverId);
    }],
  ];
  for (const [name, change] of variants) {
    const copy = `${s.path}.${String(variants.findIndex(entry => entry[0] === name))}`;
    copyFileSync(s.path, copy);
    const raw = new DatabaseSync(copy);
    try {
      change(raw);
      assert.throws(() => inspectNativeAuthority(raw, version), /authority table commands|authority table run_results|binding|mismatch/u, name);
    } finally { raw.close(); }
  }
});

it("converts the populated schema 22 closure, keeps unrelated evidence byte-identical and reads back strictly", async () => {
  const s = await predecessorStore(22);
  try {
    const kept = keptRows(s.raw, s.keptRunId);
    migrateWorkerCustody(s.raw, s.now);
    assert.equal(inspectNativeAuthority(s.raw, WORKER_CUSTODY_SCHEMA_VERSION).schemaVersion, WORKER_CUSTODY_SCHEMA_VERSION);
    for (const table of ["runs", "run_results", "run_receipts", "timeline_events"]) {
      assert.equal(s.raw.prepare(`SELECT count(*) AS count FROM ${table} WHERE ${table === "runs" ? "id" : "run_id"}=?`).get(s.runId)?.count, 0, table);
    }
    assert.equal(s.raw.prepare("SELECT count(*) AS count FROM deleted_runs WHERE run_id=?").get(s.runId)?.count, 1);
    for (const table of ["commands", "command_audits", "runs", "run_results", "run_receipts"]) {
      assert.ok(s.raw.prepare(`SELECT * FROM ${table}`).all().every(row => !JSON.stringify(row).includes("workerLifetime")), table);
    }
    assert.deepEqual(keptRows(s.raw, s.keptRunId), kept);
  } finally { s.raw.close(); }
});

it("refuses a closure run whose write is unresolved and rolls the store back byte for byte", async () => {
  const s = await predecessorStore(22, "attempting");
  try {
    assert.equal(inspectNativeAuthority(s.raw, 22).schemaVersion, 22);
    s.raw.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const before = readFileSync(s.path);
    assert.throws(() => { migrateWorkerCustody(s.raw, s.now); }, /authority-upgrade-unresolved-writes/u);
    s.raw.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    assert.deepEqual(readFileSync(s.path), before);
    assert.equal(inspectNativeAuthority(s.raw, 22).schemaVersion, 22);
  } finally { s.raw.close(); }
});
