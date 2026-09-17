/**
 * A spreadsheet-capable fixture workflow for the D170 intake surface.
 *
 * It is ref data-intake-and-edit-data §8's worked example in miniature — an EID, an effective date
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

/**
 * The same workflow under a different enqueue policy, so the fan-out's
 * `reject-active` path is exercised against a real descriptor rather than an
 * injected fault. Both share the ONE input schema object, which is what makes
 * one projection valid for both.
 */
export function defineIntakeFixtureDescriptor(options: Readonly<{
  id: string;
  code: string;
  contractFingerprint: string;
  enqueue: "allow-parallel" | "reject-active";
  /**
   * A version bump is a source edit plus `npm run build:manifest`, which is
   * exactly what moving `version` and `contractFingerprint` together produces.
   * The D185 lifecycle walk needs the SAME workflow at two versions to archive
   * one of its own runs, so the factory is exported rather than copied.
   */
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
