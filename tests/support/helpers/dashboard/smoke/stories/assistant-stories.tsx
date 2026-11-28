/** Assistant surface stories: the ChatGPT account the panel needs, every turn it can be in, each reply it shows (an answer, a proposal waiting on a typed yes,
 * the answered yes with its session chip), the refusals it shows, files attached to a message, the history it opens on, and the list of chats.
 * The real panel runs on the real controller; a scripted client answers it.
 * The turn's `cancelled` state comes only from typing while a reply is pending, and the composer is disabled then, so no person reaches it. */
import type { Page } from "@playwright/test";
import type { ChatGptAccountSnapshot } from "../../../../../../src/dashboard/surfaces/settings/general/chatgpt-account-model.js";
import type { AssistantHistoryState, AssistantTurn } from "../../../../../../src/dashboard/surfaces/assistant/assistant-model.js";
import type { AssistantFileStage } from "../../../../../../src/dashboard/surfaces/shell/assistant-panel-model.js";
import type { ChatListView } from "../../../../../../src/dashboard/surfaces/shell/hub-shell-model.js";
import { ASSISTANT_FAILURES } from "../../../../../../src/models/dashboard/assistant.js";
import { ASSISTANT_STORY_CHATS, ASSISTANT_STORY_PROMPT, type AssistantReplyScript } from "../../../../fixtures/dashboard/assistant-story-fixtures.js";
import { withKnownBreaks } from "../known-breaks.js";
import { defineSurface, type Story } from "../story-catalogue.js";
import type { ComposerMenu } from "../../../../../../src/dashboard/surfaces/shell/composer-model.js";
import { AssistantHost, ChatListHost, CONNECTED, type AssistantHostProps } from "./assistant-story-host.js";

const PANEL = '[aria-label="Relay assistant"]';
function scene(title: string, props: AssistantHostProps = {}, story: Partial<Story> = {}): Story {
  return { title, render: () => <AssistantHost props={props} />, ready: PANEL, ...story };
}

const sendMessage = async (page: Page, message: string): Promise<void> => {
  await page.locator("textarea[name=message]").fill(message);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
};
const send = (page: Page) => sendMessage(page, ASSISTANT_STORY_PROMPT);
const press = (name: string) => async (page: Page): Promise<void> => { await page.getByRole("button", { name, exact: true }).first().click(); };
const then = (...steps: readonly ((page: Page) => Promise<void>)[]) => async (page: Page): Promise<void> => { for (const step of steps) await step(page); };
const approvalProps = { modelPreference: { slug: "gpt-6.1-sol", effort: "medium" }, fullAccess: true } satisfies AssistantHostProps;
const openApproval = press("Ask before every action");
const pickFullAccess = then(openApproval, async page => { await page.getByRole("menuitemradio", { name: /^Full access/u }).click(); });
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
  // `unknown` follows only an uncertain model save; the controller tests cover it.
} satisfies Record<Exclude<AssistantTurn["state"], "cancelled" | "unknown">, Story>;

const reply = (script: AssistantReplyScript): AssistantHostProps => ({ client: { reply: script } });
const edit = (title: string, script: "spreadsheet-edit" | "settings-edit" | "undo-edit", message: string): Story =>
  scene(title, { ...reply(script), modelChoices: true, modelPreference: { slug: "gpt-6.1-sol", effort: "medium" } }, { ready: 'text="Edit applied"', play: page => sendMessage(page, message) });
const REPLY = {
  answer: after("A short answer", {}, 'text="10101010"'),
  "answer-long": after("A long answer", reply("answer-long"), 'text=/Each of these records/'),
  proposal: after("A proposal waiting on a typed yes", reply("proposal"), 'text="Reply yes to file it, or tell me what to change."'),
  "proposal-many": after("Several rows proposed", reply("proposal-many"), 'text=/Reply yes to save all 3/'),
  "spreadsheet-edit": edit("A spreadsheet edit", "spreadsheet-edit", "Rename the spreadsheet to Summer tracker."),
  "settings-edit": edit("A settings edit", "settings-edit", "Turn headless browser mode off."),
  "undo-edit": edit("A spreadsheet edit undone", "undo-edit", "Undo the tracker change."),
  "answered-yes": after("A typed yes that started a session", reply("answered-yes"), '.reply-session'),
  "full-access-dry-run": scene("A dry run started with Full access", { ...approvalProps, ...reply("full-access-dry-run") },
    { play: then(pickFullAccess, async page => { await page.getByRole("textbox", { name: "Message Relay" }).fill("Start a Separations dry run."); }, press("Send message")), ready: '.reply-session' }),
} satisfies Record<Exclude<AssistantReplyScript, "never" | "lost" | { readonly refused: unknown }>, Story>;

