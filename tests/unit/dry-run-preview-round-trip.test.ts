import { testRunLifecycle, testWorkerPorts } from "./fixtures/run-lifecycle-fixtures.js";
/**
 * D210 — a previewed run through the REAL pipeline, end to end, with nothing
 * faked but the browser, clock, ids, timers, and span sink:
 *
 *   start plan accepts a dry-run start (D209, graph-derived)
 *   → the run is enqueued with `envelope.dryRun`
 *   → worker loop → interpreter → the sequencer's REAL `executeDryRun`
 *   → an honest `transaction.previewed` span
 *   → the run ENDS AT THE NODE with a terminal record that is a PREVIEW,
 *     bound to the preview schema hash and not the workflow's declared result
 *   → the evidence receipt derives, and says `unknown` / `none` where it must.
 *
 * The zero-write claims here are asserted against the authority DATABASE — no
 * `write_intents` row for the permanent key, no `run_checkpoints` row for the
 * transaction node, no `run_terminal_outbox` beyond the one the settlement
 * itself writes — because "nothing was committed" is a statement about durable
 * rows, and a function that returned proves nothing.
 */
import { fixtureDuoCeremonyGates } from "./fixtures/duo-ceremony-fixtures.js";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { workflowDryRunSupport, workflowTerminalResultExecution } from "../../src/base/workflow.js";
import { deriveRunEvidenceReceipt } from "../../src/core/evidence-receipt.js";
import { buildRunPreviewResult } from "../../src/core/run-result.js";
import { runWorkerLoop } from "../../src/core/worker-loop.js";
import { createWriteSequencer } from "../../src/core/write-sequencer.js";
import { manualClock, type TestClock } from "../../src/domain/clock.js";
import { WorkerIdSchema, WorkflowIdSchema } from "../../src/domain/ids.js";
import { RunDryRunPreviewResultSchema } from "../../src/domain/run/result.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import { separationsKualiFinalizationDescriptor } from "../helpers/registered-workflows.js";
import {
  FINALIZATION_FIELDS,
  finalizationClaimRunning,
  finalizationContext,
  finalizationDurableFootprint,
  finalizationHarness,
  finalizationPreviewDependencies,
  finalizationQueuedRun,
  type FinalizationHarness,
} from "./fixtures/kuali-finalization-fixtures.js";
import { ManualScheduler, recordingEmitter, recordingLogger } from "./fixtures/phase1f-executor-harness.js";
import { sequentialIdFactory } from "./fixtures/phase1f-run-fixtures.js";
import {
  absentProbeEvidence,
  buildWriteFixtureRegistry,
  createWriteFixtureWorld,
  WRITE_FIXTURE_IMPL_FINGERPRINT,
  WRITE_FIXTURE_KEY,
  WRITE_FIXTURE_NODE_ID,
  WRITE_FIXTURE_NOW,
  WRITE_FIXTURE_RUN_ID,
  WRITE_FIXTURE_WORKER_ID,
  WRITE_FIXTURE_WORKFLOW_ID,
  writeFixtureDescriptor,
  writeFixtureQueuedRun,
  writeFixtureSessions,
  type WriteFixtureWorld,
} from "./fixtures/write-sequencer-fixtures.js";

const roots: string[] = [];
const openDatabases: AuthorityDatabase[] = [];
const kualiOpen: FinalizationHarness[] = [];

