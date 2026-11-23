/** Sessions stories: the real Sessions bar and its worker cards on fixture workers, one story per worker state, browser state, bar state and command operation. */
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
/** The Add workers control stays shown and switched off whenever the bar cannot act, with nothing to choose. */
const DEAD_ADD = { knownFailures: { "no-dead-disabled-control": "#532" } } as const;
/** A browser chip with a nickname or a served reason is focusable and has no accessible name of its own. */
const UNNAMED_CHIP = { knownFailures: { "named-and-focusable": "#532" } } as const;
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
  unavailable: { ...browser("A browser Relay cannot read, with its reason", "unavailable"), ...UNNAMED_CHIP }, failed: browser("A browser whose sign-in failed", "failed"),
  "needs-duo": browser("A browser waiting on Duo", "needs-duo"), "signed-out": browser("A browser signed out", "signed-out"),
} satisfies Record<SessionBrowserState, Story>;

const BAR = {
  ready: bar("The bar open on a running worker", ready(SESSION_WORKER_BY_STATE.running)),
  loading: bar("The bar while sessions load", { state: "loading" }, {}, { slowFetch: { region: '[aria-label="Loading sessions"]' }, ...DEAD_ADD }),
  unavailable: bar("The bar when sessions cannot be read", { state: "unavailable", reason: "Session information is unavailable." }, {}, { ready: '[role="alert"]', ...DEAD_ADD }),
} satisfies Record<SessionsViewState["state"], Story>;

const OPERATION = {
  pending: bar("A control sent and not yet answered, the card locked", ready(SESSION_WORKER_BY_STATE.running), { operations: { [SESSION_WORKER_BY_STATE.running.id]: SESSION_OPERATION_BY_STATE.pending } }),
  confirmed: bar("A control Relay confirmed", ready(SESSION_WORKER_BY_STATE.running), { operations: { [SESSION_WORKER_BY_STATE.running.id]: SESSION_OPERATION_BY_STATE.confirmed } }),
  refused: bar("A control Relay refused", ready(SESSION_WORKER_BY_STATE.running), { operations: { [SESSION_WORKER_BY_STATE.running.id]: SESSION_OPERATION_BY_STATE.refused } }),
} satisfies Record<SessionPreviewOperation["state"], Story>;

/** The combinations a person meets: a closed bar, an empty pool, a mixed pool, a stale day, a wide card and the Add workers dialog. */
const COMBINATION = {
  closed: bar("The bar collapsed, counts only", ready(SESSION_WORKER_BY_STATE.running, SESSION_WORKER_BY_STATE.idle), { open: false }),
  empty: bar("No workers yet", ready(), {}, { ready: 'text="No workers yet"' }),
  attention: bar("Waiting, paused and failed workers side by side", ready(SESSION_WORKER_BY_STATE.waiting, SESSION_WORKER_BY_STATE.paused, SESSION_WORKER_BY_STATE.failed)),
  mixed: bar("Cards for busy workers, rows for quiet idle ones", ready(SESSION_WORKER_BY_STATE.running, SESSION_WORKER_BY_STATE.starting, ...QUIET_IDLE)),
  "all-states": bar("One worker in every state", ready(...Object.values(SESSION_WORKER_BY_STATE))),
  stale: bar("Counts held from the last day while the next loads, controls locked", { state: "ready", workers: [SESSION_WORKER_BY_STATE.running, SESSION_WORKER_BY_STATE.failed], stale: true }, {}, DEAD_ADD),
  wide: bar("A worker with five systems, a wide card with nicknames", ready(WIDE_WORKER), {}, UNNAMED_CHIP),
  "add-workers": bar("The Add workers dialog", ready(SESSION_WORKER_BY_STATE.running), {}, { ready: '[role="dialog"]',
    play: async page => { await page.getByRole("button", { name: "Add workers", exact: true }).click(); } }),
} satisfies Record<string, Story>;

export const SESSIONS_STORIES = defineSurface("sessions", { worker: WORKER, browser: BROWSER, bar: BAR, operation: OPERATION, combination: COMBINATION });
