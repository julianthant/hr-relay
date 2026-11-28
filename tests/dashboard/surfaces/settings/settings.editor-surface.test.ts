import { FIXTURE_EDITABLE_SETTINGS } from "../../../support/helpers/dashboard/mock-world/fixture-settings.js";
import { ToastProvider } from "../../../../src/dashboard/ds/ui.js";
import { FixtureCommandBinding } from "../../../support/helpers/dashboard/command-binding.js";
import { syntheticSettingsAuthority } from "../../../support/helpers/dashboard/settings-harness.js";
import { ProtectedSettingsApplyInputSchema } from "../../../../src/models/config/protected-settings.js";
import { ProtectedSettingsCommandRequestSchema, deriveSettingsCommandFingerprint } from "../../../../src/rules/commands/commands.js";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement, type ComponentProps } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,describe,it,vi } from "vitest";
import { createDashboardClient,createRowStore,type DashboardClient,type RowStoreWriter } from "../../../../src/dashboard/client/index.js";
import { StreamRowSchema } from "../../../../src/models/dashboard/subscription.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import { useEditableSettings } from "../../../../src/dashboard/surfaces/settings/editor/settings-editor-model.js";
import { ProtectedPencilRow } from "../../../../src/dashboard/surfaces/settings/providers/protected-pencil-row.js";
import { SettingsPage, SettingsRefreshMark } from "../../../../src/dashboard/surfaces/settings/settings.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const DOCUMENT = FIXTURE_EDITABLE_SETTINGS;

let root: Root | undefined;
let host: HTMLElement | undefined;
/** The stream's rows for the page `settingsClient` serves: each applied ordinary save delivers its settings row. */
let streamRows: RowStoreWriter | undefined;
const authorities: Awaited<ReturnType<typeof syntheticSettingsAuthority>>[] = [];

afterEach(async () => {
  if (root !== undefined) act(() => { root?.unmount(); });
  host?.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const authority of authorities.splice(0)) await authority.close();
  root = undefined;
  host = undefined;
  streamRows = undefined;
});

async function settingsClient(applied: unknown[], mode: "confirmed" | "held" | "lost" = "confirmed") {
  const authority = await syntheticSettingsAuthority();
  authorities.push(authority);
  let stored = false;
  const rows = createRowStore();
  streamRows = rows;
  let release!: () => void;
  const responseReady = mode === "held" ? new Promise<void>(resolve => { release = resolve; }) : Promise.resolve();
  const client = createDashboardClient({ baseUrl: "http://127.0.0.1:43210", fetchImpl: async (url, init) => {
    if (url.endsWith("/settings/editable")) return new Response(JSON.stringify(stored || mode === "lost" ? authority.read() : DOCUMENT), { status: 200 });
    if (url.endsWith("/commands") && typeof init?.body === "string") {
      const request: unknown = JSON.parse(init.body);
      applied.push(request);
      if (mode === "lost") {
        const command = ProtectedSettingsCommandRequestSchema.parse(request);
        const result = authority.credentials.apply(ProtectedSettingsApplyInputSchema.parse({
          ...command.payload, commandId: command.commandId, commandFingerprint: deriveSettingsCommandFingerprint(command),
          expectedRevision: command.target.expectedRevision, updatedAt: command.requestedAt,
        }));
        assert.equal(result.state, "applied");
        throw new Error("synthetic-uncertain");
      }
      const result = authority.execute(request);
      stored = true;
      if (result.state === "applied" && result.settingsRevision !== undefined) {
        rows.apply([StreamRowSchema.parse({ model: "settings", key: "editable", value: { state: "available", value: authority.read() } })]);
      }
      await responseReady;
      return new Response(JSON.stringify(result), { status: 200 });
    }
    throw new Error("unexpected-settings-editor-request");
  } });
  return { client, authority, release: () => { release(); } };
}

