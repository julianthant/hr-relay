import { FIXTURE_EDITABLE_SETTINGS } from "../../../../support/fixtures/dashboard/fixture-settings.js";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it, vi } from "vitest";
import {
  EditableSettingsLeafWireSchema,
  EditableSettingsWireSchema,
} from "../../../../../src/models/dashboard/settings-editor.js";
import { StorageHealthSummaryWireSchema } from "../../../../../src/models/dashboard/bootstrap.js";
import type { DashboardClient } from "../../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../../src/dashboard/state/client-context.js";
import { SettingsPageWithToast } from "../../../../support/fixtures/dashboard/settings-page-with-toast.js";
import { PROVIDER_KEYS_SCHEMA_HASH } from "../../../../../src/models/config/provider-keys.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const DOCUMENT = FIXTURE_EDITABLE_SETTINGS;

const STORAGE = StorageHealthSummaryWireSchema.parse({ authority: "healthy", backup: "current", checkedAt: "2026-08-28T17:00:00.000Z" });
let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  if (root !== undefined) act(() => { root?.unmount(); });
  host?.remove();
  vi.useRealTimers();
  root = undefined;
  host = undefined;
});

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
  it("guards provider drafts and explains an unconfirmed write before leaving", async () => {
    const providerDocument = EditableSettingsWireSchema.parse({ ...DOCUMENT,
      providerKeys: { state: "available", providerSchemaHash: PROVIDER_KEYS_SCHEMA_HASH, revision: 1,
        sourceVersionToken: "a".repeat(64), slots: { GEMINI_API_KEY: "synthetic-saved" },
        activeSlots: { GEMINI_API_KEY: "synthetic-saved" }, parentSlotNames: [], fileSlotNamesAtBoot: ["GEMINI_API_KEY"],
        bootFileRevision: 1, bootFileSourceVersionToken: "a".repeat(64), overriddenSlots: [], restartRequired: false },
    });
    let guard: ((proceed: () => void) => void) | undefined;
    let exited = 0;
    const client = { editableSettings: () => Promise.resolve(providerDocument),
      applyProviderKeys: () => Promise.reject(new Error("synthetic-uncertain")),
    } as unknown as DashboardClient;
    host = document.createElement("div"); document.body.append(host);
    await act(async () => { root = createRoot(host!); root.render(createElement(DashboardClientProvider, { client,
      children: createElement(SettingsPageWithToast, { storage: STORAGE, sections: [],
        workflowLabels: new Map<string, string>(), section: "credentials", actorId: "local-operator",
        descriptorFingerprint: "d".repeat(64), preflight: [], onSection: () => undefined,
        onExitGuardChange: next => { guard = next; } }),
    })); });
    await act(async () => undefined);
    await act(async () => button("Add key").click());
    assert.ok(guard);
    await act(async () => guard?.(() => { exited += 1; }));
    assert.equal(exited, 0);
    assert.match(document.body.textContent ?? "", /Discard unsaved settings\?/u);
    await act(async () => overlayButton("Keep editing").click());
    assert.equal(exited, 0);
    const input = [...host.querySelectorAll<HTMLInputElement>("input")].find(candidate => candidate.placeholder === "Enter API key" && candidate.value === "");
    assert.ok(input);
    await act(async () => { // eslint-disable-next-line @typescript-eslint/unbound-method
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (setter === undefined) throw new Error("input setter unavailable");
      Reflect.apply(setter, input, ["synthetic-local"]); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1250)); });
    await act(async () => guard?.(() => { exited += 1; }));
    assert.match(document.body.textContent ?? "", /Leave with a pending provider write\?/u);
    assert.match(document.body.textContent ?? "", /A submitted provider write may already be stored/u);
    assert.match(document.body.textContent ?? "", /can be recovered when you return/u);
    assert.equal(exited, 0);
    await act(async () => overlayButton("Keep editing").click());
    assert.equal(exited, 0);
  });
  it("refuses a malformed server settings inventory instead of retyping, relocating, or contradicting its runtime identity", () => {
    const textLeafWithNumberPath = {
      ...DOCUMENT.sections[0]?.leaves[0],
      path: "ocr.pageConcurrency",
    };
    assert.equal(EditableSettingsLeafWireSchema.safeParse(textLeafWithNumberPath).success, false);

    const relocated = structuredClone(DOCUMENT);
    const general = relocated.sections.find((candidate) => candidate.id === "general");
    const paths = relocated.sections.find((candidate) => candidate.id === "paths");
    if (general === undefined || paths === undefined) throw new Error("test document omitted text settings sections");
    [general.leaves[0], paths.leaves[0]] = [paths.leaves[0], general.leaves[0]];
    assert.equal(EditableSettingsWireSchema.safeParse(relocated).success, false);

    const wrongPersisted = { ...structuredClone(DOCUMENT), revision: 2 };
    assert.equal(EditableSettingsWireSchema.safeParse(wrongPersisted).success, false);

    const wrongActive = { ...structuredClone(DOCUMENT), activeConfigFingerprint: "d".repeat(64) };
    assert.equal(EditableSettingsWireSchema.safeParse(wrongActive).success, false);

    const defaultWithPersistedValue = {
      ...DOCUMENT.sections[0]?.leaves[0],
      settingsValue: "unexpected persisted value",
    };
    assert.equal(EditableSettingsLeafWireSchema.safeParse(defaultWithPersistedValue).success, false);
    assert.equal(EditableSettingsLeafWireSchema.safeParse({
      ...DOCUMENT.sections[0]?.leaves[0],
      source: "settings",
    }).success, false, "settings provenance must carry its persisted value");

    const duplicateSection = structuredClone(DOCUMENT);
    const pathsSection = duplicateSection.sections.find((candidate) => candidate.id === "paths");
    if (pathsSection === undefined) throw new Error("test document omitted paths section");
    pathsSection.id = "general";
    const duplicateSectionResult = EditableSettingsWireSchema.safeParse(duplicateSection);
    assert.equal(duplicateSectionResult.success, false);
    if (duplicateSectionResult.success) throw new Error("duplicate section id parsed as a settings document");
    assert.ok(duplicateSectionResult.error.issues.some((issue) => issue.message.includes("repeats section general")));
  });

  it("autosaves one atomic leaf-operation draft after a settled edit", async () => {
    const applied: unknown[] = [];
    let closeCount = 0;
    let exitGuard: ((proceed: () => void) => void) | undefined;
    const client = {
      editableSettings: () => Promise.resolve(DOCUMENT),
      applySettings: (command: unknown) => {
        applied.push(command);
        return Promise.resolve({ state: "applied", commandId: "00000000-0000-4000-8000-000000000001", affectedTargets: [{ family: "settings", revision: 2 }], restartRequired: true });
      },
    } as unknown as DashboardClient;
    host = document.createElement("div");
    document.body.append(host);
    await act(async () => {
      root = createRoot(host as HTMLElement);
      root.render(createElement(DashboardClientProvider, {
        client,
        children: createElement(SettingsPageWithToast, {
          storage: STORAGE,
          sections: [],
          workflowLabels: new Map<string, string>(),
          section: "general",
          actorId: "local-operator",
          descriptorFingerprint: "d".repeat(64),
          preflight: [],
          onSection: () => undefined,
          onExitGuardChange: guard => { exitGuard = guard; },
        }),
      }));
    });
    await act(async () => undefined);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-28T18:00:00.000Z"));

    const width = host.querySelector('[data-settings-path="display.screenWidth"] input');
    const height = host.querySelector('[data-settings-path="display.screenHeight"] input');
    assert.ok(width instanceof HTMLInputElement);
    assert.ok(height instanceof HTMLInputElement);
    assert.equal(height.disabled, false);
    await act(async () => { width.focus(); });
    assert.equal(document.activeElement, width, "the editable control accepts keyboard focus");
    await act(async () => {
      // React's controlled-input tracker requires the native setter bypass here.
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      if (descriptor?.set === undefined) throw new Error("HTML input value setter is unavailable");
      // eslint-disable-next-line @typescript-eslint/unbound-method
      Reflect.apply(descriptor.set, width, ["1980"]);
      width.dispatchEvent(new Event("input", { bubbles: true }));
      width.dispatchEvent(new Event("change", { bubbles: true }));
    });
    assert.ok([...host.querySelectorAll<HTMLButtonElement>("button")].some(button => button.textContent === "Undo"), "the retained draft has an in-row undo action");
    if (exitGuard === undefined) throw new Error("Settings exit guard was not registered");
    await act(async () => { exitGuard?.(() => { closeCount += 1; }); });
    assert.equal(closeCount, 0, "a dirty page cannot navigate away without a choice");
    assert.match(document.body.textContent ?? "", /Discard unsaved settings\?/u);
    const beforeUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload);
    assert.equal(beforeUnload.defaultPrevented, true, "a dirty draft protects against browser unload");
    await act(async () => { overlayButton("Keep editing").click(); });
    assert.equal(closeCount, 0);
    assert.throws(() => button("Save changes"));
    const form = host.querySelector("form");
    if (!(form instanceof HTMLFormElement)) throw new Error("editable Settings did not render an atomic form");
    await act(async () => { await vi.advanceTimersByTimeAsync(701); });
    assert.equal(applied.length, 1);
    const command = applied[0] as { target: { expectedRevision: number }; payload: { patch: unknown } };
    assert.equal(command.target.expectedRevision, 1);
    assert.deepEqual(command.payload.patch, {
      "display.screenHeight": { set: 1440 },
      "display.screenWidth": { set: 1980 },
    });
    assert.equal((applied[0] as { requestedAt: string }).requestedAt, "2026-08-28T18:00:00.700Z");
  });

  it("refuses a cleared zero-allowed OCR field instead of converting it to zero", async () => {
    const applied: unknown[] = [];
    let closeCount = 0;
    let exitGuard: ((proceed: () => void) => void) | undefined;
    const client = {
      editableSettings: () => Promise.resolve(DOCUMENT),
      applySettings: (command: unknown) => {
        applied.push(command);
        return Promise.resolve({ state: "applied", commandId: "00000000-0000-4000-8000-000000000001", affectedTargets: [{ family: "settings", revision: 2 }], restartRequired: true });
      },
    } as unknown as DashboardClient;
    host = document.createElement("div");
    document.body.append(host);
    await act(async () => {
      root = createRoot(host as HTMLElement);
      root.render(createElement(DashboardClientProvider, {
        client,
        children: createElement(SettingsPageWithToast, {
          storage: STORAGE,
          sections: [],
          workflowLabels: new Map<string, string>(),
          section: "performance",
          actorId: "local-operator",
          descriptorFingerprint: "d".repeat(64),
          preflight: [],
          onSection: () => undefined,
          onExitGuardChange: guard => { exitGuard = guard; },
        }),
      }));
    });
    await act(async () => undefined);
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

  it("retains a partial required job-end date in the text draft and never submits it", async () => {
    const applied: unknown[] = [];
    const client = {
      editableSettings: () => Promise.resolve(DOCUMENT),
      applySettings: (command: unknown) => { applied.push(command); return Promise.resolve({ state: "applied", commandId: "00000000-0000-4000-8000-000000000001", affectedTargets: [{ family: "settings", revision: 2 }], restartRequired: true }); },
    } as unknown as DashboardClient;
    host = document.createElement("div");
    document.body.append(host);
    await act(async () => {
      root = createRoot(host as HTMLElement);
      root.render(createElement(DashboardClientProvider, { client, children: createElement(SettingsPageWithToast, {
        storage: STORAGE, sections: [], workflowLabels: new Map<string, string>(), section: "general", actorId: "local-operator",
        descriptorFingerprint: "d".repeat(64), preflight: [], onSection: () => undefined,
      }) }));
    });
    await act(async () => undefined);
    vi.useFakeTimers();
    const datePath = `annualDates.FY${String(DOCUMENT.currentFiscalYear)}.jobEndDate`;
    const input = host.querySelector(`[data-settings-path="${datePath}"] input`);
    if (!(input instanceof HTMLInputElement)) throw new Error("missing current job-end-date input");
    assert.equal(input.required, true);
    assert.equal(input.type, "text", "the partial-date editor remains text based so invalid drafts stay visible");
    await act(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      if (descriptor?.set === undefined) throw new Error("HTML input value setter is unavailable");
      // eslint-disable-next-line @typescript-eslint/unbound-method
      Reflect.apply(descriptor.set, input, ["6/"]);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(701); });
    assert.equal(input.value, "6/");
    assert.equal(applied.length, 0, "an invalid partial date stays in the local draft without a command");
    const undo = [...host.querySelectorAll<HTMLButtonElement>(`[data-settings-path="${datePath}"] button`)].find(button => button.textContent === "Undo");
    assert.ok(undo);
    await act(async () => { undo.click(); });
    assert.notEqual(input.value, "6/");
    assert.equal(applied.length, 0);
  });

  it("autosaves valid production routes after 700 ms but retains invalid partial URLs", async () => {
    const applied: unknown[] = [];
    const client = {
      editableSettings: () => Promise.resolve(DOCUMENT),
      applySettings: (command: unknown) => {
        applied.push(command);
        return Promise.resolve({ state: "applied", commandId: "00000000-0000-4000-8000-000000000001", affectedTargets: [{ family: "settings", revision: 2 }], restartRequired: true });
      },
    } as unknown as DashboardClient;
    host = document.createElement("div");
    document.body.append(host);
    await act(async () => {
      root = createRoot(host as HTMLElement);
      root.render(createElement(DashboardClientProvider, {
        client,
        children: createElement(SettingsPageWithToast, {
          storage: STORAGE,
          sections: [],
          workflowLabels: new Map<string, string>(),
          section: "routes",
          actorId: "local-operator",
          descriptorFingerprint: "d".repeat(64),
          preflight: [],
          onSection: () => undefined,
        }),
      }));
    });
    await act(async () => undefined);
    assert.match(host.textContent ?? "", /Routes/u);
    assert.doesNotMatch(host.textContent ?? "", /Test routes/u);
    const input = host.querySelector('[data-settings-path="urls.crm.prod"] input');
    if (!(input instanceof HTMLInputElement)) throw new Error("missing CRM route input");
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
    const command = applied[0] as { payload: { patch: Record<string, { set: { entry: string } }> } };
    assert.equal(command.payload.patch["urls.crm.prod"]?.set.entry, "https://crm.example.test/new");
  });
});
