import { ChatGptAccountContext, createServedChatGptAccountPort } from "../surfaces/settings/general/chatgpt-account-model.js";
import { operatorFailureSentence } from "../../models/failures/error-catalog.js";
import { usePublicProfileSession } from "../surfaces/shell/onboarding-model.js";
import { HubPreferencesPreviewContext } from "../surfaces/settings/general/hub-preferences-model.js";
import { OnboardingSetup } from "../surfaces/shell/onboarding-setup.js";
import { Onboarding } from "../surfaces/shell/onboarding.js";
import { prepareHubWorkflow } from "../surfaces/shell/hub-assistant-model.js";
import type { AssistantPorts } from "../surfaces/shell/assistant-panel-model.js";
import { HubShell } from "../surfaces/shell/hub-shell.js";
import { useHubMotion } from "../ds/theme/motion.js";
import "../ds/theme/hub-theme.css";
import { commandSaveState, settingsSaveProblem } from "../surfaces/settings/editor/settings-attempt-model.js";
import { useInboxWiring } from "../state/inbox-wiring-adapter.js";
import { useSearchWiring } from "../state/search-wiring-adapter.js";
import { useQueueWiring } from "../state/queue-wiring-adapter.js";
import type { RunWiringConfirm } from "../state/run-wiring-adapter.js";
import { useWorkspaceSearchData } from "../surfaces/shell/search/search-wiring-model.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure, resolveErrorCatalogFailure } from "../../models/failures/error-catalog.js";
import { dsLayer } from "../ds/theme/tokens.js";
import { productWorkflowComposition, workflowSource, type WorkflowComposition, type WorkflowSource } from "./workflow-sources.js";
import type { NavbarSearchResult } from "../surfaces/shell/search/navbar-view-model.js";
import { ViewNavigationProvider } from "./navigation/view-navigation.js";
import { useViewState, type RouteSetter } from "./navigation/view-route-model.js";
import { buildWorkflowCatalog, servedLaunchWorkflows } from "../surfaces/workflows/workflow-catalog-model.js";
import { DashboardSkeleton, QueueSkeleton, RunPanelSkeleton } from "../surfaces/shared/loading/loading.js";
import { SettingsSectionSkeleton } from "../surfaces/settings/settings-loading.js";
import { RerunValuesRequestSchema } from "../../models/dashboard/rerun-values.js";
import { routeWithoutTakeovers } from "./navigation/url-state.js";
import { PreflightActionsProvider } from "../surfaces/settings/preflight/preflight-actions.js";
import { resolveDateSelection, routeForStartedRun } from "./navigation/date-state-model.js";
import { RunLaunchHost } from "../surfaces/run-start/run-launch.js";
import { launchWorkflows, useRunLaunch } from "../surfaces/run-start/run-launch-model.js";
import { PanelRight } from "lucide-react";
import { useCallback,useContext,useEffect,useLayoutEffect,useMemo,useRef,useState,type CSSProperties,type ReactNode } from "react";
import { CommandRequestSchema, BulkRunCommandRequestSchema, WorkflowBatchCommandRequestSchema, type BulkRunCommandResponse } from "../../rules/commands/commands.js";
import type { ActionDescriptorWire } from "../../models/dashboard/actions.js";
import {
SettingsSectionPrimitiveSchema,
type FrontendBootstrapWire,
} from "../../models/dashboard/bootstrap.js";
import { Button,DatePicker,EmptyState,Panel,PanelBody,ToastProvider,TooltipProvider,dsIcon,useDemoTheme,useToasts } from "../ds/ui.js";
import { DashboardCommandBindingProvider, useDashboardClient, useDashboardCommandExecutor } from "../state/client-context.js";
import type { CommandOutcome, RetainedCommandRequest, CommandExecutionOptions, CommandExecutionScope } from "./commands/command-executor.js";
import { useServedNow } from "../state/served-clock.js";
import { useBootstrap } from "../state/use-bootstrap.js";
import { useDashboardDay } from "../state/use-dashboard-day.js";
import {
commandResultFeedEntry,
type CommandResultFeedEntry,
} from "../surfaces/shared/actions/actions-model.js";
import {
CommandResultFeed,
ConfirmCommandDialog,
type ActionTarget,
type PendingCommand,
} from "../surfaces/shared/actions/actions.js";
import { CommandRecovery, type CommandRecoveryEntry } from "../surfaces/shared/actions/command-recovery.js";
import { serverLocalDay } from "../surfaces/shell/date-navigation-model.js";
import { fmtClock } from "../surfaces/shared/status/format.js";
import { type PanelTab } from "../surfaces/run-detail/log-panel-model.js";
import { LogSample } from "../surfaces/run-detail/logs/log-sample.js";
import type { QueueBatch, QueueSurfaceWire } from "../surfaces/queue/queue-model.js";
import {
  attentionRunIds,
visibleRunIds,
type QueueSortKey,
} from "../surfaces/queue/queue-model.js";
import {
ConfirmBulkCommandDialog,
BulkCommandFeedback,
type PendingBulkCommand,
} from "../surfaces/queue/queue-toolbar.js";
import { FocusQueueHeader, FocusQueueToolbar } from '../surfaces/queue/queue-focus.js';
import { QueuePanel,type QueueFilterScope } from "../surfaces/queue/queue.js";
import { RenameRunDialog,type PendingRename } from "../surfaces/run-detail/identity/run-identity.js";
import { RunStartButton } from "../surfaces/run-start/run-start.js";
import { SessionPanel } from "../surfaces/sessions/session-panel.js";
import {
DASHBOARD_MAIN_REGION_ID, buildSettingsNav, resolveSettingsSection
} from "../surfaces/settings/settings-model.js";
import {parseWorkflows,useSelectedWorkflow,workflowStatusCounts,type StatusBucket } from "../surfaces/shell/shell-model.js";
import { WorkflowMockLog, WorkflowMockQueue } from "../surfaces/workflows/mocks/workflow-mock-queue.js";
import { MOCK_WORKFLOWS, mockWorkflow, type MockWorkflowId } from "../surfaces/workflows/mocks/workflow-mock-catalog.js";
import { mockQueueCounts, mockWorkflowCounts, mockQueueView, mockRetrySource, mockRunsForDraft, seedMockRuns, type MockDraft, type MockRun } from "../surfaces/workflows/mocks/workflow-mock-model.js";
import { completeMockReviewAction, type MockReviewAction } from "../surfaces/workflows/mocks/workflow-review-action-model.js";
import { mockQueueId } from "../surfaces/workflows/mocks/workflow-queue-model.js";
import { updateMockReview } from "../surfaces/workflows/mocks/workflow-review-model.js";
import "../surfaces/shell/permanent-shell.css";
import { PROPOSED_STATUS, dsStatusOf } from "../surfaces/shared/status/status-model.js";
import { StorageBanner } from "../surfaces/settings/storage/storage-settings.js";
import { WorkspaceRail } from "../surfaces/shell/workspace-rail.js";
import { resolveNotificationNavigation } from "./navigation/notification-navigation.js";
import { notificationDestinationRefusal, useWorkspaceNotifications } from "../surfaces/notifications/notifications-preview-model.js";
import type { NotificationDestination } from "../surfaces/notifications/notifications-view-model.js";
import {
bulkSubjectsOf,
composeBulkRunCommand,
type BulkBatchOutcome,
type BulkVerbPlan,
} from "./commands/bulk-dispatch.js";
import {
composeCommandRequest, verifyShellCommandEffect,
type CommandAction,
} from "./commands/command-dispatch.js";
import { settleCommandResult } from "./commands/command-result.js";
import {
RUN_START_DOOR_ID, currentCommandConfirmation, type DashboardAuthority
} from "./dashboard-app-model.js";
import { DashboardTakeovers } from "./dashboard-takeovers.js";
import { useGlobalKeys } from "./navigation/global-keys.js";
import { useDashboardNavigation } from "./navigation/navigation-model.js";
import type { NativeRouteHistory,PopstateRouteHandler } from "./navigation/route-history-model.js";
import { useRoute } from "./navigation/route-history-model.js";
import { SHELL_PANEL_TABS } from "./navigation/shell-selection-model.js";
import { useTakeoverCloseFocus } from "./navigation/takeover-focus-model.js";
import {
activeTakeover,
routeForCrossDateSearchResult,
type AppRouteState
} from "./navigation/url-state.js";


