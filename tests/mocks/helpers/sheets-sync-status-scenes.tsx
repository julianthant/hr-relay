import { createRoot } from "react-dom/client";
import { ExternalLink, RotateCw } from "lucide-react";
import { BodySection, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DsBodyScope, TooltipProvider } from "../../../src/dashboard/ds/ui.js";
import { MoreHorizontal } from "lucide-react";
import { DownloadIcon, TagsFit, V2Button, V2Icon } from "../../../src/dashboard/surfaces/spreadsheets/design/sheets-v2-ui.js";
import { MENU } from "../../../src/dashboard/surfaces/spreadsheets/design/sheets-v2-menu.js";
import type { Sheet } from "../../../src/dashboard/surfaces/spreadsheets/design/sheets-v2-model.js";
import "../../../src/dashboard/surfaces/spreadsheets/design/sheets-v2.css";

/**
 * Mock of the per-row SharePoint sync status in the library list: a status dot and text beneath the SharePoint link in the Source cell,
 * and "Retry sync" in the row menu after a failure. Fictional data; the served shape is {state, lastFinishedAt, lastResult, lastFailureCode} (ui-state-fixes-39).
 */
export type SyncView =
  | { readonly kind: "never" }
  | { readonly kind: "running" }
  | { readonly kind: "idle"; readonly text: string }
  | { readonly kind: "failed"; readonly text: string };

export const SYNC_THEMES = ["light", "dark"] as const;
export const SYNC_WIDTHS = [1280, 1024] as const;

const SP = "https://example.sharepoint.invalid/sites/hr/roster.xlsx";
const sheet = (id: string, name: string, over: Partial<Sheet> = {}): Sheet => ({
  id, name, sharePoint: SP, pinned: false, tags: [], updatedAt: "2026-11-17T09:20:00Z", version: 3, currentVersionId: `${id}-v3`, versions: [], ...over,
});

export const SYNC_ROWS: readonly { sheet: Sheet; sync: SyncView | null }[] = [
  { sheet: sheet("s1", "Onboarding roster", { tags: ["Roster"] }), sync: { kind: "idle", text: "Synced 4 min ago" } },
  { sheet: sheet("s2", "Department codes", { tags: ["Reference"], updatedAt: "2026-10-14T16:02:00Z", version: 7 }), sync: { kind: "idle", text: "Synced Oct 14" } },
  { sheet: sheet("s3", "Separations tracker (spring quarter, all campuses and satellite offices, final reconciled copy)", { updatedAt: "2026-11-17T08:55:00Z" }), sync: { kind: "running" } },
  { sheet: sheet("s4", "Work study awards", { tags: ["Roster", "Reference", "Finance", "Archive"], updatedAt: "2026-11-10T11:12:00Z", version: 2 }), sync: { kind: "failed", text: "Sync failed" } },
  { sheet: sheet("s5", "Position control extract", { updatedAt: "2026-09-01T10:00:00Z", version: 1 }), sync: { kind: "never" } },
  { sheet: sheet("s6", "Payroll rule notes", { sharePoint: null, tags: ["Local"], updatedAt: "2026-11-16T14:40:00Z", version: 4 }), sync: null },
];

const cols = (narrow: boolean) => `grid items-center gap-x-4 ${narrow ? "grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_150px_56px_28px]" : "grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_150px_56px_64px]"}`;
const LINK = "inline-flex max-w-full items-center gap-1 hover:text-ui-primary hover:underline";

function SyncStatus({ sync }: { sync: SyncView }) {
  if (sync.kind === "running") return <span className="inline-flex items-center gap-1 text-ui-info"><RotateCw size={11} aria-hidden className="shrink-0 animate-spin" /><span className="truncate">Syncing…</span></span>;
  const dot = sync.kind === "failed" ? "bg-ui-danger" : sync.kind === "idle" ? "bg-ui-positive" : "bg-ui-stroke";
  const text = sync.kind === "never" ? "Not synced yet" : sync.text;
  return <span className={`inline-flex items-center gap-1.5 ${sync.kind === "failed" ? "text-ui-danger" : ""}`}><span aria-hidden className={`size-1.5 shrink-0 rounded-full ${dot}`} /><span className="truncate">{text}</span></span>;
}

