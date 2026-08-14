/**
 * **S18/S19's fork, decided** — which EID this separation is about, and where
 * that EID came from.
 *
 * Chunk 3 is told both facts and refuses a run whose `emplIdSource` disagrees
 * with the document. It says so in as many words: *"Legacy's fallback — a blank
 * or short Kuali EID delegating to person-lookup — is a resolution step over the
 * Kuali document read, which is chunk 2's output and the composition's job."*
 * This is that job.
 *
 * ## It is a fold, not a delegation
 *
 * §5 item 10's recorded answer is **no delegation**: candidates are resolved
 * inline and handed to the ALWAYS-GATE packet, because under §4d the operator
 * sees them on every run anyway. So the resolution is one pure decision over two
 * facts the graph already holds — the document's own EID field, and the UCPath
 * search on the document's name, which chunk 3 runs UNCONDITIONALLY for exactly
 * this reason.
 *
 * ## The fork is visible, never quiet
 *
 * When the document names the EID, the run is checking a person the department
 * wrote down. When it does not, the run is checking a person a NAME SEARCH
 * picked — and `deriveApprovalShape` turns `emplIdSource: "name-resolved"` into
 * a `type-the-eid` gate, the strictest control there is. That is the whole
 * safety property: an EID nobody wrote on the form can never be approved by one
 * click.
 *
 * ## What it refuses
 *
 * A blank EID whose name search resolved nobody, or resolved several people, is
 * not a subject this run may pick. Legacy delegates to person-lookup and then
 * proceeds on whatever comes back; here the run stops and names the candidates.
 * A short or malformed EID never reaches this fold at all — chunk 2's read
 * returns its own `unreadable-eid` state for that, which is a different problem
 * with a different fix.
 */
import { z } from "zod";
import { EidSchema } from "../ids.js";
import type { UcpathPersonSelection } from "../contracts/ucpath/search-person-org.js";
import type { KualiEidField } from "../ui/kuali-separation-document.js";
import { IdentityEidSourceSchema } from "./identity-evidence.js";

export const SEPARATION_SUBJECT_REFUSAL_CODES = [
  /** The document named no EID and a search on its name resolved nobody. */
  "subject-not-resolvable",
  /** The document named no EID and a search on its name resolved several people. */
  "subject-ambiguous",
] as const;
export const SeparationSubjectRefusalCodeSchema = z.enum(SEPARATION_SUBJECT_REFUSAL_CODES);
export type SeparationSubjectRefusalCode = z.infer<typeof SeparationSubjectRefusalCodeSchema>;

export const SeparationSubjectSchema = z.strictObject({
  emplId: EidSchema,
  emplIdSource: IdentityEidSourceSchema,
  /** The name the UCPath search ran on — the document's, verbatim. */
  searchedName: z.string().min(1),
  /**
   * How many people that search resolved. Doc 09 §14.4 calls "whether more than
   * one candidate matched" *decisive for `T002173685`*, so it is a stored fact
   * rather than something the packet re-counts.
   */
  candidateCount: z.number().int().nonnegative(),
});
export type SeparationSubject = z.infer<typeof SeparationSubjectSchema>;

export const SeparationSubjectResolutionSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("resolved"), subject: SeparationSubjectSchema }),
  z.strictObject({
    state: z.literal("refused"),
    code: SeparationSubjectRefusalCodeSchema,
    reason: z.string().min(1),
  }),
]);
export type SeparationSubjectResolution = z.infer<typeof SeparationSubjectResolutionSchema>;

export function resolveSeparationSubject(input: Readonly<{
  documentNumber: string;
  /** The name the separation form carries, verbatim. */
  employeeName: string;
  /** The document's own EID field — present with a value, or absent with a reason. */
  documentEid: KualiEidField;
  /** What a UCPath search on that name resolved. Run on every run, never conditionally. */
  nameSelection: UcpathPersonSelection;
}>): SeparationSubjectResolution {
  const candidateCount = input.nameSelection.candidateEids.length;
  if (input.documentEid.state === "present") {
    return SeparationSubjectResolutionSchema.parse({
      state: "resolved",
      subject: {
        emplId: input.documentEid.value,
        emplIdSource: "document-eid",
        searchedName: input.employeeName,
        candidateCount,
      },
    });
  }
  if (input.nameSelection.status === "resolved") {
    return SeparationSubjectResolutionSchema.parse({
      state: "resolved",
      subject: {
        emplId: input.nameSelection.selected.emplId,
        emplIdSource: "name-resolved",
        searchedName: input.employeeName,
        candidateCount,
      },
    });
  }
  if (input.nameSelection.status === "ambiguous") {
    return SeparationSubjectResolutionSchema.parse({
      state: "refused",
      code: "subject-ambiguous",
      reason: `Kuali document ${input.documentNumber} names no EID (${input.documentEid.reason}), and a `
        + `UCPath search on ${JSON.stringify(input.employeeName)} resolved `
        + `${String(candidateCount)} people: ${input.nameSelection.candidateEids.join(", ")}. `
        + "Legacy delegates to person-lookup here and proceeds on whatever comes back; picking one of "
        + "these to terminate is exactly the T002173685 class of decision, and it is not a decision a "
        + "fold may make.",
    });
  }
  return SeparationSubjectResolutionSchema.parse({
    state: "refused",
    code: "subject-not-resolvable",
    reason: `Kuali document ${input.documentNumber} names no EID (${input.documentEid.reason}), and a `
      + `UCPath search on ${JSON.stringify(input.employeeName)} resolved nobody. There is no person for `
      + "this separation to be about, so there is nothing to read, compare, or approve.",
  });
}
