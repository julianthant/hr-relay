/**
 * The fingerprint cut for the eye
 *
 * It lives beside `run-identity.tsx` rather than inside it because a module that
 * exports a component may export nothing else if React Fast Refresh is to treat
 * it as a refresh boundary: one non-component export makes every edit to the
 * surface invalidate upward into `dashboard-app.tsx` and remount the app
 * instead of hot-swapping the component.
 */

const FINGERPRINT_PREFIX = 8;

/** the served fingerprint, at chip length — the full hash stays in the ⓘ */
export function shortFingerprint(fingerprint: string): string {
  return fingerprint.slice(0, FINGERPRINT_PREFIX);
}

/**
 * Is this run's SHAPE the shape this dashboard serves for its workflow?
 *
 * ## The defect this closes (Track C's connection proof, separations §9.22
 * item 3)
 *
 * `RunProvenanceBar` computed `shapeMoved = surface.descriptorHash !==
 * currentDescriptorHash`, where the left side is the RUN's one-workflow
 * `contractFingerprint` and the right side was the bootstrap's
 * `descriptorHash` — the hash of the whole eight-workflow SET. Two different
 * kinds of value, so never equal: **every run on the dashboard wore the amber
 * hazard**, including three whose fingerprint was byte-identical to the one
 * the explorer served for their workflow and the build manifest held. This is
 * D179's `staleApp` defect inverted, and worse: a warning that can never NOT
 * fire trains the eye past the one chip that would announce a genuinely
 * retired shape.
 *
 * The comparison is now against the run's OWN workflow's served fingerprint,
 * which the boot document already carries per workflow
 * (`WorkflowBootstrapPrimitive.descriptorFingerprint` = that descriptor's
 * `contractFingerprint`) — no wire grows.
 *
 * `unserved` is its own verdict rather than an assumed move: a run whose
 * workflow this build does not register has no shape to be compared with, and
 * saying "the shape moved" would name a fact nobody established. It is still
 * drawn as a hazard, because a retry has nothing to run.
 */
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
