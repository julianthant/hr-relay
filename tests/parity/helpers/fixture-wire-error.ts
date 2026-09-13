import { WireErrorSchema } from "../../../src/domain/dashboard/primitives.js";


/* ── the API app ─────────────────────────────────────────────────────────── */

export function wireError(code: string, message: string): unknown {
  return WireErrorSchema.parse({ state: "error", code, message, retryable: false });
}