async function mountSettingsPage(client: DashboardClient, section: string,
  onExitGuardChange?: (guard: ((proceed: () => void) => void) | undefined) => void,
  nowIso = "2026-08-28T18:00:00.000Z", profileName = "Synthetic Operator", accountPage?: ComponentProps<typeof SettingsPage>["accountPage"], onSection: (next: string) => void = () => undefined, extra: Partial<ComponentProps<typeof SettingsPage>> = {}) {
  const element = document.createElement("div");
  host = element;
  document.body.append(element);
  await act(async () => {
    root = createRoot(element);
    root.render(createElement(ToastProvider, { children: createElement(DashboardClientProvider, { client,
      children: createElement(FixtureCommandBinding, { actorId: "local-operator", nowIso, ...(streamRows === undefined ? {} : { rows: streamRows }),
        children: createElement(SettingsPage, { profileName, onClose: () => undefined,
          section, actorId: "local-operator",
          descriptorFingerprint: "d".repeat(64), onSection,
          ...(onExitGuardChange === undefined ? {} : { onExitGuardChange }), ...(accountPage === undefined ? {} : { accountPage }), ...extra }),
      }),
    }) }));
  });
  await act(async () => undefined);
  return element;
}

function button(name: string): HTMLButtonElement {
  const found = [...(host?.querySelectorAll("button") ?? [])].find((candidate) => candidate.textContent === name);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`missing ${name} button`);
  return found;
}

function overlayButton(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === name);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`missing ${name} overlay button`);
  return found;
}

