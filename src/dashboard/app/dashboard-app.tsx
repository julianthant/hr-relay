/**
 * The composition root of the rebuild dashboard (doc 13 §2).
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActionDescriptorWire } from "../../domain/dashboard/actions.js";
import {
  SettingsSectionPrimitiveSchema,
  SystemInstancePrimitiveSchema,
  type FrontendBootstrapWire,
} from "../../domain/dashboard/bootstrap.js";
import { CapabilityAvailabilitySchema, type CapabilityAvailability } from "../../domain/absence.js";
import { InputRunSurfaceSchema } from "../../domain/workflow/ingress.js";
import { WORKFLOW_DESCRIPTORS } from "../../workflows/descriptor-registry.js";
import { FileSpreadsheet, PanelRight } from "lucide-react";
import { Button, EmptyState, Panel, PanelBody, ToastProvider, TooltipProvider, dsIcon, useDemoTheme, useToasts } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { useDashboardClient } from "../state/client-context.js";
import { useBootstrap } from "../state/use-bootstrap.js";
import { useDashboardDay } from "../state/use-dashboard-day.js";
import { useRunDetail } from "../state/use-run-detail.js";
import { IntakeWorkspace } from "../surfaces/intake.js";
import { ActivityReport } from "../surfaces/activity.js";
import { ARCHIVE_INDEX, ArchiveWorkspace } from "../surfaces/archive.js";
import { WorkflowExplorer } from "../surfaces/explorer.js";
import { UiCatalogWorkspace } from "../surfaces/ui-catalog.js";
import { LogPanel, defaultTabFor, tabsFor, type PanelTab } from "../surfaces/log-panel.js";
import {
  QueuePanel,
  attentionRunIds,
  visibleRunIds,
  type QueueFilterScope,
  type QueueSortKey,
  type QueueSurfaceWire,
  type QueueViewState,
} from "../surfaces/queue.js";
import { ConfirmCommandDialog, type ActionTarget, type PendingCommand } from "../surfaces/actions.js";
import { composeCommandRequest, type CommandAction } from "./command-dispatch.js";
import { useGlobalKeys } from "./global-keys.js";
import { PROPOSED_STATUS, dsStatusOf } from "../surfaces/status.js";
import { QueueToolbar } from "../surfaces/queue-toolbar.js";
import { RunStartButton, RunStartSurfaces, type RunStartWorkflow } from "../surfaces/run-start.js";
import {
  SessionPanel,
  StatusFilters,
  WorkflowPanelToggle,
  WorkflowSidebar,
  WorkflowWindow,
  activeCount,
  parseWorkflows,
  useWorkflowPanelMode,
  workflowStatusCounts,
  type StatusBucket,
} from "../surfaces/shell.js";
import { StorageBanner } from "../surfaces/settings.js";
import { TopBar, serverLocalDay, type ShellView } from "../surfaces/top-bar.js";
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
  parseRoute,
  routeToSearch,
  type AppRouteState,
} from "./url-state.js";

/**
 * THE ROW'S OWN CONTROLS, off the row (doc 13 §8.5).
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
function servedActions(surface: QueueSurfaceWire | undefined): readonly ActionDescriptorWire[] {
  return surface?.actions ?? [];
}

/** The closed tab vocabulary, so a `?section=` value is validated, not trusted. */
const PANEL_TABS: readonly PanelTab[] = ["review", "people", "logs", "receipt"];

