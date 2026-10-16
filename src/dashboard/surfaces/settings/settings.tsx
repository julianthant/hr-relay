import { useSpreadsheetWiringAdapter } from "../../state/spreadsheet-wiring-adapter.js";
import { useViewState } from "../../app/navigation/view-route-model.js";
import type { EditableWorkbook } from "../spreadsheets/spreadsheet-editor-model.js";
import "./settings-data.css";
import { SpreadsheetsSettings } from "../spreadsheets/spreadsheets.js";
import { EditableSettingsSectionIdSchema } from "../../../models/dashboard/settings-editor.js";
import { SettingsAuthoritySection } from "./editor/settings-authorities.js";
import { ArrowLeft, BarChart3, Workflow, CircleAlert, ClipboardCheck, Database, FolderOpen, Gauge, Keyboard as KeyboardIcon, Link2, Monitor, Settings as SettingsIcon, SlidersHorizontal, Table2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { FrontendBootstrapWire } from "../../../models/dashboard/bootstrap.js";
import { SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID } from "../../../models/dashboard/settings.js";
import { Banner, Button, Dialog, DialogContent, DialogFooter, DsBodyScope, IconButton, SearchInput, SectionLabel, StatusDot, TakeoverFrame, dsFocus, dsMotion, dsIcon, dsSurface, dsText } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";
import { plural } from "../shared/status/format.js";
import type { SettingsSaveListener, SettingsSaveProblemListener } from "./editor/settings-attempt-model.js";
import { useEditableSettings } from "./editor/settings-editor-model.js";
import { EditableSettingsSection } from "./editor/settings-editor.js";
import { RoutesSection } from "./routes/settings-routes.js";
import { KeyboardSection } from "./navigation/settings-keyboard.js";
import { PreflightSection } from "./preflight/settings-preflight.js";
import { SETTINGS_DATA_SECTION_IDS, SETTINGS_GEAR_ID, SETTINGS_KEYBOARD_SECTION_ID, SETTINGS_PREFLIGHT_SECTION_ID, buildSettingsNav, resolveSettingsSection, type SettingsNavEntry, type SettingsNavIcon, type SettingsSection } from "./settings-model.js";
import { storageNeedsAttention, type StorageHealthSummary } from "./storage/storage-settings-model.js";
import { StorageSection } from "./storage/storage-settings.js";
import { searchSettings, settingsSearchIndex, type SettingsSearchResult } from "./navigation/settings-search-model.js";
import { SettingsSearchTargetContext, useSettingsSearchArrival } from "./navigation/settings-search-target-model.js";


export type { SettingsSection,StorageHealthSummary };


/** The served sections this build has a renderer for. */
const RENDERED_SERVED_SECTION_IDS: ReadonlySet<string> = new Set([
  ...EditableSettingsSectionIdSchema.options,
  "credentials",
  "storage",
  SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID,
]);


const NAV_ICON: Record<SettingsNavIcon, typeof Database> = {
  general: SlidersHorizontal,
  display: Monitor,
  performance: Gauge,
  paths: FolderOpen,
  storage: Database,
  preflight: ClipboardCheck,
  routes: Link2,
  capabilities: Table2,
  keyboard: KeyboardIcon,
  unrendered: CircleAlert,
  spreadsheets: Table2,
  explorer: Workflow,
  activity: BarChart3,
};


/** One nav entry. */
function SectionButton({
  entry,
  active,
  onClick,
}: {
  entry: SettingsNavEntry;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = NAV_ICON[entry.icon];
  return (
    <a
            // A real href — not a `button` — so middle-click and Cmd/Ctrl-click work as usual.
      // new tab" all work the way any other in-page navigation does.
      href={`?settings=${encodeURIComponent(entry.id)}`}
      aria-current={active ? "page" : undefined}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onClick();
      }}
      className={cn(
        "flex h-[var(--ds-h-settings-nav-row)] min-w-0 items-center gap-[var(--ds-space-snug)] rounded-[var(--ds-radius-settings-nav)]",
        "px-[var(--ds-space-cozy)] text-[length:var(--ds-text-body-row)] text-left text-[color:var(--ds-fg)]",
        dsFocus,
        dsMotion.base,
        active
          ? "bg-[var(--ds-surface-selected)] font-normal"
          : "font-normal hover:bg-[var(--ds-surface-3)]",
      )}
    >
      <Icon aria-hidden className={cn(dsIcon.md, "shrink-0")} />
      <span className="truncate">{entry.label}</span>
    </a>
  );
}

