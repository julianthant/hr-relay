/**
 * `kuali/read-separation-document` — ONE visit to the RRSS Separation Request
 * Form (D194 / ref task-contract §2.8), returning the whole form.
 *
 * `docs/migrations/separations.md` §2.3 lists this task as "the six fields off
 * the RRSS separation form". That row predates §2.8, which was ratified later
 * in the same document; this is that rule applied, exactly as `new-kronos`
 * applied it in chunk 1. The six fields legacy extracts (name, EID, last day
 * worked, separation date, termination type, location) are all here, and so is
 * everything else the page carries — the Timekeeper Tasks section, the Final
 * Transactions section, the Final Pay group, and **every dropdown's complete
 * option list** (§3.2's MAP-EVERYTHING directive).
 *
 * ## The subject is the DOCUMENT
 *
 * Every other browser read in this tree binds a PERSON subject from its input.
 * This one cannot: the run names a document and the EID is what it DISCOVERS —
 * that is the whole point of the read. Ref task-contract's `artifact` subject kind with
 * `identity:"document-id"` is exactly this shape, proved against the level-1
 * heading Kuali renders the document number in (D129: an `actionId` names a
 * workflow STEP, not a document, so a run carries both and the number is proved
 * from the page).
 *
 * ## Six error codes, because six different things go wrong
 *
 * D196's rule — distinct negatives are distinct durable `FailureRecord.code`s:
 *
 *  - `document-unavailable` — the action id rendered no document at all (stale
 *    step), or the route never named its own form.
 *  - `document-number-mismatch` — a REAL document opened; a different one.
 *  - `not-a-separation-document` — **S2**, answered by NAME before a single
 *    field is read. Legacy discovers this as a 5-second locator timeout on the
 *    employee-name field, which is indistinguishable from a slow page.
 *  - `unparseable-date` — **S8**, naming the field and the value.
 *  - `unreadable-eid` — the EID control holds something that is not an EID.
 *  - `unexpected-page-state` — the driver answered about a different document
 *    than the task asked for.
 *
 * ## Strictly read-only
 *
 * **S61 is the legacy defect this task must not inherit.** Legacy's "dry run"
 * still writes the Kuali draft — the timekeeper-name fill and the `similar`
 * name correction both land on the live document — and its safety argument
 * ("an abandoned draft discards its edits") is stated in a comment and verified
 * nowhere. This task fills nothing, saves nothing, and clicks nothing: it
 * navigates, reads, and returns. The driver operation it calls has no write
 * path to reach.
 */
import { z } from "zod";
import { ObservationIdSchema, taskId } from "../../ids.js";
import {
  KualiActionIdSchema,
  KualiDocumentNumberSchema,
} from "../../ui/kuali-document-identity.js";
import {
  KUALI_RRSS_SEPARATION_READY,
  KualiSeparationDocumentSchema,
} from "../../ui/kuali-separation-document.js";
import { ContractFieldPathSchema, defineTaskContract } from "../base.js";

export const ReadSeparationDocumentInputSchema = z.strictObject({
  /** The Action-List deep-link id. NOT stable across workflow steps (D129). */
  actionId: KualiActionIdSchema,
  /** The document number the run names, and the read's subject (proved on page). */
  documentNumber: KualiDocumentNumberSchema,
});

export const ReadSeparationDocumentOutputSchema = KualiSeparationDocumentSchema;
export type ReadSeparationDocumentOutput = z.infer<typeof ReadSeparationDocumentOutputSchema>;

