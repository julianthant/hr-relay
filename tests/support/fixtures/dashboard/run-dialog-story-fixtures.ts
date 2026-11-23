/** Run dialog fixtures for the state gallery: the served workflows, a client that answers what a story scripts, and the answers themselves. Browser-safe. */
import type { DashboardClient } from "../../../../src/dashboard/client/index.js";
import { START_DOOR_ABSENCE } from "../../../../src/dashboard/surfaces/run-start/run-start-model.js";
import type { RunStartWorkflow } from "../../../../src/dashboard/surfaces/run-start/run-start.js";
import { parseWorkflows } from "../../../../src/dashboard/surfaces/shell/shell-model.js";
import { buildWorkflowCatalog } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { RerunValuesRequestSchema, RerunValuesResponseSchema, type RerunValuesResponse } from "../../../../src/models/dashboard/rerun-values.js";
import { RerunWarningWireSchema, type RerunWarningWire } from "../../../../src/models/dashboard/rerun-warning.js";
import { StartPlanWireSchema, type StartPlanWire } from "../../../../src/models/dashboard/start-plan.js";
import type { PreflightReadinessWire } from "../../../../src/models/preflight/preflight-contract.js";
import { CommandResultSchema, type CommandResult } from "../../../../src/rules/commands/commands.js";
import intakeSnapshot from "./run-dialog-intake-sessions.json" with { type: "json" };
import { IntakeSessionWireSchema, type IntakeSessionWire } from "../../../../src/models/intake/wire.js";
import bootstrapSnapshot from "./run-dialog-bootstrap.json" with { type: "json" };

/** The served bootstrap of the one registered workflow, saved so the gallery page stays free of backend modules; run-dialog-bootstrap.integration.test.ts keeps it current. */
const FIXTURE_BOOTSTRAP: { readonly workflows: readonly unknown[]; readonly workbookCompatibility: { readonly workflows: readonly { readonly workflowId: string; readonly sources: RunStartWorkflow["referenceSources"] }[] } } = bootstrapSnapshot;
const RUN_ID = "10000000-0000-4000-8000-000000000001";
export const RUN_DIALOG_BOOTSTRAP = bootstrapSnapshot;

export const RUN_DIALOG_ACTOR = "local-operator";
export const RUN_DIALOG_WORKFLOW = "person-lookup";
/** An employee number the Person Lookup input accepts. */
export const RUN_DIALOG_TYPED = "10873698";
const HASH = "a".repeat(64);

export const RUN_DIALOG_WORKFLOWS: readonly RunStartWorkflow[] = parseWorkflows(FIXTURE_BOOTSTRAP.workflows).map((entry): RunStartWorkflow => {
  const start = entry.start;
  return {
    workflowId: String(entry.id), label: entry.label, categoryId: entry.categoryId, role: entry.role, icon: entry.icon,
    ...(entry.code === undefined ? {} : { code: entry.code }),
    ...(start.summary === undefined ? {} : { summary: start.summary }),
    enqueue: start.enqueue, version: start.version, steps: start.steps,
    ...(start.rows === undefined ? {} : { rows: start.rows }),
    inputRun: start.inputRun === undefined ? { state: "absent", reason: START_DOOR_ABSENCE["no-typed-input"] } : { state: "present", surface: start.inputRun },
    spreadsheetIntake: start.spreadsheetIntake, requiredWorkbookFields: start.requiredWorkbookFields, workbookReference: start.workbookReference,
    referenceSources: FIXTURE_BOOTSTRAP.workbookCompatibility.workflows.find(workflow => workflow.workflowId === entry.id)?.sources ?? [],
  };
});

export const RUN_DIALOG_CATALOG = buildWorkflowCatalog(RUN_DIALOG_WORKFLOWS,
  Object.freeze(Object.fromEntries(RUN_DIALOG_WORKFLOWS.map(flow => [flow.workflowId, "served" as const]))));

export function runDialogPlan(startPlanId = "5a000000-0000-4000-8000-000000000001"): StartPlanWire {
  return StartPlanWireSchema.parse({
    wireVersion: 1, startPlanId, workflowId: RUN_DIALOG_WORKFLOW, expectedVersion: 4, expiresAt: "2026-08-26T21:47:03.000Z", dryRun: false, priority: "interactive",
    plannedBy: RUN_DIALOG_ACTOR, configSnapshotId: "c0000000-0000-4000-8000-000000000001",
    fingerprints: { descriptorFingerprint: HASH, configFingerprint: HASH, ingressSchemaHash: HASH, canonicalInputSchemaHash: HASH, inputFingerprint: HASH },
    planned: [{ logicalKey: "entry:1", title: "Ada Lovelace", subtitle: "E1234567", matchKey: "eid:E1234567" }], refused: [],
  });
}

export const RUN_DIALOG_APPLIED: CommandResult = CommandResultSchema.parse({ state: "applied", commandId: "3a000000-0000-4000-8000-000000000001",
  affectedTargets: [{ family: "start", workflowId: RUN_DIALOG_WORKFLOW, startPlanId: "5a000000-0000-4000-8000-000000000001", expectedVersion: 4 }] });
