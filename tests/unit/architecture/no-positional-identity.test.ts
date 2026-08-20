/**
 * `no-positional-identity` — nothing durable is identified by where it sat.
 *
 * Two substitutions this guard exists to make unspellable:
 *
 * 1. **A position standing in for an identity.** An array index, a row number,
 *    or an ordinal is stable only until something is inserted, reordered, or
 *    retried. Every durable identity here is a branded id, so a bare integer or
 *    a plain string cannot be handed to a field that means "which person" or
 *    "which run".
 * 2. **One id kind wearing another's clothes.** A lowercase UUID matches the
 *    kebab-case slug pattern character for character, so before `slugText`
 *    refused the shape a run id could be written into a worker id and parse.
 *    Ref dashboard-surfaces §1.1 states the rule directly — workers persist across runs and
 *    "never receive a synthetic run id" — and this is where it is mechanical.
 *
 * The extracted-record case is the sharpest one: `StableRecordId` is derived
 * from the source digest plus page identity precisely so a "record 3" cannot
 * become a different person when an upstream page is re-extracted.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import {
  ActorIdSchema,
  DelegationEdgeIdSchema,
  GateIdSchema,
  NodeIdSchema,
  PredicateIdSchema,
  RunIdSchema,
  ScenarioAssertionIdSchema,
  SourceSurfaceIdSchema,
  StableRecordIdSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
} from "../../../src/domain/ids.js";
import { RunEnvelopeSchema } from "../../../src/domain/run/envelope.js";
import { RunRecordSchema } from "../../../src/domain/run/record.js";
import { WorkerLeaseRecordSchema } from "../../../src/domain/run/worker.js";
import { RunCheckpointRecordSchema } from "../../../src/domain/workflow/checkpoint.js";
import { QUEUED_RUN, RUN_ENVELOPE, WORKER_ID, WORKFLOW_ID } from "../fixtures/phase1f-run-fixtures.js";
import { HASH_A, HASH_B, NOW, UUID_1, UUID_3 } from "../fixtures/phase1c-contract-fixtures.js";

const UUID_TEXT = UUID_1;
const POSITIONAL_VALUES: readonly unknown[] = [0, 1, 42, "0", "1", "42", "-1", ""];

/** Every branded id whose text pattern a bare positional value must not satisfy. */
const IDENTITY_SCHEMAS: readonly (readonly [string, z.ZodType])[] = [
  ["RunId", RunIdSchema],
  ["WorkerId", WorkerIdSchema],
  ["WorkflowId", WorkflowIdSchema],
  ["NodeId", NodeIdSchema],
  ["GateId", GateIdSchema],
  ["ActorId", ActorIdSchema],
  ["DelegationEdgeId", DelegationEdgeIdSchema],
  ["PredicateId", PredicateIdSchema],
  ["ScenarioAssertionId", ScenarioAssertionIdSchema],
  ["SourceSurfaceId", SourceSurfaceIdSchema],
  ["StableRecordId", StableRecordIdSchema],
];

/** The slug-shaped ids a UUID must not be able to impersonate. */
const SLUG_IDENTITY_SCHEMAS: readonly (readonly [string, z.ZodType])[] = [
  ["WorkerId", WorkerIdSchema],
  ["WorkflowId", WorkflowIdSchema],
  ["NodeId", NodeIdSchema],
  ["GateId", GateIdSchema],
  ["ActorId", ActorIdSchema],
  ["DelegationEdgeId", DelegationEdgeIdSchema],
  ["PredicateId", PredicateIdSchema],
  ["ScenarioAssertionId", ScenarioAssertionIdSchema],
  ["SourceSurfaceId", SourceSurfaceIdSchema],
];

