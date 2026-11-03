import { z } from "zod";
import { defineCanonicalInput } from "../../workflow/canonical-input.js";
import { UsDateSchema } from "../../config/schema.js";
import { OnboardingReadHirePlan, OnboardingPostalCodeSchema } from "./read-hire-plan.js";
import { OnboardingRosterSnapshotRowSchema } from "./roster.js";

export const OnboardingInput = z.strictObject({
  email: z.email(), mode: z.enum(["new-hire", "rehire"]), roster: OnboardingRosterSnapshotRowSchema,
  postalCodeOverride: OnboardingPostalCodeSchema.optional(), configuredJobEndDate: UsDateSchema.optional(),
}).refine(input => input.email.toLowerCase() === input.roster.binding.rowKey.email.toLowerCase(),
  "Onboarding input and roster snapshot must name the same email");

export const ONBOARDING_INPUT_EXAMPLE = OnboardingInput.parse({
  email: "hire@example.test", mode: "new-hire", configuredJobEndDate: "06/30/2027",
  roster: {
    binding: OnboardingReadHirePlan.example.roster,
    references: { legalName: { firstName: "Fixture", lastName: "Hire", middleName: "" }, livedName: null },
  },
});
export const OnboardingCanonicalInput = defineCanonicalInput(OnboardingInput, OnboardingInput, [ONBOARDING_INPUT_EXAMPLE]);
export type OnboardingInputValue = z.output<typeof OnboardingInput>;
