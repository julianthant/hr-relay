import { createRunQueueProjectionTestWorld } from "../../../support/helpers/backend/run-queue-projection-world.js";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { createRunQueueProjection } from "../../../../src/backend/runs/projections/run-queue-projection.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import { HASH_A, HASH_B, UUID_4 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { declareProjectionWorker, APP_VERSION, claimEventOf, DAY, DESCRIPTOR_SET_HASH, instantOffsetOf, taskEventsOf, traceOf, uuidOf, workerLeaseOf, type DashboardWorld } from "../../../support/helpers/backend/dashboard-harness.js";
import { personLookupDescriptor, separationsDescriptor } from "../../../support/helpers/registered-workflows.js";
import { WorkerControlRecordSchema } from "../../../../src/models/run/worker-control.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";

const {world, runRecordOf, queuedEventOf, CLAIM, otherConnection, appendOther, seedWorld, cleanup } = createRunQueueProjectionTestWorld();

function corruptLatest(w: DashboardWorld): void {
  using raw = new DatabaseSync(join(w.stateRoot, "state.db"));
  const sql = raw.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name='timeline_events_immutable'").get()?.sql;
  assert.equal(typeof sql, "string");
  if (typeof sql !== "string") throw new Error("missing timeline immutable guard");
  raw.exec("DROP TRIGGER timeline_events_immutable; PRAGMA ignore_check_constraints=ON");
  try { assert.equal(raw.prepare("UPDATE timeline_events SET payload_json='{}' WHERE cursor=(SELECT MAX(cursor) FROM timeline_events)").run().changes, 1); }
  finally { raw.exec(sql); }
}

afterEach(cleanup);