export const RUN_DIALOG_CONFLICT: CommandResult = CommandResultSchema.parse({ state: "conflict", commandId: "3a000000-0000-4000-8000-000000000002",
  currentVersion: 7, message: "The start plan was built against version 4." });

export type ServedCheck = Readonly<{ check: string; status: "pass" | "warning" | "fail"; summary?: string }>;
/** One served readiness report: each named check with its verdict; a warned or failed check carries its summary. */
export function runDialogReadiness(checks: readonly ServedCheck[]): PreflightReadinessWire {
  const results = checks.map(({ check, status, summary }) => status === "pass" ? { status, check, summary: summary ?? `${check} is ready` }
    : status === "warning" ? { status, check, summary: summary ?? `${check} needs attention`, impact: "A feature may be unavailable.", remediation: "Review it." }
    : { status, check, summary: summary ?? `${check} is not ready`, blocks: ["dashboard.serve"], remediation: "Fix it." });
  return { state: "present", report: { configFingerprint: HASH, descriptorFingerprint: HASH, checkedAt: "2026-08-26T21:00:00.000Z",
    requestedCapabilities: ["dashboard.serve"], results } } as unknown as PreflightReadinessWire;
}
export const RUN_DIALOG_READY = runDialogReadiness([{ check: "config.valid", status: "pass" }, { check: "secrets.ucpath-sso", status: "pass" }]);

/** A client that serves only what the story scripts and READY readiness; reaching for anything else fails the story loudly. */
export function runDialogClient(served: Partial<DashboardClient> = {}): DashboardClient {
  const methods: Partial<DashboardClient> = { readPreflight: async () => RUN_DIALOG_READY, ...served };
  return new Proxy(methods, { get(target, property): unknown {
    const impl: unknown = Reflect.get(target, property);
    if (impl === undefined && typeof property === "string" && property !== "then") throw new Error(`the Run dialog story reached for client.${property}, which it does not serve`);
    return impl;
  } }) as DashboardClient;
}

/** An answer that never arrives: the story holds the state that waits on it. */
export const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

export const RUN_DIALOG_RERUN_SOURCE = { ...RerunValuesRequestSchema.parse({ runId: RUN_ID, expectedVersion: 3 }), label: "Ada Lovelace" };
const STEPS = ["searching", "cross-verify", "active-status"] as const;

/** What a failed Person Lookup run offers a rerun: the typed input it ran on, each step's state, and one value to copy. */
export function runDialogRerunSnapshot(): RerunValuesResponse {
  return RerunValuesResponseSchema.parse({ state: "available", snapshot: {
    sourceInput: { state: "available", value: { eid: RUN_DIALOG_TYPED } },
    source: { runId: RUN_ID, version: 3, workflow: RUN_DIALOG_WORKFLOW, descriptorVersion: RUN_DIALOG_WORKFLOWS[0]?.version ?? 1, contractFingerprint: HASH, outcome: "failed" },
    steps: STEPS.map((key, index) => ({ key, state: index < 2 ? "completed" : "failed",
      nodes: [{ nodeId: key, state: index < 2 ? "completed" : "failed", reason: index < 2 ? "checkpoint" : "failure" }] })),
    values: [{ state: "available", sourceStepKey: "searching", nodeId: "searching", fieldPath: "eid", label: "Employee ID", targetFieldPath: "eid", value: RUN_DIALOG_TYPED,
      checkpoint: { attempt: 1, writtenAt: "2026-08-26T20:00:00.000Z" },
      provenance: { path: "eid", source: "live", observedAt: "2026-08-26T20:00:00.000Z", originalObservedAt: "2026-08-26T20:00:00.000Z" } }],
    transactions: [],
  } });
}

/** A warning that the source already filed a transaction the rerun would file again. */
export function runDialogRerunWarning(repeats = true): RerunWarningWire {
  return RerunWarningWireSchema.parse({ workflowId: RUN_DIALOG_WORKFLOW, rerun: {
    source: { runId: RUN_ID, expectedVersion: 3, intent: "rerun", selectedStepKeys: [...STEPS] },
    warnings: !repeats ? [] : [{ nodeId: "active-status", taskId: "ucpath/active-status", system: "ucpath", businessKeyDigest: HASH,
      writeIntentId: "20000000-0000-4000-8000-000000000001", evidenceDigest: HASH }],
    warningDigest: HASH,
  } });
}

/** The four intake sessions of the served fixture, saved like the bootstrap; run-dialog-intake.integration.test.ts keeps them current. */
export const RUN_DIALOG_INTAKE = intakeSnapshot as unknown as Readonly<{ ids: Readonly<Record<"mapping" | "validated" | "manifest" | "rerun", string>>; sessions: Readonly<Record<string, unknown>> }>;
export const intakeSession = (key: "mapping" | "validated" | "manifest" | "rerun", change: Record<string, unknown> = {}): IntakeSessionWire =>
  IntakeSessionWireSchema.parse({ ...(RUN_DIALOG_INTAKE.sessions[RUN_DIALOG_INTAKE.ids[key]] as object), ...change });
