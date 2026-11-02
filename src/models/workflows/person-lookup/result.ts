import { z } from "zod";
import { ActiveStatusOutcomeSchema } from "./read-active-status.js";
import { ReadOnboardingDatesOutputSchema } from "../../systems/crm/read-onboarding-dates.js";

export const PersonLookupResultSchema = z.strictObject({ activeStatus: ActiveStatusOutcomeSchema,
  crmDates: z.discriminatedUnion("state", [z.strictObject({ state: z.literal("included"), dates: ReadOnboardingDatesOutputSchema }), z.strictObject({ state: z.literal("not-requested") })]) });
