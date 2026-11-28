import { useMemo } from "react";
import type { RerunValuesSnapshot } from "../../../models/dashboard/rerun-values.js";
import { StartPlanRequestSchema, type StartPlanRequest } from "../../../models/dashboard/start-plan.js";
import type { TypedInputDraft, UploadRunSurface } from "../../../models/workflow/ingress.js";
import type { StartPlanResponse } from "../../client/commands/start-commands.js";
import { runChecksBlocked, type RunChecksState } from "./run-checks-model.js";
import type { LaunchGates } from "./run-dialog-model.js";
import * as launchDraft from "./run-launch-draft-model.js";
import type { RerunLaunchSource } from "./run-launch-model.js";
import { MISSING_REFERENCE_REASON, launchWorkbookReferences, previewRunInput, startRequestFingerprint, type RunInputPreview, type StartPriority } from "./run-start-model.js";
import { pdfRunOfferedFields, previewPdfRun, unpickedPdfRunField, type usePdfRunInput } from "./run-start-pdfs.js";
import { rerunSubmission, rerunTypedSourceInput } from "./run-start-rerun-model.js";
import type { runStartSpreadsheetReadiness, useRunStartSpreadsheets, useRunStartWorkbookRows } from "./run-start-spreadsheets-model.js";
import { adjacentRunStartStage, type RunStartStage, type runStartStages } from "./run-start-timeline.js";
import type { RunStartWorkflow } from "./run-start.js";
import { firstStepsFailure, type OpenStepRow, type stepEntries } from "./run-steps-model.js";
import { previewWorkbookRows } from "./run-workbook-rows-model.js";

/** Compare omission sets, not order; added or missing keys describe a different run and must refuse. */
function sameStepKeys(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((key, index) => key === sortedRight[index]);
}

/** Plans and results expire when any request-shaping fact changes. */
export function runStartRequestFingerprint(
  draft: launchDraft.LaunchDraft, { library, versionSources, checkPending, checkSelections }: ReturnType<typeof useRunStartSpreadsheets>,
  { rowIdentity, workbookRows, rowSelectionFresh }: ReturnType<typeof useRunStartWorkbookRows>,
  pdfInput: ReturnType<typeof usePdfRunInput>, rerunSource: RerunLaunchSource | undefined,
  workflowId: string, typedValues: TypedInputDraft, customizeSteps: boolean, dryRun: boolean,
  captureBrowserScreenshots: boolean, selectedStepKeys: readonly string[], openRows: readonly Omit<OpenStepRow, "fold">[],
) {
  const { text, browserMode, priority: priorityChoice } = draft;
  const request = startRequestFingerprint({
    workflowId, text, dryRun, browserMode, captureBrowserScreenshots, priority: priorityChoice, selectedStepKeys,
    stepOmissionDrafts: openRows.map(({ row, draft }) => ({ step: row.key, draft })),
  });
  if (draft.interruptedRerun) return JSON.stringify([rerunSource?.runId, rerunSource?.expectedVersion, request]);
  return launchDraft.launchRequestFingerprint({
    draft, rowIdentity, customizeSteps, typedValues, rerunSource,
    pdf: { draft: pdfInput.draft, picks: pdfInput.picks, loading: pdfInput.loading, error: pdfInput.error },
    workbookRows: { state: workbookRows.state, fresh: rowSelectionFresh },
    library: { loading: library.catalogLoading, refreshing: library.catalogRefreshing, error: library.catalogError, compatibility: library.compatibility },
    spreadsheets: launchDraft.namedSpreadsheets(draft, library.catalog),
    versionSources: { state: versionSources.state, sources: versionSources.sources },
    checks: { pending: checkPending, selections: checkSelections },
    request,
  });
}