function SearchResultLink({ result, active, onSelect }: { result: SettingsSearchResult; active: boolean; onSelect: () => void }) {
  const Icon = NAV_ICON[result.entry.icon];
  const params = new URLSearchParams({ settings: result.entry.id });
  if (result.target !== undefined) params.set("settingsTarget", result.target);
  return <a href={`?${params.toString()}`} aria-current={active ? "location" : undefined}
    className={cn("settings-search-result", dsFocus, active && "settings-search-result-active")}
    onClick={event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); onSelect();
    }}>
    <Icon aria-hidden className={dsIcon.md} /><span><span>{result.label}</span><small>{result.context}</small></span>
  </a>;
}


/** Settings navigation is shared because both gear and storage doors open the same page. */
export function SettingsGear({
  storage,
  open,
  onOpen,
}: {
  storage: StorageHealthSummary;
  open: boolean;
  onOpen: () => void;
}) {
  const attention = storageNeedsAttention(storage);
  return (
    <IconButton
      id={SETTINGS_GEAR_ID}
      size="sm"
      label={attention ? "Settings — storage needs attention" : "Settings"}
      // Expose pressed state visually and accessibly so the takeover never appears closed.
      aria-pressed={open}
      onClick={onOpen}
      className={cn(open && "bg-[var(--ds-surface-3)] text-[color:var(--ds-fg)]")}
      icon={
        <span className="relative inline-flex">
          <SettingsIcon aria-hidden className={dsIcon.md} />
          {attention && (
            <span aria-hidden className="pointer-events-none absolute right-[-3px] top-[-3px]">
              <StatusDot status={storage.authority === "healthy" ? "waiting" : "failed"} />
            </span>
          )}
        </span>
      }
    />
  );
}



