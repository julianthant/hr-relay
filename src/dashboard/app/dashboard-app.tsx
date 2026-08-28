/**
 * The composition root of the rebuild dashboard (ref frontend-backend-integration §2).
 *
 * This is the ONLY file that knows the whole screen. Every surface below it
 * takes props and returns markup; every server read goes through the one typed
 * client. The app holds exactly two kinds of state — the route (day, open run,
 * open section, start dialog) and client UI state (selection, filter, panel
 * mode, theme) — and it derives NO authority: counts, statuses, containment and
 * actions are read from the served projection, never recomputed here.
 *
 * `data-parity-ready` flips to "true" once bootstrap and the day have both
 * resolved. It is a statement about the app's own readiness, not a test hook:
 * the parity lane waits on it so a capture can never catch a half-painted
 * shell, and a human reading the DOM can tell the same thing.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ActionDescriptorWire } from "../../domain/dashboard/actions.js";
import {
  SettingsSectionPrimitiveSchema,
  SystemInstancePrimitiveSchema,
  type FrontendBootstrapWire,
} from "../../domain/dashboard/bootstrap.js";
import { CapabilityAvailabilitySchema, type CapabilityAvailability } from "../../domain/absence.js";
import { BookMarked, FileSpreadsheet, PanelRight, Workflow } from "lucide-react";
import { Button, EmptyState, Panel, PanelBody, ToastProvider, TooltipProvider, dsIcon, useDemoTheme, useToasts } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { useDashboardClient } from "../state/client-context.js";
import { useBootstrap } from "../state/use-bootstrap.js";
import { useServedNow } from "../state/served-clock.js";
import { useDashboardDay } from "../state/use-dashboard-day.js";
import { useRunDetail } from "../state/use-run-detail.js";
import { IntakeWorkspace } from "../surfaces/intake.js";
import { ActivityReport } from "../surfaces/activity.js";
import { ArchiveWorkspace } from "../surfaces/archive.js";
import { ARCHIVE_INDEX } from "../surfaces/archive-model.js";
import { WorkflowExplorer } from "../surfaces/explorer.js";
import { UiCatalogWorkspace } from "../surfaces/ui-catalog.js";
import { DEFAULT_CATALOG_VIEW } from "../surfaces/row-catalog-model.js";
import { LogPanel } from "../surfaces/log-panel.js";
import { defaultTabFor, tabsFor, type PanelTab } from "../surfaces/log-panel-model.js";
import { QueuePanel, type QueueFilterScope, type QueueHandlers, type QueueViewState } from "../surfaces/queue.js";
import {
  attentionRunIds,
  queueRowTitle,
  toggleCheckedByYou,
  visibleRunIds,
  type QueueSortKey,
  type QueueSurfaceWire,
} from "../surfaces/queue-model.js";
import {
  CommandResultFeed,
  ConfirmCommandDialog,
  type ActionTarget,
  type PendingCommand,
} from "../surfaces/actions.js";
import {
  commandResultFeedEntry,
  toastAppliedCommandResult,
  type CommandResultFeedEntry,
} from "../surfaces/actions-model.js";
import { fmtClock } from "../surfaces/format.js";
import { RenameRunDialog, type PendingRename } from "../surfaces/run-identity.js";
import {
  composeCommandRequest,
  composePlanWorkerCountCommand,
  composeSpawnWorkerCommand,
  composeStopWorkerCommand,
  type CommandAction,
} from "./command-dispatch.js";
import { commandFailureToast, settleCommandResult, type CommandSettlement } from "./command-result.js";
import { useGlobalKeys } from "./global-keys.js";
import { PROPOSED_STATUS, dsStatusOf } from "../surfaces/status-model.js";
import {
  ConfirmBulkCommandDialog,
  QueueToolbar,
  type PendingBulkCommand,
} from "../surfaces/queue-toolbar.js";
import {
  bulkSubjectsOf,
  bulkUnavailableIds,
  composeBulkRunCommand,
  planBulkVerbs,
  type BulkBatchOutcome,
  type BulkVerbPlan,
} from "./bulk-dispatch.js";
import { RunStartButton, RunStartSurfaces, type RunStartWorkflow } from "../surfaces/run-start.js";
import { START_DOOR_ABSENCE } from "../surfaces/run-start-model.js";
import {
  SessionPanel,
  StatusFilters,
  WorkflowPanelToggle,
  WorkflowSidebar,
  WorkflowWindow,
} from "../surfaces/shell.js";
import {
  activeCount,
  parseWorkflows,
  useWorkflowPanelMode,
  workflowStatusCounts,
  type StatusBucket,
  type WorkerCardWire,
} from "../surfaces/shell-model.js";
import { SettingsPage, StorageBanner } from "../surfaces/settings.js";
import {
  DASHBOARD_MAIN_REGION_ID,
  SETTINGS_GEAR_ID,
  settingsCloseFocusTargetId,
} from "../surfaces/settings-model.js";
import { TopBar, type NavControls } from "../surfaces/top-bar.js";
import {
  serverLocalDay,
  type DayCountWire,
  type NotificationRowWire,
  type ShellView,
} from "../surfaces/top-bar-model.js";
import { usePanelSections } from "./use-panel-sections.js";
import {
  canGoBack,
  canGoForward,
  currentPlace,
  goBack,
  goForward,
  initNavHistory,
  navDestinationLabel,
  pushPlace,
  type NavHistory,
} from "./nav-history.js";
import {
  INTAKE_NEW,
  activeTakeover,
  shellViewOf,
  parseRoute,
  routeAdvancesHistory,
  routeToSearch,
  type AppRouteState,
} from "./url-state.js";
import {
  IMPORT_SPREADSHEET_DOOR_ID,
  UI_CATALOG_DOOR_ID,
  restoreDashboardTakeoverFocus,
  type DashboardTakeoverCloseFocusTargetId,
} from "./dashboard-app-model.js";

/**
 * THE ROW'S OWN CONTROLS, off the row (ref frontend-backend-integration §8.5).
 *
 * This was `SERVED_ACTIONS = []` — an honest constant while `QueueBaseFields`
 * carried no `actions` field and no projector built one, which meant every
 * queue row drew no command controls at all. Both halves now exist
 * (`server/dashboard/projectors/queue-row-actions.ts`), so the array is READ
 * off the surface the server sent and nothing in the tree branches on status
 * to decide what a row may do.
 *
 * A row whose served list is empty draws nothing, with no client branch: the
 * surfaces already render exactly the descriptors they are handed.
 *
 * The SECTION-level descriptors still do NOT come through here, and must not:
 * the parked write's two resolutions are read off `sections["parked-write"]` by
 * the panel's own dialog (which captures the evidence note the kernel
 * requires), and the identity gate's two `resolve-gate` actions are read off
 * `sections["identity-gate"]` beside the packet they are about. Each payload is
 * composable only where its evidence is.
 */
/**
 * The stable empties the three `memo`'d panels are handed when the day has not
 * loaded (D4). `?? []` in a prop slot mints a fresh array on every render, so
 * under `memo` it is a prop that can never compare equal — the wrapper would
 * be pure overhead for exactly the state (still loading) where the most
 * renders happen. `dashboard-memo-prop-stability` refuses the literal form.
 */
const NO_SURFACES: readonly QueueSurfaceWire[] = Object.freeze([]);
const NO_NOTIFICATIONS: readonly NotificationRowWire[] = Object.freeze([]);
const NO_DAY_COUNTS: readonly DayCountWire[] = Object.freeze([]);
const NO_ACTION_DESCRIPTORS: readonly ActionDescriptorWire[] = Object.freeze([]);

type SettingsExitGuard = (proceed: () => void) => void;

function servedActions(surface: QueueSurfaceWire | undefined): readonly ActionDescriptorWire[] {
  return surface?.actions ?? NO_ACTION_DESCRIPTORS;
}

/** The closed tab vocabulary, so a `?section=` value is validated, not trusted. */
const PANEL_TABS: readonly PanelTab[] = ["review", "people", "logs", "receipt"];

/** The route, kept in the URL so every screen is addressable. */
interface RouteHistoryTarget {
  readonly route: AppRouteState;
  readonly cursor: number;
}
type PopstateRouteHandler = (target: RouteHistoryTarget) => void;
interface NativeRouteHistory {
  accept(target: RouteHistoryTarget): void;
  restore(target: RouteHistoryTarget, afterRestore: () => void): void;
  replay(target: RouteHistoryTarget): void;
}
const ROUTE_CURSOR_KEY = "hrDashboardRouteCursor";

function cursorOf(state: unknown): number | undefined {
  if (typeof state !== "object" || state === null) return undefined;
  const cursor = Reflect.get(state, ROUTE_CURSOR_KEY);
  return typeof cursor === "number" && Number.isInteger(cursor) && cursor >= 0 ? cursor : undefined;
}

