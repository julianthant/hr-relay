import { DashboardPageBoundary } from "./dashboard-page-boundary.js";
import { runStartRefusalToast, sampleRunRefusalToast } from "./commands/command-result.js";
import { attemptUnresolved, commandAttemptView } from "./commands/command-outcome.js";
import { type PersonPreferencesOwner } from "../state/person-preferences-model.js";
import { useConfirmCloseDuringRun } from "./confirm-close-during-run.js";
import { usePersonPreferences } from "../lib/person-preferences.js";
import type { PaletteAction } from "../surfaces/shell/search/search-palette-model.js";
import { FirstScreenRevealedContext } from "./startup/first-screen.js";
import type { AccountPage } from "../surfaces/settings/account/account-settings.js";
import { HubShell } from "../surfaces/shell/hub-shell.js";
import "../ds/theme/hub-theme.css";
import { useInboxWiring, type InboxWiring } from "../state/inbox-wiring-adapter.js";
import { useLibrarySheets, useSearchWiring } from "../state/search-wiring-adapter.js";
import { useQueueWiring } from "../state/queue-wiring-adapter.js";
import { useApplicationLifecycle } from "../state/application-lifecycle-model.js";
import type { RunWiringConfirm } from "../state/run-wiring-adapter.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure, resolveErrorCatalogFailure } from "../../models/failures/error-catalog.js";
import { dsLayer } from "../ds/theme/tokens.js";
import { workflowSource, type WorkflowComposition } from "./workflow-sources.js";
import type { NavbarSearchResult } from "../surfaces/shell/search/navbar-view-model.js";
import { useViewState, type RouteSetter } from "./navigation/view-route-model.js";
import { buildWorkflowCatalog, servedLaunchWorkflows } from "../surfaces/workflows/workflow-catalog-model.js";
import { PanelBoundary } from "../surfaces/shared/panel-boundary.js";
import { QueueSkeleton, RunPanelSkeleton } from "../surfaces/shared/loading/loading.js";
import { RerunValuesRequestSchema } from "../../models/dashboard/rerun-values.js";
import { routeWithoutTakeovers } from "./navigation/url-state.js";
import { resolveDateSelection, routeForStartedRun } from "./navigation/date-state-model.js";
import { RunLaunchHost } from "../surfaces/run-start/run-launch.js";
import { launchWorkflows, useRunLaunch } from "../surfaces/run-start/run-launch-model.js";
import { PanelRight } from "lucide-react";
import {useCallback,useContext,useEffect,useLayoutEffect,useMemo,useRef,useState,type ReactNode } from "react";
import { CommandRequestSchema, BulkRunCommandRequestSchema, WorkflowBatchCommandRequestSchema, type BulkRunCommandResponse } from "../../rules/commands/commands.js";
import type { ActionDescriptorWire } from "../../models/dashboard/actions.js";
import {
type FrontendBootstrapWire,
} from "../../models/dashboard/bootstrap.js";
import { Button,DelayedSpinner,FailureNotice,Notice,EmptyState,Panel,PanelBody,dsIcon,useDemoTheme,useToasts } from "../ds/ui.js";
import { DashboardCommandBindingProvider, useDashboardClient, useDashboardCommandExecutor } from "../state/client-context.js";
import type { CommandOutcome, RetainedCommandRequest, CommandExecutionOptions, CommandExecutionScope } from "./commands/command-executor.js";
import { createServedClock, ServedClockContext, useClockView } from "../state/served-clock.js";
import { OperatorLabelContext } from "../state/operator-label.js";
import { keptDayFrame, useDashboardDay } from "../state/use-dashboard-day.js";
import {
commandResultDetail,
commandResultFeedEntry,
commandResultTitle,
type CommandResultFeedEntry,
} from "../surfaces/shared/actions/actions-model.js";
import {
CommandResultFeed,
ConfirmCommandDialog,
type ActionTarget,
type PendingCommand,
} from "../surfaces/shared/actions/actions.js";
import { CommandRecovery } from "../surfaces/shared/actions/command-recovery.js";
import { recoveryDetail, recoveryTitle, type CommandRecoveryEntry } from "../surfaces/shared/actions/command-recovery-model.js";
import { serverLocalDay } from "../surfaces/shell/date-navigation-model.js";
import { formatTime } from "../lib/date-format.js";
import { LogSample } from "../surfaces/run-detail/logs/log-sample.js";
import { queueScopeWorkflow, queueKeyboardEntries, queueMemberKey, queueMemberSelection, queueRenameDraft } from "../surfaces/queue/queue-model.js";
import type { QueueBatch, QueueSurfaceWire } from "../surfaces/queue/queue-model.js";
import {
  attentionQueueKeys,
visibleQueueKeys,
type QueueOrder,
type QueueSortKey,
} from "../surfaces/queue/queue-model.js";
import {
BulkCommandFeedback,
PausedRunsStrip,
QuitDialog,
} from "../surfaces/queue/queue-toolbar.js";
import { bulkResultNotice } from "../surfaces/queue/queue-toolbar-model.js";
import { FocusQueueHeader } from '../surfaces/queue/queue-focus.js';
import { QueueHeader } from '../surfaces/queue/queue-header.js';
import { AssistantLauncher } from '../surfaces/shell/assistant-launcher.js';
import type { QueueHandlers } from "../surfaces/queue/queue.js";
import { QueuePanel,type QueueFilterScope } from "../surfaces/queue/queue.js";
import { RenameRunDialog,type PendingRename } from "../surfaces/run-detail/identity/run-identity.js";
import { SessionPanel, SessionsProvider } from "../surfaces/sessions/session-panel.js";
import { SessionRailControls } from "../surfaces/sessions/session-rail-controls.js";
import {
DASHBOARD_MAIN_REGION_ID, DASHBOARD_LOGS_REGION_ID, buildSettingsNav, resolveSettingsSection
} from "../surfaces/settings/settings-model.js";
import {parseWorkflows,useSelectedWorkflow,workflowStatusCounts,type StatusBucket } from "../surfaces/shell/shell-model.js";
import "../surfaces/shell/permanent-shell.css";
import { PROPOSED_STATUS, dsStatusOf } from "../surfaces/shared/status/status-model.js";
import { StorageNotice } from "../surfaces/settings/storage/storage-settings.js";
import { WorkspaceRail } from "../surfaces/shell/workspace-rail.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { BulkRunCommandResponseSchema } from "../../rules/commands/commands.js";
import { RunIdSchema } from "../../rules/identity/ids.js";
import { notificationTargetUnavailable, resolveRunNavigation } from "./navigation/run-navigation.js";
import { withCommandNotices, type NotificationDestination, type NotificationItem } from "../surfaces/notifications/notifications-view-model.js";
import {
bulkSubjectsOf, BULK_VERB_LABEL,
type BulkBatchOutcome,
type BulkVerbPlan,
} from "./commands/bulk-dispatch.js";
import {
composeCommandRequest, verifyShellCommandEffect,
type CommandAction,
} from "./commands/command-dispatch.js";
import { settleCommandResult } from "./commands/command-result.js";
import { appliedWorkerStartupToast, stoppedWorkerToasts, unconfirmedBulkWorkerToast } from "./commands/worker-startup-toast.js";
import { preflightAttentionToast } from "./commands/preflight-attention-toast.js";
import { settingsSaveFailure } from "../surfaces/settings/editor/settings-attempt-model.js";
import {
RUN_START_DOOR_ID, currentCommandConfirmation, type DashboardAuthority
} from "./dashboard-app-model.js";
import { DashboardTakeovers } from "./dashboard-takeovers.js";
import { useGlobalKeys } from "./navigation/global-keys.js";
import { useDashboardNavigation } from "./navigation/navigation-model.js";
import type { NativeRouteHistory,PopstateRouteHandler } from "./navigation/route-history-model.js";
import { useTakeoverCloseFocus } from "./navigation/takeover-focus-model.js";
import { assistantNeeds, useAssistantOpen } from "../surfaces/shell/assistant-launcher-model.js";
import {
activeTakeover,
routeForCrossDateSearchResult,
type AppRouteState
} from "./navigation/url-state.js";


const NO_QUEUE_ROWS: readonly QueueSurfaceWire[] = Object.freeze([]);







const noHarnessSearch = (): undefined => undefined;
const noHarnessInbox = (): undefined => undefined;

interface LoadedAppProps {
  profileTarget?: DashboardAuthority["profileTarget"];
  preferences: PersonPreferencesOwner;
  onProfileLogout?: () => Promise<void>;
  deleteAccount?: ReactNode;
  accountPage?: AccountPage;
  workflowComposition: (workflows: readonly import("../surfaces/run-start/run-start.js").RunStartWorkflow[]) => WorkflowComposition;
  boot: FrontendBootstrapWire;
  route: AppRouteState;
  setRoute: RouteSetter;
  onPopstateRef: { current: PopstateRouteHandler | undefined };
  nativeHistory: NativeRouteHistory;
  theme: ReturnType<typeof useDemoTheme>["theme"];
  onToggleTheme: () => void;
  filter: readonly StatusBucket[];
  onFilter: (bucket: readonly StatusBucket[]) => void;
  openWells: ReadonlySet<string>;
  onWells: (next: ReadonlySet<string>) => void;
  sort: QueueSortKey;
  order: QueueOrder;
  onSort: (sort: QueueSortKey, order: QueueOrder) => void;
}


/** A stored command result opens its run through the same validated served navigation as a run notice. */
/** The queue shows a kept copy of this day while it reloads: a small spinner, after the skeleton wait. */
export function KeptDayMark() {
  return <span data-queue-stale className="inline-flex size-4 items-center justify-center"><DelayedSpinner /></span>;
}

