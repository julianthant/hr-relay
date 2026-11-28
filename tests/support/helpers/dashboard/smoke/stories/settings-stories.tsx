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
import { defineSurface, type Story } from "../story-catalogue.js";
import { DUO_WORK_KEY, SettingsHost, type AccountStub, type SettingsHostProps } from "./settings-story-host.js";

type Section = "general" | "account" | "keyboard";
type RuntimeState = EditableSettingsWire["runtimeStatus"]["state"];
type CredentialStore = EditableSettingsWire["protectedSettings"]["state"];
type PlanUsage = Extract<ChatGptAccountSnapshot, { state: "connected" }>["planUsage"];
type SearchState = "results" | "none" | "reading" | "unavailable";
type DialogName = "edit-name" | "edit-name-refused" | "edit-username" | "edit-username-refused" | "change-password" | "change-password-refused"
  | "edit-credential" | "disconnect-chatgpt" | "delete-account" | "discard-changes" | "edit-shortcut" | "edit-shortcut-refused";
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
/** Waits for the editable settings to arrive: the General page's failures switch is on screen. */
const WINDOW = '[data-settings-path="preferences.notifications.failures"] [role="switch"]';
const loaded = async (page: Page): Promise<void> => { await page.locator(WINDOW).waitFor(); };
/** The immediate-save edit every save story makes: the failures switch starts on, so one press is a change. */
const chooseWindow = async (page: Page): Promise<void> => {
  await loaded(page);
  await page.locator(WINDOW).click();
};
const type = (label: string, value: string) => async (page: Page): Promise<void> => { await page.getByLabel(label, { exact: true }).fill(value); };

const LOAD = {
  loading: scene("Settings reading, nothing back yet", { server: { read: "never" }, story: { slowFetch: { region: ".settings-content" } } }),
  failed: scene("Settings could not be read", { server: { read: "fail" }, story: { ready: 'text="Couldn\'t load settings."' } }),
  loaded: scene("General, every setting read", { play: loaded }),
} satisfies Record<EditableSettingsState["state"], Story>;

/** The edit every refresh story makes: the Job end date typed into while the re-read is held. */
const JOB_END = 'text="Job end date"';
const editDuringReread = async (page: Page): Promise<void> => {
  const month = page.getByRole("spinbutton", { name: /^month, Job end date/ }).first();
  await month.waitFor();
  await page.waitForTimeout(1200);
  await month.click();
  await page.keyboard.type("06302027");
};
const release = async (page: Page): Promise<void> => { await page.evaluate(() => { Reflect.apply(Reflect.get(window, "releaseSettingsRead") as () => void, window, []); }); await page.waitForTimeout(300);
  const month = await page.getByRole("spinbutton", { name: /^month, Job end date/ }).first().textContent();
  if (month?.trim() !== "06") throw new Error(`the edited Job end date did not survive the re-read: ${String(month)}`);
};

const REFRESH = {
  held: scene("General over its kept document during a held re-read, a field mid-edit", { server: { read: "hold-later" }, host: { rereadOnceLoaded: true }, play: editDuringReread, story: { ready: JOB_END } }),
  landed: scene("General after the re-read lands, the edit kept", { server: { read: "hold-later" }, host: { rereadOnceLoaded: true }, play: then(editDuringReread, release), story: { ready: JOB_END } }),
  "kept-document": scene("General over its kept document while a slow re-read runs, the spinner beside the title", { server: { read: "hold-later" }, host: { rereadOnceLoaded: true }, story: { ready: '[data-settings-stale] [role="status"]' } }),
} satisfies Record<"held" | "landed" | "kept-document", Story>;

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
  applied: saveStory("A save that lands", { save: "applied" }, 'text=/Saved /'),
  refused: saveStory("A save the server refused", { save: "rejected" }, 'text=/Settings weren.t saved/'),
  conflict: saveStory("A save over settings that changed elsewhere", { save: "conflict" }, 'text=/Settings weren.t saved/'),
  unconfirmed: saveStory("A save whose answer was lost", { save: "lost" }, 'text=/Settings weren.t saved/'),
} satisfies Record<SettingsSaveState["state"], Story>;

