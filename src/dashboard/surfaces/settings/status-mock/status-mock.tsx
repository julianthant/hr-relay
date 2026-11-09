import { Check, ChevronDown, LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { RunList, RunListRow } from "../../run-start/run-list.js";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuItemCopy, DropdownMenuTrigger, IconButton, SearchInput, Select, dsIcon, useToasts } from "../../../ds/ui.js";
import { AccountSettings, type AccountValues } from "../account/account-settings.js";
import { SubscriptionSettings, type SubscriptionAccount, type SubscriptionPermissions } from "../subscription/subscription-settings.js";
import { AppLockup } from "../../shell/app-lockup.js";
import "../../shell/onboarding.css";
import { STATUS_MOCK_ACCOUNT, STATUS_MOCK_BLOCKERS, STATUS_MOCK_SUBSCRIPTION, STATUS_MOCK_REQUIRED_FIELDS, STATUS_MOCK_SPREADSHEETS, STATUS_MOCK_FIRST_RUN, STATUS_MOCK_TOASTS, statusMock, type StatusMockId } from "./status-mock-model.js";



const noop = () => undefined;

/** A readiness blocker at the top of the dialog: one row, reason on the left, its fix on the right. */
export function StatusMockReadiness({ frame }: { frame: "run-a" | "run-b" }) {
  return <RunList label="Before you start">{STATUS_MOCK_BLOCKERS[frame].map(blocker => <RunListRow key={blocker.id} title={blocker.title} description={blocker.note}><Button variant="secondary">{blocker.action}</Button></RunListRow>)}</RunList>;
}

/** Picked spreadsheet value -> version number. */
export type StatusMockPicks = Readonly<Record<string, number>>;

