import { useViewNavigation, useViewState } from "../../app/navigation/view-route-model.js";
import "../run-start/launch-presentation.css";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, FileSpreadsheet } from "lucide-react";
import { Banner, Button, ChoicePicker, Dialog, DialogBody, DialogContent, DialogFooter, Input, SearchInput, dsIcon, useToasts } from "../../ds/ui.js";
import { SpreadsheetTable } from "./spreadsheet-table.js";
import { MOCK_ROSTER_ROWS } from "./spreadsheet-mock-data.js";
import { initialSpreadsheetSheets, NOT_MAPPED, registerMockSpreadsheet, spreadsheetMappingErrors, useSpreadsheetMocks, WORKBOOK_ONLY, type RegisteredSpreadsheet, type SpreadsheetSheet } from "./spreadsheet-mock-model.js";

export function SpreadsheetImportDialog({ open, onOpenChange, existing, onRegistered }: {
  open: boolean; onOpenChange: (open: boolean) => void; existing?: RegisteredSpreadsheet; onRegistered: (file: RegisteredSpreadsheet) => void;
}) {
  const retry = useRef(false);
  const { types } = useSpreadsheetMocks();
  const { toast } = useToasts();
  const [name, setName] = useState("26–27 Student applicants.xlsx");
  const [typeId, setTypeId] = useState(types[0].id);
  const [sheets, setSheets] = useState<readonly SpreadsheetSheet[]>(() => initialSpreadsheetSheets(types[0]));
  const [sheetName, setSheetName] = useState(sheets[0].name);
  const routed = useViewNavigation() !== undefined;
  const [view, setView] = useViewState("spreadsheetImportView", "mapping");
  const [query, setQuery] = useState("");
  const type = types.find(entry => entry.id === typeId);
  const sheet = sheets.find(entry => entry.name === sheetName);
  if (!type || !sheet) throw new Error("SPREADSHEET_IMPORT_SELECTION_INVALID");
  useEffect(() => {
    if (!open) return;
    if (retry.current) { retry.current = false; return; }
    const first = types[0];
    const next = existing?.sheets ?? initialSpreadsheetSheets(first);
    setName(existing?.name ?? "26–27 Student applicants.xlsx"); setTypeId(existing?.typeId ?? first.id);
    setSheets(next); setSheetName(next.find(entry => entry.name === "Oct. 19")?.name ?? next[0].name); if (!routed) setView("mapping"); setQuery("");
  }, [open, existing, types, setView, routed]);
  const errors = spreadsheetMappingErrors(sheets);
  const fields = sheet.mapping.filter(field => field !== NOT_MAPPED && field !== WORKBOOK_ONLY);
  const columnMatches = (column: string, index: number) => `${column} ${index < 26 ? String.fromCharCode(65 + index) : `A${String.fromCharCode(65 + index - 26)}`} ${sheet.mapping[index]}`.toLowerCase().includes(query.trim().toLowerCase());
  const updateSheet = (patch: Partial<SpreadsheetSheet>) => setSheets(current => current.map(entry => entry.name === sheetName ? { ...entry, ...patch } : entry));
  const finish = () => {
    onOpenChange(false);
    try {
      if (new URLSearchParams(window.location.search).get("spreadsheetPreviewOutcome") === "failure") throw new Error("Import failed. No file was registered.");
      const file = registerMockSpreadsheet({ name, typeId, sheets }, existing?.id);
      onRegistered(file);
      toast({ tone: "success", title: existing ? "Column mappings saved" : `${type.name} imported`, description: `${file.name} · ${file.sheets.length} sheets` });
    } catch (error) {
      toast({ tone: "danger", title: `${type.name} couldn’t be imported`, description: error instanceof Error ? error.message : String(error), action: { label: "Try again", onAction: () => { retry.current = true; onOpenChange(true); } } });
    }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent size="xl" title={existing ? "Column mappings" : "Import spreadsheet"} description="Match columns to named fields once." className="launch-design spreadsheet-dialog">
    <div className="flex min-h-0 flex-1">
      <aside className="spreadsheet-sheet-rail flex shrink-0 flex-col border-r border-ui-stroke">
        <p className="px-[18px] pt-[18px] pb-3 text-[10px] font-semibold tracking-widest text-ui-muted">SHEETS</p>
        <nav aria-label="Spreadsheet sheets" className="min-h-0 flex-1 overflow-y-auto px-[10px]">
          {sheets.map(entry => <Button key={entry.name} variant="ghost" className={`mb-[3px] h-auto w-full justify-between p-2 text-caption ${entry.name === sheetName ? "bg-ui-hover" : ""}`} aria-pressed={entry.name === sheetName} onClick={() => { setSheetName(entry.name); setQuery(""); }}>{entry.name}<span className="text-caption text-[color:var(--ds-fg-muted)]">{MOCK_ROSTER_ROWS.length}</span></Button>)}
        </nav>
        <p className="px-[18px] pb-[15px] text-caption text-ui-muted">Mappings are saved for each sheet.</p>
      </aside>
      <DialogBody className="spreadsheet-main flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-[var(--ds-space-base)]">
          <span className="flex h-[34px] w-[30px] shrink-0 items-center justify-center rounded-md border border-ui-stroke bg-ui-table text-ui-positive"><FileSpreadsheet aria-hidden className={dsIcon.lg} /></span>
          <div className="min-w-0 flex-1"><h3 className="truncate text-body font-semibold" title={name}>{name}</h3><p className="mt-[var(--ds-space-tight)] text-caption text-[color:var(--ds-fg-muted)]">{sheets.length} sheets</p></div>
          {!existing && <label className="flex h-9 shrink-0 cursor-pointer items-center rounded-md border border-ui-stroke-control px-[10px] text-body font-semibold">Change file<input type="file" accept=".xlsx,.xls,.csv" className="sr-only" aria-label="Choose spreadsheet file" onChange={event => { const file = event.target.files?.[0]; if (file) setName(file.name); }} /></label>}
          {existing ? <span className="shrink-0 rounded-[var(--ds-radius-sm)] border border-[color:var(--ds-border)] px-[var(--ds-space-base)] py-[var(--ds-space-tight)] text-caption">{type.name}</span> : <ChoicePicker label="Spreadsheet type" hideLabel value={typeId} options={types.map(entry => ({ value: entry.id, label: entry.name }))} onChange={id => {
            const next = types.find(entry => entry.id === id); if (!next) throw new Error("SPREADSHEET_TYPE_NOT_FOUND");
            const nextSheets = initialSpreadsheetSheets(next); setTypeId(id); setSheets(nextSheets); setSheetName(nextSheets[0].name);
          }} className="w-[140px] shrink-0" />}
        </div>
        <div className="spreadsheet-view-tabs flex gap-[3px] self-start rounded-[7px] border border-ui-stroke bg-ui-canvas p-[3px]" role="group" aria-label="Import view">
          <Button size="sm" variant="ghost" className={view === "mapping" ? "bg-ui-hover font-semibold" : ""} aria-pressed={view === "mapping"} onClick={() => setView("mapping")}>Column mapping</Button>
          <Button size="sm" variant="ghost" className={view === "preview" ? "bg-ui-hover font-semibold" : ""} aria-pressed={view === "preview"} onClick={() => setView("preview")}>Preview</Button>
        </div>
        {errors.length > 0 && <Banner tone="danger" title="Check column mappings">{errors.map(error => <p key={error}>{error}</p>)}</Banner>}
        {view === "mapping" ? <>
          <div className="flex shrink-0 items-center justify-between gap-3"><SearchInput type="text" aria-label="Find a column" value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery("")} placeholder="Find a column" className="h-9 w-[270px]" /><label className="flex shrink-0 items-center gap-2 text-caption text-ui-muted">Header row<Input aria-label="Header row" type="number" min={1} className="h-9 w-[42px]" value={Number.isNaN(sheet.headerRow) ? "" : sheet.headerRow} onChange={event => updateSheet({ headerRow: event.target.valueAsNumber })} /></label></div>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-[7px] border border-ui-stroke">
            <div className="spreadsheet-mapping-head sticky top-0 z-10 border-b border-ui-stroke bg-ui-table text-caption text-ui-muted"><span>Spreadsheet column</span><span /><span>{type.name} field</span></div>
            {sheet.columns.map((column, index) => columnMatches(column, index) ? <div key={`${column}:${index}`} className="spreadsheet-mapping-row border-b border-ui-stroke last:border-0">
              <div className="flex min-w-0 items-start gap-[10px]"><span className="mt-px w-[18px] shrink-0 text-[10px] text-ui-muted">{index < 26 ? String.fromCharCode(65 + index) : `A${String.fromCharCode(65 + index - 26)}`}</span><div className="min-w-0 text-body"><span className="break-words font-semibold">{column}</span><span className="mt-px block truncate text-caption text-ui-secondary">{sheet.mapping[index] === WORKBOOK_ONLY ? "Kept in original file only" : MOCK_ROSTER_ROWS[0][sheet.mapping[index]] || "Empty in sample"}</span></div></div><ArrowRight aria-hidden className="size-[14px] text-ui-muted" />
              <ChoicePicker label={`Map ${column}`} hideLabel value={sheet.mapping[index]} options={[{ value: NOT_MAPPED, label: NOT_MAPPED }, { value: WORKBOOK_ONLY, label: WORKBOOK_ONLY }, ...type.fields.map(field => ({ value: field, label: field }))]} onChange={field => updateSheet({ mapping: sheet.mapping.map((value, position) => position === index ? field : value) })} />
            </div> : null)}
            {!sheet.columns.some(columnMatches) && <p className="p-[var(--ds-space-cozy)] text-caption text-[color:var(--ds-fg-muted)]">No matching columns.</p>}
          </div>
        </> : <div className="min-h-0 flex-1 overflow-hidden"><SpreadsheetTable label={`${sheet.name} roster preview`} fields={fields} rows={MOCK_ROSTER_ROWS} rowStart={sheet.headerRow + 1} className="max-h-full" /></div>}
        <div className="flex shrink-0 items-center justify-between gap-3 text-caption text-ui-muted">{view === "mapping" ? <><span>{sheet.mapping.filter(field => field !== NOT_MAPPED && field !== WORKBOOK_ONLY).length} of {sheet.columns.length} columns mapped</span><span>Search uses all mapped data</span></> : <><span>{sheet.name} · {MOCK_ROSTER_ROWS.length} records</span><span>Headers at row {sheet.headerRow}</span></>}</div>
      </DialogBody>
    </div>
    <DialogFooter meta={<span className="text-caption text-[color:var(--ds-fg-muted)]"><strong className="text-ui-primary">{type.name}</strong> · {sheets.length} sheets</span>}><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" disabled={errors.length > 0 || !name.trim()} onClick={finish}>{existing ? "Save mappings" : `Import ${type.name.toLowerCase()}`}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
