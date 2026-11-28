import { z } from "zod";
import { UcpathContactEffectProofSchema } from "../../systems/ucpath/emergency-contacts.js";
import { childRunOutcomeSchema } from "../../workflow/graph.js";
import { OcrApprovalReferenceSchema } from "../ocr/result.js";
export const EmergencyContactMemberResultSchema = z.discriminatedUnion("disposition", [
  z.strictObject({ disposition: z.enum(["committed", "already-present"]), proof: UcpathContactEffectProofSchema }),
  z.strictObject({ disposition: z.literal("omitted"), step: z.literal("contact-preview") }),
]);
export const EmergencyContactResultSchema = z.strictObject({ approval: OcrApprovalReferenceSchema,
  members: z.array(childRunOutcomeSchema(EmergencyContactMemberResultSchema)) });