describe("THE run/queue projection", () => {
  it("keeps structured parked-probe evidence private while serving its held result", async () => {
    const w = await world(), at = instantOffsetOf(0), commandId = uuidOf(80);
    queuedEventOf(w, { seed: 1 });
    const request = CommandRequestSchema.parse({ commandId, family: "worker-browser", type: "check-parked-write", requestedAt: at, requestedBy: "local-operator", source: "run-detail",
      target: { workerId: "person-lookup-worker-1", workflowId: "person-lookup", expectedVersion: 2, controlBasis: { leaseGeneration: 1, controlRevision: 1 },
        membershipRevision: 1, processId: 42, startedAt: at, installationId: uuidOf(81), profileId: uuidOf(82), itemId: uuidOf(83), runId: uuidOf(1), runVersion: 4,
        runAttempt: 1, traceId: traceOf(1), nodeId: "submit-write", writeIntentId: uuidOf(84), intentVersion: 1, intentGeneration: 1,
        writeAttemptId: uuidOf(85), bindingProofDigest: HASH_A, occurrenceKeyDigest: HASH_B } });
    const result = { commandId, requestedBy: request.requestedBy, target: request.target, observedAt: at, held: true,
      provenance: "system-probe", state: "ambiguous", code: "PARKED_CHECK_OCCURRENCE_UNPROVED", probeTaskId: "ucpath/match-existing-termination", evidenceDigest: HASH_A };
    const control = WorkerControlRecordSchema.parse({ commandId, request, scope: "worker-pool:person-lookup", executorId: uuidOf(86), admittedAt: at,
      expiresAt: instantOffsetOf(0, 180_000), basisVersion: 2, phase: { state: "succeeded", startedAt: at, completedAt: at,
        acknowledgement: { kind: "parked-write-check", result, evidence: { schemaHash: HASH_A, value: { privateEvidence: "PRIVATE_PROBE_CANARY" } } } } });
    w.authority.workerControls = () => [control];
    w.projection.rebuildFromTimeline();
    const day = w.projection.buildDashboardDayWire(DAY), observed = day.workerOperations[0];
    assert.equal(observed.phase.state, "succeeded");
    if (observed.phase.state !== "succeeded" || observed.phase.acknowledgement.kind !== "parked-write-check") throw new Error("held check result absent");
    assert.equal(observed.phase.acknowledgement.result.held, true);
    assert.equal(observed.phase.acknowledgement.evidence, undefined);
    assert.equal(JSON.stringify(day).includes("PRIVATE_PROBE_CANARY"), false);
    assert.deepEqual(control.phase.state === "succeeded" && control.phase.acknowledgement.kind === "parked-write-check" && control.phase.acknowledgement.evidence?.value, { privateEvidence: "PRIVATE_PROBE_CANARY" });
  });
  it("shows the six declared Separations steps in the queue pipeline", async () => {
    const w = await world({ descriptors: { resolve: () => separationsDescriptor } });
    queuedEventOf(w, { seed: 1, workflow: "separations", lifecycle: { state: "running", ...CLAIM }, claimGeneration: 1, version: 2 });

    const pipeline = w.projection.queueSurface(uuidOf(1))?.pipeline;
    assert.deepEqual(pipeline?.map(({ id, label }) => ({ id, label })), [
      { id: "kuali-extraction", label: "Kuali extraction" },
      { id: "identity-check", label: "Identity check" },
      { id: "job-summary", label: "Job summary" },
      { id: "kronos-timecard", label: "Kronos timecard" },
      { id: "ucpath-transaction", label: "UCPath transaction" },
      { id: "kuali-finalization", label: "Kuali finalization" },
    ]);
    assert.deepEqual(pipeline?.map(({ state }) => state), Array(6).fill("pending"));

    const base = { workflow: "separations", runId: uuidOf(1), attempt: 1, traceId: traceOf(1) } as const;
    const first = `${traceOf(1)}/resolve-action#1`;
    w.writer.emit({ ...base, t: "span.started", kind: "task", spanPath: first, parentSpanPath: traceOf(1), name: "resolve-action", ts: instantOffsetOf(0, 1_000) });
    w.writer.emit({ ...base, t: "span.ended", kind: "task", spanPath: first, outcome: "done", ts: instantOffsetOf(0, 1_600) });
    const second = `${traceOf(1)}/document#1`;
    w.writer.emit({ ...base, t: "span.started", kind: "task", spanPath: second, parentSpanPath: traceOf(1), name: "document", ts: instantOffsetOf(0, 2_000) });
    assert.deepEqual(w.projection.queueSurface(uuidOf(1))?.pipeline.map(({ state }) => state),
      ["active", "pending", "pending", "pending", "pending", "pending"]);

    w.writer.emit({ ...base, t: "gate.opened", spanPath: traceOf(1), gate: "identity-approval", ts: instantOffsetOf(0, 3_000) });
    assert.deepEqual(w.projection.queueSurface(uuidOf(1))?.pipeline.map(({ state }) => state),
      ["active", "blocked", "pending", "pending", "pending", "pending"]);

    w.writer.emit({ ...base, t: "span.ended", kind: "task", spanPath: second, outcome: "done", ts: instantOffsetOf(0, 3_600) });
    assert.equal(w.projection.queueSurface(uuidOf(1))?.pipeline[0]?.durationSec, 2,
      "category time rounds the combined 2.2 seconds, not each node separately");
  });


  it("serves each row the controls its descriptor enables, bound to that row's revision", async () => {
    const w = await world({ descriptors: { resolve: () => personLookupDescriptor } });
    seedWorld(w);
    const day = w.projection.buildDashboardDayWire(DAY);

    const actionKeys = (seed: number): string[] =>
      (day.queueSurfaces.find(({ runId }) => runId === uuidOf(seed))?.actions ?? []).map(({ key }) => key);
    assert.deepEqual(actionKeys(1), ["bump", "cancel", "rename"], "the queued row");
    assert.deepEqual(actionKeys(2), ["cancel", "rename"], "the running row");

    assert.deepEqual(actionKeys(3), ["rerun", "rename", "delete"], "the done row");
    assert.deepEqual(actionKeys(4), ["rerun", "rename", "delete"], "the failed row");
    assert.deepEqual(actionKeys(9), ["cancel", "rename"], "the awaiting-approval row");

    assert.deepEqual(actionKeys(8), []);
    // The operation's cancel is the TREE cancel, keyed so the footer titles it
    // with its blast radius.
    assert.equal(actionKeys(6).includes("cancel-tree"), true);

    for (const surface of day.queueSurfaces) {
      if (surface.runId === uuidOf(8)) continue; // the settled member, above
      assert.ok(surface.actions.length > 0, `row ${surface.runId} was served no control at all`);
      for (const action of surface.actions) {
        if (action.kind === "navigation") {
          assert.equal(action.key, "rerun");
          if (action.navigate.kind !== "rerun") {
            assert.fail(`${surface.runId}/${action.key} was not a rerun navigation`);
          }
          assert.equal(action.navigate.expectedVersion, surface.rowRevision, `${surface.runId}/${action.key}`);
          continue;
        }
        assert.equal(action.kind, "command");
        assert.equal(action.expectedVersion, surface.rowRevision, `${surface.runId}/${action.key}`);
      }
    }
  });

  it("projects a current lifetime claim from authority and never opens a browser from a span", async () => {

    const w = await world();
    declareProjectionWorker(w.authority, "person-lookup-worker-1", 1);
    w.authority.putWorkerLease(workerLeaseOf({
      // Keep launch-time lease requirements different from the current registry to detect accidental rewriting.
      browserSystems: ["kuali"],
      lifecycle: {
        state: "busy",
        startedAt: instantOffsetOf(0),
        heartbeatAt: instantOffsetOf(0, 2_000),
        runId: uuidOf(1),
      },
      version: 7,
    }));
    w.writer.emit({
      t: "span.started", kind: "worker", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      workerId: "person-lookup-worker-1", spanPath: "worker/person-lookup/person-lookup-worker-1", name: "person-lookup",
    });
    w.writer.emit({
      t: "span.started", kind: "browser", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      workerId: "person-lookup-worker-1",
      spanPath: `worker/person-lookup/person-lookup-worker-1/browser:ucpath#${uuidOf(50)}`,
      parentSpanPath: "worker/person-lookup/person-lookup-worker-1",
      name: "browser-session:ucpath", system: "ucpath",
    });
    queuedEventOf(w, { seed: 1, lifecycle: { state: "running", ...CLAIM, workerLifetime: { membershipRevision: 1, leaseGeneration: 1 } }, claimGeneration: 1, version: 2 });
    claimEventOf(w, 1);
    const day = w.projection.buildDashboardDayWire(DAY);
    assert.equal(day.workerCards.length, 1);
    const card = day.workerCards[0];
    assert.equal(card.workflowId, "person-lookup");
    assert.equal(card.state, "running");
    assert.equal(card.directive, "run");
    assert.equal(card.startedAt, instantOffsetOf(0));
    assert.equal(card.endedAt, undefined);
    // Heartbeat version remains display evidence; control identity is separate.
    assert.equal(card.leaseVersion, 7);
    assert.notEqual(Number(card.leaseVersion), Number(card.revision));
    assert.deepEqual(card.browsers, []);
    assert.deepEqual(card.browserRequirements, { state: "present", systems: ["kuali"] });
    assert.deepEqual(card.currentRun, { state: "present", runId: uuidOf(1), traceId: traceOf(1) });
  });

  it("keeps observed browser spans from fabricating current physical ownership", async () => {
    const w = await world();
    declareProjectionWorker(w.authority, "person-lookup-worker-1", 1);
    w.authority.putWorkerLease(workerLeaseOf());
    const spanPath = `worker/person-lookup/person-lookup-worker-1/browser:ucpath#${uuidOf(50)}`;
    w.writer.emit({
      t: "span.started", kind: "worker", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      workerId: "person-lookup-worker-1", spanPath: "worker/person-lookup/person-lookup-worker-1", name: "person-lookup",
    });
    w.writer.emit({
      t: "span.started", kind: "browser", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      workerId: "person-lookup-worker-1", spanPath, parentSpanPath: "worker/person-lookup/person-lookup-worker-1",
      name: "browser-session:ucpath", system: "ucpath",
    });
    assert.equal(w.projection.buildDashboardDayWire(DAY).workerCards[0].browsers.length, 0);

    // Closing a historical span cannot create a physical session either.
    w.writer.emit({
      t: "span.ended", kind: "browser", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      workerId: "person-lookup-worker-1", spanPath, parentSpanPath: "worker/person-lookup/person-lookup-worker-1",
      outcome: "failed", errorSummary: "browser session closed as poisoned",
    });
    assert.deepEqual(w.projection.buildDashboardDayWire(DAY).workerCards[0].browsers, []);
  });

  it("splits a settled lease by its recorded reason and serves the terminal facts", async () => {
    const w = await world();
    declareProjectionWorker(w.authority, "person-lookup-worker-1", 1);
    declareProjectionWorker(w.authority, "person-lookup-worker-2", 2);
    w.authority.putWorkerLease(workerLeaseOf({
      workerId: "person-lookup-worker-1",
      lifecycle: {
        state: "stopped",
        startedAt: instantOffsetOf(0),
        stoppedAt: instantOffsetOf(0, 60_000),
        reason: "operator",
      },
      directive: "stop",
      version: 4,
    }));
    w.authority.putWorkerLease(workerLeaseOf({
      workerId: "person-lookup-worker-2",
      lifecycle: {
        state: "stopped",
        startedAt: instantOffsetOf(0),
        stoppedAt: instantOffsetOf(0, 30_000),
        reason: "crashed",
      },
      directive: "stop",
      version: 9,
    }));
    for (const workerId of ["person-lookup-worker-1", "person-lookup-worker-2"]) {
      w.writer.emit({
        t: "span.started", kind: "worker", ts: w.clock.now().toISOString(), workflow: "person-lookup",
        workerId, spanPath: `worker/person-lookup/${workerId}`, name: "person-lookup",
      });
      w.writer.emit({
        t: "span.started", kind: "browser", ts: w.clock.now().toISOString(), workflow: "person-lookup",
        workerId, spanPath: `worker/person-lookup/${workerId}/browser:ucpath#${uuidOf(51)}`,
        parentSpanPath: `worker/person-lookup/${workerId}`, name: "browser-session:ucpath", system: "ucpath",
      });
    }

    const [stopped, failed] = w.projection.buildDashboardDayWire(DAY).workerCards;
    assert.equal(stopped.state, "failed");
    assert.equal(stopped.stopReason, "operator");
    assert.equal(stopped.endedAt, instantOffsetOf(0, 60_000));

    assert.equal(failed.state, "failed");
    assert.equal(failed.stopReason, "crashed");
    assert.deepEqual(stopped.browsers, []);
    assert.deepEqual(failed.browsers, []);
  });

  it("stays live over observed-data and transaction-fence beats and rebuilds identically", async () => {

    const w = await world();
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    const base = {
      workflow: "person-lookup" as const,
      runId: uuidOf(1),
      traceId: traceOf(1),
      spanPath: `${traceOf(1)}/searching#1.1`,
      parentSpanPath: traceOf(1),
      attempt: 1,
    };
    const ts = (): string => w.clock.now().toISOString();
    w.writer.emit({ ...base, t: "span.started", kind: "task", ts: ts(), name: "searching" });
    w.writer.emit({
      ...base, t: "data.observed", ts: ts(), observedAt: ts(),
      nodeId: "searching", taskId: "ucpath/search-person-org",
      points: [{
        direction: "read",
        field: "selection",
        values: [
          { key: "selection.status", state: "allowed", classification: "safe-diagnostic", transform: "allow", value: "resolved" },
          { key: "selection.selected.emplId", state: "transformed", classification: "direct-identifier", transform: "last4", value: "6712" },
        ],
      }],
    });
    w.writer.emit({
      ...base,
      t: "transaction.fenced",
      ts: ts(),
      spanPath: `${traceOf(1)}/searching/commit`,
      node: "searching",
      taskId: "ucpath/create-termination",
    });
    w.writer.emit({ ...base, t: "span.ended", kind: "task", ts: ts(), outcome: "done" });
    assert.equal(w.projection.health().state, "live");

    const before = w.projection.buildDashboardDayWire(DAY);
    const fresh = createRunQueueProjection({
      timeline: w.timeline,
      reader: w.runReader,
      stateRoot: w.stateRoot,
      clock: w.clock,
      appVersion: APP_VERSION,
      descriptorSetHash: DESCRIPTOR_SET_HASH,
      ledger: createTransactionHistory(w.database.authority),
      authority: w.authority,
      descriptors: { resolve: () => undefined },
    });
    fresh.rebuildFromTimeline();
    assert.equal(fresh.health().state, "live");
    assert.deepEqual(
      { ...fresh.buildDashboardDayWire(DAY), projectionGeneration: 0, snapshotCursor: "pc:1" },
      { ...before, projectionGeneration: 0, snapshotCursor: "pc:1" },
    );
  });

  it("rebuilds optional evidence in memory without changing canonical runs", async () => {
    const w = await world();
    seedWorld(w);
    const before = w.runReader.list({ disposition: "live", limit: 1000 });
    w.projection.rebuildFromTimeline();
    assert.deepEqual(w.runReader.list({ disposition: "live", limit: 1000 }), before);
    assert.equal(w.projection.runFold(uuidOf(9))?.queued.runId, uuidOf(9));
  });

  it("rebuilds the identical day payload from nothing but the span JSONL", async () => {
    const w = await world();
    seedWorld(w);
    const before = w.projection.buildDashboardDayWire(DAY);

    const fresh = createRunQueueProjection({
      timeline: w.timeline,
      reader: w.runReader,
      stateRoot: w.stateRoot,
      clock: w.clock,
      appVersion: APP_VERSION,
      descriptorSetHash: DESCRIPTOR_SET_HASH,
      ledger: createTransactionHistory(w.database.authority),
      authority: w.authority,
      descriptors: { resolve: () => undefined },
    });
    fresh.rebuildFromTimeline();
    assert.equal(fresh.health().state, "live");
    const after = fresh.buildDashboardDayWire(DAY);
    assert.deepEqual(
      { ...after, projectionGeneration: 0, snapshotCursor: "pc:1" },
      { ...before, projectionGeneration: 0, snapshotCursor: "pc:1" },
    );
  });

  it("stays loudly degraded when a stored timeline row is corrupt", async () => {
    const w = await world();
    queuedEventOf(w, { seed: 1 });
    corruptLatest(w);
    w.projection.rebuildFromTimeline();
    assert.equal(w.projection.health().state, "degraded");
    assert.match(w.projection.health().lastError ?? "", /timeline rebuild failed/);
  });



  /** A raw stream line as ANOTHER process would append it — no writer, no apply. */
  function rawQueuedLineOf(w: DashboardWorld, seed: number, workflow: string): string {
    return JSON.stringify({
      t: "run.queued", kind: "run", pid: 777,
      ts: w.clock.now().toISOString(),
      workflow,
      runId: uuidOf(seed), attempt: 1,
      traceId: traceOf(seed), spanPath: traceOf(seed),
      itemId: uuidOf(seed + 5000),
      shape: "single", priority: "interactive", dryRun: false,
      actorId: "local-operator",
      title: `raw #${String(seed)}`,
      descriptorVersion: 1,
      contractFingerprint: HASH_A,
      resolvedInstance: { ucpath: "prod" },
      configFingerprint: HASH_B,
      configSnapshotId: UUID_4,
    });
  }

  it("folds each line exactly once — its own emissions included — and an idle tick changes nothing", async () => {
    const w = await world();
    queuedEventOf(w, { seed: 1 }); // the harness writer already ticked the tail once
    w.projection.ingestFromTimeline();
    w.projection.ingestFromTimeline();
    assert.equal(w.projection.health().state, "live");
    // A refold would either throw `run.queued replayed` (degrading) or bump
    // the event count; exactly-once means neither happened.
    assert.equal(w.projection.runFold(uuidOf(1))?.eventCount, 1);
  });

  it("does not observe another connection's uncommitted event, then sees it once after commit", async () => {
    const w = await world(); queuedEventOf(w, { seed: 1 });
    const other = otherConnection(w);
    try {
      other.database.withAuthorityTransaction(() => {
      other.writer.emit({ workflow: "person-lookup", runId: uuidOf(1), attempt: 1,
        traceId: traceOf(1), spanPath: `${traceOf(1)}/searching#1`, parentSpanPath: traceOf(1),
        t: "span.started", kind: "task", ts: w.clock.now().toISOString(), name: "searching" });
      w.projection.ingestFromTimeline();
      assert.equal(w.projection.health().state, "live");
      assert.equal(w.projection.runFold(uuidOf(1))?.taskSpans.length, 0);
      });
      w.projection.ingestFromTimeline(); w.projection.ingestFromTimeline();
      assert.equal(w.projection.runFold(uuidOf(1))?.taskSpans.length, 1);
    } finally { other.database.close(); }
  });

  it("ignores changed, corrupt and torn retired span files after SQLite history is available", async () => {
    const w = await world(); queuedEventOf(w, { seed: 1 });
    const before = w.projection.buildDashboardDayWire(DAY);
    mkdirSync(join(w.stateRoot, "spans"));
    appendFileSync(join(w.stateRoot, "spans", `person-lookup-${DAY}.jsonl`), "not-json\n{torn");
    w.projection.ingestFromTimeline();
    assert.deepEqual(w.projection.buildDashboardDayWire(DAY), before);
    w.projection.rebuildFromTimeline();
    assert.equal(w.projection.health().state, "live");
    assert.equal(w.projection.runFold(uuidOf(1))?.eventCount, 1);
  });

  it("notices a workflow whose first SQLite event arrives after boot", async () => {
    const w = await world();
    queuedEventOf(w, { seed: 1 });
    const nativeOwner = runRecordOf({ seed: 2, workflow: "zz-flow" });
    w.authority.put(nativeOwner);
    w.database.authority.runs.enqueue(nativeOwner);
    appendOther(w, JSON.parse(rawQueuedLineOf(w, 2, "zz-flow")));
    w.projection.ingestFromTimeline();
    assert.equal(w.projection.health().state, "live");
    assert.equal(w.projection.runFold(uuidOf(2))?.queued.workflow, "zz-flow");
  });

  it("degrades on a corrupt newly ingested record and the guarded rebuild refuses it", async () => {
    const w = await world({ collectRebuilds: true });
    queuedEventOf(w, { seed: 1 });
    appendOther(w, { t: "span.started", kind: "worker", workflow: "person-lookup", workerId: "other-worker",
      spanPath: "worker/other-worker", ts: w.clock.now().toISOString(), name: "Worker" });
    corruptLatest(w);
    w.projection.ingestFromTimeline();
    assert.equal(w.projection.health().state, "degraded");
    assert.match(w.projection.health().lastError ?? "", /timeline ingest failed/);
    assert.equal(w.scheduledRebuilds.length, 1);
    // The line is real history on disk, so recovery cannot succeed either —
    // it refuses the same line by name instead of quietly reading past it.
    w.scheduledRebuilds[0]();
    assert.equal(w.projection.health().state, "degraded");
    assert.match(w.projection.health().lastError ?? "", /timeline rebuild failed/);
    assert.throws(() => w.projection.buildDashboardDayWire(DAY), /degraded and refuses to serve counts/);
  });

  it("a rebuild resets the tail cursors, so replayed history is never refolded", async () => {
    const w = await world();
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    w.projection.rebuildFromTimeline();
    w.projection.ingestFromTimeline();
    assert.equal(w.projection.health().state, "live");
    assert.equal(w.projection.runFold(uuidOf(1))?.eventCount, 2);
  });

  it("refuses to render a span-known run that authority does not hold", async () => {
    const w = await world();
    queuedEventOf(w, { seed: 1 });
    w.authority.records.delete(uuidOf(1));
    assert.deepEqual(w.projection.buildDashboardDayWire(DAY).queueSurfaces, []);
    assert.equal(w.projection.queueSurface(uuidOf(1)), undefined);
  });

  it("emits count-neutral patches and count-bearing snapshots on the right events", async () => {
    const w = await world();
    queuedEventOf(w, { seed: 1 }); // new run: snapshot
    w.authority.put(runRecordOf({ seed: 1, lifecycle: { state: "running", ...CLAIM }, claimGeneration: 1 }));
    claimEventOf(w, 1); // canonical queued -> running: snapshot
    taskEventsOf(w, 1, "searching"); // still running: patch
    const kinds = w.changes.map(({ kind }) => kind);
    assert.deepEqual(kinds, ["snapshot", "snapshot", "patch"]);
    const patch = w.changes[2];
    if (patch.kind !== "patch") assert.fail("expected a patch change");
    assert.equal(patch.day, DAY);
    assert.equal(patch.patch.operation, "replace-queue-surface");
  });
});
