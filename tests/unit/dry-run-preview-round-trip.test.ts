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
import { kualiTimekeeperAnnotationDescriptor } from "../../src/workflows/kuali-timekeeper-annotation/descriptor.js";
import {
  kualiClaimRunning,
  kualiContext,
  kualiDurableFootprint,
  kualiHarness,
  kualiQueuedRun,
  type KualiHarness,
} from "./fixtures/kuali-transaction-fixtures.js";
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
const kualiOpen: KualiHarness[] = [];

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
  readonly run: (options?: Readonly<{ dryRun?: boolean }>) => Promise<void>;
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

  const run = async (options: Readonly<{ dryRun?: boolean }> = {}): Promise<void> => {
    const dryRun = options.dryRun ?? true;
    assert.equal(database.authority.runs.enqueue(writeFixtureQueuedRun({ dryRun })).state, "inserted");
    // A real run would need this; a preview must never reach the probe at all,
    // which is one of the things the durable assertions below prove.
    world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW));
    await runWorkerLoop({
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
      heartbeatIntervalMs: 600_000,
      idleRepollMs: 1_000,
      log,
      stopSignal: new AbortController().signal,
      exitWhenIdle: true,
      writeSequencerFor: (manager) => createWriteSequencer({
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
    assert.equal(preview.preview.subject.state, "match");
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
    assert.equal(h.world.events.includes("probe"), false, "a preview never runs the prewrite probe");
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
   * The receipt arm runs on the REAL `kuali-timekeeper-annotation` workflow and
   * the REAL sequencer, because a receipt is only meaningful over a workflow
   * whose evidence classifications actually exist — the fixture graph declares
   * none, and adding them would put test data in a production declaration.
   */
  it("derives a receipt that says unknown and none, and never verified-done", async () => {
    const k = kualiHarness();
    kualiOpen.push(k);
    const { run, claim } = kualiClaimRunning(k.database, k.clock, kualiQueuedRun({ dryRun: true }));
    const preview = await k.bound(() => k.sequencer.executeDryRun(kualiContext(run, claim, true)));

    const built = buildRunPreviewResult(kualiTimekeeperAnnotationDescriptor, run, preview, [], k.clock);
    assert.equal(built.record.resultSchemaHash, PREVIEW_RESULT_SCHEMA_HASH);

    const terminal = {
      ...run,
      lifecycle: { state: "terminal", outcome: "done", endedAt: built.record.createdAt },
    };
    const { receipt } = deriveRunEvidenceReceipt({
      descriptor: kualiTimekeeperAnnotationDescriptor,
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

    assert.equal(receipt.result, "partial");
    assert.equal(receipt.confidence, "unknown");
    assert.deepEqual(receipt.output, [], "a preview produced no workflow output");
    // The run's own inputs are still stated — a preview reads for real.
    assert.ok(receipt.input.length > 0);
  });

  /**
   * The §9.9 D-guard, kept: the arm that fences and clicks must never accept a
   * dry run. It is the one refusal that stands between a preview request and a
   * real HR write, and the preview arm landing does not retire it.
   */
  it("keeps executeTransaction refusing a dry run, with zero durable footprint", async () => {
    const k = kualiHarness();
    kualiOpen.push(k);
    const { run, claim } = kualiClaimRunning(k.database, k.clock, kualiQueuedRun({ dryRun: true }));

    await assert.rejects(
      k.bound(() => k.sequencer.executeTransaction(kualiContext(run, claim, true))),
      /the sequencer never substitutes a real write for a preview/,
    );
    const footprint = kualiDurableFootprint(k);
    assert.equal(footprint.intent, undefined);
    assert.equal(footprint.checkpoint, undefined);
    assert.deepEqual(footprint.outboxes, []);
    assert.equal(k.world.persistedTimekeeperName, "");
  });

  it("refuses a preview of a transaction node that declares no dry-run arm", async () => {
    const k = kualiHarness();
    kualiOpen.push(k);
    const { run, claim } = kualiClaimRunning(k.database, k.clock, kualiQueuedRun({ dryRun: true }));
    const context = kualiContext(run, claim, true);
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