afterEach(() => {
  for (const open of kualiOpen.splice(0)) open.dispose();
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const PREVIEW_RESULT_SCHEMA_HASH = deriveSchemaHash(RunDryRunPreviewResultSchema, "output");

interface Harness {
  readonly database: AuthorityDatabase;
  readonly clock: TestClock;
  readonly world: WriteFixtureWorld;
  readonly emitter: ReturnType<typeof recordingEmitter>;
  readonly run: (options?: Readonly<{ dryRun?: boolean; probe?: unknown }>) => Promise<void>;
}

function harness(): Harness {
  const root = mkdtempSync(join(tmpdir(), "hrauto-dry-run-preview-"));
  roots.push(root);
  const clock = manualClock(new Date(WRITE_FIXTURE_NOW));
  const database = AuthorityDatabase.open(
    { path: join(root, "state.db"), busyTimeoutMs: 250, migrationOwner: "unit-test" },
    clock,
  );
  openDatabases.push(database);

  const world = createWriteFixtureWorld();
  const stores = buildWriteFixtureRegistry(world);
  const sessions = writeFixtureSessions(world);
  const scheduler = new ManualScheduler(clock);
  const ids = sequentialIdFactory("c");
  const log = recordingLogger().log;
  const emitter = recordingEmitter();

  const run = async (options: Readonly<{ dryRun?: boolean; probe?: unknown }> = {}): Promise<void> => {
    const dryRun = options.dryRun ?? true;
    assert.equal(database.authority.runs.enqueue(writeFixtureQueuedRun({ dryRun })).state, "inserted");
    // D215 — a preview runs beat ①'s probe exactly as the real run does, so both
    // paths need one queued. `probe` on the queue lets a case decide what the
    // probe answers; the default is the ordinary absent read.
    world.probeResults.push(options.probe ?? absentProbeEvidence(WRITE_FIXTURE_NOW));
    await runWorkerLoop({
      ...testWorkerPorts(database, clock),
      workflowId: WorkflowIdSchema.parse(WRITE_FIXTURE_WORKFLOW_ID),
      workerId: WorkerIdSchema.parse(WRITE_FIXTURE_WORKER_ID),
      descriptor: writeFixtureDescriptor,
      stores,
      authority: database,
      sessionFactory: sessions.factory,
      emitter: emitter.emitter,
      clock,
      ids,
      scheduler,
      taskDeadlineMs: 60_000,
      sessionAcquireMs: 20_000,
      duoCeremony: fixtureDuoCeremonyGates(clock),
      heartbeatIntervalMs: 600_000,
      idleRepollMs: 1_000,
      log,
      stopSignal: new AbortController().signal,
      exitWhenIdle: true,
      writeSequencerFor: (manager) => createWriteSequencer({
        lifecycle: testRunLifecycle(database, clock),
        stores,
        authority: database,
        sessions: manager,
        emitter: emitter.emitter,
        clock,
        ids,
        scheduler,
        taskDeadlineMs: 60_000,
        operator: "local-operator",
        log,
        resolveImplFingerprint: () => WRITE_FIXTURE_IMPL_FINGERPRINT,
      }),
    });
  };

  return { database, clock, world, emitter, run };
}

function terminalRun(database: AuthorityDatabase) {
  const record = database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
  assert.ok(record, "the run row must exist");
  return record;
}

describe("D210 — a dry run previews its transaction node and ends there", () => {
  it("settles a previewed run with a preview record and NOTHING durable from the write half", async () => {
    const h = harness();
    await h.run();

    const record = terminalRun(h.database);
    assert.equal(record.lifecycle.state, "terminal");
    assert.equal(record.lifecycle.state === "terminal" ? record.lifecycle.outcome : "", "done");

    /*
     * The terminal record is a PREVIEW, and it says so in the one place a
     * consumer can check without trusting a field: the schema hash the bytes
     * are bound to. A reader demanding the workflow's declared result sees a
     * hash that is not the one it expects.
     */
    const result = h.database.authority.runResults.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(result, "a settled run holds its terminal record");
    assert.equal(result.resultSchemaHash, PREVIEW_RESULT_SCHEMA_HASH);
    assert.notEqual(
      result.resultSchemaHash,
      workflowTerminalResultExecution(writeFixtureDescriptor).schemaHash,
      "a preview must never be bound to the workflow's declared result schema",
    );
    const preview = RunDryRunPreviewResultSchema.parse(result.result.value);
    assert.equal(preview.kind, "dry-run-preview");
    assert.equal(preview.externalCommit, "none");
    assert.equal(preview.stoppedAtNodeId, WRITE_FIXTURE_NODE_ID);
    assert.equal(preview.preview.kind, "transaction-dry-run-preview");
    assert.equal(preview.preview.probe.state, "absent");
    assert.equal(preview.preview.outcome.state, "would-prepare");
    assert.equal(
      preview.preview.outcome.state === "would-prepare" ? preview.preview.outcome.subject.state : undefined,
      "match",
    );
    // The stop node is the one the graph derivation names — a preview cannot
    // claim to have stopped where the executor could not have stopped it.
    const support = workflowDryRunSupport(writeFixtureDescriptor);
    assert.equal(support.state === "supported" ? support.stopsAt : "", preview.stoppedAtNodeId);

    /* ── the whole point: zero durable footprint from the write half ─────── */
    assert.equal(
      h.database.authority.writeIntents.findByPermanentKey("ucpath", WRITE_FIXTURE_KEY),
      undefined,
      "zero write intents — the fence was never reached",
    );
    assert.equal(
      h.database.authority.runCheckpoints.latest(
        WRITE_FIXTURE_WORKFLOW_ID,
        record.envelope.itemId,
        WRITE_FIXTURE_NODE_ID,
      ),
      undefined,
      "zero transaction checkpoints — a preview settles nothing",
    );
    assert.equal(h.world.lastCapability, undefined, "no mutation capability was ever minted");
    assert.equal(
      h.world.events.some((event) => event.startsWith("commit-click:")),
      false,
      "zero commit clicks",
    );
    /*
     * D215 — this line used to assert the opposite, and asserting the opposite
     * was the defect: beat ①'s probe is the real path's FIRST act and can settle
     * the node before anything is staged, so a preview that skipped it rehearsed
     * a path the real run never takes. The probe is read-only, and the durable
     * assertions above are what prove the preview still wrote nothing.
     */
    assert.deepEqual(
      h.world.events.slice(0, 2),
      ["probe", "prepare"],
      "the preview probes first, then stages — the real path's order",
    );
    // The staged page WAS reached and the subject WAS observed — this is a real
    // preview, not an early exit.
    assert.ok(h.world.events.includes("prepare"), h.world.events.join(","));
    assert.ok(
      h.world.events.some((event) => event.startsWith("subject-read:")),
      h.world.events.join(","),
    );
  });

  it("records an honest transaction.previewed span and ends the run at the node", async () => {
    const h = harness();
    await h.run();

    const events = h.emitter.events();
    const previewed = events.filter((event) => event.t === "transaction.previewed");
    assert.equal(previewed.length, 1, "exactly one preview event");
    assert.deepEqual(
      { node: previewed[0].node, subject: previewed[0].subject, externalCommit: previewed[0].externalCommit },
      { node: WRITE_FIXTURE_NODE_ID, subject: "match", externalCommit: "none" },
    );
    assert.equal(
      events.some((event) => String(event.spanPath).endsWith("/commit")),
      false,
      "zero commit spans",
    );
    const runEnded = events.filter((event) => event.t === "span.ended" && event.kind === "run");
    assert.equal(runEnded.length, 1);
    assert.equal(runEnded[0].outcome, "done");
  });

  /**
   * The receipt arm runs on the REAL `separations-kuali-finalization` workflow and
   * the REAL sequencer, because a receipt is only meaningful over a workflow
   * whose evidence classifications actually exist — the fixture graph declares
   * none, and adding them would put test data in a production declaration.
   */
  it("derives a receipt that says unknown and none, and never verified-done", async () => {
    const k = finalizationHarness();
    kualiOpen.push(k);
    const { run, claim } = finalizationClaimRunning(
      k.database,
      k.clock,
      finalizationQueuedRun({ dryRun: true }),
    );
    const preview = await k.bound(() => k.sequencer.executeDryRun(finalizationContext(run, claim, true)));

    const built = buildRunPreviewResult(
      separationsKualiFinalizationDescriptor,
      run,
      preview,
      finalizationPreviewDependencies(run),
      k.clock,
    );
    assert.equal(built.record.resultSchemaHash, PREVIEW_RESULT_SCHEMA_HASH);

    const terminal = {
      ...run,
      lifecycle: { state: "terminal", outcome: "done", endedAt: built.record.createdAt },
    };
    const { receipt } = deriveRunEvidenceReceipt({
      descriptor: separationsKualiFinalizationDescriptor,
      run: terminal,
      result: built.record,
      checkpoints: [],
    });

    // D187: the terminal-result obligation has no record to verify, so it is
    // `unknown` — the honest verdict, and the one that makes `verified-done`
    // structurally unreachable.
    const terminalCheck = receipt.verification
      .find(({ obligation }) => obligation === "completion.terminal-result");
    assert.ok(terminalCheck);
    assert.equal(terminalCheck.verdict, "unknown");
    assert.equal(terminalCheck.mandatory, true);

    const warning = receipt.warnings.find(({ code }) => code === "DRY_RUN_PREVIEW");
    assert.ok(warning, "a preview is a load-bearing uncertainty, not a footnote");
    assert.equal(warning.loadBearing, true);
    assert.match(warning.summary, /No external write was attempted/);
    // The `would-prepare` half of D215's branch: this preview reached a staged
    // page and read a subject, and the warning says which.
    assert.match(warning.summary, /staged its page and observed subject match/);

    assert.equal(receipt.result, "partial");
    assert.equal(receipt.confidence, "unknown");
    assert.deepEqual(receipt.output, [], "a preview produced no workflow output");
    // The run's own inputs are still stated — a preview reads for real.
    assert.ok(receipt.input.length > 0);
  });

  /**
   * The OTHER receipt arm, and the reason it needed its own case: D215's
   * `DRY_RUN_PREVIEW` summary BRANCHES on the preview outcome, and until this
   * test only the `would-prepare` branch was ever executed. An
   * `already-present` preview staged no page and read no subject, so quoting a
   * subject verdict would be quoting a fact nobody observed — the warning must
   * say what the preview actually reached, which is its probe.
   *
   * Everything else about the receipt is identical to the arm above, and that
   * is the claim being pinned: the operator-facing verdict of a preview does
   * not improve because the probe settled it early.
   */
  it("derives an already-present preview's receipt, naming the probe rather than a subject", async () => {
    // A document whose persisted finalization ALREADY equals all twelve values
    // this run would write is exactly the `already-present` subject.
    const k = finalizationHarness({ persistedFinalization: FINALIZATION_FIELDS });
    kualiOpen.push(k);
    const { run, claim } = finalizationClaimRunning(
      k.database,
      k.clock,
      finalizationQueuedRun({ dryRun: true }),
    );
    const preview = await k.bound(() => k.sequencer.executeDryRun(finalizationContext(run, claim, true)));

    assert.equal(preview.probe.state, "present");
    assert.equal(preview.outcome.state, "already-present");

    const built = buildRunPreviewResult(
      separationsKualiFinalizationDescriptor,
      run,
      preview,
      finalizationPreviewDependencies(run),
      k.clock,
    );
    assert.equal(built.record.resultSchemaHash, PREVIEW_RESULT_SCHEMA_HASH);

    const terminal = {
      ...run,
      lifecycle: { state: "terminal", outcome: "done", endedAt: built.record.createdAt },
    };
    const { receipt } = deriveRunEvidenceReceipt({
      descriptor: separationsKualiFinalizationDescriptor,
      run: terminal,
      result: built.record,
      checkpoints: [],
    });

    const warning = receipt.warnings.find(({ code }) => code === "DRY_RUN_PREVIEW");
    assert.ok(warning, "a preview is a load-bearing uncertainty on either arm");
    assert.equal(warning.loadBearing, true);
    assert.match(warning.summary, /settled already-present at its present probe, before anything was staged/);
    assert.doesNotMatch(
      warning.summary,
      /observed subject/,
      "no page was staged, so there is no subject verdict to quote",
    );
    assert.match(warning.summary, /No external write was attempted/);

    // The verdict is unchanged: an early settlement is still a preview.
    const terminalCheck = receipt.verification
      .find(({ obligation }) => obligation === "completion.terminal-result");
    assert.ok(terminalCheck);
    assert.equal(terminalCheck.verdict, "unknown");
    assert.equal(terminalCheck.mandatory, true);
    assert.equal(receipt.result, "partial");
    assert.equal(receipt.confidence, "unknown");
    assert.deepEqual(receipt.output, [], "a preview produced no workflow output");

    // And the durable half, because a receipt is a projection and this program
    // asserts absence against the database: an already-present PREVIEW records
    // neither the observed-present intent nor the settlement checkpoint a real
    // already-present run would.
    const footprint = finalizationDurableFootprint(k);
    assert.equal(footprint.intent, undefined);
    assert.equal(footprint.checkpoint, undefined);
    assert.deepEqual(footprint.outboxes, []);
  });

  /**
   * D215 — the OTHER subject shape, and the reason the fix exists. The ordinary
   * separations subject has nothing pending, so beat ①'s probe settles the node
   * before any page is staged; the old preview evaluated `prepare` regardless and
   * reported a refusal the real run would never produce. A rehearsal that fails
   * where the performance succeeds is a false rehearsal.
   *
   * The honest preview is an OUTCOME, not a refusal: the run still ends `done` at
   * the node with a preview record, and it still writes nothing.
   */
  it("previews an already-present subject as an OUTCOME, staging nothing and writing nothing", async () => {
    const h = harness();
    await h.run({ probe: { state: "present", proof: { transactionId: "T900001" } } });

    const record = terminalRun(h.database);
    assert.equal(record.lifecycle.state === "terminal" ? record.lifecycle.outcome : "", "done");
    const result = h.database.authority.runResults.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(result);
    assert.equal(result.resultSchemaHash, PREVIEW_RESULT_SCHEMA_HASH);
    const preview = RunDryRunPreviewResultSchema.parse(result.result.value);
    assert.equal(preview.preview.probe.state, "present");
    assert.deepEqual(preview.preview.outcome, { state: "already-present", proofSource: "live-probe" });
    assert.equal(preview.externalCommit, "none");

    // Nothing was staged, and — the load-bearing half — nothing became durable.
    // A REAL already-present settlement writes a checkpoint and an
    // observed-present intent; a preview of one writes neither.
    assert.deepEqual(h.world.events, ["probe"], "the probe settled it; no page was ever staged");
    assert.equal(
      h.database.authority.writeIntents.findByPermanentKey("ucpath", WRITE_FIXTURE_KEY),
      undefined,
      "a preview never records an observed-present intent",
    );
    assert.equal(
      h.database.authority.runCheckpoints.latest(
        WRITE_FIXTURE_WORKFLOW_ID,
        record.envelope.itemId,
        WRITE_FIXTURE_NODE_ID,
      ),
      undefined,
      "a preview settles nothing, including an already-present settlement",
    );

    const previewed = h.emitter.events().filter((event) => event.t === "transaction.previewed");
    assert.equal(previewed.length, 1);
    assert.equal(
      previewed[0]?.subject,
      "not-observed",
      "no page was staged, so no subject was read — and the span says so rather than claiming a match",
    );
  });

  /**
   * D215's fail-loud half. The real path refuses to fence on an indeterminate
   * probe, so the preview refuses too: a rehearsal that answered where the real
   * run stops is the same defect from the other side, and staging a page the
   * real run would never have staged is exactly what this arm is fixing.
   */
  it("refuses the preview when the probe cannot answer, rather than staging anyway", async () => {
    const h = harness();
    await h.run({
      probe: { state: "unknown", reason: "the grid never rendered", observedAt: WRITE_FIXTURE_NOW },
    });

    const record = terminalRun(h.database);
    assert.equal(record.lifecycle.state === "terminal" ? record.lifecycle.outcome : "", "failed");
    const failureId = record.lifecycle.state === "terminal" ? record.lifecycle.failureId : undefined;
    assert.ok(failureId);
    const failure = h.database.authority.failures.get(failureId);
    assert.ok(failure);
    const diagnostic = `${failure.summary} ${failure.causeChain.map(({ summary }) => summary).join(" ")}`;
    assert.match(diagnostic, /is indeterminate; the real run would refuse/u);
    assert.doesNotMatch(diagnostic, /grid never rendered/u);
    assert.deepEqual(h.world.events, ["probe"], "nothing was staged behind an unanswerable probe");
    assert.equal(h.database.authority.runResults.get(WRITE_FIXTURE_RUN_ID), undefined);
    assert.equal(
      h.database.authority.writeIntents.findByPermanentKey("ucpath", WRITE_FIXTURE_KEY),
      undefined,
    );
  });

  /**
   * The §9.9 D-guard, kept: the arm that fences and clicks must never accept a
   * dry run. It is the one refusal that stands between a preview request and a
   * real HR write, and the preview arm landing does not retire it.
   */
  it("keeps executeTransaction refusing a dry run, with zero durable footprint", async () => {
    const k = finalizationHarness();
    kualiOpen.push(k);
    const { run, claim } = finalizationClaimRunning(
      k.database,
      k.clock,
      finalizationQueuedRun({ dryRun: true }),
    );

    await assert.rejects(
      k.bound(() => k.sequencer.executeTransaction(finalizationContext(run, claim, true))),
      /the sequencer never substitutes a real write for a preview/,
    );
    const footprint = finalizationDurableFootprint(k);
    assert.equal(footprint.intent, undefined);
    assert.equal(footprint.checkpoint, undefined);
    assert.deepEqual(footprint.outboxes, []);
    assert.equal(k.world.persistedFinalization, undefined);
  });

  it("refuses a preview of a transaction node that declares no dry-run arm", async () => {
    const k = finalizationHarness();
    kualiOpen.push(k);
    const { run, claim } = finalizationClaimRunning(
      k.database,
      k.clock,
      finalizationQueuedRun({ dryRun: true }),
    );
    const context = finalizationContext(run, claim, true);
    const node = { ...context.node, dryRun: "unsupported" as const };

    await assert.rejects(
      k.bound(() => k.sequencer.executeDryRun({ ...context, node })),
      /declares dryRun:"unsupported"; there is no preview arm to run/,
    );
    assert.deepEqual(k.world.events, [], "the refusal precedes the browser");
  });

  it("refuses to build a preview result for a run the operator did not ask to preview", async () => {
    const h = harness();
    await h.run({ dryRun: false });

    // The run committed for real, so its terminal record is the derived result.
    const result = h.database.authority.runResults.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(result);
    assert.notEqual(result.resultSchemaHash, PREVIEW_RESULT_SCHEMA_HASH);

    // And the factory refuses to mint a preview record for that run's envelope,
    // even handed a structurally valid preview: `envelope.dryRun` is the one
    // durable record of what was asked for, and it says no.
    assert.throws(
      () => buildRunPreviewResult(
        writeFixtureDescriptor,
        { ...terminalRun(h.database), lifecycle: { state: "running", workerId: WRITE_FIXTURE_WORKER_ID,
          claimedAt: WRITE_FIXTURE_NOW, heartbeatAt: WRITE_FIXTURE_NOW } },
        {
          kind: "transaction-dry-run-preview",
          nodeId: WRITE_FIXTURE_NODE_ID,
          prepare: { schemaHash: "a".repeat(64), value: {} },
          subject: { state: "unscoped", reviewedReasonId: "unscoped" },
          observedAt: WRITE_FIXTURE_NOW,
        },
        [],
        h.clock,
      ),
      /is not a dry run; a preview result may not be built for it/,
    );
  });
});