// A refusal is one notice with no button; the account strip carries Sign in or Open Settings.
const REFUSAL = {
  "plan-off": after("A reply refused because the plan is off", { client: { reply: { refused: "ASSISTANT_PLAN_DISABLED" } } }, `[title=${JSON.stringify(ASSISTANT_FAILURES.ASSISTANT_PLAN_DISABLED)}]`),
  "rate-limited": after("A reply refused for too many requests", { client: { reply: { refused: "CHATGPT_RATE_LIMITED" } } }, `[title=${JSON.stringify(ASSISTANT_FAILURES.CHATGPT_RATE_LIMITED)}]`),
};

const HISTORY = {
  loading: scene("History being read", { loading: true }, { ready: '[aria-label="Loading chat"]', slowFetch: { region: '[aria-label="Loading chat"]' } }),
  failed: scene("History that could not be read", { historyNotice: ASSISTANT_FAILURES.ASSISTANT_HISTORY_UNAVAILABLE }, { ready: 'text="Couldn\'t load chat history."' }),
  notice: scene("A note about the saved chat", { historyNotice: ASSISTANT_FAILURES.ASSISTANT_HISTORY_UNSAVED }, { ready: 'role=status' }),
  ready: scene("A chat with nothing said yet", {}, { ready: 'text="How can I help?"' }),
} satisfies Record<AssistantHistoryState, Story>;