function RowMenu({ sheet, sync, withDownload }: { sheet: Sheet; sync: SyncView | null; withDownload: boolean }) {
  const noop = () => undefined;
  const item = (text: string, disabled = false) => <DropdownMenuItem disabled={disabled} onSelect={noop}>{text}</DropdownMenuItem>;
  return <DropdownMenu><DropdownMenuTrigger render={<V2Icon label={`Actions for ${sheet.name}`}><MoreHorizontal size={16} aria-hidden /></V2Icon>} /><DropdownMenuContent align="end" className={`min-w-[210px] ${MENU}`}>
    {withDownload && item("Download")}
    {item("Pin")}
    {sheet.sharePoint && (sync?.kind === "failed" ? item("Retry sync") : item("Sync now", sync?.kind === "running"))}
    {item(sheet.sharePoint ? "Change SharePoint link…" : "Link to SharePoint…")}
    {item("Clone")}{item("Rename")}{item("Edit tags")}
    <DropdownMenuSeparator />
    <DropdownMenuItem variant="destructive" onSelect={noop}>Delete</DropdownMenuItem>
  </DropdownMenuContent></DropdownMenu>;
}

function Row({ sheet, sync, narrow }: { sheet: Sheet; sync: SyncView | null; narrow: boolean }) {
  return <li tabIndex={0} aria-label={sheet.name} className={`${cols(narrow)} sv2-row border-t border-ui-stroke text-[13px] hover:bg-ui-hover`}>
    <div className="min-w-0">
      <div className="sv2-row-title truncate" title={sheet.name}>{sheet.name}</div>
      <div className="sv2-row-desc truncate tabular-nums text-ui-muted"><span>Updated {new Date(sheet.updatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}</span></div>
    </div>
    <TagsFit sheet={sheet} />
    <div className="min-w-0 text-ui-muted">
      {sheet.sharePoint
        ? <><a href={sheet.sharePoint} className={`${LINK} sv2-row-title`}><span className="truncate">SharePoint</span><ExternalLink size={12} aria-hidden className="shrink-0" /></a>
          {sync && <div className="sv2-row-desc truncate" data-sync={sync.kind}><SyncStatus sync={sync} /></div>}</>
        : <span>Imported</span>}
    </div>
    <div><V2Button look="outline" className="tabular-nums" aria-label={`Versions of ${sheet.name}, now v${sheet.version}`}>v{sheet.version}</V2Button></div>
    <div className="flex justify-end">{!narrow && <DownloadIcon name={sheet.name} onClick={() => undefined} />}<RowMenu sheet={sheet} sync={sync} withDownload={narrow} /></div>
  </li>;
}

export function SyncStatusPage({ narrow }: { narrow: boolean }) {
  return <TooltipProvider><DsBodyScope className="hub-sheets-library" style={{ padding: 16, width: "100vw", boxSizing: "border-box" }}>
    <BodySection title="SharePoint">
      <div className="overflow-hidden sv2-card border border-ui-stroke bg-[var(--ds-card-bg)]">
        <div className={`${cols(narrow)} sv2-head bg-ui-table text-ui-muted`}>{["Spreadsheet", "Tags", "Source", "Version"].map(head => <div key={head}>{head}</div>)}<div /></div>
        <ul aria-label="SharePoint">{SYNC_ROWS.map(({ sheet: row, sync }) => <Row key={row.id} sheet={row} sync={sync} narrow={narrow} />)}</ul>
      </div>
    </BodySection>
  </DsBodyScope></TooltipProvider>;
}

/** Browser entry: theme and width come from the URL. */
export function mountSyncStatusScene(): void {
  const query = new URLSearchParams(location.search);
  const theme = query.get("theme") === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-demo-theme", theme);
  document.body.setAttribute("data-demo-theme", theme);
  const root = document.getElementById("root");
  if (root === null) throw new Error("sheets-sync-status-root-missing");
  createRoot(root).render(<SyncStatusPage narrow={query.get("narrow") === "1"} />);
}
