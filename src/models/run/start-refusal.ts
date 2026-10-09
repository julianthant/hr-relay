/** The closed vocabulary of a start-plan refusal, kept apart from `start-plan.ts` because a browser bundle may reach no Node built-in. */
import { z } from "zod";

export const StartRefusalCodeSchema = z.enum([
  "input-invalid",
  "active-run-exists",
  "dry-run-unsupported",
  "preflight-failed",
  "capability-unavailable",
]);
export type StartRefusalCode = z.infer<typeof StartRefusalCodeSchema>;
