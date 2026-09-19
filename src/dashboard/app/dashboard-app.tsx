import { routeWithoutTakeovers } from "./url-state.js";
import { PreflightActionsProvider } from "../state/preflight-actions.js";
import { resolveDateSelection, routeForDay } from "./date-state-model.js";
import { RunLaunchHost } from "./run-launch.js";
import { launchWorkflows, useRunLaunch } from "./run-launch-model.js";
import { createWorkerCommandDispatch } from "./worker-command-dispatch.js";
import { navigateNotification, type OpenNotification } from "../state/notification-navigation.js";
import { PanelRight } from "lucide-react";
import { useCallback,useMemo,useRef,useState,type CSSProperties } from "react";
import { CapabilityAvailabilitySchema,type CapabilityAvailability } from "../../domain/absence.js";
import { WorkflowBatchCommandRequestSchema } from "../../domain/commands.js";
import type { ActionDescriptorWire } from "../../domain/dashboard/actions.js";
import {
SettingsSectionPrimitiveSchema,
type FrontendBootstrapWire,
} from "../../domain/dashboard/bootstrap.js";
import type { CrossDateSearchResult } from "../../domain/dashboard/search.js";
import { EmptyState,Panel,PanelBody,ToastProvider,TooltipProvider,dsIcon,useDemoTheme,useToasts } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { useDashboardClient } from "../state/client-context.js";
import { useServedNow } from "../state/served-clock.js";
import { useBootstrap } from "../state/use-bootstrap.js";
import { useDashboardDay } from "../state/use-dashboard-day.js";
import { useRunDetail } from "../state/use-run-detail.js";
import {
commandResultFeedEntry,
toastAppliedCommandResult,
type CommandResultFeedEntry,
} from "../surfaces/actions-model.js";
import {
CommandResultFeed,
ConfirmCommandDialog,
type ActionTarget,
type PendingCommand,
} from "../surfaces/actions.js";
import { ARCHIVE_INDEX } from "../surfaces/archive-model.js";
import { serverLocalDay,type DayCountWire } from "../surfaces/date-navigation-model.js";
import { fmtClock } from "../surfaces/format.js";
import { tabsFor,type PanelTab } from "../surfaces/log-panel-model.js";
import { LogPanel } from "../surfaces/log-panel.js";
import { type NotificationRowWire } from "../surfaces/notification-bell-model.js";
import type { QueueBatch } from "../surfaces/queue-model.js";
import {
attentionRunIds,
queueRowTitle,
toggleCheckedByYou,
visibleRunIds,
type QueueSortKey,
type QueueSurfaceWire,
} from "../surfaces/queue-model.js";
import {
ConfirmBulkCommandDialog,
QueueToolbar,
type PendingBulkCommand,
} from "../surfaces/queue-toolbar.js";
import { QueuePanel,type QueueFilterScope,type QueueHandlers,type QueueViewState } from "../surfaces/queue.js";
import { useRunCaptures } from "../surfaces/run-captures-model.js";
import { RenameRunDialog,type PendingRename } from "../surfaces/run-identity.js";
import { RunStartButton } from "../surfaces/run-start.js";
import { SessionPanel } from "../surfaces/session-panel.js";
import {
DASHBOARD_MAIN_REGION_ID
} from "../surfaces/settings-model.js";
import { activeCount,activeStatusWords,parseWorkflows,useWorkflowPanelMode,workflowStatusCounts,type StatusBucket } from "../surfaces/shell-model.js";
import { StatusFilters,WorkflowPanelToggle,WorkflowSidebar,WorkflowWindow } from "../surfaces/shell.js";
import { PROPOSED_STATUS,dsStatusOf } from "../surfaces/status-model.js";
import { StorageBanner } from "../surfaces/storage-settings.js";
import { type ShellView } from "../surfaces/top-bar-model.js";
import { TopBar } from "../surfaces/top-bar.js";
import {
bulkSubjectsOf,
bulkUnavailableIds,
composeBulkRunCommand,
planBulkVerbs,
type BulkBatchOutcome,
type BulkVerbPlan,
} from "./bulk-dispatch.js";
import {
composeCommandRequest,
type CommandAction,
} from "./command-dispatch.js";
import { commandFailureToast,settleCommandResult } from "./command-result.js";
import {
RUN_START_DOOR_ID
} from "./dashboard-app-model.js";
import { DashboardTakeovers } from "./dashboard-takeovers.js";
import { useGlobalKeys } from "./global-keys.js";
import { useDashboardNavigation } from "./navigation-model.js";
import type { NativeRouteHistory,PopstateRouteHandler } from "./route-history-model.js";
import { useRoute } from "./route-history-model.js";
import { SHELL_PANEL_TABS, shellSelection } from "./shell-selection-model.js";
import { useTakeoverCloseFocus } from "./takeover-focus-model.js";
import {
activeTakeover,
routeForCrossDateSearchResult,
shellViewOf,
type AppRouteState
} from "./url-state.js";
import { usePanelSections } from "./use-panel-sections.js";


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