/** The route, kept in the URL so every screen is addressable. */
function useRoute(): [AppRouteState, (next: AppRouteState) => void] {
  const [route, setRouteState] = useState<AppRouteState>(() => parseRoute(window.location.search));

  useEffect(() => {
    const onPop = (): void => setRouteState(parseRoute(window.location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const setRoute = useCallback((next: AppRouteState) => {
    window.history.pushState(null, "", `${window.location.pathname}${routeToSearch(next)}`);
    setRouteState(next);
  }, []);

  return [route, setRoute];
}

export function DashboardApp() {
  const bootstrap = useBootstrap();
  const [route, setRoute] = useRoute();
  const { theme, toggleTheme } = useDemoTheme();
  const panelMode = useWorkflowPanelMode();
  const [filter, setFilter] = useState<StatusBucket>("all");
  const [openWells, setOpenWells] = useState<ReadonlySet<string>>(() => new Set());
  const [tab, setTab] = useState<PanelTab | undefined>(undefined);
  /** the toolbar's ordering control and its select mode — client UI state, D18 */
  const [sort, setSort] = useState<QueueSortKey>("attention");
  const [selectMode, setSelectMode] = useState(false);
  const [bulkIds, setBulkIds] = useState<ReadonlySet<string>>(() => new Set());

  const boot = bootstrap.state === "loaded" ? bootstrap.value : undefined;
  const today = boot === undefined ? undefined : serverLocalDay(boot.serverClock);
  const day = route.day ?? today;

  // Radix tooltips need their provider ABOVE every surface that draws one, and
  // the panel draws several. Mounting it here rather than per-surface is also
  // what gives the whole app one shared open/close delay instead of each
  // tooltip negotiating its own.
  return (
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
        />
      )}
    </ToastProvider>
    </TooltipProvider>
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
}

function LoadedApp({
  boot,
  today,
  day,
  route,
  setRoute,
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
}: LoadedAppProps) {
  const { day: dayResource, connection } = useDashboardDay(day);
  // Bumped by an applied Data correction: the save moved the run version, so
  // the open detail (and, through its rowRevision, every fetched section)
  // refetches rather than serving a CAS basis the kernel will now refuse.
  const [detailNonce, setDetailNonce] = useState(0);
  const detail = useRunDetail(route.run, detailNonce);
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
   * The Settings dialog has TWO triggers — the top bar's gear and the storage
   * banner's route — so its open state is held here rather than inside the
   * control. It is client UI state, not route state: nothing about a run or a
   * day changes when it opens, so putting it in the URL would make every
   * shared link carry a dialog somebody else had open.
   */
  const [settingsOpen, setSettingsOpen] = useState(false);
  /**
   * The command waiting on the operator's confirmation. A descriptor that
   * carries a server-authored `confirm` block goes here first; everything else
   * is posted straight away (the demo's own split, `RebuildDemo.tsx:226-252` —
   * D16 keeps group cancel out of this flow BY CONSTRUCTION, because its
   * descriptor carries no `confirm`).
   */
  const [pendingCommand, setPendingCommand] = useState<PendingCommand | null>(null);
  const client = useDashboardClient();
  const { toast } = useToasts();

  const dayWire = dayResource.state === "loaded" ? dayResource.value : undefined;
  const workflowLabelOf = useCallback(
    (workflowId: string): string => workflows.find((w) => w.id === workflowId)?.label ?? workflowId,
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
      const declared = WORKFLOW_DESCRIPTORS.find((d) => d.id === workflowId)?.surfaces?.inputRun;
      return {
        workflowId,
        label: entry.label,
        categoryId: entry.categoryId,
        // D219's served taxonomy fact, carried through verbatim: the picker
        // groups by the same rule the rail does, and neither infers it.
        role: entry.role,
        code: entry.code,
        inputRun:
          declared === undefined
            ? { state: "absent", reason: "this workflow declares no typed-input surface" }
            : { state: "present", surface: InputRunSurfaceSchema.parse(declared) },
        systemInstances,
      };
    });
  }, [workflows, boot.systemInstances]);

  const startWorkflow = useMemo(
    () => startWorkflows.find((entry) => entry.workflowId === activeWorkflowId),
    [startWorkflows, activeWorkflowId],
  );

  const viewState: QueueViewState = {
    ...(route.run === undefined ? {} : { selectedRunId: route.run }),
    openWells,
    selectMode,
    bulkIds,
    panelWorkflowId: activeWorkflowId,
    nowIso: boot.serverClock.now,
  };

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
    (action: CommandAction, target: ActionTarget): void => {
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
        the human (doc 09 §14.6 risk 1).
      */
      const composed = composeCommandRequest(action, target, {
        actorId: boot.actor.id,
        source: "run-detail",
        gate: sections["identity-gate"],
      });
      if (composed.state === "refused") {
        toast({ tone: "danger", title: "Nothing was sent", description: composed.reason });
        return;
      }
      client.executeCommand(composed.request).then(
        (result) => {
          // `conflict` and `rejected` are VALUES, not exceptions (doc 13 §3.4),
          // and the server's own sentence is printed verbatim — it is the only
          // party that knows which version is live now.
          if (result.state === "conflict" || result.state === "rejected") {
            toast({ tone: "danger", title: "Nothing was recorded", description: result.message });
            return;
          }
          toast({ tone: "success", title: action.label, description: "Recorded." });
          setDetailNonce((nonce) => nonce + 1);
        },
        (caught: unknown) => {
          toast({
            tone: "danger",
            title: "Nothing was recorded",
            description: caught instanceof Error ? caught.message : String(caught),
          });
        },
      );
    },
    [boot.actor.id, client, sections, toast],
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
    [dayWire, workflowLabelOf, activeWorkflowId, dispatchCommand, selectRun],
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
  const keyboardOrder = useMemo(
    () => visibleRunIds(surfaces, sort, boot.serverClock.now),
    [surfaces, sort, boot.serverClock.now],
  );
  const keyboardAttention = useMemo(
    () => attentionRunIds(surfaces, sort, boot.serverClock.now),
    [surfaces, sort, boot.serverClock.now],
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
        activity: undefined,
        explore: undefined,
        catalog: undefined,
        day: place.day,
        run: place.runId ?? undefined,
        section: place.tab ?? undefined,
      });
    },
    [navHistory, route, setRoute, onTab],
  );

  /** what each control will actually do, named on its face rather than guessed at */
  const nameRun = useCallback(
    (runId: string): string | undefined =>
      dayWire?.queueSurfaces.find((surface) => String(surface.runId) === runId)?.title,
    [dayWire],
  );

  const navBackTo = navDestinationLabel(navHistory, "back", nameRun, workflowLabelOf);
  const navForwardTo = navDestinationLabel(navHistory, "forward", nameRun, workflowLabelOf);

  const ready = dayResource.state === "loaded" || dayResource.state === "failed";
  // One resolution of "which takeover owns the main region", so the JSX below
  // cannot disagree with a link that carries more than one key.
  const takeover = activeTakeover(route);

  /**
   * The Top Bar's switcher is a VIEW of the route, never a second copy of it.
   *
   * `activeTakeover` already resolves which key owns the main region, so the
   * pressed segment is derived from that one answer — a link carrying both
   * `?archive=` and `?explore=` lights the segment the region actually renders,
   * because both read the same resolution. The two views the switcher does not
   * name (intake and the catalog) fall back to `queue`: neither is a product
   * page, and lighting nothing would be the switcher claiming the operator is
   * nowhere.
   */
  const shellView: ShellView =
    takeover === "archive" ? "archive" : takeover === "explore" ? "explorer" : takeover === "activity" ? "activity" : "queue";

  /**
   * Switching views CLEARS the other three keys rather than layering one over
   * another. Anything else lets a link accumulate takeovers whose precedence
   * the operator cannot see, and leaves a closed view still in the URL.
   */
  const onShellView = useCallback(
    (next: ShellView): void => {
      const base = { ...route, intake: undefined, archive: undefined, activity: undefined, explore: undefined, catalog: undefined };
      if (next === "archive") setRoute({ ...base, archive: ARCHIVE_INDEX });
      else if (next === "activity") setRoute({ ...base, activity: "" });
      else if (next === "explorer") setRoute({ ...base, explore: activeWorkflowId });
      else setRoute(base);
    },
    [route, setRoute, activeWorkflowId],
  );

  return (
    <div
      data-demo-theme={theme}
      data-parity-ready={ready ? "true" : "loading"}
      className={cn("flex h-screen min-h-0 flex-col bg-[color:var(--ds-bg)] text-[color:var(--ds-fg)]")}
    >
      <TopBar
        view={shellView}
        onView={onShellView}
        daySurfaces={dayWire?.queueSurfaces ?? []}
        workflowLabelOf={workflowLabelOf}
        onOpenRun={selectRun}
        notifications={dayWire?.notifications ?? []}
        actorId={boot.actor.id}
        storage={boot.storage}
        // Same story as `systemInstances` below: the boot document composes
        // this array from zod parts so it infers as `unknown[]`; re-parsing is
        // the check bootstrap's own refinement makes, not a cast past one.
        settingsSections={SettingsSectionPrimitiveSchema.array().parse(boot.settingsSections)}
        settingsOpen={settingsOpen}
        onSettingsOpen={setSettingsOpen}
        day={day}
        today={today}
        monthCounts={dayWire?.monthCounts ?? []}
        onDay={(next) => setRoute({ ...route, day: next })}
        theme={theme}
        onToggleTheme={onToggleTheme}
        nav={{
          canBack: canGoBack(navHistory),
          canForward: canGoForward(navHistory),
          ...(navBackTo === undefined ? {} : { backTo: navBackTo }),
          ...(navForwardTo === undefined ? {} : { forwardTo: navForwardTo }),
          onBack: () => travel("back"),
          onForward: () => travel("forward"),
        }}
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

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/*
            A DASHBOARD THAT CANNOT WORK SAYS SO ON EVERY VIEW.

            Mounted here — above the takeover switch, inside `main` so it hangs
            off the one `--ds-shell-inset` edge — rather than inside Settings,
            because Settings is the page that EXPLAINS the state and an
            operator filing transactions is not in it. Every takeover below
            (intake, archive, explorer, catalog, activity) replaces the queue
            and inherits this band unchanged.

            D222: only the unreachable AUTHORITY earns this band — a stale or
            missing backup is a `storage` notification in the bell (doc 03
            §2.6) plus the gear's attention dot, because it does not stop the
            work. It renders nothing at all otherwise, which is why it costs
            the shell no fixed height: an empty band held open for a state
            that is almost never true is the decoration this product spends
            its density on avoiding.
          */}
          <StorageBanner
            storage={boot.storage}
            onOpenSettings={() => setSettingsOpen(true)}
            className="mx-[var(--ds-shell-inset)] mt-[var(--ds-space-tight)]"
          />

          {/*
            The intake workspace REPLACES the queue for as long as it is open.
            It is not a dialog: the session is durable, mapping and reviewing
            take minutes, and the operator must be able to leave and come back
            to `?intake=<id>`. Hiding the queue is the honest statement that
            they are in a different task — a half-visible queue behind a
            takeover is the modal it deliberately is not.
          */}
          {takeover === "intake" ? (
            <div className="flex min-h-0 flex-1 px-[var(--ds-shell-inset)] pb-[var(--ds-space-base)]">
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
                onClose={() => setRoute({ ...route, intake: undefined })}
                onEnqueued={() => setRoute({ ...route, intake: undefined })}
              />
            </div>
          ) : takeover === "archive" ? (
            /*
              The Archive replaces the queue whole. It is the opposite view of
              the same world — what has LEFT the live surfaces — so showing it
              beside a live queue would invite exactly the comparison D80 says
              is not available: an archived run and a current one ran different
              code.
            */
            <div className="flex min-h-0 flex-1 px-[var(--ds-shell-inset)] pb-[var(--ds-space-base)]">
              <ArchiveWorkspace
                selection={route.archive ?? ARCHIVE_INDEX}
                actorId={boot.actor.id}
                onSelection={(next) => setRoute({ ...route, archive: next })}
                onClose={() => setRoute({ ...route, archive: undefined })}
              />
            </div>
          ) : takeover === "activity" ? (
            <div className="flex min-h-0 flex-1 px-[var(--ds-shell-inset)] pb-[var(--ds-space-base)]">
              {/*
                No `onClose`: the report carries no back button (the demo's own
                rule — the product switcher above it holds the Activity entry
                that got you here, so a second door would be a duplicate). It
                does carry the actor and the app version, because a report
                leaves the operator's screen and its footer says who made it.
              */}
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
            </div>
          ) : takeover === "explore" ? (
            /*
              The explorer takes over for the same reason intake does: it is a
              different task, and a half-visible queue behind a reference view
              is the modal this deliberately is not. It carries no session, so
              closing it simply drops the key.
            */
            <div className="flex min-h-0 flex-1 px-[var(--ds-shell-inset)] pb-[var(--ds-space-base)]">
              <WorkflowExplorer
                workflowId={route.explore ?? activeWorkflowId}
                onWorkflow={(next) => setRoute({ ...route, explore: next })}
                onClose={() => setRoute({ ...route, explore: undefined })}
              />
            </div>
          ) : takeover === "catalog" ? (
            <div className="flex min-h-0 flex-1 px-[var(--ds-shell-inset)] pb-[var(--ds-space-base)]">
              <UiCatalogWorkspace
                query={route.catalog ?? ""}
                onQuery={(next) => setRoute({ ...route, catalog: next })}
                onClose={() => setRoute({ ...route, catalog: undefined })}
              />
            </div>
          ) : (
          <>
          {/*
            ONE COMPOSED ACTION BAR (doc 03 §Shell, D18). It was two bands: a
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
                  named deviation from the demo rather than a leftover. The
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
                  size="toolbar"
                  variant="outline"
                  icon={<FileSpreadsheet aria-hidden className={dsIcon.sm} />}
                  onClick={() => setRoute({ ...route, intake: INTAKE_NEW })}
                >
                  Import spreadsheet
                </Button>
                <RunStartButton onOpen={() => setStartOpen(true)} />
              </>
            }
            filters={
              <StatusFilters statusCounts={scopedStatusCounts} active={filter} onSelect={onFilter} />
            }
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
            `RebuildDemo.tsx:747-748`. Note this SUPERSEDES doc 03's 400/470
            table — the demo moved both side panels onto one 376px token after
            those numbers were measured, and doc 13 §1 makes the demo the
            visual oracle. Doc 03 §Shell is updated in the same commit.

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
                handlers={{
                  onSelect: selectRun,
                  /*
                    LIVE. `actionsOf` below reads the row's own served
                    `actions[]`, so every control the server describes routes
                    through `runAction` → `composeCommandRequest` → the one
                    command client. A row served an empty list still draws
                    nothing, with no branch here.
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
                  /*
                    A parent can belong to ANOTHER workflow, so the jump moves
                    the panel and then selects — selecting alone would open a
                    run the queue beside it is scoped away from.
                  */
                  onOpenParent: (runId) => {
                    const parent = dayWire?.queueSurfaces.find((s) => String(s.runId) === runId);
                    if (parent !== undefined) setActiveWorkflowId(String(parent.workflowId));
                    selectRun(runId);
                  },
                }}
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
                three things doc 03 §9 says an empty state owes and no more:
                what would be here, why it is not, and what to do. It is reached
                by switching workflows, so the reason is the switch. */}
            {detailValue !== undefined ? (
                <LogPanel
                  detail={detailValue}
                  sections={sections}
                  surface={dayWire?.queueSurfaces.find((s) => s.runId === detailValue.runId)}
                  /*
                    The WHOLE served list, not a placement slice: the prop's
                    contract is "every action the server served for this run"
                    and the panel filters by placement itself. Pre-filtering
                    here to `footer` and letting `OutcomeActionButton` filter
                    again to `outcome` intersected the two, so only a descriptor
                    carrying BOTH placements could ever have arrived.
                  */
                  actions={servedActions(dayWire?.queueSurfaces.find((s) => s.runId === detailValue.runId))}
                  onAction={runAction}
                  tab={effectiveTab}
                  onTab={onTab}
                  workflowLabel={workflowLabelOf(detailValue.header.workflowId)}
                  currentAppVersion={boot.appVersion}
                  currentDescriptorHash={boot.descriptorHash}
                  actorId={boot.actor.id}
                  onDetailEdited={() => setDetailNonce((nonce) => nonce + 1)}
                  aiAdvisory={advisoryAvailability}
                  /* The SAME instant `viewState.nowIso` dates the queue's rows
                     from, so a waiting run's age is one number wherever it is
                     read. The panel used to take its own wall clock. */
                  servedNow={boot.serverClock.now}
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
        </main>
      </div>

      <SessionPanel
        workerCards={dayWire?.workerCards ?? []}
        connection={connection}
        appVersion={boot.appVersion}
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
    </div>
  );
}
