import { z } from "zod";
import { ItemIdSchema, RunIdSchema, taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { childRunOutcomeSchema } from "../../workflow/graph.js";
import { I9SignerOutputSchema } from "../../systems/i9/read-section2-signer.js";
import { HireSubjectSchema } from "./match-hire-subject.js";

export const OnboardingI9OutcomeSchema = childRunOutcomeSchema(I9SignerOutputSchema);
export const OnboardingI9NotRequiredSchema = z.strictObject({
  state: z.literal("not-required"), subjectState: z.enum(["existing-person", "review-required"]),
});
export const OnboardingI9LookupSchema = z.discriminatedUnion("state", [
  OnboardingI9NotRequiredSchema,
  z.strictObject({ state: z.literal("checked"), childRunId: RunIdSchema, result: I9SignerOutputSchema }),
]);

export const OnboardingReadI9Lookup = defineTaskContract({
  id: taskId("workflow:onboarding/read-i9-lookup"), title: "Retain delegated I-9 lookup", effect: "read",
  input: z.strictObject({ subject: HireSubjectSchema, expectedItemId: ItemIdSchema, outcomes: z.array(OnboardingI9OutcomeSchema) }),
  output: OnboardingI9LookupSchema, errorCodes: ["ONBOARDING_I9_LOOKUP_UNRESOLVED"],
  subject: { kind: "none", reason: "retains only the exact delegated child outcome or the explicit no-lookup branch" },
  freshness: { defaultMaxAgeMs: Infinity, defaultOverride: "forbidden" }, provenance: { default: "derived" }, scenarios: [],
  example: { state: "checked", childRunId: "aaaaaaaa-0001-4000-8000-000100000001", result: { i9Status: "not-found", signerName: "" } },
});
