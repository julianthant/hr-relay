import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { z } from "zod";
import type { FreshnessPolicy } from "../../../src/models/task/task-contract.js";
import { ContractFieldPathSchema } from "../../../src/models/task/task-contract.js";
import type { FactProvenance,RunCheckpointRecord } from "../../../src/models/workflow/checkpoint.js";
import {
CheckpointExpectationSchema,
FactProvenanceSchema,
FreshnessOverrideSchema,
RunCheckpointRecordSchema,
assertCheckpointFreshness,
auditCheckpointFreshness,
checkpointRecordKey,
loadCheckpoint,
} from "../../../src/models/workflow/checkpoint.js";
import { NodeIdSchema } from "../../../src/rules/identity/ids.js";
import { descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";
import { fixtureDescriptor } from "../../support/fixtures/descriptor-fixtures.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const NOW = new Date("2026-08-01T18:00:00.000Z");
const OUTPUT = z.strictObject({ eid: z.string().min(1), present: z.boolean() });

const EXPECTATION = CheckpointExpectationSchema.parse({
  descriptorVersion: 1,
  contractFingerprint: HASH_A,
  implFingerprint: HASH_B,
  outputSchemaHash: HASH_C,
});

/** Overrides are plain values; the schema does the branding, as storage would. */
function checkpoint(overrides: Readonly<Record<string, unknown>> = {}): RunCheckpointRecord {
  return RunCheckpointRecordSchema.parse({
    workflowId: "fixture-graph",
    itemId: "33333333-3333-4333-8333-333333333333",
    nodeId: "probe",
    attempt: 1,
    claimGeneration: 1,
    runId: "22222222-2222-4222-8222-222222222222",
    output: { schemaHash: HASH_C, value: { eid: "10800000", present: true } },
    descriptorVersion: 1,
    contractFingerprint: HASH_A,
    implFingerprint: HASH_B,
    provenance: [],
    writtenAt: "2026-08-01T17:00:00.000Z",
    ...overrides,
  });
}

function provenance(observedAt: string, source = "live"): FactProvenance {
  return FactProvenanceSchema.parse({
    path: ContractFieldPathSchema.parse("eid"),
    source,
    observedAt,
    originalObservedAt: observedAt,
  });
}

const FRESHNESS: FreshnessPolicy = { defaultMaxAgeMs: 60 * 60 * 1000, defaultOverride: "forbidden" };

function walkInput(overrides: Partial<Parameters<typeof auditCheckpointFreshness>[0]> = {}) {
  const nodes = descriptorRuntimeNodes(fixtureDescriptor);
  return {
    workflowId: "fixture-graph",
    runId: "fx-180000-9f3e",
    startAt: NodeIdSchema.parse("recheck"),
    nodes,
    replayed: [{
      nodeId: NodeIdSchema.parse("probe"),
      taskId: "ucpath/read-termination-receipt",
      freshness: FRESHNESS,
      provenance: [provenance("2026-08-01T17:55:00.000Z")],
    }],
    scheduled: [NodeIdSchema.parse("submit")],
    now: NOW,
    attempt: 2,
    ...overrides,
  };
}

describe("run checkpoints", () => {
  it("returns a discriminated miss rather than an empty checkpoint", () => {
    const missing = loadCheckpoint(undefined, EXPECTATION, OUTPUT);
    assert.equal(missing.found, false);
    assert.equal(missing.found === false && missing.reason, "no-checkpoint");
    // There is no shape here a `?? {}` could produce.
    assert.equal(Object.hasOwn(missing, "output"), false);
  });

  it("replays a compatible checkpoint with its provenance", () => {
    const loaded = loadCheckpoint(
      checkpoint({ provenance: [provenance("2026-08-01T17:55:00.000Z")] }),
      EXPECTATION,
      OUTPUT,
    );
    assert.equal(loaded.found, true);
    if (!loaded.found) return;
    assert.deepEqual(loaded.output, { eid: "10800000", present: true });
    assert.equal(loaded.provenance.length, 1);
    assert.equal(loaded.attempt, 1);
  });

  it("refuses a version, contract, impl, or schema mismatch", () => {
    const cases = [
      [checkpoint({ descriptorVersion: 2 }), "descriptor-version-mismatch"],
      [checkpoint({ contractFingerprint: HASH_B }), "contract-fingerprint-mismatch"],
      [checkpoint({ implFingerprint: HASH_A }), "impl-fingerprint-mismatch"],
      [checkpoint({ output: { schemaHash: HASH_A, value: { eid: "10800000", present: true } } }), "output-schema-mismatch"],
    ] as const;
    for (const [record, reason] of cases) {
      const loaded = loadCheckpoint(record, EXPECTATION, OUTPUT);
      assert.equal(loaded.found, false, reason);
      assert.equal(loaded.found === false && loaded.reason, reason);
    }
  });

  it("reports a payload that no longer parses instead of returning it", () => {
    const loaded = loadCheckpoint(
      checkpoint({ output: { schemaHash: HASH_C, value: { eid: "10800000" } } }),
      EXPECTATION,
      OUTPUT,
    );
    assert.equal(loaded.found, false);
    assert.equal(loaded.found === false && loaded.reason, "payload-invalid");
    assert.match(loaded.found === false ? loaded.detail : "", /present/);
  });

  it("passes a fresh replay and refuses a stale one that reaches a scheduled commit", () => {
    assert.deepEqual(auditCheckpointFreshness(walkInput()), []);

    const stale = auditCheckpointFreshness(walkInput({
      replayed: [{
        nodeId: NodeIdSchema.parse("probe"),
        taskId: "ucpath/read-termination-receipt",
        freshness: FRESHNESS,
        provenance: [provenance("2026-07-31T17:00:00.000Z")],
      }],
    }));
    assert.equal(stale.length, 1);
    assert.match(stale[0], /CheckpointFreshnessError/);
    assert.match(stale[0], /feeds commit node "submit"/);
    assert.match(stale[0], /age 25h00m/);
    assert.match(stale[0], /via probe → /);
    assert.throws(() => assertCheckpointFreshness(walkInput({
      replayed: [{
        nodeId: NodeIdSchema.parse("probe"),
        taskId: "ucpath/read-termination-receipt",
        freshness: FRESHNESS,
        provenance: [provenance("2026-07-31T17:00:00.000Z")],
      }],
    })), /CheckpointFreshnessError/);
  });

  it("passes trivially when no commit is scheduled in this run", () => {
    // person-lookup's own case: a stale read is safe-but-refusable only where a
    // write can consume it, so a run with no commit sink has no freshness sink.
    assert.deepEqual(auditCheckpointFreshness(walkInput({
      scheduled: [],
      replayed: [{
        nodeId: NodeIdSchema.parse("probe"),
        taskId: "ucpath/read-termination-receipt",
        freshness: FRESHNESS,
        provenance: [provenance("2026-07-01T17:00:00.000Z")],
      }],
    })), []);
  });

  it("ages a derived fact from its oldest contributing live capture", () => {
    const derived = FactProvenanceSchema.parse({
      path: ContractFieldPathSchema.parse("eid"),
      source: "derived",
      // Re-derived a minute ago, but from a fact captured yesterday.
      observedAt: "2026-08-01T17:59:00.000Z",
      originalObservedAt: "2026-07-31T17:00:00.000Z",
    });
    const violations = auditCheckpointFreshness(walkInput({
      replayed: [{
        nodeId: NodeIdSchema.parse("probe"),
        taskId: "ucpath/read-termination-receipt",
        freshness: FRESHNESS,
        provenance: [derived],
      }],
    }));
    assert.equal(violations.length, 1, "a pure transform cannot refresh its own inputs");
  });

  it("honours an audited override for this attempt and refuses a forbidden one", () => {
    const audited: FreshnessPolicy = { defaultMaxAgeMs: 1_000, defaultOverride: "audited" };
    const replayed = [{
      nodeId: NodeIdSchema.parse("probe"),
      taskId: "ucpath/read-termination-receipt",
      freshness: audited,
      provenance: [provenance("2026-07-31T17:00:00.000Z")],
    }];
    const override = FreshnessOverrideSchema.parse({
      nodeId: "probe",
      fieldPaths: ["eid"],
      confirmedAt: "2026-08-01T17:59:00.000Z",
      reason: "confirmed with the operator",
      validForAttempt: 2,
    });
    assert.deepEqual(auditCheckpointFreshness(walkInput({ replayed, overrides: [override] })), []);
    // Single-resume scope: an override minted for attempt 2 does not carry.
    assert.equal(
      auditCheckpointFreshness(walkInput({ replayed, overrides: [override], attempt: 3 })).length,
      1,
    );
    // Identity and proof fields are forbidden and cannot be confirmed away.
    const forbidden = auditCheckpointFreshness(walkInput({
      replayed: [{ ...replayed[0], freshness: FRESHNESS }],
      overrides: [override],
    }));
    assert.match(forbidden.join("\n"), /override:"forbidden" and must be re-read/);
  });

  it("keys a checkpoint row by the logical item, node, attempt, and execution", () => {
    assert.equal(
      checkpointRecordKey(checkpoint()),
      ["fixture-graph", "33333333-3333-4333-8333-333333333333", "probe", "1", "1"].join("\u0000"),
    );
    assert.notEqual(checkpointRecordKey(checkpoint()), checkpointRecordKey(checkpoint({ attempt: 2 })));

    assert.notEqual(
      checkpointRecordKey(checkpoint()),
      checkpointRecordKey(checkpoint({ claimGeneration: 2 })),
    );
  });



});

it("rejects duplicate, out-of-output and mistyped observation addresses while preserving original-run replay origins", () => {
  const origin={runId:"aaaaaaaa-0001-4000-8000-000100000000",attempt:1,spanPath:"original/probe#2.3",nodeId:"probe",taskId:"workflow:fixture/read",field:"results",path:[0,"name"]};
  const output={schemaHash:HASH_C,value:{results:[{name:"Retained"}]}};
  const valid=checkpoint({output,observationOrigins:[{path:["results",0,"name"],origin}]});
  assert.deepEqual(valid.observationOrigins?.[0].origin,origin);
  for(const origins of [[{path:["results",0,"name"],origin},{path:["results",0,"name"],origin}], [{path:["missing"],origin}], [{path:["results","0","name"],origin}], []]) {
    assert.throws(()=>checkpoint({output,observationOrigins:origins}));
  }
  assert.equal(checkpoint({output}).observationOrigins,undefined);
});
