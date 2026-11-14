import { runStartRefusalToast } from "./commands/command-result.js";
import { createPersonPreferences, type PersonPreferencesOwner } from "../state/person-preferences-model.js";
import { PersonPreferencesContext, usePersonPreferences } from "../lib/person-preferences.js";
import { PROFILE_ONBOARDING_STATE } from "../../models/profiles/public-profile.js";
import { PreflightOcrContext, createServedPreflightOcrPort } from "../surfaces/settings/preflight/preflight-ocr-model.js";
import { PreflightAssistantContext, createServedPreflightAssistantPort, type PreflightAssistantPort } from "../surfaces/settings/preflight/preflight-assistant-model.js";
import { ChatGptAccountContext, createServedChatGptAccountPort } from "../surfaces/settings/general/chatgpt-account-model.js";
import { operatorFailureSentence } from "../../models/failures/error-catalog.js";
import { StartupLoading } from "../surfaces/shell/startup-loading.js";
import { useStartupGate } from "./startup/startup-gate.js";
import { usePublicProfileSession } from "../surfaces/shell/onboarding-model.js";
import type { AccountPage } from "../surfaces/settings/account/account-settings.js";
import { DeleteAccountControl } from "../surfaces/settings/general/ui-settings-records-general-paths.js";
import { HubPreferencesPreviewContext } from "../surfaces/settings/general/hub-preferences-model.js";
import { OnboardingSetup } from "../surfaces/shell/onboarding-setup.js";
import { Onboarding } from "../surfaces/shell/onboarding.js";
import { prepareHubWorkflow } from "../surfaces/shell/hub-assistant-model.js";
import type { AssistantPorts } from "../surfaces/shell/assistant-panel-model.js";
import { HubShell } from "../surfaces/shell/hub-shell.js";
import { useHubMotion } from "../ds/theme/motion.js";
import "../ds/theme/hub-theme.css";
import { useInboxWiring, type InboxWiring } from "../state/inbox-wiring-adapter.js";
import { useLibrarySheets, useSearchWiring } from "../state/search-wiring-adapter.js";
import { useQueueWiring } from "../state/queue-wiring-adapter.js";
import { useApplicationLifecycle } from "../state/application-lifecycle-model.js";
import type { RunWiringConfirm } from "../state/run-wiring-adapter.js";
import { useWorkspaceSearchData } from "../surfaces/shell/search/search-wiring-model.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure, resolveErrorCatalogFailure } from "../../models/failures/error-catalog.js";
import { dsLayer } from "../ds/theme/tokens.js";
import { keepsMockRun, productWorkflowComposition, workflowSource, type WorkflowComposition, type SurfaceSource, surfaceSource } from "./workflow-sources.js";
import type { NavbarSearchResult } from "../surfaces/shell/search/navbar-view-model.js";
import { ViewNavigationProvider } from "./navigation/view-navigation.js";
import { useViewState, type RouteSetter } from "./navigation/view-route-model.js";
import { buildWorkflowCatalog, servedLaunchWorkflows, workflowStartRestrictions } from "../surfaces/workflows/workflow-catalog-model.js";
import { DashboardSkeleton, QueueSkeleton, RunPanelSkeleton } from "../surfaces/shared/loading/loading.js";
import { SettingsSectionSkeleton } from "../surfaces/settings/settings-loading.js";
import { RerunValuesRequestSchema } from "../../models/dashboard/rerun-values.js";
import { routeWithoutTakeovers } from "./navigation/url-state.js";
import { PreflightActionsProvider } from "../surfaces/settings/preflight/preflight-actions.js";
import { resolveDateSelection, routeForStartedRun } from "./navigation/date-state-model.js";
import { RunLaunchHost } from "../surfaces/run-start/run-launch.js";
import { launchWorkflows, useRunLaunch } from "../surfaces/run-start/run-launch-model.js";
import { PanelRight } from "lucide-react";
import { Component,useCallback,useContext,useEffect,useLayoutEffect,useMemo,useRef,useState,type CSSProperties,type ReactNode } from "react";
import { CommandRequestSchema, BulkRunCommandRequestSchema, WorkflowBatchCommandRequestSchema, type BulkRunCommandResponse } from "../../rules/commands/commands.js";
import type { ActionDescriptorWire } from "../../models/dashboard/actions.js";
import {
type FrontendBootstrapWire,
} from "../../models/dashboard/bootstrap.js";
import { StatusMockHost } from "../surfaces/settings/status-mock/status-mock.js";
import { STATUS_MOCK_BULK_OUTCOME, STATUS_MOCK_COMMAND_RESULTS, STATUS_MOCK_UNKNOWN_COMMAND, statusMock } from "../surfaces/settings/status-mock/status-mock-model.js";
import { Button,Notice,DatePicker,EmptyState,Panel,PanelBody,ToastProvider,TooltipProvider,dsIcon,useDemoTheme,useToasts } from "../ds/ui.js";
import { DashboardCommandBindingProvider, useDashboardClient, useDashboardCommandExecutor } from "../state/client-context.js";
import type { CommandOutcome, RetainedCommandRequest, CommandExecutionOptions, CommandExecutionScope } from "./commands/command-executor.js";
import { useServedNow } from "../state/served-clock.js";
import { useBootstrap } from "../state/use-bootstrap.js";
import { useDashboardDay } from "../state/use-dashboard-day.js";
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
import { fmtClock } from "../surfaces/shared/status/format.js";
import { type PanelTab } from "../surfaces/run-detail/log-panel-model.js";
import { LogSample } from "../surfaces/run-detail/logs/log-sample.js";
import { queueScopeWorkflow, queueKeyboardEntries, queueMemberKey, queueMemberSelection, queueRenameDraft } from "../surfaces/queue/queue-model.js";
import type { QueueBatch, QueueSurfaceWire } from "../surfaces/queue/queue-model.js";
import {
  attentionQueueKeys,
visibleQueueKeys,
type QueueSortKey,
} from "../surfaces/queue/queue-model.js";
import {
ConfirmBulkCommandDialog,
BulkCommandFeedback,
PauseAllQuitControls,
type PendingBulkCommand,
} from "../surfaces/queue/queue-toolbar.js";
import { bulkResultNotice } from "../surfaces/queue/queue-toolbar-model.js";
import { FocusQueueHeader, FocusQueueToolbar } from '../surfaces/queue/queue-focus.js';
import type { QueueHandlers } from "../surfaces/queue/queue.js";
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
import { mockQueueCounts, mockWorkflowCounts, mockQueueView, mockRetrySource, mockReviewRun, mockRunsForDraft, retryMockFault, mockRunSubset, initialMockDraft, type MockDraft, type MockRun } from "../surfaces/workflows/mocks/workflow-mock-model.js";
import { completeMockReviewAction, type MockReviewAction } from "../surfaces/workflows/mocks/workflow-review-action-model.js";
import { mockQueueId } from "../surfaces/workflows/mocks/workflow-queue-model.js";
import { updateMockReview } from "../surfaces/workflows/mocks/workflow-review-model.js";
import "../surfaces/shell/permanent-shell.css";
import { PAUSE_ALL_EFFECT, PROPOSED_STATUS, dsStatusOf } from "../surfaces/shared/status/status-model.js";
import { StorageNotice } from "../surfaces/settings/storage/storage-settings.js";
import { WorkspaceRail } from "../surfaces/shell/workspace-rail.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { BulkRunCommandResponseSchema } from "../../rules/commands/commands.js";
import { RunIdSchema } from "../../rules/identity/ids.js";
import { notificationTargetUnavailable, resolveRunNavigation } from "./navigation/run-navigation.js";
import type { NotificationReads } from "../surfaces/notifications/notification-rail-model.js";
import { notificationDestinationRefusal, useWorkspaceNotifications } from "../surfaces/notifications/notifications-preview-model.js";
import { withCommandNotices, type NotificationDestination, type NotificationItem } from "../surfaces/notifications/notifications-view-model.js";
import {
bulkSubjectsOf, BULK_VERB_LABEL,
composeBulkRunCommand,
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
import { mockParam } from "./mock-surfaces.js";
import { assistantNeeds } from "../surfaces/shell/assistant-launcher-model.js";
import {
activeTakeover,
routeForCrossDateSearchResult,
type AppRouteState
} from "./navigation/url-state.js";


const NO_LOG_TABS: readonly PanelTab[] = Object.freeze([]);
const NO_QUEUE_ROWS: readonly QueueSurfaceWire[] = Object.freeze([]);







/** Read once at load: the route rewrites the URL after first render. */
let loadedNotificationScenario: string | undefined;
const notificationScenario = () => loadedNotificationScenario ??= mockParam("notificationsPreview") ?? "normal";

export function DashboardApp({ workflowComposition = productWorkflowComposition, profileSource = "mock", previewPreferences }: { previewPreferences?: PersonPreferencesOwner; profileSource?: "served" | "mock"; workflowComposition?: (workflows: readonly import("../surfaces/run-start/run-start.js").RunStartWorkflow[]) => WorkflowComposition }) {
  const profileClient = useDashboardClient();
  const publicProfile = usePublicProfileSession(profileClient, profileSource === "served");
  const session = profileSource === "served" ? publicProfile.state : undefined;
  const startup = useStartupGate(session, publicProfile.failure, publicProfile.port);
  const [profileCreationChosen, setProfileCreationChosen] = useState(false);
  useEffect(() => { if (session?.state === "active") setProfileCreationChosen(false); }, [session?.state]);
  const bootstrap = useBootstrap(session, profileSource === "mock" || session?.state === "active");
  const inheritedAccount = useContext(ChatGptAccountContext);
  const inheritedOcr = useContext(PreflightOcrContext);
  const inheritedAssistantTest = useContext(PreflightAssistantContext);
  const profileId = session?.state === "active" ? session.profileId : undefined;
  const profileEpoch = session?.state === "active" ? session.epoch : undefined;
  const profileTarget = useMemo(() => profileId === undefined || profileEpoch === undefined ? undefined : { profileId, epoch: profileEpoch }, [profileId, profileEpoch]);
  const accountScope = useMemo(() => ({ profileClient, profileSource, profileId, profileEpoch }), [profileClient, profileSource, profileId, profileEpoch]);
  const [accountOwner, setAccountOwner] = useState<{ scope: typeof accountScope; port: ReturnType<typeof createServedChatGptAccountPort>; ocr: ReturnType<typeof createServedPreflightOcrPort>; assistantTest: PreflightAssistantPort }>();
  const account = accountOwner?.scope === accountScope ? accountOwner.port : undefined;
  useEffect(() => {
    if (profileSource !== "served" || profileId === undefined || profileEpoch === undefined) return;
    const port = createServedChatGptAccountPort(profileClient);
    const ocr = createServedPreflightOcrPort(profileClient, port);
    const assistantTest = createServedPreflightAssistantPort(profileClient, port);
    setAccountOwner({ scope: accountScope, port, ocr, assistantTest });
    const close = (event: PageTransitionEvent) => { if (!event.persisted) { ocr.dispose(); assistantTest.dispose(); port.dispose(); } };
    window.addEventListener("pagehide", close);
    return () => { window.removeEventListener("pagehide", close); ocr.dispose(); assistantTest.dispose(); port.dispose(); };
  }, [accountScope, profileClient, profileSource, profileId, profileEpoch]);
  const onPopstate = useRef<PopstateRouteHandler | undefined>(undefined);
  const [route, setRoute, nativeHistory] = useRoute(onPopstate);
  const onboardingProfile = useRef<string | undefined>(undefined);
  const onboardingRoute = route.onboarding;
  useEffect(() => {
    if (session?.state === PROFILE_ONBOARDING_STATE) onboardingProfile.current = session.profileId;
    else if (session?.state === "active" && session.duoState === "ready" && (onboardingProfile.current === session.profileId || profileSource === "served" && onboardingRoute !== undefined)) {
      onboardingProfile.current = undefined; setRoute({ start: false });
    } else if (session?.state === "signed-out") onboardingProfile.current = undefined;
  }, [session, setRoute, profileSource, onboardingRoute]);
  const preferencesMode: Parameters<typeof createPersonPreferences>[0] = profileSource === "mock" ? "preview" : session?.state === "active" && session.duoState === "ready" ? "person" : "signed-out";
  const preferenceRequest = useMemo(() => ({ client: profileClient, profileId, profileEpoch, mode: preferencesMode }), [profileClient, profileId, profileEpoch, preferencesMode]);
  const preferences = useMemo(() => previewPreferences ?? createPersonPreferences(preferenceRequest.mode), [preferenceRequest, previewPreferences]);
  const previousPreferences = useRef(preferences);
  if (previousPreferences.current !== preferences) { previousPreferences.current.clear(); previousPreferences.current = preferences; }
  useHubMotion(preferences);
  const { theme, toggleTheme } = useDemoTheme(preferences);
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
    <PersonPreferencesContext.Provider value={preferences}><div
      data-app-root=""
      data-demo-theme={theme}
      style={{ "--ds-toast-inset-bottom": "calc(2 * (var(--ds-h-bar) + var(--ds-space-loose)))" } as CSSProperties}
      className="flex h-screen min-h-[var(--ds-h-desktop-min)] min-w-[var(--ds-w-desktop-min)] flex-col overflow-hidden bg-[color:var(--ds-surface-page)] text-[color:var(--ds-fg)]"
    >
    <ChatGptAccountContext.Provider value={account ?? inheritedAccount}>
    <PreflightOcrContext.Provider value={accountOwner?.scope === accountScope ? accountOwner.ocr : inheritedOcr}>
    <PreflightAssistantContext.Provider value={accountOwner?.scope === accountScope ? accountOwner.assistantTest : inheritedAssistantTest}>
    <TooltipProvider delayDuration={200}>
    <ToastProvider>
      {route.viewInvalid ? (
        <EmptyState title="Invalid navigation link" description="The view parameters are invalid. Open the dashboard to recover." action={<Button onClick={() => setRoute({ start: false })}>Open dashboard</Button>} />
      ) : route.onboardingSetup !== undefined && profileSource === "served" && session?.state === PROFILE_ONBOARDING_STATE ? (
        <OnboardingSetup page="fast" port={publicProfile.port} />
      ) : profileSource === "served" && startup.loading ? (
        <StartupLoading />
      ) : profileSource === "served" && (publicProfile.failure || session !== undefined && (session.state !== "active" || session.duoState !== "ready")) ? (
        <Onboarding step={session?.state === PROFILE_ONBOARDING_STATE ? "duo" : session?.state === "active" ? "duo" : session?.state === "signed-out" && session.resumable ? "login" : route.onboarding === "signup" && profileCreationChosen || route.onboarding !== "login" && session?.state === "signed-out" && session.signUpRequired ? "signup" : "login"}
          authenticated={session?.state === "active"} port={publicProfile.port}
          problem={publicProfile.failure || startup.unavailable ? operatorFailureSentence("PROFILE_AUTHORITY_UNAVAILABLE")
            : session?.state === "refused" || session?.state === "error" ? operatorFailureSentence(session.code)
              : session?.state === "cancelling" ? operatorFailureSentence("PROFILE_LOGOUT_BLOCKED")
                : session?.state === "signed-out" && session.logoutIncomplete ? operatorFailureSentence("PROFILE_LOGOUT_INCOMPLETE") : undefined}
          onStep={onboarding => { setProfileCreationChosen(onboarding === "signup"); setRoute({ start: false, onboarding }); }} onDashboard={() => setRoute({ start: false })} />
      ) : route.onboardingSetup !== undefined && profileSource === "mock" ? (
        <OnboardingSetup page={route.onboardingSetup} />
      ) : route.onboarding !== undefined ? (
        <Onboarding step={route.onboarding} port={profileSource === "served" ? publicProfile.port : undefined} authenticated={session?.state === "active"} onStep={onboarding => setRoute({ start: false, onboarding })} onDashboard={() => setRoute({ start: false })} />
      ) : profileSource === "served" && account === undefined && session?.state === "active" ? (
        <DashboardSkeleton />
      ) : boot === undefined ? (
        <BootGate bootstrap={bootstrap} />
      ) : (
        <ViewNavigationProvider route={route} setRoute={setRoute}><DashboardPageBoundary resetKey={JSON.stringify(route)} onRecover={() => setRoute({ start: false }, "replace")}><LoadedApp
          preferences={preferences}
          profileTarget={profileTarget}
          boot={boot}
          onProfileLogout={profileSource === "served" ? publicProfile.logout : undefined}
          deleteAccount={profileSource === "served" && session?.state === "active" && session.duoState === "ready"
            ? <DeleteAccountControl key={`${session.profileId}:${session.epoch}`} presentation={publicProfile.accountDeletion.state === "idle"
              ? { state: "ready", personName: boot.actor.label, onConfirm: () => { void publicProfile.deleteAccount(); } }
              : publicProfile.accountDeletion.state === "deleting" ? { state: "deleting", personName: boot.actor.label }
                : { state: publicProfile.accountDeletion.state, personName: boot.actor.label,
                  message: operatorFailureSentence(publicProfile.accountDeletion.state === "uncertain" ? "PROFILE_ACCOUNT_DELETION_REFUSED" : publicProfile.accountDeletion.code) }} />
            : undefined}
          accountPage={profileSource === "served" && session?.state === "active" && session.account !== undefined && publicProfile.logout !== undefined ? { values: session.account, duo: session.duoState === "ready" ? "ready" : "setup", onSignOut: () => { void publicProfile.logout(); }, details: request => profileClient.changeProfileDetails(request), login: { changePassword: request => profileClient.changeProfilePassword(request), changeUsername: request => profileClient.changeProfileUsername(request) } } : undefined}
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
          startupPreflight={profileSource === "served"}
        /></DashboardPageBoundary></ViewNavigationProvider>
      )}
      <StatusMockHost />
    </ToastProvider>
    </TooltipProvider>
    </PreflightAssistantContext.Provider>
    </PreflightOcrContext.Provider>
    </ChatGptAccountContext.Provider>
    </div></PersonPreferencesContext.Provider>
  );
}

