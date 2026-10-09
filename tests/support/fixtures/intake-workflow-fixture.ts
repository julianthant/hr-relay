
import { z } from "zod";
import { flow } from "../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor, type AnyWorkflowDescriptor } from "../../../src/workflow-kit/workflow.js";
import { CANONICAL_FIELDS } from "../../../src/models/fields/registry.js";
import { defineIntakeProjection } from "../../../src/models/intake/projection.js";
import { defineCanonicalInput } from "../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../src/models/workflow/presentation.js";
import { FixtureReadReceipt } from "./descriptor-fixtures.js";

export const INTAKE_FIXTURE_WORKFLOW_ID = "intake-fixture";

export const IntakeFixtureInput = z.strictObject({
  emplId: CANONICAL_FIELDS.eid.schema,
  effectiveDate: CANONICAL_FIELDS.effectiveDate.schema,
  department: CANONICAL_FIELDS.department.schema.optional(),
});

export const intakeFixtureProjection = defineIntakeProjection(IntakeFixtureInput, {
  emplId: CANONICAL_FIELDS.eid,
  effectiveDate: CANONICAL_FIELDS.effectiveDate,
  department: CANONICAL_FIELDS.department,
});


export function defineIntakeFixtureDescriptor(options: Readonly<{
  id: string;
  code: string;
  contractFingerprint: string;
  enqueue: "allow-parallel" | "reject-active";

  version?: number;
  canonicalDepartmentMaxLength?: number;
}>): AnyWorkflowDescriptor {
  return defineWorkflowDescriptor({
    id: options.id,
    version: options.version ?? 1,
    contractFingerprint: options.contractFingerprint,
    code: options.code,
    label: "Intake fixture",
    icon: "ShieldCheck",
    category: "operations",
    canonicalInput: defineCanonicalInput(
      IntakeFixtureInput,
      z.strictObject({
        emplId: CANONICAL_FIELDS.eid.schema,
        effectiveDate: CANONICAL_FIELDS.effectiveDate.schema,
        department: options.canonicalDepartmentMaxLength === undefined ? CANONICAL_FIELDS.department.schema.optional() : CANONICAL_FIELDS.department.schema.max(options.canonicalDepartmentMaxLength).optional(),
      }),
      [{ emplId: "10456712", effectiveDate: "2026-07-01" }],
    ),
    inputSubject: "eid",
    surface: { shape: "single" },
    enqueue: options.enqueue,
    actions: STANDARD_WORKFLOW_ACTIONS,
    surfaces: {},
    details: [],
    identity: { matchKey: (input) => `eid:${input.emplId}` },
    presentation: { title: (input) => `Intake ${input.emplId}` },
    scenarios: ["fixture-graph/happy"],
    flow: flow(IntakeFixtureInput)
      .step("probe", FixtureReadReceipt, {
        dependsOn: [],
        replay: "checkpoint",
        bind: ({ input }) => ({ eid: input.emplId }),
      })
      .build({
        schema: z.strictObject({ emplId: CANONICAL_FIELDS.eid.schema }),
        dependsOn: ["probe"],
        derive: ({ input }) => ({ emplId: input.emplId }),
      }),
  });
}

export const intakeFixtureDescriptor: AnyWorkflowDescriptor = defineIntakeFixtureDescriptor({
  id: INTAKE_FIXTURE_WORKFLOW_ID,
  code: "if",
  contractFingerprint: "f".repeat(64),
  enqueue: "allow-parallel",
});

/** One active run per item — the policy an intake fan-out must honour per row. */
export const INTAKE_SERIAL_WORKFLOW_ID = "intake-fixture-serial";
export const intakeSerialFixtureDescriptor: AnyWorkflowDescriptor = defineIntakeFixtureDescriptor({
  id: INTAKE_SERIAL_WORKFLOW_ID,
  code: "is",
  contractFingerprint: "e".repeat(64),
  enqueue: "reject-active",
});
