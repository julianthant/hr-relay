import type { RefObject } from "react";
import { Keyboard } from "lucide-react";
import { spreadsheetField } from "../../../models/fields/workbook-fields.js";
import type { TypedInputDraft, UploadRunSurface } from "../../../models/workflow/ingress.js";
import { FailureNotice } from "../../ds/primitives/failure-notice.js";
import { RunList, RunListSkeleton } from "../../ds/primitives/run-list.js";
import { Banner, Button, Checkbox, EmptyState, Skeleton, Table, TBody, TD, TH, THead, TR, Well, dsIcon } from "../../ds/ui.js";
import * as launchDraft from "./run-launch-draft-model.js";
import type { LaunchFinalCommand } from "./run-launch-recovery.js";
import { RunSpreadsheets, TypedInput } from "./run-start-kit.js";
import type { RunInputPreview } from "./run-start-model.js";
import { WorkflowPdfInput } from "./run-start-pdf-input.js";
import type { usePdfRunInput } from "./run-start-pdfs.js";
import { newestWorksheet, type useRunStartSpreadsheets, type useRunStartWorkbookRows } from "./run-start-spreadsheets-model.js";
import type { RunStartWorkflow } from "./run-start.js";
import { WORKBOOK_ROW_UNAVAILABLE_TEXT, resolveWorkbookRowSelection } from "./run-workbook-rows-model.js";

