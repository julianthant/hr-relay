/** Settings surface stories: the page's read, its sections, the notices over them, search, the guarded exit, every save outcome,
 * the ChatGPT account, the Account page's edit dialogs, credentials and delete account. The real page runs on an in-page server
 * that answers the Settings reads and save commands. Settings' sidebar lists General, Account and Keyboard only (settings-model.ts);
 * Spreadsheets, Explorer and Analytics come back with dashboard-audit-fixes-04. */
import type { Page } from "@playwright/test";
import type { ChatGptAccountSnapshot } from "../../../../../../src/dashboard/surfaces/settings/general/chatgpt-account-model.js";
import type { DeleteAccountPresentation } from "../../../../../../src/dashboard/surfaces/settings/general/delete-account-model.js";
import type { EditableSettingsState, SettingsSaveState } from "../../../../../../src/dashboard/surfaces/settings/settings-model.js";
import type { SettingsSectionResolution } from "../../../../../../src/dashboard/surfaces/settings/settings-model.js";
import type { EditableSettingsWire } from "../../../../../../src/models/dashboard/settings-editor.js";
import { settingsStoryServer, type SettingsStoryServerOptions } from "../../../../fixtures/dashboard/settings-story-fixtures.js";
import type { StateRuleName } from "../state-rule-limits.js";
import { defineSurface, type Story } from "../story-catalogue.js";
import { SettingsHost, type AccountStub, type SettingsHostProps } from "./settings-story-host.js";

type Section = "general" | "account" | "keyboard";
type RuntimeState = EditableSettingsWire["runtimeStatus"]["state"];
type CredentialStore = EditableSettingsWire["protectedSettings"]["state"];
type PlanUsage = Extract<ChatGptAccountSnapshot, { state: "connected" }>["planUsage"];
type SearchState = "results" | "none" | "reading" | "unavailable";
type DialogName = "edit-name" | "edit-name-refused" | "edit-username" | "edit-username-refused" | "change-password" | "change-password-refused"
  | "edit-credential" | "remove-credential" | "disconnect-chatgpt" | "delete-account" | "discard-changes" | "edit-shortcut" | "edit-shortcut-refused";
/** What a press on the Account page comes back as, once the dialog or button has closed. */
type AccountAction = "password-changed" | "password-not-confirmed" | "name-not-saved" | "duo-not-opened";
type Notice = "restart-required" | "opened-for-check" | "setting-unavailable";

interface Scene {
  readonly host?: Omit<SettingsHostProps, "server" | "section">;
  readonly server?: SettingsStoryServerOptions;
  readonly section?: string;
  readonly play?: (page: Page) => Promise<void>;
  readonly story?: Partial<Story>;
}

/** The page's own heading is the ready point unless the story says what it waits on. */
function scene(title: string, input: Scene = {}): Story {
  return {
    title,
    render: () => <SettingsHost server={settingsStoryServer(input.server)} section={input.section ?? "general"} {...input.host} />,
    ready: '[aria-label="Settings sections"]',
    ...(input.play === undefined ? {} : { play: input.play }),
    ...input.story,
  };
}

const click = (name: string | RegExp, exact = true) => async (page: Page): Promise<void> => {
  await page.getByRole("button", { name, exact }).first().click();
};
const then = (...steps: readonly ((page: Page) => Promise<void>)[]) => async (page: Page): Promise<void> => { for (const step of steps) await step(page); };
/** Waits for the editable settings to arrive: the General page's Browser window choice is on screen. */
const WINDOW = '[role="combobox"][aria-label="Browser window"]';
const loaded = async (page: Page): Promise<void> => { await page.locator(WINDOW).waitFor(); };
/** The immediate-save choice every save story presses: the browser window starts hidden, so a size is a change. */
const chooseWindow = async (page: Page): Promise<void> => {
  await loaded(page);
  await page.locator(WINDOW).click();
  await page.getByRole("option", { name: "Small", exact: true }).click();
};
const type = (label: string, value: string) => async (page: Page): Promise<void> => { await page.getByLabel(label, { exact: true }).fill(value); };

