import { RerunValuesRequestSchema } from "../../domain/dashboard/rerun-values.js";
import { routeWithoutTakeovers } from "./url-state.js";
import { PreflightActionsProvider } from "../state/preflight-actions.js";
import { resolveDateSelection, routeForStartedRun } from "./date-state-model.js";
import { RunLaunchHost } from "./run-launch.js";
import { launchWorkflows, useRunLaunch } from "./run-launch-model.js";
import { PanelRight } from "lucide-react";
import { useCallback,useMemo,useRef,useState,type CSSProperties,type ReactNode } from "react";
import { WorkflowBatchCommandRequestSchema } from "../../domain/commands.js";
import type { ActionDescriptorWire } from "../../domain/dashboard/actions.js";
import {
SettingsSectionPrimitiveSchema,
type FrontendBootstrapWire,
} from "../../domain/dashboard/bootstrap.js";
import { Button,DatePicker,EmptyState,Panel,PanelBody,ToastProvider,TooltipProvider,dsIcon,useDemoTheme,useToasts } from "../ds/ui.js";
import { useDashboardClient } from "../state/client-context.js";
import { useServedNow } from "../state/served-clock.js";
import { useBootstrap } from "../state/use-bootstrap.js";
import { useDashboardDay } from "../state/use-dashboard-day.js";
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
import { CommandRecovery, type CommandRecoveryEntry } from "../surfaces/command-recovery.js";
import { serverLocalDay } from "../surfaces/date-navigation-model.js";
import { fmtClock } from "../surfaces/format.js";
import { type PanelTab } from "../surfaces/log-panel-model.js";
import { LogSample } from "../surfaces/logs/log-sample.js";
import type { QueueBatch } from "../surfaces/queue-model.js";
import {
  attentionRunIds,
  filterQueueSurfaces,
  groupQueueAttempts,
  queueRowTitle,
visibleRunIds,
type QueueSortKey,
type QueueSurfaceWire,
} from "../surfaces/queue-model.js";
import {
ConfirmBulkCommandDialog,
BulkCommandFeedback,
type PendingBulkCommand,
} from "../surfaces/queue-toolbar.js";
import { FocusQueueHeader, FocusQueueToolbar } from '../surfaces/queue-focus.js';
import { queuePreviewCounts, useQueuePreview, type QueueMockAction } from '../surfaces/queue-preview-model.js';
import { QueuePanel,type QueueFilterScope,type QueueHandlers,type QueueViewState } from "../surfaces/queue.js";
import { RenameRunDialog,type PendingRename } from "../surfaces/run-identity.js";
import { RunStartButton } from "../surfaces/run-start.js";
import { SessionPanel } from "../surfaces/session-panel.js";
import {
DASHBOARD_MAIN_REGION_ID
} from "../surfaces/settings-model.js";
import {parseWorkflows,useSelectedWorkflow,type StatusBucket } from "../surfaces/shell-model.js";
import { WorkflowMockQueue } from "../surfaces/workflow-mock-queue.js";
import { WORKFLOW_RAIL_PREVIEWS } from "../surfaces/workflow-rail-model.js";
import "../surfaces/permanent-shell.css";
import { PROPOSED_STATUS,dsStatusOf } from "../surfaces/status-model.js";
import { StorageBanner } from "../surfaces/storage-settings.js";
import { WorkspaceRail } from "../surfaces/workspace-rail.js";
import {
bulkSubjectsOf,
composeBulkRunCommand,
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
import { SHELL_PANEL_TABS } from "./shell-selection-model.js";
import { useTakeoverCloseFocus } from "./takeover-focus-model.js";
import {
activeTakeover,
routeForCrossDateSearchResult,
type AppRouteState
} from "./url-state.js";


const NO_LOG_TABS: readonly PanelTab[] = Object.freeze([]);

const NO_ACTION_DESCRIPTORS: readonly ActionDescriptorWire[] = Object.freeze([]);





function servedActions(surface: QueueSurfaceWire | undefined): readonly ActionDescriptorWire[] {
  return surface?.actions ?? NO_ACTION_DESCRIPTORS;
}


export function DashboardApp() {
  const bootstrap = useBootstrap();
  const onPopstate = useRef<PopstateRouteHandler | undefined>(undefined);
  const [route, setRoute, nativeHistory] = useRoute(onPopstate);
  const { theme, toggleTheme } = useDemoTheme();
  const [filter, setFilter] = useState<StatusBucket>("all");
  const [openWells, setOpenWells] = useState<ReadonlySet<string>>(() => new Set());
  const tab = SHELL_PANEL_TABS.find(candidate => candidate === route.section);
  const setTab = useCallback((next: PanelTab | undefined) => setRoute({ ...route, section: next }), [route, setRoute]);
  /** the toolbar's ordering control and its select mode — client UI state, D18 */
  const [sort, setSort] = useState<QueueSortKey>("attention");
  const [selectMode, setSelectMode] = useState(false);
  const [bulkIds, setBulkIds] = useState<ReadonlySet<string>>(() => new Set());

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
  route,
  setRoute,
  onPopstateRef,
  nativeHistory,
  theme,
  onToggleTheme,
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
  const { day: dayResource } = useDashboardDay(dateSelection.state === "valid" ? day : undefined);

  const dayWire = dayResource.state === "loaded" && dayResource.value.day === day ? dayResource.value : undefined;
  const [commandResults, setCommandResults] = useState<readonly CommandResultFeedEntry[]>([]);

  const workflows = useMemo(() => parseWorkflows(boot.workflows), [boot.workflows]);
  const { selectedWorkflowId: chosenWorkflowId, setSelectedWorkflowId: setActiveWorkflowId } = useSelectedWorkflow(workflows);
  const previewQueue = useQueuePreview(dayWire?.queueSurfaces, day);
  const selectedRow = previewQueue.rows.find(row => String(row.runId) === route.run);
  const activeWorkflowId = selectedRow?.workflowId ?? chosenWorkflowId;
  const launch = useRunLaunch(route.start, DASHBOARD_MAIN_REGION_ID);
  const openStart = launch.openStart;
  const openRerun = launch.openRerun;
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
type UncertainCommandEntry = CommandRecoveryEntry & (
  | {
      readonly kind: "single";
      readonly inFlightKey: string;
      readonly request: unknown;
      readonly action: CommandAction;
      readonly target: ActionTarget;
    }
  | {
      readonly kind: "bulk";
      readonly inFlightKey: string;
      readonly request: unknown;
      readonly plan: BulkVerbPlan;
      readonly subjects: ReadonlyMap<string, string>;
    });

  const [pendingBulk, setPendingBulk] = useState<PendingBulkCommand | null>(null);
  const [bulkOutcome, setBulkOutcome] = useState<BulkBatchOutcome | null>(null);
  const inFlightCommands = useRef<Set<string>>(new Set());
  const uncertainCommands = useRef<Map<string, UncertainCommandEntry>>(new Map());
  const [recoveryEntries, setRecoveryEntries] = useState<readonly UncertainCommandEntry[]>([]);
  const [pendingRecovery, setPendingRecovery] = useState<string | null>(null);
  const routeRef = useRef(route);
  routeRef.current = route;
  const bulkIdsRef = useRef(bulkIds);
  bulkIdsRef.current = bulkIds;
  const client = useDashboardClient();
  const { toast } = useToasts();

  const workflowLabelOf = useCallback(
    (workflowId: string): string => workflows.find((w) => w.id === workflowId)?.label ?? workflowId,
    [workflows],
  );
  const surfaces = useMemo((): readonly QueueSurfaceWire[] => {
    if (dayWire === undefined) return [];
    const scoped = previewQueue.rows.filter((s) => s.workflowId === activeWorkflowId);
    return filterQueueSurfaces(scoped, filter);
  }, [dayWire, previewQueue.rows, activeWorkflowId, filter]);

  /** Local mock counts follow the latest attempt; served day/rail counts keep their own scope. */
  const scopedStatusCounts = useMemo(
    () => queuePreviewCounts(previewQueue.rows, activeWorkflowId),
    [previewQueue.rows, activeWorkflowId],
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
      panelWorkflowId: activeWorkflowId,
      nowIso,
    }),
    [route.run, openWells, selectMode, bulkIds, activeWorkflowId, nowIso],
  );

  /**
   * What `Select all in view` may take: the TOP-LEVEL rows drawn on screen, in
   * the order they are drawn. A member is acted on through its group or on its
   * own row and is never half-selected with it, which is why it never enters
   * this set — `visibleRunIds` includes members, so it is not the same list.
   */
  const selectableIds = useMemo(
    () => groupQueueAttempts(surfaces)
      .map((item) => item.representative)
      .filter((surface) => surface.lineage.state !== "child")
      .map((surface) => String(surface.runId)),
    [surfaces],
  );

  const { leaveSettings, onSettingsExitGuardChange } = useDashboardNavigation({
    route, setRoute, day, activeWorkflowId, setActiveWorkflowId, tab, onTab, dayWire,
    workflowLabelOf, onPopstateRef, nativeHistory,
  });

  const selectWorkflow = useCallback((next: string): void => {
    if (next === activeWorkflowId) return;
    setActiveWorkflowId(next);
    setRoute({ ...route, run: undefined, section: undefined });
  }, [activeWorkflowId, route, setRoute, setActiveWorkflowId]);

  const selectRun = useCallback(
    (runId: string) => {
      leaveSettings(() => setRoute({ ...routeForCrossDateSearchResult(route, {runId, partitionDay: day}), section: "logs" }));
    },
    [route, setRoute, day, leaveSettings],
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
    (action: CommandAction, target: ActionTarget, answers: {
      recovery?: UncertainCommandEntry;
      renameAnswer?: string;
      source?: "queue" | "run-detail";
      commandId?: string;
      requestedAt?: string;
    } = {}): void => {
      const inFlightKey = action.command === "resolve-gate"
        ? `${target.runId}:gate:${(target as { gateId?: string }).gateId ?? ""}`
        : `${target.runId}:${action.command}`;
      if (inFlightCommands.current.has(inFlightKey)) return;
      const existingUncertain = uncertainCommands.current.get(inFlightKey);
      if (answers.recovery !== undefined && answers.recovery !== existingUncertain) return;
      if (existingUncertain !== undefined && answers.recovery !== existingUncertain) {
        setPendingRecovery(inFlightKey);
        return;
      }
      let requestToExecute: unknown;
      let actionToSettle = action;
      let targetToSettle = target;

      if (existingUncertain?.kind === "single") {
        requestToExecute = existingUncertain.request;
        actionToSettle = existingUncertain.action;
        targetToSettle = existingUncertain.target;
      } else {
        const commandId = answers.commandId ?? crypto.randomUUID();
        const requestedAt = answers.requestedAt ?? nowIso;
        const source = answers.source ?? "queue";

        const composed = composeCommandRequest(action, target, {
          actorId: boot.actor.id,
          source,
          commandId,
          requestedAt,
          ...(answers.renameAnswer === undefined ? {} : { renameAnswer: answers.renameAnswer }),
        });
        if (composed.state === "refused") {
          toast(commandFailureToast({ stage: "before-dispatch", reason: composed.reason }));
          return;
        }
        requestToExecute = composed.request;
      }

      inFlightCommands.current.add(inFlightKey);
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
      client.executeCommand(requestToExecute).then(
        (result) => {
          inFlightCommands.current.delete(inFlightKey);
          uncertainCommands.current.delete(inFlightKey);
          setRecoveryEntries([...uncertainCommands.current.values()]);
          // `conflict` and `rejected` are VALUES, not exceptions (ref frontend-backend-integration §3.4),
          // and WHETHER one of them landed is decided ONCE, by the fold (D253,
          // Track D row D3) — this callback reads the verdict rather than
          // re-taking the union apart. The description is still the server's
          // own sentence verbatim: it is the only party that knows which
          // version is live now, and neither refusal changes what this toast
          // says about the command it answers.
          const settlement = settleCommandResult(result);
          const surface = dayWire?.queueSurfaces.find((row) => String(row.runId) === targetToSettle.runId);
          if (settlement.kind === "refused") {
            const feedEntry = commandResultFeedEntry({
              settlement,
              targetRunId: targetToSettle.runId,
              expectedVersion: targetToSettle.expectedVersion,
              commandId: String(result.commandId),
              subject: surface === undefined ? `run ${targetToSettle.runId}` : queueRowTitle(surface),
              workflowLabel: workflowLabelOf(String(surface?.workflowId ?? activeWorkflowId)),
              actionLabel: actionToSettle.label,
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
            actionLabel: actionToSettle.label,
            subject: surface === undefined ? `run ${targetToSettle.runId}` : queueRowTitle(surface),
            clock: fmtClock(nowIso),
            actorId: boot.actor.id,
          });
          if (actionToSettle.command === "delete") {
            const deletedRunIds = new Set<string>();
            deletedRunIds.add(targetToSettle.runId);
            if ("affectedTargets" in result && Array.isArray(result.affectedTargets)) {
              for (const affected of result.affectedTargets) {
                if (affected && typeof affected === "object" && "family" in affected && affected.family === "run" && "runId" in affected && typeof affected.runId === "string") {
                  deletedRunIds.add(affected.runId);
                }
              }
            }
            const currentRoute = routeRef.current;
            if (currentRoute.run !== undefined && deletedRunIds.has(currentRoute.run)) {
              setRoute({ ...currentRoute, run: undefined, section: undefined });
            }
            const currentBulk = bulkIdsRef.current;
            const remainingBulk = new Set(currentBulk);
            let bulkChanged = false;
            for (const id of deletedRunIds) {
              if (remainingBulk.delete(id)) {
                bulkChanged = true;
              }
            }
            if (bulkChanged) {
              onBulkIds(remainingBulk);
            }
          }
        },
      ).catch((caught: unknown) => {
        inFlightCommands.current.delete(inFlightKey);
        uncertainCommands.current.set(inFlightKey, {
          kind: "single",
          label: actionToSettle.label,
          targets: [{ ...targetToSettle, title: dayWire?.queueSurfaces.find(row => String(row.runId) === targetToSettle.runId)?.title ?? `run ${targetToSettle.runId}` }],
          detail: existingUncertain?.detail ?? (answers.renameAnswer === undefined ? undefined : `Requested name: ${answers.renameAnswer}`),
          inFlightKey,
          request: requestToExecute,
          action: actionToSettle,
          target: targetToSettle,
        });
        setRecoveryEntries([...uncertainCommands.current.values()]);
        // NOT "Nothing was recorded": the envelope is already on the wire by
        // the time anything can land here, so whether the kernel wrote the row
        // is a fact this tab does not hold (`commandFailureToast`).
        toast(commandFailureToast({ stage: "after-dispatch", caught }));
      });
    },
    [boot.actor.id, client, toast, dayWire, workflowLabelOf, activeWorkflowId, nowIso, setRoute, onBulkIds],
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
    (plan: BulkVerbPlan, retained?: { commandId?: string; requestedAt?: string; recovery?: UncertainCommandEntry }): void => {
      const inFlightKey = `bulk:${plan.verb}`;
      if (inFlightCommands.current.has(inFlightKey)) return;
      const existingUncertain = uncertainCommands.current.get(inFlightKey);
      if (retained?.recovery !== undefined && retained.recovery !== existingUncertain) return;
      if (existingUncertain !== undefined && retained?.recovery !== existingUncertain) {
        setPendingRecovery(inFlightKey);
        return;
      }
      let requestToExecute: unknown;
      let planToExecute = plan;
      let subjectsToExecute = bulkSubjectsOf(plan);

      if (existingUncertain?.kind === "bulk") {
        requestToExecute = existingUncertain.request;
        planToExecute = existingUncertain.plan;
        subjectsToExecute = existingUncertain.subjects;
      } else {
        const commandId = retained?.commandId ?? crypto.randomUUID();
        const requestedAt = retained?.requestedAt ?? nowIso;

        const composed = composeBulkRunCommand(plan, {
          actorId: boot.actor.id,
          source: "queue",
          commandId,
          requestedAt,
        });
        if (composed.state === "refused") {
          toast({ tone: "danger", title: "Nothing was sent", description: composed.reason });
          return;
        }
        requestToExecute = composed.request;
      }

      inFlightCommands.current.add(inFlightKey);
      client.executeBulkCommand(requestToExecute).then(
        (response) => {
          inFlightCommands.current.delete(inFlightKey);
          uncertainCommands.current.delete(inFlightKey);
          setRecoveryEntries([...uncertainCommands.current.values()]);
          setBulkOutcome({ plan: planToExecute, subjects: subjectsToExecute, response });
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
            title: `${planToExecute.label} — ${String(response.results.length)} of ${String(response.requestedCount)} answered`,
            description: "Each run's own outcome is listed under the selection bar.",
          });
        },
      ).catch((caught: unknown) => {
        inFlightCommands.current.delete(inFlightKey);
        uncertainCommands.current.set(inFlightKey, {
          kind: "bulk",
          label: planToExecute.label,
          targets: planToExecute.eligible,
          inFlightKey,
          request: requestToExecute,
          plan: planToExecute,
          subjects: subjectsToExecute,
        });
        setRecoveryEntries([...uncertainCommands.current.values()]);
        toast(commandFailureToast({ stage: "after-dispatch", caught }));
      });
    },
    [boot.actor.id, client, nowIso, toast],
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
    (action: ActionDescriptorWire, target: ActionTarget, source: "queue" | "run-detail" = "queue"): void => {
      if (action.kind === "navigation") {
        if (action.navigate.kind === "rerun") {
          const row = dayWire?.queueSurfaces.find(entry => String(entry.runId) === target.runId);
          openRerun({ ...RerunValuesRequestSchema.parse({ runId: target.runId, expectedVersion: action.navigate.expectedVersion }),
            ...(row === undefined ? {} : { label: row.title, traceId: String(row.traceId) }) });
        }
        else if (action.navigate.runId !== undefined) selectRun(action.navigate.runId);
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
        const inFlightKey = `${target.runId}:rename`;
        const existingUncertain = uncertainCommands.current.get(inFlightKey);
        if (existingUncertain !== undefined) {
          setPendingRecovery(inFlightKey);
          return;
        }
        const commandId = crypto.randomUUID();
        const requestedAt = nowIso;
        const triggerElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setPendingRename({ action, target, surface, nowIso, source, commandId, requestedAt, triggerElement });
        return;
      }
      if (action.confirm !== undefined) {
        const surface = dayWire?.queueSurfaces.find((row) => String(row.runId) === target.runId);
        const inFlightKey = `${target.runId}:${action.command}`;
        const existingUncertain = uncertainCommands.current.get(inFlightKey);
        if (existingUncertain !== undefined) {
          setPendingRecovery(inFlightKey);
          return;
        }
        const commandId = crypto.randomUUID();
        const requestedAt = nowIso;
        const triggerElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setPendingCommand({
          action,
          target,
          source,
          commandId,
          requestedAt,
          triggerElement,
          // The row's own name and identity, so the operator is shown the thing
          // the blast radius lands ON. A run the day's projection does not hold
          // states that rather than inventing a title for it.
          subject: surface?.title ?? `run ${target.runId}`,
          traceId: surface?.traceId ?? target.runId,
          workflowLabel: workflowLabelOf(String(surface?.workflowId ?? activeWorkflowId)),
        });
        return;
      }
      dispatchCommand(action, target, { source });
    },
    [dayWire, workflowLabelOf, activeWorkflowId, dispatchCommand, selectRun, toast, nowIso, openRerun],
  );

  const runQueueAction = useCallback(
    (action: ActionDescriptorWire, target: ActionTarget): void => {
      runAction(action, target, "queue");
    },
    [runAction],
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

  const selectionOrigin = useRef<string | null>(null);
  const exitQueueSelection = useCallback(() => {
    onSelectMode(false);
    onBulkIds(new Set());
    queueMicrotask(() => {
      const row = selectionOrigin.current === null ? null : document.querySelector<HTMLElement>(`[data-demo-row-id="${CSS.escape(selectionOrigin.current)}"]`);
      (row ?? document.getElementById(RUN_START_DOOR_ID))?.focus({ preventScroll: true });
    });
  }, [onSelectMode, onBulkIds]);
  const runPreviewAction = useCallback((action: QueueMockAction, ids: readonly string[]) => {
    if (ids.length === 0) return;
    selectionOrigin.current = ids[0] ?? null;
    let retriedIds: readonly string[];
    try { retriedIds = previewQueue.apply(action, ids, nowIso); }
    catch (caught) {
      toast({ tone: 'danger', title: 'Mock action unavailable', description: caught instanceof Error ? caught.message : String(caught) });
      return;
    }
    if (action === 'retry') selectionOrigin.current = retriedIds[0] ?? null;
    exitQueueSelection();
    toast({ tone: 'success', title: `${ids.length} mock ${ids.length === 1 ? 'run' : 'runs'} ${action === 'retry' ? 'queued' : action === 'archive' ? 'archived' : 'deleted'}`, description: action === 'retry' ? 'Original mock settings retained. No runtime run was started.' : 'Local preview only. Reload restores the queue.' });
    if (route.run !== undefined && ids.includes(route.run)) setRoute({ ...route, run: action === 'retry' ? retriedIds[0] : undefined });
  }, [previewQueue, nowIso, exitQueueSelection, toast, route, setRoute]);

  const queueHandlers = useMemo(
    (): QueueHandlers => ({
      onSetBatchGrouping: setBatchGrouping,
      onSelect: selectRun,
      onSelectBulk: runId => {
        selectionOrigin.current = runId;
        onSelectMode(true);
        onBulkIds(new Set([...bulkIds, runId]));
      },
      onExitSelection: exitQueueSelection,
      onPreviewAction: runPreviewAction,
      /*
        LIVE. `actionsOf` at the call site reads the row's own served
        `actions[]`, so every control the server describes routes through
        `runAction` → `composeCommandRequest` → the one command client. A row
        served an empty list still draws nothing, with no branch here.
      */
      onAction: runQueueAction,
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
    [setBatchGrouping, selectRun, runQueueAction, openWells, onWells, bulkIds, onBulkIds, dayWire, setActiveWorkflowId, onSelectMode, exitQueueSelection, runPreviewAction],
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
    onCyclePanelMode: () => {},
    panelMode: "sidebar",
    onMinimisePanel: () => {},
    visibleRunIds: keyboardOrder,
    attentionRunIds: keyboardAttention,
    selectedRunId: route.run,
    onSelectRun: selectRun,
    panelTabs: NO_LOG_TABS,
    onTab,
  });

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
  const ready = dayResource.state === "loaded" || dayResource.state === "failed";
  // One resolution of "which takeover owns the main region", so the JSX below
  // cannot disagree with a link that carries more than one key.
  const takeover = activeTakeover(route);

  const closeTakeoverTo = useTakeoverCloseFocus(takeover, setRoute);

  const returnToDashboard = useCallback((): void => {
    leaveSettings(() => setRoute(routeWithoutTakeovers(route)));
  }, [route, setRoute, leaveSettings]);

  /**
   * Settings is a PLACE now (D272 item 1), so its two doors — the gear and the
   * storage band's `Storage checks` — both push a history entry and the
   * browser's own Back returns the operator to the view they left. The empty
   * value is the page's first section; every other takeover key clears for the
   * same reason each Settings destination clears them.
   */
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const openSettings = useCallback((): void => {
    setRoute({
      ...route,
      intake: undefined,
      archive: undefined,
      archiveView: undefined,
      archiveDashboard: undefined,
      archiveWorkflow: undefined,
      activity: undefined,
      explore: undefined,
      catalog: undefined,
      catalogView: undefined,
      settings: "",
    });
  }, [route, setRoute]);

  const renderQueueBody = useCallback((body: ReactNode) => (
    <FocusQueueHeader active={filter} counts={scopedStatusCounts} onFilter={onFilter}
      selecting={selectMode} selectedCount={bulkIds.size}
      allSelected={selectableIds.length > 0 && selectableIds.every(id => bulkIds.has(id))}
      someSelected={selectableIds.some(id => bulkIds.has(id))}
      onSelectAll={checked => onBulkIds(checked ? new Set([...bulkIds, ...selectableIds]) : new Set([...bulkIds].filter(id => !selectableIds.includes(id))))}
      onExit={exitQueueSelection} onAction={action => runPreviewAction(action, [...bulkIds])}>{body}</FocusQueueHeader>
  ), [filter, scopedStatusCounts, onFilter, selectMode, bulkIds, selectableIds, onBulkIds, exitQueueSelection, runPreviewAction]);

  const settingsOpen = ["settings", "archive", "activity", "explore"].includes(takeover);
  const [railPreview, setRailPreview] = useState<string | null>(null);
  const previewFlow = WORKFLOW_RAIL_PREVIEWS.find(flow => flow.id === railPreview);
  const [railRun, setRailRun] = useState<string>();
  const railRow = previewQueue.rows.find(row => row.runId === railRun);
  const onRailSelect = useCallback((id: string) => { setRailPreview(null); selectWorkflow(id); }, [selectWorkflow]);
  const onRailPreview = useCallback((id: string) => { setRailPreview(id); setRailRun(undefined); }, []);


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
      className="dashboard-shell relative flex min-h-0 min-w-0 flex-1 flex-col"
      data-settings-takeover={["settings", "archive", "activity", "explore"].includes(takeover)}
    >
      <div className="dashboard-workspace relative flex min-h-0 min-w-0 flex-1 flex-col">
      <WorkspaceRail workflows={workflows} counts={dayWire?.workflowCounts} active={activeWorkflowId} preview={railPreview}
        onSelect={onRailSelect} onPreview={onRailPreview} onDashboard={returnToDashboard}
        settingsOpen={settingsOpen} onOpenSettings={openSettings} />

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
            closeTakeoverTo={closeTakeoverTo}
            onSettingsExitGuardChange={onSettingsExitGuardChange} theme={theme} onToggleTheme={onToggleTheme}>
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
          <CommandRecovery
            entries={recoveryEntries}
            pendingKey={pendingRecovery}
            onReview={setPendingRecovery}
            onReplay={(entry) => {
              setPendingRecovery(null);
              const retained = uncertainCommands.current.get(entry.inFlightKey);
              if (retained !== entry) return;
              if (retained.kind === "single") dispatchCommand(retained.action, retained.target, { recovery: retained });
              else dispatchBulk(retained.plan, { recovery: retained });
            }}
          />
          <BulkCommandFeedback bulkOutcome={bulkOutcome} onDismissBulkOutcome={() => setBulkOutcome(null)} onSelectRun={selectRun} />


          <CommandResultFeed
            results={commandResults}
            onDismiss={(id) => setCommandResults((previous) => previous.filter((entry) => entry.id !== id))}
            onRefreshRow={(entry) => {
              setCommandResults((previous) => previous.filter((result) => result.id !== entry.id));
              selectRun(entry.targetRunId);
            }}
          />

          <div className="flex min-h-0 flex-1">

            <div className="relative min-h-0 min-w-0 flex-1">
            <div className="dashboard-panel-columns">
              <div className="dashboard-queue-column">
              {previewFlow ? <WorkflowMockQueue label={previewFlow.label} rows={surfaces} selected={railRun} onSelect={setRailRun} /> : dayWire === undefined || workflows.length === 0 || !workflows.some(workflow => workflow.id === activeWorkflowId) ? (
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
                renderBody={renderQueueBody}
                {...(queueFilterScope === undefined ? {} : { filter: queueFilterScope })}
              />}
              </div>
              <div className="dashboard-log-column">
                <section aria-label="Action panel" className="dashboard-action-panel">
          <FocusQueueToolbar
            sort={sort}
            onSort={onSort}
            active={filter}
            counts={scopedStatusCounts}
            onFilter={onFilter}
            leading={null}
            runStart={
              <RunStartButton id={RUN_START_DOOR_ID} onOpen={openStart} />
            }
          />
                <div role="group" aria-label="Log date controls" className="dashboard-log-date"><DatePicker label="Dashboard date" hideLabel triggerLabel="Choose date" required value={day} max={today}
                  onChange={next => { if (next !== "") setRoute({ ...route, day: next, run: undefined }); }} className="w-44" footer={choose => <Button size="sm" variant="ghost" onClick={() => choose(today)}>Today</Button>} /></div>
                </section>
            {previewFlow && railRow ? <LogSample key={`${previewFlow.id}:${railRow.runId}`} selection={{ row: railRow, workflowLabel: previewFlow.label }} /> : !previewFlow && route.run !== undefined && selectedRow !== undefined && dateSelection.state === "valid" ? (
              <LogSample key={route.run} selection={{ row: selectedRow, workflowLabel: workflowLabelOf(selectedRow.workflowId) }} />
            ) : (
              <Panel className="min-h-0"><PanelBody className="grid place-items-center p-[var(--ds-space-page)]"><EmptyState
                icon={<PanelRight aria-hidden className={dsIcon.lg} />}
                title={route.run === undefined ? "No run open" : "Run unavailable"}
                description={route.run === undefined ? "Select a run from the queue to open its logs." : `Run ${route.run} is not in the loaded queue for ${day}. Select a run from this day.`}
              /></PanelBody></Panel>
            )}
              </div>
            </div>

            </div>
          </div>
          </>
          </DashboardTakeovers>
          </div>
        </div>
      </main>
      </div>

      <SessionPanel
        open={sessionsOpen}
        onOpenChange={setSessionsOpen}
      />

      <RunLaunchHost
        controller={launch}
        workflows={startWorkflows}
        panelWorkflowId={activeWorkflowId}
        actorId={boot.actor.id}
        onApplied={(workflowId) => {
          leaveSettings(() => {
            setActiveWorkflowId(workflowId);
            setRoute(routeForStartedRun(routeRef.current));
          });
        }}
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
          dispatchCommand(confirmed.action, confirmed.target, {
            source: confirmed.source,
            commandId: confirmed.commandId,
            requestedAt: confirmed.requestedAt,
          });
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
          dispatchCommand(confirmed.action, confirmed.target, {
            renameAnswer: name,
            source: confirmed.source,
            commandId: confirmed.commandId,
            requestedAt: confirmed.requestedAt,
          });
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
          dispatchBulk(confirmed.plan, {
            commandId: confirmed.commandId,
            requestedAt: confirmed.requestedAt,
          });
        }}
      />
    </div>
    </PreflightActionsProvider>
  );
}
