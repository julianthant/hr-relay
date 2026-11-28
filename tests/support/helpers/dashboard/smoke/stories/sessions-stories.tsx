/** Sessions stories: the real Sessions bar and its worker cards on fixture workers, one story per worker state, browser state, bar state and command operation. */
import { useEffect, useState } from "react";
import { useToasts } from "../../../../../../src/dashboard/ds/ui.js";
import { AddWorkers } from "../../../../../../src/dashboard/surfaces/sessions/add-workers.js";
import { ConsoleToggle } from "../../../../../../src/dashboard/surfaces/sessions/session-rail-controls.js";
import { SessionsView } from "../../../../../../src/dashboard/surfaces/sessions/sessions-view.js";
import { ERROR_CATALOG } from "../../../../../../src/models/failures/error-catalog.js";
import type { SessionBrowserState, SessionWorker, SessionWorkerState, SessionsViewState } from "../../../../../../src/dashboard/surfaces/sessions/sessions-view-model.js";
import type { SessionPreviewOperation } from "../../../../../../src/dashboard/surfaces/sessions/session-preview-command-model.js";
import {
  QUIET_IDLE, SESSION_OPERATION_BY_STATE, SESSION_STORY_WORKFLOWS, SESSION_WORKER_BY_STATE, WIDE_WORKER, workerWithBrowser,
} from "../../../../fixtures/dashboard/sessions-notifications-story-fixtures.js";
import { defineSurface, type Story } from "../story-catalogue.js";
import { StoryFrame } from "./story-frame.js";

const noop = () => undefined;
const BODY = '[role="region"][aria-label="Sessions"]';

interface BarOptions { readonly open?: boolean; readonly operations?: Readonly<Record<string, SessionPreviewOperation>>; readonly theme?: "dark" | "light" }
const bar = (title: string, data: SessionsViewState, { open = true, operations, theme = "dark" }: BarOptions = {}, extra: Partial<Story> = {}): Story => ({ title,
  ready: open ? BODY : '[aria-label="Session Panel"]',
  render: () => <StoryFrame theme={theme}><SessionsView data={data} open={open} onOpenChange={noop} onControl={noop} workflows={SESSION_STORY_WORKFLOWS}
    {...(operations === undefined ? {} : { operations })} /></StoryFrame>, ...extra });
/** Raises one result toast once the story has mounted, as the app does after a command settles. */
const TOAST_TITLES = ["Workers added", "Worker removed", "Idle sessions refreshed"] as const;
const TOAST_LINES = {
  title: [],
  described: ["Two workers are starting.", "Morrow, Bea · back to idle.", "Every idle session was checked."],
  wrapped: ["Two workers are starting on this machine and will show as idle once they are ready to take runs.", "Morrow, Bea · the worker finished its last run and was removed from this machine's sessions.", "Every idle session was checked against the server and the ones that stopped answering were refreshed."],
} as const satisfies Record<string, readonly string[]>;
type ToastLines = keyof typeof TOAST_LINES;
function RaiseToast({ count, lines = "title" }: { count: number; lines?: ToastLines }) {
  const { toast } = useToasts();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => { if (mounted) TOAST_TITLES.slice(0, count).forEach((title, index) => { const description: string | undefined = TOAST_LINES[lines][index]; toast({ tone: "success", title, ...(description === undefined ? {} : { description }) }); }); }, [mounted, count, lines, toast]);
  return null;
}
/** The approved design's own toast: an error in front of two results, title and one short line. */
function RaiseErrorStack() {
  const { toast } = useToasts();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!mounted) return;
    toast({ tone: "success", title: "Workers added" });
    toast({ tone: "success", title: "Worker removed" });
    toast({ tone: "danger", title: "Cancel run: rejected", description: "Morrow, Bea · The run already finished." });
  }, [mounted, toast]);
  return null;
}
const errorStack = (theme: "dark" | "light"): Story => ({ title: `An error toast in front of two results, ${theme}`, ready: '[data-slot="toast-description"]', play: page => page.waitForTimeout(600),
  render: () => <StoryFrame theme={theme}><RaiseErrorStack /><SessionsView data={ready(SESSION_WORKER_BY_STATE.running, SESSION_WORKER_BY_STATE.idle)} open={false} onOpenChange={noop} onControl={noop} workflows={SESSION_STORY_WORKFLOWS} /></StoryFrame> });
const withToast = (title: string, data: SessionsViewState, open = true, count = 1, play?: Story["play"], lines: ToastLines = "title"): Story => {
  const base = bar(title, data, { open });
  return { ...base, ready: '[data-ds-toast-state]', ...(play === undefined ? {} : { play }), render: () => <StoryFrame><RaiseToast count={count} lines={lines} /><SessionsView data={data} open={open} onOpenChange={noop} onControl={noop} workflows={SESSION_STORY_WORKFLOWS} /></StoryFrame> };
};
const ready = (...workers: readonly SessionWorker[]): SessionsViewState => ({ state: "ready", workers });