const LOAD = {
  loading: scene("Settings reading, nothing back yet", { server: { read: "never" }, story: { slowFetch: { region: ".settings-content" } } }),
  failed: scene("Settings could not be read", { server: { read: "fail" }, story: { ready: 'text="Couldn\'t load settings."' } }),
  loaded: scene("General, every setting read", { play: loaded }),
} satisfies Record<EditableSettingsState["state"], Story>;

const SECTION = {
  general: scene("General page", { play: loaded }),
  account: scene("Account page", { section: "account", story: { ready: 'h1:has-text("Account"), h2:has-text("Account")' } }),
  keyboard: scene("Keyboard page", { section: "keyboard", story: { ready: 'text="Reset all to defaults"' } }),
} satisfies Record<Section, Story>;

// "empty" needs a sidebar with no entries; the page always lists General, Account and Keyboard, so no person can reach it.
const RESOLUTION = {
  open: scene("A section that exists", { play: loaded }),
  unknown: scene("A link to a section that does not exist opens General", { section: "nowhere", play: loaded }),
} satisfies Record<Exclude<SettingsSectionResolution["state"], "empty">, Story>;

const RUNTIME = {
  current: scene("Settings running as saved", { play: loaded }),
  "restart-required": scene("Saved settings waiting on a restart", { server: { runtime: "restart-required" }, story: { ready: 'text=/Restart required/' } }),
} satisfies Record<RuntimeState, Story>;

const CREDENTIALS = {
  available: scene("Account with UCPath sign-in saved", { section: "account", story: { ready: 'text="UCPath sign-in"' } }),
  unknown: scene("Account with the credential store unavailable", { section: "account", server: { credentials: "unavailable" }, story: { ready: 'text=/Credentials unavailable/' } }),
} satisfies Record<CredentialStore, Story>;

/** Combinations a person meets on the Account page's credential rows. */
type CredentialCombo = "none-saved";
const CREDENTIAL_COMBO = {
  "none-saved": scene("Account with no UCPath sign-in saved", { section: "account", server: { credentials: "empty" }, story: { ready: 'text="Not set"' } }),
} satisfies Record<CredentialCombo, Story>;

const saveStory = (title: string, server: SettingsStoryServerOptions, ready: string): Story => scene(title, { server, play: chooseWindow, story: { ready } });
const SAVE = {
  idle: scene("A setting with nothing changed", { play: loaded }),
  saving: scene("A save sent, no answer yet", { server: { save: "never" }, play: chooseWindow, story: { ready: WINDOW } }),
  applied: saveStory("A save that lands", { save: "applied" }, 'text=/Saved settings/'),
  refused: saveStory("A save the server refused", { save: "rejected" }, 'text=/Settings weren.t saved/'),
  conflict: saveStory("A save over settings that changed elsewhere", { save: "conflict" }, 'text=/Settings weren.t saved/'),
  unconfirmed: saveStory("A save whose answer was lost", { save: "lost" }, 'text=/Settings weren.t saved/'),
} satisfies Record<SettingsSaveState["state"], Story>;

/** Saves that land with something to say. */
type SaveCombo = "replayed" | "restart-required";
const SAVE_COMBO = {
  replayed: saveStory("A save that was already saved", { save: "replayed" }, 'text=/Already saved settings/'),
  "restart-required": saveStory("A save that needs a restart", { save: "restart" }, 'text=/Restart to use them/'),
} satisfies Record<SaveCombo, Story>;

const chatGpt = (title: string, snapshot: ChatGptAccountSnapshot, ready: string): Story => scene(title, { host: { chatGpt: snapshot }, story: { ready } });
const CHATGPT = {
  loading: scene("ChatGPT account being read", { host: { chatGpt: { state: "loading" } }, story: { ready: '[aria-label="Loading ChatGPT account"]', slowFetch: { region: '[aria-label="Loading ChatGPT account"]' } } }),
  "signed-out": chatGpt("ChatGPT not connected", { state: "signed-out" }, 'text="Not connected"'),
  expired: chatGpt("ChatGPT sign-in expired", { state: "expired" }, 'text="Not connected"'),
  "sign-in-expired": chatGpt("ChatGPT sign-in attempt timed out", { state: "sign-in-expired" }, 'text="Your sign-in attempt expired. Sign in to try again."'),
  "signing-in": chatGpt("Waiting for ChatGPT sign-in in the browser", { state: "signing-in", attemptId: "attempt", expiresAt: "2026-09-13T12:10:00.000Z", authorizationUrl: "https://auth.openai.com/oauth/authorize?attempt" }, 'text="Finish signing in to ChatGPT in your browser."'),
  unavailable: chatGpt("ChatGPT could not be checked", { state: "unavailable", message: "Couldn't check ChatGPT." }, 'text="Couldn\'t check ChatGPT."'),
  connected: chatGpt("ChatGPT connected", { state: "connected", name: "Jordan Lee", email: "jordan.lee@example.com", planUsage: "enabled" }, 'text="Jordan Lee"'),
} satisfies Record<ChatGptAccountSnapshot["state"], Story>;