describe("no positional identity", () => {
  it("refuses an index, an ordinal, or a stringified number as any durable identity", () => {
    for (const [name, schema] of IDENTITY_SCHEMAS) {
      for (const value of POSITIONAL_VALUES) {
        assert.equal(
          schema.safeParse(value).success,
          false,
          `${name} accepted the positional value ${JSON.stringify(value)}`,
        );
      }
    }
  });

  it("refuses a UUID wherever a slug identity is expected", () => {
    for (const [name, schema] of SLUG_IDENTITY_SCHEMAS) {
      assert.equal(
        schema.safeParse(UUID_TEXT).success,
        false,
        `${name} accepted a UUID; a run id must not be spellable as one`,
      );
      assert.equal(
        schema.safeParse(UUID_TEXT.toUpperCase()).success,
        false,
        `${name} accepted an uppercase UUID`,
      );
    }
    // The refusal is shape-scoped, not a ban on hyphens or hex words.
    assert.equal(WorkerIdSchema.safeParse("worker-1").success, true);
    assert.equal(WorkerIdSchema.safeParse("abcdef01-2345-6789").success, true);
  });

  it("refuses a worker lease that identifies itself with a run id", () => {
    assert.throws(
      () => WorkerLeaseRecordSchema.parse({
        workerId: UUID_TEXT,
        workflow: WORKFLOW_ID,
        processId: 1,
        leaseGeneration: 1,
        lifecycle: { state: "idle", startedAt: NOW, heartbeatAt: NOW },
        control: { directive: "run", requestedAt: NOW, requestedBy: "local-operator" },
        version: 1,
        createdAt: NOW,
        updatedAt: NOW,
      }),
      /must not be a UUID/,
    );
  });

  it("refuses a run whose identity or attempt is positional", () => {
    for (const value of POSITIONAL_VALUES) {
      assert.equal(
        RunEnvelopeSchema.safeParse({ ...RUN_ENVELOPE, runId: value }).success,
        false,
        `run envelope accepted runId ${JSON.stringify(value)}`,
      );
    }
    // Attempt IS a counter — but a 1-based one that can never be zero or
    // negative, so "the zeroth attempt" is unspellable.
    assert.equal(RunEnvelopeSchema.safeParse({ ...RUN_ENVELOPE, attempt: 0 }).success, false);
    assert.equal(RunEnvelopeSchema.safeParse({ ...RUN_ENVELOPE, attempt: -1 }).success, false);
    assert.equal(RunEnvelopeSchema.safeParse({ ...RUN_ENVELOPE, attempt: 1.5 }).success, false);
    assert.equal(RunRecordSchema.safeParse({ ...QUEUED_RUN, version: 0 }).success, false);
  });

  it("refuses a checkpoint keyed by node position rather than node id", () => {
    const checkpoint = {
      workflowId: WORKFLOW_ID,
      itemId: UUID_3,
      nodeId: "searching",
      attempt: 1,
      claimGeneration: 1,
      runId: UUID_TEXT,
      output: { schemaHash: HASH_A, value: { ok: true } },
      descriptorVersion: 1,
      contractFingerprint: HASH_A,
      implFingerprint: HASH_B,
      provenance: [],
      writtenAt: NOW,
    };
    assert.equal(RunCheckpointRecordSchema.safeParse(checkpoint).success, true);
    for (const value of POSITIONAL_VALUES) {
      assert.equal(
        RunCheckpointRecordSchema.safeParse({ ...checkpoint, nodeId: value }).success,
        false,
        `checkpoint accepted nodeId ${JSON.stringify(value)}`,
      );
    }
  });

  it("keeps an extracted record's identity derived from content, not from its page order", () => {
    const digest = "a".repeat(64);
    assert.equal(StableRecordIdSchema.safeParse(`${digest}#i9-section-one#3`).success, true);
    // A page ordinal alone, or a zero page, cannot stand in for the identity.
    assert.equal(StableRecordIdSchema.safeParse("3").success, false);
    assert.equal(StableRecordIdSchema.safeParse(`${digest}#i9-section-one#0`).success, false);
    assert.equal(StableRecordIdSchema.safeParse(`#i9-section-one#3`).success, false);
  });

  it("names the worker id and the run id as different id kinds in the lease record", () => {
    assert.equal(WorkerIdSchema.safeParse(WORKER_ID).success, true);
    assert.equal(RunIdSchema.safeParse(WORKER_ID).success, false);
    assert.equal(WorkerIdSchema.safeParse(QUEUED_RUN.envelope.runId).success, false);
  });
});
