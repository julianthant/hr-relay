import assert from "node:assert/strict";
import { unexpectedWorkbookSync } from "../../helpers/backend/workbook-sync.js";
import { authorityMutationCases, createAuthorityAccountingTestWorld, type MutationCase } from "../../helpers/backend/authority-accounting-world.js";
import { personLookupDescriptor, separationsDescriptor } from "../../helpers/registered-workflows.js";
import { atomicWriteCheckpoint, releaseSeededWriteOwners } from "../../helpers/timeline-write-fixture.js";
import { fenceWriteFixture } from "../../helpers/write-fence-fixture.js";
import type { AuthorityDatabase } from "../../helpers/synthetic-storage-admission.js";
import { CONFIG_SNAPSHOT, HASH_A, NOW } from "../phase1c-contract-fixtures.js";
import { QUEUED_RUN, WORKFLOW_ID } from "../phase1f-run-fixtures.js";
import { fixtureUuid, ledgerCommitFixture } from "../ledger-projection-fixtures.js";
import { testRunService, testWorkerPorts } from "../run-lifecycle-fixtures.js";
import { createWorkbookLibraryService } from "../../../../src/backend/workbooks/workbook-library-service.js";
import { currentBuildId } from "../../../../src/backend/runtime/build-id.js";
import { deriveRunEvidenceReceipt } from "../../../../src/backend/runs/provenance/evidence-receipt.js";
import { encodeEditableWorkbook, type WorkbookOperation } from "../../../../src/models/dashboard/workbooks.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { PersonLookupCanonicalInput } from "../../../../src/workflows/person-lookup/workflow.js";
import { IsoInstantSchema } from "../../../../src/rules/identity/ids.js";

type World = ReturnType<typeof createAuthorityAccountingTestWorld>;
type RunningRun = ReturnType<World["prepareRunning"]>;

export type CheckClosureStore = Readonly<{
  databasePath: string;
  database: AuthorityDatabase;
  /** Closes the authority database but keeps the files on disk. */
  closeDatabase(): void;
  /** Closes the database if still open and removes the temporary workspace. */
  cleanup(): Promise<void>;
}>;

/**
 * Opens one authority store and fills as many registry tables as the repository and service
 * APIs allow, with interlinked rows, so whole-store checks run against a realistic closure.
 */