export function useRunStartInputPreview(
  { interruptedRerun, selectedWorkbookRows, sourceInputUnchanged, text }: launchDraft.LaunchDraft,
  { rowCapability, rowReference, rowSelectionFresh, workbookRows }: ReturnType<typeof useRunStartWorkbookRows>,
  inputRun: RunStartWorkflow["inputRun"], typedValues: TypedInputDraft, snapshot: RerunValuesSnapshot | null,
  rerunSource: RerunLaunchSource | undefined, pdfSurface: UploadRunSurface | undefined, pdfInput: ReturnType<typeof usePdfRunInput>,
) {
  return useMemo((): RunInputPreview => {
    if (interruptedRerun) return { entries: [], submissions: [], problem: null };
    if (pdfSurface !== undefined) return previewPdfRun(pdfSurface, pdfInput.draft, pdfInput.picks);
    if (inputRun.state !== "present") return { entries: [], submissions: [], problem: null };
    if (rowCapability !== undefined) {
      const selected = selectedWorkbookRows?.choices ?? [];
      const value = previewWorkbookRows(inputRun.surface, selected, selected, typedValues);
      if (!rowSelectionFresh) return { ...value, submissions: [], problem: "Selected rows are out of date. Choose them again." };
      if (rowReference === undefined) return { ...value, submissions: [], problem: null };
      if (workbookRows.state !== "ready") return { ...value, submissions: [], problem: workbookRows.error ?? (workbookRows.state === "loading" ? "Loading saved spreadsheet rows." : "Saved rows are unavailable. Choose another version.") };
      return value;
    }
    return previewRunInput(inputRun.surface, text, typedValues,
      sourceInputUnchanged && snapshot?.source.runId === rerunSource?.runId && snapshot?.source.version === rerunSource?.expectedVersion && snapshot !== null ? rerunTypedSourceInput(inputRun.surface.typedInput, snapshot.sourceInput) : undefined);
  }, [interruptedRerun, inputRun, rowCapability, rowReference, selectedWorkbookRows, rowSelectionFresh, workbookRows.state, workbookRows.error, text, typedValues, snapshot, rerunSource, sourceInputUnchanged, pdfSurface, pdfInput.draft, pdfInput.picks]);
}

