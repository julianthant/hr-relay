/**
 * D307 — `resolveTerminalDependencies` (src/base/workflow.ts), reached through
 * `buildRunResult`, is the sealed factory's gate on an `asserted` or
 * `not-run/step-omitted` terminal-dependency claim. Every refusal here is a
 * fabrication the factory must catch: a node no omission can produce, a
 * schema/step mismatch, a step the run's own envelope never omitted, or a
 * non-omittable node dressed up as step-omitted.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { buildRunResult } from "../../../../../src/backend/runs/run-result.js";
import { manualClock } from "../../../../../src/domain/clock.js";
import { RunRecordSchema } from "../../../../../src/domain/run/record.js";
import { deriveSchemaHash } from "../../../../../src/domain/schema-bound-value.js";
import { RunCheckpointRecordSchema } from "../../../../../src/domain/workflow/checkpoint.js";
import { FixtureReadReceipt } from "../../../../fixtures/descriptor-fixtures.js";
import { FixtureCanonicalInput, stepOmissionTerminalDescriptor } from "./fixtures/step-omission-terminal-fixtures.js";
import { HASH_A, LATER, NOW } from "../../../../fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN } from "../../../../fixtures/phase1f-run-fixtures.js";

const CLOCK = manualClock(new Date(LATER));
const OUTPUT_HASH = deriveSchemaHash(FixtureReadReceipt.output, "output");
const ASSERTED_AT = NOW;

function runningRun(stepOmissions?: readonly { step: string; facts: Record<string, unknown> }[]) {
  return RunRecordSchema.parse({
    ...QUEUED_RUN,
    envelope: {
      ...QUEUED_RUN.envelope,
      workflow: stepOmissionTerminalDescriptor.id,
      contractFingerprint: stepOmissionTerminalDescriptor.contractFingerprint,
      ...(stepOmissions === undefined ? {} : { stepOmissions }),
    },
    input: {
      ...QUEUED_RUN.input,
      parsed: {
        schemaHash: deriveSchemaHash(FixtureCanonicalInput, "output"),
        value: { eid: "10873698" },
      },
    },
    lifecycle: {
      state: "running",
      workerId: "worker-1",
      claimedAt: NOW,
      heartbeatAt: LATER,
      currentNodeId: "fold",
    },
    claimGeneration: 1,
    version: 4,
    updatedAt: LATER,
  });
}

function checkpoint(nodeId: "read" | "fold" | "skip", value: unknown) {
  return RunCheckpointRecordSchema.parse({
    workflowId: stepOmissionTerminalDescriptor.id,
    itemId: QUEUED_RUN.envelope.itemId,
    nodeId,
    attempt: 1,
    runId: QUEUED_RUN.envelope.runId,
    output: { schemaHash: OUTPUT_HASH, value },
    descriptorVersion: 1,
    contractFingerprint: stepOmissionTerminalDescriptor.contractFingerprint,
    implFingerprint: HASH_A,
    provenance: [{ path: "eid", source: "live", observedAt: NOW, originalObservedAt: NOW }],
    writtenAt: NOW,
  });
}

const RESOLVED_FOLD = { state: "resolved" as const, nodeId: "fold", checkpoint: checkpoint("fold", { eid: "10873698", present: true }) };
const RESOLVED_READ = { state: "resolved" as const, nodeId: "read", checkpoint: checkpoint("read", { eid: "10873698", present: true }) };
/** `skip` belongs to the "skipping" omittable step, which produces nothing for it — always legally step-omitted here. */
const NOT_RUN_SKIP = { state: "not-run" as const, nodeId: "skip", reason: "step-omitted" as const };

