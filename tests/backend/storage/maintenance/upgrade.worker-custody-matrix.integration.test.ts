import { CHANGE_LOG_OBJECTS } from "../../../../src/backend/storage/sqlite/authority-change-log.js";
import assert from "node:assert/strict";
import { createHash,randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { afterEach, it } from "vitest";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { executeSettingsCommand } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { reconcileExitedWorker } from "../../../../src/backend/runs/lifecycle/startup-crash-recovery.js";
import { createWorkbookLibraryService } from "../../../../src/backend/workbooks/workbook-library-service.js";
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
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { lifecycleCommandId } from "../../../../src/rules/commands/lifecycle-command-id.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { bindWorkflowDelegationTargets } from "../../../../src/workflow-kit/workflow.js";
import { childPolicyModules } from "../../../support/fixtures/child-execution-workflows.js";
import { plan1Stores } from "../../../support/fixtures/plan1-operation-workflows.js";
import { testAdmittedWorker } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { restoreSchema20CompletionFixture, restoreSchema22WorkerCustodyFixture, restoreSchema23WorkerCustodyFixture } from "../../../support/fixtures/storage/historical-run-schema.js";
import { rebindPredecessorResultDigest, writePredecessorWorkerLifetimes } from "../../../support/fixtures/storage/predecessor-worker-custody.js";
import { canonicalChildExecution } from "../../../support/helpers/backend/canonical-child-execution.js";
import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import { unexpectedWorkbookSync } from "../../../support/helpers/backend/workbook-sync.js";
import { attemptingOwnedWrite } from "../../../support/helpers/backend/worker-lifetime-world.js";
import { createCredentialStore } from "../../../support/helpers/synthetic-storage-admission.js";

const world = createRunExecutorTestWorld();
afterEach(world.cleanup);

type SourceVersion = 20 | 21 | 22 | 23;
type Variant = "converted" | "attempting-write" | "kept-reference";
const hostFacts = { primaryDisplay: null };
// Tables the conversion (and on 20/21 the pre-build run deletion) rewrites; every other table must come through byte for byte.
const CHANGED_TABLES = new Set(["runs", "deleted_runs", "run_failures", "run_batches", "database_upgrades", "commands", "command_audits", "timeline_events", "run_search", "run_results", "run_receipts",
  "run_checkpoints", "run_delegations", "delegation_dependencies", "run_requests", "worker_slots", "notifications", "write_intents", "write_attempts",
  "artifact_outbox", "database_states"]);

/** The table order every schema 18-23 build hashed into a backup manifest's authorityContentFingerprint; a predecessor store must still match it. */
const PRE_CUSTODY_FINGERPRINT_TABLES = ["assistant_model_preference", "database_states", "database_upgrades", "settings_snapshots", "commands", "command_audits", "settings",
  "assistant_grants", "assistant_chats", "assistant_actions", "run_batches", "deleted_runs", "runs", "run_requests", "run_delegations", "delegation_dependencies", "run_checkpoints",
  "gate_results", "run_results", "run_failures", "run_receipts", "write_intents", "write_attempts", "worker_pools", "worker_slots", "worker_leases", "worker_controls",
  "browser_sessions", "auth_leases", "exclusive_session_leases", "ocr_review_revisions", "ocr_source_uploads", "ocr_approved_snapshots", "notifications", "notification_states",
  "artifacts", "timeline_events", "diagnostic_snapshots", "diagnostic_files", "dryrun_results", "run_search", "workbook_creations", "workbook_types", "workbook_operations",
  "workbook_library", "workbook_library_history", "workbook_library_state", "workbook_library_actions", "workbook_library_snapshots"];
const PRE_CUSTODY_ROW_ORDER: Record<string, string> = { run_results: "id", deleted_runs: "run_id", run_search: "run_id", worker_pools: "workflow",
  workbook_library_history: "workbook_id,version,name", workbook_operations: "sequence", worker_controls: "command_id", auth_leases: "credential_key", timeline_events: "cursor" };
function preCustodyFingerprint(raw: DatabaseSync): string {
  const hash = createHash("sha256");
  for (const table of PRE_CUSTODY_FINGERPRINT_TABLES) {
    hash.update(canonicalJsonStringify(table));
    for (const row of raw.prepare(`SELECT * FROM ${table} ORDER BY ${PRE_CUSTODY_ROW_ORDER[table] ?? "id"}`).iterate()) hash.update(canonicalJsonStringify(row));
  }
  return hash.digest("hex");
}

/**
 * A real delegation tree on the current schema, then returned to schema 20-22: a cancelled member recovered from a worker crash
 * (claim, recover-crash, lifecycle-evidence result and receipt, all carrying the worker lifetime), the parent's join of its
 * resultDigest and the operator's retry embedding it, beside a kept unrelated run with its receipt, a library type and saved settings.
 * The kept-reference variant adds a library row written by a closure run.
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
  let previousDigest: string | undefined, childDigest: string | undefined;
  if (variant !== "attempting-write") {
    const cancelled = current(childId);
    assert.ok(cancelled.lifecycle.state === "terminal" && cancelled.lifecycle.outcome === "cancelled", JSON.stringify(cancelled.lifecycle));
    const evidence = database.authority.runResults.get(childId); assert.ok(evidence);
    assert.equal(terminalEvidenceResult(evidence)?.kind, "lifecycle-evidence");
    receipt(cancelled);
    // The parent's dependency reconcile settles the cancelled member (the join binds its result), then the operator retries it.
    database.withAuthorityTransaction(repositories => repositories.dependencies.reconcile(root.envelope.runId, clock.now().toISOString()));
    const retried = execution.kernel.execute(CommandRequestSchema.parse({ commandId: randomUUID(), family: "run", type: "retry", source: "dashboard",
      requestedBy: "local-operator", requestedAt: clock.now().toISOString(), target: { runId: childId, expectedVersion: current(childId).version } }));
    assert.equal(retried.state, "applied", JSON.stringify(retried));
    const parent = current(root.envelope.runId);
    assert.ok(database.authority.runs.listByItem({ workflow: cancelled.envelope.workflow, itemId: cancelled.envelope.itemId }).some(run => run.envelope.retryOf === childId));
    for (const run of [cancelled, parent].flatMap(run => database.authority.runs.listByItem({ workflow: run.envelope.workflow, itemId: run.envelope.itemId }))) {
      if (!closure.includes(run.envelope.runId)) closure.push(run.envelope.runId);
    }
    previousDigest = evidence.resultDigest;
  }

  database.authority.workbooks.putType({ id: "custody-roster", name: "Custody roster", keyFieldId: "eid", fields: ["eid"], defaultWorkbookId: null });
  if (variant === "kept-reference") {
    const saved = createWorkbookLibraryService({ repository: database.authority.workbooks, clock, sync: unexpectedWorkbookSync }).create({
      name: "Custody.xlsx", themes: [], hasFormulas: false, sheets: [{ id: "people", name: "people", width: 1, hidden: [], headerRow: 1,
        columnBindings: [{ id: "col-0", sourceColumn: 0, sourceHeader: "eid", fieldId: "eid", basis: "manual" }], rows: [{ id: "people-header", cells: [{ value: "EID" }] }] }] });
    const writer = closure.at(-1) ?? childId;
    database.authority.workbooks.operation(saved.libraryId, { operationId: "closure-output", source: { kind: "run", runId: writer },
      at: clock.now().toISOString(), change: { kind: "add", sheetId: "people", rowId: "closure-row", key: "10800000", values: { eid: "10800000" } } });
    assert.equal(database.authority.workbooks.runOperations(writer).length, 1);
  }

  h.authority.closeDatabase();
  await h.manager.closeAll("worker-stop");
  profile.admission.release();
  const raw = new DatabaseSync(path);
  try {
    raw.exec("PRAGMA foreign_keys=ON");
    raw.exec("BEGIN EXCLUSIVE; PRAGMA defer_foreign_keys=ON");
    assert.notEqual(writePredecessorWorkerLifetimes(raw, childId).length, 0);
    if (previousDigest !== undefined) {
      // The member's lifetime changes its recover-crash fingerprint and so its result digest; the join and retry follow it.
      childDigest = String(raw.prepare("SELECT result_digest FROM run_results WHERE run_id=?").get(childId)?.result_digest);
      assert.notEqual(childDigest, previousDigest);
      assert.equal(rebindPredecessorResultDigest(raw, previousDigest, childDigest).length, 2);
    }
    if (version === 23) restoreSchema23WorkerCustodyFixture(raw);
    else restoreSchema22WorkerCustodyFixture(raw);
    if (version === 20) restoreSchema20CompletionFixture(raw);
    else raw.exec(`UPDATE database_states SET schema_version=${String(version)}; PRAGMA user_version=${String(version)}`);
    raw.exec("COMMIT");
    const inspection = inspectNativeAuthority(raw, version);
    assert.equal(inspection.schemaVersion, version);
    // Backups this store's own build wrote must keep verifying after the custody build arrives.
    assert.equal(inspection.authorityContentFingerprint, preCustodyFingerprint(raw));
  } finally { raw.close(); }
  return { profile, path, stateRoot, profileId, closure, keptRunId: kept.envelope.runId, childId, previousDigest, childDigest };
}

function read(path: string) {
  const query = <T>(read: (raw: DatabaseSync) => T): T => {
    const raw = new DatabaseSync(path, { readOnly: true });
    try { return read(raw); } finally { raw.close(); }
  };
  const tables = query(raw => raw.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => String(row.name)));
  return {
    kept: query(raw => Object.fromEntries(tables.filter(table => !CHANGED_TABLES.has(table) && !isWorkerCustodyDroppedTable(table) && !CHANGE_LOG_OBJECTS.includes(table))
      .map(table => [table, raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))),
    triggers: query(raw => raw.prepare("SELECT name, sql FROM sqlite_schema WHERE type='trigger' AND name NOT LIKE 'worker_%' AND name NOT LIKE 'browser_%' ORDER BY name").all()),
    run: (runId: string) => query(raw => ["runs", "run_results", "run_receipts"].map(table => raw.prepare(`SELECT * FROM ${table} WHERE ${table === "runs" ? "id" : "run_id"}=? ORDER BY rowid`).all(runId))),
    everyRow: () => query(raw => tables.flatMap(table => raw.prepare(`SELECT * FROM ${table}`).all().map(row => ({ table, json: JSON.stringify(row) })))),
    rows: (sql: string, ...parameters: string[]) => query(raw => raw.prepare(sql).all(...parameters)),
    count: (sql: string, ...parameters: string[]) => query(raw => Number(raw.prepare(sql).get(...parameters)?.count)),
    upgrades: query(raw => raw.prepare("SELECT * FROM database_upgrades ORDER BY rowid").all()),
    foreignKeys: query(raw => raw.prepare("PRAGMA foreign_key_check").all()),
  };
}

const upgrade = (s: Awaited<ReturnType<typeof predecessorStore>>) => upgradeProfileAtStartup(profileBrowserClosure, s.profile.machine, s.profileId, hostFacts, systemClock);

it.each([20, 21, 22, 23] as const)("deletes the schema %s digest-linked recover-crash closure from a verified backup and reads the kept store back strictly", async version => {
  const s = await predecessorStore(version, "converted");
  const before = read(s.path), keptRun = before.run(s.keptRunId);
  assert.equal(keptRun[2]?.length, 1, "the kept run carries its receipt");
  assert.equal(before.count("SELECT count(*) AS count FROM run_delegations WHERE parent_run_id=?", s.closure[0] ?? ""), 1);
  assert.ok(before.count("SELECT count(*) AS count FROM delegation_dependencies") >= 1);
  const digest = s.childDigest, previous = s.previousDigest; assert.ok(digest !== undefined && previous !== undefined);
  assert.equal(before.rows("SELECT result_digest FROM run_results WHERE run_id=?", s.childId)[0]?.result_digest, digest);
  assert.deepEqual(before.everyRow().filter(row => row.json.includes(previous)).map(row => row.table), []);
  const journals = before.rows("SELECT id, request_json FROM commands WHERE instr(request_json, ?) > 0", digest)
    .map(row => ({ id: String(row.id), ...z.object({ operation: z.string(), request: z.record(z.string(), z.unknown()) }).parse(JSON.parse(String(row.request_json))) }));
  const settlement = journals.find(journal => journal.operation === "delegation-settlement"), retry = journals.find(journal => journal.operation === "delegation-retry");
  assert.equal(journals.length, 2);
  assert.ok(settlement !== undefined && retry !== undefined);
  assert.equal(settlement.id, lifecycleCommandId("delegation-settlement", { dependencyId: settlement.request.dependencyId, childRunId: s.childId,
    childAttempt: settlement.request.childAttempt, resultDigest: digest }));
  assert.deepEqual([settlement.request.runId, settlement.request.resultDigest, settlement.request.state], [s.childId, digest, "cancelled"]);
  assert.deepEqual([retry.request.previousRunId, retry.request.resultDigest, retry.request.dependencyId], [s.childId, digest, settlement.request.dependencyId]);
  for (const journal of journals) assert.equal(before.count("SELECT count(*) AS count FROM command_audits WHERE command_id=? AND json_extract(payload_json,'$.request.request.resultDigest')=?", journal.id, digest), 1, journal.operation);
  // Only a schema-23 store already carries the worker-claim index; the upgrade leaves it exactly once.
  assert.equal(before.count("SELECT count(*) AS count FROM sqlite_schema WHERE type='index' AND name='timeline_worker_claim_idx'"), version === 23 ? 1 : 0);
  assert.equal((await upgrade(s)).state, "upgraded");

  const backups = join(s.stateRoot, "backups", "authority");
  assert.ok(readdirSync(backups).filter(name => name.endsWith(".manifest.json"))
    .some(name => AuthorityBackupManifestSchema.parse(JSON.parse(readFileSync(join(backups, name), "utf8"))).schemaVersion === version));
  const after = read(s.path);
  const { workflow_workbook_selections: selections, assistant_conversations: conversations, assistant_messages: messages, assistant_attachments: attachments, ...kept } = after.kept;
  assert.deepEqual([selections, conversations, messages, attachments], [[], [], [], []]);
  // Schema 29 drops the empty grant table.
  const { assistant_grants: grants, ...keptBefore } = before.kept;
  assert.deepEqual(grants, []);
  assert.deepEqual(kept, keptBefore);
  assert.deepEqual(after.upgrades.slice(0, before.upgrades.length), before.upgrades);
  assert.ok(after.upgrades.length > before.upgrades.length);
  // Migration 21 rewrites this trigger; every other trigger comes through verbatim.
  // The assistant migrations add the history and attachment triggers and retire the grant trigger.
  const ASSISTANT_TRIGGERS = new Set(["assistant_messages_settle_only", "assistant_attachments_accept_only", "assistant_grants_revision"]);
  // Migration 31 adds the change log's capture and reference triggers.
  const unchanged = (rows: readonly Record<string, unknown>[]) => rows.filter(row => (version > 20 || row.name !== "runs_completion_immutable") && !ASSISTANT_TRIGGERS.has(String(row.name))
    && !CHANGE_LOG_OBJECTS.includes(String(row.name)));
  assert.deepEqual(unchanged(after.triggers), unchanged(before.triggers));
  assert.ok(after.triggers.some(row => row.name === "runs_completion_immutable"));
  assert.deepEqual(after.foreignKeys, []);
  assert.equal(after.count("SELECT count(*) AS count FROM sqlite_schema WHERE type='index' AND name='timeline_worker_claim_idx'"), 1);
  for (const runId of s.closure) {
    assert.equal(after.count("SELECT count(*) AS count FROM runs WHERE id=?", runId), 0, runId);
    assert.equal(after.count("SELECT count(*) AS count FROM deleted_runs WHERE run_id=?", runId), 1, runId);
  }
  // On 20 and 21 the pre-build deletion clears history like the operator's Clear history: notifications and journals keep naming the tombstones.
  const runOwned = ["run_delegations", "delegation_dependencies", "run_results", "run_receipts", "run_failures", "timeline_events", ...version >= 22 ? ["notifications"] : []];
  for (const table of runOwned) {
    assert.ok(after.everyRow().filter(row => row.table === table).every(row => s.closure.every(runId => !row.json.includes(runId))), table);
  }
  assert.deepEqual(after.everyRow().filter(row => (version >= 22 || runOwned.includes(row.table)) && row.json.includes(digest)).map(row => row.table), []);
  assert.ok(after.everyRow().every(row => !row.json.includes("workerLifetime") && !row.json.includes("membershipRevision") && !row.json.includes("controlBasis")),
    "the removed custody grammar is gone");
  assert.equal(after.count("SELECT count(*) AS count FROM commands WHERE family='worker-browser'"), 0);
  // Schema 22 keeps every run built by this release; 20 and 21 tombstone the pre-build runs, the kept one among them.
  if (version >= 22) assert.deepEqual(after.run(s.keptRunId), keptRun);
  else assert.equal(after.count("SELECT count(*) AS count FROM deleted_runs WHERE run_id=?", s.keptRunId), 1);

  const admission = s.profile.machine.admitProfile(s.profileId);
  try {
    const database = ProfileAuthorityDatabase.open(admission, { path: s.path, busyTimeoutMs: 250, migrationOwner: "selected-profile-runtime" }, systemClock,
      undefined, undefined, undefined, createProfileCredentialStore({ admission, stateRoot: s.stateRoot }));
    try {
      const raw = new DatabaseSync(s.path, { readOnly: true });
      try { assert.equal(inspectNativeAuthority(raw).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION); } finally { raw.close(); }
      if (version >= 22) {
        const run = database.authority.runs.get(s.keptRunId);
        assert.ok(run?.lifecycle.state === "terminal" && run.lifecycle.outcome === "cancelled");
        assert.equal(database.authority.runResults.get(s.keptRunId)?.runId, s.keptRunId);
      }
      assert.match(JSON.stringify(readSettings(database.authority).settings), /Synthetic operator/u);
      assert.equal(database.authority.workbooks.types().find(type => type.id === "custody-roster")?.name, "Custody roster");
    } finally { database.close(); }
  } finally { admission.release(); }
});

it.each([...([20, 21, 22, 23] as const).map(version => ({ version, variant: "attempting-write" as const })), ...([22, 23] as const).map(version => ({ version, variant: "kept-reference" as const }))])(
  "refuses a schema $version closure with $variant and leaves the store byte-identical", async ({ version, variant }) => {
    const s = await predecessorStore(version, variant);
    const bytes = readFileSync(s.path), before = read(s.path);
    await assert.rejects(upgrade(s), variant === "attempting-write" ? /authority-upgrade-unresolved-writes/u : /authority-upgrade-retained-run-reference/u);
    assert.deepEqual(readFileSync(s.path), bytes);
    const after = read(s.path);
    assert.deepEqual(after.kept, before.kept);
    assert.deepEqual(after.upgrades, before.upgrades);
    assert.deepEqual(after.triggers, before.triggers);
    const raw = new DatabaseSync(s.path, { readOnly: true });
    try { assert.equal(inspectNativeAuthority(raw, version).schemaVersion, version); } finally { raw.close(); }
  });

it.each([20, 21] as const)("keeps a library row a schema %s closure run wrote against the run's tombstone", async version => {
  const s = await predecessorStore(version, "kept-reference");
  const writer = s.closure.at(-1) ?? "", library = (path: string) => read(path).count("SELECT count(*) AS count FROM workbook_operations WHERE json_extract(request_json,'$.source.runId')=?", writer);
  assert.equal(library(s.path), 1);
  assert.equal((await upgrade(s)).state, "upgraded");
  assert.equal(library(s.path), 1);
  assert.equal(read(s.path).count("SELECT count(*) AS count FROM deleted_runs WHERE run_id=?", writer), 1);
});
