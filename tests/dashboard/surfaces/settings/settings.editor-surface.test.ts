import { FixtureCommandBinding } from "../../../support/helpers/dashboard/command-binding.js";
import { syntheticSettingsAuthority } from "../../../support/helpers/dashboard/settings-harness.js";
import { FIXTURE_EDITABLE_SETTINGS, FIXTURE_STORAGE_RELOCATION } from "../../../parity/helpers/fixture-settings.js";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,describe,it,vi } from "vitest";
import { createDashboardClient, type DashboardClient } from "../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import { settingInput } from "../../../../src/dashboard/surfaces/settings/editor/settings-draft-model.js";
import { useEditableSettings } from "../../../../src/dashboard/surfaces/settings/editor/settings-editor-model.js";
import { SettingsPage } from "../../../../src/dashboard/surfaces/settings/settings.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../../src/models/failures/error-catalog.js";
import { StorageHealthSummaryWireSchema } from "../../../../src/models/dashboard/bootstrap.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const DOCUMENT = FIXTURE_EDITABLE_SETTINGS;

const STORAGE = StorageHealthSummaryWireSchema.parse({ authority: "healthy", backup: "current", checkedAt: "2026-08-28T17:00:00.000Z" });
let root: Root | undefined;
let host: HTMLElement | undefined;
const authorities: Awaited<ReturnType<typeof syntheticSettingsAuthority>>[] = [];

afterEach(async () => {
  if (root !== undefined) act(() => { root?.unmount(); });
  host?.remove();
  vi.useRealTimers();
  for (const authority of authorities.splice(0)) await authority.close();
  root = undefined;
  host = undefined;
});

async function settingsClient(applied: unknown[], mode: "confirmed" | "held" | "lost" = "confirmed") {
  const authority = await syntheticSettingsAuthority();
  authorities.push(authority);
  let stored = false;
  let release!: () => void;
  const responseReady = mode === "held" ? new Promise<void>(resolve => { release = resolve; }) : Promise.resolve();
  const client = createDashboardClient({ baseUrl: "http://127.0.0.1:43210", fetchImpl: async (url, init) => {
    if (url.endsWith("/settings/editable")) return new Response(JSON.stringify(stored ? authority.read() : DOCUMENT), { status: 200 });
    if (url.endsWith("/settings/storage-relocation")) return new Response(JSON.stringify(FIXTURE_STORAGE_RELOCATION), { status: 200 });
    if (url.endsWith("/commands") && typeof init?.body === "string") {
      const request: unknown = JSON.parse(init.body);
      applied.push(request);
      const result = authority.execute(request);
      stored = true;
      if (mode === "lost") throw new Error("synthetic-uncertain");
      await responseReady;
      return new Response(JSON.stringify(result), { status: 200 });
    }
    throw new Error("unexpected-settings-editor-request");
  } });
  return { client, authority, release: () => { release(); } };
}

