/**
 * `workflow:person-lookup/read-active-status` — the pure join of the UCPath
 * selection and the CRM record into an active-status verdict.
 *
 * Ref workflow-model §8 sketches this as `extraction/derive-active-check-outcome`. Two
 * as-built corrections:
 *
 * - The namespace is the workflow mini-store, not the `extraction` service
 *   store. `extraction` is an OCR/provider-backed store that lands in Phase 2h;
 *   a pure fold over facts this workflow already read belongs in
 *   `workflow:<descriptor-id>`, which contributes no browser session by
 *   construction (ref workflow-model §3's task-id grammar).
 * - The verb is `read`, not `derive`. Ref task-contract's effect→verb vocabulary is the
 *   one landed in 1d and it does not carry `derive`.
 *
 * The outcome is a closed union with a stated reason on every arm. "Inactive"
 * and "cannot be determined" are different answers, and a boolean would collapse
 * them into the one that looks actionable.
 */
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
  // A pure transform can never be fresher than its inputs, so it carries no
  // freshness budget of its own: the walk in ref workflow-model §5.5 ages the UCPath and CRM
  // checkpoints that feed it. `Infinity` is written explicitly for that reason.
  freshness: { defaultMaxAgeMs: Number.POSITIVE_INFINITY, defaultOverride: "forbidden" },
  provenance: { default: "derived" },
  scenarios: [],
  example: {
    state: "active",
    reason: "UCPath reports an active HDH appointment and CRM onboarding is complete",
    hdh: true,
  },
});