/** Hands the composer one file, as the Add files menu does. */
const attach = (name: string, mediaType: string) => async (page: Page): Promise<void> => {
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType: mediaType, buffer: Buffer.from("story file") });
};
const attached = (title: string, file: Parameters<typeof attach>, ready: string, props: AssistantHostProps = {}): Story => scene(title, props, { play: attach(...file), ready });
const ATTACHMENT = {
  staged: attached("A file ready to send", ["notes.pdf", "application/pdf"], '.hub-attachment[data-stage="staged"]'),
  failed: attached("A file the server would not take", ["notes.pdf", "application/pdf"], '.hub-attachment[data-stage="failed"]', { client: { stage: { refused: "ASSISTANT_ATTACHMENT_UNAVAILABLE" } } }),
  spreadsheet: attached("A spreadsheet kept off the assistant", ["people.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], '.hub-attachment[data-stage="spreadsheet"]'),
  unsupported: attached("A file the assistant cannot read", ["notes.zip", "application/zip"], ".hub-composer-error"),
} satisfies Record<AssistantFileStage["state"] | "unsupported", Story>;

/** The shell's chat list, opened from the panel's History button; its read never answers, so the panel behind it is still loading. */
const chatList = (title: string, chats: Parameters<typeof ChatListHost>[0]["chats"], ready: string, ...more: readonly ((page: Page) => Promise<void>)[]): Story =>
  ({ title, render: () => <ChatListHost chats={chats} />, slowFetch: { region: "#hub-shell-assistant" }, play: then(press("History"), ...more), ready });
const CHATS = {
  listed: chatList("Saved chats in each group", ASSISTANT_STORY_CHATS, ".hub-chat-row"),
  empty: chatList("No saved chats", [], 'text="No chats yet"'),
  "no-match": chatList("A search that matches no chat", ASSISTANT_STORY_CHATS, 'text="No matching chats."', async page => { await page.getByLabel("Search chats").fill("zzzz"); }),
} satisfies Record<ChatListView, Story>;

const MENU = {
  model: scene("Served model choices in the composer", { account: CONNECTED, modelPreference: { slug: "gpt-6.1-sol", effort: "medium" }, modelChoices: true },
    { ready: "#hub-model-trigger" }),
} satisfies Record<Extract<ComposerMenu, "model">, Story>;

const APPROVAL = {
  off: scene("Approval menu with Full access off", { ...approvalProps, fullAccess: false }, { play: openApproval, ready: '[data-menu="approval"][data-open]' }),
  on: scene("Approval menu with Full access picked", approvalProps, { play: then(pickFullAccess, press("Full access")), ready: '[data-menu="approval"][data-open]' }),
} satisfies Record<"off" | "on", Story>;

const AUDIT_FIXES = "#532";
const BREAK_SETS = {
  /** The composer's approval picker is switched off while no model preference is served, and its Send button is not painted the accent. */
  COMPOSER: ["no-dead-disabled-control", "primary-button-accent"],
  MODEL_COMPOSER: ["named-and-focusable", "primary-button-accent"],
  /** COMPOSER, and a control in the open panel (the message box, or a button in the transcript) shows no visible focus ring. */
  COMPOSER_FOCUS: ["named-and-focusable", "no-dead-disabled-control", "primary-button-accent"],
  /** COMPOSER_FOCUS, and the history skeleton is drawn from the loading flag while no read is held. */
  COMPOSER_FOCUS_SKELETON: ["named-and-focusable", "no-dead-disabled-control", "primary-button-accent", "skeleton-only-while-fetching"],
} as const;

/** By `<state type>/<member>`. */
const KNOWN_BREAKS = {
  "account/expired": BREAK_SETS.COMPOSER,
  "account/loading": BREAK_SETS.COMPOSER,
  "account/sign-in-expired": BREAK_SETS.COMPOSER,
  "account/signed-out": BREAK_SETS.COMPOSER,
  "account/unavailable": BREAK_SETS.COMPOSER,
  "plan/disabled": BREAK_SETS.COMPOSER,
  "account/signing-in": BREAK_SETS.COMPOSER,
  "plan/limit-reached": BREAK_SETS.COMPOSER,
  "account/connected": BREAK_SETS.COMPOSER_FOCUS,
  "attachment/failed": BREAK_SETS.COMPOSER_FOCUS,
  "attachment/spreadsheet": BREAK_SETS.COMPOSER_FOCUS,
  "attachment/staged": BREAK_SETS.COMPOSER_FOCUS,
  "attachment/unsupported": BREAK_SETS.COMPOSER_FOCUS,
  "approval/off": ["named-and-focusable", "primary-button-accent"],
  "approval/on": ["named-and-focusable", "primary-button-accent"],
  "history/failed": BREAK_SETS.COMPOSER_FOCUS,
  "history/notice": BREAK_SETS.COMPOSER_FOCUS,
  "history/ready": BREAK_SETS.COMPOSER_FOCUS,
  "menu/model": BREAK_SETS.MODEL_COMPOSER,
  "plan/enabled": BREAK_SETS.COMPOSER_FOCUS,
  "refusal/plan-off": BREAK_SETS.COMPOSER_FOCUS,
  "refusal/rate-limited": BREAK_SETS.COMPOSER_FOCUS,
  "reply/answer": BREAK_SETS.COMPOSER_FOCUS,
  "reply/answer-long": BREAK_SETS.COMPOSER_FOCUS,
  "reply/proposal": BREAK_SETS.COMPOSER_FOCUS,
  "reply/proposal-many": BREAK_SETS.COMPOSER_FOCUS,
  "reply/answered-yes": BREAK_SETS.COMPOSER_FOCUS,
  "reply/spreadsheet-edit": BREAK_SETS.MODEL_COMPOSER,
  "reply/settings-edit": BREAK_SETS.MODEL_COMPOSER,
  "reply/undo-edit": BREAK_SETS.MODEL_COMPOSER,
  "reply/full-access-dry-run": ["named-and-focusable", "primary-button-accent"],
  "turn/failed": BREAK_SETS.COMPOSER_FOCUS,
  "turn/idle": BREAK_SETS.COMPOSER_FOCUS,
  "turn/waiting": BREAK_SETS.COMPOSER,
  "history/loading": BREAK_SETS.COMPOSER_FOCUS_SKELETON,
} as const;

export const ASSISTANT_STORIES = withKnownBreaks(
  defineSurface("assistant", { account: ACCOUNT, plan: PLAN, turn: TURN, reply: REPLY, refusal: REFUSAL, attachment: ATTACHMENT, history: HISTORY, chats: CHATS, menu: MENU, approval: APPROVAL }),
  "assistant", AUDIT_FIXES, KNOWN_BREAKS);