const plan = (title: string, planUsage: PlanUsage, ready: string): Story => chatGpt(title, { state: "connected", name: "Jordan Lee", email: "jordan.lee@example.com", planUsage }, ready);
const PLAN = {
  enabled: plan("ChatGPT connected with plan access", "enabled", 'text="Manage usage"'),
  disabled: plan("ChatGPT connected without plan access", "disabled", 'text="ChatGPT plan access not enabled"'),
  "limit-reached": plan("ChatGPT connected at its usage limit", "limit-reached", 'text="Usage limit reached"'),
} satisfies Record<PlanUsage, Story>;

const deleting = (title: string, deleteAccount: DeleteAccountPresentation, ready: string): Story =>
  scene(title, { section: "account", host: { deleteAccount }, story: { ready } });
const DELETE = {
  unavailable: deleting("Delete account not available", { state: "unavailable" }, 'text="Not available right now."'),
  ready: deleting("Delete account ready", { state: "ready", personName: "Jordan Lee", onConfirm: () => undefined }, 'button:has-text("Delete")'),
  deleting: deleting("Account being deleted", { state: "deleting", personName: "Jordan Lee" }, 'text="Deleting your account…"'),
  refused: deleting("Account deletion refused", { state: "refused", personName: "Jordan Lee", message: "Couldn't delete your account." }, 'text="Couldn\'t delete your account."'),
  uncertain: deleting("Account deletion not confirmed", { state: "uncertain", personName: "Jordan Lee", message: "Couldn't confirm the deletion. Reopen Relay to check." }, 'text="Couldn\'t confirm the deletion. Reopen Relay to check."'),
} satisfies Record<DeleteAccountPresentation["state"], Story>;

const find = (query: string) => type("Search settings", query);
const SEARCH = {
  results: scene("Search with matching settings", { play: then(loaded, find("browser")), story: { ready: '[role="status"]:has-text("found")' } }),
  none: scene("Search with no matching setting", { play: then(loaded, find("zzzz")), story: { ready: 'text="No settings found"' } }),
  reading: scene("Search while settings are still being read", { server: { read: "never" }, play: find("zzzz"), story: { ready: 'text="Reading settings…"', slowFetch: { region: ".settings-content" } } }),
  unavailable: scene("Search after settings could not be read", { server: { read: "fail" }, play: find("zzzz"), story: { ready: 'text="Settings fields unavailable"' } }),
} satisfies Record<SearchState, Story>;