export function SettingsPage({
  storage,
  sections,
  workflowLabels,
  section,
  searchTarget,
  dataContent,
  appearance,
  spreadsheetSource,
  actorId,
  descriptorFingerprint,
  preflight: _preflight,
  onSection,
  onExitGuardChange,
  onSaved,
  onSaveProblem,
  onClose,
}: {
  storage: StorageHealthSummary;
  sections: readonly SettingsSection[];
  /** Join capability rows to the bootstrap’s single workflow label source. */
  workflowLabels: ReadonlyMap<string, string>;
  /** the open section id — `""` is the page's own default, from `?settings=` */
  section: string;
  searchTarget?: string;
  dataContent?: ReactNode;
  appearance?: ReactNode;
  spreadsheetSource?: "mock" | "served";
  actorId: string;
  descriptorFingerprint: string;
  preflight: NonNullable<FrontendBootstrapWire["preflight"]>;
  onSection: (next: string, target?: string) => void;
  /** Lets the shell route every Settings-unmounting control through this draft owner. */
  onClose: () => void;
  onSaved?: SettingsSaveListener;
  onSaveProblem?: SettingsSaveProblemListener;
  onExitGuardChange?: (guard: ((proceed: () => void) => void) | undefined) => void;
}) {
  const [workbookDraft, setWorkbookDraft] = useState<{ document: EditableWorkbook | null; dirty: boolean }>({ document: null, dirty: false });
  const spreadsheets = useSpreadsheetWiringAdapter(false, null);
  const onWorkbook = (document: EditableWorkbook | null, dirty: boolean) => setWorkbookDraft({ document, dirty });
  const editor = useEditableSettings({ actorId, descriptorFingerprint, onSaved, onSaveProblem });
  const [pendingExit, setPendingExit] = useState<(() => void) | undefined>(undefined);
  const exitFocusTarget = useRef<HTMLElement | null>(null);
  const settingsDocument = editor.editor.state === "loaded" ? editor.editor.document : undefined;
  const groups = useMemo(() => buildSettingsNav(sections, settingsDocument), [sections, settingsDocument]);
  const resolution = resolveSettingsSection(groups, section);
  const activeId = resolution.state === "open" ? resolution.entry.id : undefined;
  const isDataSection = activeId !== undefined && SETTINGS_DATA_SECTION_IDS.has(activeId);
  if (isDataSection && dataContent === undefined) throw new Error("SETTINGS_DATA_CONTENT_UNAVAILABLE");
  const [navQuery, setNavQuery] = useViewState("settingsQuery", "", "replace");
  const [searchVisit, setSearchVisit] = useState(0);
  const navSearch = useRef<HTMLInputElement>(null);
  const searchResults = useRef<HTMLDivElement>(null);
  const index = useMemo(() => settingsSearchIndex(groups, settingsDocument, editor.relocationEditor.read.state === "available"), [groups, settingsDocument, editor.relocationEditor.read.state]);
  const results = useMemo(() => searchSettings(index, navQuery), [index, navQuery]);
  const selectedResult = index.find(result => result.target === searchTarget && result.entry.id === activeId);
  const target = selectedResult?.target;
  const pathTargetLoading = activeId === "paths" && (searchTarget === "paths.stateRoot" || searchTarget === "paths.artifactRoot") && editor.relocationEditor.read.state === "loading";
  const searchContext = useMemo(() => ({ target, visit: searchVisit }), [target, searchVisit]);
  const content = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  useEffect(() => {
    const element = content.current;
    if (!element || activeId === undefined) return;
    if (searchTarget === undefined) element.scrollTop = scrollPositions.current.get(activeId) ?? 0;
    const remember = () => scrollPositions.current.set(activeId, element.scrollTop);
    element.addEventListener("scroll", remember, { passive: true });
    return () => { element.removeEventListener("scroll", remember); };
  }, [activeId, searchTarget, searchVisit]);
  useSettingsSearchArrival(content, target, searchVisit, activeId, selectedResult?.label);
  const settingsEntries = groups.filter(group => group.id === "personal" || group.id === "advanced").flatMap(group => group.entries);
  const activeSettingsEditorSection = activeId !== undefined && settingsEntries.some(entry => entry.id === activeId);
  const totalDirty = (workbookDraft.dirty ? 1 : 0) + editor.dirtyCount + editor.protectedEditor.dirtyCount + editor.relocationEditor.dirtyCount;
  const relocationUncertain = editor.relocationEditor.uncertain;
  const hasDirtyDraft = totalDirty > 0 || relocationUncertain;

  useEffect(() => {
    if (!hasDirtyDraft) return undefined;
    const preventUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      // Browsers ignore custom beforeunload copy, but the assigned value is the
      // cross-browser signal that this page has an unsaved atomic draft.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [hasDirtyDraft]);

  const requestExit = useCallback((proceed: () => void): void => {
    if (hasDirtyDraft) {
      exitFocusTarget.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setPendingExit(() => proceed);
      return;
    }
    proceed();
  }, [hasDirtyDraft]);

  useEffect(() => {
    onExitGuardChange?.(requestExit);
    return () => onExitGuardChange?.(undefined);
  }, [onExitGuardChange, requestExit]);

  const discardAndExit = (): void => {
    if (pendingExit === undefined) throw new Error("Settings discard was confirmed without a pending exit");
    exitFocusTarget.current = null;
    if (spreadsheetSource !== "mock") spreadsheets.adapter.discard();
    setWorkbookDraft({ document: null, dirty: false });
    editor.discard();
    editor.protectedEditor.discard();
    editor.relocationEditor.discard();
    setPendingExit(undefined);
    pendingExit();
  };

  return (
    <TakeoverFrame label="Settings" direction="row" animateFrame={false} className="settings-takeover">
      <nav aria-label="Settings sections" className="settings-panel-nav rail-scroll">
        <header className="settings-nav-header"><h2>Settings</h2><IconButton label="Back to dashboard" size="sm" icon={<ArrowLeft className={dsIcon.md} />} onClick={() => requestExit(onClose)} /></header>
        <SearchInput ref={navSearch} aria-label="Search settings" placeholder="Search" value={navQuery} onChange={event => setNavQuery(event.target.value)} onClear={() => setNavQuery("")} className="settings-nav-search"
          aria-controls={navQuery.trim() ? "settings-search-results" : undefined}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "ArrowDown" && results.length > 0) { event.preventDefault(); searchResults.current?.querySelector<HTMLElement>("a")?.focus(); }
            if (event.key === "Enter" && results[0]) { event.preventDefault(); setSearchVisit(visit => visit + 1); onSection(results[0].entry.id, results[0].target); }
          }} />
        {navQuery.trim() ? <div id="settings-search-results" ref={searchResults} className="settings-search-results" onKeyDown={event => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          const links = [...(searchResults.current?.querySelectorAll<HTMLElement>("a") ?? [])];
          const current = links.indexOf(document.activeElement as HTMLElement);
          if (current < 0) return;
          event.preventDefault();
          if (event.key === "ArrowUp" && current === 0) navSearch.current?.focus();
          else links[Math.min(links.length - 1, current + (event.key === "ArrowDown" ? 1 : -1))]?.focus();
        }}>
          {results.length > 0 && <span className="sr-only" role="status">{plural(results.length, "setting")} found</span>}
          {results.map(result => <SearchResultLink key={result.id} result={result} active={result.entry.id === activeId && result.target === searchTarget} onSelect={() => { setSearchVisit(visit => visit + 1); onSection(result.entry.id, result.target); }} />)}
          {results.length === 0 && <p role="status" className="text-caption text-ui-muted px-3">{editor.editor.state === "loading" || editor.relocationEditor.read.state === "loading" ? "Reading settings…" : editor.editor.state === "failed" ? "Settings fields unavailable" : "No settings found"}</p>}
        </div> : groups.map(group => <div key={group.id} className="settings-nav-group"><span>{group.heading}</span>{group.entries.map(entry => <SectionButton key={entry.id} entry={entry} active={entry.id === activeId} onClick={() => onSection(entry.id)} />)}</div>)}
      </nav>

      <div id="dashboard-settings-content" data-settings-target={target} tabIndex={-1} ref={content} className={cn("settings-content flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-[var(--ds-space-section)] py-[var(--ds-space-page)]", dsSurface.bodyPage)}>
        <SettingsSearchTargetContext.Provider value={searchContext}><DsBodyScope className={cn("settings-tab-body flex flex-col gap-[var(--ds-space-page)]")}>
        {searchTarget !== undefined && settingsDocument !== undefined && target === undefined && !pathTargetLoading && <Banner tone="warning" title="Setting unavailable">This setting is unavailable on the selected page.</Banner>}
        {editor.editor.state === "failed" && !activeSettingsEditorSection
          && !isDataSection
          && activeId !== "spreadsheets"
          && activeId !== SETTINGS_PREFLIGHT_SECTION_ID
          && activeId !== SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID && (
          <Banner tone="danger" title="Editable settings unavailable">
            {editor.editor.message.replace(/ Try again\.$/u, "")} <Button size="sm" variant="secondary" onClick={editor.reload}>Try again</Button>
          </Banner>
        )}
        {/* Refuse unknown settings destinations; redirecting would label the wrong page as the requested one. */}
        {resolution.state === "unknown" && (
          resolution.requested === "ui-catalog" ? <Banner tone="info" title="UI catalog removed">Use the Settings navigation to return to a dashboard page.</Banner> : resolution.requested === "archive" ? <Banner tone="info" title="Archive page removed">
            Existing stored run data has not been deleted. <Button variant="ghost" onClick={() => requestExit(onClose)}>Return to dashboard</Button>
          </Banner> : <Banner tone="danger" title="No such settings section">
            This build has no settings section called “{resolution.requested}”. Pick one from the
            list beside this.
          </Banner>
        )}
        {resolution.state === "empty" && (
          <Banner tone="warning" title="No settings sections">
            The server listed no settings sections and this build contributes none.
          </Banner>
        )}
        {isDataSection && dataContent}
        {resolution.state === "open" && resolution.entry.id === "spreadsheets" && <SpreadsheetsSettings source={spreadsheetSource} workbook={workbookDraft.document} workbookDirty={workbookDraft.dirty} onWorkbook={onWorkbook} />}
        {resolution.state === "open" && resolution.entry.id === SETTINGS_KEYBOARD_SECTION_ID && <KeyboardSection onSaved={onSaved} />}
        {resolution.state === "open" && resolution.entry.id === "storage" && <StorageSection storage={storage} />}
        {resolution.state === "open" && resolution.entry.id === SETTINGS_PREFLIGHT_SECTION_ID && <PreflightSection editor={editor} workflowLabels={workflowLabels} />}
        {resolution.state === "open" && resolution.entry.id === "routes" && <RoutesSection editor={editor} />}
        {resolution.state === "open" && resolution.entry.id !== "routes" && EditableSettingsSectionIdSchema.safeParse(resolution.entry.id).success && (
          <EditableSettingsSection editor={editor} sectionId={resolution.entry.id} appearance={appearance} />
        )}
        {resolution.state === "open" && resolution.entry.id === "credentials" && <SettingsAuthoritySection editor={editor} sectionId="credentials" />}
        {resolution.state === "open" && resolution.entry.id === SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID && (
          <PreflightSection editor={editor} workflowLabels={workflowLabels} />
        )}
        {resolution.state === "open"
          && resolution.entry.source === "served"
          && !RENDERED_SERVED_SECTION_IDS.has(resolution.entry.id) && (
          // A served section without a renderer is a build gap, said by name —
          // never a section that silently vanishes.
          <section
            aria-label={resolution.entry.label}
            className="flex flex-col gap-[var(--ds-space-tight)]"
          >
            <SectionLabel>{resolution.entry.label}</SectionLabel>
            <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
              This build has no renderer for the served section “{resolution.entry.id}”.
            </span>
          </section>
        )}
        </DsBodyScope></SettingsSearchTargetContext.Provider>
      </div>
      <Dialog open={pendingExit !== undefined} onOpenChange={(open) => { if (!open) setPendingExit(undefined); }}>
        <DialogContent
          size="sm"
          className="ds-body-overlay"
          onCloseAutoFocus={(event) => {
            const target = exitFocusTarget.current;
            exitFocusTarget.current = null;
            if (target?.isConnected) {
              event.preventDefault();
              target.focus();
            }
          }}
          title={relocationUncertain ? "Leave with an unconfirmed plan?" : "Discard unsaved settings?"}
          description={relocationUncertain
            ? `You have ${plural(totalDirty, "local edit")}. Leaving Settings discards local drafts and this browser's exact retry attempt. A submitted relocation plan may already be recorded. It does not mean folders moved; check the plan when you return.`
            : `You have ${plural(totalDirty, "unsaved change")}. Leaving Settings discards local drafts and any pending retry identity. A write already submitted may still be stored.`}
        >
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPendingExit(undefined)}>Keep editing</Button>
            <Button variant="danger" disabled={editor.relocationEditor.saving} onClick={discardAndExit}>{relocationUncertain ? "Leave Settings" : "Discard changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TakeoverFrame>
  );
}
export { StorageBanner } from "./storage/storage-settings.js";
