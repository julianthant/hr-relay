/** Assistant surface stories: the ChatGPT account the panel needs, every turn it can be in, each proposal card and how it is settled,
 * the refusals it shows, and the history it opens on. The real panel runs on the real controller; a scripted client answers it.
 * The turn's `unknown` state is reached by cancelling a reply that has not answered. The turn's `cancelled` state and a proposal's `edited`
 * disposition come only from typing while a reply is pending, and the composer is disabled then, so no person reaches them. */
import type { Page } from "@playwright/test";
import type { ChatGptAccountSnapshot } from "../../../../../../src/dashboard/surfaces/settings/general/chatgpt-account-model.js";
import type { AssistantTurn } from "../../../../../../src/dashboard/surfaces/assistant/assistant-model.js";
import { ASSISTANT_FAILURES } from "../../../../../../src/models/dashboard/assistant.js";
import { ASSISTANT_STORY_PROMPT, type AssistantProposalKind } from "../../../../fixtures/dashboard/assistant-story-fixtures.js";
import { withKnownBreaks } from "../known-breaks.js";
import { defineSurface, type Story } from "../story-catalogue.js";
import { AssistantHost, CONNECTED, type AssistantHostProps } from "./assistant-story-host.js";

const PANEL = '[aria-label="Relay assistant"]';
function scene(title: string, props: AssistantHostProps = {}, story: Partial<Story> = {}): Story {
  return { title, render: () => <AssistantHost props={props} />, ready: PANEL, ...story };
}

const send = async (page: Page): Promise<void> => {
  await page.locator("textarea[name=message]").fill(ASSISTANT_STORY_PROMPT);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
};
const press = (name: string) => async (page: Page): Promise<void> => { await page.getByRole("button", { name, exact: true }).first().click(); };
const then = (...steps: readonly ((page: Page) => Promise<void>)[]) => async (page: Page): Promise<void> => { for (const step of steps) await step(page); };
/** A story that sends the request and waits on what comes back. */
const after = (title: string, props: AssistantHostProps, ready: string, ...more: readonly ((page: Page) => Promise<void>)[]): Story =>
  scene(title, props, { play: then(send, ...more), ready });

const ACCOUNT = {
  loading: scene("The account being read", { account: { state: "loading" } }),
  "signed-out": scene("Not signed in to ChatGPT", { account: { state: "signed-out" } }),
  expired: scene("The ChatGPT sign-in has expired", { account: { state: "expired" } }),
  "sign-in-expired": scene("The sign-in attempt ran out of time", { account: { state: "sign-in-expired" } }),
  "signing-in": scene("Signing in to ChatGPT", { account: { state: "signing-in", attemptId: "attempt-1", expiresAt: "2099-01-01T00:00:00.000Z" } }),
  unavailable: scene("The account could not be read", { account: { state: "unavailable", message: ASSISTANT_FAILURES.CHATGPT_AUTH_UNAVAILABLE }, retryable: true }),
  connected: scene("Connected to ChatGPT", { account: CONNECTED }),
} satisfies Record<ChatGptAccountSnapshot["state"], Story>;

type PlanUsage = Extract<ChatGptAccountSnapshot, { state: "connected" }>["planUsage"];
const plan = (planUsage: PlanUsage): AssistantHostProps => ({ account: { ...CONNECTED, planUsage } });
const PLAN = {
  enabled: scene("Plan usage on", plan("enabled")),
  disabled: scene("Plan usage turned off for the account", plan("disabled")),
  "limit-reached": scene("The plan's usage limit reached", plan("limit-reached")),
} satisfies Record<PlanUsage, Story>;

const TURN = {
  idle: scene("A new chat waiting for a request"),
  waiting: after("A reply being prepared", { client: { reply: "never" } }, 'text="Preparing a reply…"'),
  failed: after("A reply that never arrived", { client: { reply: "lost" } }, 'text="Reply unavailable."'),
  unknown: after("A reply cancelled before it answered", { client: { reply: "never" } }, 'text=/unclear whether this finished/', press("Cancel")),
} satisfies Record<Exclude<AssistantTurn["state"], "proposal" | "cancelled">, Story>;

const REPLY = {
  answer: after("A short answer", {}, 'text="Employee ID 10101010"'),
  "answer-long": after("A long answer", { client: { reply: "answer-long" } }, 'text=/Each of these records/'),
} satisfies Record<"answer" | "answer-long", Story>;

const proposal = (kind: AssistantProposalKind): AssistantHostProps => ({ client: { reply: { proposal: kind } } });
const CARD = '[aria-label^="Proposed"]';
const KIND = {
  start: after("A workflow start proposed", proposal("start"), CARD),
  "start-many": after("Several rows proposed to start", proposal("start-many"), CARD),
  rerun: after("A rerun proposed", proposal("rerun"), CARD),
  pause: after("A pause proposed", proposal("pause"), CARD),
  "separations-many": after("Several separations proposed", proposal("separations-many"), CARD),
} satisfies Record<AssistantProposalKind, Story>;

