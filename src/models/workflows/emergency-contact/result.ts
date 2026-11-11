import { z } from "zod";
import { UcpathContactEffectProofSchema } from "../../systems/ucpath/emergency-contacts.js";
import { childRunOutcomeSchema } from "../../workflow/graph.js";
import { OnbaseResultSchema } from "../../../workflows/onbase/steps/import-document/step.js";
import { OcrApprovalReferenceSchema } from "../ocr/result.js";
export const EmergencyContactMemberResultSchema = z.strictObject({ disposition: z.enum(["committed", "already-present"]), proof: UcpathContactEffectProofSchema,
  onbase: OnbaseResultSchema });
export const EmergencyContactResultSchema = z.strictObject({ approval: OcrApprovalReferenceSchema,
  members: z.array(childRunOutcomeSchema(EmergencyContactMemberResultSchema)) });