describe("editable Settings surface", () => {
  it("shows the served profile name and per-word initials without editable or removal controls", async () => {
    const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async url => {
      if (String(url).endsWith("/settings/editable")) return Response.json(DOCUMENT);
      throw new Error("unexpected-read-only-settings-request");
    } });
    host = await mountSettingsPage(client, "credentials", undefined, "2026-08-28T18:00:00.000Z", "Synthetic Middle Operator");
    assert.match(host.textContent ?? "", /Timekeeper nameSynthetic Middle Operator/u);
    assert.match(host.textContent ?? "", /Timekeeper initialsSMO/u);
    assert.doesNotMatch(host.textContent ?? "", /Historical Activity pseudonym/u);
    assert.equal(host.querySelector('input[name="timekeeperName"]') === null, true);
    assert.equal(host.querySelector('input[name="activityPersonPseudonym"]') === null, true);
    assert.equal(host.querySelector('button[aria-label="Remove Timekeeper name"]') === null, true);
    assert.equal(host.querySelector('button[aria-label="Remove Timekeeper initials"]') === null, true);
    assert.equal(host.querySelectorAll("input").length, 3, "navigation search and the two UCPath credentials remain editable");
  });

  it("guards a credentials draft, then settles a lost write by reading it back", async () => {
    let guard: ((proceed: () => void) => void) | undefined;
    let exited = 0;
    const applied: unknown[] = [];
    const transport = await settingsClient(applied, "lost");
    const initialRevision = transport.authority.credentials.read().revision;
    host = await mountSettingsPage(transport.client, "credentials", next => { guard = next; });
    const input = host.querySelector<HTMLInputElement>('input[name="ucpathUserId"]');
    assert.ok(input);
    await act(async () => { // eslint-disable-next-line @typescript-eslint/unbound-method
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (setter === undefined) throw new Error("input setter unavailable");
      Reflect.apply(setter, input, ["synthetic-local"]); input.dispatchEvent(new Event("input", { bubbles: true })); });
    assert.ok(guard);
    await act(async () => guard?.(() => { exited += 1; }));
    assert.equal(exited, 0);
    assert.match(document.body.textContent ?? "", /Discard changes\?/u);
    await act(async () => overlayButton("Keep editing").click());
    assert.equal(input.value, "synthetic-local");
    // The lost reply is read back by itself, never resent; the stored write ends as saved with no message.
    await vi.waitFor(async () => {
      await act(async () => undefined);
      assert.equal(applied.length, 1);
      assert.equal(transport.authority.credentials.read().revision, initialRevision + 1);
      assert.equal(input.disabled, false);
      assert.equal(input.value, "synthetic-local", "the served username replaces the draft");
    }, { timeout: 8000, interval: 100 });
    assert.equal(applied.length, 1, "read-back does not resend the write");
    assert.doesNotMatch(host.textContent ?? "", /unconfirmed|Retry exact attempt|outcome is uncertain/u);
    await act(async () => guard?.(() => { exited += 1; }));
    assert.equal(exited, 1, "nothing is left to guard once the save settles");
    assert.doesNotMatch(host.textContent ?? "", /Provider keys|Add key/u);
  });

  it("asks before a sidebar switch with an unsaved draft, and both answers work", async () => {
    const opened: string[] = [];
    const transport = await settingsClient([]);
    host = await mountSettingsPage(transport.client, "credentials", undefined, "2026-08-28T18:00:00.000Z", "Synthetic Operator", undefined, next => { opened.push(next); });
    const link = () => [...host!.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Settings sections"] a')].find(candidate => candidate.getAttribute("href") === "?settings=general")!;
    const input = host.querySelector<HTMLInputElement>('input[name="ucpathUserId"]');
    assert.ok(input);
    await act(async () => { // eslint-disable-next-line @typescript-eslint/unbound-method
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (setter === undefined) throw new Error("input setter unavailable");
      Reflect.apply(setter, input, ["synthetic-local"]); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => link().click());
    assert.deepEqual(opened, []);
    assert.match(document.body.textContent ?? "", /Discard changes\?/u);
    await act(async () => overlayButton("Keep editing").click());
    assert.deepEqual(opened, []);
    assert.equal(input.value, "synthetic-local");
    await act(async () => link().click());
    await act(async () => overlayButton("Discard changes").click());
    assert.deepEqual(opened, ["general"]);
  });

  it("keeps the Fix banner pinned and the target row highlighted until the operator touches it", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => { callback(0); }, 0));
    Element.prototype.scrollIntoView = () => undefined;
    Element.prototype.getClientRects = () => [new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList;
    const transport = await settingsClient([]);
    host = await mountSettingsPage(transport.client, "credentials", undefined, "2026-08-28T18:00:00.000Z", "Synthetic Operator", undefined, undefined, { backToRun: true, searchTarget: "profile.displayName" });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
    assert.ok(host.querySelector(".settings-fix-banner"));
    const row = host.querySelector('[data-settings-path="profile.displayName"]');
    assert.equal(row?.getAttribute("data-held"), "true");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1600)); });
    assert.equal(row?.getAttribute("data-held"), "true", "the cue does not fade on a timer");
    await act(async () => { row?.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    assert.equal(row?.hasAttribute("data-held"), false);
  });

  it("autosaves one atomic leaf-operation draft when the exit dialog takes focus", async () => {
    const applied: unknown[] = [];
    let closeCount = 0;
    let exitGuard: ((proceed: () => void) => void) | undefined;
    const transport = await settingsClient(applied, "held");
    host = await mountSettingsPage(transport.client, "performance", guard => { exitGuard = guard; });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-28T18:00:00.000Z"));

    const navigation = host.querySelector('[data-settings-path="timeouts.navigationMs"] input');
    assert.ok(navigation instanceof HTMLInputElement);
    assert.equal(navigation.disabled, false);
    await act(async () => { navigation.focus(); });
    assert.equal(document.activeElement === navigation, true, "the editable control accepts keyboard focus");
    await act(async () => {
      // React's controlled-input tracker requires the native setter bypass here.
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      if (descriptor?.set === undefined) throw new Error("HTML input value setter is unavailable");
      // eslint-disable-next-line @typescript-eslint/unbound-method
      Reflect.apply(descriptor.set, navigation, ["111"]);
      navigation.dispatchEvent(new Event("input", { bubbles: true }));
      navigation.dispatchEvent(new Event("change", { bubbles: true }));
    });
    assert.equal([...host.querySelectorAll<HTMLButtonElement>("button")].some(button => button.textContent === "Undo"), false, "the retained draft has no visible undo button");
    if (exitGuard === undefined) throw new Error("Settings exit guard was not registered");
    await act(async () => { exitGuard?.(() => { closeCount += 1; }); });
    assert.equal(closeCount, 0, "a dirty page cannot navigate away without a choice");
    assert.match(document.body.textContent ?? "", /Discard changes\?/u);
    assert.equal(applied.length, 1, "leaving the edited input flushes its valid draft");
    const beforeUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload);
    assert.equal(beforeUnload.defaultPrevented, true, "a dirty draft protects against browser unload");
    await act(async () => { overlayButton("Keep editing").click(); });
    assert.equal(closeCount, 0);
    await act(async () => { transport.release(); });
    assert.equal(transport.authority.read().revision, 2);
    assert.equal(transport.authority.read().sections.flatMap(section => section.leaves).find(leaf => leaf.path === "timeouts.navigationMs")?.settingsValue, 111000);
    assert.throws(() => button("Save changes"));
    const form = host.querySelector("form");
    if (!(form instanceof HTMLFormElement)) throw new Error("editable Settings did not render an atomic form");
    await act(async () => { await vi.advanceTimersByTimeAsync(701); });
    assert.equal(applied.length, 1);
    const command = applied[0] as { target: { expectedRevision: number }; payload: { patch: unknown } };
    assert.equal(command.target.expectedRevision, 1);
    assert.deepEqual(command.payload.patch, {
      "timeouts.navigationMs": { set: 111000 },
    });
    assert.equal((applied[0] as { requestedAt: string }).requestedAt, "2026-08-28T18:00:00.000Z");
  });

  it("refuses a cleared zero-allowed OCR field instead of converting it to zero", async () => {
    const applied: unknown[] = [];
    let closeCount = 0;
    let exitGuard: ((proceed: () => void) => void) | undefined;
    const transport = await settingsClient(applied);
    host = await mountSettingsPage(transport.client, "performance", guard => { exitGuard = guard; });
    vi.useFakeTimers();
    const ocrDisclosure = [...(host?.querySelectorAll(".settings-performance-disclosure button") ?? [])].find(candidate => candidate.textContent?.includes("OCR processing"));
    if (!(ocrDisclosure instanceof HTMLButtonElement)) throw new Error("missing OCR processing disclosure");
    await act(async () => { ocrDisclosure.click(); });
    const pageConcurrency = host.querySelector('[data-settings-path="ocr.pageConcurrency"] input');
    if (!(pageConcurrency instanceof HTMLInputElement)) throw new Error("missing OCR page concurrency input");
    await act(async () => {
      // React's controlled-input tracker requires the native setter bypass here.
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      if (descriptor?.set === undefined) throw new Error("HTML input value setter is unavailable");
      // eslint-disable-next-line @typescript-eslint/unbound-method
      Reflect.apply(descriptor.set, pageConcurrency, [""]);
      pageConcurrency.dispatchEvent(new Event("input", { bubbles: true }));
      pageConcurrency.dispatchEvent(new Event("change", { bubbles: true }));
    });
    assert.match(host.textContent ?? "", /Enter a whole number of at least 0\./u);
    await act(async () => { await vi.advanceTimersByTimeAsync(701); });
    assert.equal(applied.length, 0);
    if (exitGuard === undefined) throw new Error("Settings exit guard was not registered");
    await act(async () => { exitGuard?.(() => { closeCount += 1; }); });
    await act(async () => { overlayButton("Discard changes").click(); });
    assert.equal(closeCount, 1, "explicit discard is the only dirty-draft exit");
  });

  it("uses the shared segmented job-end date picker and keeps incomplete edits unsent", async () => {
    const applied: unknown[] = [];
    const transport = await settingsClient(applied);
    host = await mountSettingsPage(transport.client, "general");
    vi.useFakeTimers();
    const datePath = `annualDates.FY${String(DOCUMENT.currentFiscalYear)}.jobEndDate`;
    assert.equal(host.querySelector('[data-settings-path="display.viewport"]') === null, true);
    assert.equal(host.querySelector('[data-settings-path="browser.headless"]') === null, true, "the browser window choice lives only in the run options");
    assert.equal(host.querySelectorAll('input[name="display.screenWidth"], input[name="display.screenHeight"]').length, 0);
    const date = host.querySelector(`[data-settings-path="${datePath}"] .ds-date-picker`);
    assert.ok(date);
    assert.equal(date.querySelectorAll('.ds-date-text-input').length, 0);
    const segments = date.querySelectorAll<HTMLElement>('[role="spinbutton"]');
    assert.equal(segments.length, 3);
    const month = segments[0]; assert.ok(month);
    await act(async () => { month.focus(); month.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true })); month.dispatchEvent(new KeyboardEvent("keyup", { key: "Backspace", bubbles: true })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(701); });
    assert.equal(applied.length, 0, "incomplete date edits cannot produce a settings command");
    assert.ok(date.querySelector('button[aria-label="Choose job end date"]'));
  });

  it("shows the served Relay username and the saved UCPath username each in its own row, with no password in the page", async () => {
    const transport = await settingsClient([], "lost");
    assert.equal(transport.authority.protectedApply({ ucpathUserId: { set: "ucpath.person@ucsd.edu" }, ucpathPassword: { set: "saved-ucpath-secret" } }).state, "applied");
    const client = transport.client;
    const values = { name: "Synthetic Operator", initials: "SO", timekeeper: "Synthetic Operator", timekeeperInitials: "SO", lastSignedInAt: "2026-08-28T08:00:00-08:00" };
    const page = (username?: string) => ({ values: { ...values, ...(username === undefined ? {} : { username }) }, details: async () => ({ state: "refused", code: "PROFILE_INITIALS_REFUSED" }) as never, login: { changePassword: async () => ({ state: "changed" }) as never, changeUsername: async () => ({ state: "changed" }) as never } });
    host = await mountSettingsPage(client, "account", undefined, undefined, undefined, page("relay.person@ucsd.edu"));
    assert.match(host.textContent ?? "", /Usernamerelay\.person@ucsd\.edu/u);
    assert.match(host.textContent ?? "", /Usernameucpath\.person@ucsd\.edu/u);
    assert.doesNotMatch(document.body.innerHTML, /saved-ucpath-secret/u);
    act(() => root?.unmount()); host.remove();
    host = await mountSettingsPage(client, "account", undefined, undefined, undefined, page());
    assert.match(host.textContent ?? "", /UsernameShown after your next sign-in/u);
    assert.match(host.textContent ?? "", /Usernameucpath\.person@ucsd\.edu/u);
    assert.doesNotMatch(document.body.innerHTML, /saved-ucpath-secret/u);
  });

  it("holds a UCPath pencil-dialog draft through the timer, blur, Escape and Cancel and writes only on Save", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const applied: unknown[] = [];
    const transport = await settingsClient(applied);
    host = await mountSettingsPage(transport.client, "account", undefined, undefined, undefined,
      { values: { name: "Synthetic Operator", initials: "SO", timekeeper: "Synthetic Operator", timekeeperInitials: "SO", lastSignedInAt: "2026-08-28T08:00:00-08:00" },
        details: async () => ({ state: "refused", code: "PROFILE_INITIALS_REFUSED" }), login: { changePassword: async () => ({ state: "changed" }), changeUsername: async () => ({ state: "changed" }) } });
    const open = async (): Promise<HTMLInputElement> => {
      const pencil = host?.querySelector<HTMLButtonElement>('button[aria-label="Edit UCPath username"]');
      assert.ok(pencil);
      await act(async () => pencil.click());
      const field = document.body.querySelector<HTMLInputElement>('[role="dialog"] input[name="ucpathUserId"]');
      assert.ok(field);
      return field;
    };
    const type = async (field: HTMLInputElement, value: string): Promise<void> => {
      await act(async () => { // eslint-disable-next-line @typescript-eslint/unbound-method
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        if (setter === undefined) throw new Error("input setter unavailable");
        Reflect.apply(setter, field, [value]); field.dispatchEvent(new Event("input", { bubbles: true })); });
    };
    const wait = async (): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(5000); }); };
    let field = await open();
    await type(field, "held-operator"); await wait();
    assert.equal(applied.length, 0, "the autosave timer does not write the dialog draft");
    await act(async () => { field.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); }); await wait();
    assert.equal(applied.length, 0, "blur does not write the dialog draft");
    await act(async () => { document.body.querySelector('[role="dialog"]')?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); }); await wait();
    assert.equal(document.body.querySelector('[role="dialog"]') === null, true);
    assert.equal(applied.length, 0, "Escape discards without a write");
    field = await open();
    assert.equal(field.value, "", "the discarded draft is gone");
    await type(field, "cancelled-operator");
    await act(async () => overlayButton("Cancel").click()); await wait();
    assert.equal(applied.length, 0, "Cancel discards without a write");
    field = await open();
    await type(field, "saved-operator");
    await act(async () => overlayButton("Save").click());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    assert.equal(applied.length, 1, "Save writes exactly once");
  });
});

