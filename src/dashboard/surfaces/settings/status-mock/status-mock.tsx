import { Check, ChevronDown, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { RunList, RunListRow } from "../../run-start/run-list.js";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, SearchInput, useToasts } from "../../../ds/ui.js";
import { DropdownMenuCheckboxItem, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "../../../ds/primitives/dropdown-menu.js";
import { DATASETS, initialSheets, missingRequired, samplesOf, withMapping, type Sheet, type Worksheet } from "../../spreadsheets/design/sheets-v2-model.js";
import { AccountSettings, type AccountValues } from "../account/account-settings.js";
import { SubscriptionSettings, type SubscriptionAccount, type SubscriptionPermissions } from "../subscription/subscription-settings.js";
import { AppLockup } from "../../shell/app-lockup.js";
import "../../shell/onboarding.css";
import { STATUS_MOCK_ACCOUNT, STATUS_MOCK_BLOCKERS, STATUS_MOCK_SUBSCRIPTION, STATUS_MOCK_REQUIRED_FIELDS, STATUS_MOCK_FIRST_RUN, STATUS_MOCK_TOASTS, statusMock, type StatusMockId } from "./status-mock-model.js";



const noop = () => undefined;

/** A readiness blocker at the top of the dialog: one row, reason on the left, its fix on the right. */
export function StatusMockReadiness({ frame }: { frame: "run-a" | "run-b" }) {
  return <RunList label="Before you start">{STATUS_MOCK_BLOCKERS[frame].map(blocker => <RunListRow key={blocker.id} title={blocker.title} description={blocker.note}><Button variant="secondary">{blocker.action}</Button></RunListRow>)}</RunList>;
}

/** The ticked worksheets (`<spreadsheet id>/<worksheet>`) and the library as the run dialog sees it, so a column chosen in a fix row reaches the workbook's other worksheets. */
export interface StatusMockPicks { readonly keys: readonly string[]; readonly sheets: readonly Sheet[] }

const sheetKey = (sheet: Sheet, worksheet: Worksheet) => `${sheet.id}/${worksheet.name}`;
const librarySheets = () => initialSheets("all").filter(sheet => !sheet.run).toSorted((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name));
const FRAME_PICKS: Readonly<Record<string, readonly string[]>> = {
  "run-sheets": ["hires/Aug 3 hires", "hires/Aug 10 hires"], "run-sheets-open": ["hires/Aug 3 hires", "hires/Aug 10 hires"],
  "run-sheets-fix": ["hires/Aug 3 hires", "hires/Aug 10 hires", "hires/Aug 17 hires"],
};
/** The worksheets a run starts with: the last ones used, or the frame's own. */
export function statusMockDefaultPicks(frame?: string): StatusMockPicks {
  return { keys: (frame && FRAME_PICKS[frame]) || ["roster/Roster", "i9/Sheet1"], sheets: librarySheets() };
}
const pickedRows = (picks: StatusMockPicks) => picks.sheets.flatMap(sheet => sheet.worksheets.filter(worksheet => picks.keys.includes(sheetKey(sheet, worksheet))).map(worksheet => ({ sheet, worksheet })));
/** Start waits until something is ticked and every ticked worksheet has Employee ID and Name. */
export const statusMockPicksBlocked = (picks: StatusMockPicks): boolean => picks.keys.length === 0 || pickedRows(picks).some(({ sheet, worksheet }) => missingRequired(sheet, worksheet).length > 0);
function pickedLabel(picks: StatusMockPicks): string {
  const rows = pickedRows(picks);
  if (rows.length === 0) return "Choose worksheets";
  if (rows.length === 1) return rows[0].worksheet.name;
  return new Set(rows.map(row => row.sheet.id)).size === 1 ? `${rows[0].sheet.name} · ${rows.length} worksheets` : `${rows.length} worksheets`;
}

/** The dialog's worksheet picker: one menu grouped by spreadsheet, a check per worksheet and its row count in grey. A ticked worksheet missing Employee ID or Name gets a row with a column picker; the choice saves to its mapping. Rows from every ticked worksheet are read, nothing is merged. */
export function StatusMockRosterPicker({ picks, onPicks }: { picks: StatusMockPicks; onPicks: (next: StatusMockPicks) => void }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const groups = picks.sheets.map(sheet => ({ sheet, worksheets: sheet.worksheets.filter(worksheet => `${sheet.name} ${worksheet.name}`.toLowerCase().includes(needle)) })).filter(group => group.worksheets.length > 0);
  const toggle = (key: string, on: boolean) => onPicks({ ...picks, keys: on ? [...picks.keys, key] : picks.keys.filter(item => item !== key) });
  const fixes = pickedRows(picks).flatMap(({ sheet, worksheet }) => missingRequired(sheet, worksheet).map(field => ({ sheet, worksheet, field })));
  return <RunList title="Reference spreadsheets" description={`Worksheets this run looks people up in. Needs ${STATUS_MOCK_REQUIRED_FIELDS.replace(", ", " and ")}.`}>
    <RunListRow title="Worksheets" description="Rows from every ticked worksheet are read.">
      <DropdownMenu onOpenChange={open => { if (open) setQuery(""); }}>
        <DropdownMenuTrigger asChild><Button variant="outline" aria-label={`Worksheets, ${pickedLabel(picks)}`} className="ds-menu-trigger w-[250px] min-w-0 justify-between" iconAfter={<ChevronDown aria-hidden />}><span className="min-w-0 truncate">{pickedLabel(picks)}</span></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[320px] max-h-[320px] overflow-y-auto">
          <div className="px-0.5 pb-1" onKeyDown={event => { if (event.key !== "Escape") event.stopPropagation(); }}><SearchInput variant="menu" aria-label="Find a worksheet" placeholder="Find a worksheet" value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery("")} /></div>
          {groups.length === 0 && <p className="m-0 px-2 py-2 text-[13px] text-ui-muted">No worksheets match.</p>}
          {groups.map(({ sheet, worksheets }) => <DropdownMenuGroup key={sheet.id}>
            <DropdownMenuLabel>{sheet.name}</DropdownMenuLabel>
            {worksheets.map(worksheet => <DropdownMenuCheckboxItem key={worksheet.name} checked={picks.keys.includes(sheetKey(sheet, worksheet))} onCheckedChange={on => toggle(sheetKey(sheet, worksheet), on)}>
              <span className="flex min-w-0 flex-1 items-baseline justify-between gap-4"><span className="truncate">{worksheet.name}</span><span className="text-[12px] text-ui-muted tabular-nums">{DATASETS[worksheet.data].rows.length} rows</span></span>
            </DropdownMenuCheckboxItem>)}
          </DropdownMenuGroup>)}
        </DropdownMenuContent>
      </DropdownMenu>
    </RunListRow>
    {fixes.map(({ sheet, worksheet, field }) => {
      const dataset = DATASETS[worksheet.data];
      return <RunListRow key={`${sheetKey(sheet, worksheet)}/${field.key}`} title={`${worksheet.name} · ${field.label}`}>
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" aria-label={`${worksheet.name} ${field.label} column`} className="ds-menu-trigger w-[170px] min-w-0 justify-between" iconAfter={<ChevronDown aria-hidden />}><span className="min-w-0 truncate">Choose column</span></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[320px]"><DropdownMenuGroup><DropdownMenuLabel>{field.label} column</DropdownMenuLabel>
            <DropdownMenuRadioGroup value="" onValueChange={header => onPicks({ ...picks, sheets: picks.sheets.map(item => item.id === sheet.id ? withMapping(item, worksheet.name, { [field.key]: header }) : item) })}>
              {dataset.headers.map(header => <DropdownMenuRadioItem key={header} value={header}><span className="flex min-w-0 flex-1 items-baseline justify-between gap-4"><span className="whitespace-nowrap">{header}</span><span className="truncate text-[12px] text-ui-muted">{samplesOf(dataset, header)}</span></span></DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup></DropdownMenuGroup>
          </DropdownMenuContent></DropdownMenu>
      </RunListRow>;
    })}
  </RunList>;
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
