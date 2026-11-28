import { useEffect, useMemo } from "react";
import type { RerunValuesSnapshot } from "../../../models/dashboard/rerun-values.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { DashboardCommandBinding } from "../../app/dashboard-app-model.js";
import type { DashboardClient } from "../../client/index.js";
import { useSpreadsheetWiringAdapter } from "../../state/spreadsheet-wiring-adapter.js";
import * as launchDraft from "./run-launch-draft-model.js";
import type { CheckSheet } from "./run-start-kit.js";
import type { RunStartWorkflow } from "./run-start.js";
import { checkVersionKey, useCheckVersionSheets, useWorkbookRows, useWorkbookVersionSources } from "./run-workbook-rows-model.js";

/** Workbooks add a worksheet at the end, so the newest one is the last tab. */
export function newestWorksheet<T>(worksheets: readonly T[]): T | undefined {
  return worksheets.at(-1);
}

export function useRunStartSpreadsheets(
  open: boolean, workflows: readonly RunStartWorkflow[], workflowId: string,
  client: DashboardClient, commandBinding: DashboardCommandBinding | undefined,
  { referenceDrafts, checkPicks }: launchDraft.LaunchDraft,
  update: (change: (current: launchDraft.LaunchDraft) => launchDraft.LaunchDraft) => void,
) {
  const library = useSpreadsheetWiringAdapter(open && workflows.some(workflow => workflow.workflowId === workflowId && (workflow.workbookReference !== undefined || workflow.workbookCheck !== undefined)), null, true, false);
  const selectedWorkflow = workflows.find(workflow => workflow.workflowId === workflowId);
  const workbookReference = selectedWorkflow?.workbookReference;
  const requiredTypes = useMemo(() => workbookReference === undefined ? [] : [workbookReference.id], [workbookReference]);
  const referenceId = workbookReference?.id;
  const selectedDraft = referenceId === undefined ? undefined : referenceDrafts[referenceId];
  const selectedLibrary = library.catalog.find(entry => entry.libraryId === selectedDraft?.libraryId && entry.state.origin.kind === 'local' && !entry.state.removed);
  const selectedVersion = selectedLibrary?.state.versions.find(version => version.id === selectedDraft?.versionId);
  const sourceProjection = library.compatibility?.workflows.find(entry => entry.workflowId === workflowId);
  /** Relay answered but has no reference-spreadsheet check for this workflow: the input stage says so, the rest of the dialog keeps working. */
  const compatibilityMissing = library.compatibility !== undefined && workbookReference !== undefined && sourceProjection === undefined;
  if (sourceProjection !== undefined && selectedWorkflow !== undefined && (canonicalJsonStringify(sourceProjection.requiredWorkbookFields) !== canonicalJsonStringify(selectedWorkflow.requiredWorkbookFields)
    || canonicalJsonStringify(sourceProjection.workbookReference ?? null) !== canonicalJsonStringify(workbookReference ?? null)))
    throw new Error(`WORKBOOK_COMPATIBILITY_DECLARATION_MISMATCH: ${workflowId}`);
  const referenceSources = sourceProjection?.sources ?? [];
  const workbookCheck = selectedWorkflow?.workbookCheck;
  /** Every local library spreadsheet whose current version maps the check's key field, apart from the one the required reference already picked. */
  const checkLibraries = useMemo(() => workbookCheck === undefined || library.compatibility === undefined ? [] : library.compatibility.libraries.flatMap(source => {
    const entry = library.catalog.find(candidate => candidate.libraryId === source.libraryId && candidate.state.origin.kind === "local" && !candidate.state.removed);
    const worksheets = source.sheets.filter(sheet => sheet.mappings.some(mapping => mapping.fieldId === workbookCheck.keyFieldId)).map(sheet => ({ sheetId: sheet.sheetId, sheetName: sheet.sheetName }));
    return entry === undefined || worksheets.length === 0 || entry.libraryId === referenceDrafts[workbookReference?.id ?? ""]?.libraryId ? []
      : [{ libraryId: entry.libraryId, name: entry.name, pinned: entry.state.pinned, currentVersionId: source.versionId, currentSheets: worksheets,
        versions: entry.state.versions.map((version, index) => ({ id: version.id, savedAt: version.savedAt, name: version.name || `v${entry.state.versions.length - index}` })) }];
  }).toSorted((a, b) => a.name.localeCompare(b.name)), [workbookCheck, library.compatibility, library.catalog, referenceDrafts, workbookReference?.id]);
  const historicalChecks = useMemo(() => checkLibraries.flatMap(entry => {
    const pick = checkPicks[entry.libraryId];
    return pick === undefined || pick.versionId === entry.currentVersionId ? [] : [{ libraryId: entry.libraryId, versionId: pick.versionId }];
  }), [checkLibraries, checkPicks]);
  const checkVersionSheets = useCheckVersionSheets(client, commandBinding?.authority.epoch ?? client, historicalChecks, workbookCheck?.keyFieldId);
  const checkSheets = useMemo((): readonly CheckSheet[] => checkLibraries.map(entry => {
    const pick = checkPicks[entry.libraryId];
    const versionId = pick?.versionId ?? entry.currentVersionId;
    const loaded = versionId === entry.currentVersionId ? { state: "ready" as const, sheets: entry.currentSheets } : checkVersionSheets[checkVersionKey(entry.libraryId, versionId)] ?? { state: "loading" as const, sheets: [] };
    return { libraryId: entry.libraryId, name: entry.name, pinned: entry.pinned, versions: entry.versions, versionId, versionName: entry.versions.find(version => version.id === versionId)?.name ?? "",
      worksheets: loaded.sheets, worksheetsState: loaded.state, ...(pick === undefined ? {} : { pickedSheetIds: pick.sheetIds }) };
  }), [checkLibraries, checkPicks, checkVersionSheets]);
  /** The picks that can be sent: named version read, at least one of its worksheets chosen. */
  const pickedChecks = checkSheets.filter(sheet => sheet.pickedSheetIds !== undefined && sheet.worksheetsState === "ready"
    && sheet.worksheets.some(worksheet => sheet.pickedSheetIds?.includes(worksheet.sheetId)));
  const checkPending = checkSheets.some(sheet => sheet.pickedSheetIds !== undefined && sheet.worksheetsState !== "ready");
  const checkSelections = pickedChecks.flatMap(sheet => sheet.worksheets.filter(worksheet => sheet.pickedSheetIds?.includes(worksheet.sheetId))
    .map(worksheet => ({ libraryId: sheet.libraryId, versionId: sheet.versionId, sheetId: worksheet.sheetId })));
  useEffect(() => {
    for (const sheet of checkSheets) {
      const newest = newestWorksheet(sheet.worksheets);
      if (sheet.pickedSheetIds?.length === 0 && sheet.worksheetsState === "ready" && newest !== undefined)
        update(current => launchDraft.pickCheck(current, sheet.libraryId, { versionId: sheet.versionId, sheetIds: [newest.sheetId] }));
    }
  }, [checkSheets, update]);
  const versionSources = useWorkbookVersionSources(client, commandBinding?.authority.epoch ?? client,
    selectedLibrary?.libraryId, selectedVersion, selectedLibrary?.state.selectedVersionId,
    selectedWorkflow?.requiredWorkbookFields ?? [], referenceSources);
  return { library, selectedWorkflow, workbookReference, workbookCheck, requiredTypes, referenceId, selectedDraft,
    compatibilityMissing, referenceSources, checkSheets, checkPending, checkSelections, versionSources };
}

