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
import { useCallback, useEffect, useMemo, useState } from "react";
import { actionsAt, type ActionDescriptorWire } from "../../domain/dashboard/actions.js";
import {
  SettingsSectionPrimitiveSchema,
  SystemInstancePrimitiveSchema,
  type FrontendBootstrapWire,
} from "../../domain/dashboard/bootstrap.js";
import { CapabilityAvailabilitySchema, type CapabilityAvailability } from "../../domain/absence.js";
import { InputRunSurfaceSchema } from "../../domain/workflow/ingress.js";
import { WORKFLOW_DESCRIPTORS } from "../../workflows/descriptor-registry.js";
import { FileSpreadsheet, PanelRight } from "lucide-react";
import { Button, EmptyState, Panel, PanelBody, ToastProvider, TooltipProvider, dsIcon, useDemoTheme } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { useBootstrap } from "../state/use-bootstrap.js";
import { useDashboardDay } from "../state/use-dashboard-day.js";
import { useRunDetail } from "../state/use-run-detail.js";
import { IntakeWorkspace } from "../surfaces/intake.js";
import { ActivityReport } from "../surfaces/activity.js";
import { ARCHIVE_INDEX, ArchiveWorkspace } from "../surfaces/archive.js";
import { WorkflowExplorer } from "../surfaces/explorer.js";
import { UiCatalogWorkspace } from "../surfaces/ui-catalog.js";
import { LogPanel, defaultTabFor, tabsFor, type PanelTab } from "../surfaces/log-panel.js";
import { QueuePanel, type QueueSortKey, type QueueSurfaceWire, type QueueViewState } from "../surfaces/queue.js";
import { QueueToolbar } from "../surfaces/queue-toolbar.js";
import { RunStartButton, RunStartSurfaces, type RunStartWorkflow } from "../surfaces/run-start.js";
import {
  SessionPanel,
  StatusFilters,
  WorkflowPanelToggle,
  WorkflowSidebar,
  WorkflowWindow,
  parseWorkflowCategories,
  parseWorkflows,
  useWorkflowPanelMode,
  type StatusBucket,
  type WorkflowBootstrapPrimitive,
} from "../surfaces/shell.js";
import { StorageBanner } from "../surfaces/settings.js";
import { TopBar, serverLocalDay, type ShellView } from "../surfaces/top-bar.js";
import { usePanelSections } from "./use-panel-sections.js";
import {
  INTAKE_NEW,
  activeTakeover,
  parseRoute,
  routeToSearch,
  type AppRouteState,
} from "./url-state.js";

/**
 * The 1i BFF serves no actions yet (the action projection lands with 2g), so
 * every row and panel draws no command controls. That is the honest state of
 * the contract, not a stub: when actions arrive, this constant becomes a read
 * of the served array and nothing else in the tree changes.
 */
const SERVED_ACTIONS: readonly ActionDescriptorWire[] = [];

/** The closed tab vocabulary, so a `?section=` value is validated, not trusted. */
const PANEL_TABS: readonly PanelTab[] = ["review", "people", "logs", "receipt"];

/**
 * The short code the Run Modal's picker row draws beside a workflow's name.
 *
 * The bootstrap workflow projection does not serve one yet, so this reads it
 * when it is there and answers `undefined` when it is not — the row then draws
 * NOTHING in that slot. Deriving a two-letter code from the label here would
 * put a value the server never issued next to the identity an operator selects
 * a real HR workflow by.
 */
function workflowCode(workflow: WorkflowBootstrapPrimitive): string | undefined {
  const served: Record<string, unknown> = { ...workflow };
  const code = served["code"];
  return typeof code === "string" && code.length > 0 ? code : undefined;
}

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
  onTab: (tab: PanelTab) => void;
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
  const categories = useMemo(() => parseWorkflowCategories(boot.workflowCategories), [boot.workflowCategories]);
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

  const dayWire = dayResource.state === "loaded" ? dayResource.value : undefined;
  const workflowLabelOf = useCallback(
    (workflowId: string): string => workflows.find((w) => w.id === workflowId)?.label ?? workflowId,
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
      const code = workflowCode(entry);
      return {
        workflowId,
        label: entry.label,
        categoryId: entry.categoryId,
        ...(code === undefined ? {} : { code }),
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
        catalogOpen={takeover === "catalog"}
        onOpenCatalog={() => setRoute({ ...route, catalog: "" })}
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
        nav={{ canBack: false, canForward: false, onBack: () => undefined, onForward: () => undefined }}
      />

      <div className="flex min-h-0 flex-1">
        {panelMode.mode === "sidebar" && (
          <WorkflowSidebar
            mode={panelMode.mode}
            onMode={panelMode.setMode}
            workflows={workflows}
            categories={categories}
            counts={dayWire?.workflowCounts ?? []}
            activeWorkflowId={activeWorkflowId}
            onActive={setActiveWorkflowId}
          />
        )}

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/*
            A DEGRADED DASHBOARD SAYS SO ON EVERY VIEW.

            Mounted here — above the takeover switch, inside `main` so it hangs
            off the one `--ds-shell-inset` edge — rather than inside Settings,
            because Settings is the page that EXPLAINS the state and an
            operator filing transactions is not in it. Every takeover below
            (intake, archive, explorer, catalog, activity) replaces the queue
            and inherits this band unchanged.

            It renders nothing at all when storage is healthy, which is why it
            costs the shell no fixed height: an empty band held open for a
            state that is almost never true is the decoration this product
            spends its density on avoiding.
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
              <ActivityReport
                range={route.activity ?? ""}
                today={today}
                onRange={(next) => setRoute({ ...route, activity: next })}
                onClose={() => setRoute({ ...route, activity: undefined })}
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
            `--ds-shell-inset`. The toolbar owns the inset now, and the three
            groups are the demo's: where you are + what you start · what you are
            looking at · how you are looking at it.
          */}
          <QueueToolbar
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
              <StatusFilters
                statusCounts={dayWire?.statusCounts ?? []}
                dayCount={dayCount}
                active={filter}
                onSelect={onFilter}
              />
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
                }}
                actionsOf={() => SERVED_ACTIONS}
                workflowLabelOf={workflowLabelOf}
                panelLabel={workflowLabelOf(activeWorkflowId)}
                dayLabel={day}
                sort={sort}
                {...(filter === "all" ? {} : { filterLabel: String(filter) })}
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
                  actions={actionsAt(SERVED_ACTIONS, "footer")}
                  tab={effectiveTab}
                  onTab={onTab}
                  workflowLabel={workflowLabelOf(detailValue.header.workflowId)}
                  currentAppVersion={boot.appVersion}
                  currentDescriptorHash={boot.descriptorHash}
                  actorId={boot.actor.id}
                  onDetailEdited={() => setDetailNonce((nonce) => nonce + 1)}
                  aiAdvisory={advisoryAvailability}
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
                categories={categories}
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
        categories={categories}
        panelWorkflowId={activeWorkflowId}
        actorId={boot.actor.id}
      />
    </div>
  );
}