export class DashboardPageBoundary extends Component<{ resetKey: string; onRecover: () => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch(error: Error) { window.reportError(error); }
  override componentDidUpdate(previous: Readonly<typeof this.props>) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }
  override render() {
    return this.state.failed ? <Panel className="min-h-0 flex-1"><PanelBody><EmptyState title="Page unavailable"
      description={operatorFailureSentence("DASHBOARD_PAGE_FAILED")}
      action={<Button onClick={this.props.onRecover}>Open dashboard</Button>} /></PanelBody></Panel> : this.props.children;
  }
}


/** Boot is the one place a hard failure has nowhere else to go: without the boot
 * document the shell has no vocabulary to render. */
function BootGate({ bootstrap }: { bootstrap: ReturnType<typeof useBootstrap> }) {
  if (bootstrap.state === "failed") {
    return (
      <main
        data-mock-ready="failed"
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
      data-mock-ready="loading"
      className="flex min-h-0 flex-1 flex-col bg-[color:var(--ds-surface-page)]"
    >
      <DashboardSkeleton settings={new URLSearchParams(window.location.search).has("settings")} settingsContent={
        ["general", "paths", "performance", "providers", "routes", "credentials", "account"].includes(new URLSearchParams(window.location.search).get("settings") ?? "")
          ? <SettingsSectionSkeleton section={new URLSearchParams(window.location.search).get("settings")!} /> : undefined
      } />
    </main>
  );
}


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
  /** Served sign-in reads the readiness report once and toasts attention failures. */
  startupPreflight?: boolean;
}


