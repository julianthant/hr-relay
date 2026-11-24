/** What every Settings story mounts: the real page on the in-page server, the command binding the app gives it, and the toasts
 * the app raises from its save callbacks. */
import { useMemo, type ReactNode } from "react";
import { DashboardClientProvider, DashboardCommandBindingProvider, useDashboardClient, useDashboardCommandExecutor } from "../../../../../../src/dashboard/state/client-context.js";
import { useToasts } from "../../../../../../src/dashboard/ds/ui.js";
import { AppearanceSettings } from "../../../../../../src/dashboard/surfaces/settings/general/appearance-settings.js";
import { ChatGptAccountContext, type ChatGptAccountPort, type ChatGptAccountSnapshot } from "../../../../../../src/dashboard/surfaces/settings/general/chatgpt-account-model.js";
import { DeleteAccountControl } from "../../../../../../src/dashboard/surfaces/settings/general/ui-settings-records-general-paths.js";
import type { DeleteAccountPresentation } from "../../../../../../src/dashboard/surfaces/settings/general/delete-account-model.js";
import { IsoInstantSchema } from "../../../../../../src/rules/identity/ids.js";
import type { AccountPage, AccountValues, ProfileDetailsChangeResult, ProfileLoginChangeResult } from "../../../../../../src/dashboard/surfaces/settings/account/account-settings.js";
import { FrontendBootstrapWireSchema } from "../../../../../../src/models/dashboard/bootstrap.js";
import { ActorIdSchema } from "../../../../../../src/rules/identity/ids.js";
import type { DashboardAuthority } from "../../../../../../src/dashboard/app/dashboard-app-model.js";
import { LOADING } from "../../../../../../src/dashboard/state/async-resource.js";
import bootstrapJson from "../../../../fixtures/dashboard/settings-story-bootstrap.json" with { type: "json" };
import { SettingsPage } from "../../../../../../src/dashboard/surfaces/settings/settings.js";
import type { SettingsStoryServer } from "../../../../fixtures/dashboard/settings-story-fixtures.js";
import { StoryFrame } from "./story-frame.js";
import type { RowStoreWriter } from "../../../../../../src/dashboard/client/index.js";

const noop = () => undefined;
const ACTOR = "local-operator";
const BOOTSTRAP = FrontendBootstrapWireSchema.parse(bootstrapJson);

/** The command binding `DashboardApp` gives the tree, on the same client; the day it holds never loads. */
function StoryCommandBinding({ children, rows }: { children: ReactNode; rows: RowStoreWriter }) {
  const client = useDashboardClient();
  const executor = useDashboardCommandExecutor();
  const binding = useMemo(() => {
    const epoch = Object.freeze({ client, bootstrap: BOOTSTRAP });
    const request = Object.freeze({ client, revision: 0 });
    const authority: DashboardAuthority = Object.freeze({ epoch, catalog: [], now: () => BOOTSTRAP.serverClock.now, today: "2026-08-03", day: "2026-08-03",
      dayState: { rows, request, day: LOADING, connection: { state: "connecting" as const }, subscribePublications: () => noop, refresh: noop },
      selection: { route: { start: false }, workflowId: "" } });
    return Object.freeze({ authority, executor, scope: Object.freeze({ actorId: ActorIdSchema.parse(ACTOR), client, authority: epoch, dayRequest: request }), feedback: noop });
  }, [client, executor, rows]);
  return <DashboardCommandBindingProvider binding={binding}>{children}</DashboardCommandBindingProvider>;
}

/** Raises the toasts `DashboardApp` raises from Settings' save callbacks. */
export function ToastProviderBridge({ children }: { children: (callbacks: { onSaved: NonNullable<Parameters<typeof SettingsPage>[0]["onSaved"]>; onSaveProblem: NonNullable<Parameters<typeof SettingsPage>[0]["onSaveProblem"]> }) => ReactNode }) {
  const { toast } = useToasts();
  return <>{children({ onSaved: notice => toast({ tone: "success", ...notice }), onSaveProblem: problem => toast(problem) })}</>;
}

/** A ChatGPT account port frozen on one snapshot; its actions answer at once and change nothing. */
export function chatGptPort(snapshot: ChatGptAccountSnapshot): ChatGptAccountPort {
  return { mode: "preview", getSnapshot: () => snapshot, subscribe: () => noop, signIn: () => Promise.resolve(), cancelSignIn: () => Promise.resolve(), signOut: () => Promise.resolve(undefined) };
}

const ACCOUNT = { name: "Jordan Lee", initials: "JL", timekeeper: "Jordan Lee", timekeeperInitials: "JL", lastSignedInAt: IsoInstantSchema.parse("2026-09-13T12:00:00.000Z") } satisfies AccountValues;

export interface AccountStub {
  /** What a name, initials or timekeeper edit comes back as. */
  readonly details?: ProfileDetailsChangeResult;
  readonly login?: ProfileLoginChangeResult;
  /** The Duo setup window could not be opened: the sentence Settings shows. */
  readonly duo?: string;
}

export function accountPageStub(stub: AccountStub = {}): AccountPage {
  const login = stub.login ?? { state: "changed" };
  return {
    values: ACCOUNT,
    details: () => Promise.resolve(stub.details ?? { state: "changed", account: ACCOUNT }),
    onDuoSetup: () => Promise.resolve(stub.duo),
    login: { changePassword: () => Promise.resolve(login), changeUsername: () => Promise.resolve(login), readUsername: () => Promise.resolve("jordan.lee@ucsd.edu") },
  };
}

export interface SettingsHostProps {
  readonly server: SettingsStoryServer;
  /** The `?settings=` token. */
  readonly section: string;
  readonly searchTarget?: string;
  readonly backToRun?: boolean;
  readonly account?: AccountStub;
  readonly chatGpt?: ChatGptAccountSnapshot;
  readonly deleteAccount?: DeleteAccountPresentation;
}

export function SettingsHost({ server, section, searchTarget, backToRun, account, chatGpt, deleteAccount }: SettingsHostProps) {
  const port = useMemo(() => chatGpt === undefined ? undefined : chatGptPort(chatGpt), [chatGpt]);
  const page = useMemo(() => accountPageStub(account), [account]);
  const settings = <ToastProviderBridge>{callbacks => <SettingsPage section={section} {...(searchTarget === undefined ? {} : { searchTarget })} {...(backToRun === undefined ? {} : { backToRun })}
    appearance={<AppearanceSettings theme="dark" onToggleTheme={noop} />} accountPage={page} deleteAccount={<DeleteAccountControl presentation={deleteAccount ?? { state: "unavailable" }} />}
    actorId={ACTOR} profileName="Jordan Lee" descriptorFingerprint={"d".repeat(64)} onSection={noop} onClose={noop} {...callbacks} />}</ToastProviderBridge>;
  return <StoryFrame><DashboardClientProvider client={server.client}><StoryCommandBinding rows={server.rows}>
    {port === undefined ? settings : <ChatGptAccountContext.Provider value={port}>{settings}</ChatGptAccountContext.Provider>}
  </StoryCommandBinding></DashboardClientProvider></StoryFrame>;
}
