import { ChevronDown, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { RunList, RunListRow } from "../../ds/primitives/run-list.js";
import { DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "../../ds/primitives/dropdown-menu.js";
import { Banner, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuItemCopy, DropdownMenuTrigger, IconButton, Select, dsIcon } from "../../ds/ui.js";

export interface ReferenceSheet { readonly libraryId: string; readonly name: string; readonly versions: readonly { readonly id: string; readonly name: string }[]; readonly currentVersionId: string; readonly worksheets: readonly string[] }
export interface ReferenceWorksheet { readonly sheetId: string; readonly sheetName: string }

/** The served Run and Rerun dialogs' reference spreadsheet list: the approved rows (spreadsheet, worksheet picker, version picker, remove ×) and the Add spreadsheet search menu, over the library the run reads. One spreadsheet per run: adding another replaces the current one. */
export function RunReferenceRows({ requiredLabel, sheets, chosenLibraryId, chosenVersionId, chosenSheetId, worksheets, worksheetsState, worksheetsError, busy, catalogError, onPick, onVersion, onWorksheet, onRemove, onRefresh }: {
  requiredLabel: string; sheets: readonly ReferenceSheet[];
  chosenLibraryId?: string; chosenVersionId?: string; chosenSheetId: string;
  worksheets: readonly ReferenceWorksheet[]; worksheetsState: "loading" | "ready" | "error"; worksheetsError: string | null;
  busy: boolean; catalogError: string | null;
  onPick: (libraryId: string, versionId: string) => void; onVersion: (versionId: string) => void; onWorksheet: (sheetId: string) => void; onRemove: () => void; onRefresh: () => void;
}) {
  const [query, setQuery] = useState("");
  const chosen = sheets.find(sheet => sheet.libraryId === chosenLibraryId);
  const needle = query.trim().toLowerCase();
  // The library serves no pins, so an empty search shows the guidance line; typing searches every spreadsheet and worksheet name, A-Z.
  const found = needle === "" ? [] : sheets.filter(sheet => [sheet.name, ...sheet.worksheets].some(name => name.toLowerCase().includes(needle))).toSorted((a, b) => a.name.localeCompare(b.name));
  const missingSheet = chosenSheetId !== "" && !worksheets.some(sheet => sheet.sheetId === chosenSheetId);
  useEffect(() => {
    if (chosenSheetId === "" && worksheetsState === "ready" && worksheets.length > 0) onWorksheet(worksheets[0].sheetId);
  }, [chosenSheetId, worksheetsState, worksheets, onWorksheet]);
  const current = worksheets.find(sheet => sheet.sheetId === chosenSheetId)?.sheetName;
  return <div className="flex min-w-0 flex-col gap-3">
    {catalogError !== null && <Banner tone="danger" title="Reference data unavailable">{catalogError}<Button onClick={onRefresh}>Refresh</Button></Banner>}
    <RunList title="Reference spreadsheets" description={`Spreadsheets this run looks people up in. Needs ${requiredLabel}.`}>
      {chosen && <RunListRow title={chosen.name} description={missingSheet ? "Previous worksheet unavailable; choose again" : current ?? (worksheetsState === "loading" ? "Loading worksheets…" : undefined)}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline" disabled={busy || worksheetsState !== "ready"} aria-label={`${chosen.name} worksheet, ${current ?? "none chosen"}`} className="ds-menu-trigger w-[150px] min-w-0 justify-between" iconAfter={<ChevronDown aria-hidden />}><span className="min-w-0 truncate">{current ?? "Choose worksheet"}</span></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[280px] max-h-[320px] overflow-y-auto"><DropdownMenuGroup>
            <DropdownMenuLabel>{chosen.name}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={chosenSheetId} onValueChange={onWorksheet}>
              {worksheets.map(sheet => <DropdownMenuRadioItem key={sheet.sheetId} value={sheet.sheetId}>{sheet.sheetName}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup></DropdownMenuContent>
        </DropdownMenu>
        <Select aria-label={`${chosen.name} version`} variant="toolbar" className="w-[76px]" disabled={busy} value={chosenVersionId ?? chosen.currentVersionId} onChange={event => onVersion(event.target.value)}>
          {chosen.versions.map((version, index) => <option key={version.id} value={version.id}>{version.name || `v${chosen.versions.length - index}`}</option>)}
        </Select>
        <IconButton size="xs" label={`Remove ${chosen.name}`} icon={<X aria-hidden className={dsIcon.md} />} onClick={onRemove} />
      </RunListRow>}
    </RunList>
    {worksheetsState === "error" && <p role="alert" className="m-0 text-caption text-ui-danger">{worksheetsError}</p>}
    {chosen && worksheetsState === "ready" && worksheets.length === 0 && <p role="status" className="m-0 text-caption text-ui-muted">No worksheets in this version have {requiredLabel}.</p>}
    <div><DropdownMenu onOpenChange={open => { if (open) setQuery(""); }}>
      <DropdownMenuTrigger asChild><Button variant="outline" disabled={busy} className="ds-menu-trigger" iconAfter={<ChevronDown aria-hidden />}>{chosen ? "Change spreadsheet" : "Add spreadsheet"}</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[320px] max-h-[320px] overflow-y-auto">
        <div className="ds-menu-search-row" onKeyDown={event => { if (event.key !== "Escape") event.stopPropagation(); }}>
          <Search aria-hidden /><input aria-label="Find a spreadsheet" placeholder="Find a spreadsheet" value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" spellCheck={false} />
        </div>
        {found.length === 0 && <p className="m-0 px-2 py-2 text-[13px] leading-[18px] text-ui-muted">{needle === "" ? "Pin spreadsheets in Spreadsheets to list them here. Search finds the rest." : "No spreadsheets match."}</p>}
        {found.map(sheet => {
          const uncoverable = sheet.worksheets.length === 0;
          return <DropdownMenuItem key={sheet.libraryId} disabled={uncoverable} onClick={() => onPick(sheet.libraryId, sheet.currentVersionId)}>
            <DropdownMenuItemCopy title={sheet.name} description={uncoverable ? `No worksheet has ${requiredLabel}` : sheet.worksheets.join(", ")} />
          </DropdownMenuItem>;
        })}
      </DropdownMenuContent>
    </DropdownMenu></div>
  </div>;
}
