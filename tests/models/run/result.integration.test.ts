import { createDryRunPreviewResultTestWorld } from "../../support/helpers/backend/dry-run-preview-result-world.js";
import { createRunIntegrationTestWorld } from "../../support/helpers/run-integration-world.js";
import { default as assert } from "node:assert/strict";



import { afterEach } from "vitest";
import { describe } from "vitest";
import { it } from "vitest";
import { deriveRunResultDigest } from "../../../src/models/run/result.js";
import { deriveTerminalDependencyDigest } from "../../../src/models/run/result.js";


import { HASH_A } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { LATER } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { UUID_6 } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { RUN_ID } from "../../support/fixtures/phase1f-run-fixtures.js";

import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";
import { deriveCheckpointOutputDigest } from "../../../src/models/run/result.js";
import { deriveTerminalFailureDigest } from "../../../src/models/run/result.js";
import { RunTerminalEvidenceResultSchema } from "../../../src/models/run/result.js";



import { RunDryRunPreviewResultSchema } from "../../../src/models/run/result.js";



import { workflowDryRunSupport } from "../../../src/workflow-kit/workflow.js";
import { workflowTerminalResultExecution } from "../../../src/workflow-kit/workflow.js";





import { WRITE_FIXTURE_KEY } from "../../support/fixtures/write-sequencer-fixtures.js";
import { WRITE_FIXTURE_NODE_ID } from "../../support/fixtures/write-sequencer-fixtures.js";
import { WRITE_FIXTURE_NOW } from "../../support/fixtures/write-sequencer-fixtures.js";
import { WRITE_FIXTURE_RUN_ID } from "../../support/fixtures/write-sequencer-fixtures.js";

import { WRITE_FIXTURE_WORKFLOW_ID } from "../../support/fixtures/write-sequencer-fixtures.js";
import { writeFixtureDescriptor } from "../../support/fixtures/write-sequencer-fixtures.js";








import { buildRunEvidenceReceipt } from "../../../src/backend/runs/provenance/evidence-receipt.js";
import type { ReceiptBuildInput } from "../../../src/backend/runs/provenance/evidence-receipt.js";
import { RunRecordSchema } from "../../../src/models/run/record.js";
import type { RunEvidenceReceipt } from "../../../src/models/trust/evidence.js";
import { kualiReceiptEvidence } from "../../support/fixtures/receipt-run-fixtures.js";
import { separationsKualiFinalizationDescriptor } from "../../support/helpers/registered-workflows.js";

{

const {CLAIM, openDatabase, startRunning, resultRequest, cleanup } = createRunIntegrationTestWorld();


describe("atomic success terminal authority", () => {
afterEach(cleanup);

  it("rejects the former schema-valid complete/empty-dependencies fabrication bypass", () => {
    const database = openDatabase();
    const running = startRunning(database);
    const resultValue = { schemaHash: HASH_A, value: { complete: true } };
    const fabricated = {
      runId: running.envelope.runId,
      attempt: running.envelope.attempt,
      workflowId: running.envelope.workflow,
      descriptorVersion: running.envelope.descriptorVersion,
      contractFingerprint: running.envelope.contractFingerprint,
      configFingerprint: running.envelope.configFingerprint,
      configSnapshotId: running.envelope.configSnapshotId,
      resultSchemaHash: HASH_A,
      result: resultValue,
      resultDigest: deriveRunResultDigest(resultValue),
      dependencies: [],
      dependencyDigest: deriveTerminalDependencyDigest([]),
      createdAt: LATER,
    };
    const authorization = {
      kind: "done" as const,
      runId: fabricated.runId,
      workflowId: fabricated.workflowId,
      attempt: fabricated.attempt,
      descriptorVersion: fabricated.descriptorVersion,
      contractFingerprint: fabricated.contractFingerprint,
      expectedVersion: running.version,
      claim: CLAIM,
      authorizedAt: LATER,
      resultDigest: fabricated.resultDigest,
      };
    assert.throws(
      () => database.terminalizeSuccess({ result: fabricated, authorization }, {}),
      /lacks factory-authenticated/,
    );
    assert.equal(database.authority.runResults.get(RUN_ID), undefined);
    assert.equal(database.authority.runs.get(RUN_ID)?.completion, undefined);
  });

  it("rejects run/outbox identity, stale claim/version, generic done, and non-running success", () => {
    const database = openDatabase();
    const running = startRunning(database);
    const { result, authorization, factoryAuthorization } = resultRequest(database, running);
    assert.throws(() => database.terminalizeSuccess({
      result: { ...result, runId: UUID_6 },
      authorization,
    }), /must bind the exact result identity/);
    assert.throws(() => database.terminalizeSuccess({
      result,
      authorization: { ...authorization, expectedVersion: running.version - 1 },
    }, factoryAuthorization), /not/);
    assert.throws(() => database.terminalizeSuccess({
      result,
      authorization: {
        ...authorization,
        claim: { workerId: "worker-2", claimGeneration: 1 },
      },
    }, factoryAuthorization), /no longer claimed/);
    assert.throws(
      () => database.terminalizeSuccess({ result, authorization }),
      /lacks factory-authenticated/,
    );
    const fabricatedResult = {
      ...result,
      dependencies: [],
      dependencyDigest: deriveTerminalDependencyDigest([]),
    };
    assert.throws(
      () => database.terminalizeSuccess({
        result: fabricatedResult,
          authorization,
      }, {}),
      /lacks factory-authenticated/,
    );
    assert.throws(() => database.authority.runs.transition({
      runId: RUN_ID,
      expectedVersion: running.version,
      claim: CLAIM,
      lifecycle: { state: "terminal", outcome: "done", endedAt: LATER },
      now: LATER,
    }), /requires atomic terminal authority/);
    const cancelled = database.authority.runs.transition({
      runId: RUN_ID,
      expectedVersion: running.version,
      claim: CLAIM,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: LATER },
      now: LATER,
    });
    assert.equal(cancelled.state, "applied");
    assert.throws(() => database.terminalizeSuccess({
      result,
      authorization,
    }), /already terminal without a result/);
    assert.equal(database.authority.runResults.get(RUN_ID), undefined);
    assert.equal(database.authority.runs.get(RUN_ID)?.completion, undefined);
  });
});
}

