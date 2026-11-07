import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it } from "vitest";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { executeSettingsCommand } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { reconcileExitedWorker } from "../../../../src/backend/runs/lifecycle/startup-crash-recovery.js";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/profile-browser-closure.js";
import { readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { createCredentialStore as createProfileCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { upgradeProfileAtStartup } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { AuthorityDatabase as ProfileAuthorityDatabase, inspectNativeAuthority } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION, isWorkerCustodyDroppedTable } from "../../../../src/backend/storage/sqlite/migrations.js";
import { AuthorityBackupManifestSchema } from "../../../../src/backend/storage/sqlite/recovery-contracts.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../../src/models/config/settings.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { terminalEvidenceResult } from "../../../../src/models/run/result.js";
import { deriveEvidenceReceiptId } from "../../../../src/models/trust/evidence-identity.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { bindWorkflowDelegationTargets } from "../../../../src/workflow-kit/workflow.js";
import { childPolicyModules } from "../../../support/fixtures/child-execution-workflows.js";
import { plan1Stores } from "../../../support/fixtures/plan1-operation-workflows.js";
import { testAdmittedWorker } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { restoreSchema20CompletionFixture } from "../../../support/fixtures/storage/historical-run-schema.js";
import { restorePredecessorCustodySchema, writePredecessorWorkerLifetimes } from "../../../support/fixtures/storage/predecessor-worker-custody.js";
import { canonicalChildExecution } from "../../../support/helpers/backend/canonical-child-execution.js";
import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import { attemptingOwnedWrite } from "../../../support/helpers/backend/worker-lifetime-world.js";
import { createCredentialStore } from "../../../support/helpers/synthetic-storage-admission.js";

const world = createRunExecutorTestWorld();
afterEach(world.cleanup);

type SourceVersion = 20 | 21 | 22;
type Variant = "converted" | "attempting-write" | "kept-reference";
const hostFacts = { primaryDisplay: null };
// Tables the conversion (and on 20/21 the pre-build run deletion) rewrites; every other table must come through byte for byte.
const CHANGED_TABLES = new Set(["runs", "deleted_runs", "commands", "command_audits", "timeline_events", "run_search", "run_results", "run_receipts",
  "run_checkpoints", "run_delegations", "delegation_dependencies", "run_requests", "worker_slots", "notifications", "write_intents", "write_attempts",
  "artifact_outbox", "database_states"]);

/**
 * A real delegation tree on the current schema, then returned to schema 20-22: a cancelled member recovered from a worker crash
 * (claim, recover-crash, lifecycle-evidence result and receipt, all carrying the worker lifetime), the parent's join of its
 * resultDigest and the operator's retry embedding it, beside a kept unrelated run with its receipt, a library type and saved settings.
 * The kept-reference variant points the kept settings row at the closure's retry command.
 */
async function predecessorStore(version: SourceVersion, variant: Variant) {
  const { root: compiled, modules } = childPolicyModules("cascade");
  bindWorkflowDelegationTargets(modules.map(module => module.descriptor));
  const h = await world.executorHarness({ descriptor: compiled.descriptor, stores: plan1Stores });
  const { database, clock, path, stateRoot, profile } = h.authority;
  const profileId = profile.admission.profileBinding.profileId;
  const settings = createSettingsApplicationExecutor(value => resolveConfigWithProvenance(value, hostConfigFacts({}), clock), createCredentialStore({ stateRoot }));
  const settingsDependencies = { authority: database, clock, ids: { uuid: randomUUID }, settings, authorityProfileId: profileId };
  const patch = { "actor.label": { set: "Synthetic operator" } } as const;
  assert.equal(executeSettingsCommand(settingsDependencies, { commandId: randomUUID(), family: "settings", type: "apply-settings", source: "settings-surface",
    requestedBy: "local-operator", requestedAt: clock.now().toISOString(), target: { expectedRevision: readSettings(database.authority).revision },
    payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } }).state, "applied");
  const execution = canonicalChildExecution(h.deps, database, path, id => modules.find(module => module.descriptor.id === id)?.descriptor);
  const current = (runId: string) => { const run = database.authority.runs.get(runId); assert.ok(run); return run; };
  const receipt = (run: RunRecord) => {
    assert.ok(run.lifecycle.state === "terminal");
    database.authority.evidenceReceipts.insert({ composition: 5, receiptId: deriveEvidenceReceiptId(run.envelope.runId, run.envelope.attempt),
      runId: run.envelope.runId, traceId: run.envelope.traceId, workflowId: run.envelope.workflow, attempt: run.envelope.attempt, generatedAt: run.lifecycle.endedAt,
      descriptorFingerprint: run.envelope.contractFingerprint, configFingerprint: run.envelope.configFingerprint, retryOf: { state: "absent" }, failure: { state: "absent" },
      input: [], observations: [], decisions: [], actions: [], verification: [], output: [], reuse: [], warnings: [], confidence: "unknown",
      result: run.lifecycle.outcome === "cancelled" ? "cancelled" : "failed" });
  };

  const kept = execution.start(compiled.descriptor, { emplId: "10800001", text: "kept", mode: "ok" }, { dryRun: false });
  assert.equal(execution.kernel.execute(CommandRequestSchema.parse({ commandId: randomUUID(), family: "run", type: "cancel", source: "dashboard", requestedBy: "local-operator",
    requestedAt: clock.now().toISOString(), target: { runId: kept.envelope.runId, expectedVersion: kept.version } })).state, "applied");
  receipt(current(kept.envelope.runId));

  const root = execution.start(compiled.descriptor, { emplId: "10800000", text: "same", mode: "ok" }, { dryRun: false });
  assert.equal((await execution.step(root, world.SIGNAL)).outcome.state, "yielded-delegation");
  const [queuedChild] = database.authority.runs.listChildren(root.envelope.runId); assert.ok(queuedChild);
  // A second worker crashes, so the root's home worker stays live for the join.
  const owner = testAdmittedWorker(database, clock, { path, workflow: root.envelope.workflow, poolIndex: 2, browserSystems: [] }), active = database.authority.runtimeConfig.get(); assert.ok(active);
  const claimed = execution.lifecycle.claimNext({ commandId: randomUUID(), workflow: root.envelope.workflow, workerId: owner.workerId,
    runtimeConfig: { generation: active.generation, settingsRevision: active.settingsRevision, settingsFingerprint: active.settingsFingerprint, configFingerprint: active.configFingerprint } });
  assert.ok(claimed.state === "applied" && "run" in claimed);
  assert.equal(claimed.run.envelope.runId, queuedChild.envelope.runId);
  const childId = queuedChild.envelope.runId, claim = { workerId: owner.workerId, claimGeneration: claimed.run.claimGeneration };
  if (variant === "attempting-write") {
    requireLifecycleApplied(execution.lifecycle.workerTransition({ commandId: randomUUID(), runId: childId, claim,
      lifecycle: { state: "validating", workerId: owner.workerId, claimedAt: clock.now().toISOString(), heartbeatAt: clock.now().toISOString() } }));
    const running = requireLifecycleApplied(execution.lifecycle.workerTransition({ commandId: randomUUID(), runId: childId, claim,
      lifecycle: { state: "running", workerId: owner.workerId, claimedAt: clock.now().toISOString(), heartbeatAt: clock.now().toISOString(), currentNodeId: "crm-dates" } }));
    await attemptingOwnedWrite({ database, fence: async input => database.authority.writeIntents.fenceAttempt(input) }, running);
  }
  // The operator's cancel of the claimed member only requests it; the worker exit settles it cancelled. A fenced write refuses the cancel.
  if (variant !== "attempting-write") {
    assert.equal(execution.kernel.execute(CommandRequestSchema.parse({ commandId: randomUUID(), family: "run", type: "cancel", source: "dashboard", requestedBy: "local-operator",
      requestedAt: clock.now().toISOString(), reason: "Synthetic member cancel", target: { runId: childId, expectedVersion: current(childId).version } })).state, "applied");
    assert.equal(current(childId).cancelRequested, true);
  }
  const lock = profile.machine.lifetime; assert.ok(lock instanceof RuntimeLifetimeLock);
  reconcileExitedWorker({ machine: profile.machine, admission: profile.admission, database, clock, lifecycle: execution.lifecycle, lock, workerId: owner.workerId });
  const closure = [root.envelope.runId, childId];
  let retryCommandId: string | undefined, childDigest: string | undefined;
  if (variant !== "attempting-write") {
    const cancelled = current(childId);
    assert.ok(cancelled.lifecycle.state === "terminal" && cancelled.lifecycle.outcome === "cancelled", JSON.stringify(cancelled.lifecycle));
    const evidence = database.authority.runResults.get(childId); assert.ok(evidence);
    assert.equal(terminalEvidenceResult(evidence)?.kind, "lifecycle-evidence");
    receipt(cancelled);
    const joined = await execution.step(root, world.SIGNAL);
    const parent = current(root.envelope.runId);
    assert.ok(parent.lifecycle.state === "terminal" && parent.lifecycle.outcome === "failed", JSON.stringify({ outcome: joined.outcome, lifecycle: parent.lifecycle }));
    retryCommandId = randomUUID();
    const retried = execution.kernel.execute(CommandRequestSchema.parse({ commandId: retryCommandId, family: "run", type: "recover-run", source: "dashboard",
      requestedBy: "local-operator", requestedAt: clock.now().toISOString(), target: { runId: root.envelope.runId, expectedVersion: parent.version } }));
    assert.equal(retried.state, "applied", JSON.stringify(retried));
    for (const run of [cancelled, parent].flatMap(run => database.authority.runs.listByItem({ workflow: run.envelope.workflow, itemId: run.envelope.itemId }))) {
      if (!closure.includes(run.envelope.runId)) closure.push(run.envelope.runId);
    }
    childDigest = evidence.resultDigest;
  }

  database.authority.workbooks.putType({ id: "custody-roster", name: "Custody roster", keyFieldId: "eid", fields: ["eid"], defaultWorkbookId: null });

  h.authority.closeDatabase();
  await h.manager.closeAll("worker-stop");
  profile.admission.release();
  const raw = new DatabaseSync(path);
  try {
    raw.exec("PRAGMA foreign_keys=ON");
    assert.notEqual(writePredecessorWorkerLifetimes(raw, childId).length, 0);
    raw.exec("BEGIN EXCLUSIVE");
    restorePredecessorCustodySchema(raw);
    if (variant === "kept-reference") raw.prepare("UPDATE settings SET command_id=?").run(retryCommandId ?? "");
    if (version === 20) restoreSchema20CompletionFixture(raw);
    else raw.exec(`UPDATE database_states SET schema_version=${String(version)}; PRAGMA user_version=${String(version)}`);
    raw.exec("COMMIT");
    assert.equal(inspectNativeAuthority(raw, version).schemaVersion, version);
  } finally { raw.close(); }
  return { profile, path, stateRoot, profileId, closure, keptRunId: kept.envelope.runId, childDigest };
}

