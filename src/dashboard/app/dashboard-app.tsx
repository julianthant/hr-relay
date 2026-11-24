import { createPersonPreferences, type PersonPreferencesOwner } from "../state/person-preferences-model.js";
import { PersonPreferencesContext } from "../lib/person-preferences.js";
import { PROFILE_ONBOARDING_STATE } from "../../models/profiles/public-profile.js";
import { PreflightOcrContext, createServedPreflightOcrPort } from "../surfaces/settings/preflight/preflight-ocr-model.js";
import { ChatGptAccountContext, createServedChatGptAccountPort } from "../surfaces/settings/general/chatgpt-account-model.js";
import { operatorFailureSentence } from "../../models/failures/error-catalog.js";
import { StartupLoading } from "../surfaces/shell/startup-loading.js";
import { useStartupGate } from "./startup/startup-gate.js";
import { signInProblems, useDuoReenrol, usePublicProfileSession } from "../surfaces/shell/onboarding-model.js";
import { sameSessionAccount } from "../surfaces/settings/account/account-session.js";
import { DeleteAccountControl } from "../surfaces/settings/general/ui-settings-records-general-paths.js";
import { OnboardingSetup } from "../surfaces/shell/onboarding-setup.js";
import { Onboarding } from "../surfaces/shell/onboarding.js";
import { LoadedApp } from "./loaded-app.js";
import { DashboardPageBoundary } from "./dashboard-page-boundary.js";
import { useHubMotion } from "../ds/theme/motion.js";
import "../ds/theme/hub-theme.css";
import { productWorkflowComposition, type WorkflowComposition } from "./workflow-sources.js";
import { ViewNavigationProvider } from "./navigation/view-navigation.js";
import {useCallback,useContext,useEffect,useMemo,useRef,useState,type CSSProperties } from "react";


import { Button,FailureNotice,EmptyState,ToastProvider,TooltipProvider,useDemoTheme } from "../ds/ui.js";
import { useDashboardClient } from "../state/client-context.js";
import { useBootstrap } from "../state/use-bootstrap.js";




import {
type QueueSortKey,
} from "../surfaces/queue/queue-model.js";



import {type StatusBucket } from "../surfaces/shell/shell-model.js";
import "../surfaces/shell/permanent-shell.css";




import type {PopstateRouteHandler } from "./navigation/route-history-model.js";
import { useRoute } from "./navigation/route-history-model.js";





