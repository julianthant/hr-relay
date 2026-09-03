/**
 * The closed vocabulary of a start-plan refusal. It lives apart from
 * `start-plan.ts` because that module hashes with `node:crypto`, and the
 * refusal code rides the browser-bundled start-plan wire
 * (`domain/dashboard/start-plan.ts`): a browser bundle may reach no Node
 * built-in (ref frontend-backend-integration §8).
 */
import { z } from "zod";

export const StartRefusalCodeSchema = z.enum([
  "input-invalid",
  "active-run-exists",
  "dry-run-unsupported",
  "preflight-failed",
  "capability-unavailable",
]);
export type StartRefusalCode = z.infer<typeof StartRefusalCodeSchema>;
