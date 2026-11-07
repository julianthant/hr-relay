/** The fingerprint cut for the eye It lives beside `run-identity.tsx`
 * rather than inside it because a module */

import { shortHash } from "../../shared/status/format.js";

/** the served fingerprint, at chip length — the full hash stays in the ⓘ */
export function shortFingerprint(fingerprint: string): string {
  return shortHash(fingerprint);
}

/** Is this run's SHAPE the shape this dashboard serves for its workflow?
 * item 3) */
export type RunShapeVerdict =
  | { readonly state: "current" }
  | { readonly state: "moved"; readonly servedShape: string }
  | { readonly state: "unserved" };

export function classifyRunShape(
  ranDescriptorHash: string,
  servedDescriptorHash: string | undefined,
): RunShapeVerdict {
  if (servedDescriptorHash === undefined) return { state: "unserved" };
  if (servedDescriptorHash === ranDescriptorHash) return { state: "current" };
  return { state: "moved", servedShape: servedDescriptorHash };
}
