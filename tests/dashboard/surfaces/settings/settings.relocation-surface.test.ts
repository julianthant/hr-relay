import { FixtureCommandBinding } from "../../../support/helpers/dashboard/command-binding.js";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,describe,it } from "vitest";
import type { DashboardClient } from "../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import { useStorageRelocation } from "../../../../src/dashboard/surfaces/settings/general/settings-relocation-model.js";
import { SettingsPage } from "../../../../src/dashboard/surfaces/settings/settings.js";
import { StorageHealthSummaryWireSchema } from "../../../../src/models/dashboard/bootstrap.js";
import { SettingsCommandRequestSchema,StorageRelocationPlanViewSchema } from "../../../../src/rules/commands/commands.js";
import { FIXTURE_EDITABLE_SETTINGS } from "../../../parity/helpers/fixture-settings.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const SOURCE = { stateRoot: "/tmp/fixture-state", artifactRoot: "/tmp/fixture-artifacts" };
const INITIAL = StorageRelocationPlanViewSchema.parse({ revision: 0, installationId: "11111111-1111-4111-8111-111111111111",
  sourceGeneration: 0, sourcePair: SOURCE, pending: null });
let root: Root | undefined;
let host: HTMLElement | undefined;
let _currentController: ReturnType<typeof useStorageRelocation> | undefined;
afterEach(() => { if (root !== undefined) act(() => root?.unmount()); host?.remove(); root = undefined; host = undefined; _currentController = undefined; });
async function idle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 750)); }); }

describe("storage relocation Paths controls", () => {
  it("guards an uncertain ordinary path save on exit without claiming it was saved", async () => {
    let guard: ((proceed: () => void) => void) | undefined;
    let exits = 0;
    const client = { editableSettings: () => Promise.resolve(FIXTURE_EDITABLE_SETTINGS),
      storageRelocationPlans: () => Promise.resolve(INITIAL),
      pickSettingsPath: () => Promise.resolve({ state: "selected", field: "paths.downloadsDir", path: "/tmp/new-artifacts" }),
      executeCommand: () => Promise.reject(new Error("synthetic lost response")),
    } as unknown as DashboardClient;
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    const storage = StorageHealthSummaryWireSchema.parse({ authority: "healthy", backup: "current", checkedAt: "2026-09-26T12:00:00.000Z" });
    await act(async () => { root?.render(createElement(DashboardClientProvider, { client, children: createElement(FixtureCommandBinding, { actorId: "local-operator", children: createElement(SettingsPage, { onClose: () => undefined,
      storage, sections: [], workflowLabels: new Map(), section: "paths", actorId: "local-operator", descriptorFingerprint: "d".repeat(64),
      preflight: [], onSection: () => undefined, onExitGuardChange: next => { guard = next; },
    }) }) })); });
    await act(async () => undefined);
    const change = host.querySelector('[data-settings-path="paths.downloadsDir"] button[aria-label="Change Downloads"]');
    if (!(change instanceof HTMLButtonElement)) throw new Error("downloads picker action missing");
    await act(async () => { change.click(); await Promise.resolve(); }); await idle();
    assert.ok(guard);
    await act(async () => guard?.(() => { exits += 1; }));
    assert.equal(exits, 0);
    assert.match(document.body.textContent ?? "", /Discard unsaved settings\?/u);
    assert.doesNotMatch(document.body.textContent ?? "", /folders moved|Saved location plan/u);
    const keep = [...document.querySelectorAll("button")].find(button => button.textContent === "Keep editing");
    if (keep === undefined) throw new Error("keep-editing action missing");
    await act(async () => keep.click());
    assert.equal(exits, 0);
    assert.ok(host.querySelector('[data-settings-path="paths.downloadsDir"] .ds-path-control button'));
  });
  it("autosaves a selected ordinary path and ignores cancelled selection", async () => {
    const commands: unknown[] = [];
    let selection: "cancelled" | "selected" = "cancelled";
    const client = { editableSettings: () => Promise.resolve(FIXTURE_EDITABLE_SETTINGS),
      storageRelocationPlans: () => Promise.resolve(INITIAL),
      pickSettingsPath: () => Promise.resolve(selection === "selected"
        ? { state: "selected", field: "paths.downloadsDir", path: "/tmp/chosen-downloads" }
        : { state: "cancelled", field: "paths.downloadsDir" }),
      executeCommand: (request: unknown) => { commands.push(request); return Promise.reject(new Error("synthetic response uncertainty")); },
    } as unknown as DashboardClient;
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    const storage = StorageHealthSummaryWireSchema.parse({ authority: "healthy", backup: "current", checkedAt: "2026-09-26T12:00:00.000Z" });
    await act(async () => root?.render(createElement(DashboardClientProvider, { client, children: createElement(FixtureCommandBinding, { actorId: "local-operator", children: createElement(SettingsPage, { onClose: () => undefined,
      storage, sections: [], workflowLabels: new Map(), section: "paths", actorId: "local-operator", descriptorFingerprint: "d".repeat(64),
      preflight: [], onSection: () => undefined, onExitGuardChange: () => undefined,
    }) }) })));
    await act(async () => undefined);
    const change = host.querySelector('[data-settings-path="paths.downloadsDir"] button[aria-label="Change Downloads"]');
    if (!(change instanceof HTMLButtonElement)) throw new Error("downloads picker action missing");
    await act(async () => { change.click(); await Promise.resolve(); });
    await idle();
    assert.equal(commands.length, 0);
    selection = "selected";
    await act(async () => { change.click(); await Promise.resolve(); });
    await idle();
    assert.equal(commands.length, 1);
    const command = SettingsCommandRequestSchema.parse(commands[0]);
    if (command.type !== "apply-settings") throw new Error("expected ordinary settings write");
    assert.deepEqual(command.payload.patch["paths.downloadsDir"], { set: "/tmp/chosen-downloads" });
  });
});
