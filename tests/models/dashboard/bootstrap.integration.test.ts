
import { describe,expect,it } from "vitest";
import { WorkflowStartWireSchema } from "../../../src/models/dashboard/bootstrap.js";

describe("bootstrap start-surface block", () => {

  it("refuses a start control arm that names a field kind the form vocabulary does not close over", () => {
    const step = {
      key: "reading",
      label: "Reading",
      includedByDefault: true,
      control: {
        state: "omittable",
        form: { fields: [{ key: "value", label: "Value", kind: "free-form" }] },
        forces: [],
      },
    };
    expect(WorkflowStartWireSchema.safeParse({
      enqueue: "reject-active", version: 1, spreadsheetIntake: false, steps: [step],
    }).success).toBe(false);
  });

  it("refuses a start block carrying a field the modal does not read", () => {
    const block = { enqueue: "reject-active", version: 1, inputRun: undefined, note: "extra" };
    expect(WorkflowStartWireSchema.safeParse(block).success).toBe(false);
  });


  it("requires the version — a modal cannot guess which shape it is starting", () => {
    const block = { enqueue: "reject-active" };
    expect(WorkflowStartWireSchema.safeParse(block).success).toBe(false);
  });

  it("refuses a version that is not a positive integer", () => {
    for (const version of [0, -1, 1.5]) {
      expect(
        WorkflowStartWireSchema.safeParse({ enqueue: "reject-active", version }).success,
        String(version),
      ).toBe(false);
    }
  });
});
