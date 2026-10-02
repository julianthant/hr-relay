import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";

import { canonicalJsonStringify } from "../../../domain/canonical-json.js";
import { RunIdSchema, WorkflowIdSchema } from "../../../domain/ids.js";
import {
  INITIAL_RUNTIME_VERSION,
  planRuntimeVersionTransition,
  RuntimeVersionSchema,
  RuntimeVersionStateSchema,
  type RuntimeVersionState,
} from "../../../domain/archive/runtime-version.js";

export const RUNTIME_VERSION_SCHEMA_VERSION = 55;

export const RUNTIME_VERSIONS_DDL = `CREATE TABLE runtime_versions (
  record_key TEXT PRIMARY KEY CHECK(record_key='current'),
  record_json TEXT NOT NULL CHECK(json_valid(record_json)),
  updated_at TEXT NOT NULL
) STRICT`;

export const RUNTIME_VERSION_ADOPTIONS_DDL = `CREATE TABLE runtime_version_adoptions (
  record_key TEXT PRIMARY KEY,
  record_json TEXT NOT NULL CHECK(json_valid(record_json)),
  created_at TEXT NOT NULL
) STRICT`;

export const RUNTIME_VERSION_CHANGES_DDL = `CREATE TABLE runtime_version_changes (
  record_key TEXT PRIMARY KEY,
  record_json TEXT NOT NULL CHECK(json_valid(record_json)),
  created_at TEXT NOT NULL
) STRICT`;

export const RuntimeVersionAdoptionSchema = z.strictObject({
  runId: RunIdSchema,
  workflowId: WorkflowIdSchema,
  dashboard: RuntimeVersionSchema,
  workflow: RuntimeVersionSchema,
});

export const RuntimeVersionAuthoritySchema = z.strictObject({
  revision: z.number().int().positive(),
  state: RuntimeVersionStateSchema,
  claim: z.strictObject({
    changeId: z.string().uuid(),
    workflowIds: z.array(WorkflowIdSchema).min(1),
    after: RuntimeVersionStateSchema,
  }).optional(),
}).superRefine((row, context) => {
  if (row.claim !== undefined) {
    const known = new Set(row.state.workflows.map(({ workflowId }) => workflowId));
    const selected = row.claim.workflowIds;
    if (new Set(selected).size !== selected.length || selected.some(id => !known.has(id))) {
      context.addIssue({ code: "custom", message: "runtime-version-claim-scope-invalid" });
    }
    const next = row.claim.after;
    if (next.workflows.length !== row.state.workflows.length
      || next.workflows.some(({ workflowId }) => !known.has(workflowId))) {
      context.addIssue({ code: "custom", message: "runtime-version-claim-registry-changed" });
    }
  }
});
export type RuntimeVersionAuthority = z.infer<typeof RuntimeVersionAuthoritySchema>;

const CurrentRowSchema = z.strictObject({ record_json: z.string() });

export function readRuntimeVersionAuthority(database: DatabaseSync): RuntimeVersionAuthority {
  const raw = database.prepare("SELECT record_json FROM runtime_versions WHERE record_key='current'").get();
  if (raw === undefined) throw new Error("runtime-version-state-missing");
  return RuntimeVersionAuthoritySchema.parse(JSON.parse(CurrentRowSchema.parse(raw).record_json));
}

function writeRuntimeVersionAuthority(database: DatabaseSync, current: RuntimeVersionAuthority, next: RuntimeVersionAuthority, now: string): void {
  const updated = database.prepare("UPDATE runtime_versions SET record_json=?,updated_at=? WHERE record_key='current' AND record_json=?")
    .run(canonicalJsonStringify(next), now, canonicalJsonStringify(current));
  if (updated.changes !== 1) throw new Error("runtime-version-state-conflict");
}

