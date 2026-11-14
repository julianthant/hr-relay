import { ArrowLeft,ArrowUp,Check,CircleAlert,CreditCard,Database,Folder,Gauge,UserRound,History,MessagesSquare,Monitor,Search,Sparkles,Table2 } from "lucide-react";
import { useCallback,useEffect,useMemo,useRef,useState,type ReactNode } from "react";
import { EditableSettingsSectionIdSchema } from "../../../models/dashboard/settings-editor.js";
import { useViewState } from "../../app/navigation/view-route-model.js";
import { Banner,Button,Dialog,DialogContent,DialogFooter,DsBodyScope,IconButton,PageHeading,SearchInput,SectionLabel,TakeoverFrame,dsFocus,dsIcon,dsMotion,dsSurface,dsText, Notice } from "../../ds/ui.js";
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
import { relayUsername } from "./account/relay-username.js";
import { ChatGptAccountSettings } from "./general/chatgpt-account.js";
import { DeleteAccountControl } from "./general/ui-settings-records-general-paths.js";
import { SETTINGS_DATA_SECTION_IDS,SETTINGS_KEYBOARD_SECTION_ID,buildSettingsNav,resolveSettingsSection,type SettingsNavEntry,type SettingsNavIcon,type SettingsSection } from "./settings-model.js";
import {type StorageHealthSummary } from "./storage/storage-settings-model.js";


export type { SettingsSection,StorageHealthSummary };


/** The served sections this build has a renderer for. */
const RENDERED_SERVED_SECTION_IDS: ReadonlySet<string> = new Set([
  ...EditableSettingsSectionIdSchema.options,
  "credentials",
]);


const NAV_ICON: Record<SettingsNavIcon, typeof Database> = {
  general: Sparkles,
  credentials: UserRound,
  display: Monitor,
  performance: Gauge,
  paths: Folder,
  storage: Folder,
  preflight: Check,
  routes: ArrowUp,
  capabilities: Table2,
  keyboard: MessagesSquare,
  unrendered: CircleAlert,
  subscription: CreditCard,
  spreadsheets: Folder,
  explorer: Search,
  activity: History,
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
    <a tabIndex={0}
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
  return <a tabIndex={0} href={`?${params.toString()}`} aria-current={active ? "location" : undefined}
    className={cn("settings-search-result", dsFocus, active && "settings-search-result-active")}
    onClick={event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); onSelect();
    }}>
    <Icon aria-hidden className={dsIcon.md} /><span><span>{result.label}</span><small>{result.context}</small></span>
  </a>;
}


