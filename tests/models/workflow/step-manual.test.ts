import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  planStepOmissions,
  stepOmissionFactsSchema,
  StepOmissionsSchema,
  type StepOmissionGraphView,
} from "../../../src/models/workflow/step-omission.js";

const GRAPH: StepOmissionGraphView = {
  nodes: [
    { id: "search", kind: "task", dependsOn: [] },
    { id: "read", kind: "task", dependsOn: ["search"] },
    { id: "check", kind: "task", dependsOn: ["read"] },
    { id: "save", kind: "transaction", dependsOn: ["read"] },
  ],
  timeline: [
    { key: "reading", nodes: [{ id: "search" }, { id: "read" }, { id: "check" }] },
    { key: "saving", nodes: [{ id: "save" }] },
  ],
  stepOmissions: [{
    step: "reading",
    form: { fields: [{ key: "value", label: "Value", kind: "text" }] },
    produces: { read: ({ facts }) => ({ value: facts.value }) },
    skips: ["search"],
  }],
};

describe("manual field kinds", () => {
  it("accepts null for an optional field and refuses null for a required one", () => {
    const schema = stepOmissionFactsSchema({ fields: [
      { key: "hrStatus", label: "HR status", kind: "text", optional: true },
      { key: "name", label: "Name", kind: "text" },
    ] });
    assert.deepEqual(schema.parse({ hrStatus: null, name: "Ada" }), { hrStatus: null, name: "Ada" });
    assert.equal(schema.safeParse({ hrStatus: "Active", name: null }).success, false);
    assert.equal(schema.safeParse({ name: "Ada" }).success, false);
  });

  it("accepts an employee id only in the EID form, eight digits beginning with 10", () => {
    const schema = stepOmissionFactsSchema({ fields: [{ key: "eid", label: "Employee ID", kind: "eid" }] });
    assert.deepEqual(schema.parse({ eid: "10812345" }), { eid: "10812345" });
    for (const eid of ["12345678", "00000000", "1081234", "108123456"]) assert.equal(schema.safeParse({ eid }).success, false, eid);
  });

  it("stores an iso-date as YYYY-MM-DD only", () => {
    const schema = stepOmissionFactsSchema({ fields: [{ key: "oathDate", label: "Oath date", kind: "iso-date" }] });
    assert.deepEqual(schema.parse({ oathDate: "2026-06-18" }), { oathDate: "2026-06-18" });
    assert.equal(schema.safeParse({ oathDate: "06/18/2026" }).success, false);
    assert.equal(schema.safeParse({ oathDate: "2026-02-30" }).success, false);
  });
});

describe("manual planning", () => {
  it("asserts produced nodes, skips declared nodes and runs every other node of the step", () => {
    const plan = planStepOmissions(GRAPH, [{ step: "reading", facts: { value: "x" } }]);
    assert.deepEqual(plan.refusals, []);
    assert.deepEqual([...plan.asserted.keys()], ["read"]);
    assert.deepEqual([...plan.omitted.entries()], [["search", "reading"]]);
  });

  it("refuses a running node that reads a skipped one", () => {
    const plan = planStepOmissions({
      ...GRAPH,
      stepOmissions: [{ ...GRAPH.stepOmissions[0], produces: {}, skips: ["search", "read"] }],
    }, [{ step: "reading", facts: { value: "x" } }]);
    assert.deepEqual(plan.refusals.map(({ code, step }) => [code, step]), [
      ["dependency-omitted", "reading"],
      ["dependency-omitted", "saving"],
    ]);
  });

  it("does not plan an entry addressed to a child workflow against the parent's graph", () => {
    const plan = planStepOmissions(GRAPH, [{ workflow: "child-flow", step: "reading", facts: { value: "x" } }]);
    assert.deepEqual(plan.refusals, []);
    assert.equal(plan.asserted.size + plan.omitted.size, 0);
  });
});

describe("manual entries", () => {
  it("stores labels and a child workflow, and keys uniqueness by workflow and step", () => {
    const entries = [
      { step: "reading", facts: { value: "x" }, labels: { value: "Value" } },
      { workflow: "child-flow", step: "reading", facts: { value: "y" } },
    ];
    assert.deepEqual(StepOmissionsSchema.parse(entries), entries);
    assert.equal(StepOmissionsSchema.safeParse([entries[0], entries[0]]).success, false);
  });
});
