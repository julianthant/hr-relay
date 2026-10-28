import { credentialKeychainTestEnvironment } from "../../../support/helpers/credential-keychain-fake.js";
import assert from "node:assert/strict";
import { chmodSync, cpSync, mkdirSync, statSync, symlinkSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, it, vi } from "vitest";
import { profileProcessQuery } from "../../../../src/backend/storage/maintenance/process-closure.js";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { workerBootstrapEnvironment } from "../../../../src/models/config/secrets.js";
import { acquireRuntimeProcessLock } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { runOfflineWorkerProcessRecovery } from "../../../../src/backend/storage/maintenance/worker-process-recovery.js";
import { runOfflineQueuedRunCancellation } from "../../../../src/backend/storage/maintenance/cancel-queued-runs.js";
import { runRecordFromRow, updateRunRecord } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import { RunCheckpointRecordSchema, checkpointRecordKey } from "../../../../src/models/workflow/checkpoint.js";
import { deriveCheckpointOutputDigest } from "../../../../src/models/run/result.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { inspectNativeAuthority } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { createHistoricalFlatProfileFixture } from "../../../support/fixtures/storage/historical-flat-profile-fixture.js";

beforeEach(() => {
  vi.spyOn(profileProcessQuery, "spawnSync").mockImplementation(command => ({ pid: 0, output: [], stderr: "", status: 0, signal: null,
    stdout: command === "/bin/ps" ? ` ${process.pid} synthetic-proof\n` : `p${process.pid}\nfcwd\ntDIR\nn/synthetic-other-root\n` }));
});
afterEach(() => vi.restoreAllMocks());

function fixture(claimGeneration = 0) {
  const f = createHistoricalFlatProfileFixture();
  const rowModule = pathToFileURL(join(process.cwd(), "src/backend/storage/sqlite/run-record-row.ts")).href;
  const recordModule = pathToFileURL(join(process.cwd(), "src/models/run/record.ts")).href;
  const changed = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    `import { DatabaseSync } from "node:sqlite"; import { runRecordFromRow, updateRunRecord } from ${JSON.stringify(rowModule)};
      import { RunRecordSchema } from ${JSON.stringify(recordModule)};
      const raw = new DatabaseSync(process.argv[1]);
      try { const current = runRecordFromRow(raw.prepare("SELECT * FROM runs").get());
        updateRunRecord(raw, RunRecordSchema.parse({ ...current, lifecycle: { state: "queued" }, claimGeneration: Number(process.argv[2]), version: current.version + 1 }));
        process.stdout.write(current.envelope.runId); } finally { raw.close(); }`, f.databasePath, String(claimGeneration)],
    { encoding: "utf8", timeout: 20_000, env: credentialKeychainTestEnvironment(workerBootstrapEnvironment()) });
  assert.equal(changed.error, undefined); assert.equal(changed.status, 0, changed.stderr);
  const runId = z.uuid().parse(changed.stdout.trim());
  return { ...f, runId };
}

it("plans without source writes, binds the exact capture, cancels with lifecycle evidence and survives the supported native6 upgrade", async () => {
  const f = fixture();
  try {
    const paths = [f.databasePath, f.protectedPath, f.artifact];
    const before = paths.map(path => readFileSync(path));
    const lockNames = readdirSync(f.processLockRoot), controlNames = readdirSync(join(f.workspace, ".tracker/control"));
    const plan = await runOfflineQueuedRunCancellation(f.workspace, ["--plan", "--json"]);
    assert.equal(plan.report.state, "planned"); assert.deepEqual(plan.report.runIds, [f.runId]);
    for (const [index, path] of paths.entries()) assert.deepEqual(readFileSync(path), before[index]);
    assert.deepEqual(readdirSync(f.processLockRoot), lockNames); assert.deepEqual(readdirSync(join(f.workspace, ".tracker/control")), controlNames);
    await assert.rejects(() => runOfflineQueuedRunCancellation(f.workspace, ["--capture", "0".repeat(64), "--apply"]), /capture-changed/u);
    assert.deepEqual(readFileSync(f.databasePath), before[0]);
    const applied = await runOfflineQueuedRunCancellation(f.workspace, ["--capture", plan.report.captureDigest, "--apply", "--json"]);
    assert.equal(applied.report.state, "cancelled");
    const raw = new DatabaseSync(f.databasePath, { readOnly: true });
    try {
      inspectNativeAuthority(raw, 6);
      const run = runRecordFromRow(raw.prepare("SELECT * FROM runs WHERE id=?").get(f.runId));
      assert.equal(run.lifecycle.state, "terminal");
      assert.deepEqual(run.lifecycle, { state: "terminal", outcome: "cancelled", endedAt: run.updatedAt, errorSummary: "cancelled offline: stale queued run" });
      assert.equal(raw.prepare("SELECT count(*) AS count FROM command_audits WHERE json_extract(payload_json,'$.kind')='run-lifecycle'").get()?.count, 1);
      assert.equal(raw.prepare("SELECT count(*) AS count FROM run_results WHERE run_id=?").get(f.runId)?.count, 1);
    } finally { raw.close(); }
    assert.deepEqual(readFileSync(f.protectedPath), before[1]); assert.deepEqual(readFileSync(f.artifact), before[2]);
  } finally { f.close(); }
});

