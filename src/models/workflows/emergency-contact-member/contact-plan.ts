import { z } from "zod";
import { UcpathContactWriteTargetSchema,UcpathEmergencyContactInputSchema } from "../../systems/ucpath/emergency-contacts.js";
import { PERSON_LOOKUP_EXAMPLE_EID } from "../person-lookup/input.js";
export const policy = { effect: "read", subject: { kind: "none", reason: "Derives the declared contact plan from approved fields and a complete observed set" },
  freshness: { defaultMaxAgeMs: 0, defaultOverride: "forbidden" }, provenance: { default: "derived" }, scenarios: [] } as const;
export const contactExample = UcpathEmergencyContactInputSchema.parse({ emplId: PERSON_LOOKUP_EXAMPLE_EID, expectedName: "Example, Alex", contact: {
  name: "Example Contact", relationship: "Parent", primary: true, cellPhone: null, homePhone: null, workPhone: null,
  address: { kind: "explicit", fields: { address1: null, address2: null, city: null, state: null, postalCode: null, country: null } },
} });
export const ContactPlanOutputSchema = z.strictObject({ target: UcpathContactWriteTargetSchema, changes: z.array(z.string().min(1)).min(1), demotionLine: z.string().min(1), contactLine: z.string().min(1) });