/** A stored command result opens its run through the same validated served navigation as a run notice. */
function commandResultRun(destination: NotificationDestination): NotificationDestination | undefined {
  if (destination.kind !== "command-result") return destination;
  const request = destination.request;
  if (!("target" in request) || !("runId" in request.target) || destination.day === undefined) return undefined;
  return { kind: "run", runId: request.target.runId, day: destination.day };
}

function LoadedApp({
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
  onTab,
  sort,
  onSort,
  selectMode,
  onSelectMode,
  bulkIds,
  onBulkIds,
  startupPreflight = false,
}: LoadedAppProps) {
  /** THE clock. The server's instant is the authority; the browser contributes
 * only the monotonic time since that instant arrived, and every live elapsed */
  const client = useDashboardClient();
  const authorityEpoch = useMemo(() => Object.freeze({ client, bootstrap: boot, profileTarget }), [client, boot, profileTarget]);
  const lifecycle = useApplicationLifecycle(client, authorityEpoch);
  const application = lifecycle.resource.state === "loaded" ? lifecycle.resource.value : undefined;
  const [quitRequested, setQuitRequested] = useState(false);
  const nowIso = useServedNow(boot.serverClock.now);
  const servedNowRef = useRef(nowIso);
  servedNowRef.current = nowIso;
  const today = serverLocalDay({ ...boot.serverClock, now: nowIso });
  const dateSelection = resolveDateSelection(route.day, today);
  const day = dateSelection.state === "valid" ? dateSelection.day : dateSelection.requested;
  const dateError = dateSelection.state === "valid" ? undefined : dateSelection.reason === "future"
    ? `Date ${day} is after Today (${today}).` : `Invalid date: ${day || "(empty)"}.`;
  const workflows = useMemo(() => parseWorkflows(boot.workflows), [boot.workflows]);
  const workflowComposition = useMemo(() => composeWorkflows(launchWorkflows(workflows, boot.workbookCompatibility)), [composeWorkflows, workflows, boot.workbookCompatibility]);
  const workflowCatalog = useMemo(() => buildWorkflowCatalog(launchWorkflows(workflows, boot.workbookCompatibility), workflowComposition.catalogIncludesMocks ?? true, workflowComposition.sources, boot.featureAvailability), [workflows, workflowComposition, boot.featureAvailability, boot.workbookCompatibility]);
  const explorerCatalog = useMemo(() => workflowComposition.explorerSources ? buildWorkflowCatalog(launchWorkflows(workflows, boot.workbookCompatibility), workflowComposition.catalogIncludesMocks ?? true, workflowComposition.explorerSources, boot.featureAvailability) : workflowCatalog, [workflows, workflowComposition, workflowCatalog, boot.featureAvailability, boot.workbookCompatibility]);
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
  const [commandResults, setCommandResults] = useState<readonly CommandResultFeedEntry[]>(() => statusMock() === "command-results" ? STATUS_MOCK_COMMAND_RESULTS : []);

  const { selectedWorkflowId: chosenWorkflowId, setSelectedWorkflowId: requestActiveWorkflowId, canSelectWorkflowId } = useSelectedWorkflow(workflows.some(flow => workflowSource(flow.id, workflowComposition.sources) === "served")
    ? workflows.filter(flow => workflowSource(flow.id, workflowComposition.sources) === "served") : workflowCatalog);
  const workflowSurfaces = useMemo(() => dayWire?.queueSurfaces.filter(row => row.parent !== null || workflowSource(row.workflowId, dataSources) === "served"), [dayWire, dataSources]);
  const queueRows = workflowSurfaces ?? NO_QUEUE_ROWS;
  const selectedRow = dayWire?.queueSurfaces.find(row => row.runId === route.run);
  const logIdentity = useMemo(() => ({ client, authorityEpoch, actorId: boot.actor.id, day, runId: route.run }), [client, authorityEpoch, boot.actor.id, day, route.run]);
  const retainedLogRow = useRef<{ identity: object; row: QueueSurfaceWire } | undefined>(undefined);
  if (selectedRow !== undefined) retainedLogRow.current = { identity: logIdentity, row: selectedRow };
  else if (dayResource.state !== "loading" || retainedLogRow.current?.identity !== logIdentity) retainedLogRow.current = undefined;
  const logRow = selectedRow ?? (dayResource.state === "loading" ? retainedLogRow.current?.row : undefined);
  const activeWorkflowId = (selectedRow === undefined ? undefined : queueScopeWorkflow(selectedRow, dayWire?.queueSurfaces ?? NO_QUEUE_ROWS)) ?? route.view?.workflow ?? chosenWorkflowId;
  const queueWorkflowAvailable = workflows.some(workflow => workflow.id === activeWorkflowId)
    || queueRows.some(row => row.workflowId === activeWorkflowId && row.parent !== null);
  const authority: DashboardAuthority = useMemo(() => Object.freeze({ epoch: authorityEpoch, profileTarget, catalog: workflowCatalog, nowIso, today, day, dayState,
    selection: Object.freeze({ route, workflowId: activeWorkflowId }) }), [authorityEpoch, profileTarget, workflowCatalog, nowIso, today, day, dayState, route, activeWorkflowId]);
  const launch = useRunLaunch(route.start, DASHBOARD_MAIN_REGION_ID, authorityEpoch);
  const [requestedPreview, setRailPreview] = useViewState("preview", null);
  const routeWorkflowId = requestedPreview ?? activeWorkflowId;
  const railPreview = route.run !== undefined && requestedPreview === null ? null : requestedPreview && !workflowCatalog.some(flow => flow.id === requestedPreview) ? requestedPreview
    : routeWorkflowId && workflowComposition.sourceForRoute(routeWorkflowId, requestedPreview !== null) === "mock" ? routeWorkflowId : null;
  const [allMockRuns, setMockRuns] = useState<readonly MockRun[]>(workflowComposition.initialMockRuns);
  const startRestrictions = useMemo(() => workflowStartRestrictions(boot.featureAvailability), [boot.featureAvailability]);
  const mockRuns = useMemo(() => mockRunSubset(allMockRuns, run => !startRestrictions.has(run.workflowId) && keepsMockRun(workflowComposition, run)), [allMockRuns, workflowComposition, startRestrictions]);
  // The route selection clears after the removal commits; a run deleted here is not an unavailable destination.
  const [deletedMockRuns, setDeletedMockRuns] = useState<ReadonlySet<string>>(() => new Set());
  const launchWorkflow = route.view?.launchWorkflow;
  const launchSource = route.view?.launchSource;
  const mockLaunch = useMemo(() => route.start && launchWorkflow && MOCK_WORKFLOWS.some(flow => flow.id === launchWorkflow) && (statusMock() !== undefined || workflowComposition.sourceForRoute(launchWorkflow, true) === "mock") ? { workflowId: mockWorkflow(launchWorkflow).id,
    source: launchSource ? allMockRuns.find(run => run.id === launchSource) : undefined } : null, [route.start, launchWorkflow, launchSource, allMockRuns, workflowComposition]);
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
    // The design mock opens the redesigned dialog for every workflow that has a mock definition, served ones included.
    const mockStartId = railPreview ?? (statusMock() !== undefined ? MOCK_WORKFLOWS.find(flow => flow.id === activeWorkflowId && flow.runnable)?.id ?? MOCK_WORKFLOWS.find(flow => flow.runnable)?.id ?? null : null);
    if (mockStartId && mockWorkflow(mockStartId).runnable) openMockLaunch({ workflowId: mockWorkflow(mockStartId).id });
    else { setRoute(current => ({ ...current, view: { ...current.view, launchServed: activeWorkflowId, launchWorkflow: undefined, launchSource: undefined, launchStage: "Input", launchCustomize: false } })); servedOpenStart(); }
  }, [railPreview, servedOpenStart, openMockLaunch, activeWorkflowId, setRoute]);
  const openRerun = launch.openRerun;

  const [pendingCommand, setPendingCommand] = useState<(PendingCommand & { readonly scope: CommandExecutionScope; readonly onConfirmed?: () => void }) | null>(null);
  /** the run whose name is being edited; `null` while the dialog is shut */
  const [pendingRename, setPendingRename] = useState<(PendingRename & { readonly scope: CommandExecutionScope }) | null>(null);
  /** Keep partial batch results until dismissed so every outcome can be read. */