it("refuses previously claimed queued work without mutation", async () => {
  const f = fixture(1), before = readFileSync(f.databasePath);
  try {
    await assert.rejects(() => runOfflineQueuedRunCancellation(f.workspace, ["--plan"]), /queued-run-cancellation-ineligible/u);
    assert.deepEqual(readFileSync(f.databasePath), before);
  } finally { f.close(); }
});

it("refuses unknown writes without mutation", async () => {
  const f = createHistoricalFlatProfileFixture({ unknownWrite: true }), before = readFileSync(f.databasePath);
  try {
    await assert.rejects(() => runOfflineQueuedRunCancellation(f.workspace, ["--plan"]));
    assert.deepEqual(readFileSync(f.databasePath), before);
  } finally { f.close(); }
});

it("refuses a changed native capture and a live runtime owner before applying", async () => {
  const f = fixture();
  try {
    const plan = await runOfflineQueuedRunCancellation(f.workspace, ["--plan"]);
    const raw = new DatabaseSync(f.databasePath);
    try {
      const current = runRecordFromRow(raw.prepare("SELECT * FROM runs").get());
      updateRunRecord(raw, RunRecordSchema.parse({ ...current, version: current.version + 1 }));
    } finally { raw.close(); }
    const before = readFileSync(f.databasePath);
    await assert.rejects(() => runOfflineQueuedRunCancellation(f.workspace, ["--capture", plan.report.captureDigest, "--apply"]), /capture-changed/u);
    assert.deepEqual(readFileSync(f.databasePath), before);
    const lock = acquireRuntimeProcessLock({ processLockRoot: f.processLockRoot, name: "server", pid: process.pid });
    try { await assert.rejects(() => runOfflineQueuedRunCancellation(f.workspace, ["--plan"]), /other-owner-unreleased|runtime-active/u); }
    finally { lock.release(); }
    assert.deepEqual(readFileSync(f.databasePath), before);
  } finally { f.close(); }
});

