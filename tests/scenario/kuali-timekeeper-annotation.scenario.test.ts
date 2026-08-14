/**
 * Executable scenarios for Phase 2's transaction proof — one per derived
 * coverage point on the `annotate-timekeeper` node.
 *
 * These four are driven by the REAL write sequencer over the REAL authority
 * database, not by a pure walk. That matters: doc 07's Phase-2 exit asks for
 * "staged preview plus subject observation with zero intent/commit", and "zero"
 * is a statement about durable rows. A pure walk could only report that a
 * function returned; these report that `write_intents`, `run_checkpoints`, and
 * `durable_outbox` are empty.
 *
 * NO SCENARIO HERE TOUCHES A REAL HR SYSTEM. The Kuali document is the
 * deterministic driver; the one controlled live commit is a separate,
 * operator-authorized act that has not been performed.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { workflowProjections, workflowTerminalResultExecution } from "../../src/base/workflow.js";
import { buildRunPreviewResult } from "../../src/core/run-result.js";
import { RunDryRunPreviewResultSchema } from "../../src/domain/run/result.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import { kualiTimekeeperAnnotationDescriptor } from "../../src/workflows/kuali-timekeeper-annotation/descriptor.js";
import {
  KUALI_EID,
  KUALI_IDEMPOTENCY_KEY,
  KUALI_NODE_ID,
  KUALI_OTHER_EID,
  KUALI_TIMEKEEPER_VALUE,
  kualiClaimRunning,
  kualiContext,
  kualiDurableFootprint,
  kualiHarness,
  kualiQueuedRun,
  type KualiHarness,
} from "../unit/fixtures/kuali-transaction-fixtures.js";
import { KUALI_TIMEKEEPER_CLAIMS } from "./coverage-claims.js";

const open: KualiHarness[] = [];
afterEach(() => {
  for (const harness of open.splice(0)) harness.dispose();
});

function harness(options?: Parameters<typeof kualiHarness>[0]): KualiHarness {
  const created = kualiHarness(options);
  open.push(created);
  return created;
}

function claimFor(scenarioId: string): readonly string[] {
  const claim = KUALI_TIMEKEEPER_CLAIMS.find((entry) => entry.scenarioId === scenarioId);
  assert.ok(claim, `no registered claim for ${scenarioId}`);
  return claim.covers;
}

describe("kuali-timekeeper-annotation scenarios", () => {
  it("kuali-timekeeper-annotation/dry-run-preview — stages and observes the subject with nothing durable", async () => {
    const h = harness();
    const { run, claim } = kualiClaimRunning(h.database, h.clock, kualiQueuedRun({ dryRun: true }));

    const preview = await h.bound(() => h.sequencer.executeDryRun(kualiContext(run, claim, true)));

    assert.equal(preview.kind, "transaction-dry-run-preview");
    assert.equal(preview.nodeId, KUALI_NODE_ID);
    assert.equal(preview.subject.state, "match");
    // The staged preview is real: the document was opened, the value staged and
    // read back, and the subject observed on that exact page.
    assert.deepEqual(h.world.events, [
      `open:${h.world.documentNumber}`,
      `stage:${KUALI_TIMEKEEPER_VALUE}`,
      "read:kuali.rrss-document.displayed-eid",
    ]);
    // …and Kuali itself is untouched: nothing was saved.
    assert.equal(h.world.persistedTimekeeperName, "");
    assert.equal(h.world.lastCapability, undefined, "no mutation capability was ever minted");

    const footprint = kualiDurableFootprint(h);
    assert.equal(footprint.intent, undefined, "zero write intents");
    assert.equal(footprint.checkpoint, undefined, "zero transaction checkpoints");
    assert.deepEqual(footprint.outboxes, [], "zero ledger/span outboxes");
    assert.equal(
      h.emitter.events().some((event) => String(event.spanPath).endsWith("/commit")),
      false,
      "zero commit spans",
    );

    /*
     * D210 — and the preview is a terminal record, not a value that evaporates.
     * The sealed factory turns it into the run's `RunResultRecord`, bound to the
     * PREVIEW schema hash rather than this workflow's declared result, so a
     * consumer demanding a committed transaction sees a hash it does not expect
     * instead of reading a preview as a completed write.
     */
    const built = buildRunPreviewResult(kualiTimekeeperAnnotationDescriptor, run, preview, [], h.clock);
    assert.equal(
      built.record.resultSchemaHash,
      deriveSchemaHash(RunDryRunPreviewResultSchema, "output"),
    );
    assert.notEqual(
      built.record.resultSchemaHash,
      workflowTerminalResultExecution(kualiTimekeeperAnnotationDescriptor).schemaHash,
    );
    const settled = RunDryRunPreviewResultSchema.parse(built.record.result.value);
    assert.equal(settled.externalCommit, "none");
    assert.equal(settled.stoppedAtNodeId, KUALI_NODE_ID);

    assert.deepEqual(claimFor("kuali-timekeeper-annotation/dry-run-preview"), [
      `transaction:${KUALI_NODE_ID}/dry-run`,
    ]);
  });

  it("kuali-timekeeper-annotation/subject-mismatch — a different displayed person yields zero fence and zero click", async () => {
    // The hardest arm, and the one doc 09 beat ③ exists for: the probe AND the
    // prepare both saw the right person, then the pooled page moved to a
    // different one before the fence. Only the kernel's own fresh observation
    // on the staged page can still stop this write.
    const h = harness({ displayedEidAfterStage: KUALI_OTHER_EID });
    const { run, claim } = kualiClaimRunning(h.database, h.clock);

    await assert.rejects(
      h.bound(() => h.sequencer.executeTransaction(kualiContext(run, claim))),
      /subject mismatch, zero fence, zero click/,
    );

    // The staged page WAS reached — this is not an early refusal.
    assert.ok(h.world.events.includes(`stage:${KUALI_TIMEKEEPER_VALUE}`));
    assert.equal(
      h.world.events.some((event) => event.startsWith("commit:")),
      false,
      "zero clicks",
    );
    assert.equal(h.world.persistedTimekeeperName, "", "Kuali was not written");
    const footprint = kualiDurableFootprint(h);
    assert.equal(footprint.intent, undefined, "zero write intents — the fence was never reached");
    assert.equal(footprint.checkpoint, undefined);
    assert.deepEqual(footprint.outboxes, []);

    assert.deepEqual(claimFor("kuali-timekeeper-annotation/subject-mismatch"), [
      `transaction:${KUALI_NODE_ID}/subject-mismatch`,
    ]);
  });

  it("kuali-timekeeper-annotation/committed — the full seven beats settle one fenced write", async () => {
    const h = harness();
    const { run, claim } = kualiClaimRunning(h.database, h.clock);

    const outcome = await h.bound(() => h.sequencer.executeTransaction(kualiContext(run, claim)));

    assert.deepEqual(outcome, {
      disposition: "committed",
      proofSource: "normal-output",
      output: {
        savedState: {
          kind: "kuali-saved-timekeeper",
          actionId: h.world.actionId,
          documentNumber: h.world.documentNumber,
          timekeeperName: KUALI_TIMEKEEPER_VALUE,
          observedEid: KUALI_EID,
          source: "reload-read-back",
        },
      },
      proof: {
        kind: "kuali-saved-timekeeper",
        actionId: h.world.actionId,
        documentNumber: h.world.documentNumber,
        timekeeperName: KUALI_TIMEKEEPER_VALUE,
        observedEid: KUALI_EID,
        source: "reload-read-back",
      },
    });
    // The ordering doc 09 §3 requires: probe → prepare → subject → click →
    // reload read-back. The click sits between the subject read and the proof.
    const order = h.world.events;
    const clickIndex = order.findIndex((event) => event.startsWith("commit:"));
    const subjectIndex = order.findIndex((event) => event.startsWith("read:kuali.rrss-document.displayed-eid"));
    const proofIndex = order.lastIndexOf(`read-back:${KUALI_TIMEKEEPER_VALUE}`);
    assert.ok(subjectIndex >= 0 && clickIndex > subjectIndex && proofIndex > clickIndex, order.join(" → "));

    const intent = h.database.authority.writeIntents.findByPermanentKey("kuali", KUALI_IDEMPOTENCY_KEY);
    assert.equal(intent?.status, "committed");
    assert.notEqual(kualiDurableFootprint(h).checkpoint, undefined, "the transaction checkpoint is durable");

    assert.deepEqual(claimFor("kuali-timekeeper-annotation/committed"), [
      `transaction:${KUALI_NODE_ID}/committed`,
    ]);
  });

  it("kuali-timekeeper-annotation/already-present — a live probe that finds the value never clicks", async () => {
    // The document already carries this exact annotation: the same key, the
    // same value, produced by someone or something else.
    const h = harness({ persistedTimekeeperName: KUALI_TIMEKEEPER_VALUE });
    const { run, claim } = kualiClaimRunning(h.database, h.clock);

    const outcome = await h.bound(() => h.sequencer.executeTransaction(kualiContext(run, claim)));

    assert.equal(Reflect.get(outcome as object, "disposition"), "already-present");
    assert.equal(Reflect.get(outcome as object, "proofSource"), "live-probe");
    assert.equal(
      h.world.events.some((event) => event.startsWith("commit:")),
      false,
      "an already-present key never clicks",
    );
    const intent = h.database.authority.writeIntents.findByPermanentKey("kuali", KUALI_IDEMPOTENCY_KEY);
    assert.equal(intent?.status, "observed-present", "discovering a write is not evidence WE filed it");

    assert.deepEqual(claimFor("kuali-timekeeper-annotation/already-present"), [
      `transaction:${KUALI_NODE_ID}/already-present`,
    ]);
  });

  it("covers every point the graph derives, and claims none it does not", () => {
    const derived = new Set(
      workflowProjections(kualiTimekeeperAnnotationDescriptor).coveragePoints.map((point) => point.id),
    );
    const claimed = new Set(KUALI_TIMEKEEPER_CLAIMS.flatMap((entry) => entry.covers));
    assert.deepEqual([...claimed].sort(), [...derived].sort());
  });
});
