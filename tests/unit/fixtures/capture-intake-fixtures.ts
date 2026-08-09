/**
 * The workflow that DOES declare a capture intake binding (2i-F, D174).
 *
 * `CAPTURE_INTAKE_BINDINGS` is empty in production for a stated reason: no
 * registered workflow can honestly turn a photographed document into its
 * canonical input, and inventing one would put a fabricated value into a real
 * run. That is the right state, and `capture-surface.test.ts` pins it — but it
 * also means the SUCCESSFUL handoff has no subject in the product, so the end
 * of the slice (bundle → manifest → queued run) would go unproven.
 *
 * This fixture is that subject. Its binding reads only facts a finalized
 * bundle actually carries — the operator's typed context and the bundle's own
 * digest — and invents nothing, so a run it enqueues is still a run whose
 * input every value can be traced to.
 *
 * The two negative bindings beside it exist because `captureIntakeRegistry`'s
 * refusals are load-bearing: a binding that skipped the factory carries a
 * fingerprint nothing can trust, and one built over a COPY of the descriptor's
 * input schema would let capture produce values the workflow never accepted.
 */
import { z } from "zod";
import { flow } from "../../../src/base/flow.js";
import { defineWorkflowDescriptor, type AnyWorkflowDescriptor } from "../../../src/base/workflow.js";
import {
  defineCaptureIntakeBinding,
  type CaptureBundleFacts,
  type CaptureIntakeBinding,
} from "../../../src/domain/capture-intake.js";
import { CANONICAL_FIELDS } from "../../../src/domain/fields/registry.js";
import { FingerprintSchema } from "../../../src/domain/ids.js";
import { defineCanonicalInput } from "../../../src/domain/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../src/domain/workflow/presentation.js";
import { FixtureReadReceipt } from "../architecture/helpers/descriptor-fixtures.js";

export const CAPTURE_FIXTURE_WORKFLOW_ID = "capture-fixture";
export const CAPTURE_FIXTURE_CODE = "cf";

/** The one form type this fixture's binding claims it can read. */
export const CAPTURE_FIXTURE_FORM_TYPE = "work-study-authorization";

const BundleDigestSchema = z.string().regex(
  /^[0-9a-f]{64}$/,
  "a bundle digest is 64 lowercase hex characters",
);

/**
 * The descriptor's OWN input schema object. Every honest binding below reuses
 * this exact object — identity, not equivalence.
 */
export const CaptureFixtureInput = z.strictObject({
  emplId: CANONICAL_FIELDS.eid.schema,
  documentSha256: BundleDigestSchema,
});

const captureFixtureCanonicalInput = defineCanonicalInput(
  CaptureFixtureInput,
  z.strictObject({
    emplId: CANONICAL_FIELDS.eid.schema,
    documentSha256: BundleDigestSchema,
  }),
  [{ emplId: "10456712", documentSha256: "a".repeat(64) }],
);

export const captureFixtureDescriptor: AnyWorkflowDescriptor = defineWorkflowDescriptor({
  id: CAPTURE_FIXTURE_WORKFLOW_ID,
  version: 1,
  contractFingerprint: "c".repeat(64),
  code: CAPTURE_FIXTURE_CODE,
  label: "Capture fixture",
  icon: "ShieldCheck",
  category: "operations",
  canonicalInput: captureFixtureCanonicalInput,
  // A photographed form IS the subject here, which is exactly the shape a real
  // capture-fed workflow would carry.
  inputSubject: "document",
  surface: { shape: "single" },
  enqueue: "allow-parallel",
  actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {},
  details: [],
  identity: { matchKey: (input) => `capture-document:${input.documentSha256}` },
  presentation: { title: (input) => `Capture ${input.emplId}` },
  scenarios: ["fixture-graph/happy"],
  flow: flow(CaptureFixtureInput)
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

/**
 * The binding. It stands in for the OCR step a real capture workflow would
 * own: the employee id comes from the context the operator typed beside the
 * QR, and the document is the bundle's own content address. A bundle with no
 * context is refused by the descriptor's input schema rather than defaulted —
 * a guessed EID is a wrong person.
 */
export const captureFixtureBinding: CaptureIntakeBinding = defineCaptureIntakeBinding({
  inputSchema: CaptureFixtureInput,
  formTypes: [CAPTURE_FIXTURE_FORM_TYPE],
  build: (facts: CaptureBundleFacts) => ({
    emplId: facts.contextHint,
    documentSha256: String(facts.document.sha256),
  }),
});

/**
 * Structurally identical, built over a SECOND schema object. The registry must
 * refuse it: two schemas that agree today can disagree tomorrow, and the
 * disagreement would land as a canonical input the workflow never accepted.
 */
export const captureFixtureCopiedSchemaBinding: CaptureIntakeBinding = defineCaptureIntakeBinding({
  inputSchema: z.strictObject({
    emplId: CANONICAL_FIELDS.eid.schema,
    documentSha256: BundleDigestSchema,
  }),
  formTypes: [CAPTURE_FIXTURE_FORM_TYPE],
  build: () => ({ emplId: "10456712", documentSha256: "a".repeat(64) }),
});

/**
 * A binding that never went through `defineCaptureIntakeBinding`. Its
 * fingerprint is a value somebody typed, so a manifest that folded it would
 * claim an identity nothing derived.
 */
export const handBuiltCaptureBinding: CaptureIntakeBinding = Object.freeze({
  inputSchema: CaptureFixtureInput,
  fingerprint: FingerprintSchema.parse("d".repeat(64)),
  formTypes: Object.freeze([CAPTURE_FIXTURE_FORM_TYPE]),
  build: () => ({ emplId: "10456712", documentSha256: "a".repeat(64) }),
});
