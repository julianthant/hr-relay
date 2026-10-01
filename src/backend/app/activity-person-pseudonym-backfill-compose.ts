import { z } from "zod";
import type { RuntimeIsolation } from "../../config/define-runtime-isolation.js";
import type { Clock } from "../../domain/clock.js";
export const ACTIVITY_PERSON_PSEUDONYM_BACKFILL_USAGE = "activity-person-pseudonyms retired; Activity uses validated canonical results";
export const ActivityPersonPseudonymBackfillCommandOutcomeSchema = z.strictObject({output:z.string().min(1),exitCode:z.union([z.literal(0),z.literal(1),z.literal(2)])});
export type ActivityPersonPseudonymBackfillCommandOutcome = {output:string;exitCode:0|1|2};
/** Historical entry point refuses before reading credentials or opening authority. */
export function composeActivityPersonPseudonymBackfillCommand(_input: Readonly<{isolation:RuntimeIsolation;args:readonly string[];repoRoot?:string;clock?:Clock}>): ActivityPersonPseudonymBackfillCommandOutcome {
  return {output:ACTIVITY_PERSON_PSEUDONYM_BACKFILL_USAGE,exitCode:1};
}
