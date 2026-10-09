import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  StepOmissionsSchema,
  planStepOmissions,
  stepOmissionCascade,
  stepOmissionFactsSchema,
  type StepOmissionGraphView,
  type StepOmissionSpec,
} from "../../../../../src/models/workflow/step-omission.js";


const READING: StepOmissionSpec = {
  step: "reading",
  form: { fields: [{ key: "value", label: "Value", kind: "text" }] },
  produces: { fold: ({ facts }) => ({ folded: facts.value }) },
};
const WRITING: StepOmissionSpec = {
  step: "writing",
  form: { fields: [{ key: "transactionNumber", label: "Transaction number", kind: "text" }] },
  produces: { receipt: ({ facts }) => ({ transactionNumber: facts.transactionNumber }) },
};

function graph(overrides: Partial<StepOmissionGraphView> = {}): StepOmissionGraphView {
  return {
    nodes: [
      { id: "read", kind: "task", dependsOn: [] },
      { id: "fold", kind: "task", dependsOn: ["read"] },
      { id: "gate", kind: "gate", dependsOn: ["fold"] },
      { id: "approve", kind: "task", dependsOn: ["fold", "gate"] },
      { id: "write", kind: "transaction", dependsOn: ["approve"] },
      { id: "receipt", kind: "task", dependsOn: ["write"] },
    ],
    timeline: [
      { key: "reading", nodes: [{ id: "read" }, { id: "fold" }] },
      { key: "deciding", nodes: [{ id: "gate" }, { id: "approve" }] },
      { key: "writing", nodes: [{ id: "write" }, { id: "receipt" }] },
    ],
    stepOmissions: [READING, WRITING],
    ...overrides,
  };
}

describe("step omission facts schema", () => {
  it("derives one strict schema per form and refuses absence, extras and malformed kinds by field", () => {
    const schema = stepOmissionFactsSchema({
      fields: [
        { key: "eid", label: "EID", kind: "eid" },
        { key: "lastDay", label: "Last day", kind: "us-date" },
        { key: "kind", label: "Kind", kind: "enum", values: ["a", "b"] },
        { key: "count", label: "Count", kind: "integer", min: 1 },
        { key: "codes", label: "Codes", kind: "text-list" },
        { key: "flag", label: "Flag", kind: "boolean" },
      ],
    });
    assert.deepEqual(
      schema.parse({ eid: "10873698", lastDay: "06/18/2026", kind: "b", count: 2, codes: ["x"], flag: false }),
      { eid: "10873698", lastDay: "06/18/2026", kind: "b", count: 2, codes: ["x"], flag: false },
    );
    assert.equal(schema.safeParse({ eid: "1087369", lastDay: "06/18/2026", kind: "b", count: 2, codes: [], flag: true }).success, false);
    assert.equal(schema.safeParse({ eid: "10873698", lastDay: "2026-06-18", kind: "b", count: 2, codes: [], flag: true }).success, false);
    assert.equal(schema.safeParse({ eid: "10873698", lastDay: "06/18/2026", kind: "c", count: 2, codes: [], flag: true }).success, false);
    assert.equal(schema.safeParse({ eid: "10873698", lastDay: "06/18/2026", kind: "a", count: 0, codes: [], flag: true }).success, false);
    assert.equal(schema.safeParse({ eid: "10873698", lastDay: "06/18/2026", kind: "a", count: 1, codes: [], flag: true, extra: 1 }).success, false);
    assert.equal(schema.safeParse({ eid: "10873698", lastDay: "06/18/2026", kind: "a", count: 1, codes: [] }).success, false);
  });

  it("refuses a form that declares one key twice and an envelope that omits one step twice", () => {
    assert.throws(
      () => stepOmissionFactsSchema({ fields: [{ key: "a", label: "A", kind: "text" }, { key: "a", label: "A2", kind: "text" }] }),
      /declared twice/u,
    );
    assert.equal(StepOmissionsSchema.safeParse([{ step: "reading", facts: {} }, { step: "reading", facts: {} }]).success, false);
    assert.equal(StepOmissionsSchema.safeParse([]).success, false);
    assert.equal(StepOmissionsSchema.safeParse([{ step: "Reading", facts: {} }]).success, false);
  });
});

