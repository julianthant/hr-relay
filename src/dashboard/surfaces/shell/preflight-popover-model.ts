import type { z } from "zod";
import type { PreflightCheckWireSchema, PreflightVerdictSchema } from "../../../models/dashboard/bootstrap.js";
export type PreflightCheckWire = z.infer<typeof PreflightCheckWireSchema>;
export type PreflightVerdict = z.infer<typeof PreflightVerdictSchema>;
export function preflightVerdict(checks: readonly PreflightCheckWire[]): PreflightVerdict | "unavailable" {
  if (checks.length === 0) return "unavailable";
  if (checks.some(check => check.verdict === "fail")) return "fail";
  if (checks.some(check => check.verdict === "warning")) return "warning";
  return "pass";
}
export { preflightRemedy } from '../settings/preflight/preflight-remedy-model.js';
