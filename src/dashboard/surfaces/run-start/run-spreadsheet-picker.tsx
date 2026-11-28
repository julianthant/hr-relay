import { useState, type ReactNode } from "react";
import { ChevronDown, Plus, Table2, X } from "lucide-react";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuItemCopy, DropdownMenuTrigger, IconButton, SearchInput, Select, Tooltip, TooltipProvider, dsIcon } from "../../ds/ui.js";
import { DropdownMenuCheckboxItem, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "../../ds/primitives/dropdown-menu.js";
import { RunHeading, RunList, RunListRow } from "../../ds/primitives/run-list.js";
import { formatMonthDay } from "../../lib/date-format.js";

export interface SheetVersion { readonly id: string; readonly name: string; readonly savedAt: string }
export interface SheetWorksheet { readonly sheetId: string; readonly sheetName: string }

/** One library spreadsheet the picker can offer; `description` says why one cannot be used as it is. */
export interface PickerOption { readonly libraryId: string; readonly name: string; readonly description?: string; readonly pinned: boolean; readonly disabled: boolean }

const GUIDANCE = "Pin spreadsheets in Spreadsheets to list them here. Search finds the rest.";

/** The one spreadsheet picker: a Add spreadsheet button that opens a searchable list. An empty search lists the pinned spreadsheets; typing searches every spreadsheet name, A-Z. */
export function SpreadsheetPicker({ label, options, busy, onPick }: {
  label: string; options: readonly PickerOption[]; busy: boolean; onPick: (libraryId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const found = needle === "" ? options.filter(option => option.pinned)
    : options.filter(option => option.name.toLowerCase().includes(needle)).toSorted((a, b) => a.name.localeCompare(b.name));
  return <DropdownMenu onOpenChange={open => { if (open) setQuery(""); }}>
    <DropdownMenuTrigger asChild><Button variant="secondary" disabled={busy} icon={<Plus aria-hidden className={dsIcon.md} />}>{label}</Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="max-h-80 w-80 overflow-y-auto">
      <div className="p-1" onKeyDown={event => { if (!["Escape", "ArrowDown", "ArrowUp"].includes(event.key)) event.stopPropagation(); }}>
        <SearchInput aria-label="Find a spreadsheet" placeholder="Find a spreadsheet" value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" spellCheck={false} />
      </div>
      {needle === "" && found.length > 0 && <DropdownMenuGroup><DropdownMenuLabel>Pinned</DropdownMenuLabel></DropdownMenuGroup>}
      {found.length === 0 && <p className="m-0 p-2 text-body text-ui-muted">{needle === "" ? GUIDANCE : "No spreadsheets match."}</p>}
      {found.length > 0 && <TooltipProvider>{found.map(option => <Tooltip key={option.libraryId} content={option.name} side="left" variant="wrap"><div role="group" aria-label={option.name}>
        <DropdownMenuItem disabled={option.disabled} onClick={() => onPick(option.libraryId)}>
          <DropdownMenuItemCopy title={option.name} description={option.description} />
        </DropdownMenuItem>
      </div></Tooltip>)}</TooltipProvider>}
    </DropdownMenuContent>
  </DropdownMenu>;
}

/** The worksheet chip of a picked spreadsheet: a searchable menu, newest worksheet first, for one worksheet (radio) or several (checks). */
function WorksheetMenu({ owner, worksheets, picked, mode, disabled, max, onChange }: {
  owner: string; worksheets: readonly SheetWorksheet[]; picked: readonly string[]; mode: "one" | "many"; disabled: boolean; max?: number | undefined; onChange: (sheetIds: readonly string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const found = worksheets.filter(worksheet => worksheet.sheetName.toLowerCase().includes(needle)).toReversed();
  const names = worksheets.filter(worksheet => picked.includes(worksheet.sheetId)).map(worksheet => worksheet.sheetName);
  const text = names.length === 0 ? "Choose worksheet" : names.length === 1 ? names[0] : `${names.length} worksheets`;
  return <DropdownMenu onOpenChange={open => { if (open) setQuery(""); }}>
    <DropdownMenuTrigger asChild><Button variant="outline" size="sm" disabled={disabled} aria-label={mode === "one" ? `${owner} worksheet, ${names[0] ?? "none chosen"}` : `${owner} worksheets, ${names.length === 0 ? "none chosen" : text}`}
      className="ds-menu-trigger max-w-48 min-w-0" iconAfter={<ChevronDown aria-hidden className={dsIcon.sm} />}><span className="min-w-0 truncate">{text}</span></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-64">
      <div className="p-1" onKeyDown={event => { if (!["Escape", "ArrowDown", "ArrowUp"].includes(event.key)) event.stopPropagation(); }}>
        <SearchInput aria-label="Find a worksheet" placeholder="Find a worksheet" value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" spellCheck={false} />
      </div>
      <DropdownMenuGroup aria-label={`${owner} worksheets`} className="max-h-56 overflow-y-auto">
        {mode === "one"
          ? <DropdownMenuRadioGroup value={picked[0] ?? ""} onValueChange={sheetId => onChange([sheetId])}>
            {found.map(worksheet => <DropdownMenuRadioItem key={worksheet.sheetId} value={worksheet.sheetId}>{worksheet.sheetName}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
          : found.map(worksheet => <DropdownMenuCheckboxItem key={worksheet.sheetId} checked={picked.includes(worksheet.sheetId)} disabled={max !== undefined && picked.length >= max && !picked.includes(worksheet.sheetId)}
            onCheckedChange={on => { const next = on === true ? [...picked, worksheet.sheetId] : picked.filter(id => id !== worksheet.sheetId); if (next.length > 0) onChange(next); }}>{worksheet.sheetName}</DropdownMenuCheckboxItem>)}
      </DropdownMenuGroup>
      {found.length === 0 && <p className="m-0 p-2 text-body text-ui-muted">No worksheets match.</p>}
      <p className="ds-menu-label m-0">{max !== undefined && picked.length >= max ? `${max} worksheets is the most for one run` : worksheets.length === 1 ? "1 worksheet" : `${worksheets.length} worksheets`}</p>
    </DropdownMenuContent>
  </DropdownMenu>;
}

/** One picked spreadsheet: name left; worksheet chip, "v6 · Nov 24" version choice and remove right. `note` says what stops the row. */
export function SpreadsheetRow({ name, versions, versionId, note, worksheets, picked, mode, busy, locked = false, worksheetsReady, max, onVersion, onWorksheets, onRemove }: {
  name: string; versions: readonly SheetVersion[]; versionId: string; note?: string | undefined;
  worksheets: readonly SheetWorksheet[]; picked: readonly string[]; mode: "one" | "many"; busy: boolean; locked?: boolean; worksheetsReady: boolean; max?: number | undefined;
  onVersion: (versionId: string) => void; onWorksheets: (sheetIds: readonly string[]) => void; onRemove: () => void;
}) {
  return <RunListRow title={name} description={note} lead={<Table2 aria-hidden className={`${dsIcon.md} shrink-0 text-ui-muted`} />}>
    <WorksheetMenu owner={name} worksheets={worksheets} picked={picked} mode={mode} disabled={busy || !worksheetsReady} max={max} onChange={onWorksheets} />
    <Select aria-label={`${name} version`} variant="toolbar" className="min-w-0 max-w-52 !border-transparent !bg-transparent !text-ui-muted tabular-nums" disabled={busy} value={versionId} onChange={event => onVersion(event.target.value)}>
      {versions.map(({ id, name, savedAt }) => {
        const label = `${name} · ${formatMonthDay(savedAt, undefined, "short")}`;
        return <option key={id} value={id}><span className="block min-w-0 truncate" title={label}>{label}</span></option>;
      })}
    </Select>
    <IconButton size="xs" label={`Remove ${name}`} disabled={locked} icon={<X aria-hidden className={dsIcon.md} />} onClick={onRemove} />
  </RunListRow>;
}

/** An input section: title and description left, the one add button right, the picked items in a card under it. */
export function SpreadsheetSection({ title, description, picker, children }: { title: string; description: string; picker: ReactNode; children?: ReactNode }) {
  return <div role="region" aria-label={title} className="flex min-w-0 flex-col gap-2.5">
    <div className="flex items-center justify-between gap-4"><RunHeading title={title} description={description} />{picker}</div>
    <RunList>{children || <p className="m-0 py-3 text-[12px] text-ui-muted">None added</p>}</RunList>
  </div>;
}
