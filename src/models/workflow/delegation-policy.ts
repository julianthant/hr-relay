/**
 * The ONE delegation policy vocabulary (ref workflow-model §1.1/§3.2, ratified D102).
 *
 * It lives in its own leaf module because two very different consumers need it
 * and neither should pull the other's dependencies in: the bundle-safe workflow
 * graph (`./graph.js`) declares it on a `child-run` node, and the durable
 * dependency/manifest records (`../dependencies.js`) store it verbatim. One
 * vocabulary runs from builder → manifest → dependency row → UI.
 *
 * D102 replaced 1c's unratified `DependencyPolicySchema` shape
 * (`failure: fail-parent|collect|ignore`, `retry: retry-child|replace-child|
 * parent-only`, `visibility: member|linked|delegated`), which appeared in no
 * owning doc and had no arm for ref workflow-model's `block-parent`.
 */
import { z } from "zod";

/** `block-parent` holds the parent open for operator resolution; it never fails it. */
export const ChildFailurePolicySchema = z.enum(["fail-parent", "block-parent", "allow-partial"]);
export const ChildCancelPolicySchema = z.enum(["cascade", "independent"]);
export const ChildRetryPolicySchema = z.enum(["resume-parent", "manual-parent-resume"]);
export const ChildVisibilitySchema = z.enum(["inline", "linked", "hidden-unless-failed"]);

export const DelegationPolicySchema = z.strictObject({
  onChildFailed: ChildFailurePolicySchema,
  cascadeCancel: ChildCancelPolicySchema,
  afterChildRetry: ChildRetryPolicySchema,
  visibility: ChildVisibilitySchema,
});

export type ChildFailurePolicy = z.infer<typeof ChildFailurePolicySchema>;
export type ChildCancelPolicy = z.infer<typeof ChildCancelPolicySchema>;
export type ChildRetryPolicy = z.infer<typeof ChildRetryPolicySchema>;
export type ChildVisibility = z.infer<typeof ChildVisibilitySchema>;
export type DelegationPolicy = z.infer<typeof DelegationPolicySchema>;
