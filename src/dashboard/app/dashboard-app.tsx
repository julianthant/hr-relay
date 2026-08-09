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
import { Archive as ArchiveIcon, BookMarked, ChartNoAxesColumn, FileSpreadsheet, GitBranch } from "lucide-react";
import { Button, ToastProvider, TooltipProvider, dsIcon, useDemoTheme } from "../ds/ui.js";
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
import { QueuePanel, type QueueSurfaceWire, type QueueViewState } from "../surfaces/queue.js";
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
} from "../surfaces/shell.js";
import { TopBar, serverLocalDay } from "../surfaces/top-bar.js";
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

  const startWorkflow = useMemo((): RunStartWorkflow => {
    const descriptor = WORKFLOW_DESCRIPTORS.find((d) => d.id === activeWorkflowId);
    const declared = descriptor?.surfaces?.inputRun;
    return {
      workflowId: activeWorkflowId,
      label: workflowLabelOf(activeWorkflowId),
      inputRun:
        declared === undefined
          ? { state: "absent", reason: "this workflow declares no typed-input surface" }
          : { state: "present", surface: InputRunSurfaceSchema.parse(declared) },
      // The boot document composes this array from zod parts, so it infers as
      // `unknown[]`; re-parsing is the same check bootstrap's own refinement
      // makes, not a cast past one.
      systemInstances: SystemInstancePrimitiveSchema.array().parse(boot.systemInstances),
    };
  }, [activeWorkflowId, workflowLabelOf, boot.systemInstances]);

  const viewState: QueueViewState = {
    ...(route.run === undefined ? {} : { selectedRunId: route.run }),
    openWells,
    panelWorkflowId: activeWorkflowId,
    nowIso: boot.serverClock.now,
  };

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

  return (
    <div
      data-demo-theme={theme}
      data-parity-ready={ready ? "true" : "loading"}
      className={cn("flex h-screen min-h-0 flex-col bg-[color:var(--ds-bg)] text-[color:var(--ds-fg)]")}
    >
      <TopBar
        notifications={dayWire?.notifications ?? []}
        actorId={boot.actor.id}
        storage={boot.storage}
        // Same story as `systemInstances` below: the boot document composes
        // this array from zod parts so it infers as `unknown[]`; re-parsing is
        // the check bootstrap's own refinement makes, not a cast past one.
        settingsSections={SettingsSectionPrimitiveSchema.array().parse(boot.settingsSections)}
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
          <div className="flex shrink-0 items-center gap-[var(--ds-space-base)] px-[var(--ds-shell-inset)] py-[var(--ds-space-tight)]">
            <WorkflowPanelToggle
              mode={panelMode.mode}
              onMode={panelMode.setMode}
              activeWorkflowLabel={workflowLabelOf(activeWorkflowId)}
              dayCount={dayCount}
            />
            <div className="flex-1" />
            {/*
              The two reference entries sit here, beside the panel they describe,
              because both are read from the ACTIVE workflow's context: the
              explorer opens on it, and the catalog is the vocabulary its browser
              tasks are written in. Neither is a command — they take no argument
              from the operator and change nothing — so both are secondary.
            */}
            {/*
              Archive and Activity sit with the two reference entries rather
              than in the top bar, and that is a decision, not an omission: the
              takeovers replace the MAIN REGION only, while the top bar carries
              the day nav, the calendar and the workflow counts — every one of
              which is about the dashboard view specifically. A switcher up
              there would sit above controls that do not apply to the view it
              switched to.
            */}
            <Button
              size="sm"
              variant="ghost"
              icon={<ArchiveIcon aria-hidden className={dsIcon.sm} />}
              onClick={() => setRoute({ ...route, archive: ARCHIVE_INDEX })}
            >
              Archive
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<ChartNoAxesColumn aria-hidden className={dsIcon.sm} />}
              onClick={() => setRoute({ ...route, activity: "" })}
            >
              Activity
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<GitBranch aria-hidden className={dsIcon.sm} />}
              onClick={() => setRoute({ ...route, explore: activeWorkflowId })}
            >
              Explore graph
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<BookMarked aria-hidden className={dsIcon.sm} />}
              onClick={() => setRoute({ ...route, catalog: "" })}
            >
              UI catalog
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<FileSpreadsheet aria-hidden className={dsIcon.sm} />}
              onClick={() => setRoute({ ...route, intake: INTAKE_NEW })}
            >
              Import spreadsheet
            </Button>
            <RunStartButton onOpen={() => setStartOpen(true)} />
          </div>

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
                  startWorkflow.inputRun.state === "present"
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
          <StatusFilters
            statusCounts={dayWire?.statusCounts ?? []}
            dayCount={dayCount}
            active={filter}
            onSelect={onFilter}
          />

          <div className="flex min-h-0 flex-1 gap-[var(--ds-space-base)] px-[var(--ds-shell-inset)] pb-[var(--ds-space-base)]">
            <div className="flex min-h-0 min-w-0 flex-1">
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
                }}
                actionsOf={() => SERVED_ACTIONS}
                workflowLabelOf={workflowLabelOf}
                panelLabel={workflowLabelOf(activeWorkflowId)}
                dayLabel={day}
                {...(filter === "all" ? {} : { filterLabel: String(filter) })}
              />
            </div>

            {detailValue !== undefined && (
              <div className="flex min-h-0 w-[minmax(0,var(--ds-w-panel))] min-w-0 flex-1">
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
              </div>
            )}
          </div>
          </>
          )}
        </main>

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

      <SessionPanel
        workerCards={dayWire?.workerCards ?? []}
        connection={connection}
        appVersion={boot.appVersion}
      />

      <RunStartSurfaces
        open={startOpen}
        onOpenChange={setStartOpen}
        workflow={startWorkflow}
        actorId={boot.actor.id}
      />
    </div>
  );
}