export const KualiReadSeparationDocument = defineTaskContract({
  id: taskId("kuali/read-separation-document"),
  title: "Read Kuali Separation Document",
  effect: "read",
  input: ReadSeparationDocumentInputSchema,
  output: ReadSeparationDocumentOutputSchema,
  errorCodes: [
    "kuali-unavailable",
    "unexpected-page-state",
    "document-unavailable",
    "document-number-mismatch",
    "not-a-separation-document",
    "unparseable-date",
    "unreadable-eid",
  ],
  subject: {
    kind: "artifact",
    expected: {
      fromInput: ContractFieldPathSchema.parse("documentNumber"),
      identity: "document-id",
    },
    observe: ObservationIdSchema.parse("kuali.rrss-document.displayed-number"),
    match: "exact",
    requiredAt: "before-subject-read",
  },
  /**
   * `Infinity`, argued: `separations.md` §5 residual 5A. The operator's answer
   * is that there is NO automatic freshness refresh in separations — a saved
   * Kuali separation document is a stable artifact, and an age-triggered
   * re-read of a value the run is about to write back adds cost without adding
   * safety. Refresh is a deliberate operator RE-RUN, never a silent mid-run
   * re-read. `defaultOverride:"audited"` matches the timecard read: the
   * identity, person-selection, idempotency-key and write-proof fields are
   * `forbidden` by guard regardless of what a read declares.
   */
  freshness: { defaultMaxAgeMs: Number.POSITIVE_INFINITY, defaultOverride: "audited" },
  provenance: { default: "live" },
  scenarios: [
    "separations-kuali-read/reads-a-real-separation-document",
    "separations-kuali-read/unprocessed-document-absent-arms",
    "separations-kuali-read/non-separation-document",
  ],
  example: {
    pageStateId: KUALI_RRSS_SEPARATION_READY,
    actionId: "6a7a33b2ac106d428b3217e0",
    documentNumber: "4510",
    formType: { observed: "RRSS Separation Request Form", matches: true },
    employee: {
      name: { state: "present", value: "Clauckia, Drose" },
      eid: { state: "present", value: "10001799" },
      employeeType: { state: "present", value: "Student" },
      studentTitleCode: { state: "present", value: "4921 - STDT 2" },
      division: { state: "present", value: "Campus Dining and Retail" },
      location: { state: "present", value: "THE BISTRO RESTAURANT" },
    },
    separation: {
      terminationType: { state: "present", value: "Graduated/No longer a Student" },
      lastDayWorked: { state: "present", raw: "06/10/2026", value: "2026-06-10" },
      separationDate: { state: "present", raw: "06/10/2026", value: "2026-06-10" },
      additionalComments: { state: "absent", reason: "the control is present on the form and holds no value" },
    },
    timekeeper: {
      requestAcknowledged: true,
      name: { state: "present", value: "Julian Zaw" },
      comments: { state: "absent", reason: "the control is present on the form and holds no value" },
    },
    finalTransactions: {
      terminationEffectiveDate: { state: "present", raw: "06/11/2026", value: "2026-06-11" },
      department: { state: "present", value: "000412 - Housing/Dining/Hospitality" },
      payrollTitleCode: { state: "present", value: "004921" },
      payrollTitle: { state: "present", value: "STDT 2" },
      submittedTerminationTemplate: true,
      transactionNumber: { state: "present", value: "T002209631" },
      finalPay: { state: "present", value: "does-not-need-final-pay-student" },
    },
    options: {
      terminationType: [
        "- - -", "Accepted Another Job", "Attend School", "Dissatisfied w/Job",
        "Look for Another Job", "Military Service", "Move out of Area",
        "Never Started Employment", "No Reason Given", "Personal Reasons",
        "Quit without Notice", "Retirement", "Self-Employment",
        "Transferring to a different UCSD department (outside of RRSS)",
        "Transferring to another UC Campus (outside of UCSD)",
        "Graduated/No longer a Student", "Appointment Expired",
      ],
      division: ["- - -", "Campus Dining and Retail"],
      employeeType: ["- - -", "Career/Contract", "Limited", "Student", "Contingent Worker (volunteer)"],
      studentTitleCode: ["- - -", "4921 - STDT 2"],
      department: ["- - -", "000412 - Housing/Dining/Hospitality"],
      finalPay: [
        "Submitted Final Pay Request",
        "Does not need Final Pay (student employee)",
        "Does not need Final Pay (transfer employee)",
        "Other",
      ],
    },
    observedAt: "2026-08-12T20:29:08.000Z",
  },
});