describe("planStepOmissions", () => {
  it("asserts what a producer rebuilds, omits the rest, and never touches a gate", () => {
    const plan = planStepOmissions(graph(), [{ step: "reading", facts: { value: "typed" } }]);
    assert.deepEqual(plan.refusals, []);
    assert.deepEqual([...plan.omitted.entries()], [["read", "reading"]]);
    assert.deepEqual([...plan.asserted.keys()], ["fold"]);
    assert.deepEqual(plan.asserted.get("fold")?.facts, { value: "typed" });
  });

  it("leaves a transaction unrun and rebuilds its receipt from the typed fact", () => {
    const plan = planStepOmissions(graph(), [{ step: "writing", facts: { transactionNumber: "T0001" } }]);
    assert.deepEqual(plan.refusals, []);
    assert.deepEqual([...plan.omitted.entries()], [["write", "writing"]]);
    assert.deepEqual([...plan.asserted.keys()], ["receipt"]);
  });

  it("refuses by name when an executing node reads a node the omission leaves unread", () => {
    const view = graph({ stepOmissions: [{ ...READING, produces: {} }, WRITING] });
    const plan = planStepOmissions(view, [{ step: "reading", facts: { value: "typed" } }]);
    // Both the gate and the approval fold read `fold`; each refusal names its own node.
    assert.deepEqual(plan.refusals.map(({ code, step }) => [code, step]), [
      ["dependency-omitted", "deciding"],
      ["dependency-omitted", "deciding"],
    ]);
    assert.match(plan.refusals[0]?.message ?? "", /node "gate" \(step "deciding"\) reads "fold"/u);
    assert.match(plan.refusals[1]?.message ?? "", /node "approve" \(step "deciding"\) reads "fold"/u);
    assert.match(plan.refusals[1]?.message ?? "", /omit step "deciding" too, or include step "reading"/u);
  });

  it("refuses an unknown step, a step without a declaration, and invalid facts — each as a value", () => {
    const plan = planStepOmissions(graph(), [
      { step: "sweeping", facts: {} },
      { step: "deciding", facts: {} },
      { step: "reading", facts: { value: 7 } },
    ]);
    assert.deepEqual(plan.refusals.map(({ code, step }) => [code, step]), [
      ["unknown-step", "sweeping"],
      ["step-not-omittable", "deciding"],
      ["facts-invalid", "reading"],
    ]);
    assert.match(plan.refusals[2]?.message ?? "", /invalid at: value/u);
    assert.equal(plan.asserted.size, 0);
    assert.equal(plan.omitted.size, 0);
  });

  it("throws on a declaration that produces a foreign node or a non-task node", () => {
    assert.throws(
      () => planStepOmissions(graph({ stepOmissions: [{ ...READING, produces: { receipt: () => ({}) } }] }), [{ step: "reading", facts: { value: "x" } }]),
      /produces node "receipt", which belongs to step "writing"/u,
    );
    assert.throws(
      () => planStepOmissions(graph({ stepOmissions: [{ ...WRITING, produces: { write: () => ({}) } }] }), [{ step: "writing", facts: { transactionNumber: "x" } }]),
      /gates and transactions are never substituted/u,
    );
  });
});

describe("stepOmissionCascade", () => {
  it("names the steps an omission forces out, to a fixpoint, and the step that blocks it", () => {
    const rows = stepOmissionCascade(graph());
    assert.deepEqual(rows.get("reading"), { state: "omittable", forces: [] });
    assert.deepEqual(rows.get("writing"), { state: "omittable", forces: [] });

    const blocked = stepOmissionCascade(graph({ stepOmissions: [{ ...READING, produces: {} }, WRITING] }));
    assert.deepEqual(blocked.get("reading"), { state: "blocked", by: "deciding", forces: [] });

    const chained = stepOmissionCascade(graph({
      stepOmissions: [
        { ...READING, produces: {} },
        { step: "deciding", form: { fields: [] }, produces: { approve: () => ({}) } },
        WRITING,
      ],
    }));

    assert.deepEqual(chained.get("reading"), { state: "omittable", forces: ["deciding"] });
  });
});
