import { canonicalJsonStringify } from "../canonical-json.js";
import { sha256Hex } from "../sha256.js";
/**
 * Charter §25's change record for a version bump — its own leaf module.
 *
 * It lives here rather than in `./model.ts` because BOTH the archive model and
 * `src/domain/commands.ts` need it, and the model already imports the command
 * vocabulary (`SemverSchema`, `VersionScopeSchema`). A shared leaf that value-
 * imports nothing but zod is the only shape that does not put a cycle between
 * them.
 */
import { z } from "zod";

/**
 * Charter §25's change record, as a value (ref dashboard-surfaces §10.2: "the scope of a bump
 * is declared by whoever makes the change … and recorded in that update's
 * change record — same store as fix records: what, why, version, commit").
 *
 * Every sweep on the Archive could say WHO applied it and WHEN, and nothing
 * about WHY. Six months later that is the only question anyone asks of a bump,
 * and it is the one an archive is FOR — so it is authored at plan time,
 * carried into the application verbatim, and covered by the plan fingerprint
 * the operator's apply cites back.
 *
 * `commit` is an explicit absence union rather than a required string. A
 * workflow bump usually has a commit and an application bump often does not
 * (the operator shipped a build, not a change), and demanding a hash would
 * mean a fabricated one on the record that exists to be trustworthy.
 */
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
export const VersionChangeSchema = z.strictObject({
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
export type VersionChange = z.infer<typeof VersionChangeSchema>;