it("publishes a failed refresh while retaining the verified document and unsaved draft", async () => {
  let fail = false;
  let controller: ReturnType<typeof useEditableSettings> | undefined;
  const client = { editableSettings: () => fail ? Promise.reject(new Error("synthetic read failure")) : Promise.resolve(DOCUMENT),
  } as unknown as DashboardClient;
  function Surface() { controller = useEditableSettings({ actorId: "local-operator", descriptorFingerprint: "d".repeat(64) }); return null; }
  host = document.createElement("div"); document.body.append(host);
  await act(async () => { root = createRoot(host!); root.render(createElement(DashboardClientProvider, { client, children: createElement(FixtureCommandBinding, { actorId: "local-operator", children: createElement(Surface) }) })); });
  assert.ok(controller);
  const current = () => { if (controller === undefined) throw new Error("missing editor"); return controller; };
  const leaf = current().leaves.find(candidate => candidate.input === "text");
  assert.ok(leaf);
  await act(async () => current().update(leaf.path, "synthetic retained draft"));
  const retained = structuredClone(current().draft);
  fail = true;
  await act(async () => current().reload());
  assert.equal(current().editor.state, "loaded");
  assert.match(current().readProblem ?? "", /Settings could not refresh\. Your drafts are kept\./u);
  assert.deepEqual(current().draft, retained);
  assert.equal(current().dirtyCount, 1);
});

