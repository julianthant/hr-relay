import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { taskId } from "../../src/rules/identity/ids.js";
import { taskImplFingerprint, workflowContractFingerprint } from "../../src/workflow-kit/fingerprints.js";

const Input = z.strictObject({ eid: z.string() });
const Output = z.strictObject({ found: z.boolean() });
const read = { id: taskId("workflow:fixture/read-person"), effect: "read" as const, input: Input, output: Output };
const base = {
  id: "fixture-fingerprint", version: 1, input: Input, canonicalInput: Input, result: Output,
  graph: [{ id: "read", kind: "task", dependsOn: [] }], contracts: [read],
} as const;

describe("contract fingerprints", () => {
  it("are stable for the same declared shapes, whatever object carries them", () => {
    assert.equal(workflowContractFingerprint(base), workflowContractFingerprint({ ...base, contracts: [{ ...read }] }));
    assert.equal(taskImplFingerprint(read), taskImplFingerprint({ ...read, input: z.strictObject({ eid: z.string() }) }));
  });

  it("move with the version, a declared schema, the graph or a task contract", () => {
    const original = workflowContractFingerprint(base);
    for (const changed of [
      { ...base, version: 2 },
      { ...base, input: z.strictObject({ eid: z.string(), name: z.string() }) },
      { ...base, result: z.strictObject({ found: z.boolean(), eid: z.string() }) },
      { ...base, graph: [{ id: "read", kind: "task", dependsOn: [] }, { id: "again", kind: "task", dependsOn: ["read"] }] },
      { ...base, contracts: [{ ...read, output: z.strictObject({ found: z.string() }) }] },
      { ...base, contracts: [{ ...read, id: taskId("fixture/read-other") }] },
    ]) assert.notEqual(workflowContractFingerprint(changed), original);
    assert.notEqual(taskImplFingerprint({ ...read, output: z.strictObject({ found: z.string() }) }), taskImplFingerprint(read));
    assert.notEqual(taskImplFingerprint({ ...read, effect: "prepare" as const }), taskImplFingerprint(read));
  });
});