const refusedDetails: AccountStub = { details: { state: "refused", code: "PROFILE_NAME_REFUSED" } };
const refusedLogin: AccountStub = { login: { state: "refused", code: "PROFILE_CURRENT_PASSWORD_REFUSED" } };
const onAccount = (title: string, play: Scene["play"], ready: string, extra: Partial<Scene> = {}): Story => scene(title, { section: "account", ...(play === undefined ? {} : { play }), story: { ready }, ...extra });
const DIALOG = {
  "edit-name": onAccount("Editing the account name", click("Edit name"), '[role="dialog"]'),
  "edit-name-refused": onAccount("A name change the server refused", then(click("Edit name"), type("Name", "Jordan Q Lee"), click("Save")), '[role="dialog"] [role="alert"], [role="dialog"] [data-slot="field-error"]', { host: { account: refusedDetails } }),
  "edit-username": onAccount("Editing the Relay username", click("Edit username"), '[role="dialog"]'),
  "edit-username-refused": onAccount("A username change with the wrong password", then(click("Edit username"), type("Current password", "wrong"), type("New username", "jordan@ucsd.edu"), click("Save")), '[role="dialog"] [role="alert"], [role="dialog"] [data-slot="field-error"]', { host: { account: refusedLogin } }),
  "change-password": onAccount("Changing the Relay password", click("Change Relay password"), '[role="dialog"]'),
  "change-password-refused": onAccount("A password change with the wrong password", then(click("Change Relay password"), type("Current password", "wrong"), type("New password", "a-new-password"), type("Confirm new password", "a-new-password"), click("Save")), '[role="dialog"] [role="alert"], [role="dialog"] [data-slot="field-error"]', { host: { account: refusedLogin } }),
  "edit-credential": onAccount("Editing the UCPath username", click("Edit UCPath username"), '[role="dialog"]'),
  "remove-credential": onAccount("Asked to remove the UCPath username", then(click("Edit UCPath username"), click("Remove UCPath username")), 'text="Remove UCPath username?"'),
  "disconnect-chatgpt": scene("Asked to disconnect ChatGPT", { host: { chatGpt: { state: "connected", name: "Jordan Lee", email: "jordan.lee@example.com", planUsage: "enabled" } }, play: click("Disconnect"), story: { ready: 'text="Disconnect ChatGPT?"' } }),
  "delete-account": onAccount("Asked to delete the account", click("Delete"), 'text=/Delete .* account\\?/', { host: { deleteAccount: { state: "ready", personName: "Jordan Lee", onConfirm: () => undefined } } }),
  "discard-changes": scene("Asked to discard unsaved changes", { server: { save: "never" }, play: then(chooseWindow, click("Close settings")), story: { ready: 'text="Discard changes?"' } }),
  "edit-shortcut": scene("Editing a keyboard shortcut", { section: "keyboard", play: click(/^Edit .* shortcut 1$/u, false), story: { ready: 'text="Edit shortcut"' } }),
  "edit-shortcut-refused": scene("A shortcut the page refused", { section: "keyboard", play: then(click(/^Edit .* shortcut 1$/u, false), async page => { await page.getByLabel("Shortcut keys").press("r"); }, click("Save")), story: { ready: 'text="Edit shortcut"' } }),
} satisfies Record<DialogName, Story>;

const fillPassword = then(click("Change Relay password"), type("Current password", "current-password"), type("New password", "a-new-password"), type("Confirm new password", "a-new-password"), click("Save"));
const ACTION = {
  "password-changed": onAccount("The Relay password changed", fillPassword, 'text="Relay password changed"'),
  "password-not-confirmed": onAccount("A password change whose answer was lost", fillPassword, 'text="Relay password change not confirmed"', { host: { account: { login: { state: "unknown", code: "PROFILE_LOGIN_CHANGE_UNKNOWN" } } } }),
  "name-not-saved": onAccount("A name change whose answer was lost", then(click("Edit name"), type("Name", "Jordan Q Lee"), click("Save")), 'text="Name not saved"', { host: { account: { details: { state: "refused", code: "PROFILE_DETAILS_CHANGE_UNKNOWN" } } } }),
  "duo-not-opened": onAccount("Duo setup could not be opened", click("Set up again"), 'text=/Duo setup not opened/', { host: { account: { duo: "Couldn't open Duo setup." } } }),
} satisfies Record<AccountAction, Story>;

const NOTICE = {
  "restart-required": scene("Restart notice over General", { server: { runtime: "restart-required" }, story: { ready: 'text=/Saved settings apply after Relay restarts/' } }),
  "opened-for-check": scene("Opened from a Run dialog's Fix button", { host: { backToRun: true, searchTarget: "protected.ucpathPassword" }, section: "account", story: { ready: 'text=/change the highlighted setting/' } }),
  "setting-unavailable": scene("A search target that is not on the page", { host: { searchTarget: "nothing.here" }, play: loaded, story: { ready: 'text=/Setting unavailable/' } }),
} satisfies Record<Notice, Story>;

