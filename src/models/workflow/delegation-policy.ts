/** The ONE delegation policy vocabulary, in its own leaf module so the bundle-safe graph and the durable records can each use it without the other's dependencies. */
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
