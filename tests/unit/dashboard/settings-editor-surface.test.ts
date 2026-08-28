// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import { EditableSettingsWireSchema } from "../../../src/domain/dashboard/settings-editor.js";
import { StorageHealthSummaryWireSchema } from "../../../src/domain/dashboard/bootstrap.js";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { SettingsPage } from "../../../src/dashboard/surfaces/settings.js";

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
  root = undefined;
  host = undefined;
});

function button(name: string): HTMLButtonElement {
  const found = [...(host?.querySelectorAll("button") ?? [])].find((candidate) => candidate.textContent === name);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`missing ${name} button`);
  return found;
}

describe("editable Settings surface", () => {
  it("keeps one keyboard-submittable atomic draft and locks an environment-owned leaf", async () => {
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
          storage: STORAGE,
          sections: [],
          workflowLabels: new Map<string, string>(),
          section: "display",
          actorId: "local-operator",
          requestedAt: "2026-08-28T17:00:00.000Z",
          descriptorFingerprint: "d".repeat(64),
          preflight: [],
          onSection: () => undefined,
          onClose: () => undefined,
        }),
      }));
    });
    await act(async () => undefined);

    const inputs = host.querySelectorAll("input");
    assert.equal(inputs.length, 2);
    const width = inputs[0];
    const height = inputs[1];
    assert.equal(height.disabled, true);
    width.focus();
    assert.equal(document.activeElement, width, "the editable control accepts keyboard focus");
    await act(async () => {
      // React's controlled-input tracker requires the native setter bypass here.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      if (descriptor?.set === undefined) throw new Error("HTML input value setter is unavailable");
      Reflect.apply(descriptor.set, width, ["1980"]);
      width.dispatchEvent(new Event("input", { bubbles: true }));
      width.dispatchEvent(new Event("change", { bubbles: true }));
    });
    assert.match(host.textContent ?? "", /1 unsaved change/u);
    const save = button("Save 1");
    save.focus();
    assert.equal(document.activeElement, save, "the atomic save action accepts keyboard focus");
    const form = host.querySelector("form");
    if (!(form instanceof HTMLFormElement)) throw new Error("editable Settings did not render an atomic form");
    await act(async () => { form.requestSubmit(); });
    assert.equal(applied.length, 1);
    const command = applied[0] as { target: { expectedRevision: number }; payload: { patch: unknown } };
    assert.equal(command.target.expectedRevision, 1);
    assert.deepEqual(command.payload.patch, { display: { screenWidth: 1980 } });
  });
});
