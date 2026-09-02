/**
 * Fixture descriptors for D307's START-side omission seam.
 *
 * No registered workflow declares a `stepOmissions` entry yet (Separations'
 * declarations land with their own unit), so a suite that only swept the
 * registry would prove the new arms by never reaching them. These three
 * descriptors share ONE three-node graph and differ only in what their step
 * folders declare, which is exactly the axis the projection and the planner
 * classify on:
 *
 * - `read` feeds `fold`; `audit` stands alone and nothing reads it.
 * - `omissionBlockedDescriptor` — `reading` declares an omission it cannot
 *   honestly rebuild `read` from, and `folding` declares none. Omitting
 *   `reading` would leave `fold` reading an unread node, so the cascade is
 *   BLOCKED by a step that must run.
 * - `omissionCascadingDescriptor` — the same, except `folding` declares an
 *   omission too, so the choice is legal and FORCES `folding` out with it.
 * - `omissionAssertingDescriptor` — `reading` rebuilds `read` from its typed
 *   facts, so nothing downstream is left unread and the step stands alone.
 *
 * `auditing` declares an omission in all three: a clean, terminal omittable
 * step that forces nothing, which is what a cascade row of `[]` has to mean.
 */
import { z } from "zod";
import { flow } from "../../../src/base/flow.js";
import { defineWorkflowDescriptor, type AnyWorkflowDescriptor } from "../../../src/base/workflow.js";
import { EidSchema } from "../../../src/domain/ids.js";
import { defineCanonicalInput } from "../../../src/domain/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../src/domain/workflow/presentation.js";
import type { StepOmissionDeclaration, StepOmissionForm } from "../../../src/domain/workflow/step-omission.js";
import { FixtureReadReceipt } from "../architecture/helpers/descriptor-fixtures.js";
import { HASH_A } from "./phase1c-contract-fixtures.js";

const OmissionInput = z.strictObject({ eid: EidSchema });
export const OmissionCanonicalInput = defineCanonicalInput(
  OmissionInput,
  z.strictObject({ eid: EidSchema }),
  [{ eid: "10873698" }],
);

/** Two kinds on purpose: `us-date` refuses a shape `text` would accept. */
export const READING_FORM: StepOmissionForm = {
  fields: [
    { key: "eid", label: "Employee id", kind: "eid" },
    { key: "effectiveDate", label: "Effective date", kind: "us-date" },
  ],
};
export const FOLDING_FORM: StepOmissionForm = { fields: [{ key: "folded", label: "Folded", kind: "text" }] };
export const AUDITING_FORM: StepOmissionForm = { fields: [{ key: "reviewed", label: "Reviewed", kind: "boolean" }] };

const BARE_READING: StepOmissionDeclaration = { form: READING_FORM, produces: {} };
const ASSERTING_READING: StepOmissionDeclaration = {
  form: READING_FORM,
  produces: { read: ({ facts }) => ({ eid: facts.eid, present: true }) },
};
const BARE_FOLDING: StepOmissionDeclaration = { form: FOLDING_FORM, produces: {} };
const BARE_AUDITING: StepOmissionDeclaration = { form: AUDITING_FORM, produces: {} };

function omissionDescriptor(
  id: string,
  code: string,
  reading: StepOmissionDeclaration,
  folding?: StepOmissionDeclaration,
): AnyWorkflowDescriptor {
  return defineWorkflowDescriptor({
    id,
    version: 1,
    contractFingerprint: HASH_A,
    code,
    label: "Step omission start fixture",
    icon: "Search",
    category: "operations",
    canonicalInput: OmissionCanonicalInput,
    inputSubject: "eid",
    surface: { shape: "single" },
    enqueue: "reject-active",
    actions: STANDARD_WORKFLOW_ACTIONS,
    surfaces: {},
    details: [],
    identity: { matchKey: (input: z.output<typeof OmissionInput>) => `eid:${input.eid}` },
    presentation: { title: (input: z.output<typeof OmissionInput>) => `EID ${input.eid}` },
    scenarios: ["ucpath/person-org-happy"],
    timeline: [
      { key: "reading", label: "Reading", nodes: ["read"], omission: reading },
      folding === undefined
        ? { key: "folding", label: "Folding", nodes: ["fold"] }
        : { key: "folding", label: "Folding", nodes: ["fold"], omission: folding },
      { key: "auditing", label: "Auditing", nodes: ["audit"], omission: BARE_AUDITING },
    ],
    flow: flow(OmissionInput)
      .step("read", FixtureReadReceipt, {
        dependsOn: [],
        replay: "checkpoint",
        bind: ({ input }) => ({ eid: input.eid }),
      })
      .step("fold", FixtureReadReceipt, {
        dependsOn: ["read"],
        replay: "checkpoint",
        bind: ({ outputs }) => ({ eid: outputs.read.eid }),
      })
      .step("audit", FixtureReadReceipt, {
        dependsOn: [],
        replay: "checkpoint",
        bind: ({ input }) => ({ eid: input.eid }),
      })
      .build({
        schema: z.strictObject({ eid: EidSchema }),
        dependsOn: ["fold"],
        derive: ({ outputs }) => ({ eid: outputs.fold.eid }),
      }),
  });
}

export const omissionBlockedDescriptor = omissionDescriptor("omission-blocked-fixture", "obf", BARE_READING);
export const omissionCascadingDescriptor = omissionDescriptor(
  "omission-cascading-fixture",
  "ocf",
  BARE_READING,
  BARE_FOLDING,
);
export const omissionAssertingDescriptor = omissionDescriptor(
  "omission-asserting-fixture",
  "oaf",
  ASSERTING_READING,
);