async function mountSettingsPage(client: DashboardClient, section: string,
  onExitGuardChange?: (guard: ((proceed: () => void) => void) | undefined) => void,
  nowIso = "2026-08-28T18:00:00.000Z") {
  const element = document.createElement("div");
  host = element;
  document.body.append(element);
  await act(async () => {
    root = createRoot(element);
    root.render(createElement(DashboardClientProvider, { client,
      children: createElement(FixtureCommandBinding, { actorId: "local-operator", nowIso,
        children: createElement(SettingsPage, { onClose: () => undefined, storage: STORAGE, sections: [],
          workflowLabels: new Map<string, string>(), section, actorId: "local-operator",
          descriptorFingerprint: "d".repeat(64), preflight: [], onSection: () => undefined,
          ...(onExitGuardChange === undefined ? {} : { onExitGuardChange }) }),
      }),
    }));
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
  it("guards retained workflow credentials before leaving after an unconfirmed write", async () => {
    let guard: ((proceed: () => void) => void) | undefined;
    let exited = 0;
    const transport = await settingsClient([], "lost");
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
    assert.match(document.body.textContent ?? "", /Discard unsaved settings\?/u);
    await act(async () => overlayButton("Keep editing").click());
    assert.equal(input.value, "synthetic-local");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1250)); });
    assert.match(host.textContent ?? "", /Credentials write unconfirmed/u);
    assert.ok(host.textContent?.includes(formatErrorCatalogFailure(createErrorCatalogFailure("COMMAND_OUTCOME_UNCERTAIN", {})).text));
    assert.equal(button("Retry exact attempt").disabled, false);
    assert.equal(transport.authority.credentials.read().revision, 2, "the lost response retains an actually stored protected write");
    await act(async () => guard?.(() => { exited += 1; }));
    assert.match(document.body.textContent ?? "", /A write already submitted may still be stored/u);
    assert.equal(exited, 0);
    await act(async () => overlayButton("Keep editing").click());
    assert.equal(exited, 0);
    assert.equal(input.value, "synthetic-local");
    assert.doesNotMatch(host.textContent ?? "", /Provider keys|Add key/u);
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
    assert.equal(document.activeElement, navigation, "the editable control accepts keyboard focus");
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
    assert.match(document.body.textContent ?? "", /Discard unsaved settings\?/u);
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
    assert.equal(host.querySelector('[data-settings-path="display.viewport"]'), null);
    assert.equal(host.querySelectorAll('input[name="display.screenWidth"], input[name="display.screenHeight"]').length, 2);
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

  it("autosaves valid production routes after 700 ms but retains invalid partial URLs", async () => {
    const applied: unknown[] = [];
    const transport = await settingsClient(applied);
    host = await mountSettingsPage(transport.client, "routes");
    assert.match(host.textContent ?? "", /Routes/u);
    assert.doesNotMatch(host.textContent ?? "", /Test routes/u);
    const input = host.querySelector('[data-settings-path="urls.crm.prod"] input');
    if (!(input instanceof HTMLInputElement)) throw new Error("missing CRM route input");
    const crm = DOCUMENT.sections.flatMap(section => section.leaves).find(leaf => leaf.path === "urls.crm.prod");
    assert.ok(crm);
    const original = settingInput(crm);
    assert.notEqual(typeof original, "string");
    vi.useFakeTimers();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter === undefined) throw new Error("HTML input value setter is unavailable");
    const enter = async (value: string): Promise<void> => { await act(async () => {
      Reflect.apply(setter, input, [value]);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }); };
    await enter("https://");
    await act(async () => { await vi.advanceTimersByTimeAsync(701); });
    assert.equal(applied.length, 0, "an invalid partial URL stays in the draft");
    await enter("https://crm.example.test/new");
    await act(async () => { await vi.advanceTimersByTimeAsync(699); });
    assert.equal(applied.length, 0, "route edits wait for the debounce");
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    assert.equal(applied.length, 1);
    assert.doesNotMatch(host.textContent ?? "", /Save routes/u);
    const command = applied[0] as { payload: { patch: Record<string, { set: Record<string, string> }> } };
    assert.equal(command.payload.patch["urls.crm.prod"]?.set.entry, "https://crm.example.test/new");
    assert.equal(transport.authority.read().revision, 2);
    assert.deepEqual(transport.authority.read().sections.flatMap(section => section.leaves).find(leaf => leaf.path === "urls.crm.prod")?.settingsValue, command.payload.patch["urls.crm.prod"]?.set);
    assert.equal(typeof original, "object");
    if (typeof original === "string") throw new Error("CRM route values are not an object");
    assert.deepEqual(command.payload.patch["urls.crm.prod"]?.set, { ...original, entry: "https://crm.example.test/new" }, "editing one row retains the other four URLs");
  });
});

it("publishes a failed refresh while retaining the verified document and unsaved draft", async () => {
  let fail = false;
  let controller: ReturnType<typeof useEditableSettings> | undefined;
  const client = { editableSettings: () => fail ? Promise.reject(new Error("synthetic read failure")) : Promise.resolve(DOCUMENT),
    storageRelocationPlans: () => Promise.reject(new Error("synthetic no relocation")),
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
  assert.match(current().readProblem ?? "", /could not be read.*drafts are retained/u);
  assert.deepEqual(current().draft, retained);
  assert.equal(current().dirtyCount, 1);
});

for (const section of ["general", "paths", "routes", "performance"]) for (const mode of ["failed", "hung"]) {
  it(`renders the catalog body in the ${section} failed part after a ${mode} initial read`, async () => {
    vi.useFakeTimers();
    const client = { editableSettings: () => mode === "hung" ? new Promise(() => {}) : Promise.reject(new Error("private fixture error")),
      storageRelocationPlans: () => Promise.resolve(FIXTURE_STORAGE_RELOCATION),
    } as unknown as DashboardClient;
    const dom = await mountSettingsPage(client, section);
    if (mode === "hung") await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    const title = section === "routes" ? "Routes could not be read" : "Editable settings could not be read";
    const failure = [...dom.querySelectorAll('[role="alert"]')].find(alert => alert.textContent?.includes(title));
    assert.ok(failure);
    assert.ok(failure.textContent?.includes(ERROR_CATALOG.SETTINGS_INITIAL_READ_UNAVAILABLE.text));
    assert.doesNotMatch(failure.textContent ?? "", /private fixture error/);
  });
}

import { ERROR_CATALOG } from "../../../../src/models/failures/error-catalog.js";
