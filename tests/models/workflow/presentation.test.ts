import { describe, expect, it } from "vitest";
import { WorkflowOperatorFieldSchema, TimelineCategorySpecSchema, TimelineCategoryProjectionSchema } from "../../../src/models/workflow/presentation.js";

const field = { label: "Typed value", sources: [{ nodeId: "reading", kind: "output", fieldPath: "state" }], display: { cases: [{ value: true, text: "Boolean yes" }, { value: "true", text: "String true" }, { value: 1, text: "Number one" }] } };
describe("operator field scalar display declaration", () => {
  it("round trips typed cases through every owning timeline schema", () => {
    expect(WorkflowOperatorFieldSchema.parse(JSON.parse(JSON.stringify(field)))).toEqual(field);
    for (const [schema, nodes] of [[TimelineCategorySpecSchema, ["reading"]], [TimelineCategoryProjectionSchema, [{ id: "reading", label: "Read" }]]] as const) {
      expect(schema.parse({ key: "reading", label: "Read", nodes, operatorFields: [field] }).operatorFields?.[0]).toEqual(field);
    }
  });
  it("rejects duplicate typed literals and invalid display values", () => {
    for (const value of [true, "true", 1]) expect(WorkflowOperatorFieldSchema.safeParse({ ...field, display: { cases: [{ value, text: "A" }, { value, text: "B" }] } }).success).toBe(false);
    for (const display of [{ cases: [] }, { cases: [{ value: null, text: "Null" }] }, { cases: [{ value: {}, text: "Object" }] }, { cases: [{ value: 1, text: " " }] }]) expect(WorkflowOperatorFieldSchema.safeParse({ ...field, display }).success).toBe(false);
    expect(WorkflowOperatorFieldSchema.parse({ label: field.label, sources: field.sources }).display).toBeUndefined();
  });
});
