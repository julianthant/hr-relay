/**
 * D307 — a minimal three-node descriptor for testing `resolveTerminalDependencies`
 * and the evidence receipt's not-run/step-omitted arm WITHOUT driving the
 * executor: `buildRunResult` and `buildRunEvidenceReceipt` only need the
 * descriptor's factory-authenticated shape, never a running task.
 *
 * `read` belongs to the omittable "reading" step (an honest producer
 * rebuilds it from one typed fact); `fold` belongs to the plain "folding"
 * step and is never producible by any omission; `skip` belongs to the
 * omittable "skipping" step, which declares NO producer for it — a
 * genuinely `omittable` (never `assertable`) terminal dependency, so its
 * only legal not-run arm is `step-omitted`.
 */
import { z } from "zod";
import { flow } from "../../../src/base/flow.js";
import { defineWorkflowDescriptor } from "../../../src/base/workflow.js";
import { FixtureReadReceipt } from "../architecture/helpers/descriptor-fixtures.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../src/domain/workflow/presentation.js";
import { defineCanonicalInput } from "../../../src/domain/workflow/canonical-input.js";
import { EidSchema } from "../../../src/domain/ids.js";

const FixtureInput = z.strictObject({ eid: EidSchema });
export const FixtureCanonicalInput = defineCanonicalInput(
  FixtureInput,
  z.strictObject({ eid: EidSchema }),
  [{ eid: "10873698" }],
);

const FORM = { fields: [{ key: "present", label: "Present", kind: "boolean" as const }] };

export const stepOmissionTerminalDescriptor = defineWorkflowDescriptor({
  id: "omission-terminal-fixture",
  version: 1,
  contractFingerprint: "e".repeat(64),
  code: "otf",
  label: "Step omission terminal fixture",
  icon: "Search",
  category: "operations",
  canonicalInput: FixtureCanonicalInput,
  inputSubject: "eid",
  surface: { shape: "single" },
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {},
  details: [],
  identity: { matchKey: (input: z.output<typeof FixtureInput>) => `eid:${input.eid}` },
  presentation: { title: (input: z.output<typeof FixtureInput>) => input.eid },
  scenarios: ["omission-terminal-fixture/happy"],
  timeline: [
    {
      key: "reading",
      label: "Reading",
      nodes: ["read"],
      omission: {
        form: FORM,
        produces: { read: ({ facts }) => ({ eid: "10873698", present: facts.present }) },
      },
    },
    { key: "folding", label: "Folding", nodes: ["fold"] },
    { key: "skipping", label: "Skipping", nodes: ["skip"], omission: { form: FORM, produces: {} } },
  ],
  flow: flow(FixtureInput)
    .step("read", FixtureReadReceipt, { dependsOn: [], replay: "checkpoint", bind: ({ input }) => ({ eid: input.eid }) })
    .step("fold", FixtureReadReceipt, {
      dependsOn: ["read"],
      replay: "checkpoint",
      bind: ({ input }) => ({ eid: input.eid }),
    })
    .step("skip", FixtureReadReceipt, { dependsOn: [], replay: "checkpoint", bind: ({ input }) => ({ eid: input.eid }) })
    .build({
      schema: z.strictObject({ folded: z.boolean() }),
      dependsOn: ["read", "fold", "skip"],
      derive: ({ outputs }) => ({ folded: outputs.fold.present }),
    }),
});
