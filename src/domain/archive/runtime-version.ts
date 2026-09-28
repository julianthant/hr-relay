import { z } from "zod";

import { WorkflowIdSchema } from "../ids.js";

/** Operator-managed release identity, separate from build and descriptor versions. */
export const RuntimeVersionSchema = z.strictObject({
  major: z.number().int().positive(),
  minor: z.number().int().nonnegative(),
});
export type RuntimeVersion = z.infer<typeof RuntimeVersionSchema>;

export const RunRuntimeVersionStampSchema = z.strictObject({
  dashboard: RuntimeVersionSchema,
  workflow: RuntimeVersionSchema,
});

export const INITIAL_RUNTIME_VERSION: RuntimeVersion = Object.freeze({ major: 1, minor: 0 });

export function formatRuntimeVersion(input: RuntimeVersion): string {
  const version = RuntimeVersionSchema.parse(input);
  return `${version.major}.${version.minor}`;
}

export const RuntimeVersionStateSchema = z.strictObject({
  dashboard: RuntimeVersionSchema,
  workflows: z.array(z.strictObject({ workflowId: WorkflowIdSchema, version: RuntimeVersionSchema })),
}).superRefine((state, context) => {
  const ids = state.workflows.map(({ workflowId }) => workflowId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", message: "runtime-version-workflow-duplicate" });
  }
  for (const workflow of state.workflows) {
    if (workflow.version.major !== state.dashboard.major) {
      context.addIssue({ code: "custom", message: "runtime-version-major-mismatch" });
    }
  }
});
export type RuntimeVersionState = z.infer<typeof RuntimeVersionStateSchema>;

export const RuntimeVersionScopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("workflows"), workflowIds: z.array(WorkflowIdSchema).min(1) }),
  z.strictObject({ kind: z.literal("dashboard") }),
]);
export type RuntimeVersionScope = z.infer<typeof RuntimeVersionScopeSchema>;

function sameRuntimeVersion(left: RuntimeVersion, right: RuntimeVersion): boolean {
  return left.major === right.major && left.minor === right.minor;
}

/** A fully validated transition, including the exact before/after relation it claims. */
export const RuntimeVersionTransitionSchema = z.strictObject({
  kind: z.enum(["minor", "major"]),
  before: RuntimeVersionStateSchema,
  after: RuntimeVersionStateSchema,
  affectedWorkflowIds: z.array(WorkflowIdSchema).min(1),
}).superRefine((transition, context) => {
  const registered = transition.before.workflows.map(row => row.workflowId);
  const affected = transition.affectedWorkflowIds;
  if (new Set(affected).size !== affected.length || affected.some(id => !registered.includes(id))) {
    context.addIssue({ code: "custom", path: ["affectedWorkflowIds"], message: "runtime-version-transition-affected-workflows-invalid" });
    return;
  }
  if (!affected.every((id, index) => id === [...affected].sort()[index])) {
    context.addIssue({ code: "custom", path: ["affectedWorkflowIds"], message: "runtime-version-transition-affected-workflows-unsorted" });
  }
  const all = affected.length === registered.length;
  if ((transition.kind === "major") !== all) {
    context.addIssue({ code: "custom", path: ["kind"], message: "runtime-version-transition-scope-kind-mismatch" });
  }
  const nextMajor = transition.before.dashboard.major + (all ? 1 : 0);
  const expectedDashboard = all ? { major: nextMajor, minor: 0 } : transition.before.dashboard;
  if (!sameRuntimeVersion(transition.after.dashboard, expectedDashboard)) {
    context.addIssue({ code: "custom", path: ["after", "dashboard"], message: "runtime-version-transition-dashboard-mismatch" });
  }
  const afterByWorkflow = new Map(transition.after.workflows.map(row => [row.workflowId, row.version]));
  for (const beforeWorkflow of transition.before.workflows) {
    const after = afterByWorkflow.get(beforeWorkflow.workflowId);
    if (after === undefined) {
      context.addIssue({ code: "custom", path: ["after", "workflows"], message: "runtime-version-transition-workflow-missing" });
      continue;
    }
    const selected = affected.includes(beforeWorkflow.workflowId);
    const expected = all ? expectedDashboard : selected
      ? { major: beforeWorkflow.version.major, minor: beforeWorkflow.version.minor + 1 }
      : beforeWorkflow.version;
    if (!sameRuntimeVersion(after, expected)) {
      context.addIssue({ code: "custom", path: ["after", "workflows"], message: "runtime-version-transition-workflow-mismatch" });
    }
  }
});
export type RuntimeVersionTransition = z.infer<typeof RuntimeVersionTransitionSchema>;

/** A selection covering every workflow is the dashboard action. */
export function planRuntimeVersionTransition(
  stateInput: z.input<typeof RuntimeVersionStateSchema>,
  scopeInput: z.input<typeof RuntimeVersionScopeSchema>,
): RuntimeVersionTransition {
  const state = RuntimeVersionStateSchema.parse(stateInput);
  const scope = RuntimeVersionScopeSchema.parse(scopeInput);
  const registered = state.workflows.map(({ workflowId }) => workflowId);
  if (registered.length === 0) throw new Error("runtime-version-no-workflows");
  const selected = scope.kind === "dashboard" ? registered : scope.workflowIds;
  if (new Set(selected).size !== selected.length || selected.some(id => !registered.includes(id))) {
    throw new Error("runtime-version-invalid-selection");
  }
  const all = selected.length === registered.length;
  if (scope.kind === "workflows" && all) {
    throw new Error("runtime-version-all-workflows-requires-dashboard-scope");
  }
  const affectedWorkflowIds = Object.freeze([...selected].sort());
  const affected = new Set(selected);
  const nextMajor = state.dashboard.major + (all ? 1 : 0);
  if (!Number.isSafeInteger(nextMajor)) throw new Error("runtime-version-overflow");
  const after = RuntimeVersionStateSchema.parse({
    dashboard: all ? { major: nextMajor, minor: 0 } : state.dashboard,
    workflows: state.workflows.map(({ workflowId, version }) => {
      if (!affected.has(workflowId)) return { workflowId, version };
      const nextMinor = version.minor + 1;
      if (!all && !Number.isSafeInteger(nextMinor)) throw new Error("runtime-version-overflow");
      return { workflowId, version: all ? { major: nextMajor, minor: 0 } : { major: version.major, minor: nextMinor } };
    }),
  });
  return RuntimeVersionTransitionSchema.parse({ kind: all ? "major" : "minor", before: state, after, affectedWorkflowIds });
}