const NO_LOG_TABS: readonly PanelTab[] = Object.freeze([]);
const NO_QUEUE_ROWS: readonly QueueSurfaceWire[] = Object.freeze([]);







export function DashboardApp({ workflowComposition = productWorkflowComposition, profileSource = "mock" }: { profileSource?: "served" | "mock"; workflowComposition?: (workflows: readonly import("../surfaces/run-start/run-start.js").RunStartWorkflow[]) => WorkflowComposition }) {
  useHubMotion();
  const profileClient = useDashboardClient();
  const publicProfile = usePublicProfileSession(profileClient, profileSource === "served");
  const session = profileSource === "served" ? publicProfile.state : undefined;
  const bootstrap = useBootstrap(session, profileSource === "mock" || session?.state === "active");
  const inheritedAccount = useContext(ChatGptAccountContext);
  const profileId = session?.state === "active" ? session.profileId : undefined;
  const profileEpoch = session?.state === "active" ? session.epoch : undefined;
  const accountScope = useMemo(() => ({ profileClient, profileSource, profileId, profileEpoch }), [profileClient, profileSource, profileId, profileEpoch]);
  const [accountOwner, setAccountOwner] = useState<{ scope: typeof accountScope; port: ReturnType<typeof createServedChatGptAccountPort> }>();
  const account = accountOwner?.scope === accountScope ? accountOwner.port : undefined;
  useEffect(() => {
    if (profileSource !== "served" || profileId === undefined || profileEpoch === undefined) return;
    const port = createServedChatGptAccountPort(profileClient);
    setAccountOwner({ scope: accountScope, port });
    const close = (event: PageTransitionEvent) => { if (!event.persisted) port.dispose(); };
    window.addEventListener("pagehide", close);
    return () => { window.removeEventListener("pagehide", close); port.dispose(); };
  }, [accountScope, profileClient, profileSource, profileId, profileEpoch]);
  const onPopstate = useRef<PopstateRouteHandler | undefined>(undefined);
  const [route, setRoute, nativeHistory] = useRoute(onPopstate);
  const onboardingProfile = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (session?.state === "onboarding") onboardingProfile.current = session.profileId;
    else if (session?.state === "active" && session.duoState === "ready" && onboardingProfile.current === session.profileId) {
      onboardingProfile.current = undefined; setRoute({ start: false });
    } else if (session?.state === "signed-out") onboardingProfile.current = undefined;
  }, [session, setRoute]);
  const { theme, toggleTheme } = useDemoTheme();
  const filter = useMemo(() => (route.view?.queueFilter ?? ["all"]) as readonly StatusBucket[], [route.view?.queueFilter]);
  const setFilter = useCallback((next: readonly StatusBucket[]) => setRoute(current => ({ ...current, view: { ...current.view, queueFilter: [...next] } })), [setRoute]);
  const openWells = useMemo(() => new Set(route.view?.queueOpen ?? []), [route.view?.queueOpen]);
  const setOpenWells = useCallback((next: ReadonlySet<string>) => setRoute(current => ({ ...current, view: { ...current.view, queueOpen: [...next] } })), [setRoute]);
  const tab = SHELL_PANEL_TABS.find(candidate => candidate === route.section);
  const setTab = useCallback((next: PanelTab | undefined) => setRoute({ ...route, section: next }), [route, setRoute]);
  /** the toolbar's ordering control and its select mode — client UI state */
  const sort = route.view?.queueSort ?? "attention";
  const setSort = useCallback((next: QueueSortKey) => setRoute(current => ({ ...current, view: { ...current.view, queueSort: next } })), [setRoute]);
  const [selectMode, setSelectMode] = useState(false);
  const [bulkIds, setBulkIds] = useState<ReadonlySet<string>>(() => new Set());

  const boot = bootstrap.state === "loaded" ? bootstrap.value : undefined;

  // Radix tooltips need their provider ABOVE every surface that draws one.
  // the theme root sits OUTSIDE both providers so the toast viewport inherits its tokens.
  return (
    <div
      data-app-root=""
      data-demo-theme={theme}
      style={{ "--ds-toast-inset-bottom": "calc(var(--ds-h-bar) + var(--ds-space-loose))" } as CSSProperties}
      className="flex h-screen min-h-[var(--ds-h-desktop-min)] min-w-[var(--ds-w-desktop-min)] flex-col overflow-hidden bg-[color:var(--ds-surface-page)] text-[color:var(--ds-fg)]"
    >
    <ChatGptAccountContext.Provider value={account ?? inheritedAccount}>
    <TooltipProvider delayDuration={200}>
    <ToastProvider>
      {route.viewInvalid ? (
        <EmptyState title="Invalid navigation link" description="The view parameters are invalid. Open the dashboard to recover." action={<Button onClick={() => setRoute({ start: false })}>Open dashboard</Button>} />
      ) : route.onboardingSetup !== undefined && profileSource === "served" && session?.state === "onboarding" ? (
        <OnboardingSetup page="fast" port={publicProfile.port} />
      ) : profileSource === "served" && (publicProfile.failure || session !== undefined && (session.state !== "active" || session.duoState !== "ready")) ? (
        <Onboarding step={publicProfile.port.reauthenticationRequired && route.onboarding === "signup" ? "signup" : session?.state === "onboarding" ? session.step : session?.state === "active" ? "duo" : route.onboarding === "signup" ? "signup" : "login"}
          authenticated={session?.state === "active"} port={publicProfile.port} claimExistingData={publicProfile.claimExistingData}
          problem={publicProfile.port.reauthenticationRequired ? "Enter your original profile details to reopen this draft." : publicProfile.failure ? operatorFailureSentence("PROFILE_AUTHORITY_UNAVAILABLE")
            : session?.state === "refused" || session?.state === "error" ? operatorFailureSentence(session.code)
              : session?.state === "cancelling" ? operatorFailureSentence("PROFILE_LOGOUT_BLOCKED") : undefined}
          onStep={onboarding => setRoute({ start: false, onboarding })} onDashboard={() => setRoute({ start: false })} />
      ) : route.onboardingSetup !== undefined && profileSource === "mock" ? (
        <OnboardingSetup page={route.onboardingSetup} />
      ) : route.onboarding !== undefined ? (
        <Onboarding step={route.onboarding} port={profileSource === "served" ? publicProfile.port : undefined} authenticated={session?.state === "active"} onStep={onboarding => setRoute({ start: false, onboarding })} onDashboard={() => setRoute({ start: false })} />
      ) : profileSource === "served" && account === undefined && session?.state === "active" ? (
        <DashboardSkeleton />
      ) : boot === undefined ? (
        <BootGate bootstrap={bootstrap} />
      ) : (
        <ViewNavigationProvider route={route} setRoute={setRoute}><LoadedApp
          boot={boot}
          onProfileLogout={profileSource === "served" ? publicProfile.logout : undefined}
          workflowComposition={workflowComposition}
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
        /></ViewNavigationProvider>
      )}
    </ToastProvider>
    </TooltipProvider>
    </ChatGptAccountContext.Provider>
    </div>
  );
}


/** Boot is the one place a hard failure has nowhere else to go: without the boot
 * document the shell has no vocabulary to render. */
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
      className="flex min-h-0 flex-1 flex-col bg-[color:var(--ds-surface-page)]"
    >
      <DashboardSkeleton settings={new URLSearchParams(window.location.search).has("settings")} settingsContent={
        ["general", "paths", "performance", "providers", "routes", "credentials"].includes(new URLSearchParams(window.location.search).get("settings") ?? "")
          ? <SettingsSectionSkeleton section={new URLSearchParams(window.location.search).get("settings")!} /> : undefined
      } />
    </main>
  );
}


interface LoadedAppProps {
  onProfileLogout?: () => Promise<void>;
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
  tab: PanelTab | undefined;
  /** The operator's EXPLICIT tab choice. `undefined` clears the override and
 * hands the panel back to the run's own default — which is what the history */
  onTab: (tab: PanelTab | undefined) => void;
  sort: QueueSortKey;
  onSort: (sort: QueueSortKey) => void;
  selectMode: boolean;
  onSelectMode: (on: boolean) => void;
  bulkIds: ReadonlySet<string>;
  onBulkIds: (next: ReadonlySet<string>) => void;
}