export function DashboardApp({ workflowComposition = productWorkflowComposition, previewPreferences }: { previewPreferences?: PersonPreferencesOwner; workflowComposition?: (workflows: readonly import("../surfaces/run-start/run-start.js").RunStartWorkflow[]) => WorkflowComposition }) {
  const profileClient = useDashboardClient();
  const publicProfile = usePublicProfileSession(profileClient, true);
  const session = publicProfile.state;
  const duoReenrol = useDuoReenrol(profileClient, publicProfile.state?.state === "active");
  const startup = useStartupGate(session, publicProfile.failure, publicProfile.port);
  const [profileCreationChosen, setProfileCreationChosen] = useState(false);
  useEffect(() => { if (session?.state === "active") setProfileCreationChosen(false); }, [session?.state]);
  const bootstrap = useBootstrap(session, session?.state === "active");
  const inheritedAccount = useContext(ChatGptAccountContext);
  const inheritedOcr = useContext(PreflightOcrContext);
  const profileId = session?.state === "active" ? session.profileId : undefined;
  const profileEpoch = session?.state === "active" ? session.epoch : undefined;
  const profileTarget = useMemo(() => profileId === undefined || profileEpoch === undefined ? undefined : { profileId, epoch: profileEpoch }, [profileId, profileEpoch]);
  const duoKeys = useMemo(() => profileTarget === undefined ? undefined : {
    read: () => profileClient.readProfileDuoKeys(profileTarget),
    change: (change: import("../../models/config/duo-credential-store.js").DuoKeyChange) => profileClient.changeProfileDuoKey({ ...profileTarget, change }),
  }, [profileClient, profileTarget]);
  const accountScope = useMemo(() => ({ profileClient, profileId, profileEpoch }), [profileClient, profileId, profileEpoch]);
  const [accountOwner, setAccountOwner] = useState<{ scope: typeof accountScope; port: ReturnType<typeof createServedChatGptAccountPort>; ocr: ReturnType<typeof createServedPreflightOcrPort> }>();
  const account = accountOwner?.scope === accountScope ? accountOwner.port : undefined;
  useEffect(() => {
    if (profileId === undefined || profileEpoch === undefined) return;
    const port = createServedChatGptAccountPort(profileClient);
    const ocr = createServedPreflightOcrPort(profileClient, port);
    setAccountOwner({ scope: accountScope, port, ocr });
    const close = (event: PageTransitionEvent) => { if (!event.persisted) { ocr.dispose(); port.dispose(); } };
    window.addEventListener("pagehide", close);
    return () => { window.removeEventListener("pagehide", close); ocr.dispose(); port.dispose(); };
  }, [accountScope, profileClient, profileId, profileEpoch]);
  const onPopstate = useRef<PopstateRouteHandler | undefined>(undefined);
  const [route, setRoute, nativeHistory] = useRoute(onPopstate);
  const onboardingProfile = useRef<string | undefined>(undefined);
  const onboardingRoute = route.onboarding;
  useEffect(() => {
    if (session?.state === PROFILE_ONBOARDING_STATE) onboardingProfile.current = session.profileId;
    else if (session?.state === "active" && session.duoState === "ready" && (onboardingProfile.current === session.profileId || onboardingRoute !== undefined)) {
      onboardingProfile.current = undefined; setRoute({ start: false });
    } else if (session?.state === "signed-out") onboardingProfile.current = undefined;
  }, [session, setRoute, onboardingRoute]);
  const preferencesMode: Parameters<typeof createPersonPreferences>[0] = session?.state === "active" && session.duoState === "ready" ? "person" : "signed-out";
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
  /** the toolbar's ordering control and its select mode — client UI state */
  const sort = route.view?.queueSort ?? "attention";
  const setSort = useCallback((next: QueueSortKey) => setRoute(current => ({ ...current, view: { ...current.view, queueSort: next } })), [setRoute]);

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
    <TooltipProvider delayDuration={200}>
    <ToastProvider>
      {route.viewInvalid ? (
        <EmptyState title="Invalid navigation link" description="The view parameters are invalid. Open the dashboard to recover." action={<Button onClick={() => setRoute({ start: false })}>Open dashboard</Button>} />
      ) : duoReenrol.port !== undefined ? (
        <OnboardingSetup page="fast" port={duoReenrol.port} />
      ) : route.onboardingSetup !== undefined && session?.state === PROFILE_ONBOARDING_STATE ? (
        <OnboardingSetup page="fast" port={publicProfile.port} />
      ) : startup.loading ? (
        <StartupLoading />
      ) : (publicProfile.failure || session !== undefined && (session.state !== "active" || session.duoState !== "ready")) ? (
        <Onboarding step={session?.state === PROFILE_ONBOARDING_STATE ? "duo" : session?.state === "active" ? "duo" : session?.state === "signed-out" && session.resumable ? "login" : route.onboarding === "signup" && profileCreationChosen || route.onboarding !== "login" && session?.state === "signed-out" && session.signUpRequired ? "signup" : "login"}
          authenticated={session?.state === "active"} port={publicProfile.port}
          {...signInProblems(session, Boolean(publicProfile.failure) || startup.unavailable)}
          onStep={onboarding => { setProfileCreationChosen(onboarding === "signup"); setRoute({ start: false, onboarding }); }} onDashboard={() => setRoute({ start: false })} />
      ) : route.onboarding !== undefined ? (
        <Onboarding step={route.onboarding} port={publicProfile.port} authenticated={session?.state === "active"} onStep={onboarding => setRoute({ start: false, onboarding })} onDashboard={() => setRoute({ start: false })} />
      ) : account === undefined && session?.state === "active" || boot === undefined && bootstrap.state !== "failed" ? (
        <StartupLoading />
      ) : boot === undefined ? (
        <BootFailure />
      ) : (
        <StartupLoading><ViewNavigationProvider route={route} setRoute={setRoute}><DashboardPageBoundary resetKey={JSON.stringify(route)} onRecover={() => setRoute({ start: false }, "replace")}><LoadedApp
          preferences={preferences}
          profileTarget={profileTarget}
          boot={boot}
          onProfileLogout={publicProfile.logout}
          deleteAccount={session?.state === "active" && session.duoState === "ready"
            ? <DeleteAccountControl key={`${session.profileId}:${session.epoch}`} presentation={publicProfile.accountDeletion.state === "idle"
              ? { state: "ready", personName: session.account?.name ?? boot.actor.label, onConfirm: () => { void publicProfile.deleteAccount(); } }
              : publicProfile.accountDeletion.state === "deleting" ? { state: "deleting", personName: session.account?.name ?? boot.actor.label }
                : { state: publicProfile.accountDeletion.state, personName: session.account?.name ?? boot.actor.label,
                  message: operatorFailureSentence(publicProfile.accountDeletion.state === "uncertain" ? "PROFILE_ACCOUNT_DELETION_REFUSED" : publicProfile.accountDeletion.code) }} />
            : undefined}
          accountPage={session?.state === "active" && session.account !== undefined ? { values: session.account, duoKeys, onDuoSetup: session.duoState === "ready" ? duoReenrol.begin : undefined, details: request => profileClient.changeProfileDetails(request), readAccount: async () => sameSessionAccount(await profileClient.readProfileSession(), session), login: { changePassword: request => profileClient.changeProfilePassword(request), changeUsername: request => profileClient.changeProfileUsername(request), readUsername: async () => sameSessionAccount(await profileClient.readProfileSession(), session)?.username } } : undefined}
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
          sort={sort}
          onSort={setSort}
        /></DashboardPageBoundary></ViewNavigationProvider></StartupLoading>
      )}
    </ToastProvider>
    </TooltipProvider>
    </PreflightOcrContext.Provider>
    </ChatGptAccountContext.Provider>
    </div></PersonPreferencesContext.Provider>
  );
}



/** Boot is the one place a hard failure has nowhere else to go: without the boot
 * document the shell has no vocabulary to render. */
function BootFailure() {
  return (
    <main
      data-mock-ready="failed"
      className="flex min-h-screen items-center justify-center bg-[color:var(--ds-surface-page)] p-[var(--ds-space-loose)]"
    >
      <div className="w-full max-w-[560px]">
        <FailureNotice sentence="Couldn't start Relay."
          action={{ label: "Reload", onClick: () => window.location.reload() }} />
      </div>
    </main>
  );
}