export function SettingsPage({
  section,
  searchTarget,
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
  onSaved?: SettingsSaveListener;
  onSaveProblem?: SettingsSaveProblemListener;
  onExitGuardChange?: (guard: ((proceed: () => void) => void) | undefined) => void;
}) {
  const editor = useEditableSettings({ actorId, descriptorFingerprint, onSaved, onSaveProblem });
  const [pendingExit, setPendingExit] = useState<(() => void) | undefined>(undefined);
  const exitFocusTarget = useRef<HTMLElement | null>(null);
  const settingsDocument = editor.editor.state === "loaded" ? editor.editor.document : undefined;
  const groups = useMemo(() => buildSettingsNav(settingsDocument), [settingsDocument]);
  const resolution = resolveSettingsSection(groups, section);
  const activeId = resolution.state === "open" ? resolution.entry.id : undefined;
  const isDataSection = activeId !== undefined && SETTINGS_DATA_SECTION_IDS.has(activeId);
  if (isDataSection && dataContent === undefined) throw new Error("SETTINGS_DATA_CONTENT_UNAVAILABLE");
  const [navQuery, setNavQuery] = useViewState("settingsQuery", "", "replace");
  const [searchVisit, setSearchVisit] = useState(0);
  const navSearch = useRef<HTMLInputElement>(null);
  const searchResults = useRef<HTMLDivElement>(null);
  const index = useMemo(() => settingsSearchIndex(groups, settingsDocument), [groups, settingsDocument]);
  const results = useMemo(() => searchSettings(index, navQuery), [index, navQuery]);
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
  useSettingsSearchArrival(content, target, searchVisit, activeId, selectedResult?.label);
  const settingsEntries = groups.filter(group => group.id === "personal" || group.id === "advanced").flatMap(group => group.entries);
  const activeSettingsEditorSection = activeId !== undefined && (settingsEntries.some(entry => entry.id === activeId) || activeId === "performance");
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
    onExitGuardChange?.(requestExit);
    return () => onExitGuardChange?.(undefined);
  }, [onExitGuardChange, requestExit]);

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
        <header className="settings-nav-header"><h2>Settings</h2><IconButton label="Back to dashboard" size="sm" icon={<ArrowLeft className={dsIcon.md} />} onClick={() => requestExit(onClose)} /></header>
        <SearchInput ref={navSearch} variant="sidebar" aria-label="Search settings" placeholder="Search" value={navQuery} onChange={event => setNavQuery(event.target.value)} onClear={() => setNavQuery("")} className="settings-nav-search"
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
          {results.length === 0 && <p role="status" className="text-caption text-ui-muted px-3">{editor.editor.state === "loading" ? "Reading settings…" : editor.editor.state === "failed" ? "Settings fields unavailable" : "No settings found"}</p>}
        </div> : groups.map(group => <div key={group.id} className="settings-nav-group"><span>{group.heading}</span>{group.entries.map(entry => <SectionButton key={entry.id} entry={entry} active={entry.id === activeId} onClick={() => onSection(entry.id)} />)}</div>)}
      </nav>

      <div id="dashboard-settings-content" data-settings-target={target} tabIndex={-1} ref={content} className={cn("settings-content flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-[var(--ds-space-section)] py-[var(--ds-space-page)]", dsSurface.bodyPage)}>
        <SettingsSearchTargetContext.Provider value={searchContext}><DsBodyScope className={cn("settings-tab-body flex flex-col gap-[var(--ds-space-page)]")}>
        {searchTarget !== undefined && settingsDocument !== undefined && target === undefined && <Notice tone="warning" title="Setting unavailable" description="Not on the selected page." />}
        {editor.editor.state === "failed" && !activeSettingsEditorSection
          && !isDataSection
          && activeId !== "spreadsheets"
          && (
          <Notice sticky tone="danger" title="Settings unavailable" description={editor.editor.message.replace(/ Try again\.$/u, " Reopen Settings to try again.")} />
        )}
        {/* Refuse unknown settings destinations; redirecting would label the wrong page as the requested one. */}
        {resolution.state === "unknown" && (
          resolution.requested === "ui-catalog" ? <Banner tone="info" title="UI catalog removed">Use the Settings navigation to return to a dashboard page.</Banner> : resolution.requested === "archive" ? <Banner tone="info" title="Archive page removed">
            Existing stored run data has not been deleted. <Button variant="ghost" onClick={() => requestExit(onClose)}>Return to dashboard</Button>
          </Banner> : <Notice tone="danger" title="No such settings section" description={resolution.requested} />
        )}
        {resolution.state === "empty" && (
          <Notice tone="warning" title="No settings sections" />
        )}
        {isDataSection && dataContent}
        {resolution.state === "open" && resolution.entry.id === "spreadsheets" && <SheetsV2 onOpenRun={onOpenRun} />}
        {resolution.state === "open" && resolution.entry.id === SETTINGS_KEYBOARD_SECTION_ID && <KeyboardSection onSaved={onSaved} />}
        {resolution.state === "open" && EditableSettingsSectionIdSchema.safeParse(resolution.entry.id).success && (
          <EditableSettingsSection editor={editor} sectionId={resolution.entry.id} appearance={appearance} />
        )}
        {resolution.state === "open" && resolution.entry.id === "account" && (accountPage === undefined ? <SettingsAuthoritySection editor={editor} sectionId="credentials" profileName={profileName} /> : <AccountSettings page={accountPage} username={relayUsername(editor)} ucpath={<SettingsAuthoritySection editor={editor} sectionId="credentials" profileName={profileName} embedded />} deleteAccount={deleteAccount ?? <DeleteAccountControl presentation={{ state: "unavailable" }} />} />)}
        {resolution.state === "open" && resolution.entry.id === "subscription" && <section className="settings-compact-page"><PageHeading title="Subscription" /><ChatGptAccountSettings /></section>}
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
          title="Discard unsaved settings?"
          description={`You have ${plural(totalDirty, "unsaved change")}. Leaving Settings discards local drafts and any pending retry identity. A write already submitted may still be stored.`}
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