const DISPOSITION = {
  review: after("A proposal waiting on a decision", proposal("start"), CARD),
  confirming: after("A confirmation being applied", { ...proposal("start"), client: { reply: { proposal: "start" }, decision: "never" } }, 'text="Confirming the action…"', press("Confirm")),
  confirmed: after("A proposal that was confirmed", proposal("start"), '[aria-label="Resolved proposal"]', press("Confirm")),
  cancelled: after("A proposal that was cancelled", proposal("start"), '[aria-label="Resolved proposal"]', press("Cancel")),
  stale: after("A proposal the server refused", { client: { reply: { proposal: "start" }, decision: { refused: "ASSISTANT_CONVERSATION_STALE" } } }, 'text=/Plan out of date/', press("Confirm")),
  unknown: after("A confirmation whose result is not known", { client: { reply: { proposal: "start" }, decision: "unknown" } }, 'text=/Check Queue/', press("Confirm")),
} satisfies Record<Exclude<Extract<AssistantTurn, { state: "proposal" }>["disposition"], "edited">, Story>;

const REFUSAL = {
  "plan-disabled": after("A reply refused because the plan is off", { client: { reply: { refused: "ASSISTANT_PLAN_DISABLED" } } }, 'button:has-text("Open Settings")'),
  "rate-limited": after("A reply refused for too many requests", { client: { reply: { refused: "CHATGPT_RATE_LIMITED" } } }, 'button:has-text("Retry")'),
} satisfies Record<string, Story>;

const HISTORY = {
  loading: scene("History being read", { loading: true }, { ready: '[aria-label="Loading chat"]', slowFetch: { region: '[aria-label="Loading chat"]' } }),
  failed: scene("History that could not be read", { historyNotice: ASSISTANT_FAILURES.ASSISTANT_HISTORY_UNAVAILABLE }, { ready: 'text="Couldn\'t load chat history."' }),
  notice: scene("A note about the saved chat", { historyNotice: ASSISTANT_FAILURES.ASSISTANT_HISTORY_UNSAVED }, { ready: 'role=status' }),
  empty: scene("A chat with nothing said yet", {}, { ready: 'text="How can I help?"' }),
} satisfies Record<string, Story>;

const AUDIT_FIXES = "#532";
const KNOWN_BREAKS = {
   "account/connected": ["named-and-focusable", "no-dead-disabled-control", "primary-button-accent"],
   "account/expired": ["no-dead-disabled-control", "primary-button-accent"],
   "account/loading": ["no-dead-disabled-control", "primary-button-accent"],
   "account/sign-in-expired": ["no-dead-disabled-control", "primary-button-accent"],
   "account/signed-out": ["no-dead-disabled-control", "primary-button-accent"],
   "account/signing-in": ["fits-viewport", "no-dead-disabled-control", "primary-button-accent"],
   "account/unavailable": ["no-dead-disabled-control", "primary-button-accent"],
   "disposition/cancelled": ["named-and-focusable", "no-dead-disabled-control", "primary-button-accent"],
   "disposition/confirmed": ["named-and-focusable", "no-dead-disabled-control", "primary-button-accent"],
   "disposition/confirming": ["named-and-focusable", "no-dead-disabled-control", "primary-button-accent"],
   "disposition/review": ["named-and-focusable", "no-dead-disabled-control", "primary-button-accent"],
   "disposition/stale": ["named-and-focusable", "no-dead-disabled-control", "primary-button-accent"],
   "disposition/unknown": ["named-and-focusable", "no-dead-disabled-control", "primary-button-accent"],
   "history/empty": ["named-and-focusable", "no-dead-disabled-control", "primary-button-accent"],
   "history/failed": ["named-and-focusable", "no-dead-disabled-control", "primary-button-accent"],
   "history/loading": ["named-and-focusable", "no-dead-disabled-control", "primary-button-accent", "skeleton-only-while-fetching"],
   "history/notice": ["named-and-focusable", "no-dead-disabled-control", "primary-button-accent"],
   "kind/pause": ["named-and-focusable", "no-dead-disabled-control", "primary-button-accent"],
   "kind/rerun": ["named-and-focusable", "no-dead-disabled-control", "primary-button-accent"],
   "kind/separations-many": ["named-and-focusable", "no-dead-disabled-control", "primary-button-accent"],
   "kind/start": ["named-and-focusable", "no-dead-disabled-control", "primary-button-accent"],
   "kind/start-many": ["named-and-focusable", "no-dead-disabled-control", "primary-button-accent"],
   "plan/disabled": ["no-dead-disabled-control", "primary-button-accent"],
   "plan/enabled": ["named-and-focusable", "no-dead-disabled-control", "primary-button-accent"],
   "plan/limit-reached": ["fits-viewport", "no-dead-disabled-control", "primary-button-accent"],
   "refusal/plan-disabled": ["named-and-focusable", "no-dead-disabled-control", "primary-button-accent"],
   "refusal/rate-limited": ["named-and-focusable", "no-dead-disabled-control", "primary-button-accent"],
   "reply/answer": ["named-and-focusable", "no-dead-disabled-control", "primary-button-accent"],
   "reply/answer-long": ["named-and-focusable", "no-dead-disabled-control", "primary-button-accent"],
   "turn/failed": ["named-and-focusable", "no-dead-disabled-control", "primary-button-accent"],
   "turn/idle": ["named-and-focusable", "no-dead-disabled-control", "primary-button-accent"],
   "turn/unknown": ["named-and-focusable", "no-dead-disabled-control", "primary-button-accent"],
   "turn/waiting": ["named-and-focusable", "no-dead-disabled-control", "primary-button-accent"],
 } as const;

export const ASSISTANT_STORIES = withKnownBreaks(
  defineSurface("assistant", { account: ACCOUNT, plan: PLAN, turn: TURN, reply: REPLY, kind: KIND, disposition: DISPOSITION, refusal: REFUSAL, history: HISTORY }),
  "assistant", AUDIT_FIXES, KNOWN_BREAKS);
