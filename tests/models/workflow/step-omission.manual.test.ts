import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { EidSchema } from "../../../src/rules/identity/ids.js";
import {
  planStepOmissions,
  stepManualFieldFitsLeaf,
  stepOmissionFactsSchema,
  UsDateFactSchema,
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

describe("representation check", () => {
  const text = { key: "value", label: "Value", kind: "text" } as const;
  const usDate = { key: "day", label: "Day", kind: "us-date" } as const;
  const isoDate = { key: "day", label: "Day", kind: "iso-date" } as const;
  const eid = { key: "eid", label: "EID", kind: "eid" } as const;
  const integer = { key: "count", label: "Count", kind: "integer", min: 3 } as const;
  const list = { key: "codes", label: "Codes", kind: "text-list" } as const;

  it("accepts a leaf whose every check the field's own constraints imply", () => {
    for (const [field, leaf] of [
      [text, z.string()], [text, z.string().min(1)], [text, z.string().optional()], [text, z.union([z.number(), z.string()])],
      [usDate, z.string().regex(/^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/u)], [usDate, UsDateFactSchema], [usDate, z.string().length(10)],
      [isoDate, z.iso.date()], [isoDate, z.string().max(10)], [eid, EidSchema], [eid, z.string().min(8).max(8)],
      [integer, z.number()], [integer, z.number().int()], [integer, z.number().int().min(3)], [integer, z.number().int().positive()],
      [list, z.array(z.string())], [list, z.array(z.string().min(1))],
    ] as const) assert.equal(stepManualFieldFitsLeaf(field, leaf), true, `${field.kind} ${JSON.stringify(leaf._zod.def.type)}`);
  });

  it("refuses a narrower same-kind leaf, a transform, a refinement or anything it cannot establish", () => {
    for (const [field, leaf] of [
      [text, z.literal("Typed value")], [text, z.string().min(5)], [text, z.string().max(20)], [text, z.string().refine(() => true)],
      [text, z.string().trim()], [text, z.string().transform((value) => value)], [text, z.string().catch("x")], [text, z.email()], [text, EidSchema],
      [usDate, z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/u)], [usDate, z.iso.date()], [isoDate, UsDateFactSchema], [eid, z.string().regex(/^108\d{5}$/u)],
      [integer, z.number().int().max(10)], [integer, z.number().int().min(4)], [{ ...integer, min: undefined }, z.number().int().min(0)], [integer, z.string()],
      [list, z.array(z.string()).min(1)], [list, z.array(z.string().min(2))], [list, z.string()],
    ] as const) assert.equal(stepManualFieldFitsLeaf(field, leaf), false, `${field.kind} ${JSON.stringify(leaf._zod.def.type)}`);
  });
});