/** The Settings page over providers that stay mounted, so closing and opening it again is a re-read of the kept document. */
function mountReopenable(client: DashboardClient, page?: () => ReturnType<typeof createElement>): (open: boolean) => Promise<void> {
  host = document.createElement("div"); document.body.append(host);
  const element = host;
  return async open => { await act(async () => {
    root ??= createRoot(element);
    root.render(createElement(ToastProvider, { children: createElement(DashboardClientProvider, { client,
      children: createElement(FixtureCommandBinding, { actorId: "local-operator", nowIso: "2026-08-28T18:00:00.000Z",
        children: open ? page?.() ?? createElement(SettingsPage, { profileName: "Synthetic Operator", onClose: () => undefined, section: "general", actorId: "local-operator", descriptorFingerprint: "d".repeat(64), onSection: () => undefined }) : null }) }) }));
  }); await act(async () => undefined); };
}

it("keeps the real Settings fields enabled over a held re-read and keeps an edit when a distinct response lands", async () => {
  const authority = await syntheticSettingsAuthority(); authorities.push(authority);
  const first = authority.read();
  authority.apply({ "actor.label": { set: "Distinct served label" } });
  const distinct = authority.read();
  let calls = 0;
  let land: (() => void) | undefined;
  const client = { editableSettings: () => ++calls === 1 ? Promise.resolve(first) : new Promise(resolve => { land = () => resolve(distinct); }),
  } as unknown as DashboardClient;
  const render = mountReopenable(client);
  await render(true); await render(false); await render(true);
  await vi.waitFor(() => { assert.equal(calls, 2); });
  assert.ok(host);
  const rows = [...host.querySelectorAll("[data-settings-path]")];
  assert.ok(rows.length > 0);
  const disabled = rows.flatMap(row => [...row.querySelectorAll<HTMLElement>("input, button, select, [role='switch'], [role='spinbutton']")].filter(control => control.matches(":disabled, [aria-disabled='true']"))).length;
  assert.equal(disabled, 0, "no served field is disabled while the re-read is held");
  const date = host.querySelector<HTMLElement>('[data-settings-path$=".jobEndDate"] [role="spinbutton"]');
  assert.ok(date);
  const toggle = host.querySelector<HTMLInputElement>('[data-settings-path="preferences.preventSleepWhileRunning"] input');
  assert.ok(toggle);
  const before = toggle.checked;
  await act(async () => toggle.click());
  assert.notEqual(toggle.checked, before, "the edit shows at once");
  await act(async () => { land?.(); });
  assert.notEqual(host.querySelector<HTMLInputElement>('[data-settings-path="preferences.preventSleepWhileRunning"] input')?.checked, before, "the edit stays visible after the distinct response lands");
});

