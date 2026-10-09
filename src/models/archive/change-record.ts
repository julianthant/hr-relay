import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../rules/validation/sha256.js";
/** Charter §25's change record for a version bump, as its own leaf module: the archive model and the command vocabulary both need it, and a shared zod-only leaf keeps a cycle out between them. */
import { z } from "zod";

/** What a bump changed and why, carried from plan to application; `commit` is an absence union because demanding a hash would fabricate one. */
export const VersionBumpChangeRecordSchema = z.strictObject({
  /** MAJOR is a shape change; MINOR is behaviour inside the same shape. */
  kind: z.enum(["major", "minor"]),
  /** What moved, in one line. */
  what: z.string().min(1).max(200),
  /** Why it moved — the half nobody can reconstruct from a diff. */
  why: z.string().min(1).max(1000),
  commit: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value: z.string().min(7).max(120) }),
    z.strictObject({ state: z.literal("absent"), reason: z.string().min(1).max(200) }),
  ]),
});
export type VersionBumpChangeRecord = z.infer<typeof VersionBumpChangeRecordSchema>;

/** Reviewed membership is immutable; progress belongs to the same fenced operation. */
export const LegacyLifecycleVersionChangeSchema = z.strictObject({
  changeId: z.string().uuid(), actorId: z.string().min(1), reviewedAt: z.string().datetime(),
  change: VersionBumpChangeRecordSchema,
  scope: z.discriminatedUnion("kind", [
    z.strictObject({kind:z.literal("workflows"),workflowIds:z.array(z.string().min(1)).min(1)}),
    z.strictObject({kind:z.literal("application"),applicationVersion:z.string().regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u)}),
  ]),
  targetVersion:z.string().regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u),
  targets: z.array(z.strictObject({ workflow: z.string().min(1), version: z.number().int().positive(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/u) })).min(1),
  members: z.array(z.strictObject({ runId: z.string().uuid(), version: z.number().int().positive(), sourceDigest: z.string().regex(/^[a-f0-9]{64}$/u) })),
  membershipDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  state: z.enum(["reviewed", "applying", "applied"]),
  completedRunIds: z.array(z.string().uuid()),
}).superRefine((change, context) => {
  const targetIds=change.targets.map(target=>target.workflow);
  if(new Set(targetIds).size!==targetIds.length || (change.scope.kind === "workflows"
    && (new Set(change.scope.workflowIds).size !== change.scope.workflowIds.length || change.scope.workflowIds.length!==targetIds.length
      || change.scope.workflowIds.some(id=>!targetIds.includes(id))))) context.addIssue({code:"custom",message:"version-change-scope-mismatch"});
  const ids = new Set(change.members.map((member) => member.runId));
  if (sha256Hex(canonicalJsonStringify(change.members)) !== change.membershipDigest) context.addIssue({code:"custom",message:"version-change-membership-digest-mismatch"});
  if (ids.size !== change.members.length || new Set(change.completedRunIds).size !== change.completedRunIds.length
    || change.completedRunIds.some((id) => !ids.has(id)) || (change.state === "reviewed" && change.completedRunIds.length !== 0)
    || (change.state === "applied" && change.completedRunIds.length !== ids.size)) {
    context.addIssue({ code: "custom", message: "version-change-membership-invalid" });
  }
});

