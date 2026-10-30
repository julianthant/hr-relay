import { descriptorRuntimeNodes } from "../../../../src/workflow-kit/workflow.js";
import { retainAuthoritySourceClosure } from '../../../../src/backend/storage/source-closure.js';
import { runClaim } from '../../../../src/models/run/record.js';
import { testRunService } from '../../../support/fixtures/run-lifecycle-fixtures.js';
import { createDryRunPreviewResultTestWorld } from "../../../support/helpers/backend/dry-run-preview-result-world.js";
import { deriveRunResultDigest } from "../../../../src/models/run/result.js";
import assert from "node:assert/strict";

import { afterEach, describe, it } from "vitest";
import { buildRunPreviewResult } from "../../../../src/backend/runs/lifecycle/run-result.js";
import { deriveRunEvidenceReceipt } from "../../../../src/backend/runs/provenance/evidence-receipt.js";
import { WRITE_FIXTURE_NODE_ID } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { FINALIZATION_FIELDS, finalizationClaimRunning, finalizationContext, finalizationDurableFootprint, finalizationHarness, finalizationPreviewDependencies, finalizationQueuedRun } from "../../../support/helpers/kuali-finalization-fixtures.js";
import { separationsKualiFinalizationDescriptor } from "../../../support/helpers/registered-workflows.js";

const retainedKualiPreviewOwners = new Set<object>();

const {kualiOpen, PREVIEW_RESULT_SCHEMA_HASH, harness, cleanup } = createDryRunPreviewResultTestWorld();


afterEach(cleanup);