it("keeps an explicit username Save visible and unsent until the held re-read lands", async () => {
  const authority = await syntheticSettingsAuthority(); authorities.push(authority);
  const doc = authority.read();
  let calls = 0;
  const writes: unknown[] = [];
  const client = { editableSettings: () => ++calls === 1 ? Promise.resolve(doc) : new Promise(() => undefined),
    executeCommand: (request: unknown) => { writes.push(request); return Promise.reject(new Error("held")); } } as unknown as DashboardClient;
  function PencilProbe() {
    const editor = useEditableSettings({ actorId: "local-operator", descriptorFingerprint: "d".repeat(64) });
    return createElement(ProtectedPencilRow, { editor, name: "ucpathUserId", label: "Username", thing: "UCPath username", description: "Login name." });
  }
  const render = mountReopenable(client, () => createElement(PencilProbe));
  await render(true); await render(false); await render(true);
  await vi.waitFor(() => { assert.equal(calls, 2); });
  assert.ok(host);
  await act(async () => (host?.querySelector('button[aria-label="Edit UCPath username"]') as HTMLButtonElement | null)?.click());
  const input = document.body.querySelector<HTMLInputElement>('[role="dialog"] input[name="ucpathUserId"]');
  assert.ok(input);
  await act(async () => { // eslint-disable-next-line @typescript-eslint/unbound-method
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter === undefined) throw new Error("input setter unavailable");
    Reflect.apply(setter, input, ["held-username"]); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => overlayButton("Save").click());
  assert.equal(writes.length, 0, "nothing is sent over a held read");
  assert.match(host.querySelector('[data-settings-path="protected.ucpathUserId"]')?.textContent ?? "", /held-username/u);
});

