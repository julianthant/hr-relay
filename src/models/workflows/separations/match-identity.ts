import { ProtectedInputBindingsSchema } from "../../write-safety/protected-input.js";
/** The identity authority packet, built as a real node so a fold that can REFUSE has a durable code, and carrying the packet AND its digest so every later reader agrees on it. */
import { z } from "zod";
import { EidSchema, FingerprintSchema, taskId } from "../../../rules/identity/ids.js";
import {
  IdentityEidSourceSchema,
  IdentityEvidencePacketSchema,
} from "../../../rules/separations/identity-evidence.js";
import { SeparationWritePlanSchema } from "../../../rules/separations/write-plan.js";
import { UcpathPersonSelectionSchema } from "../../systems/ucpath/search-person-org.js";
import { UcpathJobSummarySchema } from "../../ui/ucpath-job-summary.js";
import { KualiEidFieldSchema } from "../../ui/kuali-separation-document.js";
import { defineTaskContract } from "../../task/task-contract.js";

export const MatchIdentityOutputSchema = z.strictObject({
  packet: IdentityEvidencePacketSchema,
  approvalRequired: z.boolean(),
  /** The digest machine verification or an approval binds to (§14.5). */
  evidenceDigest: FingerprintSchema,
});
export type MatchIdentityOutput = z.infer<typeof MatchIdentityOutputSchema>;

export const SeparationsMatchIdentity = defineTaskContract({
  id: taskId("workflow:separations/match-identity"),
  title: "Identity Comparison",
  effect: "read",
  input: z.strictObject({
    protectedBindings: ProtectedInputBindingsSchema.optional(),
    documentNumber: z.string().min(1),
    /** The employee name the separation document carries, verbatim. */
    documentName: z.string().min(1),
    /** The document's own EID field — present with a value, or absent with a reason. */
    documentEid: KualiEidFieldSchema,
    /** Retain the checked EID and its source. */
    emplId: EidSchema,
    emplIdSource: IdentityEidSourceSchema,
    /** The whole job-summary read, projected downstream and never re-scraped. */
    jobSummary: UcpathJobSummarySchema,
    /** What a UCPath search on the DOCUMENT'S NAME resolved — run every time. */
    nameSelection: UcpathPersonSelectionSchema,
      /* What the writes will consume, or a STATED reason this graph composes none; required rather than optional, so a composition cannot forget to fill it. */
    plan: SeparationWritePlanSchema,
  }),
  output: MatchIdentityOutputSchema,
  errorCodes: [
    /** The run's checked EID is not the one the job summary was read for. */
    "identity-subject-mismatch",
    /** `emplIdSource` disagrees with the document's own EID field. */
    "identity-source-inconsistent",
  ],
  subject: {
    kind: "none",
    reason: "a pure fold over the UCPath reads this run already performed",
  },
  /** A pure transform can never be fresher than its inputs (ref workflow-model ages them). */
  freshness: { defaultMaxAgeMs: Number.POSITIVE_INFINITY, defaultOverride: "forbidden" },
  provenance: { default: "derived" },
  scenarios: [
    "separations-identity-check/single-active-job",
    "separations-identity-check/similar-name-never-auto-proceeds",
    "separations-identity-check/different-name-two-candidates",
    "separations-identity-check/already-terminated-single-row",
    "separations-identity-check/concurrent-active-jobs",
  ],
  example: {
    approvalRequired: false,
    packet: {
      documentNumber: "4510",
      emplId: "10873698",
      emplIdSource: "document-eid",
      documentEidText: "10873698",
      documentName: "Battistessa, Johnnie",
      ucpathName: "Battistessa, Johnnie",
      nameTier: "same",
      comparisons: [{
        field: "name",
        documentValue: "Battistessa, Johnnie",
        ucpathValue: "Battistessa, Johnnie",
        agrees: true,
        note: "the two spellings agree token for token",
      }],
      nameSearch: {
        status: "resolved",
        candidate: {
          eid: "10873698",
          name: "Battistessa, Johnnie",
          department: "Housing Dining Hospitality",
          jobTitle: "Dining Assistant",
          employeeStatus: "active",
        },
        candidateEids: ["10873698"],
      },
      jobs: {
        disposition: "single-active-job",
        rowCount: 1,
        activeRowCount: 1,
        inactiveRowCount: 0,
        unknownRowCount: 0,
        rows: [{
          rowIndex: 0,
          emplRecord: "0",
          hrStatus: "Active",
          tier: "active",
          department: "Housing Dining Hospitality",
          jobTitle: "Dining Assistant",
          effectiveDate: "07/01/2025",
        }],
        unreadableCells: [],
      },
      plan: {
        state: "not-composed",
        reason: "this graph resolves an identity and composes no separation write plan",
      },
      approvableEids: ["10873698"],
      approvalShape: "one-click",
      observedAt: "2026-08-12T18:00:00.000Z",
    },
    evidenceDigest: "0".repeat(64),
  },
});