function servedActions(surface: QueueSurfaceWire | undefined): readonly ActionDescriptorWire[] {
  return surface?.actions ?? NO_ACTION_DESCRIPTORS;
}


export function DashboardApp() {
  const bootstrap = useBootstrap();
  const onPopstate = useRef<PopstateRouteHandler | undefined>(undefined);
  const [route, setRoute, nativeHistory] = useRoute(onPopstate);
  const { theme, toggleTheme } = useDemoTheme();
  const panelMode = useWorkflowPanelMode();
  const [filter, setFilter] = useState<StatusBucket>("all");
  const [openWells, setOpenWells] = useState<ReadonlySet<string>>(() => new Set());
  const tab = SHELL_PANEL_TABS.find(candidate => candidate === route.section);
  const setTab = useCallback((next: PanelTab | undefined) => setRoute({ ...route, section: next }), [route, setRoute]);
  /** the toolbar's ordering control and its select mode — client UI state, D18 */
  const [sort, setSort] = useState<QueueSortKey>("attention");
  const [selectMode, setSelectMode] = useState(false);
  const [bulkIds, setBulkIds] = useState<ReadonlySet<string>>(() => new Set());
  // Deliberately browser-local triage, not a durable run fact. Reloading the
  // dashboard starts this set over; only the operator can see their checks.
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<string>>(() => new Set());

  const boot = bootstrap.state === "loaded" ? bootstrap.value : undefined;

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
      className="flex h-screen min-h-[var(--ds-h-desktop-min)] min-w-[var(--ds-w-desktop-min)] flex-col overflow-hidden bg-[color:var(--ds-surface-page)] text-[color:var(--ds-fg)]"
    >
    <TooltipProvider delayDuration={200}>
    <ToastProvider>
      {boot === undefined ? (
        <BootGate bootstrap={bootstrap} />
      ) : (
        <LoadedApp
          boot={boot}
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
        className="flex min-h-screen items-center justify-center bg-[color:var(--ds-surface-page)] p-[var(--ds-space-loose)]"
      >
        <div className="max-w-prose text-[color:var(--ds-fg)]">
          <h1 className="text-[length:var(--ds-text-section)] font-semibold">The dashboard could not start</h1>
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
      className="flex min-h-screen items-center justify-center bg-[color:var(--ds-surface-page)]"
    >
      <p className="text-[color:var(--ds-fg-muted)]">Starting…</p>
    </main>
  );
}


interface LoadedAppProps {
  boot: FrontendBootstrapWire;
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
  /**
   * THE clock (D256). The server's instant is the authority; the browser
   * contributes only the monotonic time since that instant arrived, and every
   * live elapsed on the screen — the queue row's timer, the gate-age pill, the
   * session footer, the worker cards, the notification ages — is computed
   * against this ONE value. Before it, `boot.serverClock.now` was frozen at
   * page load and a parked run read `0s` for over two minutes.
   */
  const nowIso = useServedNow(boot.serverClock.now);
  const today = serverLocalDay({ ...boot.serverClock, now: nowIso });
  const dateSelection = resolveDateSelection(route.day, today);
  const day = dateSelection.state === "valid" ? dateSelection.day : dateSelection.requested;
  const dateError = dateSelection.state === "valid" ? undefined : dateSelection.reason === "future"
    ? `Date ${day} is after Today (${today}).` : `Invalid date: ${day || "(empty)"}.`;
  const { day: dayResource, connection } = useDashboardDay(dateSelection.state === "valid" ? day : undefined);

  const dayWire = dayResource.state === "loaded" && dayResource.value.day === day ? dayResource.value : undefined;
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
  const detail = useRunDetail(dateSelection.state === "valid" ? route.run : undefined, detailNonce, servedRowRevision);
  const selection = shellSelection(route, day, dayWire, detail);
  const detailValue = selection.state === "ready" ? selection.detail : undefined;
  const offered = detailValue === undefined ? [] : tabsFor(detailValue);
  const effectiveTab = selection.state === "ready" ? selection.tab : "logs";
  const { sections } = usePanelSections(detailValue, effectiveTab);
  const logsAdvertiseCaptures = detailValue?.captures !== undefined
    || detailValue?.availableSections.includes("captures") === true;
  const captures = useRunCaptures(
    route.run,
    detailValue,
    activeTakeover(route) === "none"
      && (effectiveTab === "receipt" || (effectiveTab === "logs" && logsAdvertiseCaptures)),
  );

  const workflows = useMemo(() => parseWorkflows(boot.workflows), [boot.workflows]);
  const [chosenWorkflowId, setActiveWorkflowId] = useState<string>(() => workflows[0]?.id ?? "");
  const selectedRow = dayWire?.queueSurfaces.find(row => String(row.runId) === route.run);
  const activeWorkflowId = selectedRow?.workflowId ?? chosenWorkflowId;
  const launch = useRunLaunch(route.start, DASHBOARD_MAIN_REGION_ID);
  const openStart = launch.openStart;
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
   * ACTIVE across every workflow today — queued + running + cancelling, off the day's OWN
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

  const startWorkflows = useMemo(() => launchWorkflows(workflows), [workflows]);

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

  const { nav, leaveSettings, onSettingsExitGuardChange } = useDashboardNavigation({
    route, setRoute, day, activeWorkflowId, setActiveWorkflowId, tab, onTab, dayWire,
    workflowLabelOf, onPopstateRef, nativeHistory,
  });

  const selectWorkflow = useCallback((next: string): void => {
    if (next === activeWorkflowId) return;
    setActiveWorkflowId(next);
    setRoute({ ...route, run: undefined, section: undefined });
  }, [activeWorkflowId, route, setRoute]);

  const selectRun = useCallback(
    (runId: string) => {
      leaveSettings(() => setRoute({ ...routeForCrossDateSearchResult(route, {runId, partitionDay: day}), section: "logs" }));
    },
    [route, setRoute, day, leaveSettings],
  );

  const openNotification = useCallback<OpenNotification>((id, opened, refused) => {
    void navigateNotification({ lookup: () => client.notificationTarget(id), guard: leaveSettings, refused,
      open: target => {
        const base = routeForCrossDateSearchResult(route, { runId: "", partitionDay: day });
        if (target.kind === "storage") setRoute({ ...base, run: undefined, section: undefined, settings: "storage" });
        else if (target.kind === "archive") setRoute({ ...base, run: undefined, section: undefined, archive: target.runId, archiveView: "runs" });
        else setRoute({ ...base, day: target.day, run: target.runId, section: "logs" });
        opened();
      },
    });
  }, [client, leaveSettings, route, day, setRoute]);

  const selectCrossDateRun = useCallback(
    (result: CrossDateSearchResult): void => {
      leaveSettings(() => setRoute({ ...routeForCrossDateSearchResult(route, result), section: "logs" }));
    },
    [route, setRoute, leaveSettings],
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

  const workerCommands = useMemo(() => createWorkerCommandDispatch(client, { actorId: boot.actor.id, source: "session-panel" }), [client, boot.actor.id]);
  const planWorkerCount = workerCommands.plan;
  const spawnWorker = workerCommands.spawn;

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
  const setBatchGrouping = useCallback(async (batch: QueueBatch, groupInQueue: boolean): Promise<void> => {
    const request = WorkflowBatchCommandRequestSchema.parse({ commandId: crypto.randomUUID(), requestedAt: nowIso,
      requestedBy: boot.actor.id, source: "dashboard", family: "workflow-batch", type: "set-batch-grouping",
      target: { batchId: batch.id, expectedVersion: batch.version }, payload: { groupInQueue } });
    const result = await client.executeCommand(request);
    const settlement = settleCommandResult(result);
    if (settlement.kind === "refused") throw new Error(settlement.message);
  }, [boot.actor.id, client, nowIso]);

  const queueHandlers = useMemo(
    (): QueueHandlers => ({
      onSetBatchGrouping: setBatchGrouping,
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
    [setBatchGrouping, selectRun, runAction, openWells, onWells, bulkIds, onBulkIds, checkedIds, onCheckedIds, dayWire, setActiveWorkflowId],
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
    queueVisible: activeTakeover(route) === "none" && dayWire !== undefined,
    onStartRun: openStart,
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
  // The boot document composes this array from zod parts so it infers as
  // `unknown[]`; re-parsing is the check bootstrap's
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
    (next: string): void => { if (next !== day) leaveSettings(() => setRoute(routeForDay(route, next))); },
    [day, route, setRoute, leaveSettings],
  );

  const onToday = useCallback(() => leaveSettings(() => setRoute(routeForDay(route, undefined))), [leaveSettings, route, setRoute]);

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
  const closeTakeoverTo = useTakeoverCloseFocus(takeover, setRoute);

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
  const [sessionsOpen, setSessionsOpen] = useState(false);
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
    <PreflightActionsProvider actions={{ actorId: boot.actor.id, descriptorFingerprint: boot.descriptorHash,
      showSettings: section => leaveSettings(() => setRoute({ ...routeWithoutTakeovers(route), settings: section ?? "" })),
      showSessions: () => setSessionsOpen(true),
    }}>
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
        onOpenCrossDateResult={selectCrossDateRun}
        notifications={dayNotifications}
        onOpenNotification={openNotification}
        notificationConnected={connection.state === "live" && dayWire !== undefined}
        actorId={boot.actor.id}
        nowIso={nowIso}
        storage={boot.storage}
        settingsOpen={takeover === "settings"}
        onOpenSettings={openSettings}
        day={day}
        today={today}
        dateError={dateError}
        followingToday={route.day === undefined}
        onToday={onToday}
        calendarRevision={dayWire}
        dayState={dayResource.state === "loaded" ? "loaded" : dayResource.state === "failed" ? "failed" : "loading"}
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
          {panelMode.mode === "sidebar" && dayWire !== undefined && (
            <WorkflowSidebar
              mode={panelMode.mode}
              onMode={panelMode.setMode}
              workflows={workflows}
              counts={dayWire?.workflowCounts ?? []}
              activeWorkflowId={activeWorkflowId}
              onActive={selectWorkflow}
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
          <DashboardTakeovers takeover={takeover} route={route} setRoute={setRoute} boot={boot}
            settingsSections={settingsSections} workflowLabels={workflowLabels} activeWorkflowId={activeWorkflowId}
            workflowLabelOf={workflowLabelOf} supportsDryRun={startWorkflow?.inputRun.state === "present" && startWorkflow.inputRun.surface.supportsDryRun === true}
            today={today} queueRows={dayWire?.queueSurfaces ?? []} closeTakeoverTo={closeTakeoverTo}
            onSettingsExitGuardChange={onSettingsExitGuardChange}>
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
            leading={dayWire === undefined ? null :
              <WorkflowPanelToggle
                mode={panelMode.mode}
                onMode={panelMode.setMode}
                activeWorkflowLabel={workflowLabelOf(activeWorkflowId)}
                activeWorkflowCode={workflowCodeOf(activeWorkflowId)}
                dayActive={dayActive}
                dayActiveWords={activeStatusWords(dayWire?.statusCounts ?? [])}
                dayCount={dayCount}
              />
            }
            runStart={
              /*
                ONE TOOLBAR DOOR, AND IT IS THE MODAL (D296).

                This group used to carry three controls. `Import spreadsheet`
                was a RULED deviation from the demo (D272 item 3, ledger rows
                A174/B141) kept for one stated reason — "the demo reaches its
                intake from INSIDE the Run Modal and this repository's
                `RunStartSurfaces` serves no such handoff, so deleting the
                button would make the whole intake workspace unreachable" — and
                the same note named its own expiry: *it goes when the run modal
                grows the handoff*. The modal has grown it. The spreadsheet
                method's `Open the intake…` is the demo's own door, so the
                deviation is not overruled, it is DISCHARGED, and rejected arm C
                ("build the Run-Modal handoff first") is what landed.

                `Workflow explorer` (D275 item 1, ledger 3 CA41) goes for D295's
                reason rather than for its own: the explorer is a segment of the
                top bar's product-view switcher, so the toolbar button was a
                second door onto a takeover that already has one, and D275 item
                1's actual objection was navigation that leads NOWHERE. It still
                leads somewhere — from `Explorer`, where "where you are" is
                answered. The `explore` route key, the deep links and the
                surface are untouched.
              */
              <RunStartButton id={RUN_START_DOOR_ID} onOpen={openStart} />
            }
            filters={
              dayWire === undefined ? null : <StatusFilters statusCounts={scopedStatusCounts} active={filter} onSelect={onFilter} />
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
            <div className="grid h-full grid-cols-[var(--ds-w-side-panel)_minmax(0,1fr)] gap-[var(--ds-shell-inset)] p-[var(--ds-shell-inset)]">
              {dayWire === undefined || workflows.length === 0 || !workflows.some(workflow => workflow.id === activeWorkflowId) ? (
                <Panel className="min-h-0"><PanelBody className="grid place-items-center p-[var(--ds-space-page)]">
                  <EmptyState title={dateError !== undefined ? "Choose a valid date" : dayResource.state === "failed" ? "Could not load queue" : dayWire === undefined ? "Loading queue" : workflows.length === 0 ? "No workflows available" : "Workflow unavailable"}
                    description={dateError ?? (dayResource.state === "failed" ? dayResource.error.message : dayWire === undefined ? `Waiting for the queue for ${day}.` : workflows.length === 0 ? "This server serves no workflows. Check Settings for availability." : `Workflow ${activeWorkflowId} is not served by this build. Choose an available workflow.`)} />
                </PanelBody></Panel>
              ) : <QueuePanel
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
              />}

            {/* NOTHING SELECTED IS A STATE, not the absence of one. It owes the
                three things ref dashboard-surfaces §9 says an empty state owes and no more:
                what would be here, why it is not, and what to do. It is reached
                by switching workflows, so the reason is the switch. */}
            {selection.state === "ready" ? (
                <LogPanel
                  detail={selection.detail}
                  sections={sections}
                  captures={captures}
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
                  workflowLabel={workflowLabelOf(selection.detail.header.workflowId)}
                  currentAppVersion={boot.appVersion}
                  servedDescriptorHash={workflowShapeOf(selection.detail.header.workflowId)}
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
                    title={selection.absence.title}
                    description={selection.absence.description}
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
            {panelMode.mode === "floating" && dayWire !== undefined && (
              <WorkflowWindow
                mode={panelMode.mode}
                onMode={panelMode.setMode}
                opened={panelMode.opened}
                workflows={workflows}
                counts={dayWire?.workflowCounts ?? []}
                activeWorkflowId={activeWorkflowId}
                onActive={selectWorkflow}
              />
            )}
          </div>
          </>
          </DashboardTakeovers>
          </div>
        </div>
      </main>

      <SessionPanel
        open={sessionsOpen}
        onOpenChange={setSessionsOpen}
        workerCards={dayWire?.workerCards ?? []}
        queueSurfaces={dayWire?.queueSurfaces ?? []}
        workerPools={dayWire?.workerPools ?? []}
        workflows={workflows}
        counts={dayWire?.workflowCounts ?? []}
        nowIso={nowIso}
        connection={connection}
        appVersion={boot.appVersion}
        workerCommands={workerCommands}
        onPlanWorkerCount={planWorkerCount}
        onSpawnWorker={spawnWorker}
      />

      <RunLaunchHost
        controller={launch}
        workflows={startWorkflows}
        panelWorkflowId={activeWorkflowId}
        actorId={boot.actor.id}
        /* D296 — the modal's spreadsheet method hands off to the intake
           workspace. It carries the workflow the PICKER selected, and the
           panel follows it: `IntakeWorkspace` reads `activeWorkflowId` for the
           projection it maps against, so opening the takeover without moving
           the panel would map the file onto whatever workflow the operator
           happened to be standing in. */
        onOpenIntake={(intakeWorkflowId, intakeSessionId) => {
          setActiveWorkflowId(intakeWorkflowId);
          setRoute({ ...route, intake: intakeSessionId });
        }}
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
    </PreflightActionsProvider>
  );
}
