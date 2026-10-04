import "./settings-data.css";
import { SpreadsheetsSettings } from "./spreadsheets.js";
import { EditableSettingsSectionIdSchema } from "../../domain/dashboard/settings-editor.js";
import { SettingsAuthoritySection } from "./settings-authorities.js";
import {
Activity,
Archive,
BookMarked,
Workflow,
CircleAlert,
ClipboardCheck,
Database,
FolderOpen,
Gauge,
Keyboard as KeyboardIcon,
Link2,
Monitor,
Settings as SettingsIcon,
SlidersHorizontal,
Table2
} from "lucide-react";
import { useCallback,useEffect,useRef,useState,type ReactNode } from "react";
import type { FrontendBootstrapWire } from "../../domain/dashboard/bootstrap.js";
import {
SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID
} from "../../domain/dashboard/settings.js";
import { Banner,Button,Dialog,DialogContent,DialogFooter,DsBodyScope,IconButton,SectionLabel,StatusDot,TakeoverFrame,dsFocus,dsIcon,dsMotion,dsSurface,dsText } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { plural } from "./format.js";
import type { CatalogView } from "./row-catalog-model.js";
import { CapabilitiesSection } from "./settings-capabilities.js";
import { useEditableSettings } from "./settings-editor-model.js";
import { EditableSettingsSection } from "./settings-editor.js";
import { RoutesSection } from "./settings-routes.js";
import { KeyboardSection } from "./settings-keyboard.js";
import { PreflightSection } from "./settings-preflight.js";
import { SETTINGS_DATA_SECTION_IDS,SETTINGS_GEAR_ID,SETTINGS_KEYBOARD_SECTION_ID,SETTINGS_PREFLIGHT_SECTION_ID,SETTINGS_UI_CATALOG_SECTION_ID,buildSettingsNav,resolveSettingsSection,type SettingsNavEntry,type SettingsNavIcon,type SettingsSection } from "./settings-model.js";
import { storageNeedsAttention,type StorageHealthSummary } from "./storage-settings-model.js";
import { StorageSection } from "./storage-settings.js";
import { UiCatalogSection } from "./ui-catalog.js";


export type { SettingsSection,StorageHealthSummary };


/**
 * The served sections this build has a renderer for. A served id NOT in here
 * draws the named build gap below — which is the arm that must keep working, so
 * the set is spelled once and both the switch and the gap read it.
 */
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
  "ui-catalog": BookMarked,
  unrendered: CircleAlert,
  spreadsheets: Table2,
  explorer: Workflow,
  archive: Archive,
  activity: Activity,
};


/**
 * One nav entry. `aria-current="page"` rather than `aria-selected`, because
 * this is navigation between pages of one surface and not a tablist — the
 * demo's own choice, and the one an assistive technology reads as "you are
 * here" rather than "this option is picked".
 */
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
      // A real href — not a `button` — so middle-click, Cmd/Ctrl-click and
      // "open in new tab" all work the way any other in-page navigation does
      // (unit F4b finding 4). `onSection` still owns the actual transition
      // (through `setRoute`, which carries the rest of the route the bare
      // href below cannot), so the default navigation is prevented and the
      // click is handed to it exactly as the `button` version did.
      href={`?settings=${encodeURIComponent(entry.id)}`}
      aria-current={active ? "page" : undefined}
      onClick={(event) => {
        event.preventDefault();
        onClick();
      }}
      className={cn(
        "flex h-[var(--ds-h-settings-nav-row)] min-w-0 items-center gap-[var(--ds-space-snug)] rounded-[var(--ds-radius-settings-nav)]",
        "px-[var(--ds-space-cozy)] text-[length:var(--ds-text-body-row)] text-left text-[color:var(--ds-fg)]",
        dsFocus,
        dsMotion.base,
        active
          ? "bg-[var(--ds-surface-selected)] font-medium"
          : "font-normal hover:bg-[var(--ds-surface-3)]",
      )}
    >
      <Icon aria-hidden className={cn(dsIcon.md, "shrink-0")} />
      <span className="truncate">{entry.label}</span>
    </a>
  );
}


/**
 * The gear. A plain button now rather than a `DialogTrigger`: what it opens is
 * a page, so it navigates instead of raising a layer.
 *
 * `open` is still passed in rather than held here, because the page is
 * reachable from two places — this gear and the storage banner mounted above
 * every view — and a component's own `useState` cannot be opened by a sibling.
 */
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
      // The gear REPORTS that it owns the screen, in both representations:
      // `aria-pressed` for the accessibility tree and the surface-3 fill
      // for the eye. Every other pressed control in this cluster carries
      // the pair; the gear carried neither, so the one takeover an operator
      // opens most often was the one that never looked open.
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


