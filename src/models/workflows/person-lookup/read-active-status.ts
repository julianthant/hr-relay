/** The pure join of the UCPath selection and the CRM record into an active-status verdict, as a closed union with a stated reason on every arm. */
import { z } from "zod";
import { taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { ReadOnboardingRecordOutputSchema } from "../../systems/crm/read-onboarding-record.js";
import { SearchPersonOrgOutputSchema } from "../../systems/ucpath/search-person-org.js";

export const ActiveStatusOutcomeSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("active"),
    reason: z.string().min(1),
    hdh: z.boolean(),
  }),
  z.strictObject({
    state: z.literal("inactive"),
    reason: z.string().min(1),
    hdh: z.boolean(),
  }),
  z.strictObject({
    state: z.literal("undetermined"),
    reason: z.string().min(1),
  }),
]);
export type ActiveStatusOutcome = z.infer<typeof ActiveStatusOutcomeSchema>;

export const ReadActiveStatus = defineTaskContract({
  id: taskId("workflow:person-lookup/read-active-status"),
  title: "Active Status",
  effect: "read",
  input: z.strictObject({
    person: SearchPersonOrgOutputSchema,
    crm: ReadOnboardingRecordOutputSchema,
    keepNonHdh: z.boolean(),
  }),
  output: ActiveStatusOutcomeSchema,
  errorCodes: ["inconsistent-inputs"],
  subject: { kind: "none", reason: "a pure fold over facts this run already read" },
  // Age upstream captures; a pure transform cannot refresh them and has no separate budget.
  freshness: { defaultMaxAgeMs: Number.POSITIVE_INFINITY, defaultOverride: "forbidden" },
  provenance: { default: "derived" },
  scenarios: [],
  example: {
    state: "active",
    reason: "UCPath reports an active HDH appointment and CRM onboarding is complete",
    hdh: true,
  },
});