function read(path: string) {
  const raw = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = raw.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => String(row.name));
    return {
      kept: Object.fromEntries(tables.filter(table => !CHANGED_TABLES.has(table) && !isWorkerCustodyDroppedTable(table))
        .map(table => [table, raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])),
      triggers: raw.prepare("SELECT name, sql FROM sqlite_schema WHERE type='trigger' AND name NOT LIKE 'worker_%' AND name NOT LIKE 'browser_%' ORDER BY name").all(),
      run: (runId: string) => ["runs", "run_results", "run_receipts"].map(table => raw.prepare(`SELECT * FROM ${table} WHERE ${table === "runs" ? "id" : "run_id"}=? ORDER BY rowid`).all(runId)),
      everyRow: () => tables.flatMap(table => raw.prepare(`SELECT * FROM ${table}`).all().map(row => ({ table, json: JSON.stringify(row) }))),
      count: (sql: string, ...parameters: string[]) => Number(raw.prepare(sql).get(...parameters)?.count),
      foreignKeys: raw.prepare("PRAGMA foreign_key_check").all(),
    };
  } finally { raw.close(); }
}

const upgrade = (s: Awaited<ReturnType<typeof predecessorStore>>) => upgradeProfileAtStartup(profileBrowserClosure, s.profile.machine, s.profileId, hostFacts, systemClock);

