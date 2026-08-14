/**
 * `workflow:separations/match-separation-subject` — S18/S19's fork as a real node.
 *
 * Chunk 3 is TOLD which EID to check and where it came from, and says in as
 * many words that resolving it "is chunk 2's output and the composition's job".
 * This is that node: one pure decision over the document's own EID field and the
 * unconditional UCPath name search, producing the `(emplId, emplIdSource)` pair
 * every downstream read and the gate packet bind against.
 *
 * §5 item 10's recorded answer is why it is a fold and not a delegation: no
 * child run, candidates resolved inline and handed to the ALWAYS-GATE packet.
 */
import { z } from "zod";
import { taskId } from "../../ids.js";
import {
  SEPARATION_SUBJECT_REFUSAL_CODES,
  SeparationSubjectSchema,
} from "../../separations/separation-subject.js";
import { KualiEidFieldSchema } from "../../ui/kuali-separation-document.js";
import { UcpathPersonSelectionSchema } from "../ucpath/search-person-org.js";
import { defineTaskContract } from "../base.js";

export const MatchSeparationSubjectOutputSchema = SeparationSubjectSchema;
export type ResolveSubjectOutput = z.infer<typeof MatchSeparationSubjectOutputSchema>;

export const SeparationsMatchSeparationSubject = defineTaskContract({
  id: taskId("workflow:separations/match-separation-subject"),
  title: "Separation Subject",
  effect: "read",
  input: z.strictObject({
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