/** Saves that land with something to say. */
type SaveCombo = "replayed" | "restart-required";
const SAVE_COMBO = {
  replayed: saveStory("A save that was already saved", { save: "replayed" }, 'text=/Already saved /'),
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

/** Typing leaves focus in the search box; a click on the sidebar title puts the keyboard walk back at the top of the page, as a user's Tab would start. */
const find = (query: string): ((page: Page) => Promise<void>) => then(type("Search settings", query), async page => { await page.getByRole("heading", { name: "Settings", exact: true }).click(); });
const SEARCH = {
  results: scene("Search with matching settings", { play: then(loaded, find("browser")), story: { ready: '[role="status"]:has-text("found")' } }),
  none: scene("Search with no matching setting", { play: then(loaded, find("zzzz")), story: { ready: 'text="No settings found"' } }),
  reading: scene("Search while settings are still being read", { server: { read: "never" }, play: find("zzzz"), story: { ready: 'text="Reading settings…"', slowFetch: { region: ".settings-content" } } }),
  unavailable: scene("Search after settings could not be read", { server: { read: "fail" }, play: find("zzzz"), story: { ready: 'text="Settings fields unavailable"' } }),
} satisfies Record<SearchState, Story>;

/** The Save just pressed is still under the pointer, which fills it in its hover color; move the pointer off it and let the fill settle, so the story is measured at the accent. */
const still = async (page: Page): Promise<void> => {
  await page.mouse.move(1, 1);
  await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => undefined))));
};
const refusedDetails: AccountStub = { details: { state: "refused", code: "PROFILE_NAME_REFUSED" } };
const refusedLogin: AccountStub = { login: { state: "refused", code: "PROFILE_CURRENT_PASSWORD_REFUSED" } };
const onAccount = (title: string, play: Scene["play"], ready: string, extra: Partial<Scene> = {}): Story => scene(title, { section: "account", ...(play === undefined ? {} : { play }), story: { ready }, ...extra });
const DIALOG = {
  "edit-name": onAccount("Editing the account name", click("Edit name"), '[role="dialog"]'),
  "edit-name-refused": onAccount("A name change the server refused", then(click("Edit name"), type("Name", "Jordan Q Lee"), click("Save"), still), '[role="dialog"] [role="alert"], [role="dialog"] [data-slot="field-error"]', { host: { account: refusedDetails } }),
  "edit-username": onAccount("Editing the Relay username", click("Edit username"), '[role="dialog"]'),
  "edit-username-refused": onAccount("A username change with the wrong password", then(click("Edit username"), type("Current password", "wrong"), type("New username", "jordan@ucsd.edu"), click("Save"), still), '[role="dialog"] [role="alert"], [role="dialog"] [data-slot="field-error"]', { host: { account: refusedLogin } }),
  "change-password": onAccount("Changing the Relay password", click("Change Relay password"), '[role="dialog"]'),
  "change-password-refused": onAccount("A password change with the wrong password", then(click("Change Relay password"), type("Current password", "wrong"), type("New password", "a-new-password"), type("Confirm new password", "a-new-password"), click("Save"), still), '[role="dialog"] [role="alert"], [role="dialog"] [data-slot="field-error"]', { host: { account: refusedLogin } }),
  "edit-credential": onAccount("Editing the UCPath username", click("Edit UCPath username"), '[role="dialog"]'),
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

type DuoKeysStory = "loading" | "unavailable" | "one-key" | "several-keys" | "rename" | "confirm-removal" | "last-key-removed";
const showSecurity = (page: Page): Promise<void> => page.getByRole("group", { name: "Security", exact: true }).scrollIntoViewIfNeeded();
const duoKeys = (title: string, keys: NonNullable<AccountStub["duoKeys"]>, ready: string, play?: Scene["play"]): Story =>
  onAccount(title, play === undefined ? showSecurity : then(showSecurity, play), ready, { host: { account: { duoKeys: keys } } });
const WORK_KEY = [DUO_WORK_KEY];
const loadingDuoKeys = '[aria-label="Loading Duo security keys"]';
const finishDuoRemoval = async (page: Page): Promise<void> => {
  await click("Remove")(page);
  await page.getByRole("button", { name: "Set up", exact: true }).and(page.locator(":focus")).waitFor();
  await page.getByRole("heading", { name: "Settings", exact: true }).click();
};
const DUO_KEYS = {
  loading: scene("Duo security keys loading", { section: "account", host: { account: { duoKeys: "loading" } }, play: showSecurity, story: { ready: loadingDuoKeys, slowFetch: { region: loadingDuoKeys } } }),
  unavailable: duoKeys("Duo security keys unavailable", "unavailable", 'text="Duo keys unavailable"'),
  "one-key": duoKeys("One Duo security key", WORK_KEY, 'text="Work security key"'),
  "several-keys": duoKeys("Several Duo security keys", [...WORK_KEY, { id: "b".repeat(64), shortId: "bC34de56", addedAt: "2026-09-02T12:00:00.000Z" }], 'text="Key bC34de56"'),
  rename: duoKeys("Rename a Duo security key", WORK_KEY, 'text="Rename security key"', then(click("Rename Work security key"), type("Name", "Office security key"))),
  "confirm-removal": duoKeys("Confirm removal of a Duo security key", WORK_KEY, 'text="Remove security key?"', click("Remove Work security key")),
  "last-key-removed": duoKeys("The last Duo security key was removed", WORK_KEY, 'role=button[name="Set up"s]', then(click("Remove Work security key"), finishDuoRemoval)),
} satisfies Record<DuoKeysStory, Story>;

const NOTICE = {
  "restart-required": scene("Restart notice over General", { server: { runtime: "restart-required" }, story: { ready: 'text=/Saved settings apply after Relay restarts/' } }),
  "opened-for-check": scene("Opened from a Run dialog's Fix button", { host: { backToRun: true, searchTarget: "protected.ucpathPassword" }, section: "account", story: { ready: 'text=/change the highlighted setting/' } }),
  "setting-unavailable": scene("A search target that is not on the page", { host: { searchTarget: "nothing.here" }, play: loaded, story: { ready: 'text=/Setting unavailable/' } }),
} satisfies Record<Notice, Story>;

const FULL_ACCESS = '[data-settings-path="assistant.fullAccess"]';
const PERMISSION = {
  off: scene("Full access turned off", { play: loaded, story: { ready: `${FULL_ACCESS} [data-selected="false"], ${FULL_ACCESS} input:not(:checked)` } }),
  on: scene("Full access turned on", { play: async page => { await page.getByRole("switch", { name: "Full access" }).click(); },
    story: { ready: `${FULL_ACCESS} input:checked:enabled` } }),
} satisfies Record<"off" | "on", Story>;

/** The Account page when its settings read fails: the credential recovery notice, with one sentence of guidance. */
const CREDENTIAL_RECOVERY = {
  "read-failed": scene("Credentials that could not be read", { section: "credentials", server: { read: "fail" }, story: { ready: 'text="Credentials unavailable; reopen Settings to try again."' } }),
} satisfies Record<"read-failed", Story>;

export const SETTINGS_STORIES = defineSurface("settings", {
  load: LOAD, section: SECTION, resolution: RESOLUTION, runtime: RUNTIME, credentials: CREDENTIALS, "credential-recovery": CREDENTIAL_RECOVERY, "credential-combo": CREDENTIAL_COMBO,
  refresh: REFRESH, save: SAVE, "save-combo": SAVE_COMBO, chatgpt: CHATGPT, plan: PLAN, delete: DELETE, search: SEARCH, dialog: DIALOG, action: ACTION, "duo-keys": DUO_KEYS, notice: NOTICE,
  permission: PERMISSION,
});

