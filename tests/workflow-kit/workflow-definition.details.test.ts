import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { compileWorkflow } from "../../src/workflow-kit/workflow-definition.js";
import { DetailProjectionSpecRuntimeSchema } from "../../src/models/workflow/presentation.js";
import { personLookupWorkflow } from "../../src/workflows/person-lookup/workflow.js";

const detail = { key: "resolved-name", label: "Name", source: { kind: "result" as const, fieldPath: "activeStatus.details.name" }, display: "text" as const };
describe("declared detail sources", () => {
  it("validates terminal-result sources and canonical input/result equality conditions", () => {
    const details = [detail, { key: "search", label: "Search", source: { kind: "input-title" as const }, display: "text" as const },
      { ...detail, key: "conditional-name", when: { source: { kind: "input" as const, fieldPath: "mode" }, equals: "match" } }];
    assert.deepEqual(compileWorkflow({ ...personLookupWorkflow, details }).descriptor.details, details);
    assert.throws(() => compileWorkflow({ ...personLookupWorkflow, details: [{ ...detail, source: { kind: "result", fieldPath: "activeStatus.missing" } }] }), /detail.*result/u);
    for (const kind of ["input", "result"] as const) assert.throws(() => compileWorkflow({ ...personLookupWorkflow,
      details: [{ ...detail, when: { source: { kind, fieldPath: "missing" }, equals: "match" } }] }), /detail.*condition/u);
  });
  it("retains node source path validation", () => {
    assert.throws(() => compileWorkflow({ ...personLookupWorkflow, details: [{ ...detail, source: { nodeId: "active-status", fieldPath: "missing" } }] }), /detail/u);
    assert.doesNotThrow(() => compileWorkflow({ ...personLookupWorkflow, details: [{ ...detail, source: { nodeId: "active-status", fieldPath: "details.name" } }] }));
  });
  it("rejects unknown properties on each source and condition boundary", () => {
    for (const source of [{ kind: "input-title", fieldPath: "ssn" }, { kind: "result", fieldPath: "activeStatus.state", nodeId: "active-status" },
      { nodeId: "active-status", fieldPath: "state", extra: true }]) assert.equal(DetailProjectionSpecRuntimeSchema.safeParse({ ...detail, source }).success, false);
    assert.equal(DetailProjectionSpecRuntimeSchema.safeParse({ ...detail, when: { source: { kind: "input", fieldPath: "mode", extra: true }, equals: "match" } }).success, false);
  });
});
