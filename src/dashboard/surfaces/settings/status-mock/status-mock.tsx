import { Check, ChevronDown, LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { RunList, RunListRow } from "../../../ds/primitives/run-list.js";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuItemCopy, DropdownMenuTrigger, IconButton, Select, dsIcon, useToasts } from "../../../ds/ui.js";
import { DropdownMenuCheckboxItem, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "../../../ds/primitives/dropdown-menu.js";
import { DATASETS, missingRequired, samplesOf, withMapping, type Sheet, type Worksheet } from "./status-mock-sheets.js";
import { sheetKey, ticked, type StatusMockPicks } from "./status-mock-picks.js";
import { AccountSettings, type AccountValues } from "../account/account-settings.js";
import { SubscriptionSettings, type SubscriptionAccount } from "../subscription/subscription-settings.js";
import { AppLockup } from "../../shell/app-lockup.js";
import "../../shell/onboarding.css";
import { STATUS_MOCK_ACCOUNT, STATUS_MOCK_BLOCKERS, STATUS_MOCK_SUBSCRIPTION, STATUS_MOCK_REQUIRED_FIELDS, STATUS_MOCK_FIRST_RUN, STATUS_MOCK_TOASTS, statusMock, type StatusMockId } from "./status-mock-model.js";



const noop = () => undefined;

/** A readiness blocker at the top of the dialog: one row, reason on the left, its fix on the right. */
export function StatusMockReadiness({ frame }: { frame: "run-a" | "run-b" }) {
  return <RunList label="Before you start">{STATUS_MOCK_BLOCKERS[frame].map(blocker => <RunListRow key={blocker.id} title={blocker.title} description={blocker.note}><Button variant="secondary">{blocker.action}</Button></RunListRow>)}</RunList>;
}

const currentVersion = (sheet: Sheet) => sheet.versions[0].n;
const worksheetsLabel = (worksheets: readonly Worksheet[]) => worksheets.length === 1 ? worksheets[0].name : `${worksheets.length} worksheets`;
/** A spreadsheet whose worksheets all lack Employee ID or Name cannot be added. */
const uncoverable = (sheet: Sheet) => sheet.worksheets.every(worksheet => missingRequired(sheet, worksheet).length > 0);

/** The dialog's spreadsheet picker: each picked spreadsheet is a row with its worksheet picker, version picker and a remove ×; an Add dropdown with search lists the rest (Pinned first, then A-Z), greyed with the reason when one cannot cover Employee ID and Name. A ticked worksheet missing Employee ID or Name gets a row under its spreadsheet with a column picker; the choice saves to its mapping. Rows from every ticked worksheet are read, nothing is merged. */
export function StatusMockRosterPicker({ picks, onPicks }: { picks: StatusMockPicks; onPicks: (next: StatusMockPicks) => void }) {
  const [query, setQuery] = useState("");
  const picked = picks.sheets.filter(sheet => ticked(picks, sheet).length > 0);
  const needle = query.trim().toLowerCase();
  const unpicked = picks.sheets.filter(sheet => ticked(picks, sheet).length === 0);
  /** An empty search lists the pinned spreadsheets; typing searches all of them by spreadsheet and worksheet name, A-Z. */
  const available = needle === "" ? unpicked.filter(sheet => sheet.pinned)
    : unpicked.filter(sheet => [sheet.name, ...sheet.worksheets.map(worksheet => worksheet.name)].some(name => name.toLowerCase().includes(needle))).toSorted((a, b) => a.name.localeCompare(b.name));
  const setKeys = (keys: readonly string[]) => onPicks({ ...picks, keys });
  const add = (sheet: Sheet) => setKeys([...picks.keys, sheetKey(sheet, sheet.worksheets.find(worksheet => missingRequired(sheet, worksheet).length === 0) ?? sheet.worksheets[0])]);
  const remove = (sheet: Sheet) => setKeys(picks.keys.filter(key => !key.startsWith(`${sheet.id}/`)));
  const toggle = (sheet: Sheet, worksheet: Worksheet, on: boolean) => {
    const key = sheetKey(sheet, worksheet);
    if (on) setKeys([...picks.keys, key]);
    else if (ticked(picks, sheet).length > 1) setKeys(picks.keys.filter(item => item !== key));
  };
  return <div className="flex min-w-0 flex-col gap-3">
    <RunList title="Reference spreadsheets" description={`Spreadsheets this run looks people up in. Needs ${STATUS_MOCK_REQUIRED_FIELDS.replace(", ", " and ")}.`}>
      {picked.flatMap(sheet => {
        const worksheets = ticked(picks, sheet);
        return [
          <RunListRow key={sheet.id} title={sheet.name} description={worksheets.map(worksheet => worksheet.name).join(", ")}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline" aria-label={`${sheet.name} worksheets, ${worksheetsLabel(worksheets)}`} className="ds-menu-trigger w-[150px] min-w-0 justify-between" iconAfter={<ChevronDown aria-hidden />}><span className="min-w-0 truncate">{worksheetsLabel(worksheets)}</span></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[280px] max-h-[320px] overflow-y-auto"><DropdownMenuGroup>
                <DropdownMenuLabel>{sheet.name}</DropdownMenuLabel>
                {sheet.worksheets.map(worksheet => <DropdownMenuCheckboxItem key={worksheet.name} checked={picks.keys.includes(sheetKey(sheet, worksheet))} onCheckedChange={on => toggle(sheet, worksheet, on)}>
                  <span className="flex min-w-0 flex-1 items-baseline justify-between gap-4"><span className="truncate">{worksheet.name}</span><span className="text-[12px] text-ui-muted tabular-nums">{DATASETS[worksheet.data].rows.length} rows</span></span>
                </DropdownMenuCheckboxItem>)}
              </DropdownMenuGroup></DropdownMenuContent>
            </DropdownMenu>
            <Select aria-label={`${sheet.name} version`} variant="toolbar" className="w-[76px]" value={String(picks.versions[sheet.id] ?? currentVersion(sheet))} onChange={event => onPicks({ ...picks, versions: { ...picks.versions, [sheet.id]: Number(event.target.value) } })}>
              {sheet.versions.map(version => <option key={version.n} value={version.n}>v{version.n}</option>)}
            </Select>
            <IconButton size="xs" label={`Remove ${sheet.name}`} icon={<X aria-hidden className={dsIcon.md} />} onClick={() => remove(sheet)} />
          </RunListRow>,
          ...worksheets.flatMap(worksheet => missingRequired(sheet, worksheet).map(field => {
            const dataset = DATASETS[worksheet.data];
            return <RunListRow key={`${sheetKey(sheet, worksheet)}/${field.key}`} title={`${worksheet.name} · ${field.label}`}>
              <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" aria-label={`${worksheet.name} ${field.label} column`} className="ds-menu-trigger w-[170px] min-w-0 justify-between" iconAfter={<ChevronDown aria-hidden />}><span className="min-w-0 truncate">Choose column</span></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[320px]"><DropdownMenuGroup><DropdownMenuLabel>{field.label} column</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value="" onValueChange={header => onPicks({ ...picks, sheets: picks.sheets.map(item => item.id === sheet.id ? withMapping(item, worksheet.name, { [field.key]: header }) : item) })}>
                    {dataset.headers.map(header => <DropdownMenuRadioItem key={header} value={header}><span className="flex min-w-0 flex-1 items-baseline justify-between gap-4"><span className="whitespace-nowrap">{header}</span><span className="truncate text-[12px] text-ui-muted">{samplesOf(dataset, header)}</span></span></DropdownMenuRadioItem>)}
                  </DropdownMenuRadioGroup></DropdownMenuGroup>
                </DropdownMenuContent></DropdownMenu>
            </RunListRow>;
          })),
        ];
      })}
    </RunList>
    <div><DropdownMenu onOpenChange={open => { if (open) setQuery(""); }}>
      <DropdownMenuTrigger asChild><Button variant="outline" className="ds-menu-trigger" iconAfter={<ChevronDown aria-hidden />}>Add spreadsheet</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[320px] max-h-[320px] overflow-y-auto">
        <div className="ds-menu-search-row" onKeyDown={event => { if (event.key !== "Escape") event.stopPropagation(); }}>
          <Search aria-hidden /><input aria-label="Find a spreadsheet" placeholder="Find a spreadsheet" value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" spellCheck={false} />
        </div>
        {needle === "" && available.length > 0 && <DropdownMenuGroup><DropdownMenuLabel>Pinned</DropdownMenuLabel></DropdownMenuGroup>}
        {available.length === 0 && <p className="m-0 px-2 py-2 text-[13px] leading-[18px] text-ui-muted">{needle === "" ? "Pin spreadsheets in Spreadsheets to list them here. Search finds the rest." : "No spreadsheets match."}</p>}
        {available.map(sheet => <DropdownMenuItem key={sheet.id} disabled={uncoverable(sheet)} onClick={() => add(sheet)}>
          <DropdownMenuItemCopy title={sheet.name} description={uncoverable(sheet) ? `No worksheet has ${STATUS_MOCK_REQUIRED_FIELDS.replace(", ", " and ")}` : sheet.worksheets.map(worksheet => worksheet.name).join(", ")} />
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
  return <SubscriptionSettings account={account}
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
