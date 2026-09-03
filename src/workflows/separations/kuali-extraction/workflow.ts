/**
 * `separations-kuali-read` — chunk 2 of the separations migration
 * (`docs/migrations/separations.md` §3): the Kuali passage, provable ALONE,
 * strictly read-only, and composed later from the same tasks rather than from
 * this descriptor.
 *
 * §3's honest note applies exactly as it did to chunk 1: the full `separations`
 * graph will reuse these TASKS directly, and this descriptor stays as the piece
 * that made them provable.
 *
 * ## Two nodes, one page visit and one pure fold
 *
 * `document` is the whole RRSS separation form in one visit (D194 / ref task-contract
 * §2.8). `termination-type` is the `separations` mini-store's pure resolution
 * of §4a — a fold over the prior node's output that reaches no browser at all.
 * They are two nodes rather than one because they fail for genuinely different
 * reasons and an operator needs to see which: "Kuali would not show me the
 * document" and "the document says a termination type nobody has mapped" are
 * different problems with different fixes.
 *
 * ## What this graph deliberately does NOT do
 *
 * - **It writes nothing.** S61 is legacy's dry run still filling the Kuali
 *   draft (timekeeper name, and the `similar` name correction) on the argument
 *   that an abandoned draft discards its edits — an argument stated in a
 *   comment and verified nowhere. This graph has no `prepare` node and no
 *   `commit` node, and the store operation it calls has no write path.
 * - **It does not reconcile dates.** `LDW = lastPunch ?? kualiLDW`,
 *   `separationDate = max(LDW, last sick, last holiday)` and `+1` for the
 *   effective date are the composition's job, over the timecard chunk's output
 *   and this one's. Growing a second home for that here is exactly what §3.1
 *   forbids.
 * - **It does not refuse a FUTURE date.** Legacy throws on one (S7), and it is
 *   right to — but that is a precondition of *filing a termination*, not a fact
 *   about *reading a form*. Live doc 4495 carries a last-day-worked of
 *   09/02/2026, three weeks after the read; refusing it here would make this
 *   chunk unable to read a document the department has legitimately filed in
 *   advance. The parsed date is reported and the composition applies S7.
 *
 * This module is bundle-safe: it value-imports only zod, `src/domain/**`, and
 * the audited `src/base` builders.
 */
import { z } from "zod";
import { requireFact } from "../../../base/workflow.js";
import { defineWorkflow } from "../../../base/workflow-definition.js";
import { MatchTerminationTypeOutputSchema } from "../../../domain/contracts/separations/match-termination-type.js";
import {
  KualiActionIdSchema,
  KualiDocumentNumberSchema,
} from "../../../domain/ui/kuali-document-identity.js";
import { KualiSeparationDocumentSchema } from "../../../domain/ui/kuali-separation-document.js";
import { defineCanonicalInput } from "../../../domain/workflow/canonical-input.js";
import { defineWorkflowRole } from "../../../domain/workflow/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../domain/workflow/presentation.js";
import { DOCUMENT_NODE, TERMINATION_TYPE_NODE } from "./node-ids.js";
import { documentNode, terminationTypeNode } from "./nodes.js";
import { KUALI_EXTRACTION_STEP } from "./step.js";

/**
 * The ingress schema. Both identifiers are required and neither is derivable
 * from the other: an `actionId` names a workflow STEP and can silently redirect
 * to the Action List, so the document number is the run's own claim about which
 * separation this is, and the driver proves it from the page's level-1 heading
 * before touching anything (D129).
 */
export const SeparationsKualiReadInput = z.strictObject({
  actionId: KualiActionIdSchema,
  documentNumber: KualiDocumentNumberSchema,
});

