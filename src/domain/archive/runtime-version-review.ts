import { z } from "zod";

import { canonicalJsonStringify } from "../canonical-json.js";
import { FingerprintSchema, WorkflowIdSchema } from "../ids.js";
import { sha256Hex } from "../sha256.js";
import type { RunRecord } from "../run/record.js";
import { RunRuntimeVersionStampSchema, RuntimeVersionStateSchema, type RuntimeVersionTransition } from "./runtime-version.js";

export const RuntimeVersionMemberSchema = z.strictObject({
  runId: z.string().uuid(),
  workflowId: WorkflowIdSchema,
  recordVersion: z.number().int().positive(),
  attribution: z.enum(["stamped", "adopted"]),
  state: z.string().min(1),
});
export type RuntimeVersionMember = z.infer<typeof RuntimeVersionMemberSchema>;

/** The exact review partition the authority will later claim. */
export const RuntimeVersionReviewSchema = z.strictObject({
  members: z.array(RuntimeVersionMemberSchema).readonly(),
  candidates: z.array(RuntimeVersionMemberSchema).readonly(),
  blockers: z.array(RuntimeVersionMemberSchema).readonly(),
  membershipDigest: FingerprintSchema,
}).superRefine((review, context) => {
  const members = review.members;
  const ids = members.map(member => member.runId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["members"], message: "runtime-version-review-members-duplicate" });
  }
  const expectedCandidates = members.filter(member => member.state === "terminal");
  const expectedBlockers = members.filter(member => member.state !== "terminal");
  if (canonicalJsonStringify(review.candidates) !== canonicalJsonStringify(expectedCandidates)) {
    context.addIssue({ code: "custom", path: ["candidates"], message: "runtime-version-review-candidates-mismatch" });
  }
  if (canonicalJsonStringify(review.blockers) !== canonicalJsonStringify(expectedBlockers)) {
    context.addIssue({ code: "custom", path: ["blockers"], message: "runtime-version-review-blockers-mismatch" });
  }
  if (review.membershipDigest !== sha256Hex(canonicalJsonStringify(members))) {
    context.addIssue({ code: "custom", path: ["membershipDigest"], message: "runtime-version-review-membership-digest-mismatch" });
  }
}).readonly();
export type RuntimeVersionReview = z.infer<typeof RuntimeVersionReviewSchema>;

/** Calculate membership from one authority snapshot before showing or claiming a bump. */
export function reviewRuntimeVersionTransition(input: Readonly<{
  transition: RuntimeVersionTransition;
  runs: readonly RunRecord[];
  adoption: (runId: string) => Readonly<{ workflowId: string; dashboard: { major: number; minor: number }; workflow: { major: number; minor: number } }> | undefined;
}>): RuntimeVersionReview {
  const before = RuntimeVersionStateSchema.parse(input.transition.before);
  const selected = new Set(input.transition.affectedWorkflowIds);
  const members: RuntimeVersionMember[] = [];
  const runIds = new Set<string>();
  for (const run of input.runs) {
    if (!selected.has(run.envelope.workflow)) throw new Error("runtime-version-review-out-of-scope");
    if (runIds.has(run.envelope.runId)) throw new Error("runtime-version-review-duplicate-run");
    runIds.add(run.envelope.runId);
    const expected = before.workflows.find(row => row.workflowId === run.envelope.workflow);
    if (expected === undefined) throw new Error("runtime-version-review-workflow-missing");
    const adopted = input.adoption(run.envelope.runId);
    if (run.runtimeVersion !== undefined && adopted !== undefined) throw new Error("runtime-version-attribution-conflict");
    if (adopted !== undefined && adopted.workflowId !== run.envelope.workflow) throw new Error("runtime-version-adoption-workflow-mismatch");
    const stamp = RunRuntimeVersionStampSchema.parse(run.runtimeVersion ?? (adopted === undefined ? undefined : {
      dashboard: adopted.dashboard, workflow: adopted.workflow,
    }));
    if (canonicalJsonStringify(stamp.dashboard) !== canonicalJsonStringify(before.dashboard)
      || canonicalJsonStringify(stamp.workflow) !== canonicalJsonStringify(expected.version)) {
      throw new Error("runtime-version-review-stale-run");
    }
    members.push(RuntimeVersionMemberSchema.parse({
      runId: run.envelope.runId,
      workflowId: run.envelope.workflow,
      recordVersion: run.version,
      attribution: adopted === undefined ? "stamped" : "adopted",
      state: run.lifecycle.state,
    }));
  }
  members.sort((left, right) => left.workflowId.localeCompare(right.workflowId) || left.runId.localeCompare(right.runId));
  const candidates = members.filter(row => row.state === "terminal");
  const blockers = members.filter(row => row.state !== "terminal");
  return RuntimeVersionReviewSchema.parse({ members, candidates, blockers, membershipDigest: sha256Hex(canonicalJsonStringify(members)) });
}