export function useRunStartWorkbookRows(
  { library, workbookReference, versionSources }: ReturnType<typeof useRunStartSpreadsheets>,
  { referenceSelections, selectedWorkbookRows }: launchDraft.LaunchDraft,
  client: DashboardClient, commandBinding: DashboardCommandBinding | undefined,
  open: boolean, isRerun: boolean, actorId: string, workflowId: string,
  workflow: RunStartWorkflow | undefined, inputRun: RunStartWorkflow["inputRun"],
) {
  const rowCapability = !isRerun && inputRun.state === "present" ? inputRun.surface.workbookRows : undefined;
  const rowReference = rowCapability === undefined ? undefined : referenceSelections[rowCapability.typeId];
  const rowLibrary = library.catalog.find(entry => entry.libraryId === rowReference?.libraryId && entry.state.origin.kind === "local" && !entry.state.removed);
  const rowVersion = rowLibrary?.state.versions.find(version => version.id === rowReference?.versionId);
  const rowReadReady = !library.catalogLoading && !library.catalogRefreshing && !library.catalogError && rowLibrary !== undefined && rowVersion !== undefined
    && versionSources.state === 'ready' && versionSources.sources.some(source => source.libraryId === rowReference?.libraryId && source.versionId === rowReference?.versionId && source.sheetId === rowReference?.sheetIds[0]);
  const rowIdentity = canonicalJsonStringify([actorId, workflowId, workflow?.version ?? null, inputRun, rowReference ?? null, rowLibrary?.state.revision ?? null]);
  const workbookRows = useWorkbookRows(client, rowIdentity, commandBinding?.authority.epoch ?? client, open && rowCapability !== undefined,
    rowReadReady, rowReference?.libraryId ?? "", rowVersion, workbookReference?.keyFieldId, rowReference?.sheetIds[0]);
  const rowSource = canonicalJsonStringify([rowReference?.libraryId ?? null, rowReference?.versionId ?? null, rowReference?.sheetIds[0] ?? null]);
  const rowSelectionFresh = selectedWorkbookRows === undefined || selectedWorkbookRows.source === rowSource;
  const rowChoices = rowSelectionFresh ? workbookRows.choices : selectedWorkbookRows?.choices ?? [];
  return { rowCapability, rowReference, rowLibrary, rowVersion, rowIdentity, workbookRows, rowSource, rowSelectionFresh, rowChoices };
}