export function runStartPlanRequest(
  { referenceSelections, selectedWorkbookRows, valueDrafts, copiedOmissions, browserMode }: launchDraft.LaunchDraft,
  { library, workbookReference, workbookCheck, requiredTypes, referenceId, versionSources, checkSelections }: ReturnType<typeof useRunStartSpreadsheets>,
  { rowCapability }: ReturnType<typeof useRunStartWorkbookRows>,
  { workflowId, snapshot, acknowledgment, pdfSurface, preview, selectedStepKeys, customizeSteps, openRows, stepOmissions,
    dryRun, captureBrowserScreenshots, priority }: {
    workflowId: string;
    snapshot: RerunValuesSnapshot | null;
    acknowledgment: string | undefined;
    pdfSurface: UploadRunSurface | undefined;
    preview: RunInputPreview;
    selectedStepKeys: readonly string[];
    customizeSteps: boolean;
    openRows: readonly OpenStepRow[];
    stepOmissions: ReturnType<typeof stepEntries>;
    dryRun: boolean;
    captureBrowserScreenshots: boolean;
    priority: StartPriority;
  },
): () => StartPlanRequest {
  /** The saved row the source run was started from, when it was started from one. */
  const sourceRow = snapshot?.spreadsheets?.flatMap(({ typeId, selectedRow }) => selectedRow === undefined || typeId !== referenceId ? [] : [{ typeId, row: selectedRow }])[0];
  /** The plan request for the draft on screen; the gates keep it from being asked for a draft that cannot plan. */
  const openStepKeys = new Set(openRows.flatMap(({ row }) => row.stepKey === undefined ? [] : [row.stepKey]));
  return () => {
    if (snapshot?.retainedSteps !== undefined) return StartPlanRequestSchema.parse({
      workflowId, submissions: [], dryRun, browserMode, captureBrowserScreenshots, priority, selectedStepKeys,
      rerunSource: { runId: snapshot.source.runId, expectedVersion: snapshot.source.version, intent: "rerun", selectedStepKeys },
      ...(acknowledgment === undefined ? {} : { warningAcknowledgment: acknowledgment }),
    });
    const values = snapshot === null ? null : pdfSurface === undefined ? rerunSubmission(snapshot, preview.submissions[0] ?? {}, valueDrafts)
      : { submission: preview.submissions[0], copiedFrom: [] };
    const copiedFrom = [...(values?.copiedFrom ?? []), ...Object.entries(copiedOmissions).flatMap(([index, copied]) => {
      const candidate = snapshot?.values[Number(index)];
      return copied && candidate?.state === "available" && candidate.targetStepKey !== undefined
        && openStepKeys.has(candidate.targetStepKey)
        ? [{ nodeId: candidate.nodeId, fieldPath: candidate.fieldPath, targetFieldPath: candidate.targetFieldPath, targetStepKey: candidate.targetStepKey }] : [];
    })];
    return StartPlanRequestSchema.parse({
      workflowId,
      submissions: values === null ? preview.submissions : [values.submission],
      ...(snapshot === null ? {} : { rerunSource: { runId: snapshot.source.runId, expectedVersion: snapshot.source.version,
        intent: "rerun", selectedStepKeys, copiedFrom }, ...(acknowledgment === undefined ? {} : { warningAcknowledgment: acknowledgment }) }),
      dryRun,
      browserMode,
      captureBrowserScreenshots,
      priority,
      ...(requiredTypes.length || checkSelections.length ? { workbookReferences: launchWorkbookReferences(requiredTypes, library.catalog, referenceSelections, values === null ? preview.submissions.length : 1,
        [...versionSources.sources, ...checkSelections],
        (workbookReference?.writableFields.length ?? 0) > 0,
        rowCapability !== undefined ? { typeId: rowCapability.typeId, rows: selectedWorkbookRows?.choices ?? [] } : sourceRow === undefined ? undefined : { typeId: sourceRow.typeId, rows: [sourceRow.row] },
        workbookCheck === undefined ? undefined : { typeId: workbookCheck.id, picks: checkSelections }) } : {}),
      selectedStepKeys,
      // Send omission facts only after every declared form parses.
      ...(customizeSteps && stepOmissions !== null && stepOmissions.length > 0 ? { stepOmissions } : {}),
    });
  };
}