describe("resolveTerminalDependencies under step omission (D307)", () => {
  it("resolves a well-formed asserted dependency for an omitted, produced step", () => {
    const { record } = buildRunResult(
      stepOmissionTerminalDescriptor,
      runningRun([{ step: "reading", facts: { present: true } }]),
      [
        {
          state: "asserted", nodeId: "read", step: "reading", assertedAt: ASSERTED_AT,
          output: { schemaHash: OUTPUT_HASH, value: { eid: "10873698", present: true } },
        },
        RESOLVED_FOLD,
        NOT_RUN_SKIP,
      ],
      CLOCK,
    );
    assert.deepEqual(record.dependencies.map((dependency) => [dependency.nodeId, dependency.state]), [
      ["read", "asserted"],
      ["fold", "resolved"],
      ["skip", "not-run"],
    ]);
  });

  it("refuses an asserted claim for a node no step omission can produce (\"not producible\")", () => {
    assert.throws(
      () => buildRunResult(
        stepOmissionTerminalDescriptor,
        runningRun([{ step: "reading", facts: { present: true } }]),
        [
          RESOLVED_READ,
          {
            state: "asserted", nodeId: "fold", step: "folding", assertedAt: ASSERTED_AT,
            output: { schemaHash: OUTPUT_HASH, value: { eid: "10873698", present: true } },
          },
          NOT_RUN_SKIP,
        ],
        CLOCK,
      ),
      /dependency fold is not producible by any step omission and cannot be asserted/,
    );
  });

  it("refuses an asserted claim whose output schemaHash does not match the node's own contract", () => {
    assert.throws(
      () => buildRunResult(
        stepOmissionTerminalDescriptor,
        runningRun([{ step: "reading", facts: { present: true } }]),
        [
          {
            state: "asserted", nodeId: "read", step: "reading", assertedAt: ASSERTED_AT,
            output: { schemaHash: HASH_A, value: { eid: "10873698", present: true } },
          },
          RESOLVED_FOLD,
          NOT_RUN_SKIP,
        ],
        CLOCK,
      ),
      /dependency read asserted output schema .* does not match/,
    );
  });

  it("refuses an asserted claim whose step is not the node's own declared omittable step", () => {
    assert.throws(
      () => buildRunResult(
        stepOmissionTerminalDescriptor,
        runningRun([{ step: "reading", facts: { present: true } }]),
        [
          {
            state: "asserted", nodeId: "read", step: "folding", assertedAt: ASSERTED_AT,
            output: { schemaHash: OUTPUT_HASH, value: { eid: "10873698", present: true } },
          },
          RESOLVED_FOLD,
          NOT_RUN_SKIP,
        ],
        CLOCK,
      ),
      /dependency read is asserted for step "folding", but its declared omittable step is "reading"/,
    );
  });

  it("refuses an asserted claim for a step this run's envelope did not omit", () => {
    assert.throws(
      () => buildRunResult(
        stepOmissionTerminalDescriptor,
        runningRun(), // no stepOmissions on the envelope at all
        [
          {
            state: "asserted", nodeId: "read", step: "reading", assertedAt: ASSERTED_AT,
            output: { schemaHash: OUTPUT_HASH, value: { eid: "10873698", present: true } },
          },
          RESOLVED_FOLD,
          NOT_RUN_SKIP,
        ],
        CLOCK,
      ),
      /dependency read is asserted for step "reading", which this run did not omit/,
    );
  });

  it("refuses a not-run/step-omitted claim for a node that belongs to no omittable step", () => {
    assert.throws(
      () => buildRunResult(
        stepOmissionTerminalDescriptor,
        runningRun([{ step: "reading", facts: { present: true } }]),
        [
          RESOLVED_READ,
          { state: "not-run", nodeId: "fold", reason: "step-omitted" },
          NOT_RUN_SKIP,
        ],
        CLOCK,
      ),
      /dependency fold belongs to no omittable step and cannot be marked step-omitted/,
    );
  });

  it("refuses a not-run/operator-asserted claim outright — an assertion is never a not-run reason", () => {
    assert.throws(
      () => buildRunResult(
        stepOmissionTerminalDescriptor,
        runningRun([{ step: "reading", facts: { present: true } }]),
        [
          { state: "not-run", nodeId: "read", reason: "operator-asserted" },
          RESOLVED_FOLD,
          NOT_RUN_SKIP,
        ],
        CLOCK,
      ),
      /dependency read cannot be marked not-run as operator-asserted; an asserted node carries its output in the asserted evidence arm/,
    );
  });
});
