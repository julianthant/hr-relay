import { useViewNavigation, useViewState } from "../../app/navigation/view-route-model.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StartCommandRequestSchema, CommandIdentityConflictError, type CommandRequest, type BulkRunCommandOutcome, type CommandResult } from "../../../rules/commands/commands.js";
import type { DashboardCommandBinding } from "../../app/dashboard-app-model.js";
import type { CommandOutcome, CommandReadbackVerification } from "../../app/commands/command-executor.js";
import { canonicalJsonStringify, type JsonValue } from "../../../rules/validation/canonical-json.js";
import { RerunValuesSnapshotSchema, type RerunValuesSnapshot } from "../../../models/dashboard/rerun-values.js";
import { StartPlanRequestSchema, StartPlanWireSchema, type StartPlanRequest } from "../../../models/dashboard/start-plan.js";
import { ITEM_ATTEMPT_HISTORY_MAX_LIMIT, type ItemAttemptHistoryRun } from "../../../models/dashboard/item-attempt-history.js";
import type { QueueSurfaceWire } from "../../../models/dashboard/projection.js";
import type { DashboardClient } from "../../client/index.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../models/failures/error-catalog.js";
import type { LaunchVerificationPlan } from "./run-launch-recovery.js";
import { START_DOOR_ABSENCE } from "./run-start-model.js";
import type { RunStartWorkflow } from "./run-start.js";
import type { WorkflowBootstrapPrimitive } from "../shell/shell-model.js";
import { RUN_START_DOOR_ID, restoreDashboardTakeoverFocus } from "../../app/dashboard-app-model.js";
import type { RerunValuesRequestSchema } from "../../../models/dashboard/rerun-values.js";
import type { z } from "zod";
export type RerunLaunchSource = z.infer<typeof RerunValuesRequestSchema> & { readonly label?: string; readonly traceId?: string };

