/** Sessions stories: the real Sessions bar and its worker cards on fixture workers, one story per worker state, browser state, bar state and command operation. */
import { useEffect, useState } from "react";
import { useToasts } from "../../../../../../src/dashboard/ds/ui.js";
import { SessionsView } from "../../../../../../src/dashboard/surfaces/sessions/sessions-view.js";
import type { SessionBrowserState, SessionWorker, SessionWorkerState, SessionsViewState } from "../../../../../../src/dashboard/surfaces/sessions/sessions-view-model.js";
import type { SessionPreviewOperation } from "../../../../../../src/dashboard/surfaces/sessions/session-preview-command-model.js";
import {
  QUIET_IDLE, SESSION_OPERATION_BY_STATE, SESSION_STORY_WORKFLOWS, SESSION_WORKER_BY_STATE, WIDE_WORKER, workerWithBrowser,
} from "../../../../fixtures/dashboard/sessions-notifications-story-fixtures.js";
import { defineSurface, type Story } from "../story-catalogue.js";
import { StoryFrame } from "./story-frame.js";

const noop = () => undefined;
const BODY = '[role="region"][aria-label="Sessions"]';

interface BarOptions { readonly open?: boolean; readonly operations?: Readonly<Record<string, SessionPreviewOperation>> }
const bar = (title: string, data: SessionsViewState, { open = true, operations }: BarOptions = {}, extra: Partial<Story> = {}): Story => ({ title,
  ready: open ? BODY : '[aria-label="Session Panel"]',
  render: () => <StoryFrame><SessionsView data={data} open={open} onOpenChange={noop} onControl={noop} onAdd={noop} workflows={SESSION_STORY_WORKFLOWS}
    {...(operations === undefined ? {} : { operations })} account={{ onSettings: noop, onLogout: noop }} /></StoryFrame>, ...extra });
/** Raises one result toast once the story has mounted, as the app does after a command settles. */
function RaiseToast() {
  const { toast } = useToasts();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => { if (mounted) toast({ tone: "success", title: "Workers added" }); }, [mounted, toast]);
  return null;
}
const withToast = (title: string, data: SessionsViewState, open = true): Story => {
  const base = bar(title, data, { open });
  return { ...base, ready: '[data-ds-toast-state]', render: () => <StoryFrame><RaiseToast /><SessionsView data={data} open={open} onOpenChange={noop} onControl={noop} onAdd={noop} workflows={SESSION_STORY_WORKFLOWS} account={{ onSettings: noop, onLogout: noop }} /></StoryFrame> };
};
const ready = (...workers: readonly SessionWorker[]): SessionsViewState => ({ state: "ready", workers });

const worker = (title: string, state: SessionWorkerState): Story => bar(title, ready(SESSION_WORKER_BY_STATE[state]));
const WORKER = {
  running: worker("A worker running a step, Pause and Stop offered", "running"), starting: worker("A worker opening its browsers, Stop offered", "starting"),
  idle: worker("A worker with nothing to do, a row with Remove", "idle"), waiting: worker("A worker waiting on a sign-in, Stop offered", "waiting"),
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

/** Add workers stays switched off for the moment its request is in flight. */
const ADD_LOCKED = { "no-dead-disabled-control": "#754" } as const;
const ADDING: Readonly<Record<string, SessionPreviewOperation>> = { add: { request: { id: "add-1", target: "add", action: "add", workflow: "separations", count: 1, ordinal: 1 }, state: "pending", message: "Adding workers…" } };

/** The combinations a person meets: a closed bar, an empty pool, a mixed pool, a stale day, a wide card and the Add workers dialog. */
const COMBINATION = {
  closed: bar("The bar collapsed, counts only", ready(SESSION_WORKER_BY_STATE.running, SESSION_WORKER_BY_STATE.idle), { open: false }),
  empty: bar("No workers yet", ready(), {}, { ready: 'text="No workers yet"' }),
  attention: bar("Waiting, paused and failed workers side by side", ready(SESSION_WORKER_BY_STATE.waiting, SESSION_WORKER_BY_STATE.paused, SESSION_WORKER_BY_STATE.failed)),
  mixed: bar("Cards for busy workers, rows for quiet idle ones", ready(SESSION_WORKER_BY_STATE.running, SESSION_WORKER_BY_STATE.starting, ...QUIET_IDLE)),
  "all-states": bar("One worker in every state", ready(...Object.values(SESSION_WORKER_BY_STATE))),
  stale: bar("Counts held from the last day while the next loads, controls locked", { state: "ready", workers: [SESSION_WORKER_BY_STATE.running, SESSION_WORKER_BY_STATE.failed], stale: true }),
  wide: bar("A worker with five systems, a wide card with nicknames", ready(WIDE_WORKER)),
  "adding-empty": bar("A worker being added to an empty panel, shown as a pending row", ready(), { operations: ADDING }, { ready: "li[aria-busy]", knownFailures: ADD_LOCKED }),
  adding: bar("A worker being added beside an idle row", ready(QUIET_IDLE[0]), { operations: ADDING }, { ready: "li[aria-busy]", knownFailures: ADD_LOCKED }),
  removing: bar("An idle row being removed, the status reads Removing", ready(QUIET_IDLE[0]), { operations: { [(QUIET_IDLE[0]).id]: { request: { id: "remove-1", target: (QUIET_IDLE[0]).id, action: "remove" }, state: "pending", message: "Remove requested…" } } }, { ready: 'text="Removing"' }),
  "add-workers": bar("The Add workers dialog", ready(SESSION_WORKER_BY_STATE.running), {}, { ready: '[role="dialog"]',
    play: async page => { await page.getByRole("button", { name: "Add workers", exact: true }).click(); } }),
} satisfies Record<string, Story>;

/** A toast sits bottom centre above the Sessions bar at every panel height: collapsed, empty, one row and several. */
const TOAST = {
  collapsed: withToast("A result toast over the collapsed bar", ready(SESSION_WORKER_BY_STATE.running, SESSION_WORKER_BY_STATE.idle), false),
  empty: withToast("A result toast over the empty panel", ready()),
  "one-row": withToast("A result toast over one idle row", ready(QUIET_IDLE[0])),
  several: withToast("A result toast over cards and rows", ready(SESSION_WORKER_BY_STATE.running, SESSION_WORKER_BY_STATE.starting, ...QUIET_IDLE)),
} satisfies Record<string, Story>;

export const SESSIONS_STORIES = defineSurface("sessions", { worker: WORKER, browser: BROWSER, bar: BAR, operation: OPERATION, combination: COMBINATION, toast: TOAST });
