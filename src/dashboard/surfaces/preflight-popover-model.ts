import type { z } from "zod";
import type {
PreflightCheckWireSchema,
PreflightVerdictSchema
} from "../../domain/dashboard/bootstrap.js";


/* ── preflight (the doctor) ──────────────────────────────────────────────── */

export type PreflightCheckWire = z.infer<typeof PreflightCheckWireSchema>;


export type PreflightVerdict = z.infer<typeof PreflightVerdictSchema>;


/** How loud the standing indicator should be. `fail` beats `warning` beats `pass`. */
export function preflightVerdict(checks: readonly PreflightCheckWire[]): PreflightVerdict {
  if (checks.some((check) => check.verdict === "fail")) return "fail";
  if (checks.some((check) => check.verdict === "warning")) return "warning";
  return "pass";
}