/** Rules today's Settings breaks, each recorded against the dashboard-audit-fixes feature (#532), whose tickets fix them; never loosened. */
const AUDIT_FIXES = "#532";
const breaks = (...rules: readonly StateRuleName[]): Readonly<Partial<Record<StateRuleName, string>>> => Object.fromEntries(rules.map(rule => [rule, AUDIT_FIXES]));
const BREAK_SETS = {
  /** The Downloads row shows a file path. */
  PATH: breaks("no-banned-text"),
  /** Save is not the accent while the Account edit dialog shows a refusal. */
  ACCENT: breaks("primary-button-accent"),
  /** The page's search field and notice leave controls with no keyboard stop. */
  FOCUS: breaks("named-and-focusable"),
  /** FOCUS, and the Downloads row shows a file path. */
  FOCUS_AND_PATH: breaks("named-and-focusable", "no-banned-text"),
  /** FOCUS, and Save is not the accent while the dialog shows a refusal. */
  FOCUS_ACCENT: breaks("named-and-focusable", "primary-button-accent"),
} as const;

/** By `<state type>/<member>`. */
const KNOWN_BREAKS: Readonly<Record<string, Readonly<Partial<Record<StateRuleName, string>>>>> = {
  "chatgpt/connected": BREAK_SETS.PATH,
  "chatgpt/expired": BREAK_SETS.PATH,
  "chatgpt/loading": BREAK_SETS.PATH,
  "chatgpt/sign-in-expired": BREAK_SETS.PATH,
  "chatgpt/signed-out": BREAK_SETS.PATH,
  "chatgpt/signing-in": BREAK_SETS.PATH,
  "chatgpt/unavailable": BREAK_SETS.PATH,
  "dialog/discard-changes": BREAK_SETS.PATH,
  "dialog/disconnect-chatgpt": BREAK_SETS.PATH,
  "load/loaded": BREAK_SETS.PATH,
  "plan/disabled": BREAK_SETS.PATH,
  "plan/enabled": BREAK_SETS.PATH,
  "plan/limit-reached": BREAK_SETS.PATH,
  "resolution/open": BREAK_SETS.PATH,
  "resolution/unknown": BREAK_SETS.PATH,
  "runtime/current": BREAK_SETS.PATH,
  "save/idle": BREAK_SETS.PATH,
  "save/saving": BREAK_SETS.FOCUS_AND_PATH,
  "search/none": BREAK_SETS.FOCUS_AND_PATH,
  "search/results": BREAK_SETS.FOCUS_AND_PATH,
  "section/general": BREAK_SETS.PATH,
  "dialog/change-password-refused": BREAK_SETS.ACCENT,
  "dialog/edit-name-refused": BREAK_SETS.ACCENT,
  "dialog/edit-username-refused": BREAK_SETS.ACCENT,
  "notice/opened-for-check": BREAK_SETS.FOCUS,
  "search/reading": BREAK_SETS.FOCUS,
  "search/unavailable": BREAK_SETS.FOCUS,
  "action/duo-not-opened": BREAK_SETS.FOCUS,
  "action/name-not-saved": BREAK_SETS.FOCUS,
  "action/password-changed": BREAK_SETS.FOCUS,
  "action/password-not-confirmed": BREAK_SETS.FOCUS,
  "notice/restart-required": BREAK_SETS.FOCUS_AND_PATH,
  "notice/setting-unavailable": BREAK_SETS.FOCUS_AND_PATH,
  "runtime/restart-required": BREAK_SETS.FOCUS_AND_PATH,
  "save-combo/replayed": BREAK_SETS.FOCUS_AND_PATH,
  "save-combo/restart-required": BREAK_SETS.FOCUS_AND_PATH,
  "save/applied": BREAK_SETS.FOCUS_AND_PATH,
  "save/conflict": BREAK_SETS.FOCUS_AND_PATH,
  "save/refused": BREAK_SETS.FOCUS_AND_PATH,
  "save/unconfirmed": BREAK_SETS.FOCUS_AND_PATH,
};
const SETTINGS_TABLES = defineSurface("settings", {
  load: LOAD, section: SECTION, resolution: RESOLUTION, runtime: RUNTIME, credentials: CREDENTIALS, "credential-combo": CREDENTIAL_COMBO,
  save: SAVE, "save-combo": SAVE_COMBO, chatgpt: CHATGPT, plan: PLAN, delete: DELETE, search: SEARCH, dialog: DIALOG, action: ACTION, notice: NOTICE,
});

export const SETTINGS_STORIES = SETTINGS_TABLES.map(entry => {
  const known = KNOWN_BREAKS[entry.id.slice("settings/".length)];
  return known === undefined ? entry : { ...entry, story: { ...entry.story, knownFailures: known } };
});