export function runStartSpreadsheetReadiness(
  { library, workbookReference, workbookCheck, compatibilityMissing, selectedDraft, versionSources, checkSheets,
    referenceId, checkSelections, checkPending, requiredTypes }: ReturnType<typeof useRunStartSpreadsheets>,
  referenceSelections: launchDraft.LaunchDraft["referenceSelections"], isRerun: boolean, snapshot: RerunValuesSnapshot | null,
) {
  if (snapshot?.retainedSteps !== undefined) return {
    spreadsheetsError: false, spreadsheetsReading: false, spreadsheetGone: false, referencesUnavailable: false,
  };
  const usesSpreadsheets = workbookReference !== undefined || workbookCheck !== undefined;
  const spreadsheetsError = isRerun && usesSpreadsheets && (Boolean(library.catalogError) || compatibilityMissing);
  const spreadsheetsReading = usesSpreadsheets && !spreadsheetsError && (library.catalogLoading || library.catalogRefreshing || library.compatibility === undefined
    || selectedDraft !== undefined && versionSources.state === "loading" || checkSheets.some(sheet => sheet.pickedSheetIds !== undefined && sheet.worksheetsState === "loading"));
  const reference = referenceId === undefined ? undefined : referenceSelections[referenceId];
  const spreadsheetGone = usesSpreadsheets && !spreadsheetsReading && !spreadsheetsError && (workbookReference !== undefined
    && (reference === undefined || !reference.sheetIds.every(sheetId => versionSources.sources.some(source => source.libraryId === reference.libraryId && source.versionId === reference.versionId && source.sheetId === sheetId)))
    || checkSelections.length !== (snapshot?.spreadsheets ?? []).filter(pick => pick.typeId === workbookCheck?.id).length);
  const referencesUnavailable = checkPending || compatibilityMissing || requiredTypes.length > 0 && (library.catalogLoading || library.catalogRefreshing || Boolean(library.catalogError) || library.compatibility === undefined || versionSources.state !== "ready");
  return { spreadsheetsError, spreadsheetsReading, spreadsheetGone, referencesUnavailable };
}