function useRoute(
  onPopstateRef: { readonly current: PopstateRouteHandler | undefined },
): [AppRouteState, (next: AppRouteState) => void, NativeRouteHistory] {
  const [route, setRouteState] = useState<AppRouteState>(() => parseRoute(window.location.search));
  const cursor = useRef(cursorOf(window.history.state) ?? 0);
  const pendingPop = useRef<
    | { readonly cursor: number; readonly kind: "restore"; readonly afterRestore: () => void }
    | { readonly cursor: number; readonly kind: "accept"; readonly route: AppRouteState }
    | undefined
  >(undefined);

  useEffect(() => {
    if (cursorOf(window.history.state) === undefined) {
      window.history.replaceState({ [ROUTE_CURSOR_KEY]: cursor.current }, "", window.location.href);
    }
  }, []);

  useEffect(() => {
    const onPop = (): void => {
      const next = parseRoute(window.location.search);
      const nextCursor = cursorOf(window.history.state);
      if (nextCursor === undefined) throw new Error("dashboard history entry has no route cursor");
      const pending = pendingPop.current;
      if (pending !== undefined && pending.cursor === nextCursor) {
        pendingPop.current = undefined;
        cursor.current = nextCursor;
        if (pending.kind === "restore") pending.afterRestore();
        else setRouteState(pending.route);
        return;
      }
      const handler = onPopstateRef.current;
      if (handler === undefined) {
        setRouteState(next);
        return;
      }
      handler({ route: next, cursor: nextCursor });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [onPopstateRef]);

  const setRoute = useCallback((next: AppRouteState) => {
    // Re-pressing the door already open (the gear, the active nav entry, the
    // Storage door) must not push a second, identical history entry — that
    // makes the browser's own Back button appear inert (unit F4b finding 2).
    if (routeAdvancesHistory(next, window.location.search)) {
      cursor.current += 1;
      window.history.pushState({ [ROUTE_CURSOR_KEY]: cursor.current }, "", `${window.location.pathname}${routeToSearch(next)}`);
    }
    setRouteState(next);
  }, []);

  const nativeHistory = useMemo<NativeRouteHistory>(() => ({
    accept: (target) => { cursor.current = target.cursor; setRouteState(target.route); },
    restore: (target, afterRestore) => {
      const delta = cursor.current - target.cursor;
      if (delta === 0) { afterRestore(); return; }
      pendingPop.current = { cursor: cursor.current, kind: "restore", afterRestore };
      window.history.go(delta);
    },
    replay: (target) => {
      const delta = target.cursor - cursor.current;
      if (delta === 0) { cursor.current = target.cursor; setRouteState(target.route); return; }
      pendingPop.current = { cursor: target.cursor, kind: "accept", route: target.route };
      window.history.go(delta);
    },
  }), []);
  return [route, setRoute, nativeHistory];
}

export function DashboardApp() {
  const bootstrap = useBootstrap();
  const onPopstate = useRef<PopstateRouteHandler | undefined>(undefined);
  const [route, setRoute, nativeHistory] = useRoute(onPopstate);
  const { theme, toggleTheme } = useDemoTheme();
  const panelMode = useWorkflowPanelMode();
  const [filter, setFilter] = useState<StatusBucket>("all");
  const [openWells, setOpenWells] = useState<ReadonlySet<string>>(() => new Set());
  const [tab, setTab] = useState<PanelTab | undefined>(undefined);
  /** the toolbar's ordering control and its select mode — client UI state, D18 */
  const [sort, setSort] = useState<QueueSortKey>("attention");
  const [selectMode, setSelectMode] = useState(false);
  const [bulkIds, setBulkIds] = useState<ReadonlySet<string>>(() => new Set());
  // Deliberately browser-local triage, not a durable run fact. Reloading the
  // dashboard starts this set over; only the operator can see their checks.
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<string>>(() => new Set());

  const boot = bootstrap.state === "loaded" ? bootstrap.value : undefined;
  const today = boot === undefined ? undefined : serverLocalDay(boot.serverClock);
  const day = route.day ?? today;

  // Radix tooltips need their provider ABOVE every surface that draws one, and
  // the panel draws several. Mounting it here rather than per-surface is also
  // what gives the whole app one shared open/close delay instead of each
  // tooltip negotiating its own.
  //
  // THE THEME ROOT IS THE OUTERMOST NODE, ABOVE BOTH PROVIDERS (D272 item 2,
  // ledger rows A168/A169/A170). That is load-bearing rather than tidy:
  // `ToastProvider` renders its viewport as a FRAGMENT sibling of its children,
  // so while the providers sat outside this element the viewport was not a
  // descendant of it and inherited none of its custom properties.
  // `--ds-toast-inset-bottom` therefore resolved to nothing, the viewport took
  // its own `var(--ds-space-loose)` fallback, and every toast in the product
  // sat on top of the Session bar — visible the moment the page was booted, and
  // invisible to typecheck. The variable and the nesting are ONE fix; either
  // alone changes nothing.
  //
  // The floor clears the app's OWN chrome and nothing else. The viewport is
  // `fixed` at the bottom of the WINDOW and this shell is the only thing that
  // knows what it has parked down there: the Session bar. One term, app-level,
  // the same on every view.
  return (
    <div
      data-app-root=""
      data-demo-theme={theme}
      style={{ "--ds-toast-inset-bottom": "calc(var(--ds-h-bar) + var(--ds-space-loose))" } as CSSProperties}
      className="flex h-screen min-w-0 flex-col overflow-hidden bg-[color:var(--ds-bg)] text-[color:var(--ds-fg)]"
    >
    <TooltipProvider delayDuration={200}>
    <ToastProvider>
      {day === undefined || boot === undefined ? (
        <BootGate bootstrap={bootstrap} />
      ) : (
        <LoadedApp
          boot={boot}
          today={today ?? day}
          day={day}
          route={route}
          setRoute={setRoute}
          onPopstateRef={onPopstate}
          nativeHistory={nativeHistory}
          theme={theme}
          onToggleTheme={toggleTheme}
          panelMode={panelMode}
          filter={filter}
          onFilter={setFilter}
          openWells={openWells}
          onWells={setOpenWells}
          tab={tab}
          onTab={setTab}
          sort={sort}
          onSort={setSort}
          selectMode={selectMode}
          onSelectMode={setSelectMode}
          bulkIds={bulkIds}
          onBulkIds={setBulkIds}
          checkedIds={checkedIds}
          onCheckedIds={setCheckedIds}
        />
      )}
    </ToastProvider>
    </TooltipProvider>
    </div>
  );
}

/**
 * Boot is the one place a hard failure has nowhere else to go: without the boot
 * document there is no vocabulary to render a dashboard with, so it says so in
 * the server's own words rather than showing an empty shell.
 */
function BootGate({ bootstrap }: { bootstrap: ReturnType<typeof useBootstrap> }) {
  if (bootstrap.state === "failed") {
    return (
      <main
        data-parity-ready="failed"
        className="flex min-h-screen items-center justify-center bg-[color:var(--ds-bg)] p-[var(--ds-space-loose)]"
      >
        <div className="max-w-prose text-[color:var(--ds-fg)]">
          <h1 className="text-[length:var(--ds-text-lg)] font-semibold">The dashboard could not start</h1>
          <p className="mt-[var(--ds-space-base)] text-[color:var(--ds-fg-muted)]">
            {bootstrap.error.message}
          </p>
        </div>
      </main>
    );
  }
  return (
    <main
      data-parity-ready="loading"
      className="flex min-h-screen items-center justify-center bg-[color:var(--ds-bg)]"
    >
      <p className="text-[color:var(--ds-fg-muted)]">Starting…</p>
    </main>
  );
}

interface LoadedAppProps {
  boot: FrontendBootstrapWire;
  today: string;
  day: string;
  route: AppRouteState;
  setRoute: (next: AppRouteState) => void;
  onPopstateRef: { current: PopstateRouteHandler | undefined };
  nativeHistory: NativeRouteHistory;
  theme: ReturnType<typeof useDemoTheme>["theme"];
  onToggleTheme: () => void;
  panelMode: ReturnType<typeof useWorkflowPanelMode>;
  filter: StatusBucket;
  onFilter: (bucket: StatusBucket) => void;
  openWells: ReadonlySet<string>;
  onWells: (next: ReadonlySet<string>) => void;
  tab: PanelTab | undefined;
  /**
   * The operator's EXPLICIT tab choice. `undefined` clears the override and
   * hands the panel back to the run's own default — which is what the history
   * restores when a place was recorded before any tab was pressed, and what a
   * forced section the run cannot offer must never become.
   */
  onTab: (tab: PanelTab | undefined) => void;
  sort: QueueSortKey;
  onSort: (sort: QueueSortKey) => void;
  selectMode: boolean;
  onSelectMode: (on: boolean) => void;
  bulkIds: ReadonlySet<string>;
  onBulkIds: (next: ReadonlySet<string>) => void;
  checkedIds: ReadonlySet<string>;
  onCheckedIds: (next: ReadonlySet<string>) => void;
}

function LoadedApp({
  boot,
  today,
  day,
  route,
  setRoute,
  onPopstateRef,
  nativeHistory,
  theme,
  onToggleTheme,
  panelMode,
  filter,
  onFilter,
  openWells,
  onWells,
  tab,
  onTab,
  sort,
  onSort,
  selectMode,
  onSelectMode,
  bulkIds,
  onBulkIds,
  checkedIds,
  onCheckedIds,
}: LoadedAppProps) {
  const { day: dayResource, connection } = useDashboardDay(day);
  /**
   * THE clock (D256). The server's instant is the authority; the browser
   * contributes only the monotonic time since that instant arrived, and every
   * live elapsed on the screen — the queue row's timer, the gate-age pill, the
   * session footer, the worker cards, the notification ages — is computed
   * against this ONE value. Before it, `boot.serverClock.now` was frozen at
   * page load and a parked run read `0s` for over two minutes.
   */
  const nowIso = useServedNow(boot.serverClock.now);
  const dayWire = dayResource.state === "loaded" ? dayResource.value : undefined;
  // Bumped by an applied Data correction: the save moved the run version, so
  // the open detail (and, through its rowRevision, every fetched section)
  // refetches rather than serving a CAS basis the kernel will now refuse.
  const [detailNonce, setDetailNonce] = useState(0);
  /** Refused command answers are local, bounded reading context; the durable
   * audit remains the server's authority. Applied answers toast instead. */
  const [commandResults, setCommandResults] = useState<readonly CommandResultFeedEntry[]>([]);
  /**
   * THE OPEN PANEL FOLLOWS ITS RUN (D257).
   *
   * The day stream is the one live feed this app has, and the run's own row on
   * it carries `rowRevision` — the authority version the panel's detail is
   * read at. Handing it to `useRunDetail` is what makes the panel notice its
   * run moving: before it, the nonce above was bumped ONLY by a dispatched
   * command or an applied Data edit, so a panel left open through a run's
   * progress kept serving the wire as of the last thing the operator clicked.
   * A run whose row is not on this day (an archived run, another day's run)
   * serves no revision and is not followed — it cannot move.
   */
  const servedRowRevision = dayWire?.queueSurfaces
    .find((row) => String(row.runId) === route.run)?.rowRevision;
  const detail = useRunDetail(route.run, detailNonce, servedRowRevision);
  const detailValue = detail.state === "loaded" ? detail.value : undefined;
  // Precedence: what the operator clicked this session, then what the URL asked
  // for, then the panel's own default. The URL arm is what makes a link to a
  // specific tab work — without it `?section=logs` was parsed and silently
  // dropped, so a shared link landed on whatever the run's default happened to
  // be. A section the panel does not offer is ignored rather than forced.
  const routeTab = PANEL_TABS.find((candidate) => candidate === route.section);
  const offered = detailValue === undefined ? [] : tabsFor(detailValue);
  const effectiveTab =
    tab ??
    (routeTab !== undefined && offered.includes(routeTab)
      ? routeTab
      : detailValue === undefined
        ? "logs"
        : defaultTabFor(detailValue));
  const { sections } = usePanelSections(detailValue, effectiveTab);

  const workflows = useMemo(() => parseWorkflows(boot.workflows), [boot.workflows]);
  const [activeWorkflowId, setActiveWorkflowId] = useState<string>(() => workflows[0]?.id ?? "");
  const [startOpen, setStartOpen] = useState(route.start);
  /**
   * The command waiting on the operator's confirmation. A descriptor that
   * carries a server-authored `confirm` block goes here first; everything else
   * is posted straight away (the demo's own split, `RebuildDemo.tsx:226-252` —
   * D16 keeps group cancel out of this flow BY CONSTRUCTION, because its
   * descriptor carries no `confirm`).
   */
  const [pendingCommand, setPendingCommand] = useState<PendingCommand | null>(null);
  /** the run whose name is being edited (D233); `null` while the dialog is shut */
  const [pendingRename, setPendingRename] = useState<PendingRename | null>(null);
  /**
   * D235's two pieces of bulk state. The batch waiting on the warn-first
   * confirm, and the LAST batch's whole answer — which stays on screen until it
   * is dismissed, because a partial result that auto-dismisses is a partial
   * result nobody read.
   */
  const [pendingBulk, setPendingBulk] = useState<PendingBulkCommand | null>(null);
  const [bulkOutcome, setBulkOutcome] = useState<BulkBatchOutcome | null>(null);
  const client = useDashboardClient();
  const { toast } = useToasts();

  const workflowLabelOf = useCallback(
    (workflowId: string): string => workflows.find((w) => w.id === workflowId)?.label ?? workflowId,
    [workflows],
  );
  /**
   * The fingerprint ONE workflow is served under today (§9.22 item 3).
   *
   * The provenance bar's shape hazard compares a run's own
   * `contractFingerprint` against this. It used to compare against
   * `boot.descriptorHash` — the hash of the whole descriptor SET — which a
   * one-workflow fingerprint can never equal, so the amber "the run's SHAPE
   * moved" chip was on for every run ever drawn. A workflow this build does
   * not register serves no fingerprint, and that is its own verdict rather
   * than an assumed move.
   */
  const workflowShapeOf = useCallback(
    (workflowId: string): string | undefined =>
      workflows.find((w) => w.id === workflowId)?.descriptorFingerprint,
    [workflows],
  );
  /**
   * The active workflow's served 2-char code. A workflow id the boot document
   * does not carry has no code, and the launcher then draws NOTHING in that
   * slot — the demo's own `WORKFLOW_CODE[active] ?? ""`. Deriving two letters
   * from the label would put a value the server never issued beside the
   * identity an operator selects a real HR workflow by.
   */
  const workflowCodeOf = useCallback(
    (workflowId: string): string => workflows.find((w) => w.id === workflowId)?.code ?? "",
    [workflows],
  );

  const surfaces = useMemo((): readonly QueueSurfaceWire[] => {
    if (dayWire === undefined) return [];
    const scoped = dayWire.queueSurfaces.filter((s) => s.workflowId === activeWorkflowId);
    if (filter === "all") return scoped;
    if (filter === "needsYou") {
      // The same two statuses the `Needs you` count is the sum of.
      return scoped.filter((s) => s.status === "awaiting-approval" || s.status === "blocked");
    }
    // Members stay with their group: filtering a member out of a group that
    // matched would silently shrink a roster the server said was whole.
    const kept = new Set(scoped.filter((s) => s.status === filter).map((s) => s.runId));
    return scoped.filter((s) => {
      if (kept.has(s.runId)) return true;
      return s.lineage.state === "child" && kept.has(s.lineage.parentRunId);
    });
  }, [dayWire, activeWorkflowId, filter]);

  const dayCount = dayWire?.monthCounts.find((c) => c.day === day)?.count ?? 0;
  /**
   * ACTIVE across every workflow today — queued + running, off the day's OWN
   * served `statusCounts`, which is already day-scoped across workflows. The
   * launcher and the rail's orange column are then the same quantity at two
   * scopes and cannot disagree (D81, R2 D3/D4).
   */
  const dayActive = activeCount(dayWire?.statusCounts ?? []);

  /**
   * THE STATUS BAND'S OWN SCOPE (R4-1) — the ACTIVE workflow's served
   * per-status counts, read straight out of R2's `workflowCounts` array.
   *
   * The band was handed `dayWire.statusCounts`, which the projection folds
   * across every workflow in the day, while the queue below it renders ONE
   * workflow — so `Failed 3` could sit above a queue with no failures. The fix
   * is a re-point, not a client-side fold: `shell.tsx:1-17` refuses counting
   * rows here by name, and D81's one count path is the reason. `dayCount` above
   * is deliberately left alone — the panel launcher is a DIFFERENT quantity
   * (day-wide across workflows), exactly as the demo has it.
   */
  const scopedStatusCounts = useMemo(
    () => workflowStatusCounts(dayWire?.workflowCounts ?? [], activeWorkflowId),
    [dayWire, activeWorkflowId],
  );

  /**
   * The route back to a run's parent (R3 finding 6), resolved over the WHOLE
   * day's surfaces rather than the panel's scoped list — a parent that
   * delegated across workflows is the interesting case, and it is exactly the
   * one a scoped lookup would miss. A parent the day does not hold answers
   * `undefined` and the chip is not drawn; nothing here invents a label.
   */
  const parentOf = useCallback(
    (parentRunId: string) => {
      const parent = dayWire?.queueSurfaces.find((surface) => String(surface.runId) === parentRunId);
      return parent === undefined
        ? undefined
        : {
          runId: String(parent.runId),
          title: parent.title,
          workflowLabel: workflowLabelOf(String(parent.workflowId)),
          status: dsStatusOf(parent.status),
        };
    },
    [dayWire, workflowLabelOf],
  );

  /**
   * The active filter in the operator's own words, for the queue's empty state
   * (R3 findings 2/3). It used to hand the panel `String(filter)`, which
   * printed the raw wire enum (`awaiting-approval`); the word is the status
   * pill's own label, so the empty state and the pill the operator clicked
   * cannot disagree.
   */
  const queueFilterScope = useMemo((): QueueFilterScope | undefined => {
    if (filter === "all") return undefined;
    if (filter === "needsYou") return { kind: "needsYou" };
    return { kind: "status", word: PROPOSED_STATUS[dsStatusOf(filter)].label.toLowerCase() };
  }, [filter]);

  /**
   * The first consumer of `featureAvailability` (2i-G, D178). A feature the
   * boot document does not mention is `not-configured` with a reason naming
   * exactly that — never a silent `available`, which is how a surface starts
   * offering something the server never wired.
   */
  const advisoryAvailability = useMemo((): CapabilityAvailability => {
    const entry = boot.featureAvailability.find(({ feature }) => feature === "ai-advisory");
    return entry === undefined
      ? {
        state: "unavailable",
        code: "not-configured",
        reason: "this server's bootstrap document does not report the ai-advisory feature",
      }
      : CapabilityAvailabilitySchema.parse(entry.availability);
  }, [boot.featureAvailability]);

  /**
   * The Run Modal's WHOLE catalogue, not just the panel's workflow: its picker
   * is a served addition composed right here from the boot document's workflow
   * list and each descriptor's declared input surface, so "any workflow, from
   * anywhere" needs no new wire (R8 finding 12).
   */
  const startWorkflows = useMemo((): readonly RunStartWorkflow[] => {
    // The boot document composes this array from zod parts, so it infers as
    // `unknown[]`; re-parsing is the same check bootstrap's own refinement
    // makes, not a cast past one. It is shared by every entry — one start's
    // destination options do not vary by workflow.
    const systemInstances = SystemInstancePrimitiveSchema.array().parse(boot.systemInstances);
    return workflows.map((entry): RunStartWorkflow => {
      const workflowId = String(entry.id);
      /**
       * D264 (amending D251) — the four modal facts, SERVED.
       *
       * They used to be read off the bundle-safe `WORKFLOW_DESCRIPTORS` tuple
       * right here, on the argument that serving a fact the bundle already
       * carries would give this surface two sources for one value. The argument
       * was right about the two sources and wrong about the price: holding that
       * tuple is what put every registered workflow's whole descriptor closure
       * in the browser bundle, for three plain-data fields. They now ride on the
       * boot document's own workflow entry, projected at the composition root
       * from the same descriptor the daemon plans with — one source still, and
       * `dashboard-wire-boundary`'s registry-reach arm holds the tuple out.
       *
       * Nothing is re-parsed and nothing is defaulted: `parseWorkflows` already
       * put this whole block through `WorkflowBootstrapPrimitiveSchema`, and the
       * old `?? "reject-active"` stood in for a fact the server always had, so
       * a served `enqueue` is now simply required.
       */
      const start = entry.start;
      return {
        workflowId,
        label: entry.label,
        categoryId: entry.categoryId,
        // D219's served taxonomy fact, carried through verbatim: the picker
        // groups by the same rule the rail does, and neither infers it.
        role: entry.role,
        code: entry.code,
        ...(start.summary === undefined ? {} : { summary: start.summary }),
        enqueue: start.enqueue,
        // C96 — the footer's `{label} v{n}`. Served for D264's reason: reading
        // it off a descriptor is what used to put the registry in this bundle.
        version: start.version,
        inputRun:
          start.inputRun === undefined
            ? { state: "absent", reason: START_DOOR_ABSENCE["no-typed-input"] }
            : { state: "present", surface: start.inputRun },
        systemInstances,
      };
    });
  }, [workflows, boot.systemInstances]);

  const startWorkflow = useMemo(
    () => startWorkflows.find((entry) => entry.workflowId === activeWorkflowId),
    [startWorkflows, activeWorkflowId],
  );

  /**
   * ONE object per CHANGE, not one per render (D4).
   *
   * `QueuePanel` is `memo`'d, so a freshly built `state` object would defeat
   * the wrapper on its own — it is the single prop most likely to do so,
   * because it is the only composed one. `nowIso` is in the dependency list
   * and ticks once a second (D256), which is the floor the panel redraws at by
   * design; everything else here moves only when the operator moves it.
   */
  const viewState = useMemo(
    (): QueueViewState => ({
      ...(route.run === undefined ? {} : { selectedRunId: route.run }),
      openWells,
      selectMode,
      bulkIds,
      checkedIds,
      panelWorkflowId: activeWorkflowId,
      nowIso,
    }),
    [route.run, openWells, selectMode, bulkIds, checkedIds, activeWorkflowId, nowIso],
  );

  /**
   * What `Select all in view` may take: the TOP-LEVEL rows drawn on screen, in
   * the order they are drawn. A member is acted on through its group or on its
   * own row and is never half-selected with it, which is why it never enters
   * this set — `visibleRunIds` includes members, so it is not the same list.
   */
  const selectableIds = useMemo(
    () => surfaces.filter((s) => s.lineage.state !== "child").map((s) => String(s.runId)),
    [surfaces],
  );

  const selectRun = useCallback(
    (runId: string) => {
      setRoute({ ...route, run: runId });
      onTab("logs");
    },
    [route, setRoute, onTab],
  );

  /**
   * D235 — WHAT THE SELECTION CAN DO, from the rows' OWN served descriptors.
   *
   * The rows are taken from `surfaces` and not from `bulkIds` alone: an id in
   * the selection whose row has left the day (a filter changed, the day rolled)
   * has no served `actions[]`, so nothing may be sent for it against a version
   * nobody currently serves.
   *
   * It used to drop out of every plan THERE — the filter below removed it and
   * no count downstream ever mentioned it again, so `Cancel 3 · 1 skipped`
   * could sit under `6 selected` with two rows accounted for nowhere. That is
   * the omission this repo's fail-loud rule forbids: not sent, and not
   * disclosed either. The WHOLE selection now travels into `planBulkVerbs`,
   * which returns those ids as its own `unavailable` bucket, and the strip, the
   * confirm dialog and the result band each say so in their own words.
   */
  const bulkCandidateRows = useMemo(
    () =>
      surfaces
        .filter((surface) => bulkIds.has(String(surface.runId)))
        .map((surface) => ({
          runId: String(surface.runId),
          // The SAME `displayName ?? title` fold the row itself draws, shared
          // rather than repeated: a confirm dialog naming a run something other
          // than the row above it is a dialog about a different run.
          title: queueRowTitle(surface),
          actions: surface.actions,
        })),
    [bulkIds, surfaces],
  );

  const bulkSelectedIds = useMemo(() => [...bulkIds], [bulkIds]);

  const bulkPlans = useMemo(() => {
    if (!selectMode || bulkIds.size === 0) return [];
    return planBulkVerbs(bulkCandidateRows, bulkSelectedIds);
  }, [selectMode, bulkIds, bulkCandidateRows, bulkSelectedIds]);

  /**
   * The unavailable bucket read on its OWN, because the strip needs it in the
   * one case no plan survives to carry it: a selection whose rows have all left
   * the day offers no verb, so `bulkPlans` is empty and there is no plan to ask.
   * Without this the band would print "none of the 2 selected rows serves
   * Cancel or Retry" about rows whose `actions[]` nobody ever read.
   */
  const bulkUnavailable = useMemo(
    () => (selectMode && bulkIds.size > 0 ? bulkUnavailableIds(bulkCandidateRows, bulkSelectedIds) : []),
    [selectMode, bulkIds, bulkCandidateRows, bulkSelectedIds],
  );

  /**
   * THE ONE PLACE A SERVED CONTROL BECOMES A COMMAND (R8 finding 4, R5 finding
   * 8). Every surface hands back the descriptor and its target; nothing below
   * this line knows what a command envelope is.
   *
   * `composeCommandRequest` may REFUSE, and a refusal is reported rather than
   * swallowed: a control that looks pressed and posts nothing is the silent
   * failure this program forbids. The refusal toast is `danger`, which in this
   * product means it never auto-dismisses — "nothing was recorded" may not time
   * out (the same rule `park-resolve.tsx` follows).
   */
  const dispatchCommand = useCallback(
    /**
     * `answers` carries the values only a HUMAN can author, collected by
     * whichever dialog owns that question. There is exactly one today
     * (`renameAnswer`), and it is a parameter rather than another piece of
     * component state for the reason the identity ceremony taught: a value the
     * composer must not invent should travel WITH the call that needs it, so
     * "the dialog did not answer" and "the state had not updated yet" can
     * never look the same.
     */
    (action: CommandAction, target: ActionTarget, answers: { renameAnswer?: string } = {}): void => {
      /*
        The gate section is still handed to the composer even though the gate's
        own controls no longer route here (D226 sends them to the ceremony
        dialog, which is the only surface that can carry the operator's answer).
        It stays because a `resolve-gate` descriptor arriving on THIS path is a
        control that reached the generic dispatcher without a ceremony, and the
        composer's refusal is far more useful with the section in hand: it names
        the shape the server asked for instead of reporting that no gate is open.
        No `gateAnswer` is supplied here on purpose — nothing on this path
        authored one, and a dispatcher that minted one would be answering for
        the human (ref write-safety §14.6 risk 1).
      */
      const composed = composeCommandRequest(action, target, {
        actorId: boot.actor.id,
        source: "run-detail",
        gate: sections["identity-gate"],
        ...(answers.renameAnswer === undefined ? {} : { renameAnswer: answers.renameAnswer }),
      });
      if (composed.state === "refused") {
        toast(commandFailureToast({ stage: "before-dispatch", reason: composed.reason }));
        return;
      }
      /*
        `.then(onFulfilled).catch(onRejected)` — NOT `.then(onFulfilled, onRejected)`, and the
        difference is the whole point of the two fail-loud guards inside this settlement handler.
        A two-arm `.then` installs its rejection handler on the ORIGINAL promise, so a throw
        raised by the fulfilment arm has nowhere to land: `toastAppliedCommandResult`'s refusal to
        compose a success receipt for a refused settlement, and the missing-feed-entry throw below
        it, would both become floating unhandled rejections — no toast, no feed row, nothing on
        screen at all. A guard whose only effect is a message in a console the operator never opens
        is exactly the silence it was written to prevent. Chained, the SAME danger toast that
        reports a transport failure reports the guard, verbatim.
      */
      client.executeCommand(composed.request).then(
        (result) => {
          // `conflict` and `rejected` are VALUES, not exceptions (ref frontend-backend-integration §3.4),
          // and WHETHER one of them landed is decided ONCE, by the fold (D253,
          // Track D row D3) — this callback reads the verdict rather than
          // re-taking the union apart. The description is still the server's
          // own sentence verbatim: it is the only party that knows which
          // version is live now, and neither refusal changes what this toast
          // says about the command it answers.
          const settlement = settleCommandResult(result);
          const surface = dayWire?.queueSurfaces.find((row) => String(row.runId) === target.runId);
          if (settlement.kind === "refused") {
            const feedEntry = commandResultFeedEntry({
              settlement,
              targetRunId: target.runId,
              expectedVersion: target.expectedVersion,
              commandId: String(result.commandId),
              subject: surface === undefined ? `run ${target.runId}` : queueRowTitle(surface),
              workflowLabel: workflowLabelOf(String(surface?.workflowId ?? activeWorkflowId)),
              actionLabel: action.label,
              clock: fmtClock(nowIso),
              actorId: boot.actor.id,
            });
            if (feedEntry === undefined) throw new Error("refused command settlement produced no feed entry");
            setCommandResults((previous) => [feedEntry, ...previous].slice(0, 4));
            toast({ tone: "danger", title: "Nothing was recorded", description: settlement.message });
            return;
          }
          toastAppliedCommandResult(toast, {
            settlement,
            actionLabel: action.label,
            subject: surface === undefined ? `run ${target.runId}` : queueRowTitle(surface),
            clock: fmtClock(nowIso),
            actorId: boot.actor.id,
          });
          setDetailNonce((nonce) => nonce + 1);
        },
      ).catch((caught: unknown) => {
        // NOT "Nothing was recorded": the envelope is already on the wire by
        // the time anything can land here, so whether the kernel wrote the row
        // is a fact this tab does not hold (`commandFailureToast`).
        toast(commandFailureToast({ stage: "after-dispatch", caught }));
      });
    },
    [boot.actor.id, client, sections, toast, dayWire, workflowLabelOf, activeWorkflowId, nowIso],
  );

  /**
   * D235 — THE ONE PLACE A BULK PLAN BECOMES A POST, and the mirror of
   * `dispatchCommand` one level up: `composeBulkRunCommand` may REFUSE (an
   * empty eligible set is the honest one), and a refusal is reported rather
   * than swallowed.
   *
   * What it does NOT do is collapse the answer. `conflict` and `refused` are
   * per-run values here exactly as they are per-command above, and every one of
   * them goes into the band — the toast says only that the batch has answered,
   * because a toast cannot carry a vector and ref dashboard-surfaces §2.4 forbids reducing one
   * to a word.
   */
  const dispatchBulk = useCallback(
    (plan: BulkVerbPlan): void => {
      const composed = composeBulkRunCommand(plan, { actorId: boot.actor.id, source: "queue" });
      if (composed.state === "refused") {
        toast({ tone: "danger", title: "Nothing was sent", description: composed.reason });
        return;
      }
      const subjects = bulkSubjectsOf(plan);
      client.executeBulkCommand(composed.request).then(
        (response) => {
          setBulkOutcome({ plan, subjects, response });
          if (response.state === "refused") {
            toast({ tone: "danger", title: "Nothing was recorded", description: response.message });
            return;
          }
          const applied = response.results.filter((entry) => entry.outcome === "applied").length;
          // The toast POINTS AT the band; it never states the outcome, because
          // "3 of 4 applied" read alone is the summary this surface exists to
          // refuse. The band below it holds every run's own answer.
          toast({
            tone: applied === response.results.length && applied === response.requestedCount ? "success" : "danger",
            title: `${plan.label} — ${String(response.results.length)} of ${String(response.requestedCount)} answered`,
            description: "Each run's own outcome is listed under the selection bar.",
          });
          setDetailNonce((nonce) => nonce + 1);
        },
        (caught: unknown) => {
          // NOT "Nothing was recorded": the envelope is already on the wire by
          // the time anything can land here, so whether the kernel wrote the
          // row is a fact this tab does not hold (`commandFailureToast`).
          toast(commandFailureToast({ stage: "after-dispatch", caught }));
        },
      );
    },
    [boot.actor.id, client, toast],
  );

  /**
   * The Session Panel's `Stop` (D249). It posts through the SAME one command
   * route and reads the answer the same way — `conflict` and `rejected` are
   * values the server owns and this app prints verbatim, because a stop the
   * kernel refused (the lease settled while the drawer was open) must never
   * look like one that landed.
   */
  const stopWorker = useCallback(
    (card: WorkerCardWire): void => {
      client.executeCommand(composeStopWorkerCommand(
        { workerId: String(card.workerId), leaseVersion: Number(card.leaseVersion) },
        { actorId: boot.actor.id, source: "session-panel" },
      )).then(
        (result) => {
          // The same ONE fold (D253) — a stop the kernel refused must never
          // look like one that landed, and "did it land" has exactly one
          // implementation in this bundle.
          const settlement = settleCommandResult(result);
          if (settlement.kind === "refused") {
            toast({ tone: "danger", title: "Nothing was recorded", description: settlement.message });
            return;
          }
          toast({
            tone: "success",
            title: `Stop ${String(card.workerId)}`,
            description: "Recorded. The worker finishes its current item, then stops claiming.",
          });
        },
        (caught: unknown) => {
          // NOT "Nothing was recorded": the envelope is already on the wire by
          // the time anything can land here, so whether the kernel wrote the
          // row is a fact this tab does not hold (`commandFailureToast`).
          toast(commandFailureToast({ stage: "after-dispatch", caught }));
        },
      );
    },
    [boot.actor.id, client, toast],
  );

  /**
   * The Session Panel's POOL controls (D271) — `plan-worker-count` and
   * `spawn-worker`, posted through the same one command route.
   *
   * They differ from `stopWorker` above in where the answer lands, and
   * deliberately so. A stop is about one worker and a toast can carry its
   * whole verdict; a pool refusal is about a NUMBER the operator was looking
   * at — a CAS `conflict` names the version the pool actually holds, and that
   * sentence belongs beside the control that used the stale one, not in a
   * corner that dismisses. So these two RETURN the settlement (folded here,
   * once, through `settleCommandResult` — D253) and the panel draws both
   * refusal arms verbatim in the group they were issued for. A transport
   * failure is not folded into a settlement: it rejects, and the panel says
   * the request never reached the kernel, because "the server refused" and
   * "nothing was sent" are different things an operator does different things
   * about.
   */
  const planWorkerCount = useCallback(
    (plan: Readonly<{ workflowId: string; desiredWorkers: number; expectedVersion: number }>): Promise<CommandSettlement> =>
      client
        .executeCommand(composePlanWorkerCountCommand(plan, { actorId: boot.actor.id, source: "session-panel" }))
        .then((result) => settleCommandResult(result)),
    [boot.actor.id, client],
  );

  const spawnWorker = useCallback(
    (member: Readonly<{ workflowId: string; workerId: string; expectedVersion: number }>): Promise<CommandSettlement> =>
      client
        .executeCommand(composeSpawnWorkerCommand(member, { actorId: boot.actor.id, source: "session-panel" }))
        .then((result) => settleCommandResult(result)),
    [boot.actor.id, client],
  );

  /**
   * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
   * `RebuildDemo.tsx:226-252` (`runAction`).
   *
   * Note what is NOT here: no status check, no per-button special case. The
   * DESCRIPTOR decides — navigation moves the view, a command with
   * server-authored confirm copy asks first, everything else posts.
   */
  const runAction = useCallback(
    (action: ActionDescriptorWire, target: ActionTarget): void => {
      if (action.kind === "navigation") {
        if (action.navigate.runId !== undefined) selectRun(action.navigate.runId);
        return;
      }
      /*
        RENAME ASKS FOR A VALUE (D233), so it is intercepted before the confirm
        branch rather than after it — the demo's own shape
        (`RebuildDemo.tsx:240`). A confirm dialog re-states a decision already
        made; this one COLLECTS the decision, and the two are not
        interchangeable. `composeCommandRequest` refuses a rename with no name,
        so a descriptor that somehow reached the generic path below cannot post
        an empty one.

        A run the day's projection no longer holds cannot be renamed HERE: the
        dialog states the run's identity and its elapsed from that row, and
        inventing a subject line for a run this build cannot see is the
        substitution the confirm path already refuses one line down.
      */
      if (action.command === "rename") {
        const surface = dayWire?.queueSurfaces.find((row) => String(row.runId) === target.runId);
        if (surface === undefined) {
          toast({
            tone: "danger",
            title: "Nothing was sent",
            description: `run ${target.runId} is not on the day this panel is showing, so there is no row to `
              + "name. Open the day it ran on and rename it there.",
          });
          return;
        }
        setPendingRename({ action, target, surface, nowIso });
        return;
      }
      if (action.confirm !== undefined) {
        const surface = dayWire?.queueSurfaces.find((row) => String(row.runId) === target.runId);
        setPendingCommand({
          action,
          target,
          // The row's own name and identity, so the operator is shown the thing
          // the blast radius lands ON. A run the day's projection does not hold
          // states that rather than inventing a title for it.
          subject: surface?.title ?? `run ${target.runId}`,
          traceId: surface?.traceId ?? target.runId,
          workflowLabel: workflowLabelOf(String(surface?.workflowId ?? activeWorkflowId)),
        });
        return;
      }
      dispatchCommand(action, target);
    },
    [dayWire, workflowLabelOf, activeWorkflowId, dispatchCommand, selectRun, toast, nowIso],
  );

  /**
   * THE KEYBOARD, BOUND (R2 D13/D14, R3 finding 8, R5 finding 7, R8 finding 7).
   *
   * The traversal list is `visibleRunIds` — the queue's OWN drawn order, whose
   * doc comment has named this consumer since it was written and had none — and
   * the attention list is the NEEDS YOU band's own rows through the same
   * `bandOf`. Both are computed from the same `surfaces`/`sort` the panel below
   * renders, so a keyboard walk and a scroll cannot disagree.
   */
  /**
   * THE QUEUE'S HANDLERS, as ONE object that outlives a render (D4).
   *
   * This used to be an inline `handlers={{…}}` literal with five closures in
   * it, so `QueuePanel`'s `memo` would have compared unequal on every render
   * for a prop whose CONTENTS had not moved. The bodies are unchanged; only
   * where they are built has.
   */
  const queueHandlers = useMemo(
    (): QueueHandlers => ({
      onSelect: selectRun,
      /*
        LIVE. `actionsOf` at the call site reads the row's own served
        `actions[]`, so every control the server describes routes through
        `runAction` → `composeCommandRequest` → the one command client. A row
        served an empty list still draws nothing, with no branch here.
      */
      onAction: runAction,
      onToggleWell: (runId) => {
        const next = new Set(openWells);
        if (next.has(runId)) next.delete(runId);
        else next.add(runId);
        onWells(next);
      },
      onToggleBulk: (runId) => {
        const next = new Set(bulkIds);
        if (next.has(runId)) next.delete(runId);
        else next.add(runId);
        onBulkIds(next);
      },
      onToggleChecked: (runId) => onCheckedIds(toggleCheckedByYou(checkedIds, runId)),
      /*
        A parent can belong to ANOTHER workflow, so the jump moves the panel and
        then selects — selecting alone would open a run the queue beside it is
        scoped away from.
      */
      onOpenParent: (runId) => {
        const parent = dayWire?.queueSurfaces.find((s) => String(s.runId) === runId);
        if (parent !== undefined) setActiveWorkflowId(String(parent.workflowId));
        selectRun(runId);
      },
      /*
        THE FORWARD ROUTE (D231). Same two moves as the parent jump — switch the
        panel, then select — but it never searches the day payload: the served
        link carries its own `workflowId`, which is the whole reason the wire
        serves the link rather than a bare id. A child that ran on another day is
        exactly the case a lookup would fail silently on, and it is the case the
        chip exists for.
      */
      onOpenLinked: (link) => {
        setActiveWorkflowId(String(link.workflowId));
        selectRun(String(link.runId));
      },
    }),
    [selectRun, runAction, openWells, onWells, bulkIds, onBulkIds, checkedIds, onCheckedIds, dayWire, setActiveWorkflowId],
  );

  const keyboardOrder = useMemo(
    () => visibleRunIds(surfaces, sort, nowIso),
    [surfaces, sort, nowIso],
  );
  const keyboardAttention = useMemo(
    () => attentionRunIds(surfaces, sort, nowIso),
    [surfaces, sort, nowIso],
  );
  useGlobalKeys({
    onStartRun: () => setStartOpen(true),
    onCyclePanelMode: panelMode.cycleMode,
    panelMode: panelMode.mode,
    onMinimisePanel: () => panelMode.setMode("icon"),
    visibleRunIds: keyboardOrder,
    attentionRunIds: keyboardAttention,
    selectedRunId: route.run,
    onSelectRun: selectRun,
    panelTabs: offered,
    onTab,
  });

  /*
    BACK AND FORWARD, over PLACES rather than over presses.

    A place is `day + workflow + run + tab` (`nav-history.ts`), and the history
    is recorded by OBSERVING those four rather than by asking every navigation
    call site to remember to log itself. That is the whole reason this is cheap
    to satisfy: several routes already move the panel (the rail, search, a
    notification link, a queue row) and another will be added by somebody who
    has never read this file. An observer cannot be forgotten by a new call
    site; a `pushPlace()` sprinkled through the handlers can, and one that is
    forgotten produces a Back button that skips a step — which is worse than no
    Back button.

    The ref is what stops the observer from recording its OWN moves: applying a
    history entry changes exactly the state the effect watches, so without it
    every Back would immediately re-push the place it just left and the history
    would be two entries long forever.
  */
  const [navHistory, setNavHistory] = useState<NavHistory>(() =>
    initNavHistory({ day, workflow: activeWorkflowId, runId: route.run ?? null, tab: tab ?? null }),
  );
  const applyingNav = useRef(false);
  const settingsExitGuard = useRef<SettingsExitGuard | undefined>(undefined);
  const onSettingsExitGuardChange = useCallback((guard: SettingsExitGuard | undefined): void => {
    settingsExitGuard.current = guard;
  }, []);
  const leaveSettings = useCallback((proceed: () => void): void => {
    if (route.settings === undefined) {
      proceed();
      return;
    }
    const guard = settingsExitGuard.current;
    if (guard === undefined) throw new Error("Settings exit was requested before its draft guard mounted");
    guard(proceed);
  }, [route.settings]);

  // Browser Back/Forward changes the address before it emits `popstate`. A
  // dirty Settings page first returns to its stable cursor, without replacing
  // the browser's target entry, then lets the same page-owned guard either
  // keep it or atomically replay that target.
  onPopstateRef.current = (target: RouteHistoryTarget): void => {
    if (route.settings === undefined) {
      nativeHistory.accept(target);
      return;
    }
    nativeHistory.restore(target, () => leaveSettings(() => nativeHistory.replay(target)));
  };

  useEffect(() => {
    if (applyingNav.current) {
      applyingNav.current = false;
      return;
    }
    setNavHistory((prev) =>
      pushPlace(prev, { day, workflow: activeWorkflowId, runId: route.run ?? null, tab: tab ?? null }));
  }, [day, activeWorkflowId, route.run, tab]);

  const travel = useCallback(
    (direction: "back" | "forward"): void => {
      const next = direction === "back" ? goBack(navHistory) : goForward(navHistory);
      const place = currentPlace(next);
      if (next === navHistory || place === undefined) return;
      leaveSettings(() => {
        applyingNav.current = true;
        setNavHistory(next);
        setActiveWorkflowId(place.workflow);
        // A tab the panel no longer offers resolves to `undefined`, which is the
        // run's own default — never a forced section the detail cannot render.
        onTab(PANEL_TABS.find((candidate) => candidate === place.tab));
        // Every takeover clears, exactly as the switcher does: a place is a spot
        // in the QUEUE, and restoring one under an Archive overlay would move the
        // panel behind a screen the operator cannot see it through. The day moves
        // with the run for the same reason the demo's does — a place restored
        // into the wrong partition lands on an empty queue and reads as a broken
        // button.
        setRoute({
          ...route,
          intake: undefined,
          archive: undefined,
          archiveView: undefined,
          activity: undefined,
          explore: undefined,
          catalog: undefined,
          catalogView: undefined,
          settings: undefined,
          day: place.day,
          run: place.runId ?? undefined,
          section: place.tab ?? undefined,
        });
      });
    },
    [navHistory, route, setRoute, onTab, leaveSettings],
  );

  /** what each control will actually do, named on its face rather than guessed at */
  const nameRun = useCallback(
    (runId: string): string | undefined =>
      dayWire?.queueSurfaces.find((surface) => String(surface.runId) === runId)?.title,
    [dayWire],
  );

  const navBackTo = navDestinationLabel(navHistory, "back", nameRun, workflowLabelOf);
  const navForwardTo = navDestinationLabel(navHistory, "forward", nameRun, workflowLabelOf);
  /** The bar's history controls, as ONE object per change rather than per render (D4). */
  const nav = useMemo(
    (): NavControls => ({
      canBack: canGoBack(navHistory),
      canForward: canGoForward(navHistory),
      ...(navBackTo === undefined ? {} : { backTo: navBackTo }),
      ...(navForwardTo === undefined ? {} : { forwardTo: navForwardTo }),
      onBack: () => travel("back"),
      onForward: () => travel("forward"),
    }),
    [navHistory, navBackTo, navForwardTo, travel],
  );

  /**
   * THE `memo` BOUNDARY'S PROPS (D4).
   *
   * `TopBar` and `LogPanel` are `memo`'d, so each of these used to be written
   * inline in a prop slot and each was a fresh reference on every render:
   * `dayWire?.queueSurfaces ?? []` mints an array whenever the day has not
   * loaded, `SettingsSectionPrimitiveSchema.array().parse(…)` mints one AND
   * re-runs a zod parse on every render of the whole app, and an inline
   * `onDay`/`nav` closes over the route. Naming them here is what makes the
   * wrappers below real rather than decorative;
   * `dashboard-memo-prop-stability` refuses the inline forms.
   */
  const daySurfaces = useMemo(
    (): readonly QueueSurfaceWire[] => dayWire?.queueSurfaces ?? NO_SURFACES,
    [dayWire],
  );
  const dayNotifications = useMemo(
    // The boot document composes this array from zod parts, so it infers as
    // `unknown[]` at the wire; the day payload is already parsed whole.
    (): readonly NotificationRowWire[] => dayWire?.notifications ?? NO_NOTIFICATIONS,
    [dayWire],
  );
  const dayMonthCounts = useMemo(
    (): readonly DayCountWire[] => dayWire?.monthCounts ?? NO_DAY_COUNTS,
    [dayWire],
  );
  // Same story as `systemInstances`: the boot document composes this array from
  // zod parts so it infers as `unknown[]`; re-parsing is the check bootstrap's
  // own refinement makes, not a cast past one. It is done ONCE per boot
  // document here rather than once per render of the app.
  const settingsSections = useMemo(
    () => SettingsSectionPrimitiveSchema.array().parse(boot.settingsSections),
    [boot.settingsSections],
  );
  // Settings → Workflow capabilities joins its served rows to THESE labels: the
  // capability wire carries none on purpose, so one page cannot hold two names
  // for one workflow (D274 item 6).
  const workflowLabels = useMemo(
    () => new Map(workflows.map((workflow) => [String(workflow.id), workflow.label])),
    [workflows],
  );
  const onSelectDay = useCallback(
    (next: string): void => setRoute({ ...route, day: next }),
    [route, setRoute],
  );

  /**
   * The open panel's ROW and its served controls, resolved ONCE.
   *
   * Both used to be written inline, and the `find` ran twice per render over
   * the whole day. Since D4's patch-splice an untouched row keeps its
   * reference through an SSE patch, so this memo returns the SAME surface
   * across a patch for any OTHER run — which is exactly what lets `LogPanel`'s
   * `memo` skip a 2,000-line subtree during a bulk run.
   */
  const openPanelSurface = useMemo(
    (): QueueSurfaceWire | undefined =>
      detailValue === undefined
        ? undefined
        : dayWire?.queueSurfaces.find((s) => s.runId === detailValue.runId),
    [dayWire, detailValue],
  );
  const openPanelActions = useMemo(() => servedActions(openPanelSurface), [openPanelSurface]);
  const onDetailEdited = useCallback((): void => setDetailNonce((nonce) => nonce + 1), []);

  const ready = dayResource.state === "loaded" || dayResource.state === "failed";
  // One resolution of "which takeover owns the main region", so the JSX below
  // cannot disagree with a link that carries more than one key.
  const takeover = activeTakeover(route);

  const shellView = shellViewOf(takeover);
  const pendingTakeoverCloseFocusId = useRef<DashboardTakeoverCloseFocusTargetId | undefined>(undefined);

  /* Intake and catalog replace the toolbar that opened them, so their door
     exists only AFTER the close route commits. Keep its stable id across that
     unmount/remount boundary, then restore focus (or the main-region fallback)
     once React has mounted the queue again. */
  useEffect(() => {
    const targetId = pendingTakeoverCloseFocusId.current;
    if (targetId === undefined) return;
    restoreDashboardTakeoverFocus(document, targetId, DASHBOARD_MAIN_REGION_ID);
    pendingTakeoverCloseFocusId.current = undefined;
  }, [takeover]);

  const closeTakeoverTo = useCallback((
    targetId: DashboardTakeoverCloseFocusTargetId,
    next: AppRouteState,
  ): void => {
    pendingTakeoverCloseFocusId.current = targetId;
    setRoute(next);
  }, [setRoute]);

  /**
   * Switching views CLEARS the other three keys rather than layering one over
   * another. Anything else lets a link accumulate takeovers whose precedence
   * the operator cannot see, and leaves a closed view still in the URL.
   */
  const onShellView = useCallback(
    (next: ShellView): void => {
      const base = {
        ...route,
        intake: undefined,
        archive: undefined,
        archiveView: undefined,
        activity: undefined,
        explore: undefined,
        catalog: undefined,
        catalogView: undefined,
        settings: undefined,
      };
      leaveSettings(() => {
        if (next === "archive") setRoute({ ...base, archive: ARCHIVE_INDEX });
        else if (next === "activity") setRoute({ ...base, activity: "" });
        else if (next === "explorer") setRoute({ ...base, explore: activeWorkflowId });
        else setRoute(base);
      });
    },
    [route, setRoute, activeWorkflowId, leaveSettings],
  );

  /**
   * Settings is a PLACE now (D272 item 1), so its two doors — the gear and the
   * storage band's `Storage health` — both push a history entry and the
   * browser's own Back returns the operator to the view they left. The empty
   * value is the page's first section; every other takeover key clears for the
   * same reason the switcher clears them.
   */
  const openSettings = useCallback((): void => {
    setRoute({
      ...route,
      intake: undefined,
      archive: undefined,
      archiveView: undefined,
      activity: undefined,
      explore: undefined,
      catalog: undefined,
      catalogView: undefined,
      settings: "",
    });
  }, [route, setRoute]);

  return (
    // NOT the theme root any more (D272 item 2): the app root moved above both
    // providers so the toast viewport inherits its custom properties, and this
    // fills it. `min-w-0` + `overflow-hidden` live up there with the root
    // classes the demo has (`min-h-0` was this tree's own addition and is what
    // a flex CHILD needs, which is exactly what this element now is).
    <div
      data-parity-ready={ready ? "true" : "loading"}
      className={cn("flex min-h-0 min-w-0 flex-1 flex-col")}
    >
      <TopBar
        view={shellView}
        onView={onShellView}
        daySurfaces={daySurfaces}
        workflowLabelOf={workflowLabelOf}
        onOpenRun={selectRun}
        notifications={dayNotifications}
        actorId={boot.actor.id}
        nowIso={nowIso}
        storage={boot.storage}
        settingsOpen={takeover === "settings"}
        onOpenSettings={openSettings}
        day={day}
        today={today}
        monthCounts={dayMonthCounts}
        onDay={onSelectDay}
        theme={theme}
        onToggleTheme={onToggleTheme}
        nav={nav}
      />

      <main
        id={DASHBOARD_MAIN_REGION_ID}
        // Only ever a programmatic focus TARGET (settings-model's
        // `settingsCloseFocusTargetId` fallback) — never in the Tab order,
        // which is what -1 (rather than 0) means here.
        tabIndex={-1}
        className="flex min-h-0 min-w-0 flex-1 flex-col"
      >
        {/*
          A DASHBOARD THAT CANNOT WORK SAYS SO ON EVERY VIEW.

          Mounted here — above the complete sidebar/content row, inside the
          full-width `main` — rather than inside Settings, because Settings is
          the page that EXPLAINS the state and an operator filing transactions
          is not in it. Every takeover below (intake, archive, explorer,
          catalog, activity) replaces the queue and inherits this band
          unchanged.

          D222: only the unreachable AUTHORITY earns this band — a stale or
          missing backup is a `storage` notification in the bell (ref dashboard-surfaces
          §2.6) plus the gear's attention dot, because it does not stop the
          work. It renders nothing at all otherwise, which is why it costs
          the shell no fixed height: an empty band held open for a state
          that is almost never true is the decoration this product spends
          its density on avoiding.
        */}
        {/*
          D281 item 7 RULES the full match: x=0, border-bottom only, no
          radius, above the switch on the queue and every takeover. That is
          the demo's exact site geometry (`hr-automation@1ec1d870`,
          `RebuildDemo.tsx:654` and `DemoSettings.tsx:1204-1237`). D276 item
          4 still protects every other `Banner`: the storage hazard selects
          the explicit `band` arm instead of changing the default card.
        */}
        <StorageBanner
          storage={boot.storage}
          onOpenSettings={openSettings}
        />

        <div className="flex min-h-0 flex-1">
          {panelMode.mode === "sidebar" && (
            <WorkflowSidebar
              mode={panelMode.mode}
              onMode={panelMode.setMode}
              workflows={workflows}
              counts={dayWire?.workflowCounts ?? []}
              activeWorkflowId={activeWorkflowId}
              onActive={setActiveWorkflowId}
            />
          )}

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">

          {/*
            The intake workspace REPLACES the queue for as long as it is open.
            It is not a dialog: the session is durable, mapping and reviewing
            take minutes, and the operator must be able to leave and come back
            to `?intake=<id>`. Hiding the queue is the honest statement that
            they are in a different task — a half-visible queue behind a
            takeover is the modal it deliberately is not.
          */}
          {takeover === "settings" ? (
            /*
              Settings REPLACES the queue (D272 item 1 / D274 item 5). It was a
              dialog, which gave the one page an operator opens most often no
              place in history and no back path — and the demo's own container
              is a page for exactly that reason.

              NO WRAPPER (UF-SET-1/4/5). All four demo-covered takeovers mount
              their own `TakeoverFrame`, whose JSDoc owns the why — geometry,
              arrival and focus, decided once. The demo's switch
              (`1ec1d870 RebuildDemo.tsx:656-678`) hands its pages straight to
              the shell column with nothing between them and it.
            */
            <SettingsPage
              storage={boot.storage}
              sections={settingsSections}
              workflowLabels={workflowLabels}
              section={route.settings ?? ""}
              actorId={boot.actor.id}
              descriptorFingerprint={boot.descriptorHash}
              preflight={boot.preflight ?? []}
              onSection={(next) => setRoute({ ...route, settings: next })}
              onExitGuardChange={onSettingsExitGuardChange}
              onClose={() => {
                // The takeover unmounts its OWN focused `Back to the
                // dashboard` button on close — restore focus to the door it
                // was opened from (or the main region behind it) before that
                // happens, matching the Radix `Dialog` behavior this page
                // replaced (unit F4b finding 1). Called before `setRoute` so
                // it runs while the gear is still the DOM's most-recently-
                // rendered state, though the gear itself never unmounts —
                // `TopBar` renders it regardless of which takeover is open.
                const gearMounted = document.getElementById(SETTINGS_GEAR_ID) !== null;
                document.getElementById(settingsCloseFocusTargetId(gearMounted))?.focus();
                setRoute({ ...route, settings: undefined });
              }}
            />
          ) : takeover === "intake" ? (
            /* UF-FU-1: the surface owns the same full-bleed `TakeoverFrame`
               as every other window-replacing view. No shell gutter may sit
               between that frame and this column. */
            <IntakeWorkspace
              workflowId={activeWorkflowId}
              workflowLabel={workflowLabelOf(activeWorkflowId)}
              actorId={boot.actor.id}
              supportsDryRun={
                startWorkflow?.inputRun.state === "present"
                && startWorkflow.inputRun.surface.supportsDryRun === true
              }
              sessionId={route.intake === INTAKE_NEW ? undefined : route.intake}
              onSession={(next) => setRoute({ ...route, intake: next ?? INTAKE_NEW })}
              onClose={() => closeTakeoverTo(
                IMPORT_SPREADSHEET_DOOR_ID,
                { ...route, intake: undefined },
              )}
              onEnqueued={() => setRoute({ ...route, intake: undefined })}
            />
          ) : takeover === "archive" ? (
            /*
              The Archive replaces the queue whole. It is the opposite view of
              the same world — what has LEFT the live surfaces — so showing it
              beside a live queue would invite exactly the comparison D80 says
              is not available: an archived run and a current one ran different
              code.

              NO WRAPPER — see the Settings arm above (UF-AR-3).
            */
            <ArchiveWorkspace
              selection={route.archive ?? ARCHIVE_INDEX}
              view={route.archiveView ?? "runs"}
              actorId={boot.actor.id}
              onSelection={(next) => setRoute({ ...route, archive: next })}
              onView={(next) => setRoute({ ...route, archiveView: next })}
              onClose={() => setRoute({ ...route, archive: undefined, archiveView: undefined })}
            />
          ) : takeover === "activity" ? (
            /*
              No `onClose`: the report carries no back button (the demo's own
              rule — the product switcher above it holds the Activity entry
              that got you here, so a second door would be a duplicate). It
              does carry the actor and the app version, because a report
              leaves the operator's screen and its footer says who made it.

              NO WRAPPER — see the Settings arm above (UF-AC-2).
            */
            <ActivityReport
              range={route.activity ?? ""}
              today={today}
              actorId={boot.actor.id}
              appVersion={boot.appVersion}
              /*
                The report's Who column resolves a sampled run id against the
                rows the shell ALREADY holds — no second fetch, so the report
                and the queue cannot name the same run two ways. These are
                the day's rows and the report spans a range, so a sampled run
                from another day is simply not here and names itself by id.
              */
              queueRows={dayWire?.queueSurfaces ?? []}
              onRange={(next) => setRoute({ ...route, activity: next })}
            />
          ) : takeover === "explore" ? (
            /*
              The explorer takes over for the same reason intake does: it is a
              different task, and a half-visible queue behind a reference view
              is the modal this deliberately is not. It carries no session, so
              closing it simply drops the key.

              NO WRAPPER — see the Settings arm above (UF-EX-2).
            */
            <WorkflowExplorer
              workflowId={route.explore ?? activeWorkflowId}
              onWorkflow={(next) => setRoute({ ...route, explore: next })}
              onVersionRegistry={() => setRoute({
                ...route,
                intake: undefined,
                archive: ARCHIVE_INDEX,
                archiveView: "versions",
                activity: undefined,
                explore: undefined,
                catalog: undefined,
                catalogView: undefined,
              })}
              onClose={() => setRoute({ ...route, explore: undefined })}
            />
          ) : takeover === "catalog" ? (
            /* UF-FU-1: `UiCatalogWorkspace` owns the full-bleed frame and its
               focus-on-enter contract; the shell adds no second wrapper. */
            <UiCatalogWorkspace
              query={route.catalog ?? ""}
              onQuery={(next) => setRoute({ ...route, catalog: next })}
              view={route.catalogView ?? DEFAULT_CATALOG_VIEW}
              onView={(next) => setRoute({ ...route, catalogView: next })}
              onClose={() => closeTakeoverTo(
                UI_CATALOG_DOOR_ID,
                { ...route, catalog: undefined, catalogView: undefined },
              )}
            />
          ) : (
          <>
          {/*
            ONE COMPOSED ACTION BAR (ref dashboard-surfaces §Shell, D18). It was two bands: a
            row of unrelated ghost buttons crammed right, above a bare status
            strip that hung off no inset at all — so the pills started 8px from
            the window edge while every other band in the shell started at
            `--ds-shell-inset`. The three groups are the demo's: where you are +
            what you start · what you are looking at · how you are looking at it.

            D224: it is an ISLAND, and the shell owns its outside edge — the
            same `mx`/`mt` inset the panel region below applies with its own
            `p-[var(--ds-shell-inset)]`, so the gap above the panels equals the
            gap between them and the toolbar reads as one more card in a shell
            made of cards. The card treatment itself lives in the component.
          */}
          <QueueToolbar
            className="mx-[var(--ds-shell-inset)] mt-[var(--ds-shell-inset)]"
            sort={sort}
            onSort={onSort}
            selectMode={selectMode}
            onSelectMode={(on) => {
              onSelectMode(on);
              if (!on) onBulkIds(new Set());
            }}
            selectedCount={bulkIds.size}
            visibleIds={selectableIds}
            onSelectAll={() => onBulkIds(new Set(selectableIds))}
            onClearSelection={() => onBulkIds(new Set())}
            bulkPlans={bulkPlans}
            bulkUnavailable={bulkUnavailable}
            onBulk={(plan) => setPendingBulk({ plan })}
            bulkOutcome={bulkOutcome}
            onDismissBulkOutcome={() => setBulkOutcome(null)}
            onSelectRun={selectRun}
            leading={
              <WorkflowPanelToggle
                mode={panelMode.mode}
                onMode={panelMode.setMode}
                activeWorkflowLabel={workflowLabelOf(activeWorkflowId)}
                activeWorkflowCode={workflowCodeOf(activeWorkflowId)}
                dayActive={dayActive}
                dayCount={dayCount}
              />
            }
            runStart={
              <>
                {/*
                  THE INTAKE ROUTE LIVES IN THE TOOLBAR HERE, and that is a
                  RULED deviation from the demo (D272 item 3, ledger rows
                  A174/B141): keep it, recorded as an intentional route
                  deviation, because removing it strands the only served door
                  into intake. The rejected alternatives were removing it for
                  exactness (B — intake loses its reachable entry point) and
                  building the Run-Modal handoff first (C — additional
                  navigation work for the same end state). The
                  reason it stands is unchanged and is the reason it goes: the
                  demo reaches its intake from INSIDE the Run Modal — a
                  spreadsheet source turns the dialog's primary into "Open the
                  intake…" — and this repository's `RunStartSurfaces` serves no
                  such handoff. Deleting the button to match the demo's toolbar
                  would make the whole intake workspace unreachable. It sits in
                  the left group because it is one of the two ways work ENTERS
                  this queue, which is what that group is; it goes when the run
                  modal grows the handoff.
                */}
                <Button
                  id={IMPORT_SPREADSHEET_DOOR_ID}
                  size="toolbar"
                  variant="outline"
                  icon={<FileSpreadsheet aria-hidden className={dsIcon.sm} />}
                  onClick={() => setRoute({ ...route, intake: INTAKE_NEW })}
                >
                  Import spreadsheet
                </Button>
                {/*
                  THE TWO REFERENCE DOORS (D275 item 1, ledger 3 CA41).
                  `ref dashboard-surfaces` §9.5.3 documented "two `ghost`
                  buttons in the panel's action bar beside `Import spreadsheet`"
                  and the tree had neither: both takeovers were reachable only
                  by typing their query param. D275 item 1 restores them and
                  supersedes the section's own 2026-08-21 correction, which
                  recorded the as-built state rather than the contract. The
                  rejected arms were hiding the navigation (B) and deleting it
                  outright (C).

                  They are `ghost` because a reference view is something the
                  operator looks UP: the two ways work ENTERS this queue —
                  `Import spreadsheet` and the run modal — keep the weight.
                  The deep links are untouched; these press the same route keys
                  a pasted link carries.
                */}
                <Button
                  size="toolbar"
                  variant="ghost"
                  icon={<Workflow aria-hidden className={dsIcon.sm} />}
                  onClick={() => setRoute({ ...route, explore: activeWorkflowId })}
                >
                  Workflow explorer
                </Button>
                <Button
                  id={UI_CATALOG_DOOR_ID}
                  size="toolbar"
                  variant="ghost"
                  icon={<BookMarked aria-hidden className={dsIcon.sm} />}
                  onClick={() => setRoute({ ...route, catalog: "", catalogView: undefined })}
                >
                  UI catalog
                </Button>
                <RunStartButton onOpen={() => setStartOpen(true)} />
              </>
            }
            filters={
              <StatusFilters statusCounts={scopedStatusCounts} active={filter} onSelect={onFilter} />
            }
          />

          <CommandResultFeed
            results={commandResults}
            onDismiss={(id) => setCommandResults((previous) => previous.filter((entry) => entry.id !== id))}
            onRefreshRow={(entry) => {
              setCommandResults((previous) => previous.filter((result) => result.id !== entry.id));
              setDetailNonce((nonce) => nonce + 1);
              selectRun(entry.targetRunId);
            }}
          />

          {/*
            THE PANEL REGION IS A GRID, AND THAT IS THE WHOLE FIX.

            It was two `flex-1` children. `flex-1` on a flex child is
            `flex-basis: 0%` plus a GROW factor, and a grow factor only
            distributes space among children that EXIST — so with no run open
            the second child was not rendered, nothing claimed the free space,
            and `QueuePanel`'s own root (a flex item with no width) shrank to
            its content. At 1440×900 that left a ~470px column of rows and ~950
            PIXELS OF EMPTY BLACK, in the middle of the surface this product is
            named after, at every viewport since 1i-spine.

            A grid cannot fail that way: the tracks exist whether or not
            anything is placed in them. `--ds-w-side-panel` (376px) is the same
            resting width the context rail uses, which is the design's own
            contract — neither side panel grows independently at wider
            viewports, so the centre stays the largest column. Below 1180 it
            collapses to one column and the panels stack.

            Ported from the demo's own panel region, legacy
            hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
            `RebuildDemo.tsx:747-748`. Note this SUPERSEDES ref dashboard-surfaces's 400/470
            table — the demo moved both side panels onto one 376px token after
            those numbers were measured, and ref frontend-backend-integration §1 makes the demo the
            visual oracle. Ref dashboard-surfaces §Shell is updated in the same commit.

            `relative` is the positioning context for the floating Workflow
            Panel, which is why the window now overlays the panels WITHOUT
            covering the bars above them — it had been absolutely positioned
            against the viewport and was clipping the status-filter row.
          */}
          <div className="relative min-h-0 flex-1">
            <div className="grid h-full grid-cols-1 gap-[var(--ds-shell-inset)] p-[var(--ds-shell-inset)] min-[1180px]:grid-cols-[var(--ds-w-side-panel)_minmax(0,1fr)]">
              <QueuePanel
                surfaces={surfaces}
                state={viewState}
                handlers={queueHandlers}
                actionsOf={servedActions}
                workflowLabelOf={workflowLabelOf}
                parentOf={parentOf}
                panelLabel={workflowLabelOf(activeWorkflowId)}
                day={day}
                isToday={day === today}
                sort={sort}
                {...(queueFilterScope === undefined ? {} : { filter: queueFilterScope })}
              />

            {/* NOTHING SELECTED IS A STATE, not the absence of one. It owes the
                three things ref dashboard-surfaces §9 says an empty state owes and no more:
                what would be here, why it is not, and what to do. It is reached
                by switching workflows, so the reason is the switch. */}
            {detailValue !== undefined ? (
                <LogPanel
                  detail={detailValue}
                  sections={sections}
                  surface={openPanelSurface}
                  /*
                    The WHOLE served list, not a placement slice: the prop's
                    contract is "every action the server served for this run"
                    and the panel filters by placement itself. Pre-filtering
                    here to `footer` and letting `OutcomeActionButton` filter
                    again to `outcome` intersected the two, so only a descriptor
                    carrying BOTH placements could ever have arrived.
                  */
                  actions={openPanelActions}
                  onAction={runAction}
                  tab={effectiveTab}
                  onTab={onTab}
                  workflowLabel={workflowLabelOf(detailValue.header.workflowId)}
                  currentAppVersion={boot.appVersion}
                  servedDescriptorHash={workflowShapeOf(detailValue.header.workflowId)}
                  actorId={boot.actor.id}
                  onDetailEdited={onDetailEdited}
                  aiAdvisory={advisoryAvailability}
                  /* The SAME instant `viewState.nowIso` dates the queue's rows
                     from, so a waiting run's age is one number wherever it is
                     read. The panel used to take its own wall clock; since
                     D256 the shared instant TICKS instead of being frozen at
                     page load. */
                  servedNow={nowIso}
                />
            ) : (
              <Panel className="min-h-0">
                <PanelBody className="grid place-items-center p-[var(--ds-space-page)]">
                  <EmptyState
                    icon={<PanelRight aria-hidden className={dsIcon.lg} />}
                    title="No run open"
                    description={`Pick a run from the ${workflowLabelOf(activeWorkflowId)} queue and its logs, decisions, data and receipt open here. The run you had open belongs to a different workflow, so it closed when you switched.`}
                  />
                </PanelBody>
              </Panel>
            )}
            </div>

            {/* The floating window lives INSIDE the panel region, so it overlays
                the panels and never the bars above them — and it is rendered on
                the queue view only, as in the demo. A takeover replaces the
                queue whole; a workflow switcher hovering over it would be
                offering to change the scope of a surface that no longer has
                one. */}
            {panelMode.mode === "floating" && (
              <WorkflowWindow
                mode={panelMode.mode}
                onMode={panelMode.setMode}
                opened={panelMode.opened}
                workflows={workflows}
                counts={dayWire?.workflowCounts ?? []}
                activeWorkflowId={activeWorkflowId}
                onActive={setActiveWorkflowId}
              />
            )}
          </div>
          </>
          )}
          </div>
        </div>
      </main>

      <SessionPanel
        workerCards={dayWire?.workerCards ?? []}
        queueSurfaces={dayWire?.queueSurfaces ?? []}
        workerPools={dayWire?.workerPools ?? []}
        workflows={workflows}
        counts={dayWire?.workflowCounts ?? []}
        nowIso={nowIso}
        connection={connection}
        appVersion={boot.appVersion}
        onStopWorker={stopWorker}
        onPlanWorkerCount={planWorkerCount}
        onSpawnWorker={spawnWorker}
      />

      <RunStartSurfaces
        open={startOpen}
        onOpenChange={setStartOpen}
        workflows={startWorkflows}
        panelWorkflowId={activeWorkflowId}
        actorId={boot.actor.id}
      />

      {/* Destructive commands ask first — with the SERVER's own description of
          the blast radius (`DemoActions.tsx:430-447`). Group cancel is
          deliberately not in this flow: D16 keeps it out BY CONSTRUCTION, since
          its descriptor carries no `confirm` block to route on. */}
      <ConfirmCommandDialog
        pending={pendingCommand}
        onCancel={() => setPendingCommand(null)}
        onConfirm={(confirmed) => {
          setPendingCommand(null);
          dispatchCommand(confirmed.action, confirmed.target);
        }}
      />

      {/* Rename asks for a VALUE, then goes through the SAME command service as
          every other verb — CAS-bound to the row version its descriptor was
          projected at, so a name typed against yesterday's row is refused by
          the kernel with the server's own sentence rather than silently
          overwriting today's (D233). */}
      <RenameRunDialog
        pending={pendingRename}
        onCancel={() => setPendingRename(null)}
        onConfirm={(confirmed, name) => {
          setPendingRename(null);
          dispatchCommand(confirmed.action, confirmed.target, { renameAnswer: name });
        }}
      />

      {/* A BATCH WARNS FIRST (D235). The single-row confirm routes on a
          server-authored `confirm` block; a batch has no such block to route on
          — its blast radius is a fact about the SELECTION — so every bulk press
          asks, without exception, and the sentence names the count and states
          that each row is its own CAS-bound transition. */}
      <ConfirmBulkCommandDialog
        pending={pendingBulk}
        onCancel={() => setPendingBulk(null)}
        onConfirm={(confirmed) => {
          setPendingBulk(null);
          dispatchBulk(confirmed.plan);
        }}
      />
    </div>
  );
}