/**
 * Settings, as a page (D272 item 1 / D274 item 5).
 *
 * The persistent section nav and body replace the queue while Settings is open.
 *
 * UF-SET-1/4/5. `TakeoverFrame`'s JSDoc owns the why — geometry, arrival and
 * focus, decided once for all four takeovers. This surface's demo container:
 * `// ported from legacy 1ec1d870
 * src/dashboard/components/dev/rebuild-demo/DemoSettings.tsx:1071-1075`, a bare
 * `flex min-h-0 flex-1` with the 220px nav as its first child. It is the only
 * takeover that lays out in a ROW, which is what `direction="row"` is for.
 */
export function SettingsPage({
  storage,
  sections,
  workflowLabels,
  section,
  dataContent,
  catalogQuery,
  catalogView,
  onCatalogQuery,
  onCatalogView,
  actorId,
  descriptorFingerprint,
  preflight: _preflight,
  onSection,
  onExitGuardChange,
}: {
  storage: StorageHealthSummary;
  sections: readonly SettingsSection[];
  /**
   * The bootstrap's own workflow labels, by id. Capabilities joins on them
   * rather than being served a second copy — one page, one name per workflow.
   */
  workflowLabels: ReadonlyMap<string, string>;
  /** the open section id — `""` is the page's own default, from `?settings=` */
  section: string;
  dataContent?: ReactNode;
  /**
   * The `ui-catalog` section's own two route keys (D295). They are threaded
   * through rather than held here for the reason `?catalogView=` was made
   * route-owned in the first place: a link must be able to land on the actual
   * catalog panel with the actual search term in ONE navigation, and a local
   * state authority beside a URL is two answers to one question.
   */
  catalogQuery: string;
  catalogView: CatalogView;
  onCatalogQuery: (next: string) => void;
  onCatalogView: (next: CatalogView) => void;
  actorId: string;
  descriptorFingerprint: string;
  preflight: NonNullable<FrontendBootstrapWire["preflight"]>;
  onSection: (next: string) => void;
  /** Lets the shell route every Settings-unmounting control through this draft owner. */
  onExitGuardChange?: (guard: ((proceed: () => void) => void) | undefined) => void;
}) {
  const editor = useEditableSettings({ actorId, descriptorFingerprint });
  const [pendingExit, setPendingExit] = useState<(() => void) | undefined>(undefined);
  const exitFocusTarget = useRef<HTMLElement | null>(null);
  const groups = buildSettingsNav(sections, editor.editor.state === "loaded" ? editor.editor.document : undefined);
  const resolution = resolveSettingsSection(groups, section);
  const activeId = resolution.state === "open" ? resolution.entry.id : undefined;
  const isDataSection = activeId !== undefined && SETTINGS_DATA_SECTION_IDS.has(activeId);
  if (isDataSection && dataContent === undefined) throw new Error("SETTINGS_DATA_CONTENT_UNAVAILABLE");
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => { if (content.current) content.current.scrollTop = 0; }, [activeId]);
  const settingsEntries = groups.find(group => group.id === "personal")?.entries ?? [];
  const activeSettingsEditorSection = activeId !== undefined && settingsEntries.some(entry => entry.id === activeId);
  const totalDirty = editor.dirtyCount + editor.protectedEditor.dirtyCount + editor.providerEditor.dirtyCount + editor.relocationEditor.dirtyCount;
  const providerUncertain = editor.providerEditor.save.state === "unconfirmed";
  const relocationUncertain = editor.relocationEditor.uncertain;
  const hasDirtyDraft = totalDirty > 0 || providerUncertain || relocationUncertain;

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
    editor.providerEditor.discard();
    editor.relocationEditor.discard();
    setPendingExit(undefined);
    pendingExit();
  };

  return (
    <TakeoverFrame label="Settings" direction="row" className="settings-takeover">
      <nav
        aria-label="Settings sections"
        className={cn(
          "flex w-[288px] shrink-0 flex-col gap-[var(--ds-space-loose)] overflow-y-auto",
          "border-r border-[color:var(--ds-border)] bg-[var(--ds-surface-1)] px-[var(--ds-space-loose)] py-[var(--ds-space-section)]",
        )}
      >
        <h2 className="m-0 px-[var(--ds-space-cozy)] text-[length:var(--ds-text-display)] leading-[var(--ds-lh-settings-sidebar-title)] font-semibold text-[color:var(--ds-fg)]">Settings</h2>
        {groups.map((group) => (
          <div key={group.id} className="flex min-w-0 flex-col gap-[var(--ds-space-hair)]">
            <span className="px-[var(--ds-space-cozy)] pb-[var(--ds-space-snug)] text-[length:var(--ds-text-title)] font-normal normal-case tracking-normal text-[color:var(--ds-fg-muted)]">
              {group.heading}
            </span>
            {group.entries.map((entry) => (
              <SectionButton
                key={entry.id}
                entry={entry}
                active={entry.id === activeId}
                onClick={() => onSection(entry.id)}
              />
            ))}
          </div>
        ))}
      </nav>

      <div ref={content} className={cn("settings-content flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-[var(--ds-space-section)] py-[var(--ds-space-page)]", dsSurface.bodyPage)}>
        <DsBodyScope className={cn("settings-tab-body flex flex-col gap-[var(--ds-space-page)]", activeId === "spreadsheets" && "max-w-none!")}>
        {editor.editor.state === "failed" && !activeSettingsEditorSection
          && !isDataSection
          && activeId !== "spreadsheets"
          && activeId !== SETTINGS_PREFLIGHT_SECTION_ID
          && activeId !== SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID && (
          <Banner tone="danger" title="Editable settings unavailable">
            {editor.editor.message.replace(/ Try again\.$/u, "")} <Button size="sm" variant="secondary" onClick={editor.reload}>Try again</Button>
          </Banner>
        )}
        {/* A link naming a section this build has no entry for is stated, never
            redirected: landing on Storage under `?settings=budgets` tells the
            operator they are reading something they are not. */}
        {resolution.state === "unknown" && (
          <Banner tone="danger" title="No such settings section">
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
        {resolution.state === "open" && resolution.entry.id === "spreadsheets" && <SpreadsheetsSettings />}
        {resolution.state === "open" && resolution.entry.id === SETTINGS_KEYBOARD_SECTION_ID && <KeyboardSection />}
        {/* The catalog remains a Help destination inside the Settings page. */}
        {resolution.state === "open" && resolution.entry.id === SETTINGS_UI_CATALOG_SECTION_ID && (
          <UiCatalogSection
            query={catalogQuery}
            onQuery={onCatalogQuery}
            view={catalogView}
            onView={onCatalogView}
          />
        )}
        {resolution.state === "open" && resolution.entry.id === "storage" && <StorageSection storage={storage} />}
        {resolution.state === "open" && resolution.entry.id === SETTINGS_PREFLIGHT_SECTION_ID && <PreflightSection editor={editor} />}
        {resolution.state === "open" && resolution.entry.id === "routes" && <RoutesSection editor={editor} />}
        {resolution.state === "open" && resolution.entry.id !== "routes" && EditableSettingsSectionIdSchema.safeParse(resolution.entry.id).success && (
          <EditableSettingsSection editor={editor} sectionId={resolution.entry.id} />
        )}
        {resolution.state === "open" && resolution.entry.id === "credentials" && <SettingsAuthoritySection editor={editor} sectionId="credentials" />}
        {resolution.state === "open" && resolution.entry.id === SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID && (
          <CapabilitiesSection workflowLabels={workflowLabels} />
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
        </DsBodyScope>
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
          title={relocationUncertain ? "Leave with an unconfirmed plan?" : providerUncertain ? "Leave with a pending provider write?" : "Discard unsaved settings?"}
          description={relocationUncertain
            ? `You have ${plural(totalDirty, "local edit")}. Leaving Settings discards local drafts and this browser's exact retry attempt. A submitted relocation plan may already be recorded. It does not mean folders moved; check the plan when you return.`
            : providerUncertain
            ? `You have ${plural(totalDirty, "local edit")}. Leaving Settings discards local drafts and this browser's retry attempt. A submitted provider write may already be stored. Any pending server write can be recovered when you return.`
            : `You have ${plural(totalDirty, "unsaved change")}. Leaving Settings discards local drafts and any pending retry identity. A write already submitted may still be stored.`}
        >
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPendingExit(undefined)}>Keep editing</Button>
            <Button variant="danger" disabled={editor.providerEditor.save.state === "saving" || editor.relocationEditor.saving} onClick={discardAndExit}>{providerUncertain || relocationUncertain ? "Leave Settings" : "Discard changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TakeoverFrame>
  );
}
export { StorageBanner } from "./storage-settings.js";
