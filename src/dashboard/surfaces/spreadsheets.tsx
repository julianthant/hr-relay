import { SpreadsheetEditor } from "./spreadsheet-editor.js";
import { importSpreadsheet, newEditableWorkbook, type EditableWorkbook } from "./spreadsheet-editor-model.js";
import { useRef, useState, type RefObject } from "react";
import { FileSpreadsheet, FolderOpen, Plus, X } from "lucide-react";
import { Banner, Button, Dialog, DialogBody, DialogContent, DialogFooter, Field, IconButton, Input, PageHeading, SearchInput, Tab, TabList, TabPanel, Tabs, TableList, dsIcon, useToasts } from "../ds/ui.js";
import { SpreadsheetImportDialog } from "./spreadsheet-import.js";
import { ROSTER_FIELD_GROUPS } from "./spreadsheet-mock-data.js";
import { addMockSpreadsheetType, initialSpreadsheetSheets, registeredSpreadsheetWorkbook, registerLocalSpreadsheet, retainSpreadsheetCopy, spreadsheetFields, useSpreadsheetMocks, type RegisteredSpreadsheet, type SpreadsheetType } from "./spreadsheet-mock-model.js";

function SpreadsheetTypeDialog({ open, onOpenChange, type, returnFocus }: { open: boolean; onOpenChange: (open: boolean) => void; type?: SpreadsheetType; returnFocus: RefObject<HTMLButtonElement | null> }) {
  const { toast } = useToasts();
  const [name, setName] = useState("");
  const [fields, setFields] = useState(["Legal name", "Employee ID", "Email"]);
  const [error, setError] = useState<string | null>(null);
  const close = (next: boolean) => { onOpenChange(next); if (!next) { setName(""); setFields(["Legal name", "Employee ID", "Email"]); setError(null); } };
  const save = () => {
    try {
      const next = addMockSpreadsheetType(name, fields);
      close(false);
      toast({ tone: "success", title: "Spreadsheet type added", description: `${next.name} · ${next.fields.length} named fields` });
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  };
  const sourceColumns = type ? initialSpreadsheetSheets(type).flatMap(sheet => sheet.mapping.map((field, index) => [field, sheet.columns[index]] as const)) : [];
  const fieldGroups = type ? type.id === "roster" ? ROSTER_FIELD_GROUPS : [{ name: undefined, fields: type.fields }] : [];
  return <Dialog open={open} onOpenChange={close}><DialogContent size="md" className="launch-design spreadsheet-type-dialog h-[min(calc(100dvh-32px),630px)] max-h-[calc(100dvh-32px)] max-w-[610px]" title={type ? `${type.name} fields` : "Add spreadsheet type"} description={type ? "Named fields used by this spreadsheet type." : "Create a reusable set of named columns."} onCloseAutoFocus={event => { if (returnFocus.current) { event.preventDefault(); returnFocus.current.focus(); } }}>
    <DialogBody className="flex flex-1 flex-col gap-[17px] px-5 py-[18px]">
      {error && <Banner tone="danger" title="Check spreadsheet type">{error}</Banner>}
      {!type && <Field label="Type name"><Input value={name} onChange={event => setName(event.target.value)} placeholder="For example, Employee directory" className="h-9" /></Field>}
      <section className="flex flex-col gap-[9px]">
        <div className="flex items-center justify-between"><h3 className="text-body font-semibold">{type ? "Field" : "Fields"}</h3>{type ? <span className="text-caption text-ui-muted">Source column</span> : <Button variant="secondary" size="sm" onClick={() => setFields(current => [...current, ""])}>Add field</Button>}</div>
        {type ? <div className="flex flex-col gap-3">{fieldGroups.map(group => <section key={group.name ?? "fields"} aria-label={group.name ?? `${type.name} fields`} className="overflow-hidden rounded-[7px] border border-ui-stroke">
            {group.name && <div className="border-b border-ui-stroke bg-ui-table px-3 py-[7px] text-caption text-ui-muted">{group.name}</div>}
            {group.fields.map(field => <div key={field} className="flex justify-between gap-3 border-b border-ui-stroke px-3 py-2 last:border-0"><strong className="text-body font-semibold">{field}</strong><span className="text-caption text-ui-muted">{sourceColumns.find(([mapped]) => mapped === field)?.[1]}</span></div>)}
          </section>)}</div> : <div className="shrink-0 overflow-hidden rounded-[7px] border border-ui-stroke">{fields.map((field, index) => <div key={index} className="flex items-center gap-[9px] border-b border-ui-stroke px-[10px] py-[6px] last:border-0">
            <span aria-hidden className="w-[19px] shrink-0 text-caption text-ui-muted">{index + 1}</span>
            <Input aria-label={`Field name ${index + 1}`} value={field} placeholder="Field name" className="h-8 min-w-0 flex-1" onChange={event => setFields(current => current.map((value, position) => position === index ? event.target.value : value))} />
            <IconButton label={`Remove field ${index + 1}`} icon={<X aria-hidden className={dsIcon.sm} />} onClick={() => setFields(current => current.filter((_, position) => position !== index))} />
          </div>)}</div>}
      </section>
      <p className="text-caption text-ui-secondary">{type ? "Mapped fields are searchable. This type supplies reference data and updated spreadsheet copies." : "All mapped fields can be searched. Reference data and updated copies are available automatically."}</p>
    </DialogBody><DialogFooter meta={type ? `${type.fields.length} named fields` : undefined}><Button variant="secondary" onClick={() => close(false)}>{type ? "Close" : "Cancel"}</Button>{!type && <Button variant="primary" onClick={save}>Add type</Button>}</DialogFooter>
  </DialogContent></Dialog>;
}

export function SpreadsheetsSettings({ workbook, workbookDirty, onWorkbook }: { workbook: EditableWorkbook | null; workbookDirty: boolean; onWorkbook: (next: EditableWorkbook | null, dirty: boolean) => void }) {
  const { files, types } = useSpreadsheetMocks();
  const [tab, setTab] = useState<"registered" | "types">("registered");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(workbook?.libraryId ?? null);
  const upload = useRef<HTMLInputElement>(null);
  const libraryButtons = useRef(new Map<string, HTMLButtonElement>());
  const [busy, setBusy] = useState(false);
  const [fileError, setFileError] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<RegisteredSpreadsheet | undefined>();
  const [typeOpen, setTypeOpen] = useState(false);
  const [viewType, setViewType] = useState<SpreadsheetType | undefined>();
  const typeTrigger = useRef<HTMLButtonElement>(null);
  const selected = selectedId === null ? undefined : files.find(file => file.id === selectedId);
  if (selectedId !== null && !selected) throw new Error("SPREADSHEET_NOT_FOUND");
  const openFile = (file: RegisteredSpreadsheet) => { setSelectedId(file.id); onWorkbook(registeredSpreadsheetWorkbook(file), false); };
  const documentChange = (next: EditableWorkbook | null, dirty: boolean) => {
    if (selected && !dirty && (next || workbook && !workbookDirty)) retainSpreadsheetCopy(selected.id, next ?? workbook!);
    onWorkbook(next, dirty);
    if (!next) {
      setSelectedId(null);
      if (selected) window.requestAnimationFrame(() => libraryButtons.current.get(selected.id)?.focus());
    }
  };
  const importFile = async (file: File) => {
    setBusy(true); setFileError("");
    try { const document = await importSpreadsheet(file.name, await file.arrayBuffer()); const registered = registerLocalSpreadsheet(document); setSelectedId(registered.id); onWorkbook({ ...document, libraryId: registered.id }, false); }
    catch (error) { setFileError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); if (upload.current) upload.current.value = ""; }
  };
  const visibleFiles = files.filter(file => `${file.name} ${types.find(type => type.id === file.typeId)?.name ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  return <section aria-label="Spreadsheets" className="spreadsheet-workspace settings-reference-page min-w-0 text-body">
    <input ref={upload} disabled={busy} type="file" accept=".xlsx,.csv" aria-label="Open XLSX or CSV" className="sr-only" onChange={event => { const file = event.target.files?.[0]; if (file) void importFile(file); }} />
    {fileError && <Banner tone="danger" title="Spreadsheet unavailable">{fileError}</Banner>}
    {workbook ? <SpreadsheetEditor key={selectedId ?? workbook.name} document={workbook} dirty={workbookDirty} onDocument={documentChange} onMapping={selected && types.some(type => type.id === selected.typeId) ? () => { setEditing(selected); setImportOpen(true); } : undefined} /> : <>
      <PageHeading title="Spreadsheets" description="Manage files and reusable spreadsheet types." className="settings-heading-actions" actionAlignment="title" actions={tab === "registered" ? <>
        <Button variant="secondary" disabled={busy} icon={<Plus aria-hidden className={dsIcon.md} />} onClick={() => { const document = newEditableWorkbook(); const file = registerLocalSpreadsheet(document); setSelectedId(file.id); onWorkbook({ ...document, libraryId: file.id }, true); }}>New spreadsheet</Button>
        <Button variant="primary" disabled={busy} icon={<FolderOpen aria-hidden className={dsIcon.md} />} onClick={() => upload.current?.click()}>{busy ? "Importing…" : "Import spreadsheet"}</Button>
      </> : <Button variant="primary" onClick={event => { typeTrigger.current = event.currentTarget; setViewType(undefined); setTypeOpen(true); }}>Add spreadsheet type</Button>} />
      <Tabs value={tab} onValueChange={value => { setTab(value as "registered" | "types"); setSelectedId(null); }}>
      <TabList label="Spreadsheet settings" className="mb-[var(--ds-space-page)]"><Tab value="registered" count={files.length}>Registered spreadsheets</Tab><Tab value="types" count={types.length}>Spreadsheet types</Tab></TabList>
      <TabPanel value="registered">
        <TableList search={<SearchInput aria-label="Find a spreadsheet" placeholder="Find a spreadsheet" value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery("")} />} summary={`${files.length} registered spreadsheets`}>
        <table aria-label="Registered spreadsheets"><thead><tr>{["Spreadsheet", "Type", "Sheets", "Mapped fields", "Date added"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{visibleFiles.map(file => <tr key={file.id} onClick={() => openFile(file)} className="cursor-pointer"><td ><div className="flex items-center gap-3"><span className="flex h-10 w-[34px] shrink-0 items-center justify-center rounded-md border border-ui-stroke bg-ui-table text-ui-positive"><FileSpreadsheet aria-hidden className="size-[19px]" /></span><div className="min-w-0"><Button ref={node => { if (node) libraryButtons.current.set(file.id, node); else libraryButtons.current.delete(file.id); }} variant="ghost" className="h-auto min-h-6 max-w-full justify-start p-0 text-body font-semibold text-ui-primary" onClick={event => { event.stopPropagation(); openFile(file); }}>{file.name}</Button></div></div></td><td ><span className="rounded border border-ui-stroke px-[6px] py-[3px] text-caption">{types.find(type => type.id === file.typeId)?.name ?? (file.name.toLowerCase().endsWith(".csv") ? "CSV" : "XLSX")}</span></td><td >{file.sheets.length}</td><td className="text-caption text-ui-muted">All {spreadsheetFields(file).length} mapped fields</td><td className="whitespace-nowrap text-caption text-ui-muted">{file.addedAt ? <time dateTime={file.addedAt}>{new Date(file.addedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</time> : "Not recorded"}</td></tr>)}</tbody></table>{!visibleFiles.length && <p className="p-[30px] text-center text-ui-muted">No spreadsheets match your search.</p>}</TableList>
        <p className="mt-[14px] text-caption text-ui-muted">Registered spreadsheets are available to Run and Rerun. Importing a file does not start runs.</p>
      </TabPanel><TabPanel value="types">
        <div className="flex flex-col gap-3">{types.map(type => <article key={type.id} className="flex items-center gap-3 rounded-lg border border-ui-stroke bg-ui-panel px-[14px] py-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-ui-stroke bg-ui-table text-ui-muted"><FileSpreadsheet aria-hidden className={dsIcon.md} /></span><div className="min-w-0 flex-1"><h3 className="text-heading font-semibold">{type.name}</h3><p className="mt-[3px] text-caption text-ui-secondary">{type.id === "roster" ? "People, job details and hiring progress." : "A reusable set of named spreadsheet fields."}</p></div><span className="mr-2 shrink-0 text-caption text-ui-muted">{type.fields.length} fields</span><Button variant="secondary" onClick={event => { typeTrigger.current = event.currentTarget; setViewType(type); setTypeOpen(true); }}>View fields</Button></article>)}</div>
        <p className="mt-[14px] text-caption text-ui-muted">Types define what columns mean. Each imported spreadsheet keeps its own column mappings.</p>
      </TabPanel></Tabs>
    </>}
    <SpreadsheetImportDialog open={importOpen} onOpenChange={setImportOpen} existing={editing} onRegistered={() => { if (!editing) { setTab("registered"); setSelectedId(null); setQuery(""); } }} />
    <SpreadsheetTypeDialog open={typeOpen} onOpenChange={setTypeOpen} type={viewType} returnFocus={typeTrigger} />
  </section>;
}