const ApplicationVersionSchema=z.string().regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u);
const IdentitySchema=z.strictObject({workflow:z.string().min(1),version:z.number().int().positive(),fingerprint:z.string().regex(/^[a-f0-9]{64}$/u)});
export const VersionChangeReviewSchema=z.strictObject({
  changeId:z.string().uuid(),actorId:z.string().min(1),reviewedAt:z.string().datetime(),
  change:VersionBumpChangeRecordSchema,
  scope:z.discriminatedUnion("kind",[
    z.strictObject({kind:z.literal("workflows"),workflowIds:z.array(z.string().min(1)).min(1)}),
    z.strictObject({kind:z.literal("application"),applicationVersion:ApplicationVersionSchema}),
  ]),
  observedAppVersion:ApplicationVersionSchema,targetVersion:ApplicationVersionSchema,targets:z.array(IdentitySchema),
  members:z.array(z.strictObject({runId:z.string().uuid(),version:z.number().int().positive(),sourceDigest:z.string().regex(/^[a-f0-9]{64}$/u)})),
  blockers:z.array(z.string().uuid()),membershipDigest:z.string().regex(/^[a-f0-9]{64}$/u),
  supersedes:z.string().uuid().optional(),
});
export type VersionChangeReview=z.infer<typeof VersionChangeReviewSchema>;
export function versionChangeReviewFingerprint(input:VersionChangeReview) {
  return sha256Hex(canonicalJsonStringify(VersionChangeReviewSchema.parse(input)));
}
export const VersionChangeSchema=VersionChangeReviewSchema.extend({
  schemaVersion:z.literal(2),reviewFingerprint:z.string().regex(/^[a-f0-9]{64}$/u),
  state:z.enum(["planned","applying","applied","superseded"]),completedRunIds:z.array(z.string().uuid()),
  supersededBy:z.string().uuid().optional(),
  // Private temporary captures; the archive header and dashboard projections omit them.
  pendingCaptures:z.array(z.strictObject({runId:z.string().uuid(),reportJson:z.string().min(1)})).optional(),
  application:z.strictObject({commandId:z.string().uuid(),actorId:z.string().min(1),startedAt:z.string().datetime(),
    requestFingerprint:z.string().regex(/^[a-f0-9]{64}$/u).optional(),
    appVersion:ApplicationVersionSchema,targets:z.array(IdentitySchema),completedAt:z.string().datetime().optional()}).optional(),
}).superRefine((row,ctx)=>{
  const review=VersionChangeReviewSchema.parse(Object.fromEntries(Object.entries(row).filter(([key])=>key in VersionChangeReviewSchema.shape)));
  const ids=row.members.map(member=>member.runId),targets=row.targets.map(target=>target.workflow);
  const pendingIds=row.pendingCaptures?.map(capture=>capture.runId);
  const invalid=(pendingIds!==undefined && (row.state!=="applying" || new Set(pendingIds).size!==pendingIds.length
      || pendingIds.some(id=>!ids.includes(id) || row.completedRunIds.includes(id))
      || ids.some(id=>!row.completedRunIds.includes(id) && !pendingIds.includes(id))))
    || row.reviewFingerprint!==versionChangeReviewFingerprint(review)
    || row.membershipDigest!==sha256Hex(canonicalJsonStringify(row.members))
    || new Set(row.blockers).size!==row.blockers.length || row.blockers.some(id=>ids.includes(id))
    || (row.scope.kind==="application" && row.scope.applicationVersion!==row.observedAppVersion)
    || new Set(ids).size!==ids.length || new Set(targets).size!==targets.length
    || new Set(row.completedRunIds).size!==row.completedRunIds.length || row.completedRunIds.some(id=>!ids.includes(id))
    || (row.scope.kind==="workflows" && (new Set(row.scope.workflowIds).size!==row.scope.workflowIds.length || targets.length!==row.scope.workflowIds.length || row.scope.workflowIds.some(id=>!targets.includes(id))))
    || (row.change.kind==="minor" && (row.members.length>0 || row.blockers.length>0))
    || ((row.state==="planned"||row.state==="superseded") && (row.application!==undefined || row.completedRunIds.length>0))
    || ((row.state==="applying"||row.state==="applied") && (row.application===undefined || row.blockers.length>0))
    || (row.state==="applied" && (row.completedRunIds.length!==ids.length || row.application?.completedAt===undefined))
    || (row.state!=="applied" && row.application?.completedAt!==undefined)
    || ((row.state==="superseded") !== (row.supersededBy!==undefined));
  if(invalid)ctx.addIssue({code:"custom",message:"version-change-contract-invalid"});
});
export type VersionChange=z.infer<typeof VersionChangeSchema>;
export const VersionChangeStorageSchema=z.union([VersionChangeSchema,LegacyLifecycleVersionChangeSchema]);
export function versionChangeReview(row:VersionChange):VersionChangeReview {
  return VersionChangeReviewSchema.parse(Object.fromEntries(Object.entries(row).filter(([key])=>key in VersionChangeReviewSchema.shape)));
}
export const ArchiveVersionChangeSchema=z.strictObject({review:VersionChangeReviewSchema,reviewFingerprint:z.string().regex(/^[a-f0-9]{64}$/u),
  application:z.strictObject({commandId:z.string().uuid(),actorId:z.string().min(1),startedAt:z.string().datetime(),
    requestFingerprint:z.string().regex(/^[a-f0-9]{64}$/u).optional(),appVersion:ApplicationVersionSchema,targets:z.array(IdentitySchema)})})
  .refine(value=>value.reviewFingerprint===versionChangeReviewFingerprint(value.review),"archive-change-review-mismatch");
export function archiveVersionChange(row:VersionChange) {
  if(row.application===undefined)throw new Error("version-change-not-claimed");
  const {completedAt,...application}=row.application;void completedAt;
  return ArchiveVersionChangeSchema.parse({review:versionChangeReview(row),reviewFingerprint:row.reviewFingerprint,application});
}