function commandResultRun(destination: NotificationDestination): NotificationDestination | undefined {
  // A storage notice opens Settings > General, where storage lives.
  if (destination.kind === "storage") return { kind: "settings", section: "general" };
  if (destination.kind !== "command-result") return destination;
  const request = destination.request;
  if (!("target" in request) || !("runId" in request.target) || destination.day === undefined) return undefined;
  return { kind: "run", runId: request.target.runId, day: destination.day };
}

export function LoadedApp({
  profileTarget,
  preferences,
  onProfileLogout,
  deleteAccount,
  accountPage,
  workflowComposition: composeWorkflows,
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
  sort,
  order,
  onSort,
}: LoadedAppProps) {
  /** THE clock. The server's instant is the authority; the browser contributes
 * only the monotonic time since that instant arrived, and every live elapsed */
  const client = useDashboardClient();
  const firstScreenRevealed = useContext(FirstScreenRevealedContext);
  const authorityEpoch = useMemo(() => Object.freeze({ client, bootstrap: boot, profileTarget }), [client, boot, profileTarget]);
  const lifecycle = useApplicationLifecycle(client, authorityEpoch);
  const application = lifecycle.resource.state === "loaded" ? lifecycle.resource.value : undefined;
  const [quitRequested, setQuitRequested] = useState(false);
  const clock = useMemo(() => createServedClock(boot.serverClock.now), [boot.serverClock.now]);
  // The app renders on a new day; timed views tick on their own.
  const today = useClockView(clock, boot.serverClock.now, now => serverLocalDay({ ...boot.serverClock, now }));
  const nowIso = clock.now();
  const dateSelection = resolveDateSelection(route.day, today);
  const day = dateSelection.state === "valid" ? dateSelection.day : dateSelection.requested;
  const dateError = dateSelection.state === "valid" ? undefined : dateSelection.reason === "future"
    ? `Date ${day} is after Today (${today}).` : `Invalid date: ${day || "(empty)"}.`;
  const workflows = useMemo(() => parseWorkflows(boot.workflows), [boot.workflows]);
  const launchableWorkflows = useMemo(() => launchWorkflows(workflows), [workflows]);
  const workflowComposition = useMemo(() => composeWorkflows(launchableWorkflows), [composeWorkflows, launchableWorkflows]);
  const workflowCatalog = useMemo(() => buildWorkflowCatalog(launchableWorkflows, workflowComposition.sources, boot.featureAvailability), [launchableWorkflows, workflowComposition, boot.featureAvailability]);
  const dataSources = workflowComposition.dataSources ?? workflowComposition.sources;
  const hasServedWorkflows = workflowComposition.servedDay ?? Object.values(dataSources).includes("served");
  const dayRequested = (hasServedWorkflows || workflowComposition.sessionsHarness === undefined) && dateSelection.state === "valid" ? day : undefined;
  // A run whose Logs the harness preview draws reads no panel; every other selected run rides the day's first connection, so a
  // cold link opens one stream. The preview covers every row with `logsChildRows`, else top-level rows only: there the row is
  // looked up in the day on screen a moment ago, or the kept frame, and an unknown one waits for the day to name it.
  const knownRows = useRef<readonly QueueSurfaceWire[] | undefined>(undefined);
  const logPreview = workflowComposition.harness?.LogPreview === undefined ? "none" : workflowComposition.harness.logsChildRows === true ? "all" : "top-level";
  const priorRows = knownRows.current ?? (dayRequested === undefined ? undefined : keptDayFrame(client, authorityEpoch, boot.actor.id, dayRequested)?.queueSurfaces);
  const panelRow = route.run === undefined || logPreview !== "top-level" ? undefined : priorRows?.find(row => row.runId === route.run);
  const panelRun = logPreview === "none" || panelRow !== undefined && panelRow.parent !== null ? route.run : undefined;
  const dayState = useDashboardDay(dayRequested, authorityEpoch, boot.actor.id, panelRun);
  // A queue date that opens no day stream, such as a future or malformed link, leaves the served inbox a stream of today.
  const inboxDay = dayRequested === undefined && workflowComposition.harness?.useInbox === undefined ? today : undefined;
  const inboxDayState = useDashboardDay(inboxDay, authorityEpoch, boot.actor.id);
  const dayResource = dayState.day;
  const streamDown = dayState.connection.state === "stopped" || dayState.connection.state === "reconnecting";
  const dayFailureText = useMemo(() => {
    if (dayResource.state !== "failed") return undefined;
    const resolution = resolveErrorCatalogFailure(dayResource.error, "subscription");
    return resolution.state === "resolved" ? resolution.text : resolution.catalogFault.text;
  }, [dayResource]);

  const dayWire = dayResource.state === "loaded" && dayResource.value.day === day ? dayResource.value : undefined;
  // The queue, rail counts and labels may show a kept copy of this day while it reloads; every decision reads `dayWire`.
  const keptDay = dayResource.state === "loading" && dayResource.kept?.value.day === day ? dayResource.kept.value : undefined;
  const shownDay = dayWire ?? keptDay;
  knownRows.current = shownDay?.queueSurfaces;
  const [commandResults, setCommandResults] = useState<readonly CommandResultFeedEntry[]>(() => workflowComposition.harness?.commandResults ?? []);

  const { selectedWorkflowId: chosenWorkflowId, setSelectedWorkflowId: requestActiveWorkflowId, canSelectWorkflowId } = useSelectedWorkflow(workflows.some(flow => workflowSource(flow.id, workflowComposition.sources) === "served")
    ? workflows.filter(flow => workflowSource(flow.id, workflowComposition.sources) === "served") : workflowCatalog);
  const workflowSurfaces = useMemo(() => shownDay?.queueSurfaces.filter(row => row.parent !== null || workflowSource(row.workflowId, dataSources) === "served"), [shownDay, dataSources]);
  const shownQueueRows = workflowSurfaces ?? NO_QUEUE_ROWS;
  const queueRows = dayWire === undefined ? NO_QUEUE_ROWS : shownQueueRows;
  const selectedRow = dayWire?.queueSurfaces.find(row => row.runId === route.run);
  // A stream reset names a new day stream, so the row held from before it is never shown again.
  const dayStream = dayState.stream ?? dayState.request;
  const logIdentity = useMemo(() => ({ client, authorityEpoch, actorId: boot.actor.id, day, runId: route.run, dayStream }), [client, authorityEpoch, boot.actor.id, day, route.run, dayStream]);
  const retainedLogRow = useRef<{ identity: object; row: QueueSurfaceWire } | undefined>(undefined);
  if (selectedRow !== undefined) retainedLogRow.current = { identity: logIdentity, row: selectedRow };
  else if (dayResource.state !== "loading" || retainedLogRow.current?.identity !== logIdentity) retainedLogRow.current = undefined;
  // Back to a kept day with its run open shows that run's kept row; its logs stay display-only until the day is fresh.
  const heldLogRow = selectedRow === undefined && dayResource.state === "loading" ? retainedLogRow.current?.row ?? keptDay?.queueSurfaces.find(row => row.runId === route.run) : undefined;
  // A held row carries no command authority: its actions are dropped and Logs gets no action handler until the day is fresh.
  const heldLogView = useMemo(() => heldLogRow === undefined ? undefined : { ...heldLogRow, actions: [] }, [heldLogRow]);
  const logRow = selectedRow ?? heldLogView;
  const activeWorkflowId = (selectedRow === undefined ? undefined : queueScopeWorkflow(selectedRow, dayWire?.queueSurfaces ?? NO_QUEUE_ROWS)) ?? route.view?.workflow ?? chosenWorkflowId;
  const queueWorkflowAvailable = workflows.some(workflow => workflow.id === activeWorkflowId)
    || shownQueueRows.some(row => row.workflowId === activeWorkflowId && row.parent !== null);
  const authority: DashboardAuthority = useMemo(() => Object.freeze({ epoch: authorityEpoch, profileTarget, catalog: workflowCatalog,
    now: clock.now, today, day, dayState,
    selection: Object.freeze({ route, workflowId: activeWorkflowId }) }), [authorityEpoch, profileTarget, workflowCatalog, clock, today, day, dayState, route, activeWorkflowId]);
  const launch = useRunLaunch(route.start, DASHBOARD_MAIN_REGION_ID, authorityEpoch);
  const assistantIsOpen = useAssistantOpen();
  const servedOpenStart = launch.openStart;
  const openStart = useCallback(() => {
    if (launch.rerunInOneClick) return;
    setRoute(current => ({ ...current, view: { ...current.view, launchServed: activeWorkflowId, launchWorkflow: undefined, launchSource: undefined, launchStage: "Input", launchCustomize: false } }));
    servedOpenStart();
  }, [servedOpenStart, launch.rerunInOneClick, activeWorkflowId, setRoute]);
  const openStartFor = useCallback((workflowId: string) => {
    if (launch.rerunInOneClick) return;
    setRoute(current => ({ ...current, view: { ...current.view, launchServed: workflowId, launchWorkflow: undefined, launchSource: undefined, launchStage: "Input", launchCustomize: false } }));
    servedOpenStart();
  }, [servedOpenStart, launch.rerunInOneClick, setRoute]);
  const canStartRun = useCallback((id: string) => workflowCatalog.some(entry => entry.id === id && entry.served !== undefined && entry.launch.state === "served"), [workflowCatalog]);
  const openRerun = launch.openRerun;
  /** A one-click rerun still queuing has no dialog to block the page; opening another launch would drop it. */
  const rerunQueuing = launch.rerunInOneClick;

  const [pendingCommand, setPendingCommand] = useState<(PendingCommand & { readonly scope: CommandExecutionScope; readonly onConfirmed?: () => void }) | null>(null);
  /** the run whose name is being edited; `null` while the dialog is shut */
  const [pendingRename, setPendingRename] = useState<(PendingRename & { readonly scope: CommandExecutionScope }) | null>(null);
  /** Keep partial batch results until dismissed so every outcome can be read. */
type UncertainCommandEntry = CommandRecoveryEntry & { readonly request: RetainedCommandRequest };
  const [bulkReview, setBulkReview] = useState(false);
  const [openedBulk, setOpenedBulk] = useState<BulkBatchOutcome | null>(null);
  const [noticeRead, setNoticeRead] = useState<ReadonlySet<string>>(() => new Set());
  const [noticeCleared, setNoticeCleared] = useState<ReadonlySet<string>>(() => new Set());
  const [bulkOutcome, setBulkOutcome] = useState<BulkBatchOutcome | null>(() => workflowComposition.harness?.bulkOutcome ?? null);
  const [, refreshCommandRecovery] = useState(0);
  const [pendingRecovery, setPendingRecovery] = useState<string | null>(null);
  const commandLabels = useRef(new Map<string, string>());
  const routeRef = useRef(route);
  routeRef.current = route;
  const { toast } = useToasts();
  const executor = useDashboardCommandExecutor();
  const commandScope = useMemo(() => Object.freeze({ actorId: boot.actor.id, client, authority: authorityEpoch, dayRequest: dayState.request }), [boot.actor.id, client, authorityEpoch, dayState.request]);
  const currentCommandScope = useRef<CommandExecutionScope | undefined>(commandScope);
  currentCommandScope.current = commandScope;
  const pendingConfirmation = useRef({ command: pendingCommand, rename: pendingRename });
  pendingConfirmation.current = { command: pendingCommand, rename: pendingRename };
  useLayoutEffect(() => {
    currentCommandScope.current = commandScope;
    return () => { if (currentCommandScope.current === commandScope) currentCommandScope.current = undefined; };
  }, [commandScope]);
  const commandFeedback = useCallback((outcome: CommandOutcome): void => {
    // An unknown outcome is settled by its readback and the served day; the operator sees only the result.
    if (commandAttemptView(outcome).view === "unknown") return;
    if (outcome.kind === "confirmed") {
      const request = executor.retainedAttempts().find(attempt => attempt.request.commandId === outcome.commandId)?.request;
      const warning = request === undefined ? undefined : appliedWorkerStartupToast(request, outcome.reply);
      if (warning !== undefined) toast(warning);
      return;
    }
    const original = executor.retainedAttempts().find(attempt => attempt.request.commandId === outcome.commandId)?.request;
    if (original?.family === "settings" && (original.type === "apply-settings" || original.type === "apply-protected-settings")) return; // the Settings models toast these
    if (outcome.kind === "refused" && outcome.feedback.code === "SAMPLE_RUN_REFUSED") toast(sampleRunRefusalToast());
    else toast(original?.family === "start" && (outcome.kind === "refused" || outcome.kind === "conflict")
      ? runStartRefusalToast(outcome.feedback.text) : { tone: outcome.kind === "conflict" ? "warning" : "danger", title: outcome.feedback.text });
  }, [executor, toast]);
  const commandBinding = useMemo(() => Object.freeze({ authority, executor, scope: commandScope, feedback: commandFeedback }), [authority, executor, commandScope, commandFeedback]);
  const inboxBinding = useMemo(() => inboxDay === undefined ? commandBinding : Object.freeze({ ...commandBinding,
    authority: Object.freeze({ ...authority, day: inboxDay, dayState: inboxDayState }) }),
  [inboxDay, commandBinding, authority, inboxDayState]);
  const currentPreferenceBinding = useRef(commandBinding);
  currentPreferenceBinding.current = commandBinding;
  useEffect(() => {
    const binding = currentPreferenceBinding.current;
    return preferences.connect(client, { ...binding, scope: commandScope, authority: { ...binding.authority, epoch: authorityEpoch } }, () => currentPreferenceBinding.current);
  }, [preferences, client, authorityEpoch, commandScope]);
  useEffect(() => { preferences.streamChanged(); }, [preferences, dayState.rows, dayState.connection.state]);
  const preferenceState = usePersonPreferences();
  useConfirmCloseDuringRun(preferenceState.value.confirmCloseDuringRun, (application?.targets.length ?? 0) > 0);
  useEffect(() => { if (preferenceState.problem) toast({ ...settingsSaveFailure(), title: preferenceState.problem }); }, [preferenceState.problem, toast]);

  const appAttempts = executor.retainedAttempts().filter(attempt => attempt.scope.actorId === commandScope.actorId
    && attempt.scope.authority === commandScope.authority && attempt.scope.client === client
    && (attempt.request.family === "application" || "targets" in attempt.request && attempt.request.type === "resume"));
  const applicationBusy = appAttempts.some(attemptUnresolved);
  const quitting = appAttempts.some(attempt => attempt.request.type === "pause-all-and-quit"
    && (attemptUnresolved(attempt) || attempt.outcome?.kind === "confirmed")) || application?.state === "quitting";
  useEffect(() => {
    const quit = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "q") {
        event.preventDefault();
        if (!quitting && !applicationBusy) setQuitRequested(true);
      }
    };
    window.addEventListener("keydown", quit);
    return () => window.removeEventListener("keydown", quit);
  }, [quitting, applicationBusy]);
  const recoveryEntries: readonly UncertainCommandEntry[] = executor.retainedAttempts().flatMap<UncertainCommandEntry>(attempt => {
    const request = attempt.request;
    if (attempt.state === "pending" && attempt.scope.client === commandScope.client && attempt.scope.authority === commandScope.authority && attempt.scope.dayRequest === commandScope.dayRequest) return [];
    if (attempt.scope.actorId !== commandScope.actorId || !attemptUnresolved(attempt)) return [];
    if ("targets" in request && request.type === "bump") return [];
    if (!("targets" in request) && request.family === "application") return [{ request, inFlightKey: request.commandId,
      label: commandLabels.current.get(request.commandId) ?? request.type,
      targets: request.payload.targets.map(target => ({ ...target, title: dayWire?.queueSurfaces.find(row => row.runId === target.runId)?.title ?? target.runId })) }];
    if (!("targets" in request) && request.family !== "run" && request.family !== "gate" && request.family !== "workflow-batch") return [];
    if (!("targets" in request) && request.family === "workflow-batch") return [{ request, inFlightKey: request.commandId, label: "Queue grouping", targets: [], detail: `Batch ${request.target.batchId} · revision ${request.target.expectedVersion} · grouping ${request.payload.groupInQueue ? "on" : "off"}` }];
    const targets = "targets" in request ? request.targets : [request.target];
    return [{ request, inFlightKey: request.commandId, label: commandLabels.current.get(request.commandId) ?? request.type,
      targets: targets.map(target => ({ runId: target.runId, expectedVersion: target.expectedVersion,
        title: dayWire?.queueSurfaces.find(row => row.runId === target.runId)?.title ?? `run ${target.runId}` })) }];
  });
  const unresolvedRunAction = useCallback((runId: string, type: string) => executor.retainedAttempts().find(attempt => attemptUnresolved(attempt)
    && attempt.scope.actorId === commandScope.actorId && attempt.request.type === type && !("targets" in attempt.request)
    && (attempt.request.family === "run" || attempt.request.family === "gate") && attempt.request.target.runId === runId), [executor, commandScope.actorId]);

  const setActiveWorkflowId = useCallback((id: string): boolean => {
    if (requestActiveWorkflowId(id)) return true;
    if (dayWire?.queueSurfaces.some(row => row.parent !== null && row.workflowId === id
      || row.parent?.workflowId === id
      || row.surfaceKind === "operation" && row.recordMembers?.members.some(member => member.target.workflowId === id))) return true;
    toast({ tone: "danger", title: "Workflow unavailable", description: formatErrorCatalogFailure(createErrorCatalogFailure("DASHBOARD_WORKFLOW_UNAVAILABLE", {})).text });
    return false;
  }, [requestActiveWorkflowId, toast, dayWire]);

  const workflowLabels = useMemo(() => {
    const labels = new Map(workflowCatalog.map(workflow => [workflow.id, workflow.label]));
    for (const row of shownDay?.queueSurfaces ?? []) {
      if (row.parent !== null) labels.set(row.parent.workflowId, row.parent.label);
      for (const link of row.linkedRuns) labels.set(link.workflowId, link.label);
      if (row.surfaceKind === "operation") for (const member of row.recordMembers?.members ?? []) labels.set(member.target.workflowId, member.target.label);
    }
    return labels;
  }, [workflowCatalog, shownDay]);
  const workflowLabelOf = useCallback((workflowId: string): string => workflowLabels.get(workflowId) ?? workflowId, [workflowLabels]);
  const scopedStatusCounts = useMemo(
    () => workflowStatusCounts(shownDay?.workflowCounts ?? [], activeWorkflowId),
    [shownDay, activeWorkflowId],
  );

  /** Use the status vocabulary for filter text so labels and empty states agree. */
  const queueFilterScope = useMemo((): QueueFilterScope | undefined => {
    if (filter.length === 0 || filter.includes("all")) return undefined;
    if (filter.length === 1 && filter[0] === "needsYou") return { kind: "needsYou" };
    return { kind: "status", word: filter.map(value => value === "all" ? "all" : value === "needsYou" ? "needs you" : PROPOSED_STATUS[dsStatusOf(value)].label.toLowerCase()).join(" or ") };
  }, [filter]);

  const startWorkflows = useMemo(() => servedLaunchWorkflows(workflowCatalog), [workflowCatalog]);

  const startWorkflow = useMemo(
    () => startWorkflows.find((entry) => entry.workflowId === activeWorkflowId),
    [startWorkflows, activeWorkflowId],
  );

  const { leaveSettings, onSettingsExitGuardChange } = useDashboardNavigation({
    route, onPopstateRef, nativeHistory,
  });

  const selectWorkflow = useCallback((next: string): boolean => {
    if (next === activeWorkflowId) return true;
    if (!setActiveWorkflowId(next)) return false;
    setRoute(current => ({ ...current, run: undefined, section: undefined, view: { ...current.view, workflow: next } }));
    return true;
  }, [activeWorkflowId, setRoute, setActiveWorkflowId]);

  const selectRun = useCallback((runId: string, partitionDay = day) => {
    leaveSettings(() => setRoute(current => {
      const next = routeForCrossDateSearchResult(current, { runId, partitionDay });
      return { ...next, section: "logs", view: { ...next.view, queueMember: undefined } };
    }));
  }, [setRoute, day, leaveSettings]);
  const relatedNavigation = useRef(0);
  const relatedDay = useRef(dayWire);
  relatedDay.current = dayWire;
  const openRelatedRun = useCallback<NonNullable<QueueHandlers["onOpenLinked"]>>(target => {
    const request = ++relatedNavigation.current, scope = commandScope, origin = routeRef.current;
    const owner = dayWire?.queueSurfaces.find(row => row.parent === target || row.linkedRuns.includes(target));
    if (owner === undefined) return;
    const parent = owner.parent === target;
    const targetKey = canonicalJsonStringify(target);
    const current = () => {
      const row = relatedDay.current?.queueSurfaces.find(row => row.runId === owner.runId);
      return relatedNavigation.current === request && currentCommandScope.current === scope && routeRef.current === origin
        && relatedDay.current?.day === day && row?.workflowId === owner.workflowId && row.traceId === owner.traceId
        && row.attempt === owner.attempt && row.rowRevision === owner.rowRevision
        && (parent ? row.parent !== null && canonicalJsonStringify(row.parent) === targetKey
          : row.linkedRuns.some(link => canonicalJsonStringify(link) === targetKey));
    };
    const refuse = () => ({ state: "refused" as const,message: notificationTargetUnavailable() });
    const resolve = async (): Promise<Awaited<ReturnType<typeof resolveRunNavigation>>> => {
      try {
        const detail = await client.runDetail(owner.runId);
        if (detail.runId !== owner.runId || detail.header.runId !== owner.runId || detail.header.workflowId !== owner.workflowId
          || detail.header.traceId !== owner.traceId || detail.header.attempt !== owner.attempt
          || detail.rowRevision !== owner.rowRevision || detail.panelKind !== owner.panelKind) return refuse();
        return await resolveRunNavigation(client,{ kind: "run",runId: target.runId,day: target.partitionDay },origin,(id,row) => {
          if (id !== target.workflowId || row.panelKind !== target.panelKind || row.parent === null && !canSelectWorkflowId(id)) return false;
          if (!parent) return row.parent?.runId === owner.runId && row.parent.workflowId === owner.workflowId && row.parent.panelKind === owner.panelKind && row.parent.partitionDay === day;
          if (owner.parent?.runId !== row.runId || owner.parent.workflowId !== row.workflowId || owner.parent.partitionDay !== target.partitionDay) return false;
          const reciprocal = row.linkedRuns.find(link => link.runId === owner.runId);
          return reciprocal === undefined || reciprocal.workflowId === owner.workflowId && reciprocal.panelKind === owner.panelKind && reciprocal.partitionDay === day;
        });
      } catch { return refuse(); }
    };
    const open = (result: Awaited<ReturnType<typeof resolveRunNavigation>>) => {
      if (!current()) return;
      if (result.state === "refused") { toast({ tone: "danger",title: "Workflow unavailable",description: result.message });return; }
      if (canSelectWorkflowId(target.workflowId) && !setActiveWorkflowId(target.workflowId)) return;
      setRoute({ ...result.route,view: { ...result.route.view,queueMember: undefined } });
    };
    void resolve().then(result => {
      if (!current()) return;
      if (result.state === "refused") { open(result);return; }
      leaveSettings(() => {
        if (!current()) return;
        if (origin.settings === undefined) open(result);
        else void resolve().then(open);
      });
    });
  },[client,commandScope,day,dayWire,canSelectWorkflowId,setActiveWorkflowId,leaveSettings,setRoute,toast]);
  const openQueueMember = useCallback<NonNullable<QueueHandlers["onOpenMember"]>>(member => {
    const target = member.target;
    const partitionDay = dayWire?.queueSurfaces.some(row => row.runId === target.runId) ? day : target.partitionDay;
    leaveSettings(() => setRoute(current => {
      const next = routeForCrossDateSearchResult(current, { runId: target.runId, partitionDay });
      return { ...next, section: target.section, view: { ...next.view, queueMember: queueMemberSelection(member) } };
    }));
  }, [setRoute, day, dayWire, leaveSettings]);

  const executeShell = useCallback(async (request: RetainedCommandRequest, label: string, plan?: BulkVerbPlan, replay = false): Promise<boolean> => {
    if (!commandLabels.current.has(request.commandId)) commandLabels.current.set(request.commandId, label);
    let confirmed = false;
    const options: CommandExecutionOptions = {
      scope: commandScope,
      readback: (child, reply) => {
        const originalDayRequest = executor.retainedAttempts().find(attempt => attempt.request.commandId === request.commandId)?.scope.dayRequest;
        if (originalDayRequest === undefined || !("day" in originalDayRequest) || typeof originalDayRequest.day !== "string") return Promise.resolve({ state: "mismatch", evidence: originalDayRequest });
        return verifyShellCommandEffect(client, originalDayRequest.day, child, reply);
      },
      publish: outcome => {
        confirmed = outcome.kind === "confirmed";
        refreshCommandRecovery(value => value + 1);
        commandFeedback(outcome);
        if ("targets" in request && outcome.kind === "refused" && outcome.feedback.code === "SAMPLE_RUN_REFUSED") return;
        if ("targets" in request && plan !== undefined && outcome.reply !== undefined && "state" in outcome.reply && outcome.reply.state === "refused") {
          setBulkOutcome({ commandId: request.commandId, plan, subjects: bulkSubjectsOf(plan), response: { state: "refused", code: outcome.reply.code, message: outcome.kind === "confirmed" ? "Command confirmed." : outcome.feedback.text } });
        }
        if ("targets" in request && plan !== undefined && outcome.reply !== undefined && "bulkCommandId" in outcome.reply && "results" in outcome.reply) {
          const reply = outcome.reply;
          const response: BulkRunCommandResponse = { ...reply, results: reply.results.map((child, index) => {
            const verified = outcome.children?.[index];
            if (verified?.kind === "confirmed") return { ...child, detail: "Command confirmed." };
            if (child.outcome === "applied") return { outcome: "errored", runId: child.runId, commandId: child.commandId, detail: verified !== undefined && commandAttemptView(verified).view !== "unknown" ? verified.feedback.text : "Not confirmed yet." };
            // An unknown child keeps its Open control for the run's own recovery; its row never shows the internal sentence.
            return { ...child, detail: verified === undefined ? formatErrorCatalogFailure(createErrorCatalogFailure("COMMAND_REFUSED", {})).text
              : commandAttemptView(verified).view === "unknown" ? "Not confirmed yet." : verified.feedback.text };
          }) };
          setBulkOutcome({ commandId: request.commandId, plan, subjects: bulkSubjectsOf(plan), response });
          const bulkWarning = unconfirmedBulkWorkerToast(request, reply, outcome.kind === "confirmed");
          if (bulkWarning !== undefined) toast(bulkWarning);
        }
        if (outcome.kind !== "confirmed") {
          if (!("targets" in request) && (request.family === "run" || request.family === "gate") && commandAttemptView(outcome).view !== "unknown" && outcome.reply !== undefined && "state" in outcome.reply && "commandId" in outcome.reply) {
            const folded = settleCommandResult(outcome.reply);
            if (folded.kind === "refused") {
              const surface = dayWire?.queueSurfaces.find(row => row.runId === request.target.runId);
              const entry = commandResultFeedEntry({ settlement: { ...folded, problem: outcome.feedback.text },
                targetRunId: request.target.runId, expectedVersion: request.target.expectedVersion, commandId: request.commandId,
                subject: surface?.title ?? `run ${request.target.runId}`, workflowLabel: workflowLabelOf(surface?.workflowId ?? activeWorkflowId),
                actionLabel: label, clock: formatTime(clock.now()), actorId: request.requestedBy });
              if (entry !== undefined) setCommandResults(previous => [entry, ...previous].slice(0, 4));
            }
          }
          return;
        }
        if (!("targets" in request) && request.family === "run" && request.type === "delete" && outcome.reply !== undefined && "affectedTargets" in outcome.reply) {
          const removed = new Set<string>(outcome.reply.affectedTargets.flatMap(target => target.family === "run" ? [target.runId] : []));
          if (routeRef.current.run !== undefined && removed.has(routeRef.current.run)) setRoute({ ...routeRef.current, run: undefined, section: undefined });
        }
      },
    };
    const execution = replay ? executor.replay(request.commandId, options) : executor.execute(request, options);
    refreshCommandRecovery(value => value + 1);
    await execution;
    return confirmed;
  }, [commandScope, commandFeedback, executor, client, dayWire, workflowLabelOf, activeWorkflowId, clock, toast, setRoute]);

  const pausedRuns = application?.targets.filter(target => target.pause?.state === "paused") ?? [];
  const resumeAll = () => {
    if (application === undefined || application.state !== "ready" || applicationBusy || quitting) return;
    const envelope = { commandId: crypto.randomUUID(), requestedAt: clock.now(), requestedBy: boot.actor.id, source: "dashboard" };
    const targets = pausedRuns.map(({ runId, expectedVersion }) => ({ runId, expectedVersion }));
    const plan: BulkVerbPlan = { verb: "resume", label: "Resume", eligible: targets.map(target => ({ ...target,
      title: dayWire?.queueSurfaces.find(row => row.runId === target.runId)?.title ?? target.runId })), skipped: [], unavailable: [] };
    void executeShell(BulkRunCommandRequestSchema.parse({ ...envelope, bulkCommandId: envelope.commandId, family: "run", type: "resume", targets, mode: "best-effort" }), "Resume all runs", plan).then(() => lifecycle.refresh());
  };

  const quitApplication = () => {
    if (application === undefined || application.state !== "ready" || applicationBusy || quitting) return;
    const envelope = { commandId: crypto.randomUUID(), requestedAt: clock.now(), requestedBy: boot.actor.id, source: "dashboard" };
    const targets = application.targets.map(({ runId, expectedVersion }) => ({ runId, expectedVersion }));
    void executeShell(CommandRequestSchema.parse({ ...envelope, family: "application", type: "pause-all-and-quit",
      target: { runtimeGeneration: application.runtimeGeneration }, payload: { targets, confirmed: true } }), "Quit requested").then(lifecycle.refresh);
  };

  const dispatchCommand = useCallback((action: CommandAction, target: ActionTarget, answers: {
    renameAnswer?: string; source?: "queue" | "run-detail"; commandId?: string; requestedAt?: string;
  } = {}): Promise<boolean | void> => {
    const retained = executor.retainedAttempts().find(attempt => attempt.scope.actorId === commandScope.actorId && attemptUnresolved(attempt)
      && !("targets" in attempt.request) && (attempt.request.family === "run" || attempt.request.family === "gate")
      && attempt.request.target.runId === target.runId && attempt.request.type === action.command);
    if (retained !== undefined) { setPendingRecovery(retained.request.commandId); return Promise.resolve(); }
    const composed = composeCommandRequest(action, target, { actorId: commandScope.actorId, source: answers.source ?? "queue",
      commandId: answers.commandId ?? crypto.randomUUID(), requestedAt: answers.requestedAt ?? clock.now(),
      ...(answers.renameAnswer === undefined ? {} : { renameAnswer: answers.renameAnswer }) });
    if (composed.state === "refused") { toast({ tone: "danger", title: "Command refused", description: formatErrorCatalogFailure(createErrorCatalogFailure("COMMAND_REFUSED", {})).text }); return Promise.resolve(); }
    const request = CommandRequestSchema.safeParse(composed.request);
    if (!request.success) { toast({ tone: "danger", title: "Command refused", description: formatErrorCatalogFailure(createErrorCatalogFailure("COMMAND_DISPATCH_FAILED", {})).text }); return Promise.resolve(); }
    return executeShell(request.data, action.label);
  }, [commandScope.actorId, clock, executor, executeShell, toast]);

  const runAction = useCallback(
    (action: ActionDescriptorWire, target: ActionTarget, source: "queue" | "run-detail" = "queue"): Promise<void | boolean> | void => {
      if (action.kind === "navigation") {
        if (action.navigate.kind === "rerun") {
          const row = dayWire?.queueSurfaces.find(entry => String(entry.runId) === target.runId);
          if (rerunQueuing) { toast({ tone: "info", title: "Still queuing the last rerun" }); return; }
          openRerun({ ...RerunValuesRequestSchema.parse({ runId: target.runId, expectedVersion: action.navigate.expectedVersion }),
            ...(row === undefined ? {} : { label: row.title, traceId: String(row.traceId) }) }, undefined, row?.status === "done");
        }
        else if (action.navigate.runId !== undefined) selectRun(action.navigate.runId);
        return;
      }
      /* Rename collects a value before confirmation and requires the projected run’s identity. */
      if (action.command === "rename") {
        const surface = dayWire?.queueSurfaces.find((row) => String(row.runId) === target.runId);
        if (surface === undefined) {
          toast({ tone: "danger", title: "Open the day that run is on to rename it." });
          return;
        }
        const existingUncertain = unresolvedRunAction(target.runId, action.command);
        if (existingUncertain !== undefined) {
          setPendingRecovery(existingUncertain.request.commandId);
          return;
        }
        const commandId = crypto.randomUUID();
        const requestedAt = clock.now();
        const triggerElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setPendingRename({ scope: commandScope, action, target, surface, nowIso: requestedAt, source, commandId, requestedAt, triggerElement });
        return;
      }
      if (action.confirm !== undefined) {
        const surface = dayWire?.queueSurfaces.find((row) => String(row.runId) === target.runId);
        const existingUncertain = unresolvedRunAction(target.runId, action.command);
        if (existingUncertain !== undefined) {
          setPendingRecovery(existingUncertain.request.commandId);
          return;
        }
        const commandId = crypto.randomUUID();
        const requestedAt = clock.now();
        const triggerElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setPendingCommand({
          scope: commandScope,
          action,
          target,
          source,
          commandId,
          requestedAt,
          triggerElement,
          // Use the served row identity; missing rows must not receive invented titles.
          subject: surface?.title ?? `run ${target.runId}`,
          traceId: surface?.traceId ?? target.runId,
          workflowLabel: workflowLabelOf(String(surface?.workflowId ?? activeWorkflowId)),
        });
        return;
      }
      return dispatchCommand(action, target, { source });
    },
    [dayWire, workflowLabelOf, activeWorkflowId, dispatchCommand, selectRun, toast, clock, openRerun, rerunQueuing, unresolvedRunAction, commandScope],
  );

  const confirmLogDecision = useCallback<RunWiringConfirm>((pending, onConfirmed) => setPendingCommand({ ...pending, scope: commandScope, onConfirmed }), [commandScope]);

  const runQueueAction = useCallback(
    (action: ActionDescriptorWire, target: ActionTarget): Promise<void | boolean> | void => runAction(action, target, "queue"),
    [runAction],
  );
  const freshLogRunId = selectedRow?.runId;
  const runLogAction = useCallback((action: ActionDescriptorWire, target: ActionTarget) => {
    if (action.kind === "command" && (freshLogRunId === undefined || String(freshLogRunId) !== target.runId)) return;
    return runAction(action, target, "run-detail");
  }, [runAction, freshLogRunId]);
  const logAction = selectedRow === undefined ? undefined : runLogAction;

  /** Keyboard traversal must follow the same drawn order and attention bands. */
  /** Keep handler identity stable so unchanged callbacks do not defeat queue memoization. */
  const setBatchGrouping = useCallback(async (batch: QueueBatch, groupInQueue: boolean): Promise<void> => {
    const retained = executor.retainedAttempts().find(attempt => attempt.scope.actorId === commandScope.actorId && attemptUnresolved(attempt)
      && !("targets" in attempt.request) && attempt.request.family === "workflow-batch" && attempt.request.target.batchId === batch.id);
    if (retained !== undefined) { setPendingRecovery(retained.request.commandId); return; }
    const request = WorkflowBatchCommandRequestSchema.parse({ commandId: crypto.randomUUID(), requestedAt: clock.now(),
      requestedBy: boot.actor.id, source: "dashboard", family: "workflow-batch", type: "set-batch-grouping",
      target: { batchId: batch.id, expectedVersion: batch.version }, payload: { groupInQueue } });
    await executeShell(request, "Queue grouping");
  }, [boot.actor.id, clock, executeShell, executor, commandScope.actorId]);

  const renameQueueTitle = useCallback((runId: string, name: string) => {
    const surface = dayWire?.queueSurfaces.find((row) => String(row.runId) === runId);
    if (surface === undefined) {
      toast({ tone: "danger", title: "Open the day that run is on to rename it." });
      return;
    }
    const next = queueRenameDraft(surface, name);
    if (next === undefined) return;
    const action = surface.actions.find((entry): entry is CommandAction => entry.kind === "command" && entry.command === "rename");
    if (action === undefined) {
      toast({ tone: "danger", title: "Command refused", description: formatErrorCatalogFailure(createErrorCatalogFailure("COMMAND_REFUSED", {})).text });
      return;
    }
    void dispatchCommand(action, { runId: surface.runId, expectedVersion: action.expectedVersion }, { renameAnswer: next, source: "queue" });
  }, [dayWire, dispatchCommand, toast]);
  const { surfaces, outcomes, viewState, sortNowIso, queueHandlers, actionsOf } = useQueueWiring({
    allRows: shownDay?.queueSurfaces, attemptHistory: shownDay?.attemptHistory, rows: shownQueueRows, activeWorkflowId, kept: dayWire === undefined, filter, selectedRunId: route.run,
    openWells, now: clock.now, sort, selectRun, openRelatedRun, selectedMember: route.view?.queueMember, openMember: openQueueMember, onWells,
    setBatchGrouping, runQueueAction, renameTitle: renameQueueTitle,
  });

  const keyboardEntries = useMemo(() => new Map(queueKeyboardEntries(surfaces, sort, sortNowIso, order).map(entry => [entry.key, entry])), [surfaces, sort, sortNowIso, order]);
  const selectQueueKey = useCallback((key: string) => {
    const entry = keyboardEntries.get(key);
    if (entry === undefined) throw new Error("queue-keyboard-target-unavailable");
    if (entry.kind === "record") openQueueMember(entry.member);
    else selectRun(entry.runId);
  }, [keyboardEntries, openQueueMember, selectRun]);
  const selectedQueueKey = route.view?.queueMember === undefined ? route.run : queueMemberKey(route.view.queueMember);
  const keyboardOrder = useMemo(
    () => visibleQueueKeys(surfaces, sort, sortNowIso, order),
    [surfaces, sort, sortNowIso, order],
  );
  const keyboardAttention = useMemo(
    () => attentionQueueKeys(surfaces, sort, sortNowIso, order),
    [surfaces, sort, sortNowIso, order],
  );
  useGlobalKeys({
    queueVisible: activeTakeover(route) === "none" && dayWire !== undefined,
    onStartRun: openStart,
    // A preview queue is not the served queue; its rows must not move the hidden served selection.
    visibleQueueKeys: keyboardOrder,
    workflowIds: workflowCatalog.map(workflow => workflow.id), onWorkflow: selectWorkflow,
    attentionQueueKeys: keyboardAttention,
    selectedQueueKey,
    onSelectQueueKey: selectQueueKey,
  });

  const ready = !hasServedWorkflows || dayResource.state === "loaded" || dayResource.state === "failed";
  // One resolution of "which takeover owns the main region", so the JSX below
  // cannot disagree with a link that carries more than one key.
  const takeover = activeTakeover(route);

  const closeTakeoverTo = useTakeoverCloseFocus(takeover, setRoute);

  /** Settings navigation creates history so Back returns to the previous view. */
  const [sessionsOpen, setSessionsOpen] = useViewState("sessions", false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const openSettings = useCallback((section = "", settingsTarget?: string): void => {
    setRoute(current => ({
      ...current,
      intake: undefined,
      archive: undefined,
      archiveView: undefined,
      archiveDashboard: undefined,
      archiveWorkflow: undefined,
      activity: undefined,
      explore: undefined,
      catalog: undefined,
      catalogView: undefined,
      settings: section,
      settingsTarget,
    }));
  }, [setRoute]);
  const shownPreflight = useRef(new Set<string>());
  useEffect(() => {
    let active = true;
    void (async () => {
      let wire: Awaited<ReturnType<typeof client.readPreflight>>;
      try { wire = await client.readPreflight(); }
      catch { return; }
      if (!active || wire.state !== "present") return;
      const attention = preflightAttentionToast(wire.report);
      if (attention === undefined) return;
      const key = `${wire.report.configFingerprint}:${wire.report.descriptorFingerprint ?? ""}:${wire.report.checkedAt}`;
      if (shownPreflight.current.has(key)) return;
      shownPreflight.current.add(key);
      toast({ tone: attention.tone, title: attention.title });
    })();
    return () => { active = false; };
  }, [client, toast]);

  const renderQueueBody = useCallback((body: ReactNode) => (
    <FocusQueueHeader>{body}</FocusQueueHeader>
  ), []);

  const settingsOpen = ["settings", "archive", "activity", "explore"].includes(takeover);
  const settingsResolution = resolveSettingsSection(buildSettingsNav(), route.settings ?? "");
  const pageName = takeover === "settings" ? settingsResolution.state === "open" ? settingsResolution.entry.label : "Settings"
    : takeover === "archive" ? "Archive" : takeover === "activity" ? "Analytics" : takeover === "explore" ? "Explorer"
    : takeover === "intake" ? "Edit Data" : route.start ? route.view?.launchSource || route.view?.launchRerun ? "Rerun" : "Run"
    : workflows.find(workflow => workflow.id === activeWorkflowId)?.label ?? "Dashboard";
  useEffect(() => { document.title = `${pageName} — Relay`; }, [pageName]);
  const servedWorkflowCounts = useMemo(() => {
    const childWorkflows = new Set(shownDay?.queueSurfaces.filter(row => row.parent !== null).map(row => row.workflowId));
    return shownDay?.workflowCounts.filter(count => childWorkflows.has(count.workflowId) || workflowSource(count.workflowId, dataSources) === "served");
  }, [shownDay, dataSources]);
  const setLaunchOpen = launch.setOpen;
  const onRailSelect = useCallback((id: string) => { selectWorkflow(id); }, [selectWorkflow]);
  const railAccount = useMemo(() => accountPage === undefined ? undefined : { name: accountPage.values.name, initials: accountPage.values.initials, email: accountPage.values.ucpathUsername }, [accountPage]);
  const onRailSettings = useCallback(() => openSettings(), [openSettings]);
  const onRailLogout = useCallback(() => setLogoutOpen(true), []);
  const railSessionControls = useMemo(() => <SessionRailControls open={sessionsOpen} onOpenChange={setSessionsOpen} />, [sessionsOpen, setSessionsOpen]);
  const harness = workflowComposition.harness;
  const LogPreview = harness?.LogPreview;
  const harnessSearch = (harness?.useSearch ?? noHarnessSearch)({ today, day, unavailable: dateError, rows: queueRows, workflowLabel: workflowLabelOf });
  const searchTitles = useMemo(() => new Map(queueRows.map(row => [String(row.runId), row.title])), [queueRows]);
  const servedSearchData = useSearchWiring({ client, enabled: harnessSearch === undefined && route.view?.search === true,
    query: route.view?.searchQuery ?? "", today, epoch: authorityEpoch, workflows, titles: searchTitles });
  const librarySheets = useLibrarySheets(client, harnessSearch === undefined && route.view?.search === true, authorityEpoch);
  const searchData = useMemo(() => harnessSearch !== undefined ? { ...harnessSearch, sheets: harness?.paletteSheets } : { ...servedSearchData, sheets: librarySheets.sheets, sheetsUnavailable: librarySheets.unavailable }, [harnessSearch, harness, servedSearchData, librarySheets]);
  const harnessInbox = (harness?.useInbox ?? noHarnessInbox)({
    day, nowIso, anchorIso: boot.serverClock.now, rows: !hasServedWorkflows || dayWire ? queueRows : undefined,
    workflowLabel: workflowLabelOf,
    unavailable: dateError ?? (dayResource.state === "failed" ? dayFailureText : undefined),
  });
  const servedInbox = useInboxWiring({ client, enabled: harnessInbox === undefined, binding: inboxBinding });
  const inbox = harnessInbox ?? servedInbox;
  const shownRecovery: readonly CommandRecoveryEntry[] = workflowComposition.harness?.unknownCommand ? [...recoveryEntries, workflowComposition.harness.unknownCommand] : recoveryEntries;
  const commandNotices: readonly NotificationItem[] = [
    // A command whose outcome is unknown still waits on the operator, so it cannot be cleared.
    ...shownRecovery.map((entry): NotificationItem => ({ id: `command:${entry.inFlightKey}`, kind: "command", priority: true, standing: true, title: recoveryTitle(entry), subject: "", workflow: "",
      detail: `${recoveryDetail(entry)}. Review the original request to recover its result.`, tone: "warning", age: "Just now", read: false, action: "Review", destination: { kind: "local-recovery", key: entry.inFlightKey } })),
    ...commandResults.map((entry): NotificationItem => ({ id: `command-result:${entry.id}`, kind: "command", priority: true, title: commandResultTitle(entry), subject: "", workflow: "",
      detail: commandResultDetail(entry), tone: entry.settlement.reason === "conflict" ? "warning" : "danger", age: entry.clock, read: false,
      action: entry.settlement.reason === "conflict" ? "Refresh row" : "Open run", destination: { kind: "local-command-result", id: entry.id } })),
    ...(bulkOutcome === null ? [] : [bulkResultNotice(bulkOutcome)]),
  ].filter(notice => !noticeCleared.has(notice.id));
  // Local command notices are not server rows: their read state lives here, never in the served inbox.
  const localNoticeIds = new Set(commandNotices.map(notice => notice.id));
  const openInbox: InboxWiring["open"] = (item, navigate, opened, refused) => localNoticeIds.has(item.id) ? navigate(item.destination, opened, refused) : inbox.open(item, navigate, opened, refused);
  const railInbox = { ...inbox, open: openInbox, canAct: (id: string) => localNoticeIds.has(id) || inbox.canAct(id), canClear: (id: string) => localNoticeIds.has(id) || inbox.canClear(id),
    state: withCommandNotices(inbox.state, commandNotices.map(notice => noticeRead.has(notice.id) ? { ...notice, read: true } : notice)),
    control: async (id: string, action: Parameters<InboxWiring["control"]>[1]) => {
      if (!localNoticeIds.has(id)) return inbox.control(id, action);
      if (action === "read" || action === "unread") setNoticeRead(previous => { const next = new Set(previous); if (action === "read") next.add(id); else next.delete(id); return next; });
      return true;
    },
    readAll: async () => { setNoticeRead(previous => new Set([...previous, ...localNoticeIds])); await inbox.readAll(); },
    clear: async (id: string) => {
      if (!localNoticeIds.has(id)) return inbox.clear(id);
      if (commandNotices.some(notice => notice.id === id && notice.standing === true)) return false;
      setNoticeCleared(previous => new Set([...previous, id]));
      return true;
    },
    clearAll: async (show: "all" | "unread") => {
      const local = commandNotices.filter(notice => notice.standing !== true && (show === "all" || !(notice.read || noticeRead.has(notice.id)))).map(notice => notice.id);
      setNoticeCleared(previous => new Set([...previous, ...local]));
      return inbox.clearAll(show);
    } };
  const servedNeedsYou = railInbox?.state.state === "ready" ? railInbox.state.items.filter(item => !item.read && item.priority === true).length : 0;
  useEffect(() => { assistantNeeds.report(servedNeedsYou); }, [servedNeedsYou]);
  const canOpenRegisteredWorkflow = useCallback((id: string) => workflows.some(flow => flow.id === id), [workflows]);
  const notificationContext = useRef({ day, rows: queueRows, canOpenRegisteredWorkflow, canSelectWorkflowId });
  notificationContext.current = { day, rows: queueRows, canOpenRegisteredWorkflow, canSelectWorkflowId };
  const notificationNavigation = useRef(0);
  const openNotification = useCallback((requested: NotificationDestination, opened: () => void, refused: (message: string) => void) => {
    const request = ++notificationNavigation.current;
    const destination = commandResultRun(requested);
    if (destination === undefined) { refused(notificationTargetUnavailable()); return; }
    if (destination.kind === "local-recovery") { setPendingRecovery(destination.key); opened(); return; }
    if (destination.kind === "local-bulk-result") { setBulkReview(true); opened(); return; }
    if (destination.kind === "local-command-result") {
      const entry = commandResults.find(result => result.id === destination.id);
      setCommandResults(previous => previous.filter(result => result.id !== destination.id));
      if (entry !== undefined) selectRun(entry.targetRunId);
      opened();
      return;
    }
    if (destination.kind === "bulk-result" && (destination.type === "cancel" || destination.type === "retry" || destination.type === "resume")) {
      const rows = notificationContext.current.rows;
      const title = (runId: string) => rows.find(row => row.runId === runId)?.title ?? "Earlier run";
      const response = BulkRunCommandResponseSchema.safeParse({ state: "vector", bulkCommandId: destination.bulkCommandId, type: destination.type, requestedCount: destination.requestedCount, results: destination.results });
      if (!response.success) { refused(notificationTargetUnavailable()); return; }
      const ids = [...destination.results.map(result => result.runId), ...destination.notAttempted];
      setOpenedBulk({ commandId: destination.bulkCommandId, plan: { verb: destination.type, label: BULK_VERB_LABEL[destination.type], eligible: [], skipped: destination.notAttempted.map(runId => ({ runId, title: title(runId) })), skippedReason: "Not attempted", unavailable: [] },
        days: new Map(Object.entries(destination.days)),
        subjects: new Map(ids.map(runId => [runId, title(runId)])), response: response.data });
      setBulkReview(true); opened();
      return;
    }
    if (destination.kind === "settings") {
      leaveSettings(() => { setRoute({ ...routeWithoutTakeovers(routeRef.current), settings: destination.section, settingsTarget: destination.target }); opened(); });
      return;
    }
    if (destination.kind === "none") return;
    if (destination.kind === "preview-run") { refused("This sample run is not available."); return; }
    const context = notificationContext.current;
    const row = (destination.kind === "run" || destination.kind === "failure") && destination.day === context.day
      ? context.rows.find(item => item.runId === destination.runId) : undefined;
    if (row !== undefined && !context.canOpenRegisteredWorkflow(row.workflowId)) {
      refused(formatErrorCatalogFailure(createErrorCatalogFailure("DASHBOARD_WORKFLOW_UNAVAILABLE", {})).text);
      return;
    }
    const scope = commandScope;
    const origin = routeRef.current;
    const current = () => notificationNavigation.current === request && currentCommandScope.current === scope && routeRef.current === origin;
    const open = (result: Awaited<ReturnType<typeof resolveRunNavigation>>) => {
      if (!current()) return;
      if (result.state === "refused") { refused(result.message); return; }
      setLaunchOpen(false);
      onFilter(["all"]);
      setRoute({ ...result.route, view: { ...result.route.view, queueFilter: ["all"] } });
      opened();
      requestAnimationFrame(() => document.getElementById(DASHBOARD_MAIN_REGION_ID)?.focus({ preventScroll: true }));
    };
    const resolve = () => {
      const context = notificationContext.current;
      return (workflowComposition.harness?.resolveRun ?? ((target, route, scope) => resolveRunNavigation(scope.client, target, route, scope.canOpenRegisteredWorkflow)))(destination, origin, { client, ...context });
    };
    void resolve().then(result => {
      if (!current()) return;
      if (result.state === "refused") { refused(result.message); return; }
      leaveSettings(() => {
        if (origin.settings === undefined) open(result);
        else void resolve().then(open);
      });
    });
    return;
  }, [client, commandScope, leaveSettings, setRoute, setLaunchOpen, onFilter, commandResults, selectRun, workflowComposition]);

  const onInboxNotification = useCallback((destination: NotificationDestination, opened: () => void, refused: (message: string) => void) => {
    openNotification(destination, opened, refused);
  }, [openNotification]);

  const onSearchAction = useCallback((action: PaletteAction) => {
    if (action === "start") openStart();
    else if (action === "settings") openSettings();
    else openSettings(action === "analytics" ? "activity" : action);
  }, [openStart, openSettings]);
  const onSearch = useCallback((result: NavbarSearchResult, opened: () => void, refused: (message: string) => void) => {
    if (!result.destination) { refused("This run is unavailable. Refresh search and try again."); return; }
    openNotification(result.destination, opened, refused);
  }, [openNotification]);


  const destinationError = route.start && route.view?.launchWorkflow ? "This launch workflow is not registered."
    : route.start && route.view?.launchServed && !startWorkflows.some(flow => flow.workflowId === route.view?.launchServed) ? "This launch workflow is not served." : undefined;
  if (destinationError) return <EmptyState title="Destination unavailable" description={destinationError} action={<Button onClick={() => setRoute({ start: false })}>Open dashboard</Button>} />;

  return (
    <ServedClockContext.Provider value={clock}>
    <OperatorLabelContext.Provider value={boot.actor.label}>
    <DashboardCommandBindingProvider binding={commandBinding}>
    <SessionsProvider harness={workflowComposition.sessionsHarness} catalog={workflowCatalog}
      binding={dayRequested === undefined ? undefined : { client, executor, scope: commandScope, dayState, day, now: clock.now, workflowId: activeWorkflowId }}>
    <div
      data-mock-ready={ready ? "true" : "loading"}
      className="dashboard-shell relative flex min-h-0 min-w-0 flex-1 flex-col"
      data-settings-takeover={settingsOpen}
    >
      <a href={takeover === "settings" ? "#dashboard-settings-content" : `#${DASHBOARD_MAIN_REGION_ID}`} onClick={event => {
        event.preventDefault();
        const target = document.getElementById(takeover === "settings" ? "dashboard-settings-content" : DASHBOARD_MAIN_REGION_ID);
        if (!target) throw new Error("DASHBOARD_SKIP_TARGET_UNAVAILABLE");
        target.focus({ preventScroll: true });
      }} className={`${dsLayer.skipFocus} sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:rounded-lg focus:bg-ui-panel focus:px-4 focus:py-2 focus:text-ui-primary focus:outline-2 focus:outline-ui-info`}>Skip to content</a>
      {takeover === "none" && route.run !== undefined && logRow !== undefined && dateSelection.state === "valid" ? <a href={`#${DASHBOARD_LOGS_REGION_ID}`} onClick={event => {
        event.preventDefault();
        const target = document.getElementById(DASHBOARD_LOGS_REGION_ID);
        if (!target) throw new Error("DASHBOARD_SKIP_TARGET_UNAVAILABLE");
        target.focus({ preventScroll: true });
      }} className={`${dsLayer.skipFocus} sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:rounded-lg focus:bg-ui-panel focus:px-4 focus:py-2 focus:text-ui-primary focus:outline-2 focus:outline-ui-info`}>Skip to run logs</a> : null}
      <div className="dashboard-workspace relative flex min-h-0 min-w-0 flex-1 flex-col">
      <WorkspaceRail workflows={authority.catalog} counts={servedWorkflowCounts} active={activeWorkflowId}
        onSelect={onRailSelect} settingsOpen={settingsOpen} inbox={railInbox} onOpenNotification={onInboxNotification} searchData={searchData} onSearch={onSearch} onSearchAction={onSearchAction}
        account={railAccount} onSettings={onRailSettings} onLogout={onRailLogout} sessionControls={railSessionControls}
        onStartRun={openStartFor} canStartRun={canStartRun} />

      <main
        id={DASHBOARD_MAIN_REGION_ID}
        // This is a programmatic focus target, never a keyboard tab stop.
        tabIndex={-1}
        className="flex min-h-0 min-w-0 flex-1 flex-col"
      >
        <DashboardPageBoundary resetKey={JSON.stringify(route)} onRecover={() => setRoute({ start: false }, "replace")}>
        {/* Show unreachable authority on every view; backup warnings do not stop work. */}
        {}
        <StorageNotice
          key={JSON.stringify([activeTakeover(route), route.settings, route.run, route.intake, route.explore])}
          storage={boot.storage}
        />
        {quitting && <Notice sticky tone="info" title="Relay quits after runs pause" />}
        {dayResource.state !== "failed" && (streamDown || lifecycle.resource.state === "failed")
          ? <Notice sticky tone="warning" title="Can't reach Relay" description="Reconnecting…" /> : null}
        {dayResource.state === "loaded" && stoppedWorkerToasts(dayResource.value, id => workflowCatalog.find(entry => entry.id === id)?.label ?? id)
          .map(warning => <Notice key={warning.title} sticky tone={warning.tone} title={warning.title} />)}

        <div className="flex min-h-0 flex-1">


          <div className="flex min-h-0 min-w-0 flex-1 flex-col">

          {/* Intake is a durable workspace; leaving it must not discard mapping progress. */}
          <DashboardTakeovers deleteAccount={deleteAccount} accountPage={accountPage} onOpenRun={selectRun} useActivityReport={workflowComposition.useActivityReport} today={today} workflowSources={workflowComposition.sources} takeover={takeover} route={route} setRoute={setRoute} boot={boot}
            client={client} workflowCatalog={workflowCatalog} activeWorkflowId={activeWorkflowId}
            workflowLabelOf={workflowLabelOf} supportsDryRun={startWorkflow?.inputRun.state === "present" && startWorkflow.inputRun.surface.supportsDryRun === true}
            closeTakeoverTo={closeTakeoverTo}
            onSettingsExitGuardChange={onSettingsExitGuardChange} onSettingsSaved={notice => toast({ tone: "success", ...notice })} onSettingsSaveProblem={problem => toast(problem)} theme={theme} onToggleTheme={onToggleTheme}>
          <>
          {}
          <CommandRecovery
            entries={shownRecovery}
            pendingKey={pendingRecovery}
            onReview={setPendingRecovery}
            onReplay={(entry) => {
              setPendingRecovery(null);
              const retained = recoveryEntries.find(candidate => candidate.inFlightKey === entry.inFlightKey);
              if (retained === undefined) return;
              const request = retained.request;
              const plan: BulkVerbPlan | undefined = "targets" in request && (request.type === "retry" || request.type === "cancel" || request.type === "resume") ? { verb: request.type, label: retained.label, eligible: retained.targets, skipped: [], unavailable: [] } : undefined;
              void executeShell(request, retained.label, plan, true);
            }}
          />
          <BulkCommandFeedback bulkOutcome={openedBulk ?? bulkOutcome} reviewing={bulkReview} onReviewed={() => { setBulkReview(false); if (openedBulk === null) setBulkOutcome(null); setOpenedBulk(null); }} onSelectRun={runId => {
            if (openedBulk === null) { selectRun(runId); return; }
            const runDay = openedBulk.days?.get(runId);
            const refuse = (message: string) => toast({ tone: "danger", key: "run-unavailable", title: "Run unavailable", description: message });
            if (runDay === undefined) { refuse(notificationTargetUnavailable()); return; }
            openNotification({ kind: "run", runId: RunIdSchema.parse(runId), day: runDay }, () => undefined, refuse);
          }} />


          <CommandResultFeed results={commandResults} />

          <div className="flex min-h-0 flex-1">

            <div className="relative min-h-0 min-w-0 flex-1">
            <div className="dashboard-panel-columns">
              <div className="dashboard-queue-column" aria-busy={keptDay === undefined ? undefined : true}>
                <h1 className="sr-only">{workflowLabelOf(activeWorkflowId)} queue</h1>
              <QueueHeader title={workflowLabelOf(activeWorkflowId)} ask={<AssistantLauncher />} startId={RUN_START_DOOR_ID} onStartRun={openStart}
                day={day} today={today} onDay={next => setRoute({ ...route, day: next, run: undefined })} dayMark={keptDay !== undefined ? <KeptDayMark /> : undefined}
                sort={sort} order={order} onSort={onSort} active={filter} counts={scopedStatusCounts} onFilter={onFilter} />
              <PausedRunsStrip count={pausedRuns.length} onResumeAll={application?.state === "ready" && !applicationBusy && !quitting ? resumeAll : undefined} />
              {shownDay === undefined || !queueWorkflowAvailable ? (
                dateError === undefined && dayResource.state !== "failed" && shownDay === undefined && !streamDown ? <QueueSkeleton /> : <Panel className="min-h-0"><PanelBody className="grid place-items-center p-[var(--ds-space-page)]">
                  {dateError === undefined && dayResource.state === "failed" ? <FailureNotice sentence="Couldn't load the queue."
                    action={{ label: "Retry", onClick: dayState.refresh }} /> : <EmptyState title={dateError !== undefined ? "Choose a valid date" : shownDay === undefined ? "Loading queue" : workflows.length === 0 ? "No workflows available" : "Workflow unavailable"}
                    description={dateError ?? (shownDay === undefined ? `Waiting for the queue for ${day}.` : workflows.length === 0 ? "This server serves no workflows. Check Settings for availability." : `Workflow ${activeWorkflowId} is not served by this build. Choose an available workflow.`)} />}
                </PanelBody></Panel>
              ) : <QueuePanel
                surfaces={surfaces}
                outcomes={outcomes}
                state={viewState}
                sortNowIso={sortNowIso}
                handlers={queueHandlers}
                actionsOf={actionsOf}
                workflowLabelOf={workflowLabelOf}
                panelLabel={workflowLabelOf(activeWorkflowId)}
                day={day}
                isToday={day === today}
                onStartRun={openStart}
                sort={sort}
                order={order}
                renderBody={renderQueueBody}
                {...(queueFilterScope === undefined ? {} : { filter: queueFilterScope })}
              />}
              </div>
              <div className="dashboard-log-column">
            <PanelBoundary resetKey={route.run ?? ""} sentence="Couldn't show this run.">
            {route.run !== undefined && logRow !== undefined && dateSelection.state === "valid" ? (
              LogPreview !== undefined && (logRow.parent === null || workflowComposition.harness?.logsChildRows === true)
              ? <LogPreview selection={{ row: logRow, workflowLabel: workflowLabelOf(logRow.workflowId) }} onAction={logAction} />
              : <LogSample key={`${route.run}:${route.view?.logFailure?.failureId ?? ""}`} confirm={confirmLogDecision} onAction={logAction}
                reviewOpen={route.section === "review"} reviewFocus={route.view?.queueMember?.kind === "record" ? route.view.queueMember.record : undefined}
                onOpenLinked={openRelatedRun} onReview={() => setRoute(current => ({ ...current, section: "review" }))} onLogs={() => setRoute(current => ({ ...current, section: "logs" }))}
                initialStepId={route.view?.logFailure?.runId === route.run ? route.view.logFailure.failureId : undefined} selection={{ row: logRow, workflowLabel: workflowLabelOf(logRow.workflowId) }} />
            ) : dateError === undefined && dayResource.state !== "failed" && dayWire === undefined && route.run !== undefined ? <RunPanelSkeleton /> : (
              <Panel className="min-h-0"><PanelBody className="grid place-items-center p-[var(--ds-space-page)]"><EmptyState
                icon={<PanelRight aria-hidden className={dsIcon.lg} />}
                title={route.run === undefined || dayResource.state === "failed" ? "No run open" : "Run unavailable"}
                description={route.run === undefined ? "Select a run from the queue to open its logs." : dateError ?? (dayResource.state === "failed" ? "Select a run once the queue loads." : `Run ${route.run} is not in the loaded queue for ${day}. Select a run from this day.`)}
              /></PanelBody></Panel>
            )}
            </PanelBoundary>
              </div>
            </div>

            </div>
          </div>
          </>
          </DashboardTakeovers>
          {!settingsOpen && <SessionPanel open={sessionsOpen} onOpenChange={setSessionsOpen} />}
          </div>
        </div>
        </DashboardPageBoundary>
      </main>
      </div>

      <PanelBoundary resetKey={`${activeWorkflowId}:${assistantIsOpen}`} sentence="Couldn't open the assistant." className="fixed bottom-2 right-2 z-50">
      <HubShell subjectRef={selectedRow === undefined || selectedRow.parent === null && workflowSource(selectedRow.workflowId, workflowComposition.sources) !== "served" ? undefined : `run_${selectedRow.runId}_${selectedRow.rowRevision}`} commands={commandBinding} authority={authorityEpoch} onOpenSettings={openSettings} settingsOpen={settingsOpen} logoutOpen={logoutOpen} onLogoutOpenChange={setLogoutOpen} onLogout={() => leaveSettings(() => {
        if (onProfileLogout === undefined) setRoute({ start: false, onboarding: "login" });
        else void onProfileLogout();
      })} />
      </PanelBoundary>
      {workflowComposition.harness?.Host && <workflowComposition.harness.Host />}

      <PanelBoundary resetKey={`${activeWorkflowId}:${launch.open}`} sentence="Couldn't open Start run." className="fixed left-1/2 top-4 z-50 -translate-x-1/2">
      <RunLaunchHost
        controller={launch}
        hidden={route.settings !== undefined || !firstScreenRevealed}
        onFixCheck={(section, settingsTarget) => setRoute(current => ({ ...current, settings: section, settingsTarget, settingsFrom: "run" }))}
        catalog={workflowCatalog}
        panelWorkflowId={activeWorkflowId}
        actorId={boot.actor.id}
        onApplied={(workflowId) => {
          leaveSettings(() => {
            if (!setActiveWorkflowId(workflowId)) return;
            setRoute(routeForStartedRun(routeRef.current));
          });
        }}
        /* Follow the picker’s workflow into intake; panel scope must not choose the mapping target. */
        onOpenIntake={(intakeWorkflowId, intakeSessionId) => {
          if (!setActiveWorkflowId(intakeWorkflowId)) return;
          setRoute({ ...route, intake: intakeSessionId });
        }}
      />
      </PanelBoundary>

      <QuitDialog requested={quitRequested} canQuit={application?.state === "ready" && application.pause !== "pause-pending" && !applicationBusy && !quitting} onDismiss={() => setQuitRequested(false)} onQuit={quitApplication} />

      {/* Destructive commands use their served blast-radius confirmation before dispatch. */}
      <ConfirmCommandDialog
        pending={pendingCommand}
        onCancel={() => setPendingCommand(null)}
        onConfirm={(confirmed) => {
          const current = pendingConfirmation.current.command;
          if (!currentCommandConfirmation(currentCommandScope.current, current, confirmed)) return;
          setPendingCommand(null);
          if (current?.onConfirmed !== undefined) { current.onConfirmed(); return; }
          void dispatchCommand(confirmed.action, confirmed.target, {
            source: confirmed.source,
            commandId: confirmed.commandId,
            requestedAt: confirmed.requestedAt,
          });
        }}
      />

      {/* Rename uses the projected row version; stale drafts must not overwrite newer names. */}
      <RenameRunDialog
        pending={pendingRename}
        onCancel={() => setPendingRename(null)}
        onConfirm={(confirmed, name) => {
          if (!currentCommandConfirmation(currentCommandScope.current, pendingConfirmation.current.rename, confirmed)) return;
          setPendingRename(null);
          void dispatchCommand(confirmed.action, confirmed.target, {
            renameAnswer: name,
            source: confirmed.source,
            commandId: confirmed.commandId,
            requestedAt: confirmed.requestedAt,
          });
        }}
      />
    </div>
    </SessionsProvider>
    </DashboardCommandBindingProvider>
    </OperatorLabelContext.Provider>
    </ServedClockContext.Provider>
  );
}
