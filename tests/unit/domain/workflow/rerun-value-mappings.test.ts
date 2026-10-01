import { WORKFLOW_DESCRIPTORS } from "../../../../src/workflows/descriptor-registry.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { descriptorRuntimeNodes } from "../../../../src/base/workflow.js";
import { RerunValueMappingSchema } from "../../../../src/domain/workflow/rerun-values.js";
import { rerunTargetAccepts, validateRerunValueMappings, rerunSourceFieldSchema } from "../../../../src/validation/rerun-values.js";
import { eidMapping, mappedReadDescriptor } from "../../../fixtures/rerun-values-fixtures.js";
import { writeFixtureDescriptor } from "../../../fixtures/write-sequencer-fixtures.js";

describe("explicit Rerun mapping admission", () => {
  it("retains frozen explicit coordinates without inventing a mapping for any other field", () => {
    const descriptor = mappedReadDescriptor();
    assert.deepEqual(descriptor.rerunValues, [eidMapping]);
    assert.ok(Object.isFrozen(descriptor.rerunValues));
    assert.ok(Object.isFrozen(descriptor.rerunValues?.[0]));
    assert.equal(rerunTargetAccepts(descriptor, RerunValueMappingSchema.parse(eidMapping), "10812345"), true);
    assert.equal(rerunTargetAccepts(descriptor, RerunValueMappingSchema.parse(eidMapping), "invalid"), false);
  });
  for (const [name, patch, error] of [
    ["unknown source", { nodeId: "missing" }, /SOURCE_NODE_MISSING/u],
    ["unknown source path", { fieldPath: "missing" }, /Rerun source field/u],
    ["unknown input field", { targetFieldPath: "missing" }, /TARGET_FIELD_MISSING/u],
    ["unknown omission step", { targetStepKey: "missing" }, /TARGET_STEP_MISSING/u],
  ] as const) it(`rejects ${name}`, () => assert.throws(() => mappedReadDescriptor([{ ...eidMapping, ...patch }]), error));
  it("rejects duplicate coordinates even with another display label", () => {
    assert.throws(() => mappedReadDescriptor([eidMapping, { ...eidMapping, label: "Alias" }]), /duplicate Rerun/u);
  });
  it("rejects protected input targets", () => {
    const descriptor = mappedReadDescriptor();
    assert.throws(() => validateRerunValueMappings({ ...descriptor, nodes: descriptorRuntimeNodes(descriptor),
      protectedInputs: [{ inputPath: "eid" }] }, [eidMapping]), /TARGET_PROTECTED/u);
  });
  it("preserves nested union constraints and refuses coercion or positional guesses", () => {
    const view = { input: z.object({ value: z.union([z.object({ count: z.number().int().min(2) }), z.object({ other: z.string() })]).optional(),
      coerced: z.coerce.number(), list: z.array(z.string()) }), stepOmissions: [] };
    const mapping = RerunValueMappingSchema.parse({ ...eidMapping, targetFieldPath: "value.count" });
    assert.equal(rerunTargetAccepts(view, mapping, 2), true);
    assert.equal(rerunTargetAccepts(view, mapping, 1), false);
    assert.equal(rerunTargetAccepts(view, RerunValueMappingSchema.parse({ ...mapping, targetFieldPath: "coerced" }), "2"), false);
    assert.throws(() => rerunTargetAccepts(view, RerunValueMappingSchema.parse({ ...mapping, targetFieldPath: "list.0" }), "a"), /dot-delimited object path/u);
  });
  it("transaction paths must name the durable output or proof wrapper", () => {
    const node = descriptorRuntimeNodes(writeFixtureDescriptor).find((entry) => entry.kind === "transaction");
    assert.ok(node?.kind === "transaction");
    assert.throws(() => rerunSourceFieldSchema(node, "receiptId"), /SOURCE_NOT_A_VALUE/u);
    assert.equal(rerunSourceFieldSchema(node, "output.value.receiptId").schema, node.commit.uses.output);
    assert.equal(rerunSourceFieldSchema(node, "proof.value.receiptId").schema, node.commit.uses.writeSafety.completion.proofSchema);
  });
  it("compiles Separations mappings into the registered descriptor and validates existing omission fields", () => {
    const descriptor = WORKFLOW_DESCRIPTORS.find(({ id }) => id === "separations"); assert.ok(descriptor);
    const mappings = descriptor.rerunValues?.map((mapping) => RerunValueMappingSchema.parse(mapping)); assert.ok(mappings);
    assert.equal(mappings.length, 4);
    const date = mappings.find(({ fieldPath }) => fieldPath === "lastDayWorked"); assert.ok(date);
    assert.equal(rerunTargetAccepts(descriptor, date, "09/08/2026"), true);
    assert.equal(rerunTargetAccepts(descriptor, date, "not a date"), false);
    const gate = descriptorRuntimeNodes(descriptor).find(({ kind }) => kind === "gate"); assert.ok(gate);
    assert.throws(() => validateRerunValueMappings({ ...descriptor, nodes: descriptorRuntimeNodes(descriptor) },
      [{ ...date, nodeId: gate.id, fieldPath: "decision" }]), /SOURCE_NOT_A_VALUE/u);
    assert.equal(descriptor.capabilities?.editData, undefined);
  });

});