/** The host owns focus transfer, independently of date/history and Settings state. */
export function useRunLaunch(initialOpen: boolean, mainRegionId: string) {
  const navigation = useViewNavigation();
  const [localOpen, setLocalOpen] = useState(initialOpen);
  const open = navigation?.start ?? localOpen;
  const routeSetStart = navigation?.setStart;
  const setOpen = useCallback((next: boolean) => routeSetStart ? routeSetStart(next) : setLocalOpen(next), [routeSetStart]);
  const [routedRerunSource, setRerunSource] = useViewState("launchRerun", undefined);
  // Route updates re-parse the whole view, so keep the source's identity while its value is unchanged.
  const rerunKey = routedRerunSource === undefined ? undefined : JSON.stringify(routedRerunSource);
  const rerunSource = useMemo(() => rerunKey === undefined ? undefined : JSON.parse(rerunKey) as RerunLaunchSource, [rerunKey]);
  const launcher = useRef<HTMLElement | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const intakeHandoff = useRef(false);
  const rememberLauncher = useCallback(() => {
    intakeHandoff.current = false;
    launcher.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, []);
  const openStart = useCallback(() => { intakeHandoff.current = false; launcher.current = null; setRerunSource(undefined); setOpen(true); }, [setOpen, setRerunSource]);
  const openRerun = useCallback((source: RerunLaunchSource) => {
    rememberLauncher();
    setRerunSource(source); setOpen(true);
  }, [rememberLauncher, setOpen, setRerunSource]);
  const closeFocus = useCallback((event: Event) => {
    event.preventDefault();
    if (mounted.current && !intakeHandoff.current) {
      if (launcher.current?.isConnected) launcher.current.focus();
      else restoreDashboardTakeoverFocus(document, RUN_START_DOOR_ID, mainRegionId);
    }
  }, [mainRegionId]);
  const handOffToIntake = useCallback(() => { intakeHandoff.current = true; }, []);
  return { open, setOpen, openStart, openRerun, rerunSource, closeFocus, handOffToIntake, rememberLauncher };
}

export function launchWorkflows(workflows: readonly WorkflowBootstrapPrimitive[]): readonly RunStartWorkflow[] {
  return workflows.map((entry) => ({ workflowId: String(entry.id), label: entry.label, categoryId: entry.categoryId,
    role: entry.role, code: entry.code, ...(entry.start.summary === undefined ? {} : { summary: entry.start.summary }),
    enqueue: entry.start.enqueue, version: entry.start.version, steps: entry.start.steps,
    spreadsheetIntake: entry.start.spreadsheetIntake,
    inputRun: entry.start.inputRun === undefined ? { state: "absent", reason: START_DOOR_ABSENCE["no-typed-input"] }
      : { state: "present", surface: entry.start.inputRun } }));
}

/** Copy only explicitly selected, available producer values; never checkpoint execution. */
export function prefillRerun(input: RerunValuesSnapshot, options: Readonly<{
  selectedValueIndexes: readonly number[]; selectedStepKeys: readonly string[];
  dryRun: boolean; browserMode: "headless" | "headed"; captureBrowserScreenshots: boolean;
}>): StartPlanRequest {
  const snapshot = RerunValuesSnapshotSchema.parse(input);
  const submission: Record<string, JsonValue> = {};
  const omissionFacts: Record<string, Record<string, JsonValue>> = {};
  const copiedFrom = [];
  for (const index of options.selectedValueIndexes) {
    const candidate = snapshot.values[index];
    if (candidate?.state !== "available") throw new Error("RERUN_PREFILL_VALUE_UNAVAILABLE");
    const keys = candidate.targetFieldPath.split(".");
    let target = candidate.targetStepKey === undefined ? submission
      : (omissionFacts[candidate.targetStepKey] ??= {});
    for (const [position, key] of keys.entries()) {
      if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("RERUN_PREFILL_PATH_INVALID");
      if (position === keys.length - 1) {
        if (Object.hasOwn(target, key)) throw new Error("RERUN_PREFILL_PATH_CONFLICT");
        target[key] = structuredClone(candidate.value);
      } else {
        if (!Object.hasOwn(target, key)) target[key] = {};
        const child = target[key];
        if (child === null || Array.isArray(child) || typeof child !== "object") throw new Error("RERUN_PREFILL_PATH_CONFLICT");
        target = child as Record<string, JsonValue>;
      }
    }
    copiedFrom.push({ nodeId: candidate.nodeId, fieldPath: candidate.fieldPath, targetFieldPath: candidate.targetFieldPath,
      ...(candidate.targetStepKey === undefined ? {} : { targetStepKey: candidate.targetStepKey }) });
  }
  if (new Set(options.selectedStepKeys).size !== options.selectedStepKeys.length
    || options.selectedStepKeys.some((key) => !snapshot.steps.some((step) => step.key === key))) throw new Error("RERUN_PREFILL_STEP_INVALID");
  return StartPlanRequestSchema.parse({ workflowId: snapshot.source.workflow, submissions: [submission],
    dryRun: options.dryRun, browserMode: options.browserMode, captureBrowserScreenshots: options.captureBrowserScreenshots,
    selectedStepKeys: options.selectedStepKeys, rerunSource: { runId: snapshot.source.runId,
      expectedVersion: snapshot.source.version, intent: "rerun", selectedStepKeys: options.selectedStepKeys, copiedFrom },
    ...(Object.keys(omissionFacts).length === 0 ? {} : { stepOmissions: Object.entries(omissionFacts).map(([step, facts]) => ({ step, facts })) }) });
}

function launchPlanIdentityMismatch(): Error {
  const failure = formatErrorCatalogFailure(createErrorCatalogFailure("BOUNDARY_VALIDATION_FAILED", { source: "http-response" }));
  return Object.assign(new Error(failure.text), failure, { name: "RUN_LAUNCH_PLAN_IDENTITY_MISMATCH" });
}

/** Shared launch door; confirmation/replay send the same immutable envelope. */
export function createRunLaunchService(client: Pick<DashboardClient, "rerunValues" | "previewRerunWarnings" | "submitStartPlan" | "dashboardDay" | "itemAttemptHistory">, actorId: string,
  identity?: { uuid(): string; now(): string }) {
  const preview = async (input: unknown) => {
    const request = StartPlanRequestSchema.parse(input);
    const plan = StartPlanWireSchema.parse(await client.submitStartPlan(request));
    if (plan.workflowId !== request.workflowId || plan.plannedBy !== actorId || plan.dryRun !== request.dryRun
      || (plan.browserMode !== undefined && plan.browserMode !== request.browserMode)
      || (plan.captureBrowserScreenshots !== undefined && plan.captureBrowserScreenshots !== request.captureBrowserScreenshots)
      || plan.priority !== (request.priority ?? "interactive")
      || canonicalJsonStringify(plan.rerun?.source ?? null) !== canonicalJsonStringify(request.rerunSource ?? null)
      || (request.warningAcknowledgment !== undefined && plan.rerun?.acknowledgment !== request.warningAcknowledgment)) {
      throw launchPlanIdentityMismatch();
    }
    return plan;
  };
  return Object.freeze({
    openRerun: (input: unknown) => client.rerunValues(input), prefill: prefillRerun, preview,
    previewWarnings: (input: unknown) => client.previewRerunWarnings(input),
    acknowledge(input: unknown, proposed: unknown) {
      const request = StartPlanRequestSchema.parse(input);
      const plan = StartPlanWireSchema.parse(proposed);
      if (plan.rerun === undefined || request.rerunSource === undefined || plan.workflowId !== request.workflowId
        || canonicalJsonStringify(plan.rerun.source) !== canonicalJsonStringify(request.rerunSource)) throw new Error("RERUN_ACK_SOURCE_MISMATCH");
      return preview({ ...request, warningAcknowledgment: plan.rerun.warningDigest });
    },
    prepareFinal(input: unknown) {
      if (identity === undefined) throw new Error("RUN_LAUNCH_AUTHORITY_UNAVAILABLE");
      const plan = StartPlanWireSchema.parse(input);
      if (plan.plannedBy !== actorId) throw launchPlanIdentityMismatch();
      return StartCommandRequestSchema.parse({ commandId: identity.uuid(), requestedAt: identity.now(), requestedBy: actorId,
        source: "run-start", family: "start", type: "start-run", target: { workflowId: plan.workflowId,
          startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion }, payload: plan.fingerprints });
    },
    submit(input: unknown, binding: DashboardCommandBinding, plan?: LaunchVerificationPlan, publish?: (outcome: CommandOutcome) => void) {
      const command = StartCommandRequestSchema.parse(input);
      const options = { scope: binding.scope, readback: async (request: CommandRequest, reply: CommandResult | BulkRunCommandOutcome) => {
        if (request.family !== "start" || !("state" in reply)) return { state: "mismatch" as const, evidence: reply };
        return verifyRunLaunchReadback(client, request, reply, plan);
      }, ...(publish === undefined ? {} : { publish }) };
      const retained = binding.executor.retainedAttempts().find(attempt => attempt.request.commandId === command.commandId);
      if (retained !== undefined && canonicalJsonStringify(retained.request) !== canonicalJsonStringify(command)) throw new CommandIdentityConflictError();
      return retained === undefined ? binding.executor.execute(command, options) : binding.executor.replay(command.commandId, options);
    },
  });
}

async function verifyRunLaunchReadback(client: Pick<DashboardClient, "dashboardDay" | "itemAttemptHistory">,
  command: z.infer<typeof StartCommandRequestSchema>, reply: CommandResult, plan?: LaunchVerificationPlan): Promise<CommandReadbackVerification> {
  if (reply.state !== "applied" && reply.state !== "already-applied") return { state: "mismatch", evidence: reply };
  const targets = reply.affectedTargets;
  const starts = targets.filter(target => target.family === "start");
  const target = starts[0];
  if (starts.length !== 1 || target?.workflowId !== command.target.workflowId || target.startPlanId !== command.target.startPlanId
    || target.expectedVersion !== command.target.expectedVersion || targets.some(target => target.family !== "start" && target.family !== "run")) {
    return { state: "mismatch", evidence: reply };
  }
  if (plan !== undefined && (plan.startPlanId !== command.target.startPlanId || plan.workflowId !== command.target.workflowId
    || plan.plannedBy !== command.requestedBy || plan.expectedVersion !== command.target.expectedVersion
    || canonicalJsonStringify(plan.fingerprints) !== canonicalJsonStringify(command.payload))) return { state: "mismatch", evidence: plan };
  const runs = targets.filter(target => target.family === "run").map(target => target.runId);
  if (runs.length === 0 || new Set(runs).size !== runs.length) return { state: "mismatch", evidence: reply };
  const liveRuns = new Map<string, Extract<ItemAttemptHistoryRun, { disposition: "live" }>>();
  for (const runId of runs) {
    let cursor: string | undefined;
    let offset = 0;
    do {
      const history = await client.itemAttemptHistory(runId, { limit: ITEM_ATTEMPT_HISTORY_MAX_LIMIT, ...(cursor === undefined ? {} : { cursor }) });
      if (history.state !== "available" || history.selected.state !== "present" || history.selected.runId !== runId
        || history.selected.workflowId !== command.target.workflowId || history.page.offset !== offset) return { state: "mismatch", evidence: history };
      const selected = history.selected;
      const entries = history.page.entries.filter(entry => entry.runId === runId);
      if (entries.length !== 0) {
        const entry = entries[0];
        if (entries.length !== 1 || entry?.disposition !== "live" || entry.workflowId !== selected.workflowId
          || entry.itemId !== selected.itemId || entry.attempt !== selected.attempt || entry.rowRevision !== selected.rowRevision) {
          return { state: "mismatch", evidence: history };
        }
        liveRuns.set(runId, entry);
        break;
      }
      if (history.page.nextCursor !== null && history.page.entries.length === 0) return { state: "mismatch", evidence: history };
      offset += history.page.entries.length;
      cursor = history.page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    if (!liveRuns.has(runId)) return { state: "mismatch", evidence: { runId } };
  }
  const snapshots = await Promise.all([...new Set([...liveRuns.values()].map(entry => entry.partitionDay))].map(day => client.dashboardDay(day)));
  const rows = snapshots.flatMap(snapshot => snapshot.queueSurfaces);
  const evidence = { reply, snapshots, liveRuns: [...liveRuns.values()] };
  const originMatches = (row: QueueSurfaceWire) => row.session.state === "present"
    && row.session.origin?.kind === "start-plan" && row.session.origin.startPlanId === command.target.startPlanId
    && row.session.origin.actorId === command.requestedBy;
  const roots = rows.filter(row => originMatches(row) && row.lineage.state === "root");
  const rootIds = new Set(roots.map(row => row.runId));
  if (roots.length === 0
    || roots.some(row => !runs.includes(row.runId)) || (plan !== undefined && roots.length !== plan.planned.length)) {
    return { state: "mismatch", evidence };
  }
  const superseded = plan?.planned.flatMap(entry => entry.supersedeTargets ?? []) ?? [];
  for (const runId of runs) {
    const entry = liveRuns.get(runId);
    const row = snapshots.find(snapshot => snapshot.day.valueOf() === entry?.partitionDay.valueOf())?.queueSurfaces.find(row => row.runId === runId);
    if (row === undefined || entry === undefined || row.workflowId !== command.target.workflowId || row.itemId !== entry.itemId
      || row.attempt !== entry.attempt || row.rowRevision.valueOf() < entry.rowRevision.valueOf()) return { state: "mismatch", evidence };
    if (!originMatches(row)) {
      const prior = superseded.find(target => target.runId === runId);
      if (prior === undefined || row.traceId !== prior.traceId || row.attempt !== prior.attempt || row.rowRevision !== prior.version + 1
        || row.status !== "cancelled") return { state: "mismatch", evidence };
      continue;
    }
    if (row.actorId !== command.requestedBy || row.configFingerprint !== command.payload.configFingerprint
      || row.descriptorHash !== command.payload.descriptorFingerprint || (plan !== undefined && row.dryRun !== plan.dryRun)
      || (row.lineage.state === "child" && !rootIds.has(row.lineage.parentRunId))) {
      return { state: "mismatch", evidence };
    }
  }
  if (superseded.some(target => !runs.includes(target.runId))) return { state: "mismatch", evidence };
  return { state: "matched", evidence: { ...evidence, createdRuns: roots.map(row => row.runId) } };
}