/** The dialog's spreadsheet picker: picked ones are rows with a version picker and a remove ×; an Add dropdown with search lists the rest (Pinned first, then A-Z). One lacking a needed column is greyed out with the reason. */
export function StatusMockRosterPicker({ picks, onPicks }: { picks: StatusMockPicks; onPicks: (next: StatusMockPicks) => void }) {
  const [query, setQuery] = useState("");
  const picked = STATUS_MOCK_SPREADSHEETS.filter(sheet => picks[sheet.value] !== undefined);
  const needle = query.trim().toLowerCase();
  const available = STATUS_MOCK_SPREADSHEETS.filter(sheet => picks[sheet.value] === undefined && sheet.label.toLowerCase().includes(needle))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.label.localeCompare(b.label));
  return <div className="flex min-w-0 flex-col gap-3">
    <RunList title="Reference spreadsheets" description={`Spreadsheets this run looks people up in. Needs ${STATUS_MOCK_REQUIRED_FIELDS.replace(", ", " and ")}.`}>
      {picked.map(sheet => <RunListRow key={sheet.value} title={sheet.label} description={sheet.description}>
        <Select aria-label={`${sheet.label} version`} variant="toolbar" className="w-[76px]" value={String(picks[sheet.value])} onChange={event => onPicks({ ...picks, [sheet.value]: Number(event.target.value) })}>
          {Array.from({ length: sheet.current }, (_, index) => sheet.current - index).map(number => <option key={number} value={number}>v{number}</option>)}
        </Select>
        <IconButton size="xs" label={`Remove ${sheet.label}`} icon={<X aria-hidden className={dsIcon.md} />} onClick={() => onPicks(Object.fromEntries(Object.entries(picks).filter(([key]) => key !== sheet.value)))} />
      </RunListRow>)}
    </RunList>
    <div><DropdownMenu onOpenChange={open => { if (open) setQuery(""); }}>
      <DropdownMenuTrigger asChild><Button variant="outline" className="ds-menu-trigger" iconAfter={<ChevronDown aria-hidden />}>Add spreadsheet</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[320px]">
        <div className="px-0.5 pb-1" onKeyDown={event => { if (event.key !== "Escape") event.stopPropagation(); }}><SearchInput variant="menu" aria-label="Find a spreadsheet" placeholder="Find a spreadsheet" value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery("")} /></div>
        {available.length === 0 && <p className="m-0 px-2 py-2 text-[13px] text-ui-muted">{picked.length === STATUS_MOCK_SPREADSHEETS.length ? "Every spreadsheet is added." : "No spreadsheets match."}</p>}
        {available.map(sheet => <DropdownMenuItem key={sheet.value} disabled={"disabled" in sheet} onClick={() => onPicks({ ...picks, [sheet.value]: sheet.current })} >
          <DropdownMenuItemCopy title={sheet.label} description={sheet.description} />
        </DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu></div>
  </div>;
}

/** Live problems arrive as sticky toasts: a title and one line that names where to act. */
function ToastsMock({ set }: { set: keyof typeof STATUS_MOCK_TOASTS }) {
  const { toast, dismiss } = useToasts();
  useEffect(() => {
    // After first paint, so the app's own mount-time notices cannot clear these.
    const ids: string[] = [];
    const timer = window.setTimeout(() => { ids.push(...STATUS_MOCK_TOASTS[set].map(item => toast({ ...item, sticky: true }))); }, 600);
    return () => { window.clearTimeout(timer); ids.forEach(dismiss); };
  }, [toast, dismiss, set]);
  return null;
}

/** Hands the live toast function to the page so a browser session can fire real toasts one after another. */
function ToastsLiveMock() {
  const { toast } = useToasts();
  useEffect(() => { Reflect.set(window, "relayFireToast", toast); return () => { Reflect.deleteProperty(window, "relayFireToast"); }; }, [toast]);
  return null;
}

/** The Account page on fixtures: every frame starts from its own state, and edits stay local. */
export function StatusMockAccount({ frame }: { frame: StatusMockId }) {
  const [values, setValues] = useState<AccountValues>(STATUS_MOCK_ACCOUNT.values);
  const [duo, setDuo] = useState<"ready" | "setup">(frame === "account-duo-setup" ? "setup" : "ready");
  return <AccountSettings values={values} duo={duo}
    initialEdit={frame === "account-edit" ? "name" : frame === "account-password" ? "relayPassword" : undefined} initialConfirmDelete={frame === "account-delete"}
    onSave={(field, value) => { if (field !== "ucpathPassword") setValues(current => ({ ...current, [field]: value })); }}
    onPasswordChange={noop} onDuoSetup={() => setDuo("ready")} onSignOut={noop} onDelete={noop} />;
}

/** The Subscription page on fixtures; the frame picks a connected plan, one whose 5-hour limit has run out, or a disconnected ChatGPT. */
export function StatusMockSubscription({ frame }: { frame: StatusMockId }) {
  const connected = (limits: typeof STATUS_MOCK_SUBSCRIPTION.limits | typeof STATUS_MOCK_SUBSCRIPTION.limitReached): SubscriptionAccount => ({ state: "connected", email: STATUS_MOCK_ACCOUNT.email, plan: STATUS_MOCK_SUBSCRIPTION.plan, limits });
  const [account, setAccount] = useState<SubscriptionAccount>(frame === "subscription-disconnected" ? { state: "disconnected" } : connected(frame === "subscription-limit" ? STATUS_MOCK_SUBSCRIPTION.limitReached : STATUS_MOCK_SUBSCRIPTION.limits));
  const [permissions, setPermissions] = useState<SubscriptionPermissions>({ defaultPermissions: true, fullAccess: false });
  return <SubscriptionSettings account={account} permissions={permissions} onPermissions={setPermissions}
    onConnect={() => setAccount(connected(STATUS_MOCK_SUBSCRIPTION.limits))} onDisconnect={() => setAccount({ state: "disconnected" })} />;
}

/** Sign-up frames: the first-run check, as the Ready step (A) or its own step before Ready (B). */
function SignupCheckMock({ variant }: { variant: "a" | "b" }) {
  const steps = variant === "b" ? ["Your details", "Duo setup", "Check", "Ready"] : ["Your details", "Duo setup", "Ready"];
  const current = 2;
  return <div className="hub-onboarding"><div className="brand"><AppLockup /></div><main><div className="auth-layout">
    <ol className="progress" aria-label="Profile setup progress">{steps.map((label, index) => <li key={label} aria-current={index === current ? "step" : undefined} data-complete={index < current}><span className="step-link"><span className="progress-marker" aria-hidden="true">{index < current ? <Check className="icon" /> : index + 1}</span>{label}</span></li>)}</ol>
    <div className="stack"><header className="heading"><h1>{variant === "b" ? "Checking your computer" : "You’re all set"}</h1><p>{variant === "b" ? "Relay is making sure everything is ready." : "Your profile and sign-in methods are ready. One last check is running."}</p></header>
      <ul className="ready-list">{STATUS_MOCK_FIRST_RUN.map(item => <li key={item.id}>{item.state === "ok" ? <Check className="icon" /> : <LoaderCircle aria-hidden className="icon animate-spin motion-reduce:animate-none" />}{item.label}</li>)}</ul>
      <button className="btn primary" type="button" disabled>{variant === "b" ? "Continue" : "Go to dashboard"}</button>
    </div></div></main></div>;
}

/** Mounted once under the toast provider; draws the dialog, toast and sign-up frames. */
export function StatusMockHost() {
  const id: StatusMockId | undefined = statusMock();
  if (id === "toasts" || id === "toasts-open" || id === "toasts-storage" || id === "toasts-restored") return <ToastsMock set={id} />;
  if (id === "toasts-live") return <ToastsLiveMock />;
  if (id === "signup-a" || id === "signup-b") return <div className="fixed inset-0 z-50 bg-[color:var(--ds-surface-page)]"><SignupCheckMock variant={id === "signup-a" ? "a" : "b"} /></div>;
  return null;
}
