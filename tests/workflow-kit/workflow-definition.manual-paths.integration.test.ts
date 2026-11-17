import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import { resolveStartStepOmissions } from "../../src/backend/runs/start/step-selection.js";
import { I9IdentitySchema } from "../../src/models/workflows/i9-check/check.js";
import { valueLeafSchemaExact, valueLeafSchemaForManual } from "../../src/models/workflow/rerun-values.js";
import { EidSchema } from "../../src/rules/identity/ids.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../src/models/workflow/presentation.js";
import type { StepManualDeclaration } from "../../src/models/workflow/step-omission.js";
import { defineTaskContract } from "../../src/models/task/task-contract.js";
import { compileWorkflow, defineWorkflow } from "../../src/workflow-kit/workflow-definition.js";
import { defineWorkflowRole } from "../../src/workflow-kit/validation/module-role.js";
import { Plan1Input, Plan1CanonicalInput, plan1Contract } from "../support/fixtures/plan1-operation-workflows.js";

const { __sealed: _sealed, ...contract } = plan1Contract;
function fixture(output: z.ZodType, example: unknown, manual: StepManualDeclaration) {
  const read = defineTaskContract({ ...contract, output, example });
  return compileWorkflow(defineWorkflow({
    id: "manual-path-fixture", version: 1, code: "mpf", label: "Manual paths", icon: "Search", category: "operations",
    input: Plan1Input, canonicalInput: Plan1CanonicalInput, inputSubject: "eid", surface: { shape: "single" },
    enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS, surfaces: {}, details: [],
    scenarios: ["fixture-plan1/happy"], role: defineWorkflowRole({ kind: "standalone" }),
    identity: { matchKey: input => input.emplId }, presentation: { title: () => "Manual paths" },
    steps: ({ task, result }) => {
      const entry = task({ id: "read", contract: read, replay: "always-rerun" }, [], ({ input }) => input);
      return { steps: [[{ key: "reading", label: "Reading", manual }, [entry]]], result: result(output, [entry], ({ outputs }) => outputs.read) };
    },
  })).descriptor;
}

describe("manual field paths through conditional outputs", () => {
  it("admits the union of discriminator literals and found-only identity fields without changing the output contract", () => {
    const output = z.strictObject({ identity: I9IdentitySchema });
    const descriptor = fixture(output, { identity: { status: "not-found", candidateCount: 0 } }, {
      form: { fields: [
        { key: "status", label: "Found", kind: "enum", values: ["found", "not-found"], replaces: { nodeId: "read", path: "identity.status" } },
        { key: "eid", label: "Employee ID", kind: "eid", optional: true, replaces: { nodeId: "read", path: "identity.eid" } },
        { key: "name", label: "Name", kind: "text", optional: true, replaces: { nodeId: "read", path: "identity.name" } },
      ] },
      produces: { read: () => ({ identity: { status: "not-found", candidateCount: 0 } }) },
    });
    assert.equal(resolveStartStepOmissions(descriptor, [], [{ step: "reading", facts: { status: "not-found", eid: null, name: null } }])?.[0]?.facts.status, "not-found");
    assert.equal(output.safeParse({ identity: { status: "found", eid: null, name: null } }).success, false);
  });

  it("admits an optional field below a possibly empty or optional candidate array", () => {
    for (const optional of [false, true]) {
      const candidates = z.array(z.strictObject({ emplId: EidSchema }));
      const output = z.strictObject({ candidates: optional ? candidates.optional() : candidates });
      const descriptor = fixture(output, { candidates: [] }, {
        form: { fields: [{ key: "emplId", label: "Employee ID", kind: "eid", optional: true, replaces: { nodeId: "read", path: "candidates.0.emplId" } }] },
        produces: { read: ({ facts }) => ({ candidates: facts.emplId === null ? [] : [{ emplId: facts.emplId }] }) },
      });
      assert.equal(resolveStartStepOmissions(descriptor, [], [{ step: "reading", facts: { emplId: null } }])?.[0]?.facts.emplId, null);
      assert.equal(output.safeParse({ candidates: [{ emplId: null }] }).success, false);
    }
  });

  it("retains exact-path and unsafe-parent refusals while accepting only the declared discriminator values", () => {
    assert.equal(valueLeafSchemaExact(I9IdentitySchema, ["status"]), undefined);
    const status = valueLeafSchemaForManual(I9IdentitySchema, ["status"]);
    assert.ok(status);
    for (const value of ["found", "not-found", "ambiguous"]) assert.equal(z.core.safeParse(status, value).success, true);
    assert.equal(z.core.safeParse(status, "unknown").success, false);
    for (const schema of [I9IdentitySchema.refine(() => true), I9IdentitySchema.transform(value => value), I9IdentitySchema.catch({ status: "not-found", candidateCount: 0 })]) {
      assert.equal(valueLeafSchemaForManual(schema, ["status"]), undefined);
    }
    const checked = z.array(z.strictObject({ emplId: EidSchema })).refine(() => true);
    assert.equal(valueLeafSchemaForManual(z.strictObject({ candidates: checked }), ["candidates", "0", "emplId"]), undefined);
  });
});
