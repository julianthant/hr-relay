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

const DOCUMENT = EditableSettingsWireSchema.parse({
  revision: 1,
  settingsSchemaHash: "a".repeat(64),
  settingsFingerprint: "b".repeat(64),
  activeConfigFingerprint: "c".repeat(64),
  runtimeStatus: { state: "current", identity: { settingsRevision: 1, settingsSchemaHash: "a".repeat(64), settingsFingerprint: "b".repeat(64), configFingerprint: "c".repeat(64) } },
  sections: [
    { id: "general", label: "General", description: "General settings.", leaves: [{ path: "actor.label", input: "text", label: "Operator label", description: "Label.", effectiveValue: "Local operator", defaultValue: "Local operator", source: "default", editable: true }] },
    { id: "display", label: "Display", description: "Display settings.", leaves: [
      { path: "display.screenWidth", input: "number", label: "Screen width", description: "Width.", effectiveValue: 2560, defaultValue: 2560, source: "default", editable: true, minimum: 1, unit: "px" },
      { path: "display.screenHeight", input: "number", label: "Screen height", description: "Height.", effectiveValue: 1440, defaultValue: 1440, source: "env", environmentVariable: "HRAUTO_SCREEN_HEIGHT", editable: false, minimum: 1, unit: "px" },
    ] },
    { id: "performance", label: "Performance", description: "Performance settings.", leaves: [
      { path: "ocr.pageConcurrency", input: "number", label: "OCR page concurrency", description: "OCR.", effectiveValue: 0, defaultValue: 0, source: "default", editable: true, minimum: 0 },
      { path: "ocr.maxValidationRetries", input: "number", label: "OCR validation retries", description: "Retries.", effectiveValue: 1, defaultValue: 1, source: "default", editable: true, minimum: 0 },
      { path: "timeouts.duoApprovalSeconds", input: "number", label: "Duo approval timeout", description: "Duo.", effectiveValue: 180, defaultValue: 180, source: "default", editable: true, minimum: 1, unit: "seconds" },
      { path: "concurrency.defaultWorkers", input: "number", label: "Default workers", description: "Workers.", effectiveValue: 2, defaultValue: 2, source: "default", editable: true, minimum: 1, hazard: "Verify capacity." },
    ] },
    { id: "paths", label: "Paths", description: "Path settings.", leaves: [{ path: "paths.reportsDir", input: "text", label: "Reports directory", description: "Reports.", effectiveValue: "/tmp/reports", defaultValue: "/tmp/reports", source: "default", editable: true }] },
  ],
});

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

  it("keeps one keyboard-submittable atomic draft and locks an environment-owned leaf", async () => {
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

    const inputs = host.querySelectorAll("input");
    assert.equal(inputs.length, 2);
    const width = inputs[0];
    const height = inputs[1];
    assert.equal(height.disabled, true);
    assert.match(width.className, /pointer-coarse:min-h-11/u);
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
    assert.match(host.textContent ?? "", /1 unsaved change/u);
    await act(async () => { button("Back to the dashboard").click(); });
    assert.equal(closeCount, 0, "a dirty page cannot navigate away without a choice");
    assert.match(document.body.textContent ?? "", /Discard unsaved settings\?/u);
    const beforeUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload);
    assert.equal(beforeUnload.defaultPrevented, true, "a dirty draft protects against browser unload");
    await act(async () => { overlayButton("Keep editing").click(); });
    assert.equal(closeCount, 0);
    const save = button("Save 1");
    assert.match(save.className, /pointer-coarse:min-h-11/u);
    save.focus();
    assert.equal(document.activeElement, save, "the atomic save action accepts keyboard focus");
    const form = host.querySelector("form");
    if (!(form instanceof HTMLFormElement)) throw new Error("editable Settings did not render an atomic form");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-28T18:00:00.000Z"));
    await act(async () => { form.requestSubmit(); });
    assert.equal(applied.length, 1);
    const command = applied[0] as { target: { expectedRevision: number }; payload: { patch: unknown } };
    assert.equal(command.target.expectedRevision, 1);
    assert.deepEqual(command.payload.patch, { display: { screenWidth: 1980 } });
    assert.equal((applied[0] as { requestedAt: string }).requestedAt, "2026-08-28T18:00:00.000Z");
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
    const pageConcurrency = host.querySelector("input");
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
    assert.equal(button("Save 1").disabled, true);
    assert.equal(applied.length, 0);
    await act(async () => { button("Back to the dashboard").click(); });
    await act(async () => { overlayButton("Discard changes").click(); });
    assert.equal(closeCount, 1, "explicit discard is the only dirty-draft exit");
  });
});
