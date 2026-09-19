import { useCallback, useRef, useState } from "react";
import { CommandRequestSchema } from "../../domain/commands.js";
import { systemClock } from "../../domain/clock.js";
import { canonicalJsonStringify, type JsonValue } from "../../domain/canonical-json.js";
import { RerunValuesSnapshotSchema, type RerunValuesSnapshot } from "../../domain/dashboard/rerun-values.js";
import { StartPlanRequestSchema, StartPlanWireSchema, type StartPlanRequest } from "../../domain/dashboard/start-plan.js";
import type { DashboardClient } from "../client/index.js";
import { START_DOOR_ABSENCE } from "../surfaces/run-start-model.js";
import type { RunStartWorkflow } from "../surfaces/run-start.js";
import type { WorkflowBootstrapPrimitive } from "../surfaces/shell-model.js";
import { RUN_START_DOOR_ID, restoreDashboardTakeoverFocus } from "./dashboard-app-model.js";

/** The host owns focus transfer, independently of date/history and Settings state. */
export function useRunLaunch(initialOpen: boolean, mainRegionId: string) {
  const [open, setOpen] = useState(initialOpen);
  const intakeHandoff = useRef(false);
  const openStart = useCallback(() => { intakeHandoff.current = false; setOpen(true); }, []);
  const closeFocus = useCallback((event: Event) => {
    event.preventDefault();
    if (!intakeHandoff.current) restoreDashboardTakeoverFocus(document, RUN_START_DOOR_ID, mainRegionId);
  }, [mainRegionId]);
  const handOffToIntake = useCallback(() => { intakeHandoff.current = true; }, []);
  return { open, setOpen, openStart, closeFocus, handOffToIntake };
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
  const copiedFrom = [];
  for (const index of options.selectedValueIndexes) {
    const candidate = snapshot.values[index];
    if (candidate?.state !== "available") throw new Error("RERUN_PREFILL_VALUE_UNAVAILABLE");
    const keys = candidate.targetFieldPath.split(".");
    let target = submission;
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
      expectedVersion: snapshot.source.version, intent: "rerun", selectedStepKeys: options.selectedStepKeys, copiedFrom } });
}

/** Shared launch door; confirmation/replay send the same immutable envelope. */
export function createRunLaunchService(client: Pick<DashboardClient, "rerunValues" | "submitStartPlan" | "executeCommand">, actorId: string,
  identity: { uuid(): string; now(): string } = { uuid: () => crypto.randomUUID(), now: () => systemClock.now().toISOString() }) {
  const preview = (input: unknown) => client.submitStartPlan(StartPlanRequestSchema.parse(input));
  return Object.freeze({
    openRerun: client.rerunValues.bind(client), prefill: prefillRerun, preview,
    acknowledge(input: unknown, proposed: unknown) {
      const request = StartPlanRequestSchema.parse(input);
      const plan = StartPlanWireSchema.parse(proposed);
      if (plan.rerun === undefined || request.rerunSource === undefined || plan.workflowId !== request.workflowId
        || canonicalJsonStringify(plan.rerun.source) !== canonicalJsonStringify(request.rerunSource)) throw new Error("RERUN_ACK_SOURCE_MISMATCH");
      return preview({ ...request, warningAcknowledgment: plan.rerun.warningDigest });
    },
    prepareFinal(input: unknown) {
      const plan = StartPlanWireSchema.parse(input);
      return CommandRequestSchema.parse({ commandId: identity.uuid(), requestedAt: identity.now(), requestedBy: actorId,
        source: "run-start", family: "start", type: "start-run", target: { workflowId: plan.workflowId,
          startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion }, payload: plan.fingerprints });
    },
    submit: client.executeCommand.bind(client), replay: client.executeCommand.bind(client),
  });
}