/** The validation-only view of the stored snapshot: same shape, no defaults. */
export const SeparationsKualiReadCanonicalInput = defineCanonicalInput(
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

export const SeparationsKualiReadResultSchema = z.strictObject({
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
    "Chunk 2 of the separations migration: the Kuali passage on its own. Reads the whole RRSS "
    + "separation request form in one page visit, then resolves the document's termination type against "
    + "the mapped set. Strictly read-only.",
  icon: "FileText",
  category: "separation",
  canonicalInput: SeparationsKualiReadCanonicalInput,
  inputSubject: "document",
  surface: { shape: "single" },
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  /**
   * No `inputRun` surface, deliberately — the same reason chunk 1 has none.
   * The paste-a-line parser splits ONE token per item and this workflow's input
   * is two correlated values; a parser that emitted only the document number
   * would have to invent the action id, which is the substitution this program
   * bans. Runs start through the generic start-plan / command path, and the
   * queue and run-detail wires already render this workflow off the registry.
   */
  surfaces: {},
  /**
   * No `capabilities` block. An Edit Data field here would let an operator
   * supply the very values this run exists to READ off the document — the same
   * argument chunk 1 made about a punch date, and stronger, because a corrected
   * termination type would walk straight past §4a's refusal.
   */
  verdicts: [
    { key: "unprocessed", label: "Not yet processed", tone: "neutral", tag: true },
    { key: "already-filed", label: "Transaction already filed", tone: "warning", tag: true },
  ],
  details: [
    /**
     * Detail paths address the OUTPUT SCHEMA, and most of this read's fields
     * are `present`/`absent` unions whose `value` exists on one arm only — so a
     * `separation.terminationType.value` path is not a path the schema owns.
     * The rail therefore reads the resolution node, which holds the same facts
     * unconditionally because a run only HAS one when §4a resolved it.
     */
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
  /**
   * Ref dashboard-surfaces §1.2: `Document 4510` becomes the person the document is about, off
   * the form's own employee-name control. It is a present/absent union arm —
   * the control is routinely blank on an unprocessed document — and an absent
   * arm keeps the document number, which is both honest and the only thing a
   * blank control could mean.
   */
  subjectProjection: { nodeId: "document", fieldPath: "employee.name.value" },
  identity: {
    matchKey: (input) => `kuali-separation-document:${input.documentNumber}`,
  },
  presentation: {
    title: (input) => `Document ${input.documentNumber}`,
    subtitle: (input) => `Kuali action ${input.actionId.slice(0, 8)}…`,
  },
  /** D229 — the descriptor's own words about each node, projected by the explorer. */
  nodePurposes: [
    {
      nodeId: "document",
      purpose: "Reads the entire Kuali RRSS separation request form in ONE page visit: the employee, the "
        + "separation dates, the comments, and every control's own option list as this run observed it.",
    },
    {
      nodeId: "termination-type",
      purpose: "Resolves the document's termination type to the UCPath template and reason code it files under, "
        + "refusing a type nobody has mapped. Pure: it reaches no browser.",
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
  // A proving harness for one step of `separations`, never a peer workflow (D219) —
  // the step it proves is the folder it lives in, read from that folder's own
  // declaration rather than re-typed here (D265 §1.2.2 rule 3).
  role: defineWorkflowRole({ kind: "chunk-harness", of: "separations", step: KUALI_EXTRACTION_STEP.key }),
  steps: ({ task, result }) => {
    // This folder's own step identities (`./nodes.ts`), wired from the harness
    // input instead of from a `resolve-action` node: the harness takes the
    // action id as ingress because the head node it proves is the document
    // read itself.
    const document = task(documentNode, [], ({ input }) => ({
      actionId: input.actionId,
      documentNumber: input.documentNumber,
    }));
    const terminationType = task(terminationTypeNode, [document], ({ input, outputs }) => ({
      terminationType: outputs[DOCUMENT_NODE].separation.terminationType,
      // The complete option list the run ACTUALLY observed, so a republished
      // control refuses on the first run that sees it rather than on the first
      // run that happens to select a new option (§4a's accepted cost).
      observedOptions: outputs[DOCUMENT_NODE].options.terminationType,
      documentNumber: input.documentNumber,
    }));
    return {
      // The harness IS the step it proves: one timeline group, the step's own.
      steps: [[KUALI_EXTRACTION_STEP, [document, terminationType]]],
      result: result(
        SeparationsKualiReadResultSchema,
        [document, terminationType],
        ({ outputs }) => ({
          // `requireFact` on the form-type proof is not ceremony: it is the fact
          // that makes every other field on this result a SEPARATION's field
          // rather than some other form's (S2).
          document: {
            ...outputs[DOCUMENT_NODE],
            formType: requireFact(outputs[DOCUMENT_NODE].formType, DOCUMENT_NODE, "formType"),
          },
          termination: outputs[TERMINATION_TYPE_NODE],
        }),
      ),
    };
  },
});