export function RunStartInput({
  workflow, workflowId, inputRun, pdfSurface, pdfInput, draft: { text, referenceDrafts, referenceSelections, selectedWorkbookRows },
  typedValues, typedInputRef, preview, busy, sending, recovery, update, referencesOnly = false,
  spreadsheets: { library, selectedWorkflow, workbookCheck, requiredTypes, compatibilityMissing, referenceSources, checkSheets, versionSources },
  savedRows: { rowCapability, rowLibrary, rowVersion, workbookRows, rowSource, rowSelectionFresh, rowChoices },
}: {
  workflow: RunStartWorkflow | undefined;
  workflowId: string;
  inputRun: RunStartWorkflow["inputRun"];
  pdfSurface: UploadRunSurface | undefined;
  pdfInput: ReturnType<typeof usePdfRunInput>;
  draft: launchDraft.LaunchDraft;
  typedValues: TypedInputDraft;
  typedInputRef: RefObject<HTMLTextAreaElement | null>;
  preview: RunInputPreview;
  busy: boolean;
  sending: boolean;
  recovery: LaunchFinalCommand | null;
  update: (change: (current: launchDraft.LaunchDraft) => launchDraft.LaunchDraft) => void;
  spreadsheets: ReturnType<typeof useRunStartSpreadsheets>;
  savedRows: ReturnType<typeof useRunStartWorkbookRows>;
  referencesOnly?: boolean;
}) {
  const referencesLocked = referencesOnly || sending;
  if (compatibilityMissing) return <FailureNotice sentence="Spreadsheets can't be checked." {...(referencesLocked ? {} : { action: { label: "Retry", onClick: () => void library.adapter.refreshCatalog() } })} />;
  const checkBusy = library.catalogRefreshing || library.compatibility === undefined;
  const checkHandlers = {
    onAdd: (libraryId: string) => { const sheet = checkSheets.find(candidate => candidate.libraryId === libraryId);
      if (sheet !== undefined) update(current => launchDraft.pickCheck(current, libraryId, { versionId: sheet.versionId, sheetIds: [newestWorksheet(sheet.worksheets)].flatMap(worksheet => worksheet === undefined ? [] : [worksheet.sheetId]) })); },
    onVersion: (libraryId: string, versionId: string) => update(current => launchDraft.pickCheck(current, libraryId, { versionId, sheetIds: [] })),
    onSheets: (libraryId: string, sheetIds: readonly string[]) => update(current => {
      const pick = current.checkPicks[libraryId];
      return pick === undefined ? current : launchDraft.pickCheck(current, libraryId, { versionId: pick.versionId, sheetIds });
    }),
    onRemove: (libraryId: string) => update(current => launchDraft.removeCheck(current, libraryId)),
  };
  const requiredLabelOf = (labels: readonly string[]) => labels.length > 1 ? `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}` : labels.join('');
  const referenceLoading = (description: string) => <div role="status" aria-label="Loading reference data"><RunList title="References" description={description}><RunListSkeleton rows={2} /></RunList></div>;
  /** The one Spreadsheets field: the reference spreadsheet a run looks people up in and, when the workflow allows, the extra spreadsheets it checks each person against. */
  const referenceControls = (types: readonly string[], withCheck: boolean) => {
    const check = withCheck && workbookCheck !== undefined ? { sheets: checkSheets, ...checkHandlers } : undefined;
    if (types.length === 0) return check === undefined ? undefined : library.catalogLoading ? referenceLoading("Optional.")
      : <RunSpreadsheets check={check} busy={checkBusy} locked={referencesLocked} catalogError={library.catalogError} onRefresh={() => void library.adapter.refreshCatalog()} />;
    if (library.catalogLoading) return referenceLoading(`Needs ${requiredLabelOf(selectedWorkflow?.requiredWorkbookFields.map(id => spreadsheetField(id).label) ?? [])}.`);
    return <>{types.map(typeId => {
      const draft = referenceDrafts[typeId];
      const sheetOptions = versionSources.state === 'ready' ? versionSources.sources : [];
      const requiredFields = selectedWorkflow?.requiredWorkbookFields.map(id => spreadsheetField(id).label) ?? [];
      const sheets = library.catalog.filter(entry => entry.state.origin.kind === 'local' && !entry.state.removed).map(entry => ({ libraryId: entry.libraryId, name: entry.name, pinned: entry.state.pinned,
        versions: entry.state.versions.map((version, index) => ({ id: version.id, savedAt: version.savedAt, name: version.name || `v${entry.state.versions.length - index}` })), currentVersionId: entry.state.selectedVersionId, worksheets: referenceSources.filter(source => source.libraryId === entry.libraryId).map(source => source.sheetName) }));
      return <RunSpreadsheets key={typeId} check={check !== undefined && checkSheets.length > 0 ? check : undefined} busy={library.catalogRefreshing || library.compatibility === undefined} locked={referencesLocked} catalogError={library.catalogError}
        onRefresh={() => void library.adapter.refreshCatalog()} inspectWorksheets={referencesOnly}
        reference={{ requiredLabel: requiredLabelOf(requiredFields), sheets, chosenLibraryId: draft?.libraryId, chosenVersionId: draft?.versionId, chosenSheetIds: referenceSelections[typeId]?.sheetIds ?? [], several: true,
          worksheets: sheetOptions.map(source => ({ sheetId: source.sheetId, sheetName: source.sheetName })), worksheetsState: versionSources.state, worksheetsError: versionSources.error,
          onPick: (libraryId, versionId) => update(current => launchDraft.pickReference(current, typeId, libraryId, versionId)),
          onVersion: versionId => update(current => launchDraft.pickReferenceVersion(current, typeId, versionId)),
          onWorksheets: sheetIds => {
            const sources = sheetOptions.filter(candidate => sheetIds.includes(candidate.sheetId));
            const [source] = sources;
            if (source !== undefined) update(current => launchDraft.pickWorksheet(current, typeId, { libraryId: source.libraryId, versionId: source.versionId, sheetIds: sources.map(picked => picked.sheetId) }));
          },
          onRemove: () => update(current => launchDraft.removeReference(current, typeId)) }} />;
    })}</>;
  };
  if (referencesOnly) return referenceControls(requiredTypes, false);
  return (
                <section aria-label="Input" className="launch-form-sections flex min-h-0 flex-1 flex-col">
                  {pdfSurface !== undefined ? <>
                    <WorkflowPdfInput files={pdfInput.draft?.files.map(file => ({ name: file.source.fileName, size: file.source.artifact.bytes })) ?? []}
                      busy={busy || sending || pdfInput.loading} onChoose={files => { void pdfInput.choose(pdfSurface, files); }} onRemove={pdfInput.remove} onClear={pdfInput.clear} />
                  </> : inputRun.state === "present" ? (
                    <TypedInput
                      surface={inputRun.surface}
                      workflowId={workflowId}
                      text={text}
                      onText={next => update(current => launchDraft.changeText(current, next))}
                      preview={preview}
                      inputRef={typedInputRef}
                      autoFocus
                      draft={typedValues}
                      locked={sending}
                      rowsOwnNotice={workbookRows.state === "error"}
                      rowInput={rowCapability === undefined ? undefined : <>
                        {referenceControls([rowCapability.typeId], true)}
                        {library.catalogRefreshing && <p role="status">Refreshing reference data. Row selection is disabled.</p>}
                        {workbookRows.state === "loading" && <div role="status" aria-label="Loading saved rows"><Skeleton className="h-9 w-full" /></div>}
                        {workbookRows.state === "error" && <FailureNotice sentence={`Couldn't read the rows of ${rowLibrary?.name ?? "the saved spreadsheet"}${rowVersion === undefined ? "" : ` (${rowVersion.name})`}: ${workbookRows.error}`} action={{ label: "Refresh reference data", disabled: sending, onClick: () => void library.adapter.refreshCatalog() }} />}
                        {!rowSelectionFresh && <Banner tone="warning" title="Previous row selection"><p>Selected rows are out of date.</p><Button variant="secondary" disabled={sending} onClick={() => update(launchDraft.clearWorkbookRows)}>Clear previous row selection</Button></Banner>}
                        {workbookRows.state === "ready" && rowChoices.length === 0 && <EmptyState title="No saved data rows" description="This version has only headers." />}
                        {rowChoices.length > 0 && <Table label="Saved spreadsheet rows"><THead><TR><TH>Select</TH><TH>Source row</TH><TH>Lookup key</TH></TR></THead><TBody>{rowChoices.map(choice => {
                          const selected = selectedWorkbookRows?.choices.some(row => row.sheetId === choice.sheetId && row.rowId === choice.rowId) ?? false;
                          const label = `${choice.sourceLabel}: ${choice.key.state === "available" ? choice.key.value : WORKBOOK_ROW_UNAVAILABLE_TEXT[choice.key.reason]}`;
                          return <TR key={JSON.stringify([choice.sheetId, choice.rowId])} selected={selected}><TD><Checkbox label={<span className="sr-only">{`Select ${label}`}</span>} checked={selected}
                            disabled={workbookRows.state !== "ready" || !rowSelectionFresh || choice.key.state === "unavailable" || recovery !== null || sending}
                            onCheckedChange={checked => update(current => launchDraft.selectWorkbookRows(current, rowSource,
                              resolveWorkbookRowSelection(workbookRows.choices, checked === true ? [...(current.selectedWorkbookRows?.choices ?? []), choice] : (current.selectedWorkbookRows?.choices ?? []).filter(row => row.sheetId !== choice.sheetId || row.rowId !== choice.rowId))))} /></TD>
                            <TD>{choice.sourceLabel}</TD><TD className="break-all">{choice.key.state === "available" ? choice.key.value : WORKBOOK_ROW_UNAVAILABLE_TEXT[choice.key.reason]}</TD></TR>;
                        })}</TBody></Table>}
                      </>}
                      onValue={(field, value) => { if (workflow !== undefined) update(current => launchDraft.changeTypedValue(current, workflow, field, value)); }}
                    />
                  ) : (
                    <Well>
                      <EmptyState
                        className="p-[var(--ds-space-base)]"
                        icon={<Keyboard aria-hidden className={dsIcon.lg} />}
                        title="No typed start for this workflow"
                        description={inputRun.reason}
                      />
                    </Well>
                  )}
                  {referenceControls(requiredTypes.filter(typeId => typeId !== rowCapability?.typeId), rowCapability === undefined)}
                </section>
  );
}
