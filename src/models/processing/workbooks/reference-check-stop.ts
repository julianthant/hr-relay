import { z } from "zod";
import { taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { VerifyWorkbookPerson } from "./verify-person.js";

/** The operator gate a writing workflow parks at when a picked reference spreadsheet does not confirm the person. */
export const REFERENCE_CHECK_REVIEW_GATE = "reference-check-review";
/** The graph node each writing workflow runs its reference-check stop fold at. */
export const REFERENCE_STOP_NODE = "reference-stop";
/** The gate's one answer; "Cancel run" is the run's own cancel action, so it records no gate result. */
export const ReferenceCheckReviewSchema = z.strictObject({ decision: z.literal("continue") });

const ReferenceCheckStopInputSchema = z.strictObject({ check: VerifyWorkbookPerson.output.nullable(), writes: z.boolean() });
/** `ask` is true when the run stops before its first write and null when it goes on; null lets the gate's presence test also read a skipped stop. */
export const ReferenceCheckStopSchema = z.strictObject({ ask: z.literal(true).nullable() });

/** Ask only in a run that writes, and only when a picked spreadsheet missed the person or names them differently. */
export function referenceCheckStop(input: z.infer<typeof ReferenceCheckStopInputSchema>): z.infer<typeof ReferenceCheckStopSchema> {
  return { ask: input.writes && input.check?.result === "unconfirmed" ? true : null };
}

/** Each writing workflow's own pure fold from its reference check to whether the run stops before its first write. */
export function defineReferenceCheckStop(store: string) {
  return defineTaskContract({
    id: taskId(`workflow:${store}/read-reference-stop`), title: "Decide whether to ask before writing", effect: "read",
    input: ReferenceCheckStopInputSchema, output: ReferenceCheckStopSchema, errorCodes: ["INCONSISTENT_INPUTS"],
    subject: { kind: "none", reason: "pure fold of this run's reference check and whether the run writes" },
    freshness: { defaultMaxAgeMs: Infinity, defaultOverride: "forbidden" }, provenance: { default: "derived" },
    scenarios: [`${store}/reference-check`],
    example: { ask: true },
  });
}