export async function seedCheckClosureStore(): Promise<CheckClosureStore> {
  const world = createAuthorityAccountingTestWorld();
  const { CLOCK } = world;
  const database = await world.openDatabase();
  const databasePath = world.databasePaths.get(database);
  assert.ok(databasePath);
  const cases = authorityMutationCases(world);
  const caseFor = (table: MutationCase["table"], nth = 0): MutationCase => {
    const found = cases.filter(entry => entry.table === table)[nth];
    assert.ok(found, `missing mutation case ${table}#${String(nth)}`);
    return found;
  };
  const mutate = async (table: MutationCase["table"], nth = 0) => { await caseFor(table, nth).mutate(database); };
  const slotWorkerId = () => {
    const slot = database.authority.workerSlots.list(WORKFLOW_ID)[0];
    assert.ok(slot);
    return slot.workerId;
  };

  database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);

  // Run A (RUN_ID): failed, with diagnostics, receipt, command, gate result and OCR review chain.
  world.terminalizeForTrust(database);
  await mutate("diagnostic_snapshots");
  await mutate("run_receipts");
  await mutate("commands");
  await mutate("ocr_source_uploads");
  await mutate("ocr_review_revisions");
  await mutate("ocr_approved_snapshots");
  await mutate("command_audits");

  // Further person-lookup runs share the slot RUN_ID's claim has released.
  const runOwnedBy = (tag: string, held: (run: RunningRun) => void) => {
    const runId = fixtureUuid(`closure-run-${tag}`);
    const itemId = fixtureUuid(`closure-item-${tag}`);
    database.authority.runs.enqueue(RunRecordSchema.parse({
      ...QUEUED_RUN,
      envelope: { ...QUEUED_RUN.envelope, runId, itemId, traceId: `pl-120000-${tag}`,
        contractFingerprint: personLookupDescriptor.contractFingerprint, descriptorVersion: personLookupDescriptor.version },
      input: { ...QUEUED_RUN.input, parsed: { schemaHash: deriveSchemaHash(PersonLookupCanonicalInput, "output"),
        value: { mode: "search", crmCheck: true, emplId: "10873698", keepNonHdh: false, includeCrmDates: false }, protectedBindings: [] } },
    }));
    const workerId = slotWorkerId();
    const claimed = database.authority.runs.claimNext({ workflow: WORKFLOW_ID, workerId, now: NOW });
    assert.equal(claimed.state, "claimed");
    assert.equal(claimed.state === "claimed" ? claimed.run.envelope.runId : undefined, runId);
    let current = claimed.state === "claimed" ? claimed.run : undefined;
    assert.ok(current);
    for (const state of ["validating", "running"] as const) {
      const moved = database.authority.runs.transition({ runId, expectedVersion: current.version,
        claim: { workerId, claimGeneration: 1 }, lifecycle: { state, workerId, claimedAt: NOW, heartbeatAt: NOW }, now: NOW });
      assert.equal(moved.state, "applied");
      current = moved.state === "applied" ? moved.run : current;
    }
    held(current);
  };

  // Run B: done with a result and a success receipt.
  runOwnedBy("0101", run => {
    const terminal = world.terminalSuccessRequest(database, run);
    database.terminalizeSuccess(terminal.request, terminal.factoryAuthorization);
    const settled = database.authority.runs.get(run.envelope.runId);
    const result = database.authority.runResults.get(run.envelope.runId);
    assert.ok(settled && result);
    database.authority.evidenceReceipts.insert(deriveRunEvidenceReceipt({ descriptor: personLookupDescriptor,
      run: settled, result, failure: undefined, checkpoints: [], writes: [], gateResults: [] }).receipt);
  });

  // Run C: cancelled, then deleted (leaves a deleted_runs tombstone).
  runOwnedBy("0102", run => {
    const service = testRunService(database, CLOCK);
    const requested = service.transition({ commandId: fixtureUuid("closure-cancel-request"), runId: run.envelope.runId,
      expectedVersion: run.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
    assert.equal(requested.state, "applied");
    if (requested.state !== "applied") return;
    assert.equal(service.terminalize({ kind: "cancelled", commandId: fixtureUuid("closure-cancel-settle"), runId: run.envelope.runId,
      expectedVersion: requested.run.version, claim: { workerId: world.claimedWorkerId(run), claimGeneration: run.claimGeneration },
      endedAt: NOW }, personLookupDescriptor).state, "applied");
    const cancelled = database.authority.runs.get(run.envelope.runId);
    assert.ok(cancelled);
    assert.equal(service.delete({ commandId: fixtureUuid("closure-delete"), runId: run.envelope.runId, expectedVersion: cancelled.version }).state, "deleted");
  });

  // Run D: cancelled and kept; exclusive and Duo ceremony leases are taken and released by the slot.
  runOwnedBy("0103", run => {
    const workerId = world.claimedWorkerId(run);
    const exclusive = database.authority.exclusiveSessionLeases.acquire({ identityKey: HASH_A, workerId, sessionId: fixtureUuid("closure-session"), now: NOW });
    assert.equal(exclusive.state, "acquired");
    if (exclusive.state === "acquired") assert.notEqual(database.authority.exclusiveSessionLeases.release(exclusive.lease, NOW).releasedAt, null);
    const duo = database.authority.duoCeremonyLeases.acquire({ credentialKey: "ab".repeat(32), workerId, system: "ucpath",
      now: "2026-08-21T10:00:00.000Z", ttlMs: 80_000 });
    assert.equal(duo.state, "acquired");
    if (duo.state === "acquired") assert.equal(database.authority.duoCeremonyLeases.release({ token: duo.token, now: "2026-08-21T10:00:01.000Z" }).state, "released");
    const service = testRunService(database, CLOCK);
    const requested = service.transition({ commandId: fixtureUuid("closure-cancel-request-d"), runId: run.envelope.runId,
      expectedVersion: run.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
    assert.equal(requested.state, "applied");
    if (requested.state !== "applied") return;
    assert.equal(service.terminalize({ kind: "cancelled", commandId: fixtureUuid("closure-cancel-settle-d"), runId: run.envelope.runId,
      expectedVersion: requested.run.version, claim: { workerId, claimGeneration: run.claimGeneration }, endedAt: NOW }, personLookupDescriptor).state, "applied");
  });

  // Committed writes on a second workflow, claimed through their own slot.
  commitWrite(database, databasePath, CLOCK, 1);
  commitWrite(database, databasePath, CLOCK, 2);

  // Queued runs and their satellites last, so no claim above picks them up.
  for (const table of ["gate_results", "run_requests", "run_batches", "worker_pools"] as const) await mutate(table);
  const checkpointRunId = fixtureUuid("closure-checkpoint-run"), checkpointItemId = fixtureUuid("closure-checkpoint-item");
  database.authority.runs.enqueue({ ...QUEUED_RUN, envelope: { ...QUEUED_RUN.envelope, runId: checkpointRunId, itemId: checkpointItemId,
    traceId: "pl-120000-0104" } });
  database.authority.runCheckpoints.insert({ ...world.RUN_CHECKPOINT, runId: checkpointRunId, itemId: checkpointItemId });
  caseFor("run_delegations").prepare?.(database);
  await mutate("run_delegations");
  await mutate("delegation_dependencies");
  for (const [table, nth] of [["dryrun_results", 0], ["artifacts", 0], ["artifacts", 1], ["artifacts", 2], ["notifications", 0],
    ["notification_states", 0], ["timeline_events", 0], ["timeline_events", 1],
    ["assistant_conversations", 0], ["assistant_chats", 0], ["assistant_model_preference", 0]] as const) await mutate(table, nth);
  caseFor("assistant_actions").prepare?.(database);
  await mutate("assistant_actions");
  assert.equal(database.authority.assistantHistory.apply({ operation: "local", conversationId: "6f9c3b1e-2a4d-4c8e-9b7a-1d2e3f4a5b6c",
    expectedRevision: 1, messageId: fixtureUuid("closure-message"), text: "Closure fixture message." }, NOW).state, "saved");
  await mutate("assistant_attachments");

  seedWorkbooks(database, world);

  releaseSeededWriteOwners(database, CLOCK.now().toISOString());
  let closed = false;
  return { databasePath, database,
    closeDatabase: () => {
      if (closed) return;
      closed = true;
      releaseSeededWriteOwners(database, CLOCK.now().toISOString());
      database.close();
    },
    cleanup: async () => { closed = true; world.cleanup(); } };
}

function commitWrite(database: AuthorityDatabase, path: string, clock: World["CLOCK"], index: number): void {
  const snapshot = database.authority.runtimeConfig.get();
  assert.ok(snapshot);
  const fixture = ledgerCommitFixture(index, { runId: fixtureUuid(`closure-write-run-${String(index)}`),
    itemId: fixtureUuid(`closure-write-item-${String(index)}`), workflowId: separationsDescriptor.id, configFingerprint: snapshot.configFingerprint });
  const ledger = fixture.commit.transaction;
  database.authority.runs.enqueue(RunRecordSchema.parse({ envelope: { workflow: ledger.workflowId, runId: ledger.runId, itemId: ledger.itemId,
    traceId: ledger.traceId, descriptorVersion: separationsDescriptor.version, contractFingerprint: separationsDescriptor.contractFingerprint,
    resolvedInstance: { [ledger.system]: ledger.instance }, configFingerprint: ledger.configFingerprint, configSnapshotId: snapshot.configSnapshotId,
    shape: "single", priority: "interactive", dryRun: false, attempt: ledger.attempt, enqueuedAt: ledger.fencedAt, buildId: currentBuildId() },
  input: { raw: {}, parsed: { schemaHash: HASH_A, value: {}, protectedBindings: [] }, ingressSchemaHash: HASH_A },
  lifecycle: { state: "queued" }, claimGeneration: 0, version: 1, createdAt: ledger.fencedAt, updatedAt: ledger.fencedAt }));
  const slots = database.authority.workerSlots.list(separationsDescriptor.id).filter(entry => entry.retiredAt === null);
  const free = slots.find(slot => !database.authority.runs.listByWorker(slot.workerId).some(run => ["claimed", "validating", "running"].includes(run.lifecycle.state)));
  const poolIndex = free?.poolIndex ?? [1, 2, 3].find(candidate => !slots.some(slot => slot.poolIndex === candidate));
  assert.ok(poolIndex !== undefined);
  if (free === undefined) testWorkerPorts(database, clock, { path, descriptor: separationsDescriptor, poolIndex });
  const slot = database.authority.workerSlots.list(separationsDescriptor.id).find(entry => entry.poolIndex === poolIndex && entry.retiredAt === null);
  assert.ok(slot);
  assert.equal(database.authority.runs.claimNext({ workflow: separationsDescriptor.id, workerId: slot.workerId, now: ledger.fencedAt }).state, "claimed");
  assert.equal(fenceWriteFixture(database, { intent: fixture.intent, attempt: fixture.attempt }).state, "fenced");
  database.commitWriteAttempt(fixture.commit, { ...atomicWriteCheckpoint(fixture.commit),
    descriptorVersion: separationsDescriptor.version, contractFingerprint: separationsDescriptor.contractFingerprint });
}

function seedWorkbooks(database: AuthorityDatabase, world: World): void {
  const { CLOCK } = world;
  const at = () => IsoInstantSchema.parse(CLOCK.now().toISOString());
  const saved = createWorkbookLibraryService({ sync: unexpectedWorkbookSync, repository: database.authority.workbooks, clock: CLOCK })
    .create({ name: "Closure.xlsx", themes: [], hasFormulas: false,
      sheets: [{ id: "sheet", name: "Rows", width: 1, hidden: [], rows: [{ id: "row", cells: [{ value: "synthetic" }] }] }] });
  const operations: readonly WorkbookOperation[] = [
    { operationId: "closure-save", source: { kind: "operator" }, at: at(),
      change: { kind: "save", expectedVersion: 1, workbook: encodeEditableWorkbook({ ...saved.workbook, name: "Settled.xlsx" }) } },
    { operationId: "closure-version", source: { kind: "operator" }, at: at(), change: { kind: "version", expectedVersion: 2, name: "Reviewed" } },
  ];
  for (const operation of operations) database.authority.workbooks.enqueue(saved.libraryId, operation);
  database.authority.workbooks.drain(saved.libraryId);
  const state = database.authority.workbooks.libraryState(saved.libraryId);
  const current = database.authority.workbooks.read(saved.libraryId);
  assert.ok(current);
  database.authority.workbooks.libraryAction(saved.libraryId, { operationId: "closure-rename", expectedVersion: current.version,
    expectedRevision: state.revision, change: { kind: "rename-version", versionId: state.selectedVersionId, name: "Reviewed original" } }, CLOCK.now().toISOString());
  database.authority.workbooks.putType({ id: "closure", name: "Closure type", keyFieldId: null, fields: ["roster.closure"], defaultWorkbookId: null });
  database.authority.workbooks.rememberLastUsed({ workflowId: "onboarding", acceptedCommandId: fixtureUuid("closure-last-used"), usedAt: at(),
    sources: [{ libraryId: saved.libraryId, sheetId: "sheet" }] });
}
