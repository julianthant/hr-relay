/**
 * A spreadsheet-capable fixture workflow for the D170 intake surface.
 *
 * It is doc 06 §8's worked example in miniature — an EID, an effective date
 * and an optional department — because that is the shape the intake pipeline
 * was designed against. No registered workflow declares an intake projection
 * yet (person-lookup's input is a union, which is real 2i-E3 design work), so
 * the fixture is what proves the arms and the wire end to end.
 */
import { z } from "zod";
import { flow } from "../../src/base/flow.js";
import { defineWorkflowDescriptor, type AnyWorkflowDescriptor } from "../../src/base/workflow.js";
import { CANONICAL_FIELDS } from "../../src/domain/fields/registry.js";
import { defineIntakeProjection } from "../../src/domain/intake/projection.js";
import { defineCanonicalInput } from "../../src/domain/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../src/domain/workflow/presentation.js";
import { FixtureReadReceipt } from "../unit/architecture/helpers/descriptor-fixtures.js";

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

export const intakeFixtureDescriptor: AnyWorkflowDescriptor = defineWorkflowDescriptor({
  id: INTAKE_FIXTURE_WORKFLOW_ID,
  version: 1,
  contractFingerprint: "f".repeat(64),
  code: "if",
  label: "Intake fixture",
  icon: "ShieldCheck",
  category: "operations",
  canonicalInput: defineCanonicalInput(
    IntakeFixtureInput,
    z.strictObject({
      emplId: CANONICAL_FIELDS.eid.schema,
      effectiveDate: CANONICAL_FIELDS.effectiveDate.schema,
      department: CANONICAL_FIELDS.department.schema.optional(),
    }),
    [{ emplId: "10456712", effectiveDate: "2026-07-01" }],
  ),
  inputSubject: "eid",
  surface: { shape: "single" },
  enqueue: "allow-parallel",
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