type UncertainCommandEntry = CommandRecoveryEntry & { readonly request: RetainedCommandRequest };
  const [pendingBulk, setPendingBulk] = useState<(PendingBulkCommand & { readonly scope: CommandExecutionScope }) | null>(null);
  const [bulkReview, setBulkReview] = useState(false);
  const [openedBulk, setOpenedBulk] = useState<BulkBatchOutcome | null>(null);
  const [noticeRead, setNoticeRead] = useState<ReadonlySet<string>>(() => new Set());
  const [bulkOutcome, setBulkOutcome] = useState<BulkBatchOutcome | null>(() => statusMock() === "command-results" ? STATUS_MOCK_BULK_OUTCOME : null);
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
    if (outcome.kind === "confirmed") {
      const request = executor.retainedAttempts().find(attempt => attempt.request.commandId === outcome.commandId)?.request;
      const warning = request === undefined ? undefined : appliedWorkerStartupToast(request, outcome.reply);
      if (warning !== undefined) toast(warning);
      return;
    }
    const original = executor.retainedAttempts().find(attempt => attempt.request.commandId === outcome.commandId)?.request;
    if (original?.family === "settings" && (original.type === "apply-settings" || original.type === "apply-protected-settings")) return; // SettingsSaveFeedback shows these
    const toastId = toast(original?.family === "start" && (outcome.kind === "refused" || outcome.kind === "conflict")
      ? runStartRefusalToast(outcome.feedback.text) : { tone: outcome.kind === "uncertain" || outcome.kind === "conflict" ? "warning" : "danger", title: "Command result", description: outcome.feedback.text });
    if (outcome.kind === "uncertain") unknownWarnings.current.set(outcome.commandId, toastId);
  }, [executor, toast, dismiss]);
  const commandBinding = useMemo(() => Object.freeze({ authority, executor, scope: commandScope, feedback: commandFeedback }), [authority, executor, commandScope, commandFeedback]);
  const currentPreferenceBinding = useRef(commandBinding);
  currentPreferenceBinding.current = commandBinding;
  useEffect(() => {
    const binding = currentPreferenceBinding.current;
    return preferences.connect(client, { ...binding, scope: commandScope, authority: { ...binding.authority, epoch: authorityEpoch } }, () => currentPreferenceBinding.current);
  }, [preferences, client, authorityEpoch, commandScope]);
  const preferenceState = usePersonPreferences();
  useEffect(() => { if (preferenceState.problem) toast({ tone: "warning", title: "Settings weren't saved", description: preferenceState.problem }); }, [preferenceState.problem, toast]);

  const appAttempts = executor.retainedAttempts().filter(attempt => attempt.scope.actorId === commandScope.actorId
    && attempt.scope.authority === commandScope.authority && attempt.scope.client === client
    && (attempt.request.family === "application" || "targets" in attempt.request && attempt.request.type === "resume"));
  const applicationBusy = appAttempts.some(attempt => attempt.state === "pending" || attempt.outcome?.kind === "uncertain");
  const quitting = appAttempts.some(attempt => attempt.request.type === "pause-all-and-quit"
    && (attempt.state === "pending" || attempt.outcome?.kind === "confirmed" || attempt.outcome?.kind === "uncertain")) || application?.state === "quitting";
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
    if (attempt.scope.actorId !== commandScope.actorId || (attempt.state !== "pending" && attempt.outcome?.kind !== "uncertain")) return [];
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
  const unresolvedRunAction = useCallback((runId: string, type: string) => executor.retainedAttempts().find(attempt => (attempt.state === "pending" || attempt.outcome?.kind === "uncertain")
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
    for (const row of dayWire?.queueSurfaces ?? []) {
      if (row.parent !== null) labels.set(row.parent.workflowId, row.parent.label);
      for (const link of row.linkedRuns) labels.set(link.workflowId, link.label);
      if (row.surfaceKind === "operation") for (const member of row.recordMembers?.members ?? []) labels.set(member.target.workflowId, member.target.label);
    }
    return labels;
  }, [workflowCatalog, dayWire]);
  const workflowLabelOf = useCallback((workflowId: string): string => workflowLabels.get(workflowId) ?? workflowId, [workflowLabels]);
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
          const bulkWarning = unconfirmedBulkWorkerToast(request, reply, outcome.kind === "confirmed");
          if (bulkWarning !== undefined) toast(bulkWarning);
        }
        if (outcome.kind !== "confirmed") {
          if (!("targets" in request) && (request.family === "run" || request.family === "gate") && outcome.reply !== undefined && "state" in outcome.reply && "commandId" in outcome.reply) {
            const folded = settleCommandResult(outcome.reply);
            if (folded.kind === "refused") {
              const surface = dayWire?.queueSurfaces.find(row => row.runId === request.target.runId);
              const entry = commandResultFeedEntry({ settlement: { ...folded, problem: outcome.feedback.text },
                targetRunId: request.target.runId, expectedVersion: request.target.expectedVersion, commandId: request.commandId,
                subject: surface?.title ?? `run ${request.target.runId}`, workflowLabel: workflowLabelOf(surface?.workflowId ?? activeWorkflowId),
                actionLabel: label, clock: fmtClock(nowIso), actorId: request.requestedBy });
              if (entry !== undefined) setCommandResults(previous => [entry, ...previous].slice(0, 4));
            }
          }
          return;
        }
        const warning = appliedWorkerStartupToast(request, outcome.reply);
        if (warning === undefined || "targets" in request) toast({ tone: "success", title: label, description: "Command confirmed." });
        if (!("targets" in request) && request.family === "run" && request.type === "delete" && outcome.reply !== undefined && "affectedTargets" in outcome.reply) {
          const removed = new Set<string>(outcome.reply.affectedTargets.flatMap(target => target.family === "run" ? [target.runId] : []));
          if (routeRef.current.run !== undefined && removed.has(routeRef.current.run)) setRoute({ ...routeRef.current, run: undefined, section: undefined });
          const next = new Set([...bulkIdsRef.current].filter(id => !removed.has(id)));
          if (next.size !== bulkIdsRef.current.size) onBulkIds(next);
        }
      },
    };
    const execution = replay ? executor.replay(request.commandId, options) : executor.execute(request, options);
    refreshCommandRecovery(value => value + 1);
    await execution;
  }, [commandScope, commandFeedback, executor, client, dayWire, workflowLabelOf, activeWorkflowId, nowIso, toast, setRoute, onBulkIds]);

  const applicationAction = (action: "pause-all" | "pause-all-and-quit" | "resume") => {
    if (application === undefined || application.state !== "ready" || applicationBusy || quitting) return;
    const envelope = { commandId: crypto.randomUUID(), requestedAt: nowIso, requestedBy: boot.actor.id, source: "dashboard" };
    const targets = application.targets.map(({ runId, expectedVersion }) => ({ runId, expectedVersion }));
    if (action === "resume") {
      if (application.pause !== "paused") return;
      const plan: BulkVerbPlan = { verb: "resume", label: "Resume", eligible: targets.map(target => ({ ...target,
        title: dayWire?.queueSurfaces.find(row => row.runId === target.runId)?.title ?? target.runId })), skipped: [], unavailable: [] };
      void executeShell(BulkRunCommandRequestSchema.parse({ ...envelope, bulkCommandId: envelope.commandId, family: "run", type: "resume", targets, mode: "best-effort" }), "Resume all runs", plan).then(lifecycle.refresh);
    } else {
      void executeShell(CommandRequestSchema.parse({ ...envelope, family: "application", type: action,
        target: { runtimeGeneration: application.runtimeGeneration }, payload: { targets, ...(action === "pause-all-and-quit" ? { confirmed: true } : {}) } }),
      action === "pause-all" ? "Pause all requested" : "Quit requested").then(lifecycle.refresh);
    }
  };

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
          const rerunFlow = row !== undefined && statusMock() !== undefined ? MOCK_WORKFLOWS.find(flow => flow.id === row.workflowId && flow.runnable) : undefined;
          if (row !== undefined && rerunFlow !== undefined) {
            // The design mock reruns a served run in the redesigned dialog, from a mock run that stands for it.
            const source: MockRun = { id: String(row.runId), workflowId: rerunFlow.id, title: row.title, subject: row.title, draft: initialMockDraft(rerunFlow.id), approved: true, seeded: true };
            setMockRuns(previous => previous.some(run => run.id === source.id) ? previous : [...previous, source]);
            openMockLaunch({ workflowId: rerunFlow.id, source });
            return;
          }
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
    [dayWire, workflowLabelOf, activeWorkflowId, dispatchCommand, selectRun, toast, nowIso, openRerun, openMockLaunch, unresolvedRunAction, commandScope],
  );

  const confirmLogDecision = useCallback<RunWiringConfirm>((pending, onConfirmed) => setPendingCommand({ ...pending, scope: commandScope, onConfirmed }), [commandScope]);

  const runQueueAction = useCallback(
    (action: ActionDescriptorWire, target: ActionTarget): void => {
      runAction(action, target, "queue");
    },
    [runAction],
  );
  const runLogAction = useCallback((action: ActionDescriptorWire, target: ActionTarget) => runAction(action, target, "run-detail"), [runAction]);

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
  const renameQueueTitle = useCallback((runId: string, name: string) => {
    const surface = dayWire?.queueSurfaces.find((row) => String(row.runId) === runId);
    if (surface === undefined) {
      toast({
        tone: "danger",
        title: "Nothing was sent",
        description: `run ${runId} is not on the day this panel is showing, so there is no row to `
          + "name. Open the day it ran on and rename it there.",
      });
      return;
    }
    const next = queueRenameDraft(surface, name);
    if (next === undefined) return;
    const action = surface.actions.find((entry): entry is CommandAction => entry.kind === "command" && entry.command === "rename");
    if (action === undefined) {
      toast({ tone: "danger", title: "Command refused", description: formatErrorCatalogFailure(createErrorCatalogFailure("COMMAND_REFUSED", {})).text });
      return;
    }
    dispatchCommand(action, { runId: surface.runId, expectedVersion: action.expectedVersion }, { renameAnswer: next, source: "queue" });
  }, [dayWire, dispatchCommand, toast]);
  const { surfaces, outcomes, viewState, queueHandlers, actionsOf } = useQueueWiring({
    allRows: dayWire?.queueSurfaces, attemptHistory: dayWire?.attemptHistory, rows: queueRows, activeWorkflowId, filter, selectedRunId: route.run,
    openWells, selectMode, bulkIds, nowIso, selectRun, openRelatedRun, selectedMember: route.view?.queueMember, openMember: openQueueMember, onWells, onBulkIds,
    setBatchGrouping, exitQueueSelection, runQueueAction, renameTitle: renameQueueTitle,
  });

  const keyboardEntries = useMemo(() => new Map(queueKeyboardEntries(surfaces, sort, nowIso).map(entry => [entry.key, entry])), [surfaces, sort, nowIso]);
  const selectQueueKey = useCallback((key: string) => {
    const entry = keyboardEntries.get(key);
    if (entry === undefined) throw new Error("queue-keyboard-target-unavailable");
    if (entry.kind === "record") openQueueMember(entry.member);
    else selectRun(entry.runId);
  }, [keyboardEntries, openQueueMember, selectRun]);
  const selectedQueueKey = route.view?.queueMember === undefined ? route.run : queueMemberKey(route.view.queueMember);
  const keyboardOrder = useMemo(
    () => visibleQueueKeys(surfaces, sort, nowIso),
    [surfaces, sort, nowIso],
  );
  const keyboardAttention = useMemo(
    () => attentionQueueKeys(surfaces, sort, nowIso),
    [surfaces, sort, nowIso],
  );
  useGlobalKeys({
    queueVisible: activeTakeover(route) === "none" && dayWire !== undefined,
    onStartRun: openStart,
    onCyclePanelMode: () => {},
    panelMode: "sidebar",
    onMinimisePanel: () => {},
    // A preview queue is not the served queue; its rows must not move the hidden served selection.
    visibleQueueKeys: railPreview ? [] : keyboardOrder,
    workflowIds: workflowCatalog.map(workflow => workflow.id), onWorkflow: selectWorkflow,
    attentionQueueKeys: railPreview ? [] : keyboardAttention,
    selectedQueueKey,
    onSelectQueueKey: selectQueueKey,
    panelTabs: NO_LOG_TABS,
    onTab,
  });

  const ready = !hasServedWorkflows || dayResource.state === "loaded" || dayResource.state === "failed";
  // One resolution of "which takeover owns the main region", so the JSX below
  // cannot disagree with a link that carries more than one key.
  const takeover = activeTakeover(route);

  const closeTakeoverTo = useTakeoverCloseFocus(takeover, setRoute);

  /** Settings navigation creates history so Back returns to the previous view. */
  const [sessionsOpen, setSessionsOpen] = useViewState("sessions", false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const openSettings = useCallback((section = ""): void => {
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
    }));
  }, [setRoute]);
  const shownPreflight = useRef(new Set<string>());
  useEffect(() => {
    if (!startupPreflight) return;
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
      toast({ tone: attention.tone, title: attention.title, sticky: true });
    })();
    return () => { active = false; };
  }, [startupPreflight, client, toast]);

  const renderQueueBody = useCallback((body: ReactNode) => (
    <FocusQueueHeader active={filter} counts={scopedStatusCounts} onFilter={onFilter}
      >{body}</FocusQueueHeader>
  ), [filter, scopedStatusCounts, onFilter]);

  const settingsOpen = ["settings", "archive", "activity", "explore"].includes(takeover);
  const settingsResolution = resolveSettingsSection(buildSettingsNav(), route.settings ?? "");
  const pageName = takeover === "settings" ? settingsResolution.state === "open" ? settingsResolution.entry.label : "Settings"
    : takeover === "archive" ? "Archive" : takeover === "activity" ? "Analytics" : takeover === "explore" ? "Explorer"
    : takeover === "intake" ? "Edit Data" : route.start ? route.view?.launchSource || route.view?.launchRerun ? "Rerun" : "Run" : railPreview ? MOCK_WORKFLOWS.find(flow => flow.id === railPreview)?.label ?? "Unavailable workflow"
    : workflows.find(workflow => workflow.id === activeWorkflowId)?.label ?? "Dashboard";
  useEffect(() => { document.title = `${pageName} — Relay`; }, [pageName]);
  const previewFlow = railPreview ? MOCK_WORKFLOWS.find(flow => flow.id === railPreview) : undefined;
  const railRows = useMemo(() => mockRuns.filter(run => run.workflowId === railPreview), [mockRuns, railPreview]);
  const previewCounts = useMemo(() => mockWorkflowCounts(mockRuns), [mockRuns]);
  const servedWorkflowCounts = useMemo(() => {
    const childWorkflows = new Set(dayWire?.queueSurfaces.filter(row => row.parent !== null).map(row => row.workflowId));
    return dayWire?.workflowCounts.filter(count => childWorkflows.has(count.workflowId) || workflowSource(count.workflowId, dataSources) === "served");
  }, [dayWire, dataSources]);
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
    const ocrRun = draft.ocrMode === "manual" ? created.find(run => run.workflowId === "ocr") : undefined;
    const review = ocrRun ? created.find(run => run.ocrRunId === ocrRun.id) : undefined;
    setRoute(current => ({ ...current, start: false, view: { ...current.view, preview: id, mockRun: review?.id ?? created[0]?.id, records: review?.id, launchWorkflow: undefined, launchSource: undefined, launchStage: undefined } }));
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
  const searchTitles = useMemo(() => new Map(queueRows.map(row => [String(row.runId), row.title])), [queueRows]);
  const servedSearchData = useSearchWiring({ client, enabled: workflowComposition.search === "served" && route.view?.search === true,
    query: route.view?.searchQuery ?? "", today, epoch: authorityEpoch, workflows, titles: searchTitles });
  const librarySheets = useLibrarySheets(client, workflowComposition.search === "served" && route.view?.search === true);
  const searchData = useMemo(() => workflowComposition.search === "mock" ? previewSearchData : { ...servedSearchData, sheets: librarySheets.sheets, sheetsUnavailable: librarySheets.unavailable }, [workflowComposition.search, previewSearchData, servedSearchData, librarySheets]);
  const inbox = useInboxWiring({ client, enabled: workflowComposition.inbox === "served", binding: commandBinding, toast });
  const [notificationReads, setNotificationReads] = useState<NotificationReads>({});
  const notifications = useWorkspaceNotifications(notificationScenario(), {
    day, nowIso, anchorIso: boot.serverClock.now, rows: !hasServedWorkflows || dayWire ? queueRows : undefined, runs: mockRuns,
    workflowLabel: workflowLabelOf, eventTimes: mockNotificationTimes,
    unavailable: dateError ?? (dayResource.state === "failed" ? dayFailureText : undefined),
  });
  const shownRecovery: readonly CommandRecoveryEntry[] = statusMock() === "command-unknown" ? [...recoveryEntries, STATUS_MOCK_UNKNOWN_COMMAND] : recoveryEntries;
  const commandNotices: readonly NotificationItem[] = [
    ...shownRecovery.map((entry): NotificationItem => ({ id: `command:${entry.inFlightKey}`, kind: "command", priority: true, title: recoveryTitle(entry), subject: "", workflow: "",
      detail: `${recoveryDetail(entry)}. Review the original request to recover its result.`, tone: "warning", age: "Just now", read: false, action: "Review", destination: { kind: "local-recovery", key: entry.inFlightKey } })),
    ...commandResults.map((entry): NotificationItem => ({ id: `command-result:${entry.id}`, kind: "command", priority: true, title: commandResultTitle(entry), subject: "", workflow: "",
      detail: commandResultDetail(entry), tone: entry.settlement.reason === "conflict" ? "warning" : "danger", age: entry.clock, read: false,
      action: entry.settlement.reason === "conflict" ? "Refresh row" : "Open run", destination: { kind: "local-command-result", id: entry.id } })),
    ...(bulkOutcome === null ? [] : [bulkResultNotice(bulkOutcome)]),
  ];
  const railNotifications = withCommandNotices(notifications, commandNotices);
  // Local command notices are not server rows: their read state lives here, never in the served inbox.
  const localNoticeIds = new Set(commandNotices.map(notice => notice.id));
  const openInbox: InboxWiring["open"] = (item, navigate, opened, refused) => localNoticeIds.has(item.id) ? navigate(item.destination, opened, refused) : inbox.open(item, navigate, opened, refused);
  const railInbox = workflowComposition.inbox === "served" ? { ...inbox, open: openInbox,
    state: withCommandNotices(inbox.state, commandNotices.map(notice => noticeRead.has(notice.id) ? { ...notice, read: true } : notice)),
    control: async (id: string, action: Parameters<InboxWiring["control"]>[1]) => {
      if (!localNoticeIds.has(id)) return inbox.control(id, action);
      if (action === "read" || action === "unread") setNoticeRead(previous => { const next = new Set(previous); if (action === "read") next.add(id); else next.delete(id); return next; });
      return true;
    },
    readAll: async () => { setNoticeRead(previous => new Set([...previous, ...localNoticeIds])); await inbox.readAll(); } } : undefined;
  const servedNeedsYou = railInbox?.state.state === "ready" ? railInbox.state.items.filter(item => !item.read && item.priority === true).length : 0;
  useEffect(() => { assistantNeeds.report(servedNeedsYou); }, [servedNeedsYou]);
  const canOpenRegisteredWorkflow = useCallback((id: string) => workflows.some(flow => flow.id === id), [workflows]);
  const notificationContext = useRef({ day, rows: queueRows, runs: mockRuns, canOpenRegisteredWorkflow, canSelectWorkflowId });
  notificationContext.current = { day, rows: queueRows, runs: mockRuns, canOpenRegisteredWorkflow, canSelectWorkflowId };
  const notificationNavigation = useRef(0);
  const openNotification = useCallback((requested: NotificationDestination, opened: () => void, refused: (message: string) => void, source: SurfaceSource) => {
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
      setOpenedBulk({ plan: { verb: destination.type, label: BULK_VERB_LABEL[destination.type], eligible: [], skipped: destination.notAttempted.map(runId => ({ runId, title: title(runId) })), skippedReason: "Not attempted", unavailable: [] },
        days: new Map(Object.entries(destination.days)),
        subjects: new Map(ids.map(runId => [runId, title(runId)])), response: response.data });
      setBulkReview(true); opened();
      return;
    }
    if (destination.kind === "settings") {
      leaveSettings(() => { setRoute({ ...routeWithoutTakeovers(routeRef.current), settings: destination.section }); opened(); });
      return;
    }
    if (destination.kind === "none") return;
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
          view: { ...routeRef.current.view, queueFilter: ["all"], workflow: row.workflowId, preview: null, mockRun: undefined, records: undefined, logFailure: undefined } });
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
      const open = (result: Awaited<ReturnType<typeof resolveRunNavigation>>) => {
        if (!current()) return;
        if (result.state === "refused") { refused(result.message); return; }
        setLaunchOpen(false);
        exitQueueSelection();
        onFilter(["all"]);
        setRoute({ ...result.route, view: { ...result.route.view, queueFilter: ["all"] } });
        opened();
        requestAnimationFrame(() => document.getElementById(DASHBOARD_MAIN_REGION_ID)?.focus({ preventScroll: true }));
      };
      const resolve = () => resolveRunNavigation(client, destination, origin, notificationContext.current.canOpenRegisteredWorkflow);
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
      setRoute(current => ({ ...next, day: destination.day, view: { ...current.view, preview: run.workflowId, mockRun: run.id, records: destination.records ? run.id : undefined } }));
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
  }, [client, commandScope, leaveSettings, route, setRoute, setLaunchOpen, exitQueueSelection, onFilter, setActiveWorkflowId, setMockLaunch, setRailPreview, setRailReviewId, setRailRun, commandResults, selectRun]);

  const onInboxNotification = useCallback((destination: NotificationDestination, opened: () => void, refused: (message: string) => void) => {
    openNotification(destination, opened, refused, workflowComposition.inbox);
  }, [openNotification, workflowComposition.inbox]);

  const onSearchAction = useCallback((action: "start" | "spreadsheets" | "settings") => {
    if (action === "start") openStart(); else openSettings(action === "spreadsheets" ? "spreadsheets" : "");
  }, [openStart, openSettings]);
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
      data-mock-ready={ready ? "true" : "loading"}
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
        onSelect={onRailSelect} onPreview={onRailPreview} settingsOpen={settingsOpen} notifications={railNotifications} reads={notificationReads} setReads={setNotificationReads} inbox={railInbox} onOpenNotification={onInboxNotification} searchData={searchData} onSearch={onSearch} onSearchAction={onSearchAction} />

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
        {quitting && <Notice sticky tone="info" title="Relay quits after runs pause" description={PAUSE_ALL_EFFECT} />}
        {lifecycle.resource.state === "failed" && <Notice sticky tone="danger" title="Run controls unavailable" description="Work remains held. Reload Relay to check the connection." />}
        {dayResource.state === "loaded" && stoppedWorkerToasts(dayResource.value, id => workflowCatalog.find(entry => entry.id === id)?.label ?? id)
          .map(warning => <Notice key={warning.description} sticky tone={warning.tone} title={warning.title} description={warning.description} />)}

        <div className="flex min-h-0 flex-1">


          <div className="flex min-h-0 min-w-0 flex-1 flex-col">

          {/* Intake is a durable workspace; leaving it must not discard mapping progress. */}
          <DashboardTakeovers deleteAccount={deleteAccount} accountPage={accountPage} onOpenRun={selectRun} activitySource={workflowComposition.activity} today={today} workflowSources={workflowComposition.sources} takeover={takeover} route={route} setRoute={setRoute} boot={boot}
            client={client} workflowCatalog={explorerCatalog} activeWorkflowId={activeWorkflowId}
            workflowLabelOf={workflowLabelOf} supportsDryRun={startWorkflow?.inputRun.state === "present" && startWorkflow.inputRun.surface.supportsDryRun === true}
            closeTakeoverTo={closeTakeoverTo}
            onSettingsExitGuardChange={onSettingsExitGuardChange} onSettingsSaved={notice => toast({ tone: "success", ...notice })} theme={theme} onToggleTheme={onToggleTheme}>
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
            const refuse = (message: string) => toast({ tone: "danger", title: "Run unavailable", description: message });
            if (runDay === undefined) { refuse(notificationTargetUnavailable()); return; }
            openNotification({ kind: "run", runId: RunIdSchema.parse(runId), day: runDay }, () => undefined, refuse, workflowComposition.inbox);
          }} />


          <CommandResultFeed results={commandResults} />

          <div className="flex min-h-0 flex-1">

            <div className="relative min-h-0 min-w-0 flex-1">
            <div className="dashboard-panel-columns">
              <div className="dashboard-queue-column">
                <h1 className="sr-only">{previewFlow?.label ?? workflowLabelOf(activeWorkflowId)} queue</h1>
              {startRestrictions.has(activeWorkflowId) && previewFlow ? <Panel className="min-h-0"><PanelBody><EmptyState title="Workflow unavailable" description={startRestrictions.get(activeWorkflowId)} /></PanelBody></Panel> : previewFlow && dateSelection.state === "valid" ? <WorkflowMockQueue label={previewFlow.label} runs={railQueueRows} allRuns={mockRuns} selected={railRun} onSelect={setRailRun}
                onRetry={id => { const source = mockRetrySource(mockRuns, id); openMockLaunch({ workflowId: source.workflowId, source }); }}
                onDelete={ids => { setDeletedMockRuns(previous => new Set([...previous, ...ids])); setMockRuns(previous => previous.filter(run => !ids.includes(run.id))); toast({ tone: "success", title: "Run deleted" }); if (railRun && ids.includes(railRun)) { setRailRun(undefined); setRailReviewId(undefined); } }}
                day={day} nowIso={nowIso} anchorIso={boot.serverClock.now} sort={sort} filter={queueFilterScope} /> : dayWire === undefined || !queueWorkflowAvailable ? (
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
            pauseControls={<PauseAllQuitControls state={application === undefined ? "unavailable" : application.state !== "ready" || application.pause === "pause-pending" ? "pausing" : application.pause === "paused" ? "paused" : "ready"}
              activeCount={application?.targets.length ?? 0} quitRequested={quitRequested} onQuitDismiss={() => setQuitRequested(false)}
              onPauseAll={applicationBusy || quitting ? undefined : () => applicationAction("pause-all")} onResumeAll={applicationBusy || quitting ? undefined : () => applicationAction("resume")} onPauseAndQuit={applicationBusy || quitting ? undefined : () => applicationAction("pause-all-and-quit")} />}
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
            {previewFlow && railRow && dateSelection.state === "valid" ? <WorkflowMockLog key={railRow.id} run={railRow} runs={mockRuns} onRerun={() => openMockLaunch({ workflowId: railRow.workflowId, source: railRow })} onRetry={() => setMockRuns(previous => retryMockFault(previous, [railRow.id, ...(railRow.ocrRunId ? [railRow.ocrRunId] : [])]))} onApprove={() => completeReview(mockReviewRun(railRow, mockRuns).id, "approve")}
              reviewOpen={railReviewId === railRow.id} onReviewOpenChange={open => setRailReviewId(open ? railRow.id : undefined)}
              onChange={records => setMockRuns(previous => updateMockReview(previous, mockReviewRun(railRow, previous).id, records))} onDiscard={() => completeReview(mockReviewRun(railRow, mockRuns).id, "discard")} onRestore={() => completeReview(mockReviewRun(railRow, mockRuns).id, "restore")}
              onSelect={id => { const next = mockRuns.find(run => run.id === id); if (!next) throw new Error(`MOCK_LINKED_RUN_MISSING: ${id}`); setRoute(current => ({ ...current, view: { ...current.view, preview: next.workflowId, mockRun: next.id, records: undefined } })); }} /> : !previewFlow && route.run !== undefined && logRow !== undefined && dateSelection.state === "valid" ? (
              <LogSample key={`${route.run}:${route.view?.logFailure?.failureId ?? ""}`} confirm={confirmLogDecision} onAction={runLogAction}
                reviewOpen={route.section === "review"} reviewFocus={route.view?.queueMember?.kind === "record" ? route.view.queueMember.record : undefined}
                onReview={() => setRoute(current => ({ ...current, section: "review" }))} onLogs={() => setRoute(current => ({ ...current, section: "logs" }))}
                initialStepId={route.view?.logFailure?.runId === route.run ? route.view.logFailure.failureId : undefined} source={workflowComposition.logsSources && (logRow.parent === null || statusMock() !== undefined) ? surfaceSource(logRow.workflowId, workflowComposition.logsSources) : "served"} selection={{ row: logRow, workflowLabel: workflowLabelOf(logRow.workflowId) }} />
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
        </DashboardPageBoundary>
      </main>
      </div>

      <HubShell subjectRef={selectedRow === undefined || selectedRow.parent === null && workflowSource(selectedRow.workflowId, workflowComposition.sources) !== "served" ? undefined : `run_${selectedRow.runId}_${selectedRow.rowRevision}`} commands={commandBinding} source={workflowComposition.assistant ?? "served"} authority={authorityEpoch} onOpenSettings={openSettings} onRunWorkflow={runAssistantWorkflow} settingsOpen={settingsOpen} logoutOpen={logoutOpen} onLogoutOpenChange={setLogoutOpen} onLogout={() => leaveSettings(() => {
        if (onProfileLogout === undefined) setRoute({ start: false, onboarding: "login" });
        else void onProfileLogout();
      })} />
      {/* The Sessions bar and its Ask control belong to the workflow workspace: every Settings page hides them. */}
      {!settingsOpen && (
        <SessionPanel
          source={workflowComposition.sessions ?? "served"}
          binding={{ client, executor, scope: commandScope, dayState, day, nowIso }}
          catalog={workflowCatalog}
          open={sessionsOpen}
          onOpenChange={setSessionsOpen}
          account={{ onSettings: () => openSettings(), onLogout: () => setLogoutOpen(true) }}
        />
      )}

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