export function runStartGates(
  { referenceSelections, valueDrafts }: launchDraft.LaunchDraft,
  { requiredTypes }: ReturnType<typeof useRunStartSpreadsheets>,
  { rowCapability }: ReturnType<typeof useRunStartWorkbookRows>,
  { spreadsheetGone, spreadsheetsError, spreadsheetsReading, referencesUnavailable }: ReturnType<typeof runStartSpreadsheetReadiness>,
  { workflowId, inputRun, pdfSurface, pdfInput, preview, declaredInput, openRows, customizeSteps, stepOmissions, handOffReason,
    plan, snapshot, supportsDryRun, dryRun, checks, launchStages, currentStage }: {
    workflowId: string;
    inputRun: RunStartWorkflow["inputRun"];
    pdfSurface: UploadRunSurface | undefined;
    pdfInput: ReturnType<typeof usePdfRunInput>;
    preview: RunInputPreview;
    declaredInput: boolean;
    openRows: readonly OpenStepRow[];
    customizeSteps: boolean;
    stepOmissions: ReturnType<typeof stepEntries>;
    handOffReason: string | null;
    plan: StartPlanResponse | null;
    snapshot: RerunValuesSnapshot | null;
    supportsDryRun: boolean;
    dryRun: boolean;
    checks: { state: RunChecksState };
    launchStages: ReturnType<typeof runStartStages>;
    currentStage: RunStartStage;
  },
) {
  const referenceMissing = requiredTypes.some(typeId => referenceSelections[typeId] === undefined);
  const blockedReason = pdfSurface !== undefined ? pdfInput.loading ? "Reading PDFs…" : pdfInput.error !== null ? "Fix the refused PDF selection first." : preview.entries.length === 0 ? "Choose at least one PDF." : referenceMissing ? MISSING_REFERENCE_REASON : null : inputRun.state !== "present"
    ? inputRun.reason
    : preview.problem !== null
      ? preview.dateProblems === undefined ? "Fix the refused entry first." : "Fix the date first."
      : preview.entries.length === 0
        ? rowCapability === undefined ? "Type at least one value." : "Select at least one saved row."
        : referenceMissing
          ? MISSING_REFERENCE_REASON
          : null;
  const launchFields = pdfSurface === undefined ? [] : pdfRunOfferedFields(pdfSurface, pdfInput.draft);
  const unpickedField = pdfSurface === undefined ? null : unpickedPdfRunField(pdfSurface, pdfInput.picks);
  /** A required launch field without a pick blocks planning from Options, where it is picked. */
  const optionsBlockedReason = unpickedField === null ? null : `Pick ${unpickedField.label}.`;
  const rerunInputBlocked = pdfSurface !== undefined ? blockedReason !== null : preview.problem !== null || preview.entries.length > 1 || (declaredInput && preview.entries.length === 0);
  /** Incomplete omitted-step facts block confirmation using the descriptor’s own schema refusal. */
  /** Omission facts describe one person; fan-out must not assert the same dates for multiple subjects. */
  const subjectCount = preview.entries.length;
  const multiSubject = subjectCount > 1;
  const multiSubjectOmissionReason = `Typed values fit one person; ${String(subjectCount)} are entered.`;
  /** The first thing wrong on the Steps stage: more than one person entered with typed values, else the first missing or invalid field. */
  const stepsFailure = !customizeSteps ? null : handOffReason !== null ? { text: handOffReason, rowKey: "", fieldKey: "" } : multiSubject && openRows.some(({ form }) => form.fields.length > 0)
    ? { text: multiSubjectOmissionReason, rowKey: "", fieldKey: "" } : firstStepsFailure(openRows);
  const stepsBlockedReason = stepsFailure?.text ?? null;
  /** A plan retaining different omissions describes another run; refuse its token. */
  const sentOmittedSteps = customizeSteps && stepOmissions !== null ? stepOmissions.map(({ step }) => step) : [];
  const planOmittedSteps = plan?.omittedSteps ?? [];
  const interrupted = snapshot?.retainedSteps !== undefined;
  const omissionMismatch = !interrupted && plan !== null && !sameStepKeys(planOmittedSteps, sentOmittedSteps);
  const nextStage = adjacentRunStartStage(launchStages, currentStage, "next");
  const onLastStage = nextStage === null;
  const rerunInputGone = !interrupted && snapshot !== null && snapshot.source.workflow === workflowId && (spreadsheetGone || rerunInputBlocked
    || declaredInput && preview.submissions.length !== 1 || preview.entries.length === 0 && Object.keys(valueDrafts).length === 0);
  /** A dry source whose workflow has no dry run any more would run live. */
  const dryRunGone = snapshot?.source.dryRun === true && !supportsDryRun;
  const gates: LaunchGates = {
    next: nextStage, inputBlocked: blockedReason !== null, stepsBlocked: stepsBlockedReason !== null, optionsBlocked: optionsBlockedReason !== null,
    rerunInputBlocked: dryRunGone || !interrupted && (rerunInputBlocked || rerunInputGone || spreadsheetsError || spreadsheetsReading),
    checksBlocked: runChecksBlocked(checks.state),
    referencesUnavailable: !interrupted && referencesUnavailable,
    path: launchStages.map(stage => stage.label),
    omissionMismatch, plannedCount: plan?.planned.length ?? 0, ...(supportsDryRun ? { dryRun } : {}),
  };
  return { gates, blockedReason, launchFields, optionsBlockedReason, multiSubject, stepsFailure, stepsBlockedReason,
    sentOmittedSteps, planOmittedSteps, omissionMismatch, onLastStage, rerunInputGone, dryRunGone };
}