it("keeps a refused username off the closed row and unsent when the Password editor is opened and canceled", async () => {
  const authority = await syntheticSettingsAuthority(); authorities.push(authority);
  const served = authority.read();
  const stored = served.protectedSettings.state === "available" ? served.protectedSettings.entries.ucpathUserId?.value : undefined;
  assert.equal(typeof stored, "string");
  const writes: unknown[] = [];
  const client = createDashboardClient({ baseUrl: "http://127.0.0.1:43210", fetchImpl: async (url, init) => {
    if (url.endsWith("/settings/editable")) return new Response(JSON.stringify(served), { status: 200 });
    if (url.endsWith("/commands") && typeof init?.body === "string") {
      const request = JSON.parse(init.body) as { commandId: string };
      writes.push(request);
      return new Response(JSON.stringify({ state: "rejected", commandId: request.commandId, code: "not-editable", message: "This setting cannot be changed." }), { status: 422 });
    }
    throw new Error("unexpected-settings-editor-request");
  } });
  function TwoRows() {
    const editor = useEditableSettings({ actorId: "local-operator", descriptorFingerprint: "d".repeat(64) });
    return createElement("div", null,
      createElement(ProtectedPencilRow, { editor, name: "ucpathUserId", label: "Username", thing: "UCPath username", description: "Login name." }),
      createElement(ProtectedPencilRow, { editor, name: "ucpathPassword", label: "Password", thing: "UCPath password", description: "Secret." }));
  }
  const render = mountReopenable(client, () => createElement(TwoRows));
  await render(true);
  const row = () => host?.querySelector('[data-settings-path="protected.ucpathUserId"]')?.textContent ?? "";
  const pencil = (label: string) => host?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  await vi.waitFor(() => { assert.ok(pencil("Edit UCPath username")); });
  await act(async () => pencil("Edit UCPath username")?.click());
  const input = document.body.querySelector<HTMLInputElement>('[role="dialog"] input[name="ucpathUserId"]');
  assert.ok(input);
  await act(async () => { // eslint-disable-next-line @typescript-eslint/unbound-method
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter === undefined) throw new Error("input setter unavailable");
    Reflect.apply(setter, input, ["refused-username"]); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => overlayButton("Save").click());
  await vi.waitFor(() => { assert.equal(writes.length, 1); });
  await vi.waitFor(() => { assert.match(row(), new RegExp(String(stored))); });
  await act(async () => pencil("Edit UCPath password")?.click());
  await act(async () => overlayButton("Cancel").click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 2000)); });
  assert.equal(writes.length, 1, "canceling Password sends no command");
  assert.doesNotMatch(row(), /refused-username/u);
  assert.match(row(), new RegExp(String(stored)));
});

