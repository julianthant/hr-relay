import { useState, type ReactNode } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuItemCopy, DropdownMenuTrigger, IconButton, SearchInput, Select, dsIcon } from "../../ds/ui.js";
import { DropdownMenuCheckboxItem, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "../../ds/primitives/dropdown-menu.js";
import { RunList, RunListRow } from "../../ds/primitives/run-list.js";
import { formatDay } from "../../lib/date-format.js";

export interface SheetVersion { readonly id: string; readonly name: string; readonly savedAt: string }
export interface SheetWorksheet { readonly sheetId: string; readonly sheetName: string }

/** One library spreadsheet the picker can offer. `names` is every worksheet name the search also matches. */
export interface PickerOption { readonly libraryId: string; readonly name: string; readonly description: string; readonly names: readonly string[]; readonly pinned: boolean; readonly disabled: boolean }

const GUIDANCE = "Pinned spreadsheets show here. Search for the rest.";

/** The one spreadsheet picker: a Add spreadsheet button that opens a searchable list. An empty search lists the pinned spreadsheets; typing searches every spreadsheet and worksheet name, A-Z. */
export function SpreadsheetPicker({ label, options, busy, onPick }: {
  label: string; options: readonly PickerOption[]; busy: boolean; onPick: (libraryId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const found = needle === "" ? options.filter(option => option.pinned)
    : options.filter(option => [option.name, ...option.names].some(name => name.toLowerCase().includes(needle))).toSorted((a, b) => a.name.localeCompare(b.name));
  return <DropdownMenu onOpenChange={open => { if (open) setQuery(""); }}>
    <DropdownMenuTrigger asChild><Button variant="secondary" disabled={busy} icon={<Plus aria-hidden className={dsIcon.md} />}>{label}</Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="max-h-80 w-80 overflow-y-auto">
      <div className="p-1" onKeyDown={event => { if (event.key !== "Escape") event.stopPropagation(); }}>
        <SearchInput variant="field" aria-label="Find a spreadsheet" placeholder="Find a spreadsheet" value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" spellCheck={false} />
      </div>
      {needle === "" && found.length > 0 && <DropdownMenuGroup><DropdownMenuLabel>Pinned</DropdownMenuLabel></DropdownMenuGroup>}
      {found.length === 0 && <p className="m-0 p-2 text-body text-ui-muted">{needle === "" ? GUIDANCE : "No spreadsheets match."}</p>}
      {found.map(option => <DropdownMenuItem key={option.libraryId} disabled={option.disabled} onClick={() => onPick(option.libraryId)}>
        <DropdownMenuItemCopy title={option.name} description={option.description} />
      </DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}

/** The worksheet control of a picked spreadsheet: one worksheet (radio) or several (checks). */
function WorksheetMenu({ owner, worksheets, picked, mode, disabled, onChange }: {
  owner: string; worksheets: readonly SheetWorksheet[]; picked: readonly string[]; mode: "one" | "many"; disabled: boolean; onChange: (sheetIds: readonly string[]) => void;
}) {
  const names = worksheets.filter(worksheet => picked.includes(worksheet.sheetId)).map(worksheet => worksheet.sheetName);
  const text = names.length === 0 ? "Choose worksheet" : names.length === 1 ? names[0] : `${names.length} worksheets`;
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button variant="outline" disabled={disabled} aria-label={mode === "one" ? `${owner} worksheet, ${names[0] ?? "none chosen"}` : `${owner} worksheets, ${names.length === 0 ? "none chosen" : text}`}
      className="ds-menu-trigger w-36 min-w-0 justify-between" iconAfter={<ChevronDown aria-hidden />}><span className="min-w-0 truncate">{text}</span></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="max-h-80 w-72 overflow-y-auto"><DropdownMenuGroup>
      <DropdownMenuLabel>{owner}</DropdownMenuLabel>
      {mode === "one"
        ? <DropdownMenuRadioGroup value={picked[0] ?? ""} onValueChange={sheetId => onChange([sheetId])}>
          {worksheets.map(worksheet => <DropdownMenuRadioItem key={worksheet.sheetId} value={worksheet.sheetId}>{worksheet.sheetName}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
        : worksheets.map(worksheet => <DropdownMenuCheckboxItem key={worksheet.sheetId} checked={picked.includes(worksheet.sheetId)}
          onCheckedChange={on => { const next = on === true ? [...picked, worksheet.sheetId] : picked.filter(id => id !== worksheet.sheetId); if (next.length > 0) onChange(next); }}>{worksheet.sheetName}</DropdownMenuCheckboxItem>)}
    </DropdownMenuGroup></DropdownMenuContent>
  </DropdownMenu>;
}

/** "v2 · Updated Nov 18, 2026": the version in use and when it was saved. */
function versionLine(versions: readonly SheetVersion[], versionId: string): string | undefined {
  const version = versions.find(candidate => candidate.id === versionId);
  return version === undefined ? undefined : `${version.name} · Updated ${formatDay(version.savedAt)}`;
}

/** One picked spreadsheet: name and version line left; worksheets, version and remove right. */
export function SpreadsheetRow({ name, versions, versionId, note, worksheets, picked, mode, busy, worksheetsReady, onVersion, onWorksheets, onRemove }: {
  name: string; versions: readonly SheetVersion[]; versionId: string; note?: string | undefined;
  worksheets: readonly SheetWorksheet[]; picked: readonly string[]; mode: "one" | "many"; busy: boolean; worksheetsReady: boolean;
  onVersion: (versionId: string) => void; onWorksheets: (sheetIds: readonly string[]) => void; onRemove: () => void;
}) {
  return <RunListRow title={name} description={note ?? versionLine(versions, versionId)}>
    <WorksheetMenu owner={name} worksheets={worksheets} picked={picked} mode={mode} disabled={busy || !worksheetsReady} onChange={onWorksheets} />
    <Select aria-label={`${name} version`} variant="toolbar" className="max-w-36 min-w-20" disabled={busy} value={versionId} onChange={event => onVersion(event.target.value)}>
      {versions.map(version => <option key={version.id} value={version.id}>{version.name}</option>)}
    </Select>
    <IconButton size="xs" label={`Remove ${name}`} icon={<X aria-hidden className={dsIcon.md} />} onClick={onRemove} />
  </RunListRow>;
}

/** An input section: title and description left, the one add button right, the picked items listed under it. */
export function SpreadsheetSection({ title, description, picker, children }: { title: string; description: string; picker: ReactNode; children?: ReactNode }) {
  return <RunList label={title}>
    <RunListRow title={title} description={description}>{picker}</RunListRow>
    {children}
  </RunList>;
}