const worker = (title: string, state: SessionWorkerState): Story => bar(title, ready(SESSION_WORKER_BY_STATE[state]));
const WORKER = {
  running: worker("A worker running a step, Pause and Stop offered", "running"), starting: worker("A worker opening its browsers, Stop offered", "starting"),
  idle: worker("A worker with nothing to do, a card with Remove", "idle"), waiting: worker("A worker waiting on a sign-in, Stop offered", "waiting"),
  paused: worker("A paused worker, Resume and Stop offered", "paused"), stopped: worker("A worker the operator stopped, Retry offered", "stopped"),
  failed: worker("A worker that failed, Retry offered", "failed"), unavailable: worker("A worker Relay cannot read, no actions", "unavailable"),
} satisfies Record<SessionWorkerState, Story>;

const browser = (title: string, state: SessionBrowserState): Story => bar(title, ready(workerWithBrowser(state)));
const BROWSER = {
  ready: browser("A browser signed in and idle", "ready"), active: browser("A browser in use by the step", "active"), starting: browser("A browser opening", "starting"),
  unopened: browser("A browser the worker has not opened", "unopened"), closed: browser("A browser that was closed", "closed"),
  unavailable: { ...browser("A browser Relay cannot read, with its reason", "unavailable") }, failed: browser("A browser whose sign-in failed", "failed"),
  "needs-duo": browser("A browser waiting on Duo", "needs-duo"), "signed-out": browser("A browser signed out", "signed-out"),
} satisfies Record<SessionBrowserState, Story>;

const BAR = {
  ready: bar("The bar open on a running worker", ready(SESSION_WORKER_BY_STATE.running)),
  loading: bar("The bar while sessions load", { state: "loading" }, {}, { slowFetch: { region: '[aria-label="Loading sessions"]' } }),
  unavailable: bar("The bar when sessions cannot be read", { state: "unavailable", reason: "Session information is unavailable." }, {}, { ready: '[role="alert"]' }),
} satisfies Record<SessionsViewState["state"], Story>;

const OPERATION = {
  pending: bar("A control sent and not yet answered, the card locked", ready(SESSION_WORKER_BY_STATE.running), { operations: { [SESSION_WORKER_BY_STATE.running.id]: SESSION_OPERATION_BY_STATE.pending } }),
  confirmed: bar("A control Relay confirmed", ready(SESSION_WORKER_BY_STATE.running), { operations: { [SESSION_WORKER_BY_STATE.running.id]: SESSION_OPERATION_BY_STATE.confirmed } }),
  refused: bar("A control Relay refused", ready(SESSION_WORKER_BY_STATE.running), { operations: { [SESSION_WORKER_BY_STATE.running.id]: SESSION_OPERATION_BY_STATE.refused } }),
} satisfies Record<SessionPreviewOperation["state"], Story>;

const ADDING: Readonly<Record<string, SessionPreviewOperation>> = { add: { request: { id: "add-1", target: "add", action: "add", workflow: "separations", count: 1, ordinal: 1 }, state: "pending", message: "Adding workers…" } };

const DUO_SETUP_REFUSED: SessionWorker = { ...SESSION_WORKER_BY_STATE.idle, state: "failed", action: "Worker setup stopped.",
  elapsed: "0s", browsers: [], browsersNote: ERROR_CATALOG.DUO_READY_CREDENTIAL_REQUIRED.text };

