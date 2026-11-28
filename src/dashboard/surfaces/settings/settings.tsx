import { CURRENT_FISCAL_TARGET, runCheckForTarget } from "./preflight/preflight-remedy-model.js";
import { CHECK_COPY } from "./preflight/preflight-check-copy.js";
import { ArrowUp,ChartNoAxesColumn,Check,CircleAlert,Folder,Gauge,Keyboard,ListTree,Monitor,SlidersHorizontal,Table2,User,X } from "lucide-react";
import { useCallback,useEffect,useMemo,useRef,useState,type ReactNode } from "react";
import { EditableSettingsSectionIdSchema } from "../../../models/dashboard/settings-editor.js";
import { useViewState } from "../../app/navigation/view-route-model.js";
import { Banner,DelayedSpinner,Button,Dialog,DialogContent,DialogFooter,DsBodyScope,IconButton,NavRow,SearchInput,SectionLabel,TakeoverFrame,dsFocus,dsIcon,dsSurface,dsText, FailureNotice, Notice } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";
import { plural } from "../shared/status/format.js";
import { SheetsV2 } from "../spreadsheets/design/sheets-v2.js";
import type { SettingsSaveListener,SettingsSaveProblemListener } from "./editor/settings-attempt-model.js";
import { SettingsAuthoritySection } from "./editor/settings-authorities.js";
import { useEditableSettings } from "./editor/settings-editor-model.js";
import { EditableSettingsSection } from "./editor/settings-editor.js";
import "./settings-data.css";
import "./hub-settings.css";
import { KeyboardSection } from "./navigation/settings-keyboard.js";
import { searchSettings,settingsSearchIndex,type SettingsSearchResult } from "./navigation/settings-search-model.js";
import { SettingsSearchTargetContext,useSettingsSearchArrival } from "./navigation/settings-search-target-model.js";
import { AccountSettings, type AccountPage } from "./account/account-settings.js";
import { DeleteAccountControl } from "./general/ui-settings-records-general-paths.js";
import { CREDENTIALS_UNAVAILABLE,SETTINGS_DATA_SECTION_IDS,SETTINGS_KEYBOARD_SECTION_ID,buildSettingsNav,resolveSettingsSection,type SettingsNavEntry,type SettingsNavIcon } from "./settings-model.js";
import {type StorageHealthSummary } from "./storage/storage-settings-model.js";


export type { StorageHealthSummary };


/** The served sections this build has a renderer for. */
const RENDERED_SERVED_SECTION_IDS: ReadonlySet<string> = new Set([
  ...EditableSettingsSectionIdSchema.options,
  "credentials",
]);


const NAV_ICON: Record<SettingsNavIcon, typeof Folder> = {
  general: SlidersHorizontal,
  credentials: User,
  display: Monitor,
  performance: Gauge,
  paths: Folder,
  storage: Folder,
  preflight: Check,
  routes: ArrowUp,
  capabilities: Table2,
  keyboard: Keyboard,
  unrendered: CircleAlert,
  spreadsheets: Table2,
  explorer: ListTree,
  activity: ChartNoAxesColumn,
};


/** One nav entry: a real link, so middle-click and Cmd/Ctrl-click open it in a new tab. */
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
    <NavRow
      href={`?settings=${encodeURIComponent(entry.id)}`}
      selected={active}
      icon={<Icon className={dsIcon.md} />}
      label={entry.label}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onClick();
      }}
    />
  );
}


function SearchResultLink({ result, active, onSelect }: { result: SettingsSearchResult; active: boolean; onSelect: () => void }) {
  const Icon = NAV_ICON[result.entry.icon];
  const params = new URLSearchParams({ settings: result.entry.id });
  if (result.target !== undefined) params.set("settingsTarget", result.target);
  return <a tabIndex={0} href={`?${params.toString()}`} aria-current={active ? "location" : undefined}
    className={cn("settings-search-result", dsFocus, active && "settings-search-result-active")}
    onClick={event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); onSelect();
    }}>
    <Icon aria-hidden className={dsIcon.md} /><span><span>{result.label}</span><small>{result.context}</small></span>
  </a>;
}


/** Settings shows a kept copy while it reads again: a small spinner, after the skeleton wait. */
export function SettingsRefreshMark() {
  return <span data-settings-stale className="ml-auto mr-2 inline-flex size-4 items-center justify-center"><DelayedSpinner /></span>;
}

