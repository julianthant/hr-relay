import { FIXTURE_EDITABLE_SETTINGS } from "../../parity/helpers/fixture-settings.js";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it, vi } from "vitest";
import {
  EditableSettingsLeafWireSchema,
  EditableSettingsWireSchema,
} from "../../../src/domain/dashboard/settings-editor.js";
import { StorageHealthSummaryWireSchema } from "../../../src/domain/dashboard/bootstrap.js";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { SettingsPage } from "../../../src/dashboard/surfaces/settings.js";
import { DEFAULT_CATALOG_VIEW } from "../../../src/dashboard/surfaces/row-catalog-model.js";

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
        children: createElement(SettingsPage, {
          // D295: the catalog is a Settings section now. No render here opens it,
          // so these carry the section's defaults rather than a fixture nothing reads.
          catalogQuery: "",
          catalogView: DEFAULT_CATALOG_VIEW,
          onCatalogQuery: () => undefined,
          onCatalogView: () => undefined,
          storage: STORAGE,
          sections: [],
          workflowLabels: new Map<string, string>(),
          section: "display",
          actorId: "local-operator",
          descriptorFingerprint: "d".repeat(64),
          preflight: [],
          onSection: () => undefined,
          onClose: () => { closeCount += 1; },
        }),
      }));
    });
    await act(async () => undefined);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-28T18:00:00.000Z"));

    const inputs = host.querySelectorAll("input");
    assert.equal(inputs.length, 2);
    const width = inputs[0];
    const height = inputs[1];
    assert.equal(height.disabled, false);
    width.focus();
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
    assert.match(host.textContent ?? "", /Undo edit/u);
    await act(async () => { button("Back to the dashboard").click(); });
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
        children: createElement(SettingsPage, {
          // D295: the catalog is a Settings section now. No render here opens it,
          // so these carry the section's defaults rather than a fixture nothing reads.
          catalogQuery: "",
          catalogView: DEFAULT_CATALOG_VIEW,
          onCatalogQuery: () => undefined,
          onCatalogView: () => undefined,
          storage: STORAGE,
          sections: [],
          workflowLabels: new Map<string, string>(),
          section: "performance",
          actorId: "local-operator",
          descriptorFingerprint: "d".repeat(64),
          preflight: [],
          onSection: () => undefined,
          onClose: () => { closeCount += 1; },
        }),
      }));
    });
    await act(async () => undefined);
    vi.useFakeTimers();
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
    await act(async () => { button("Back to the dashboard").click(); });
    await act(async () => { overlayButton("Discard changes").click(); });
    assert.equal(closeCount, 1, "explicit discard is the only dirty-draft exit");
  });

  it("edits production routes only after an explicit save", async () => {
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
        children: createElement(SettingsPage, {
          catalogQuery: "",
          catalogView: DEFAULT_CATALOG_VIEW,
          onCatalogQuery: () => undefined,
          onCatalogView: () => undefined,
          storage: STORAGE,
          sections: [],
          workflowLabels: new Map<string, string>(),
          section: "routes",
          actorId: "local-operator",
          descriptorFingerprint: "d".repeat(64),
          preflight: [],
          onSection: () => undefined,
          onClose: () => undefined,
        }),
      }));
    });
    await act(async () => undefined);
    assert.match(host.textContent ?? "", /Routes/u);
    assert.doesNotMatch(host.textContent ?? "", /Test routes/u);
    const input = host.querySelector('[data-settings-path="urls.crm.prod"] input');
    if (!(input instanceof HTMLInputElement)) throw new Error("missing CRM route input");
    vi.useFakeTimers();
    await act(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      if (descriptor?.set === undefined) throw new Error("HTML input value setter is unavailable");
      // eslint-disable-next-line @typescript-eslint/unbound-method
      Reflect.apply(descriptor.set, input, ["https://crm.example.test/new"]);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(701); });
    assert.equal(applied.length, 0, "route edits wait for Save routes");
    await act(async () => { button("Save routes").click(); });
    assert.equal(applied.length, 1);
    const command = applied[0] as { payload: { patch: Record<string, { set: { entry: string } }> } };
    assert.equal(command.payload.patch["urls.crm.prod"]?.set.entry, "https://crm.example.test/new");
  });
});