{
describe("separations — start planning through the existing service", () => {

  it("keeps protected names and signed comments out of checkpoint and result fingerprint preimages", () => {
    const first = { schemaHash: HASH_A, value: { savedState: { fields: {
      timekeeperName: "Synthetic First Operator", timekeeperComments: "Filed. -SFO 06/19/2026",
    } }, dates: { dateChangeComments: "Updated. -SFO", separationDate: "06/19/2026" } } };
    const rotated = { schemaHash: HASH_A, value: { savedState: { fields: {
      timekeeperName: "Synthetic Second Operator", timekeeperComments: "Filed. -SSO 06/19/2026",
    } }, dates: { dateChangeComments: "Updated. -SSO", separationDate: "06/19/2026" } } };
    assert.equal(deriveCheckpointOutputDigest(first), deriveCheckpointOutputDigest(rotated));
    assert.equal(deriveRunResultDigest(first), deriveRunResultDigest(rotated));
    assert.notEqual(deriveRunResultDigest(first), deriveRunResultDigest({ ...first,
      value: { ...first.value, dates: { ...first.value.dates, separationDate: "06/20/2026" } } }));
  });
});
}

{
const { cleanup, PREVIEW_RESULT_SCHEMA_HASH, harness } = createDryRunPreviewResultTestWorld();

function terminalRun(database: AuthorityDatabase) {
  const record = database.authority.runs.get(WRITE_FIXTURE_RUN_ID);
  assert.ok(record, "the run row must exist");
  return record;
}

describe("a dry run previews its transaction node and ends there", () => {
afterEach(cleanup);

  it("settles a previewed run with a preview record and NOTHING durable from the write half", async () => {
    const h = harness();
    await h.run();

    const record = terminalRun(h.database);
    assert.equal(record.lifecycle.state, "terminal");
    assert.equal(record.lifecycle.state === "terminal" ? record.lifecycle.outcome : "", "done");


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


    const support = workflowDryRunSupport(writeFixtureDescriptor);
    assert.equal(support.state === "supported" ? support.stopsAt : "", preview.stoppedAtNodeId);


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

    assert.deepEqual(
      h.world.events.slice(0, 2),
      ["probe", "prepare"],
      "the preview probes first, then stages — the real path's order",
    );

    assert.ok(h.world.events.includes("prepare"), h.world.events.join(","));
    assert.ok(
      h.world.events.some((event) => event.startsWith("subject-read:")),
      h.world.events.join(","),
    );
  });

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
    const terminal = h.database.authority.runResults.get(WRITE_FIXTURE_RUN_ID);
    assert.ok(terminal);
    const retainedFailure = RunTerminalEvidenceResultSchema.parse(terminal.result.value);
    assert.equal(retainedFailure.kind, "failed-evidence");
    if (retainedFailure.kind !== "failed-evidence") throw new Error("terminal failure evidence missing");
    assert.equal(retainedFailure.authorization.failureId, failureId);
    assert.equal(retainedFailure.failureDigest, deriveTerminalFailureDigest(failure));
    assert.equal(
      h.database.authority.writeIntents.findByPermanentKey("ucpath", WRITE_FIXTURE_KEY),
      undefined,
    );
  });
});
}

{
const MOVED_CLOSURE = "9".repeat(64);

const descriptor = separationsKualiFinalizationDescriptor;

function runUnderMovedClosure(patch: Readonly<{
  envelope?: Record<string, unknown>;
  inputParsed?: Record<string, unknown>;
}> = {}): unknown {
  const run = RunRecordSchema.parse(kualiReceiptEvidence().run);
  return {
    ...run,
    envelope: { ...run.envelope, contractFingerprint: MOVED_CLOSURE, ...(patch.envelope ?? {}) },
    input: { ...run.input, parsed: { ...run.input.parsed, ...(patch.inputParsed ?? {}) } },
  };
}

function receiptFrom(overrides: Partial<ReceiptBuildInput> = {}): RunEvidenceReceipt {
  return buildRunEvidenceReceipt({ descriptor, ...kualiReceiptEvidence(), ...overrides });
}

function refusalFor(overrides: Partial<ReceiptBuildInput>): string {
  try {
    receiptFrom(overrides);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("the derivation was expected to refuse and did not");
}

describe("receipt derivation binding — a moved surface refuses by name", () => {

  it("refuses when the terminal dependency set the stored result was built from has moved", () => {
    const evidence = kualiReceiptEvidence();
    assert.ok(evidence.result !== null && typeof evidence.result === "object");


    const message = refusalFor({
      run: runUnderMovedClosure(),
      result: {
        ...evidence.result,
        dependencies: [],
        dependencyDigest: deriveTerminalDependencyDigest([]),
      },
    });
    assert.match(message, /terminal-dependency-set moved/);
    assert.match(message, /the mandatory-evidence set would move/);
  });
});
}
