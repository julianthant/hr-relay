import { z } from "zod";

import { canonicalJsonStringify } from "../canonical-json.js";
import { FingerprintSchema, IsoInstantSchema, RunIdSchema, WorkflowIdSchema } from "../ids.js";
import { sha256Hex } from "../sha256.js";
import { RuntimeVersionMemberSchema } from "./runtime-version-review.js";
import { planRuntimeVersionTransition, RuntimeVersionScopeSchema, RuntimeVersionStateSchema } from "./runtime-version.js";
import { ArchiveReportSchema } from "./report.js";

export const RuntimeVersionChangeReviewSchema = z.strictObject({
  schemaVersion: z.literal(3),
  changeId: z.string().uuid(),
  actorId: z.string().min(1),
  reviewedAt: IsoInstantSchema,
  authorityRevision: z.number().int().positive(),
  scope: RuntimeVersionScopeSchema,
  before: RuntimeVersionStateSchema,
  after: RuntimeVersionStateSchema,
  members: z.array(RuntimeVersionMemberSchema),
  membershipDigest: FingerprintSchema,
  planCommandFingerprint: FingerprintSchema,
});
export type RuntimeVersionChangeReview = z.infer<typeof RuntimeVersionChangeReviewSchema>;

export function runtimeVersionChangeReviewFingerprint(input: Readonly<Omit<RuntimeVersionChangeReview, "members" | "membershipDigest" | "planCommandFingerprint"> & {
  members: readonly RuntimeVersionChangeReview["members"][number][];
  membershipDigest: string;
  planCommandFingerprint: string;
}>): string {
  return sha256Hex(canonicalJsonStringify(RuntimeVersionChangeReviewSchema.parse(input)));
}

export const RuntimeVersionChangeSchema = RuntimeVersionChangeReviewSchema.extend({
  reviewFingerprint: FingerprintSchema,
  state: z.enum(["planned", "applying", "applied"]),
  completedRunIds: z.array(RunIdSchema),
  applicationCommandId: z.string().uuid().optional(),
  applicationRequestFingerprint: FingerprintSchema.optional(),
  claimedAt: IsoInstantSchema.optional(),
  completedAt: IsoInstantSchema.optional(),
  pendingCaptures: z.array(z.strictObject({ runId: RunIdSchema, reportJson: z.string().min(1) })).optional(),
}).superRefine((change, context) => {
  const review = RuntimeVersionChangeReviewSchema.parse(Object.fromEntries(
    Object.entries(change).filter(([key]) => key in RuntimeVersionChangeReviewSchema.shape),
  ));
  const plan = planRuntimeVersionTransition(change.before, change.scope);
  const ids = change.members.map(member => member.runId);
  const candidates = change.members.filter(member => member.state === "terminal").map(member => member.runId);
  const pendingIds = change.pendingCaptures?.map(capture => capture.runId) ?? [];
  const selected = new Set(plan.affectedWorkflowIds);
  const invalid = canonicalJsonStringify(plan.after) !== canonicalJsonStringify(change.after)
    || change.reviewFingerprint !== runtimeVersionChangeReviewFingerprint(review)
    || change.membershipDigest !== sha256Hex(canonicalJsonStringify(change.members))
    || new Set(ids).size !== ids.length
    || change.members.some(member => !selected.has(WorkflowIdSchema.parse(member.workflowId)))
    || new Set(change.completedRunIds).size !== change.completedRunIds.length
    || change.completedRunIds.some(id => !candidates.includes(id))
    || new Set(pendingIds).size !== pendingIds.length
    || pendingIds.some(id => !candidates.includes(id) || change.completedRunIds.includes(id))
    || (change.state === "planned" && (change.applicationCommandId !== undefined || change.applicationRequestFingerprint !== undefined || change.claimedAt !== undefined || change.completedAt !== undefined
      || change.completedRunIds.length > 0 || change.pendingCaptures !== undefined))
    || (change.state === "applying" && (change.applicationCommandId === undefined || change.applicationRequestFingerprint === undefined || change.claimedAt === undefined || change.completedAt !== undefined
      || pendingIds.length + change.completedRunIds.length !== candidates.length))
    || (change.state === "applied" && (change.applicationCommandId === undefined || change.applicationRequestFingerprint === undefined || change.claimedAt === undefined || change.completedAt === undefined
      || change.completedRunIds.length !== candidates.length || change.pendingCaptures !== undefined));
  if (invalid) context.addIssue({ code: "custom", message: "runtime-version-change-invalid" });
  for (const capture of change.pendingCaptures ?? []) {
    try {
      const parsed = ArchiveReportSchema.safeParse(JSON.parse(capture.reportJson));
      if (parsed.success && parsed.data.content.runId === capture.runId
        && parsed.data.content.runtimeVersion !== undefined) continue;
    } catch { /* Report fails validation below. */ }
    context.addIssue({ code: "custom", message: "runtime-version-capture-invalid" });
  }
});
export type RuntimeVersionChange = z.infer<typeof RuntimeVersionChangeSchema>;