export function SettingsPage({
  section,
  searchTarget: requestedTarget,
  dataContent,
  appearance,
  deleteAccount,
  accountPage,
  onOpenRun,
  actorId,
  profileName,
  descriptorFingerprint,
  onSection,
  onExitGuardChange,
  onSaved,
  onSaveProblem,
  onClose,
  backToRun = false,
}: {
  /** the open section id — `""` is the page's own default, from `?settings=` */
  section: string;
  searchTarget?: string;
  dataContent?: ReactNode;
  appearance?: ReactNode;
  deleteAccount?: ReactNode;
  accountPage?: AccountPage;
  onOpenRun?: (runId: string, partitionDay: string) => void;
  actorId: string;
  profileName: string;
  descriptorFingerprint: string;
  onSection: (next: string, target?: string) => void;
  /** Lets the shell route every Settings-unmounting control through this draft owner. */
  onClose: () => void;
  /** Settings was opened by a Run dialog Fix button: focus moves in on open. */
  backToRun?: boolean;
  onSaved?: SettingsSaveListener;
  onSaveProblem?: SettingsSaveProblemListener;
  onExitGuardChange?: (guard: ((proceed: () => void) => void) | undefined) => void;
}) {
  const editor = useEditableSettings({ actorId, descriptorFingerprint, onSaved, onSaveProblem });
  const [pendingExit, setPendingExit] = useState<(() => void) | undefined>(undefined);
  const exitFocusTarget = useRef<HTMLElement | null>(null);
  const settingsDocument = editor.editor.state === "loaded" ? editor.editor.document : undefined;
  const groups = useMemo(() => buildSettingsNav(settingsDocument), [settingsDocument]);
  const requested = resolveSettingsSection(groups, section);
  // An unknown section opens the first one; it never leaves the body blank.
  const resolution = requested.state === "unknown" ? resolveSettingsSection(groups, "") : requested;
  const activeId = resolution.state === "open" ? resolution.entry.id : undefined;
  const isDataSection = activeId !== undefined && SETTINGS_DATA_SECTION_IDS.has(activeId);
  if (isDataSection && dataContent === undefined) throw new Error("SETTINGS_DATA_CONTENT_UNAVAILABLE");
  const [navQuery, setNavQuery] = useViewState("settingsQuery", "", "replace");
  const [searchVisit, setSearchVisit] = useState(0);
  const navSearch = useRef<HTMLInputElement>(null);
  const searchResults = useRef<HTMLDivElement>(null);
  const index = useMemo(() => settingsSearchIndex(groups, settingsDocument), [groups, settingsDocument]);
  const results = useMemo(() => searchSettings(index, navQuery), [index, navQuery]);
  const searchTarget = requestedTarget === CURRENT_FISCAL_TARGET && settingsDocument !== undefined
    ? `annualDates.FY${String(settingsDocument.currentFiscalYear)}.jobEndDate` : requestedTarget;
  const openedForCheck = backToRun ? runCheckForTarget(requestedTarget) : undefined;
  const openedForCheckName = openedForCheck === undefined ? undefined : CHECK_COPY[openedForCheck]?.name;
  const selectedResult = index.find(result => result.target === searchTarget && result.entry.id === activeId);
  const target = selectedResult?.target;
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
  useSettingsSearchArrival(content, target, searchVisit, activeId, selectedResult?.label, openedForCheck !== undefined);
  useEffect(() => { if (backToRun && requestedTarget === undefined) content.current?.focus(); }, [backToRun, requestedTarget]);
  const totalDirty = editor.dirtyCount + editor.protectedEditor.dirtyCount;
  const hasDirtyDraft = totalDirty > 0;

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
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || pendingExit !== undefined) return;
      if (event.target instanceof Element && event.target.closest('[role="dialog"],[role="alertdialog"],[role="listbox"],[role="menu"]')) return;
      event.preventDefault();
      requestExit(onClose);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, pendingExit, requestExit]);

  useEffect(() => {
    onExitGuardChange?.(requestExit);
    return () => onExitGuardChange?.(undefined);
  }, [onExitGuardChange, requestExit]);

  /** Switching section asks first when a draft is unsaved; re-opening the open section does not. */
  const openSection = (id: string, searchTargetId?: string): void => {
    if (id === activeId) onSection(id, searchTargetId); else requestExit(() => onSection(id, searchTargetId));
  };

  const discardAndExit = (): void => {
    if (pendingExit === undefined) throw new Error("Settings discard was confirmed without a pending exit");
    exitFocusTarget.current = null;
    editor.discard();
    editor.protectedEditor.discard();
    setPendingExit(undefined);
    pendingExit();
  };

  return (
    <TakeoverFrame label="Settings" direction="row" animateFrame={false} className="settings-takeover">
      <nav aria-label="Settings sections" className="settings-panel-nav rail-scroll">
        <header className="settings-nav-header"><h2>Settings</h2>{editor.refreshing && editor.editor.state === "loaded" && <SettingsRefreshMark />}<IconButton label="Close settings" size="sm" icon={<X className={dsIcon.md} />} onClick={() => requestExit(onClose)} /></header>
        <SearchInput ref={navSearch} aria-label="Search settings" placeholder="Search" value={navQuery} onChange={event => setNavQuery(event.target.value)} onClear={() => setNavQuery("")} className="settings-nav-search"
          aria-controls={navQuery.trim() ? "settings-search-results" : undefined}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "ArrowDown" && results.length > 0) { event.preventDefault(); searchResults.current?.querySelector<HTMLElement>("a")?.focus(); }
            if (event.key === "Enter" && results[0]) { event.preventDefault(); setSearchVisit(visit => visit + 1); openSection(results[0].entry.id, results[0].target); }
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
          {results.map(result => <SearchResultLink key={result.id} result={result} active={result.entry.id === activeId && result.target === searchTarget} onSelect={() => { setSearchVisit(visit => visit + 1); openSection(result.entry.id, result.target); }} />)}
          {results.length === 0 && <p role="status" className="text-caption text-ui-muted px-3">{editor.editor.state === "loading" ? "Reading settings…" : editor.editor.state === "failed" ? "Settings fields unavailable" : "No settings found"}</p>}
        </div> : groups.map(group => <div key={group.id} className="settings-nav-group"><span>{group.heading}</span>{group.entries.map(entry => <SectionButton key={entry.id} entry={entry} active={entry.id === activeId} onClick={() => openSection(entry.id)} />)}</div>)}
      </nav>

      <div id="dashboard-settings-content" data-settings-target={target} tabIndex={-1} ref={content} className={cn("settings-content outline-none flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-[var(--ds-space-section)] py-[var(--ds-space-page)]", dsSurface.bodyPage)}>
        <SettingsSearchTargetContext.Provider value={searchContext}><DsBodyScope className={cn("settings-tab-body flex flex-col gap-[var(--ds-space-page)]")}>
        {openedForCheckName !== undefined && <div className="settings-fix-banner"><Banner tone="info" title={`${openedForCheckName}: change the highlighted setting`} /></div>}
        {searchTarget !== undefined && settingsDocument !== undefined && target === undefined && <Notice tone="warning" title="Setting unavailable" description="Not on the selected page." />}
        {editor.editor.state === "failed" && !isDataSection && activeId !== "spreadsheets" && (
          <FailureNotice sentence="Couldn't load settings."
            action={{ label: "Retry", onClick: editor.reload }} />
        )}
        {resolution.state === "empty" && (
          <Notice tone="warning" title="No settings sections" />
        )}
        {isDataSection && dataContent}
        {resolution.state === "open" && resolution.entry.id === "spreadsheets" && <SheetsV2 onOpenRun={onOpenRun} />}
        {resolution.state === "open" && resolution.entry.id === SETTINGS_KEYBOARD_SECTION_ID && <KeyboardSection onSaved={onSaved} />}
        {resolution.state === "open" && editor.editor.state !== "failed" && EditableSettingsSectionIdSchema.safeParse(resolution.entry.id).success && (
          <EditableSettingsSection editor={editor} sectionId={resolution.entry.id} appearance={appearance} />
        )}
        {resolution.state === "open" && resolution.entry.id === "account" && (accountPage === undefined ? <SettingsAuthoritySection editor={editor} sectionId="credentials" profileName={profileName} /> : <AccountSettings page={accountPage} username={accountPage.values.username} ucpath={<SettingsAuthoritySection editor={editor} sectionId="credentials" profileName={profileName} embedded />} credentialsNotice={editor.editor.state === "failed" ? <FailureNotice sentence={CREDENTIALS_UNAVAILABLE} /> : undefined} deleteAccount={deleteAccount ?? <DeleteAccountControl presentation={{ state: "unavailable" }} />} />)}
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
          title="Discard changes?"
          description={`${plural(totalDirty, "unsaved change")} will be lost.`}
        >
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPendingExit(undefined)}>Keep editing</Button>
            <Button variant="danger" onClick={discardAndExit}>Discard changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TakeoverFrame>
  );
}
export { StorageNotice } from "./storage/storage-settings.js";