function LoadedApp({
  onProfileLogout,
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
  onTab,
  sort,
  onSort,
  selectMode,
  onSelectMode,
  bulkIds,
  onBulkIds,
}: LoadedAppProps) {
  /** THE clock. The server's instant is the authority; the browser contributes
 * only the monotonic time since that instant arrived, and every live elapsed */
  const client = useDashboardClient();
  const authorityEpoch = useMemo(() => Object.freeze({ client, bootstrap: boot }), [client, boot]);
  const nowIso = useServedNow(boot.serverClock.now);
  const servedNowRef = useRef(nowIso);
  servedNowRef.current = nowIso;
  const today = serverLocalDay({ ...boot.serverClock, now: nowIso });
  const dateSelection = resolveDateSelection(route.day, today);
  const day = dateSelection.state === "valid" ? dateSelection.day : dateSelection.requested;
  const dateError = dateSelection.state === "valid" ? undefined : dateSelection.reason === "future"
    ? `Date ${day} is after Today (${today}).` : `Invalid date: ${day || "(empty)"}.`;
  const workflows = useMemo(() => parseWorkflows(boot.workflows), [boot.workflows]);
  const workflowComposition = useMemo(() => composeWorkflows(launchWorkflows(workflows)), [composeWorkflows, workflows]);
  const workflowCatalog = useMemo(() => buildWorkflowCatalog(launchWorkflows(workflows), workflowComposition.catalogIncludesMocks ?? true, workflowComposition.sources), [workflows, workflowComposition]);
  const explorerCatalog = useMemo(() => workflowComposition.explorerSources ? buildWorkflowCatalog(launchWorkflows(workflows), workflowComposition.catalogIncludesMocks ?? true, workflowComposition.explorerSources) : workflowCatalog, [workflows, workflowComposition, workflowCatalog]);
  const dataSources = workflowComposition.dataSources ?? workflowComposition.sources;
  const hasServedWorkflows = workflowComposition.servedDay ?? Object.values(dataSources).includes("served");
  const dayState = useDashboardDay((hasServedWorkflows || workflowComposition.sessions !== "mock") && dateSelection.state === "valid" ? day : undefined, nowIso, authorityEpoch, boot.actor.id);
  const dayResource = dayState.day;
  const dayFailureText = useMemo(() => {
    if (dayResource.state !== "failed") return undefined;
    const resolution = resolveErrorCatalogFailure(dayResource.error, "subscription");
    return resolution.state === "resolved" ? resolution.text : resolution.catalogFault.text;
  }, [dayResource]);

  const dayWire = dayResource.state === "loaded" && dayResource.value.day === day ? dayResource.value : undefined;
  const [commandResults, setCommandResults] = useState<readonly CommandResultFeedEntry[]>([]);

  const { selectedWorkflowId: chosenWorkflowId, setSelectedWorkflowId: requestActiveWorkflowId, canSelectWorkflowId } = useSelectedWorkflow(workflows.some(flow => workflowSource(flow.id, workflowComposition.sources) === "served")
    ? workflows.filter(flow => workflowSource(flow.id, workflowComposition.sources) === "served") : workflowCatalog);
  const workflowSurfaces = useMemo(() => dayWire?.queueSurfaces.filter(row => workflowSource(row.workflowId, dataSources) === "served"), [dayWire, dataSources]);
  const queueRows = workflowSurfaces ?? NO_QUEUE_ROWS;
  const selectedRow = dayWire?.queueSurfaces.find(row => row.runId === route.run);
  const logIdentity = useMemo(() => ({ client, authorityEpoch, actorId: boot.actor.id, day, runId: route.run }), [client, authorityEpoch, boot.actor.id, day, route.run]);
  const retainedLogRow = useRef<{ identity: object; row: QueueSurfaceWire } | undefined>(undefined);
  if (selectedRow !== undefined) retainedLogRow.current = { identity: logIdentity, row: selectedRow };
  else if (dayResource.state !== "loading" || retainedLogRow.current?.identity !== logIdentity) retainedLogRow.current = undefined;
  const logRow = selectedRow ?? (dayResource.state === "loading" ? retainedLogRow.current?.row : undefined);
  const activeWorkflowId = selectedRow?.workflowId ?? route.view?.workflow ?? chosenWorkflowId;
  const authority: DashboardAuthority = useMemo(() => Object.freeze({ epoch: authorityEpoch, catalog: workflowCatalog, nowIso, today, day, dayState,
    selection: Object.freeze({ route, workflowId: activeWorkflowId }) }), [authorityEpoch, workflowCatalog, nowIso, today, day, dayState, route, activeWorkflowId]);
  const launch = useRunLaunch(route.start, DASHBOARD_MAIN_REGION_ID, authorityEpoch);
  const [requestedPreview, setRailPreview] = useViewState("preview", null);
  const routeWorkflowId = requestedPreview ?? activeWorkflowId;
  const railPreview = route.run !== undefined && requestedPreview === null ? null : requestedPreview && !workflowCatalog.some(flow => flow.id === requestedPreview) ? requestedPreview
    : routeWorkflowId && workflowComposition.sourceForRoute(routeWorkflowId, requestedPreview !== null) === "mock" ? routeWorkflowId : null;
  const [allMockRuns, setMockRuns] = useState<readonly MockRun[]>(seedMockRuns);
  const mockRuns = useMemo(() => allMockRuns.filter(run => workflowComposition.sourceForRoute(run.workflowId, true) === "mock"), [allMockRuns, workflowComposition]);
  // The route selection clears after the removal commits; a run deleted here is not an unavailable destination.
  const [deletedMockRuns, setDeletedMockRuns] = useState<ReadonlySet<string>>(() => new Set());
  const launchWorkflow = route.view?.launchWorkflow;
  const launchSource = route.view?.launchSource;
  const mockLaunch = useMemo(() => route.start && launchWorkflow && MOCK_WORKFLOWS.some(flow => flow.id === launchWorkflow) && workflowComposition.sourceForRoute(launchWorkflow, true) === "mock" ? { workflowId: mockWorkflow(launchWorkflow).id,
    source: launchSource ? mockRuns.find(run => run.id === launchSource) : undefined } : null, [route.start, launchWorkflow, launchSource, mockRuns, workflowComposition]);
  const setMockLaunch = useCallback((next: { workflowId: MockWorkflowId; source?: MockRun } | null) => setRoute(current => ({ ...current, start: next !== null,
    view: { ...current.view, launchWorkflow: next?.workflowId, launchSource: next?.source?.id, launchStage: next ? next.source ? "Steps" : "Input" : undefined, launchCustomize: next ? false : undefined } })), [setRoute]);
  const rememberLauncher = launch.rememberLauncher;
  const openMockLaunch = useCallback((next: { workflowId: MockWorkflowId; source?: MockRun }) => {
    rememberLauncher(); setMockLaunch(next);
  }, [rememberLauncher, setMockLaunch]);
  const [railRun, setRailRun] = useViewState("mockRun", undefined);
  const [railReviewId, setRailReviewId] = useViewState("records", undefined);
  const [mockNotificationTimes, setMockNotificationTimes] = useState<Readonly<Record<string, string>>>({});
  const servedOpenStart = launch.openStart;
  const openStart = useCallback(() => {
    if (railPreview && mockWorkflow(railPreview).runnable) openMockLaunch({ workflowId: mockWorkflow(railPreview).id });
    else { setRoute(current => ({ ...current, view: { ...current.view, launchServed: activeWorkflowId, launchWorkflow: undefined, launchSource: undefined, launchStage: "Input", launchCustomize: false } })); servedOpenStart(); }
  }, [railPreview, servedOpenStart, openMockLaunch, activeWorkflowId, setRoute]);
  const openRerun = launch.openRerun;

  const [pendingCommand, setPendingCommand] = useState<(PendingCommand & { readonly scope: CommandExecutionScope; readonly onConfirmed?: () => void }) | null>(null);
  /** the run whose name is being edited; `null` while the dialog is shut */
  const [pendingRename, setPendingRename] = useState<(PendingRename & { readonly scope: CommandExecutionScope }) | null>(null);
  /** Keep partial batch results until dismissed so every outcome can be read. */
type UncertainCommandEntry = CommandRecoveryEntry & { readonly request: RetainedCommandRequest };
  const [pendingBulk, setPendingBulk] = useState<(PendingBulkCommand & { readonly scope: CommandExecutionScope }) | null>(null);
  const [bulkOutcome, setBulkOutcome] = useState<BulkBatchOutcome | null>(null);
  const [, refreshCommandRecovery] = useState(0);
  const [pendingRecovery, setPendingRecovery] = useState<string | null>(null);
  const commandLabels = useRef(new Map<string, string>());
  const routeRef = useRef(route);
  routeRef.current = route;
  const bulkIdsRef = useRef(bulkIds);
  bulkIdsRef.current = bulkIds;
  const { toast, dismiss } = useToasts();
  const unknownWarnings = useRef(new Map<string, string>());
  const executor = useDashboardCommandExecutor();
  const commandScope = useMemo(() => Object.freeze({ actorId: boot.actor.id, client, authority: authorityEpoch, dayRequest: dayState.request }), [boot.actor.id, client, authorityEpoch, dayState.request]);
  const currentCommandScope = useRef<CommandExecutionScope | undefined>(commandScope);
  currentCommandScope.current = commandScope;
  const pendingConfirmation = useRef({ command: pendingCommand, rename: pendingRename, bulk: pendingBulk });
  pendingConfirmation.current = { command: pendingCommand, rename: pendingRename, bulk: pendingBulk };
  useLayoutEffect(() => {
    currentCommandScope.current = commandScope;
    return () => { if (currentCommandScope.current === commandScope) currentCommandScope.current = undefined; };
  }, [commandScope]);
  const commandFeedback = useCallback((outcome: CommandOutcome): void => {
    const warningId = unknownWarnings.current.get(outcome.commandId);
    if (outcome.kind === "uncertain" && warningId !== undefined) return;
    if (outcome.kind !== "uncertain" && warningId !== undefined) {
      dismiss(warningId);
      unknownWarnings.current.delete(outcome.commandId);
    }
    if (outcome.kind === "confirmed") return;
    const original = executor.retainedAttempts().find(attempt => attempt.request.commandId === outcome.commandId)?.request;
    const notice = original?.family === "settings" && (original.type === "apply-settings" || original.type === "apply-protected-settings")
      ? settingsSaveProblem(commandSaveState(outcome), original.type === "apply-protected-settings") : undefined;
    const toastId = toast(notice ?? { tone: outcome.kind === "uncertain" || outcome.kind === "conflict" ? "warning" : "danger", title: "Command result", description: outcome.feedback.text });
    if (outcome.kind === "uncertain") unknownWarnings.current.set(outcome.commandId, toastId);
  }, [executor, toast, dismiss]);
  const commandBinding = useMemo(() => Object.freeze({ authority, executor, scope: commandScope, feedback: commandFeedback }), [authority, executor, commandScope, commandFeedback]);
  const recoveryEntries: readonly UncertainCommandEntry[] = executor.retainedAttempts().flatMap<UncertainCommandEntry>(attempt => {
    const request = attempt.request;
    if (attempt.state === "pending" && attempt.scope.client === commandScope.client && attempt.scope.authority === commandScope.authority && attempt.scope.dayRequest === commandScope.dayRequest) return [];
    if (attempt.scope.actorId !== commandScope.actorId || (attempt.state !== "pending" && attempt.outcome?.kind !== "uncertain")) return [];
    if ("targets" in request && request.type === "bump") return [];
    if (!("targets" in request) && request.family !== "run" && request.family !== "gate" && request.family !== "workflow-batch") return [];
    if (!("targets" in request) && request.family === "workflow-batch") return [{ request, inFlightKey: request.commandId, label: "Queue grouping", targets: [], detail: `Batch ${request.target.batchId} · revision ${request.target.expectedVersion} · grouping ${request.payload.groupInQueue ? "on" : "off"}` }];
    const targets = "targets" in request ? request.targets : [request.target];
    return [{ request, inFlightKey: request.commandId, label: commandLabels.current.get(request.commandId) ?? request.type,
      targets: targets.map(target => ({ runId: target.runId, expectedVersion: target.expectedVersion,
        title: dayWire?.queueSurfaces.find(row => row.runId === target.runId)?.title ?? `run ${target.runId}` })) }];
  });
  const unresolvedRunAction = useCallback((runId: string, type: string) => executor.retainedAttempts().find(attempt => (attempt.state === "pending" || attempt.outcome?.kind === "uncertain")
    && attempt.scope.actorId === commandScope.actorId && attempt.request.type === type && !("targets" in attempt.request)
    && (attempt.request.family === "run" || attempt.request.family === "gate") && attempt.request.target.runId === runId), [executor, commandScope.actorId]);

  const setActiveWorkflowId = useCallback((id: string): boolean => {
    if (requestActiveWorkflowId(id)) return true;
    toast({ tone: "danger", title: "Workflow unavailable", description: formatErrorCatalogFailure(createErrorCatalogFailure("DASHBOARD_WORKFLOW_UNAVAILABLE", {})).text });
    return false;
  }, [requestActiveWorkflowId, toast]);

  const workflowLabelOf = useCallback(
    (workflowId: string): string => workflowCatalog.find((w) => w.id === workflowId)?.label ?? workflowId,
    [workflowCatalog],
  );
  const scopedStatusCounts = useMemo(
    () => workflowStatusCounts(dayWire?.workflowCounts ?? [], activeWorkflowId),
    [dayWire, activeWorkflowId],
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

  const selectRun = useCallback(
    (runId: string, partitionDay = day) => {
      leaveSettings(() => setRoute({ ...routeForCrossDateSearchResult(route, {runId, partitionDay}), section: "logs" }));
    },
    [route, setRoute, day, leaveSettings],
  );

  const executeShell = useCallback(async (request: RetainedCommandRequest, label: string, plan?: BulkVerbPlan, replay = false): Promise<void> => {
    if (!commandLabels.current.has(request.commandId)) commandLabels.current.set(request.commandId, label);
    const options: CommandExecutionOptions = {
      scope: commandScope,
      readback: (child, reply) => {
        const originalDayRequest = executor.retainedAttempts().find(attempt => attempt.request.commandId === request.commandId)?.scope.dayRequest;
        if (originalDayRequest === undefined || !("day" in originalDayRequest) || typeof originalDayRequest.day !== "string") return Promise.resolve({ state: "mismatch", evidence: originalDayRequest });
        return verifyShellCommandEffect(client, originalDayRequest.day, child, reply);
      },
      publish: outcome => {
        refreshCommandRecovery(value => value + 1);
        commandFeedback(outcome);
        if ("targets" in request && plan !== undefined && outcome.reply !== undefined && "state" in outcome.reply && outcome.reply.state === "refused") {
          setBulkOutcome({ plan, subjects: bulkSubjectsOf(plan), response: { state: "refused", code: outcome.reply.code, message: outcome.kind === "confirmed" ? "Command confirmed." : outcome.feedback.text } });
        }
        if ("targets" in request && plan !== undefined && outcome.reply !== undefined && "bulkCommandId" in outcome.reply && "results" in outcome.reply) {
          const reply = outcome.reply;
          const response: BulkRunCommandResponse = { ...reply, results: reply.results.map((child, index) => {
            const verified = outcome.children?.[index];
            if (verified?.kind === "confirmed") return { ...child, detail: "Command confirmed." };
            if (child.outcome === "applied") return { outcome: "errored", runId: child.runId, commandId: child.commandId, detail: verified !== undefined ? verified.feedback.text : formatErrorCatalogFailure(createErrorCatalogFailure("COMMAND_OUTCOME_UNCERTAIN", {})).text };
            return { ...child, detail: verified !== undefined ? verified.feedback.text : formatErrorCatalogFailure(createErrorCatalogFailure("COMMAND_REFUSED", {})).text };
          }) };
          setBulkOutcome({ plan, subjects: bulkSubjectsOf(plan), response });
        }
        if (outcome.kind !== "confirmed") {
          if (!("targets" in request) && (request.family === "run" || request.family === "gate") && outcome.reply !== undefined && "state" in outcome.reply && "commandId" in outcome.reply) {
            const folded = settleCommandResult(outcome.reply);
            if (folded.kind === "refused") {
              const surface = dayWire?.queueSurfaces.find(row => row.runId === request.target.runId);
              const entry = commandResultFeedEntry({ settlement: { ...folded, problem: outcome.feedback.text, message: outcome.feedback.text },
                targetRunId: request.target.runId, expectedVersion: request.target.expectedVersion, commandId: request.commandId,
                subject: surface?.title ?? `run ${request.target.runId}`, workflowLabel: workflowLabelOf(surface?.workflowId ?? activeWorkflowId),
                actionLabel: label, clock: fmtClock(nowIso), actorId: request.requestedBy });
              if (entry !== undefined) setCommandResults(previous => [entry, ...previous].slice(0, 4));
            }
          }
          return;
        }
        toast({ tone: "success", title: label, description: "Command confirmed." });
        if (!("targets" in request) && request.family === "run" && request.type === "delete" && outcome.reply !== undefined && "affectedTargets" in outcome.reply) {
          const removed = new Set<string>(outcome.reply.affectedTargets.flatMap(target => target.family === "run" ? [target.runId] : []));
          if (routeRef.current.run !== undefined && removed.has(routeRef.current.run)) setRoute({ ...routeRef.current, run: undefined, section: undefined });
          const next = new Set([...bulkIdsRef.current].filter(id => !removed.has(id)));
          if (next.size !== bulkIdsRef.current.size) onBulkIds(next);
        }
      },
    };
    if (replay) await executor.replay(request.commandId, options);
    else await executor.execute(request, options);
  }, [commandScope, commandFeedback, executor, client, dayWire, workflowLabelOf, activeWorkflowId, nowIso, toast, setRoute, onBulkIds]);

  const dispatchCommand = useCallback((action: CommandAction, target: ActionTarget, answers: {
    renameAnswer?: string; source?: "queue" | "run-detail"; commandId?: string; requestedAt?: string;
  } = {}): void => {
    const retained = executor.retainedAttempts().find(attempt => attempt.scope.actorId === commandScope.actorId && (attempt.state === "pending" || attempt.outcome?.kind === "uncertain")
      && !("targets" in attempt.request) && (attempt.request.family === "run" || attempt.request.family === "gate")
      && attempt.request.target.runId === target.runId && attempt.request.type === action.command);
    if (retained !== undefined) { setPendingRecovery(retained.request.commandId); return; }
    const composed = composeCommandRequest(action, target, { actorId: commandScope.actorId, source: answers.source ?? "queue",
      commandId: answers.commandId ?? crypto.randomUUID(), requestedAt: answers.requestedAt ?? nowIso,
      ...(answers.renameAnswer === undefined ? {} : { renameAnswer: answers.renameAnswer }) });
    if (composed.state === "refused") { toast({ tone: "danger", title: "Command refused", description: formatErrorCatalogFailure(createErrorCatalogFailure("COMMAND_REFUSED", {})).text }); return; }
    const request = CommandRequestSchema.safeParse(composed.request);
    if (!request.success) { toast({ tone: "danger", title: "Command refused", description: formatErrorCatalogFailure(createErrorCatalogFailure("COMMAND_DISPATCH_FAILED", {})).text }); return; }
    void executeShell(request.data, action.label);
  }, [commandScope.actorId, nowIso, executor, executeShell, toast]);

  const dispatchBulk = useCallback((plan: BulkVerbPlan, retained?: { commandId?: string; requestedAt?: string }): void => {
    const composed = composeBulkRunCommand(plan, { actorId: commandScope.actorId, source: "queue", commandId: retained?.commandId ?? crypto.randomUUID(), requestedAt: retained?.requestedAt ?? nowIso });
    if (composed.state === "refused") { toast({ tone: "danger", title: "Command refused", description: formatErrorCatalogFailure(createErrorCatalogFailure("COMMAND_REFUSED", {})).text }); return; }
    const request = BulkRunCommandRequestSchema.safeParse(composed.request);
    if (!request.success) { toast({ tone: "danger", title: "Command refused", description: formatErrorCatalogFailure(createErrorCatalogFailure("COMMAND_DISPATCH_FAILED", {})).text }); return; }
    void executeShell(request.data, plan.label, plan);
  }, [commandScope.actorId, nowIso, executeShell, toast]);

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
      /* Rename collects a value before confirmation and requires the projected run’s identity. */
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
        const existingUncertain = unresolvedRunAction(target.runId, action.command);
        if (existingUncertain !== undefined) {
          setPendingRecovery(existingUncertain.request.commandId);
          return;
        }
        const commandId = crypto.randomUUID();
        const requestedAt = nowIso;
        const triggerElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setPendingRename({ scope: commandScope, action, target, surface, nowIso, source, commandId, requestedAt, triggerElement });
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
        const requestedAt = nowIso;
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
      dispatchCommand(action, target, { source });
    },
    [dayWire, workflowLabelOf, activeWorkflowId, dispatchCommand, selectRun, toast, nowIso, openRerun, unresolvedRunAction, commandScope],
  );

  const confirmLogDecision = useCallback<RunWiringConfirm>((pending, onConfirmed) => setPendingCommand({ ...pending, scope: commandScope, onConfirmed }), [commandScope]);

  const runQueueAction = useCallback(
    (action: ActionDescriptorWire, target: ActionTarget): void => {
      runAction(action, target, "queue");
    },
    [runAction],
  );

  /** Keyboard traversal must follow the same drawn order and attention bands. */
  /** Keep handler identity stable so unchanged callbacks do not defeat queue memoization. */
  const setBatchGrouping = useCallback(async (batch: QueueBatch, groupInQueue: boolean): Promise<void> => {
    const retained = executor.retainedAttempts().find(attempt => attempt.scope.actorId === commandScope.actorId && (attempt.state === "pending" || attempt.outcome?.kind === "uncertain")
      && !("targets" in attempt.request) && attempt.request.family === "workflow-batch" && attempt.request.target.batchId === batch.id);
    if (retained !== undefined) { setPendingRecovery(retained.request.commandId); return; }
    const request = WorkflowBatchCommandRequestSchema.parse({ commandId: crypto.randomUUID(), requestedAt: nowIso,
      requestedBy: boot.actor.id, source: "dashboard", family: "workflow-batch", type: "set-batch-grouping",
      target: { batchId: batch.id, expectedVersion: batch.version }, payload: { groupInQueue } });
    await executeShell(request, "Queue grouping");
  }, [boot.actor.id, nowIso, executeShell, executor, commandScope.actorId]);

  const exitQueueSelection = useCallback(() => {
    onSelectMode(false);
    onBulkIds(new Set());
    queueMicrotask(() => {
      document.getElementById(RUN_START_DOOR_ID)?.focus({ preventScroll: true });
    });
  }, [onSelectMode, onBulkIds]);
  const { surfaces, outcomes, parentOf, viewState, queueHandlers, actionsOf } = useQueueWiring({
    allRows: dayWire?.queueSurfaces, attemptHistory: dayWire?.attemptHistory, rows: queueRows, activeWorkflowId, filter, selectedRunId: route.run,
    openWells, selectMode, bulkIds, nowIso, workflowLabelOf, selectRun, setActiveWorkflowId, onWells, onBulkIds,
    setBatchGrouping, exitQueueSelection, runQueueAction,
  });

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
    // A preview queue is not the served queue; its rows must not move the hidden served selection.
    visibleRunIds: railPreview ? [] : keyboardOrder,
    workflowIds: workflowCatalog.map(workflow => workflow.id), onWorkflow: selectWorkflow,
    attentionRunIds: railPreview ? [] : keyboardAttention,
    selectedRunId: route.run,
    onSelectRun: selectRun,
    panelTabs: NO_LOG_TABS,
    onTab,
  });

  // Parse owner-composed bootstrap projections once; unknown arrays are not permission to cast.
  const settingsSections = useMemo(
    () => SettingsSectionPrimitiveSchema.array().parse(boot.settingsSections),
    [boot.settingsSections],
  );
  // Join capability rows to bootstrap labels; one workflow must have one name.
  const workflowLabels = useMemo(
    () => new Map(workflowCatalog.map((workflow) => [workflow.id, workflow.label])),
    [workflowCatalog],
  );
  const ready = !hasServedWorkflows || dayResource.state === "loaded" || dayResource.state === "failed";
  // One resolution of "which takeover owns the main region", so the JSX below
  // cannot disagree with a link that carries more than one key.
  const takeover = activeTakeover(route);

  const closeTakeoverTo = useTakeoverCloseFocus(takeover, setRoute);

  const returnToDashboard = useCallback((): void => {
    leaveSettings(() => setRoute(routeWithoutTakeovers(route)));
  }, [route, setRoute, leaveSettings]);

  /** Settings navigation creates history so Back returns to the previous view. */
  const [sessionsOpen, setSessionsOpen] = useViewState("sessions", false);
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
      >{body}</FocusQueueHeader>
  ), [filter, scopedStatusCounts, onFilter]);

  const settingsOpen = ["settings", "archive", "activity", "explore"].includes(takeover);
  const settingsResolution = resolveSettingsSection(buildSettingsNav(settingsSections), route.settings ?? "");
  const pageName = takeover === "settings" ? settingsResolution.state === "open" ? settingsResolution.entry.label : "Settings"
    : takeover === "archive" ? "Archive" : takeover === "activity" ? "Analytics" : takeover === "explore" ? "Explorer"
    : takeover === "intake" ? "Edit Data" : route.start ? route.view?.launchSource || route.view?.launchRerun ? "Rerun" : "Run" : railPreview ? MOCK_WORKFLOWS.find(flow => flow.id === railPreview)?.label ?? "Unavailable workflow"
    : workflows.find(workflow => workflow.id === activeWorkflowId)?.label ?? "Dashboard";
  useEffect(() => { document.title = `${pageName} — Relay`; }, [pageName]);
  const previewFlow = railPreview ? MOCK_WORKFLOWS.find(flow => flow.id === railPreview) : undefined;
  const railRows = useMemo(() => mockRuns.filter(run => run.workflowId === railPreview), [mockRuns, railPreview]);
  const previewCounts = useMemo(() => mockWorkflowCounts(mockRuns), [mockRuns]);
  const servedWorkflowCounts = useMemo(() => dayWire?.workflowCounts.filter(count => workflowSource(count.workflowId, dataSources) === "served"), [dayWire, dataSources]);
  const railQueueRows = useMemo(() => mockQueueView(railRows, filter, sort), [railRows, filter, sort]);
  const railRow = railRows.find(run => run.id === railRun) ?? (railRun === undefined ? railRows.find(run => run.id === `mock:${railPreview}:sample`) ?? railRows[0] : undefined);
  const setLaunchOpen = launch.setOpen;
  const closeMockLaunch = useCallback(() => setMockLaunch(null), [setMockLaunch]);
  const completeReview = (id: string, action: MockReviewAction) => {
    const result = completeMockReviewAction(mockRuns, id, action);
    setMockRuns(result.runs);
    setMockNotificationTimes(previous => ({ ...previous, [id]: nowIso }));
    toast({ tone: "success", ...result.notice });
  };
  const submitMock = useCallback((id: MockWorkflowId, draft: MockDraft, sourceId?: string) => {
    const created = mockRunsForDraft(id, draft, mockRuns.length, sourceId);
    setMockRuns(previous => [...created, ...previous]);
    setMockNotificationTimes(previous => ({ ...previous, ...Object.fromEntries(created.map(run => [run.id, servedNowRef.current])) }));
    const review = draft.ocrMode === "manual" ? created.find(run => run.workflowId === "ocr") : undefined;
    setRoute(current => ({ ...current, start: false, view: { ...current.view, preview: review ? "ocr" : id, mockRun: review?.id ?? created[0]?.id, records: review?.id, launchWorkflow: undefined, launchSource: undefined, launchStage: undefined } }));
    setLaunchOpen(false);
    toast({ tone: "success", title: sourceId ? "Rerun created" : "Run started", description: `${created.filter(run => !run.parentId).length} ${mockWorkflow(id).label} ${created.filter(run => !run.parentId).length === 1 ? "run" : "runs"} created.` });
  }, [mockRuns.length, setLaunchOpen, setRoute, toast]);
  const runAssistantWorkflow = useCallback<NonNullable<AssistantPorts["onRunWorkflow"]>>(async request => {
    try {
      const prepared = prepareHubWorkflow(request, workflowComposition, mockRuns.length);
      setMockRuns(previous => [...prepared.runs, ...previous]);
      setMockNotificationTimes(previous => ({ ...previous, ...Object.fromEntries(prepared.runs.map(run => [run.id, servedNowRef.current])) }));
      return prepared.result;
    } catch (error) { return { state: "failed", message: error instanceof Error ? error.message : String(error) }; }
  }, [workflowComposition, mockRuns.length]);
  const onRailSelect = useCallback((id: string) => { if (selectWorkflow(id)) setRailPreview(null); }, [selectWorkflow, setRailPreview]);
  const onRailPreview = useCallback((id: string) => {
    const runs = mockRuns.filter(run => run.workflowId === id);
    setRoute(current => ({ ...current, view: { ...current.view, preview: id, mockRun: (runs.find(run => run.id === `mock:${id}:sample`) ?? runs.find(run => !run.parentId) ?? runs[0])?.id, records: undefined } }));
  }, [mockRuns, setRoute]);
  const previewSearchData = useWorkspaceSearchData({ today, day, unavailable: dateError, rows: queueRows, workflowLabel: workflowLabelOf, mockRuns });
  const servedSearchData = useSearchWiring({ client, enabled: workflowComposition.search === "served" && route.view?.search === true,
    query: route.view?.searchQuery ?? "", today, epoch: authorityEpoch, workflows });
  const searchData = workflowComposition.search === "mock" ? previewSearchData : servedSearchData;
  const openInbox = useCallback(() => setRoute(current => ({ ...current, view: { ...current.view, notifications: true } })), [setRoute]);
  const inbox = useInboxWiring({ client, enabled: workflowComposition.inbox === "served", binding: commandBinding, toast, openInbox });
  const notificationScenario = new URLSearchParams(window.location.search).get("notificationsPreview") ?? "normal";
  const notifications = useWorkspaceNotifications(notificationScenario, {
    day, nowIso, anchorIso: boot.serverClock.now, rows: !hasServedWorkflows || dayWire ? queueRows : undefined, runs: mockRuns,
    workflowLabel: workflowLabelOf, eventTimes: mockNotificationTimes,
    unavailable: dateError ?? (dayResource.state === "failed" ? dayFailureText : undefined),
  });
  const canOpenRegisteredWorkflow = useCallback((id: string) => workflows.some(flow => flow.id === id), [workflows]);
  const notificationContext = useRef({ day, rows: queueRows, runs: mockRuns, canOpenRegisteredWorkflow, canSelectWorkflowId });
  notificationContext.current = { day, rows: queueRows, runs: mockRuns, canOpenRegisteredWorkflow, canSelectWorkflowId };
  const notificationNavigation = useRef(0);
  const openNotification = useCallback((destination: NotificationDestination, opened: () => void, refused: (message: string) => void, source: WorkflowSource) => {
    const request = ++notificationNavigation.current;
    if (source === "mock" && destination.kind === "run") {
      const validate = () => {
        const context = notificationContext.current;
        const refusal = notificationDestinationRefusal(destination, context);
        if (refusal) return refusal;
        const row = context.rows.find(row => row.runId === destination.runId)!;
        return context.canSelectWorkflowId(row.workflowId) ? undefined : formatErrorCatalogFailure(createErrorCatalogFailure("DASHBOARD_WORKFLOW_UNAVAILABLE", {})).text;
      };
      const refusal = validate();
      if (refusal) { refused(refusal); return; }
      leaveSettings(() => {
        const refusal = validate();
        if (refusal) { refused(refusal); return; }
        const row = notificationContext.current.rows.find(row => row.runId === destination.runId)!;
        if (!setActiveWorkflowId(row.workflowId)) return;
        setLaunchOpen(false); exitQueueSelection(); onFilter(["all"]);
        setRoute({ ...routeWithoutTakeovers(routeRef.current), day: destination.day, start: false, run: destination.runId, section: "logs",
          view: { ...routeRef.current.view, queueFilter: ["all"], workflow: row.workflowId, preview: null, mockRun: undefined, records: undefined, logFailure: undefined, notifications: false } });
        opened();
        requestAnimationFrame(() => {
          const row = document.querySelector<HTMLElement>(`.dashboard-queue-column [data-demo-row-id="${CSS.escape(destination.runId)}"]`);
          const pane = row?.closest<HTMLElement>("[data-queue-scroll]");
          if (row && pane) pane.scrollTo({ top: pane.scrollTop + row.getBoundingClientRect().top - pane.getBoundingClientRect().top - 12, behavior: "instant" });
          document.getElementById(DASHBOARD_MAIN_REGION_ID)?.focus({ preventScroll: true });
        });
      });
      return;
    }
    if (destination.kind !== "preview-run") {
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
      const open = (result: Awaited<ReturnType<typeof resolveNotificationNavigation>>) => {
        if (!current()) return;
        if (result.state === "refused") { refused(result.message); return; }
        setLaunchOpen(false);
        exitQueueSelection();
        onFilter(["all"]);
        setRoute({ ...result.route, view: { ...result.route.view, queueFilter: ["all"] } });
        opened();
        requestAnimationFrame(() => document.getElementById(DASHBOARD_MAIN_REGION_ID)?.focus({ preventScroll: true }));
      };
      const resolve = () => resolveNotificationNavigation(client, destination, origin, notificationContext.current.canOpenRegisteredWorkflow);
      void resolve().then(result => {
        if (!current()) return;
        if (result.state === "refused") { refused(result.message); return; }
        leaveSettings(() => {
          if (origin.settings === undefined) open(result);
          else void resolve().then(open);
        });
      });
      return;
    }
    const destinationRefusal = () => notificationDestinationRefusal(destination, notificationContext.current);
    const refusal = destinationRefusal();
    if (refusal) { refused(refusal); return; }
    leaveSettings(() => {
      const refusal = destinationRefusal();
      if (refusal) { refused(refusal); return; }
      const context = notificationContext.current;
      const next = { ...routeWithoutTakeovers(route), start: false, run: undefined, section: undefined };
      setRailReviewId(undefined);
      setMockLaunch(null);
      setLaunchOpen(false);
      exitQueueSelection();
      onFilter(["all"]);
      const run = context.runs.find(item => item.id === destination.runId)!;
      setRailPreview(run.workflowId); setRailRun(run.id);
      if (destination.records) setRailReviewId(run.id);
      setRoute(current => ({ ...next, day: destination.day, view: { ...current.view, preview: run.workflowId, mockRun: run.id, records: destination.records ? run.id : undefined, notifications: false } }));
      opened();
      requestAnimationFrame(() => {
        const queueId = mockQueueId(destination.runId);
        const row = document.querySelector<HTMLElement>(`.dashboard-queue-column [data-demo-row-id="${CSS.escape(queueId)}"]`);
        const pane = row?.closest<HTMLElement>("[data-queue-scroll]");
        if (row && pane) pane.scrollTo({ top: pane.scrollTop + row.getBoundingClientRect().top - pane.getBoundingClientRect().top - 12, behavior: "instant" });
        const target = destination.records
          ? document.querySelector<HTMLElement>("[data-ocr-review-heading]")
          : document.getElementById(DASHBOARD_MAIN_REGION_ID);
        target?.focus({ preventScroll: true });
      });
    });
  }, [client, commandScope, leaveSettings, route, setRoute, setLaunchOpen, exitQueueSelection, onFilter, setActiveWorkflowId, setMockLaunch, setRailPreview, setRailReviewId, setRailRun]);

  const onInboxNotification = useCallback((destination: NotificationDestination, opened: () => void, refused: (message: string) => void) => {
    openNotification(destination, opened, refused, workflowComposition.inbox);
  }, [openNotification, workflowComposition.inbox]);

  const onSearch = useCallback((result: NavbarSearchResult, opened: () => void, refused: (message: string) => void) => {
    if (!result.destination) { refused("This run is unavailable. Refresh search and try again."); return; }
    openNotification(result.destination, opened, refused, workflowComposition.search);
  }, [openNotification, workflowComposition.search]);


  const destinationError = railPreview && !previewFlow ? "This workflow is not registered."
    : route.start && route.view?.launchWorkflow && !mockLaunch ? "This launch workflow is not registered."
    : route.start && route.view?.launchSource && !mockLaunch?.source ? "The source run is no longer available."
    : route.start && route.view?.launchServed && !startWorkflows.some(flow => flow.workflowId === route.view?.launchServed) ? "This launch workflow is not served."
    : railRun && !mockRuns.some(run => run.id === railRun) && !deletedMockRuns.has(railRun) ? "This preview run is no longer available." : undefined;
  if (destinationError) return <EmptyState title="Destination unavailable" description={destinationError} action={<Button onClick={() => setRoute({ start: false })}>Open dashboard</Button>} />;

  return (
    <HubPreferencesPreviewContext.Provider value={workflowComposition.assistant === "mock"}>
    <DashboardCommandBindingProvider binding={commandBinding}>
    <PreflightActionsProvider actions={{ actorId: authority.epoch.bootstrap.actor.id, descriptorFingerprint: authority.epoch.bootstrap.descriptorHash,
      showSettings: section => leaveSettings(() => setRoute({ ...routeWithoutTakeovers(route), settings: section ?? "" })),
      showSessions: () => setSessionsOpen(true),
    }}>
    <div
      data-parity-ready={ready ? "true" : "loading"}
      className="dashboard-shell relative flex min-h-0 min-w-0 flex-1 flex-col"
      data-settings-takeover={["settings", "archive", "activity", "explore"].includes(takeover)}
    >
      <a href={takeover === "settings" ? "#dashboard-settings-content" : `#${DASHBOARD_MAIN_REGION_ID}`} onClick={event => {
        event.preventDefault();
        const target = document.getElementById(takeover === "settings" ? "dashboard-settings-content" : DASHBOARD_MAIN_REGION_ID);
        if (!target) throw new Error("DASHBOARD_SKIP_TARGET_UNAVAILABLE");
        target.focus({ preventScroll: true });
      }} className={`${dsLayer.skipFocus} sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:rounded-lg focus:bg-ui-panel focus:px-4 focus:py-2 focus:text-ui-primary focus:outline-2 focus:outline-ui-info`}>Skip to content</a>
      <div className="dashboard-workspace relative flex min-h-0 min-w-0 flex-1 flex-col">
      <WorkspaceRail workflows={authority.catalog} counts={servedWorkflowCounts} previewCounts={previewCounts} active={activeWorkflowId} preview={railPreview}
        onSelect={onRailSelect} onPreview={onRailPreview} settingsOpen={settingsOpen} notifications={notifications} inbox={workflowComposition.inbox === "served" ? inbox : undefined} onOpenNotification={onInboxNotification} searchData={searchData} onSearch={onSearch} />

      <main
        id={DASHBOARD_MAIN_REGION_ID}
        // This is a programmatic focus target, never a keyboard tab stop.
        tabIndex={-1}
        className="flex min-h-0 min-w-0 flex-1 flex-col"
      >
        {/* Show unreachable authority on every view; backup warnings do not stop work. */}
        {}
        <StorageBanner
          storage={boot.storage}
          onOpenSettings={openSettings}
        />

        <div className="flex min-h-0 flex-1">


          <div className="flex min-h-0 min-w-0 flex-1 flex-col">

          {/* Intake is a durable workspace; leaving it must not discard mapping progress. */}
          <DashboardTakeovers activitySource={workflowComposition.activity} today={today} workflowSources={workflowComposition.sources} takeover={takeover} route={route} setRoute={setRoute} boot={boot}
            client={client} workflowCatalog={explorerCatalog} settingsSections={settingsSections} workflowLabels={workflowLabels} activeWorkflowId={activeWorkflowId}
            workflowLabelOf={workflowLabelOf} supportsDryRun={startWorkflow?.inputRun.state === "present" && startWorkflow.inputRun.surface.supportsDryRun === true}
            closeTakeoverTo={closeTakeoverTo}
            spreadsheetSource={workflowComposition.spreadsheets} onSettingsExitGuardChange={onSettingsExitGuardChange} onSettingsSaved={notice => toast({ tone: "success", ...notice })} theme={theme} onToggleTheme={onToggleTheme}>
          <>
          {}
          <CommandRecovery
            entries={recoveryEntries}
            pendingKey={pendingRecovery}
            onReview={setPendingRecovery}
            onReplay={(entry) => {
              setPendingRecovery(null);
              const retained = recoveryEntries.find(candidate => candidate.inFlightKey === entry.inFlightKey);
              if (retained === undefined) return;
              const request = retained.request;
              const plan: BulkVerbPlan | undefined = "targets" in request && request.type !== "bump" ? { verb: request.type, label: retained.label, eligible: retained.targets, skipped: [], unavailable: [] } : undefined;
              void executeShell(request, retained.label, plan, true);
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
                <h1 className="sr-only">{previewFlow?.label ?? workflowLabelOf(activeWorkflowId)} queue</h1>
              {previewFlow && dateSelection.state === "valid" ? <WorkflowMockQueue label={previewFlow.label} runs={railQueueRows} allRuns={mockRuns} selected={railRun} onSelect={setRailRun}
                onRetry={id => { const source = mockRetrySource(mockRuns, id); openMockLaunch({ workflowId: source.workflowId, source }); }}
                onDelete={ids => { setDeletedMockRuns(previous => new Set([...previous, ...ids])); setMockRuns(previous => previous.filter(run => !ids.includes(run.id))); toast({ tone: "success", title: "Run deleted" }); if (railRun && ids.includes(railRun)) { setRailRun(undefined); setRailReviewId(undefined); } }}
                day={day} nowIso={nowIso} anchorIso={boot.serverClock.now} sort={sort} filter={queueFilterScope} /> : dayWire === undefined || workflows.length === 0 || !workflows.some(workflow => workflow.id === activeWorkflowId) ? (
                dateError === undefined && dayResource.state !== "failed" && dayWire === undefined ? <QueueSkeleton label={workflows.find(workflow => workflow.id === activeWorkflowId)?.label} /> : <Panel className="min-h-0"><PanelBody className="grid place-items-center p-[var(--ds-space-page)]">
                  <EmptyState title={dateError !== undefined ? "Choose a valid date" : dayResource.state === "failed" ? "Could not load queue" : dayWire === undefined ? "Loading queue" : workflows.length === 0 ? "No workflows available" : "Workflow unavailable"}
                    description={dateError ?? (dayResource.state === "failed" ? dayFailureText : dayWire === undefined ? `Waiting for the queue for ${day}.` : workflows.length === 0 ? "This server serves no workflows. Check Settings for availability." : `Workflow ${activeWorkflowId} is not served by this build. Choose an available workflow.`)} />
                </PanelBody></Panel>
              ) : <QueuePanel
                surfaces={surfaces}
                outcomes={outcomes}
                state={viewState}
                handlers={queueHandlers}
                actionsOf={actionsOf}
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
            counts={previewFlow ? mockQueueCounts(railRows) : scopedStatusCounts}
            onFilter={onFilter}
            leading={null}
            runStart={
              <RunStartButton id={RUN_START_DOOR_ID} onOpen={openStart} />
            }
          />
                <div role="group" aria-label="Log date controls" className="dashboard-log-date"><DatePicker label="Dashboard date" hideLabel triggerLabel="Choose date" required value={day} max={today}
                  onChange={next => { if (next !== "") setRoute({ ...route, day: next, run: undefined }); }} className="w-44" footer={choose => <Button size="sm" variant="ghost" onClick={() => choose(today)}>Today</Button>} /></div>
                </section>
            {previewFlow && railRow && dateSelection.state === "valid" ? <WorkflowMockLog key={railRow.id} run={railRow} runs={mockRuns} anchorIso={boot.serverClock.now} nowIso={nowIso} onRerun={() => openMockLaunch({ workflowId: railRow.workflowId, source: railRow })} onApprove={() => completeReview(railRow.id, "approve")}
              reviewOpen={railReviewId === railRow.id} onReviewOpenChange={open => setRailReviewId(open ? railRow.id : undefined)}
              onChange={records => setMockRuns(previous => updateMockReview(previous, railRow.id, records))} onDiscard={() => completeReview(railRow.id, "discard")} onRestore={() => completeReview(railRow.id, "restore")}
              onSelect={id => { const next = mockRuns.find(run => run.id === id); if (!next) throw new Error(`MOCK_LINKED_RUN_MISSING: ${id}`); setRoute(current => ({ ...current, view: { ...current.view, preview: next.workflowId, mockRun: next.id, records: undefined } })); }} /> : !previewFlow && route.run !== undefined && logRow !== undefined && dateSelection.state === "valid" ? (
              <LogSample key={`${route.run}:${route.view?.logFailure?.failureId ?? ""}`} confirm={confirmLogDecision} initialStepId={route.view?.logFailure?.runId === route.run ? route.view.logFailure.failureId : undefined} nowIso={nowIso} source={workflowComposition.logsSources ? workflowSource(logRow.workflowId, workflowComposition.logsSources) : "served"} selection={{ row: logRow, workflowLabel: workflowLabelOf(logRow.workflowId) }} />
            ) : dateError === undefined && dayResource.state !== "failed" && dayWire === undefined && route.run !== undefined ? <RunPanelSkeleton /> : (
              <Panel className="min-h-0"><PanelBody className="grid place-items-center p-[var(--ds-space-page)]"><EmptyState
                icon={<PanelRight aria-hidden className={dsIcon.lg} />}
                title={route.run === undefined ? "No run open" : "Run unavailable"}
                description={route.run === undefined ? "Select a run from the queue to open its logs." : dateError ?? dayFailureText ?? `Run ${route.run} is not in the loaded queue for ${day}. Select a run from this day.`}
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

      <HubShell commands={commandBinding} source={workflowComposition.assistant ?? "served"} authority={authorityEpoch} onRunWorkflow={runAssistantWorkflow} settingsOpen={settingsOpen} onLogout={() => leaveSettings(() => {
        if (onProfileLogout === undefined) setRoute({ start: false, onboarding: "login" });
        else void onProfileLogout();
      })} />
      <SessionPanel
        source={workflowComposition.sessions ?? "served"}
        binding={{ client, executor, scope: commandScope, dayState, day, nowIso }}
        catalog={workflowCatalog}
        open={sessionsOpen}
        onOpenChange={setSessionsOpen}
        settingsOpen={settingsOpen} onSettings={() => settingsOpen ? returnToDashboard() : openSettings()}
      />

      <RunLaunchHost
        controller={launch}
        catalog={workflowCatalog}
        previewLaunch={mockLaunch ?? undefined}
        previewRuns={mockRuns}
        onSubmitPreview={submitMock}
        onPreviewClose={closeMockLaunch}
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

      {/* Destructive commands use their served blast-radius confirmation before dispatch. */}
      <ConfirmCommandDialog
        pending={pendingCommand}
        onCancel={() => setPendingCommand(null)}
        onConfirm={(confirmed) => {
          const current = pendingConfirmation.current.command;
          if (!currentCommandConfirmation(currentCommandScope.current, current, confirmed)) return;
          setPendingCommand(null);
          if (current?.onConfirmed !== undefined) { current.onConfirmed(); return; }
          dispatchCommand(confirmed.action, confirmed.target, {
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
          dispatchCommand(confirmed.action, confirmed.target, {
            renameAnswer: name,
            source: confirmed.source,
            commandId: confirmed.commandId,
            requestedAt: confirmed.requestedAt,
          });
        }}
      />

      {/* Every bulk press confirms the selection and each row’s independent version-bound transition. */}
      <ConfirmBulkCommandDialog
        pending={pendingBulk}
        onCancel={() => setPendingBulk(null)}
        onConfirm={(confirmed) => {
          if (!currentCommandConfirmation(currentCommandScope.current, pendingConfirmation.current.bulk, confirmed)) return;
          setPendingBulk(null);
          dispatchBulk(confirmed.plan, {
            commandId: confirmed.commandId,
            requestedAt: confirmed.requestedAt,
          });
        }}
      />
    </div>
    </PreflightActionsProvider>
    </DashboardCommandBindingProvider>
    </HubPreferencesPreviewContext.Provider>
  );
}