/** The combinations a person meets: a closed bar, an empty pool, a mixed pool, a stale day, a wide card and the Add workers dialog. */
const COMBINATION = {
  closed: bar("The bar collapsed, counts only", ready(SESSION_WORKER_BY_STATE.running, SESSION_WORKER_BY_STATE.idle), { open: false }),
  "running-and-idle": bar("A running worker beside an idle one", ready(SESSION_WORKER_BY_STATE.running, SESSION_WORKER_BY_STATE.idle)),
  empty: bar("No workers yet", ready(), {}, { ready: 'text="No workers yet"' }),
  attention: bar("Waiting, paused and failed workers side by side", ready(SESSION_WORKER_BY_STATE.waiting, SESSION_WORKER_BY_STATE.paused, SESSION_WORKER_BY_STATE.failed)),
  mixed: bar("Cards for busy and idle workers", ready(SESSION_WORKER_BY_STATE.running, SESSION_WORKER_BY_STATE.starting, ...QUIET_IDLE)),
  "all-states": bar("One worker in every state", ready(...Object.values(SESSION_WORKER_BY_STATE))),
  "one-row-light": bar("Five workers in one row, the next card peeking, light", ready(SESSION_WORKER_BY_STATE.running, SESSION_WORKER_BY_STATE.starting, ...QUIET_IDLE), { theme: "light" }),
  "duo-setup-refused": bar("A worker stopped during Duo setup", ready(DUO_SETUP_REFUSED), { theme: "light" }, { ready: 'text="Duo isn\'t set up. Set it up in Settings."' }),
  stale: bar("Counts held from the last day while the next loads, controls locked", { state: "ready", workers: [SESSION_WORKER_BY_STATE.running, SESSION_WORKER_BY_STATE.failed], stale: true }, {}, { ready: '[data-sessions-stale] [role="status"]' }),
  wide: bar("A worker with five systems, a wide card with nicknames", ready(WIDE_WORKER)),
  "adding-empty": bar("A worker being added to an empty panel, shown as a Starting card", ready(), { operations: ADDING }, { ready: "li[aria-busy]" }),
  adding: bar("A worker being added, its Starting card before an idle card", ready(QUIET_IDLE[0]), { operations: ADDING }, { ready: "li[aria-busy]" }),
  removing: bar("An idle card being removed, the status reads Removing", ready(QUIET_IDLE[0]), { operations: { [(QUIET_IDLE[0]).id]: { request: { id: "remove-1", target: (QUIET_IDLE[0]).id, action: "remove" }, state: "pending", message: "Remove requested…" } } }, { ready: 'text="Removing"' }),
  "add-workers": { title: "The Add workers dialog, opened from the sidebar footer", ready: '[role="dialog"]',
    render: () => <StoryFrame><AddWorkers data={ready(SESSION_WORKER_BY_STATE.running)} workflows={SESSION_STORY_WORKFLOWS} onAdd={noop} onAdded={noop} /></StoryFrame>,
    play: async page => { await page.getByRole("button", { name: "Add workers", exact: true }).click(); } },
  "add-workers-set": { title: "The Add workers dialog with a second workflow and three workers set", ready: '[role="dialog"]',
    render: () => <StoryFrame><AddWorkers data={ready(SESSION_WORKER_BY_STATE.running)} workflows={SESSION_STORY_WORKFLOWS} onAdd={noop} onAdded={noop} /></StoryFrame>,
    play: async page => {
      await page.getByRole("button", { name: "Add workers", exact: true }).click();
      await page.getByRole("combobox", { name: "Workflow" }).click();
      await page.getByRole("option", { name: /^Person Lookup/ }).click();
      await page.getByRole("spinbutton", { name: "Workers" }).fill("3");
    } },
} satisfies Record<string, Story>;

/** The sidebar icon: each dot, and pressed while the console is open. With the panel closed it is all that shows. */
const icon = (title: string, data: SessionsViewState, open = false): Story => ({ title, ready: 'button[aria-label="Sessions console"]',
  render: () => <StoryFrame><div className="flex"><ConsoleToggle data={data} open={open} onOpenChange={noop} /></div></StoryFrame> });
const ICON = {
  "no-workers": icon("Panel closed, no workers: no dot", ready()),
  idle: icon("Panel closed, idle workers: green dot", ready(SESSION_WORKER_BY_STATE.idle)),
  running: icon("Panel closed, a running worker: blue dot", ready(SESSION_WORKER_BY_STATE.running, SESSION_WORKER_BY_STATE.idle)),
  open: icon("Panel open: the icon is pressed", ready(SESSION_WORKER_BY_STATE.idle), true),
} satisfies Record<string, Story>;

/** Toasts sit top centre at every panel height: collapsed, empty, one row and several. */
const TOAST = {
  collapsed: withToast("A result toast over the collapsed bar", ready(SESSION_WORKER_BY_STATE.running, SESSION_WORKER_BY_STATE.idle), false),
  empty: withToast("A result toast over the empty panel", ready()),
  "one-row": withToast("A result toast over one idle card", ready(QUIET_IDLE[0])),
  several: withToast("A result toast over several cards", ready(SESSION_WORKER_BY_STATE.running, SESSION_WORKER_BY_STATE.starting, ...QUIET_IDLE)),
  stack: withToast("Three toasts stacked at rest over the open panel", ready(SESSION_WORKER_BY_STATE.running, ...QUIET_IDLE), true, 3, page => page.waitForTimeout(600)),
  "stack-described": withToast("Three toasts with a title and one line, stacked over the open panel", ready(SESSION_WORKER_BY_STATE.failed, SESSION_WORKER_BY_STATE.running, ...QUIET_IDLE), true, 3, page => page.waitForTimeout(600), "described"),
  "stack-wrapped": withToast("Three toasts whose line wraps, stacked over the open panel", ready(SESSION_WORKER_BY_STATE.failed, SESSION_WORKER_BY_STATE.running, ...QUIET_IDLE), true, 3, page => page.waitForTimeout(600), "wrapped"),
  "stack-hover": withToast("Three toasts expanded on hover, clear of the panel", ready(SESSION_WORKER_BY_STATE.running, ...QUIET_IDLE), true, 3,
    async page => { await page.locator('[data-slot="toast"]').first().hover(); await page.waitForTimeout(600); }),
  "error-stack": errorStack("dark"),
  "error-stack-light": errorStack("light"),
  "stack-collapsed": withToast("Three toasts stacked over the collapsed bar", ready(SESSION_WORKER_BY_STATE.running, ...QUIET_IDLE), false, 3, page => page.waitForTimeout(600)),
} satisfies Record<string, Story>;

export const SESSIONS_STORIES = defineSurface("sessions", { worker: WORKER, browser: BROWSER, bar: BAR, operation: OPERATION, combination: COMBINATION, icon: ICON, toast: TOAST });
