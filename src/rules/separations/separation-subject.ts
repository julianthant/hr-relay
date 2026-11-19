import { z } from "zod";
import type { UcpathPersonSelection } from "../../models/systems/ucpath/search-person-org.js";
import type { KualiEidField } from "../../models/ui/kuali-separation-document.js";
import { EidSchema, type Eid } from "../identity/ids.js";
import { maskedEid } from "../redaction/redaction.js";

export const SEPARATION_SUBJECT_REFUSAL_CODES = ["employee-id-absent", "employee-id-no-match"] as const;

export const SeparationSubjectSchema = z.strictObject({
  emplId: EidSchema,
  emplIdSource: z.enum(["document-eid", "operator-entered"]),
  searchedEmployeeId: EidSchema,
  candidateCount: z.number().int().positive(),
});

type SeparationSubjectResolution =
  | Readonly<{ state: "resolved"; subject: z.infer<typeof SeparationSubjectSchema> }>
  | Readonly<{ state: "refused"; code: typeof SEPARATION_SUBJECT_REFUSAL_CODES[number]; reason: string }>;

export function resolveSeparationSubject(input: Readonly<{
  operatorEmployeeId?: Eid | undefined;
  documentNumber: string;
  documentEid: KualiEidField;
  searchSelection?: UcpathPersonSelection | undefined;
}>): SeparationSubjectResolution {
  if (input.documentEid.state === "absent") {
    return { state: "refused", code: "employee-id-absent",
      reason: `Kuali document ${input.documentNumber} does not show an Employee ID.` };
  }
  const searchedEmployeeId = input.documentEid.value;
  const selection = input.searchSelection;
  if (selection === undefined) throw new Error("The document Employee ID search produced no selection evidence.");
  if (selection.status !== "resolved" || selection.selected.emplId !== searchedEmployeeId
    || selection.candidateEids.length !== 1 || selection.candidateEids[0] !== searchedEmployeeId) {
    return { state: "refused", code: "employee-id-no-match",
      reason: `No UCPath person matched Employee ID ${maskedEid(searchedEmployeeId)} on Kuali document ${input.documentNumber}.` };
  }
  return {
    state: "resolved",
    subject: {
      emplId: input.operatorEmployeeId ?? searchedEmployeeId,
      emplIdSource: input.operatorEmployeeId === undefined ? "document-eid" : "operator-entered",
      searchedEmployeeId,
      candidateCount: selection.candidateEids.length,
    },
  };
}
