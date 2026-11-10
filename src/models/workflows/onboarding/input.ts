import { z } from "zod";
import { defineCanonicalInput } from "../../workflow/canonical-input.js";
import { UsDateSchema } from "../../config/schema.js";
import { OnboardingReadHirePlan, OnboardingPostalCodeSchema } from "./read-hire-plan.js";
import { OnboardingRosterReadOutputSchema } from "./roster.js";

export const OnboardingInput = z.strictObject({
  email: z.email(), mode: z.enum(["new-hire", "rehire"]), roster: OnboardingRosterReadOutputSchema.optional(),
  postalCodeOverride: OnboardingPostalCodeSchema.optional(), configuredJobEndDate: UsDateSchema.optional(),
}).refine(input => input.roster === undefined || input.email === (input.roster.state === "resolved" ? input.roster.row.binding : input.roster.binding).rowKey.email,
  "Onboarding input and roster snapshot must name the same email");

export const OnboardingCanonicalValueSchema = OnboardingInput.safeExtend({ roster: OnboardingRosterReadOutputSchema });

export const ONBOARDING_INPUT_EXAMPLE = {
  email: "hire@example.test", mode: "new-hire", configuredJobEndDate: "06/30/2027",
  roster: { state: "resolved", row: {
    binding: OnboardingReadHirePlan.example.roster,
    references: { legalName: "Fixture Hire", livedName: null },
  } },
} as const;
export const OnboardingCanonicalInput = defineCanonicalInput(OnboardingInput, OnboardingCanonicalValueSchema, [ONBOARDING_INPUT_EXAMPLE]);
export type OnboardingInputValue = z.output<typeof OnboardingInput>;