it.each([20, 21, 22] as const)("deletes the schema %s digest-linked recover-crash closure from a verified backup and reads the kept store back strictly", async version => {
  const s = await predecessorStore(version, "converted");
  const before = read(s.path), keptRun = before.run(s.keptRunId);
  assert.equal(keptRun[2]?.length, 1, "the kept run carries its receipt");
  assert.equal(before.count("SELECT count(*) AS count FROM run_delegations WHERE parent_run_id=?", s.closure[0] ?? ""), 1);
  assert.ok(before.count("SELECT count(*) AS count FROM delegation_dependencies") >= 1);
  const digest = s.childDigest; assert.ok(digest !== undefined);
  const linked = before.everyRow().filter(row => row.table !== "run_results" && row.json.includes(digest)).map(row => row.table);
  assert.ok(linked.length > 0, "the join and retry embed the cancelled member's resultDigest");
  assert.equal((await upgrade(s)).state, "upgraded");

  const backups = join(s.stateRoot, "backups", "authority");
  assert.ok(readdirSync(backups).filter(name => name.endsWith(".manifest.json"))
    .some(name => AuthorityBackupManifestSchema.parse(JSON.parse(readFileSync(join(backups, name), "utf8"))).schemaVersion === version));
  const after = read(s.path);
  assert.deepEqual(after.kept, before.kept);
  assert.deepEqual(after.triggers, before.triggers);
  assert.deepEqual(after.foreignKeys, []);
  for (const runId of s.closure) {
    assert.equal(after.count("SELECT count(*) AS count FROM runs WHERE id=?", runId), 0, runId);
    assert.equal(after.count("SELECT count(*) AS count FROM deleted_runs WHERE run_id=?", runId), 1, runId);
  }
  for (const table of ["run_delegations", "delegation_dependencies", "run_results", "run_receipts", "timeline_events", "notifications"]) {
    assert.ok(after.everyRow().filter(row => row.table === table).every(row => s.closure.every(runId => !row.json.includes(runId))), table);
  }
  assert.deepEqual(after.everyRow().filter(row => row.json.includes(digest)).map(row => row.table), []);
  assert.ok(after.everyRow().every(row => !row.json.includes("workerLifetime") && !row.json.includes("membershipRevision") && !row.json.includes("controlBasis")),
    "the removed custody grammar is gone");
  assert.equal(after.count("SELECT count(*) AS count FROM commands WHERE family='worker-browser'"), 0);
  // Schema 22 keeps every run built by this release; 20 and 21 tombstone the pre-build runs, the kept one among them.
  if (version === 22) assert.deepEqual(after.run(s.keptRunId), keptRun);
  else assert.equal(after.count("SELECT count(*) AS count FROM deleted_runs WHERE run_id=?", s.keptRunId), 1);

  const admission = s.profile.machine.admitProfile(s.profileId);
  try {
    const database = ProfileAuthorityDatabase.open(admission, { path: s.path, busyTimeoutMs: 250, migrationOwner: "selected-profile-runtime" }, systemClock,
      undefined, undefined, undefined, createProfileCredentialStore({ admission, stateRoot: s.stateRoot }));
    try {
      assert.equal(inspectNativeAuthority(new DatabaseSync(s.path, { readOnly: true })).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
      if (version === 22) {
        const run = database.authority.runs.get(s.keptRunId);
        assert.ok(run?.lifecycle.state === "terminal" && run.lifecycle.outcome === "cancelled");
        assert.equal(database.authority.runResults.get(s.keptRunId)?.runId, s.keptRunId);
      }
      assert.match(JSON.stringify(readSettings(database.authority).settings), /Synthetic operator/u);
      assert.equal(database.authority.workbooks.types().find(type => type.id === "custody-roster")?.name, "Custody roster");
    } finally { database.close(); }
  } finally { admission.release(); }
});

it.each(([20, 21, 22] as const).flatMap(version => (["attempting-write", "kept-reference"] as const).map(variant => ({ version, variant }))))(
  "refuses a schema $version closure with $variant and leaves the store byte-identical", async ({ version, variant }) => {
    const s = await predecessorStore(version, variant);
    const bytes = readFileSync(s.path), before = read(s.path);
    await assert.rejects(upgrade(s), variant === "attempting-write" ? /authority-upgrade-unresolved-writes/u : /authority-upgrade-retained-run-reference/u);
    assert.deepEqual(readFileSync(s.path), bytes);
    const after = read(s.path);
    assert.deepEqual(after.kept, before.kept);
    assert.deepEqual(after.triggers, before.triggers);
    const raw = new DatabaseSync(s.path, { readOnly: true });
    try { assert.equal(inspectNativeAuthority(raw, version).schemaVersion, version); } finally { raw.close(); }
  });
