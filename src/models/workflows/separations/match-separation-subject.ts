/** The fork of the document's own EID field and the unconditional UCPath name search, producing the `(emplId, emplIdSource)` pair every downstream read binds against. */
import { z } from "zod";
import { EidSchema, taskId } from "../../../rules/identity/ids.js";
import {
  SEPARATION_SUBJECT_REFUSAL_CODES,
  SeparationSubjectSchema,
} from "../../../rules/separations/separation-subject.js";
import { KualiEidFieldSchema } from "../../ui/kuali-separation-document.js";
import { UcpathPersonSelectionSchema } from "../../systems/ucpath/search-person-org.js";
import { defineTaskContract } from "../../task/task-contract.js";

export const MatchSeparationSubjectOutputSchema = SeparationSubjectSchema;
export type ResolveSubjectOutput = z.infer<typeof MatchSeparationSubjectOutputSchema>;

export const SeparationsMatchSeparationSubject = defineTaskContract({
  id: taskId("workflow:separations/match-separation-subject"),
  title: "Separation Subject",
  effect: "read",
  input: z.strictObject({
    operatorEmployeeId: EidSchema.optional(),
    documentNumber: z.string().min(1),
    /** The name the separation form carries, verbatim. */
    employeeName: z.string().min(1),
    /** The document's own EID field — present with a value, or absent with a reason. */
    documentEid: KualiEidFieldSchema,
    /** What a UCPath search on that name resolved. Run every time, never conditionally. */
    nameSelection: UcpathPersonSelectionSchema,
  }),
  output: MatchSeparationSubjectOutputSchema,
  errorCodes: SEPARATION_SUBJECT_REFUSAL_CODES,
  subject: {
    kind: "none",
    reason: "a pure fold over the separation document and the name search this run already performed",
  },
  freshness: { defaultMaxAgeMs: Number.POSITIVE_INFINITY, defaultOverride: "forbidden" },
  provenance: { default: "derived" },
  scenarios: ["separations/subject-resolution"],
  example: {
    emplId: "10873698",
    emplIdSource: "document-eid",
    searchedName: "Battistessa, Johnnie",
    candidateCount: 1,
  },
});
