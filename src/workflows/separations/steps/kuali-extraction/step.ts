/** `separations-kuali-read` — the Kuali passage, provable ALONE and read-only; the composition reuses these TASKS. Two nodes: `document` (one page visit) + `termination-type` (a pure fold) — writes nothing, reconciles no dates. */
import { z } from "zod";
import { requireFact } from "../../../../workflow-kit/workflow.js";
import { defineWorkflow } from "../../../../workflow-kit/workflow-definition.js";
import { MatchTerminationTypeOutputSchema } from "../../../../models/workflows/separations/match-termination-type.js";
import {
  KualiActionIdSchema,
  KualiDocumentNumberSchema,
} from "../../../../models/ui/kuali-document-identity.js";
import { KualiSeparationDocumentSchema } from "../../../../models/ui/kuali-separation-document.js";
import { defineCanonicalInput } from "../../../../models/workflow/canonical-input.js";
import { defineWorkflowRole } from "../../../../workflow-kit/validation/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../models/workflow/presentation.js";
import {
  DOCUMENT_NODE,
  TERMINATION_TYPE_NODE,
  documentNode,
  terminationTypeNode,
  KUALI_EXTRACTION_STEP,
} from "../../workflow.js";
/** The ingress schema: both identifiers are required, neither derivable — the document number is
 *  the run's own claim, proved from the page's level-1 heading before touching anything. */
const SeparationsKualiReadInput = z.strictObject({
  actionId: KualiActionIdSchema,
  documentNumber: KualiDocumentNumberSchema,
});

/** The validation-only view of the stored snapshot: same shape, no defaults. */
const SeparationsKualiReadCanonicalInput = defineCanonicalInput(
  SeparationsKualiReadInput,
  z.strictObject({
    actionId: KualiActionIdSchema,
    documentNumber: KualiDocumentNumberSchema,
  }),
  [
    { actionId: "6a7a33b2ac106d428b3217e0", documentNumber: "4510" },
    { actionId: "6a766ae6f0549046f7f0dc06", documentNumber: "4502" },
  ],
);

const SeparationsKualiReadResultSchema = z.strictObject({
  /** The whole form, verbatim — consumers project, they never re-scrape. */
  document: KualiSeparationDocumentSchema,
  /** §4a's resolution. A run only has one if the map carried the type. */
  termination: MatchTerminationTypeOutputSchema,
});

export const separationsKualiReadWorkflow = defineWorkflow({
  id: "separations-kuali-read",
  version: 1,
  code: "sd",
  label: "Separation Document",
  summary:
    "Chunk 2 of the separations migration: the Kuali passage on its own. Reads the whole RRSS " +
    "separation request form in one page visit, then resolves the document's termination type against " +
    "the mapped set. Strictly read-only.",
  icon: "FileText",
  category: "separation",
  canonicalInput: SeparationsKualiReadCanonicalInput,
  inputSubject: "document",
  surface: { shape: "single" },
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  /** No `inputRun` surface: the input is two correlated values a parser would have to invent the
   *  other half of — runs start through the generic start-plan/command path. */
  surfaces: {},
  // Edit Data must not bypass document evidence or termination-type refusal.
  verdicts: [
    {
      key: "unprocessed",
      label: "Not yet processed",
      tone: "neutral",
      tag: true,
    },
    {
      key: "already-filed",
      label: "Transaction already filed",
      tone: "warning",
      tag: true,
    },
  ],
  details: [
    /** Detail paths address the OUTPUT SCHEMA; most fields are `present`/`absent` unions, so the
     *  rail reads the resolution node, which holds the facts unconditionally once §4a resolved them. */
    {
      key: "form-type",
      label: "Form",
      source: { nodeId: "document", fieldPath: "formType.observed" },
      display: "text",
    },
    {
      key: "termination-type",
      label: "Type of Termination",
      source: { nodeId: "termination-type", fieldPath: "terminationType" },
      display: "text",
    },
    {
      key: "template",
      label: "UCPath template",
      source: { nodeId: "termination-type", fieldPath: "template" },
      display: "text",
    },
    {
      key: "reason-code",
      label: "UCPath reason code",
      source: { nodeId: "termination-type", fieldPath: "reasonCode" },
      display: "text",
    },
  ],
  /** Ref dashboard-surfaces: `Document 4510` becomes the person off the form's own employee-name
   *  control; its absent arm keeps the document number, the only honest thing a blank control could mean. */
  subjectProjection: { nodeId: "document", fieldPath: "employee.name.value" },
  identity: {
    matchKey: (input) => `kuali-separation-document:${input.documentNumber}`,
  },
  presentation: {
    title: (input) => `Document ${input.documentNumber}`,
    subtitle: (input) => `Kuali action ${input.actionId.slice(0, 8)}…`,
  },
  /** The descriptor's own words about each node, projected by the explorer. */
  nodePurposes: [
    {
      nodeId: "document",
      purpose:
        "Reads the entire Kuali RRSS separation request form in ONE page visit: the employee, the " +
        "separation dates, the comments, and every control's own option list as this run observed it.",
    },
    {
      nodeId: "termination-type",
      purpose:
        "Resolves the document's termination type to the UCPath template and reason code it files under, " +
        "refusing a type nobody has mapped. Pure: it reaches no browser.",
    },
  ],
  scenarios: [
    "separations-kuali-read/reads-a-real-separation-document",
    "separations-kuali-read/unprocessed-document-absent-arms",
    "separations-kuali-read/non-separation-document",
    "separations-kuali-read/unknown-termination-type",
    "separations-kuali-read/unparseable-separation-date",
  ],
  input: SeparationsKualiReadInput,
  role: defineWorkflowRole({
    kind: "chunk-harness",
    of: "separations",
    step: KUALI_EXTRACTION_STEP.key,
  }),
  steps: ({ task, result }) => {
    const document = task(documentNode, [], ({ input }) => ({
      actionId: input.actionId,
      documentNumber: input.documentNumber,
    }));
    const terminationType = task(
      terminationTypeNode,
      [document],
      ({ input, outputs }) => ({
        terminationType: outputs[DOCUMENT_NODE].separation.terminationType,
        // Compare every observed option; reject drift before a new option is selected.
        observedOptions: outputs[DOCUMENT_NODE].options.terminationType,
        documentNumber: input.documentNumber,
      }),
    );
    return {
      // The harness IS the step it proves: one timeline group, the step's own.
      steps: [[KUALI_EXTRACTION_STEP, [document, terminationType]]],
      result: result(
        SeparationsKualiReadResultSchema,
        [document, terminationType],
        ({ outputs }) => ({
          // Require separation-form proof before treating its fields as separation evidence.
          document: {
            ...outputs[DOCUMENT_NODE],
            formType: requireFact(
              outputs[DOCUMENT_NODE].formType,
              DOCUMENT_NODE,
              "formType",
            ),
          },
          termination: outputs[TERMINATION_TYPE_NODE],
        }),
      ),
    };
  },
});