describe("a dry run retains transaction preview accounting", () => {

  it("records an honest transaction.previewed span without any commit span", async () => {
    const h = await harness();
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


  it("derives a receipt that says unknown and none, and never verified-done", async () => {
    const k = await finalizationHarness();
    kualiOpen.push(k);
    const held: { k: typeof k; primary?: { error: unknown } } = { k };
    retainedKualiPreviewOwners.add(held);
    try {
    const { run, claim } = finalizationClaimRunning(
      k.database,
      k.clock,
      finalizationQueuedRun({ dryRun: true }),
    );
    const preview = await k.bound(() => k.sequencer.executeDryRun(finalizationContext(run, claim, true)));

    const built = buildRunPreviewResult(
      separationsKualiFinalizationDescriptor,
      run,
      descriptorRuntimeNodes(separationsKualiFinalizationDescriptor).map(node => node.id === preview.nodeId
        ? { nodeId: node.id, state: "transaction-preview", preview, samples: [] }
        : node.kind === "gate"
          ? { nodeId: node.id, state: "not-run", reason: "condition-false" }
          : { nodeId: node.id, state: "exercised" }),
      finalizationPreviewDependencies(run),
      k.clock,
    );
    assert.equal(built.record.resultSchemaHash, PREVIEW_RESULT_SCHEMA_HASH);

    const terminal = {
      ...run,
      version: run.version + 1,
      completion: { schemaVersion: 1, kind: "done", expectedVersion: run.version,
        claim, authorizedAt: built.record.createdAt, resultDigest: deriveRunResultDigest(built.record) },
      lifecycle: { state: "terminal", outcome: "done", endedAt: built.record.createdAt },
    };
    const { receipt } = deriveRunEvidenceReceipt({
      descriptor: separationsKualiFinalizationDescriptor,
      run: terminal,
      result: built.record,
      checkpoints: [],
    });


    const terminalCheck = receipt.verification
      .find(({ obligation }) => obligation === "completion.terminal-result");
    assert.ok(terminalCheck);
    assert.equal(terminalCheck.verdict, "unknown");
    assert.equal(terminalCheck.mandatory, true);

    const warning = receipt.warnings.find(({ code }) => code === "DRY_RUN_PREVIEW");
    assert.ok(warning, "a preview is a load-bearing uncertainty, not a footnote");
    assert.equal(warning.loadBearing, true);
    assert.match(warning.summary, /No external write was attempted/);

    assert.match(warning.summary, /staged its page and observed subject match/);

    assert.equal(receipt.result, "partial");
    assert.equal(receipt.confidence, "unknown");
    assert.deepEqual(receipt.output, [], "a preview produced no workflow output");
    // The run's own inputs are still stated — a preview reads for real.
    assert.ok(receipt.input.length > 0);

    assert.deepEqual(k.database.authority.writeIntents.listByRun(run.envelope.runId), []);
    const current = k.database.authority.runs.get(run.envelope.runId); assert.ok(current);
    const heldClaim = runClaim(current); assert.ok(heldClaim);
    assert.equal(testRunService(k.database, k.clock).requeue({ commandId: k.ids.uuid(), runId: current.envelope.runId, expectedVersion: current.version,
      claim: { workerId: heldClaim.workerId, claimGeneration: heldClaim.claimGeneration }, cause: 'recovery' }).state, 'applied');
    const after = k.database.authority.runs.get(run.envelope.runId); assert.ok(after);
    assert.equal(runClaim(after), undefined);
    retainedKualiPreviewOwners.delete(held);
    } catch (error) {
      held.primary = { error };
      const index = kualiOpen.indexOf(k); if (index >= 0) kualiOpen.splice(index, 1);
      throw retainAuthoritySourceClosure([error], { admission: held });
    }
  });


  it("derives an already-present preview's receipt, naming the probe rather than a subject", async () => {
    // A document whose persisted finalization ALREADY equals all twelve values
    // this run would write is exactly the `already-present` subject.
    const k = await finalizationHarness({ persistedFinalization: FINALIZATION_FIELDS });
    kualiOpen.push(k);
    const held: { k: typeof k; primary?: { error: unknown } } = { k };
    retainedKualiPreviewOwners.add(held);
    try {
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
      descriptorRuntimeNodes(separationsKualiFinalizationDescriptor).map(node => node.id === preview.nodeId
        ? { nodeId: node.id, state: "transaction-preview", preview, samples: [] }
        : node.kind === "gate"
          ? { nodeId: node.id, state: "not-run", reason: "condition-false" }
          : { nodeId: node.id, state: "exercised" }),
      finalizationPreviewDependencies(run),
      k.clock,
    );
    assert.equal(built.record.resultSchemaHash, PREVIEW_RESULT_SCHEMA_HASH);

    const terminal = {
      ...run,
      version: run.version + 1,
      completion: { schemaVersion: 1, kind: "done", expectedVersion: run.version,
        claim, authorizedAt: built.record.createdAt, resultDigest: deriveRunResultDigest(built.record) },
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


    const footprint = finalizationDurableFootprint(k);
    assert.equal(footprint.intent, undefined);
    assert.equal(footprint.checkpoint, undefined);
    assert.deepEqual(footprint.outboxes, []);

    assert.deepEqual(k.database.authority.writeIntents.listByRun(run.envelope.runId), []);
    const current = k.database.authority.runs.get(run.envelope.runId); assert.ok(current);
    const heldClaim = runClaim(current); assert.ok(heldClaim);
    assert.equal(testRunService(k.database, k.clock).requeue({ commandId: k.ids.uuid(), runId: current.envelope.runId, expectedVersion: current.version,
      claim: { workerId: heldClaim.workerId, claimGeneration: heldClaim.claimGeneration }, cause: 'recovery' }).state, 'applied');
    const after = k.database.authority.runs.get(run.envelope.runId); assert.ok(after);
    assert.equal(runClaim(after), undefined);
    retainedKualiPreviewOwners.delete(held);
    } catch (error) {
      held.primary = { error };
      const index = kualiOpen.indexOf(k); if (index >= 0) kualiOpen.splice(index, 1);
      throw retainAuthoritySourceClosure([error], { admission: held });
    }
  });


  it("keeps executeTransaction refusing a dry run, with zero durable footprint", async () => {
    const k = await finalizationHarness();
    kualiOpen.push(k);
    const held: { k: typeof k; primary?: { error: unknown } } = { k };
    retainedKualiPreviewOwners.add(held);
    try {
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

    assert.deepEqual(k.database.authority.writeIntents.listByRun(run.envelope.runId), []);
    const current = k.database.authority.runs.get(run.envelope.runId); assert.ok(current);
    const heldClaim = runClaim(current); assert.ok(heldClaim);
    assert.equal(testRunService(k.database, k.clock).requeue({ commandId: k.ids.uuid(), runId: current.envelope.runId, expectedVersion: current.version,
      claim: { workerId: heldClaim.workerId, claimGeneration: heldClaim.claimGeneration }, cause: 'recovery' }).state, 'applied');
    const after = k.database.authority.runs.get(run.envelope.runId); assert.ok(after);
    assert.equal(runClaim(after), undefined);
    retainedKualiPreviewOwners.delete(held);
    } catch (error) {
      held.primary = { error };
      const index = kualiOpen.indexOf(k); if (index >= 0) kualiOpen.splice(index, 1);
      throw retainAuthoritySourceClosure([error], { admission: held });
    }
  });

  it("refuses a preview of a transaction node that declares no dry-run arm", async () => {
    const k = await finalizationHarness();
    kualiOpen.push(k);
    const held: { k: typeof k; primary?: { error: unknown } } = { k };
    retainedKualiPreviewOwners.add(held);
    try {
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

    assert.deepEqual(k.database.authority.writeIntents.listByRun(run.envelope.runId), []);
    const current = k.database.authority.runs.get(run.envelope.runId); assert.ok(current);
    const heldClaim = runClaim(current); assert.ok(heldClaim);
    assert.equal(testRunService(k.database, k.clock).requeue({ commandId: k.ids.uuid(), runId: current.envelope.runId, expectedVersion: current.version,
      claim: { workerId: heldClaim.workerId, claimGeneration: heldClaim.claimGeneration }, cause: 'recovery' }).state, 'applied');
    const after = k.database.authority.runs.get(run.envelope.runId); assert.ok(after);
    assert.equal(runClaim(after), undefined);
    retainedKualiPreviewOwners.delete(held);
    } catch (error) {
      held.primary = { error };
      const index = kualiOpen.indexOf(k); if (index >= 0) kualiOpen.splice(index, 1);
      throw retainAuthoritySourceClosure([error], { admission: held });
    }
  });
});