it("rejects a checkpoint-bearing queued run without touching its original bytes", async () => {
  const f = fixture();
  try {
    const raw = new DatabaseSync(f.databasePath);
    try {
      const run = runRecordFromRow(raw.prepare("SELECT * FROM runs WHERE id=?").get(f.runId));
      const checkpoint = RunCheckpointRecordSchema.parse({ workflowId: run.envelope.workflow, itemId: run.envelope.itemId,
        nodeId: "synthetic-checkpoint", attempt: run.envelope.attempt, claimGeneration: 1, runId: f.runId,
        output: { schemaHash: "a".repeat(64), value: {} }, descriptorVersion: run.envelope.descriptorVersion,
        contractFingerprint: run.envelope.contractFingerprint, implFingerprint: "b".repeat(64), provenance: [], writtenAt: run.createdAt });
      raw.prepare(`INSERT INTO run_checkpoints(id,run_id,workflow,item_id,node_id,attempt,claim_generation,output_digest,payload_json,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(checkpointRecordKey(checkpoint), f.runId, checkpoint.workflowId, checkpoint.itemId,
          checkpoint.nodeId, checkpoint.attempt, checkpoint.claimGeneration, deriveCheckpointOutputDigest(checkpoint.output), canonicalJsonStringify(checkpoint), checkpoint.writtenAt);
      inspectNativeAuthority(raw, 6);
    } finally { raw.close(); }
    const before = readFileSync(f.databasePath);
    await assert.rejects(() => runOfflineQueuedRunCancellation(f.workspace, ["--plan"]), /queued-run-cancellation-ineligible/u);
    assert.deepEqual(readFileSync(f.databasePath), before);
  } finally { f.close(); }
});

it("dispatches the actual secure-bootstrap CLI plan and apply against an isolated native6 fixture", async () => {
  const f = fixture();
  try {
    cpSync(join(process.cwd(), "src"), join(f.workspace, "src"), { recursive: true });
    mkdirSync(join(f.workspace, "scripts/dev"), { recursive: true });
    cpSync(join(process.cwd(), "scripts/dev/secure-env-bootstrap.ts"), join(f.workspace, "scripts/dev/secure-env-bootstrap.ts"));
    mkdirSync(join(f.workspace, "config"));
    for (const name of ["runtime-isolation.json", "test-data.json", "dashboard-workflow-sources.json"]) cpSync(join(process.cwd(), "config", name), join(f.workspace, "config", name));
    symlinkSync(dirname(dirname(fileURLToPath(import.meta.resolve("tsx/package.json")))), join(f.workspace, "node_modules"));
    const command = (args: string[]) => spawnSync(process.execPath,
      ["--import", "tsx", "scripts/dev/secure-env-bootstrap.ts", "cli", "storage", "cancel-queued-runs", ...args],
      { cwd: f.workspace, encoding: "utf8", timeout: 20_000, env: credentialKeychainTestEnvironment(workerBootstrapEnvironment()) });
    const planned = command(["--plan", "--json"]);
    assert.equal(planned.error, undefined); assert.equal(planned.status, 0, planned.stderr);
    const plan = z.object({ state: z.literal("planned"), captureDigest: z.string().length(64), runIds: z.array(z.uuid()) }).parse(JSON.parse(planned.stdout));
    assert.deepEqual(plan.runIds, [f.runId]);
    const applied = command(["--capture", plan.captureDigest, "--apply", "--json"]);
    assert.equal(applied.error, undefined); assert.equal(applied.status, 0, applied.stderr);
    assert.deepEqual(JSON.parse(applied.stdout), { ...plan, state: "cancelled" });
  } finally { f.close(); }
});

it("cancels before recovering a dead worker record, preserving the original process record", async () => {
  const f = fixture();
  try {
    const module = pathToFileURL(join(process.cwd(), "src/backend/storage/sqlite/runtime-process-locks.ts")).href;
    const owner = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
      `import { acquireRuntimeProcessLock } from ${JSON.stringify(module)}; const lock = acquireRuntimeProcessLock({ processLockRoot: process.argv[1], name: "workers", workerId: "person-lookup-worker-4", pid: process.pid }); process.stdout.write(lock.acquisitionId);`, f.processLockRoot],
      { encoding: "utf8", timeout: 20_000, env: credentialKeychainTestEnvironment(workerBootstrapEnvironment()) });
    assert.equal(owner.error, undefined); assert.equal(owner.status, 0, owner.stderr);
    const acquisition = z.uuid().parse(owner.stdout.trim());
    const path = join(f.processLockRoot, "workers", `${acquisition}.lock.json`), original = readFileSync(path);
    const plan = await runOfflineQueuedRunCancellation(f.workspace, ["--plan"]);
    assert.equal((await runOfflineQueuedRunCancellation(f.workspace, ["--capture", plan.report.captureDigest, "--apply"])).report.state, "cancelled");
    const recovery = runOfflineWorkerProcessRecovery(f.workspace, ["--acquisition", acquisition, "--plan"]);
    assert.equal(runOfflineWorkerProcessRecovery(f.workspace, ["--acquisition", acquisition, "--capture", recovery.report.captureDigest, "--apply"]).report.state, "recovered");
    assert.deepEqual(readFileSync(path), original);
  } finally { f.close(); }
});

it("plans and applies a safe 0644 native6 SQLite file without changing its mode", async () => {
  const f = fixture();
  try {
    chmodSync(f.databasePath, 0o644);
    const before = readFileSync(f.databasePath), protectedBytes = readFileSync(f.protectedPath);
    const plan = await runOfflineQueuedRunCancellation(f.workspace, ["--plan", "--json"]);
    assert.deepEqual(readFileSync(f.databasePath), before);
    assert.equal(statSync(f.databasePath).mode & 0o777, 0o644);
    assert.equal((await runOfflineQueuedRunCancellation(f.workspace, ["--capture", plan.report.captureDigest, "--apply", "--json"])).report.state, "cancelled");
    assert.equal(statSync(f.databasePath).mode & 0o777, 0o644);
    assert.deepEqual(readFileSync(f.protectedPath), protectedBytes);
    const raw = new DatabaseSync(f.databasePath, { readOnly: true });
    try {
      inspectNativeAuthority(raw, 6);
      const run = runRecordFromRow(raw.prepare("SELECT * FROM runs WHERE id=?").get(f.runId));
      assert.ok(run.lifecycle.state === "terminal" && run.lifecycle.outcome === "cancelled");
      assert.equal(run.lifecycle.errorSummary, "cancelled offline: stale queued run");
    } finally { raw.close(); }
  } finally { f.close(); }
});
