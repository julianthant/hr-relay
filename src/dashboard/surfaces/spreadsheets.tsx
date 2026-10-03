import { useState } from "react";
import { ArrowLeft, ArrowRight, FileSpreadsheet, X } from "lucide-react";
import { Banner, Button, ChoicePicker, Dialog, DialogBody, DialogContent, DialogFooter, Field, IconButton, Input, SearchInput, Tab, TabList, TabPanel, Tabs, dsIcon, useToasts } from "../ds/ui.js";
import { SpreadsheetImportDialog } from "./spreadsheet-import.js";
import { SpreadsheetTable } from "./spreadsheet-table.js";
import { MOCK_ROSTER_ROWS, ROSTER_FIELD_GROUPS } from "./spreadsheet-mock-data.js";
import { addMockSpreadsheetType, initialSpreadsheetSheets, searchMockSpreadsheet, spreadsheetFields, useSpreadsheetMocks, type RegisteredSpreadsheet, type SpreadsheetType } from "./spreadsheet-mock-model.js";

function SpreadsheetTypeDialog({ open, onOpenChange, type }: { open: boolean; onOpenChange: (open: boolean) => void; type?: SpreadsheetType }) {
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
  return <Dialog open={open} onOpenChange={close}><DialogContent size="md" className="launch-design spreadsheet-type-dialog h-[min(calc(100dvh-32px),630px)] max-h-[calc(100dvh-32px)] max-w-[610px]" title={type ? `${type.name} fields` : "Add spreadsheet type"} description={type ? "Named fields used by this spreadsheet type." : "Create a reusable set of named columns."}>
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

export function SpreadsheetsSettings() {
  const { files, types } = useSpreadsheetMocks();
  const [tab, setTab] = useState<"registered" | "types">("registered");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [dataQuery, setDataQuery] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<RegisteredSpreadsheet | undefined>();
  const [typeOpen, setTypeOpen] = useState(false);
  const [viewType, setViewType] = useState<SpreadsheetType | undefined>();
  const selected = selectedId === null ? undefined : files.find(file => file.id === selectedId);
  if (selectedId !== null && !selected) throw new Error("SPREADSHEET_NOT_FOUND");
  const openFile = (file: RegisteredSpreadsheet) => { setSelectedId(file.id); setSheetName(file.sheets.find(entry => entry.name === "Oct. 19")?.name ?? file.sheets[0].name); setDataQuery(""); };
  const visibleFiles = files.filter(file => `${file.name} ${types.find(type => type.id === file.typeId)?.name ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const rows = selected ? searchMockSpreadsheet(selected, sheetName, dataQuery) : [];
  const sheet = selected?.sheets.find(entry => entry.name === sheetName);
  const fields = sheet ? [...new Set(sheet.mapping.filter(field => field !== "Not used" && field !== "Keep in workbook only"))] : [];
  return <section aria-label="Spreadsheets" className="launch-design spreadsheet-workspace min-w-0 text-body">
    {selected ? <>
      <Button variant="ghost" icon={<ArrowLeft aria-hidden className={dsIcon.sm} />} className="mb-[19px] h-auto p-0 text-ui-secondary" onClick={() => setSelectedId(null)}>Spreadsheets</Button>
      <div className="mb-[22px] flex items-start justify-between gap-5"><div className="min-w-0"><h2 className="break-words text-section font-semibold">{selected.name}</h2><p className="mt-[5px] text-ui-secondary">{types.find(type => type.id === selected.typeId)?.name} · {selected.sheets.length} sheets · {spreadsheetFields(selected).length} mapped fields</p></div><Button variant="secondary" onClick={() => { setEditing(selected); setImportOpen(true); }}>Edit column mappings</Button></div>
      <div className="spreadsheet-detail-tools mb-[14px] flex flex-wrap items-end gap-x-[18px] gap-y-3"><ChoicePicker label="Sheet" value={sheetName} options={selected.sheets.map(entry => ({ value: entry.name, label: entry.name }))} onChange={setSheetName} className="w-[160px] shrink-0" /><div className="min-w-[180px] max-w-[340px] flex-1"><SearchInput aria-label="Search mapped data" placeholder="Search name, EID, PID, email…" value={dataQuery} onChange={event => setDataQuery(event.target.value)} onClear={() => setDataQuery("")} className="rounded-md!" /></div><p className="ml-auto shrink-0 whitespace-nowrap text-right text-caption text-ui-muted">Search uses every mapped field.</p></div>
      <SpreadsheetTable label="Registered spreadsheet rows" fields={fields} rows={rows} rowStart={(sheet?.headerRow ?? 0) + 1} rowNumbers={rows.map(row => MOCK_ROSTER_ROWS.indexOf(row) + (sheet?.headerRow ?? 0) + 1)} />
      <p className="mt-3 text-caption text-ui-muted">{rows.length} fictional records shown</p>
    </> : <>
      <header className="mb-[22px] flex items-start justify-between gap-5"><div><h2 className="text-section font-semibold">Spreadsheets</h2><p className="mt-[5px] text-ui-secondary">Manage registered files and reusable spreadsheet types.</p></div><Button variant="primary" onClick={() => { if (tab === "registered") { setEditing(undefined); setImportOpen(true); } else { setViewType(undefined); setTypeOpen(true); } }}>{tab === "registered" ? "Import spreadsheet" : "Add spreadsheet type"}</Button></header>
      <Tabs value={tab} onValueChange={value => { setTab(value as "registered" | "types"); setSelectedId(null); }}>
      <TabList label="Spreadsheet settings" className="spreadsheet-tabs"><span aria-hidden className="spreadsheet-tabs-indicator" data-types={tab === "types" || undefined} /><Tab value="registered" count={files.length}>Registered spreadsheets</Tab><Tab value="types" count={types.length}>Spreadsheet types</Tab></TabList>
      <TabPanel value="registered">
        <div className="mb-3 flex items-center justify-between gap-5"><div className="w-[280px] shrink-0"><SearchInput aria-label="Find a spreadsheet" placeholder="Find a spreadsheet" value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery("")} className="rounded-md!" /></div><span className="text-caption text-ui-muted">{files.length} registered spreadsheets</span></div>
        <div className="overflow-hidden rounded-lg border border-ui-stroke bg-ui-panel"><table aria-label="Registered spreadsheets" className="w-full border-collapse"><thead className="bg-ui-table text-caption text-ui-muted"><tr>{["Spreadsheet", "Type", "Sheets", "Search", ""].map(label => <th key={label} className="border-b border-ui-stroke px-[14px] py-[9px] text-left font-normal">{label}</th>)}</tr></thead><tbody>{visibleFiles.map(file => <tr key={file.id} className="border-b border-ui-stroke last:border-0"><td className="px-[14px] py-[15px]"><div className="flex items-center gap-3"><span className="flex h-10 w-[34px] shrink-0 items-center justify-center rounded-md border border-ui-stroke bg-ui-table text-ui-positive"><FileSpreadsheet aria-hidden className="size-[19px]" /></span><div className="min-w-0"><Button variant="ghost" className="h-auto max-w-full justify-start p-0 text-body font-semibold text-ui-primary" onClick={() => openFile(file)}>{file.name}</Button><p className="mt-[3px] text-caption text-ui-muted">Fictional registered file</p></div></div></td><td className="px-[14px]"><span className="rounded border border-ui-stroke px-[6px] py-[3px] text-caption">{types.find(type => type.id === file.typeId)?.name}</span></td><td className="px-[14px]">{file.sheets.length}</td><td className="px-[14px] text-caption text-ui-muted">All {spreadsheetFields(file).length} mapped fields</td><td className="w-[45px] px-[14px]"><IconButton label={`Open ${file.name}`} icon={<ArrowRight aria-hidden className="size-[15px]" />} onClick={() => openFile(file)} /></td></tr>)}</tbody></table>{!visibleFiles.length && <p className="p-[30px] text-center text-ui-muted">No spreadsheets match your search.</p>}</div>
        <p className="mt-[14px] text-caption text-ui-muted">Registered spreadsheets are available to Run and Rerun. Importing a file does not start runs.</p>
      </TabPanel><TabPanel value="types">
        <div className="flex flex-col gap-3">{types.map(type => <article key={type.id} className="flex items-center gap-3 rounded-lg border border-ui-stroke bg-ui-panel px-[14px] py-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-ui-stroke bg-ui-table text-ui-muted"><FileSpreadsheet aria-hidden className={dsIcon.md} /></span><div className="min-w-0 flex-1"><h3 className="text-heading font-semibold">{type.name}</h3><p className="mt-[3px] text-caption text-ui-secondary">{type.id === "roster" ? "People, job details and hiring progress." : "A reusable set of named spreadsheet fields."}</p></div><span className="mr-2 shrink-0 text-caption text-ui-muted">{type.fields.length} fields</span><Button variant="secondary" onClick={() => { setViewType(type); setTypeOpen(true); }}>View fields</Button></article>)}</div>
        <p className="mt-[14px] text-caption text-ui-muted">Types define what columns mean. Each imported spreadsheet keeps its own column mappings.</p>
      </TabPanel></Tabs>
    </>}
    <p className="mt-5 text-caption text-ui-muted">Mock preview · fictional data · registration resets on reload.</p>
    <SpreadsheetImportDialog open={importOpen} onOpenChange={setImportOpen} existing={editing} onRegistered={() => { if (!editing) { setTab("registered"); setSelectedId(null); setQuery(""); } }} />
    <SpreadsheetTypeDialog open={typeOpen} onOpenChange={setTypeOpen} type={viewType} />
  </section>;
}
