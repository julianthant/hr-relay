/** ONE visit to the RRSS Separation Request Form, returning the whole form; the subject is the DOCUMENT, and the task is strictly read-only — it navigates, reads and returns. */
import { z } from "zod";
import { ObservationIdSchema, taskId } from "../../../rules/identity/ids.js";
import {
  KualiActionIdSchema,
  KualiDocumentNumberSchema,
} from "../../ui/kuali-document-identity.js";
import {
  KUALI_RRSS_SEPARATION_READY,
  KualiSeparationDocumentSchema,
} from "../../ui/kuali-separation-document.js";
import { ContractFieldPathSchema, defineTaskContract } from "../../task/task-contract.js";

export const ReadSeparationDocumentInputSchema = z.strictObject({
  /** The Action-List deep-link id. NOT stable across workflow steps. */
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
    /* `Infinity`, argued: separations takes no automatic freshness refresh, and the identity, person-selection, idempotency-key and write-proof fields stay `forbidden` by guard. */
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
      name: { state: "present", value: "Clauldoa, Droli" },
      eid: { state: "present", value: "10203262" },
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
      name: { state: "present", value: "Synthetic Timekeeper" },
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
