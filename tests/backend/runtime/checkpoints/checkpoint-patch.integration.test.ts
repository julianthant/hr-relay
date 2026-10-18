
import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { z } from "zod";
import { applyCheckpointPatches } from "../../../../src/backend/runtime/checkpoints/checkpoint-patch.js";
import { ContractFieldPathSchema } from "../../../../src/models/task/task-contract.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import {
CheckpointPatchSchema,
RunCheckpointRecordSchema,
type RunCheckpointRecord,
} from "../../../../src/models/workflow/checkpoint.js";
import { HASH_A,NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import {
QUEUED_RUN,
RUN_ID
} from "../../../support/fixtures/phase1f-run-fixtures.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});
const RUN2_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const EditOutput = z.strictObject({
  subject: z.string().min(1),
  eid: z.string().regex(/^10\d{6}$/u),
  disposition: z.string().min(1),
});
const OUTPUT_VALUE = { subject: "10456712", eid: "10456712", disposition: "retain" };

const PATCH = CheckpointPatchSchema.parse({
  nodeId: "extract",
  fieldPath: "eid",
  value: "10999999",
  correctedAt: "2026-08-08T13:00:00.000Z",
  reason: "operator verified the EID against the paper form",
});

const REPLAYED: RunCheckpointRecord = RunCheckpointRecordSchema.parse({
  workflowId: "wiring-edit-data",
  itemId: QUEUED_RUN.envelope.itemId,
  nodeId: "extract",
  attempt: 1,
  claimGeneration: 1,
  runId: RUN_ID,
  output: { schemaHash: deriveSchemaHash(EditOutput, "output"), value: OUTPUT_VALUE },
  descriptorVersion: 1,
  contractFingerprint: HASH_A,
  implFingerprint: HASH_A,
  provenance: [
    { path: "subject", source: "live", observedAt: NOW, originalObservedAt: NOW },
    { path: "eid", source: "live", observedAt: NOW, originalObservedAt: NOW },
    { path: "disposition", source: "live", observedAt: NOW, originalObservedAt: NOW },
  ],
  writtenAt: NOW,
});

/* ── 1. the applier ──────────────────────────────────────────────────────── */

describe("applyCheckpointPatches", () => {
  it("re-parses the whole output and moves provenance only on changed leaves", () => {
    const applied = applyCheckpointPatches({
      replayed: REPLAYED,
      patches: [PATCH],
      outputSchema: EditOutput,
      attempt: 2,
      claimGeneration: 1,
      runId: RUN2_ID,
      writtenAt: "2026-08-08T13:01:00.000Z",
    });
    assert.equal(applied.record.attempt, 2);
    assert.deepEqual(applied.record.output.value, { ...OUTPUT_VALUE, eid: "10999999" });
    const corrected = applied.record.provenance.find((fact) => String(fact.path) === "eid");
    assert.deepEqual(corrected, {
      path: "eid",
      source: "operator",
      observedAt: PATCH.correctedAt,
      originalObservedAt: NOW,
      correctedAt: PATCH.correctedAt,
      supersedes: NOW,
    });
    const untouched = applied.record.provenance.find((fact) => String(fact.path) === "subject");
    assert.deepEqual(untouched, REPLAYED.provenance[0]);
  });

  it("refuses a patched output the producing schema rejects", () => {
    assert.throws(() => applyCheckpointPatches({
      replayed: REPLAYED,
      patches: [{ ...PATCH, value: "not-an-eid" }],
      outputSchema: EditOutput,
      attempt: 2,
      claimGeneration: 1,
      runId: RUN2_ID,
      writtenAt: NOW,
    }));
  });

  it("refuses a path the checkpoint output does not carry", () => {
    assert.throws(
      () => applyCheckpointPatches({
        replayed: REPLAYED,
        patches: [{ ...PATCH, fieldPath: ContractFieldPathSchema.parse("salary.rate") }],
        outputSchema: EditOutput,
        attempt: 2,
        claimGeneration: 1,
        runId: RUN2_ID,
        writtenAt: NOW,
      }),
      /does not resolve through the checkpoint output|names a hop/u,
    );
  });
});

it("drops exact observation origins after an operator correction rather than laundering old source identity",()=>{
 const origin={runId:RUN_ID,attempt:1,spanPath:"original/extract#1.1",nodeId:"extract",taskId:"workflow:fixture/extract",field:"identity",path:[]};
 const replayed=RunCheckpointRecordSchema.parse({...REPLAYED,observationOrigins:Object.keys(OUTPUT_VALUE).map(key=>({path:[key],origin:{...origin,path:[key]}}))});
 const applied=applyCheckpointPatches({replayed,patches:[PATCH],outputSchema:EditOutput,attempt:2,claimGeneration:1,runId:RUN2_ID,writtenAt:"2026-08-08T13:01:00.000Z"});
 assert.equal(applied.record.observationOrigins,undefined);
 assert.equal(applied.record.provenance.find(fact=>fact.path==="eid")?.source,"operator");
});