it("shows a spinner on the credential row whose entry is being saved, and no other row", async () => {
  const applied: unknown[] = [];
  const transport = await settingsClient(applied, "held");
  host = await mountSettingsPage(transport.client, "credentials");
  const input = host.querySelector<HTMLInputElement>('input[name="ucpathUserId"]');
  assert.ok(input);
  await act(async () => { // eslint-disable-next-line @typescript-eslint/unbound-method
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter === undefined) throw new Error("input setter unavailable");
    Reflect.apply(setter, input, ["spinner-username"]); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => { host?.querySelector("form")?.requestSubmit(); });
  await vi.waitFor(() => { assert.equal(applied.length, 1); });
  assert.equal(host.querySelector('[data-settings-path="protected.ucpathUserId"] [aria-label="Saving"]') === null, false);
  assert.equal(host.querySelectorAll('[aria-label="Saving"]').length, 1, "the password row shows no spinner");
  await act(async () => { transport.release(); });
});

it("shows a spinner only on the row whose own command is held", async () => {
  const applied: unknown[] = [];
  const transport = await settingsClient(applied, "held");
  host = await mountSettingsPage(transport.client, "general");
  const toggle = host.querySelector<HTMLInputElement>('[data-settings-path="preferences.preventSleepWhileRunning"] input');
  assert.ok(toggle);
  const row = toggle.closest("[data-settings-path]");
  assert.ok(row);
  await act(async () => toggle.click());
  await vi.waitFor(() => { assert.equal(applied.length, 1); });
  assert.equal(row.querySelectorAll('[aria-label="Saving"]').length, 1);
  assert.equal(host.querySelectorAll('[aria-label="Saving"]').length, 1, "no other row shows a spinner");
  await act(async () => { transport.release(); });
  await vi.waitFor(() => { assert.equal(host?.querySelectorAll('[aria-label="Saving"]').length, 0); });
});

for (const section of ["general", "performance"]) for (const mode of ["failed", "hung"]) {
  it(`renders the one failed-read notice with Retry in the ${section} part after a ${mode} initial read`, async () => {
    vi.useFakeTimers();
    const client = { editableSettings: () => mode === "hung" ? new Promise(() => {}) : Promise.reject(new Error("private fixture error")),
    } as unknown as DashboardClient;
    const dom = await mountSettingsPage(client, section);
    if (mode === "hung") await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    const failure = [...dom.querySelectorAll('[role="alert"]')].find(alert => alert.textContent?.includes("Couldn't load settings."));
    assert.ok(failure);
    assert.ok([...failure.querySelectorAll("button")].some(button => button.textContent === "Retry"));
    assert.doesNotMatch(failure.textContent ?? "", /private fixture error/);
  });
}

it("marks a reload of the kept document with a named spinner after the wait, and drops it when the read lands", async () => {
  let reads = 0;
  let land!: () => void;
  const second = new Promise<void>(resolve => { land = resolve; });
  const client = { editableSettings: async () => { reads += 1; if (reads > 1) await second; return DOCUMENT; } } as unknown as DashboardClient;
  let controller: ReturnType<typeof useEditableSettings> | undefined;
  function Surface() {
    controller = useEditableSettings({ actorId: "local-operator", descriptorFingerprint: "d".repeat(64) });
    return controller.refreshing && controller.editor.state === "loaded" ? createElement(SettingsRefreshMark) : null;
  }
  host = document.createElement("div"); document.body.append(host);
  await act(async () => { root = createRoot(host!); root.render(createElement(DashboardClientProvider, { client, children: createElement(FixtureCommandBinding, { actorId: "local-operator", children: createElement(Surface) }) })); });
  const spinner = () => host?.querySelector('[data-settings-stale] [role="status"][aria-label="Refreshing"]')?.parentElement ?? undefined;
  assert.ok(spinner() === undefined);
  await act(async () => { controller?.reload(); });
  assert.ok(spinner()?.classList.contains("invisible"), "a fast reload shows a named spinner, still hidden");
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
  assert.equal(spinner()?.classList.contains("invisible"), false, "a slow reload shows the spinner");
  assert.doesNotMatch(host.textContent ?? "", /Updating/u);
  await act(async () => { land(); await second; });
  assert.ok(spinner() === undefined);
});