/** Descriptor registration is explicit and never removes a known workflow. */
export function registerRuntimeVersionWorkflows(database: DatabaseSync, workflowIdsInput: readonly string[], now: string): RuntimeVersionAuthority {
  const current = readRuntimeVersionAuthority(database);
  const workflowIds = workflowIdsInput.map(id => WorkflowIdSchema.parse(id));
  if (new Set(workflowIds).size !== workflowIds.length) throw new Error("runtime-version-registry-duplicate");
  if (current.claim !== undefined) throw new Error("runtime-version-claim-active");
  const known = new Set(current.state.workflows.map(({ workflowId }) => workflowId));
  const additions = workflowIds.filter(id => !known.has(id)).sort();
  if (additions.length === 0) return current;
  const state = RuntimeVersionStateSchema.parse({
    dashboard: current.state.dashboard,
    workflows: [
      ...current.state.workflows,
      ...additions.map(workflowId => ({ workflowId, version: { major: current.state.dashboard.major, minor: 0 } })),
    ],
  });
  const next = RuntimeVersionAuthoritySchema.parse({ revision: current.revision + 1, state });
  writeRuntimeVersionAuthority(database, current, next, now);
  return next;
}

export function claimRuntimeVersionTransition(database: DatabaseSync, input: {
  readonly changeId: string;
  readonly expectedRevision: number;
  readonly workflowIds: readonly string[];
  readonly after: RuntimeVersionState;
  readonly now: string;
}): RuntimeVersionAuthority {
  const current = readRuntimeVersionAuthority(database);
  if (current.revision !== input.expectedRevision) throw new Error("runtime-version-review-stale");
  if (current.claim !== undefined) throw new Error("runtime-version-claim-active");
  const all = input.workflowIds.length === current.state.workflows.length;
  const planned = planRuntimeVersionTransition(current.state, all
    ? { kind: "dashboard" }
    : { kind: "workflows", workflowIds: [...input.workflowIds] });
  if (canonicalJsonStringify(planned.affectedWorkflowIds) !== canonicalJsonStringify([...input.workflowIds].sort())
    || canonicalJsonStringify(planned.after) !== canonicalJsonStringify(input.after)) {
    throw new Error("runtime-version-claim-divergent");
  }
  const next = RuntimeVersionAuthoritySchema.parse({ ...current, revision: current.revision + 1,
    claim: { changeId: input.changeId, workflowIds: [...input.workflowIds], after: input.after } });
  writeRuntimeVersionAuthority(database, current, next, input.now);
  return next;
}

export function publishRuntimeVersionTransition(database: DatabaseSync, input: {
  readonly changeId: string;
  readonly expectedRevision: number;
  readonly next: RuntimeVersionState;
  readonly now: string;
}): RuntimeVersionAuthority {
  const current = readRuntimeVersionAuthority(database);
  if (current.revision !== input.expectedRevision || current.claim?.changeId !== input.changeId) {
    throw new Error("runtime-version-claim-mismatch");
  }
  const nextState = RuntimeVersionStateSchema.parse(input.next);
  if (canonicalJsonStringify(current.claim.after) !== canonicalJsonStringify(nextState)) {
    throw new Error("runtime-version-publication-divergent");
  }
  for (const workflowId of current.claim.workflowIds) {
    if (database.prepare("SELECT record_key FROM workflow_runs WHERE workflow=? LIMIT 1").get(workflowId) !== undefined) {
      throw new Error("runtime-version-transfer-incomplete");
    }
  }
  if (current.state.workflows.length !== nextState.workflows.length
    || current.state.workflows.some(({ workflowId }) => !nextState.workflows.some(row => row.workflowId === workflowId))) {
    throw new Error("runtime-version-registry-changed");
  }
  const next = RuntimeVersionAuthoritySchema.parse({ revision: current.revision + 1, state: nextState });
  writeRuntimeVersionAuthority(database, current, next, input.now);
  return next;
}

export function runtimeVersionForNewRun(authority: RuntimeVersionAuthority, workflowIdInput: string) {
  const workflowId = WorkflowIdSchema.parse(workflowIdInput);
  if (authority.claim?.workflowIds.includes(workflowId)) throw new Error("runtime-version-workflow-claimed");
  const workflow = authority.state.workflows.find(row => row.workflowId === workflowId);
  if (workflow === undefined) throw new Error("runtime-version-workflow-unregistered");
  return { dashboard: authority.state.dashboard, workflow: workflow.version };
}

export const INITIAL_RUNTIME_VERSION_AUTHORITY: RuntimeVersionAuthority = RuntimeVersionAuthoritySchema.parse({
  revision: 1,
  state: { dashboard: INITIAL_RUNTIME_VERSION, workflows: [] },
});
