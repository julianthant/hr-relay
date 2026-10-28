/** Retain the chosen EID's source, including the document/name-search fork. */
import { z } from "zod";
import { EidSchema } from "../identity/ids.js";
import { directIdentifierDisplay } from "../redaction/redaction.js";
import type { UcpathPersonSelection } from "../../models/systems/ucpath/search-person-org.js";
import type { KualiEidField } from "../../models/ui/kuali-separation-document.js";
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
    /* How many people that search resolved: whether more than one candidate matched is decisive, so it is a stored fact rather than something the packet re-counts. */
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
  operatorEmployeeId?: string;
  documentNumber: string;
  /** The name the separation form carries, verbatim. */
  employeeName: string;
  /** The document's own EID field — present with a value, or absent with a reason. */
  documentEid: KualiEidField;
  /** What a UCPath search on that name resolved. Run on every run, never conditionally. */
  nameSelection: UcpathPersonSelection;
}>): SeparationSubjectResolution {
  const candidateCount = input.nameSelection.candidateEids.length;
  if (input.operatorEmployeeId !== undefined) {
    return SeparationSubjectResolutionSchema.parse({ state: "resolved", subject: {
      emplId: EidSchema.parse(input.operatorEmployeeId), emplIdSource: "operator-entered",
      searchedName: input.employeeName, candidateCount,
    } });
  }
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
        + `UCPath search on ${directIdentifierDisplay(input.employeeName)} resolved `
        + `${String(candidateCount)} people: ${input.nameSelection.candidateEids.map(directIdentifierDisplay).join(", ")}. `
        + "Legacy delegates to person-lookup here and proceeds on whatever comes back; picking one of "
        + "these to terminate is exactly the T002173685 class of decision, and it is not a decision a "
        + "fold may make.",
    });
  }
  return SeparationSubjectResolutionSchema.parse({
    state: "refused",
    code: "subject-not-resolvable",
    reason: `Kuali document ${input.documentNumber} names no EID (${input.documentEid.reason}), and a `
      + `UCPath search on ${directIdentifierDisplay(input.employeeName)} resolved nobody. There is no person for `
      + "this separation to be about, so there is nothing to read, compare, or approve.",
  });
}
