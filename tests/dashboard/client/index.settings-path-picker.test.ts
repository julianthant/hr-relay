// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,describe,it } from "vitest";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { FixtureCommandBinding } from "../../support/helpers/dashboard/command-binding.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../src/models/failures/error-catalog.js";
import { SettingsPathPicker } from "../../../src/dashboard/surfaces/settings/general/settings-path-picker.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
let host: HTMLElement | undefined;
afterEach(() => { if (root !== undefined) act(() => root?.unmount()); host?.remove(); root = undefined; host = undefined; });

async function mount(pickSettingsPath: DashboardClient["pickSettingsPath"], onSelected: (path: string) => void) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const client = { pickSettingsPath } as DashboardClient;
  await act(async () => root?.render(createElement(DashboardClientProvider, { client,
    children: createElement(SettingsPathPicker, { field: "paths.i9CheckTrackerPath", label: "Duo credential file",
      value: "/tmp/private/duo.json", disabled: false, onSelected }) })));
  return host;
}

describe("native Paths picker control", () => {

  it("uses concise host and timeout messages without changing the path", async () => {
    let reason: "busy" | "timeout" | "unsupported-platform" | "dialog-failed" = "timeout";
    const selected: string[] = [];
    const surface = await mount(() => Promise.resolve({ state: "unavailable", field: "paths.i9CheckTrackerPath", reason }), path => selected.push(path));
    const button = surface.querySelector("button");
    if (!(button instanceof HTMLButtonElement)) throw new Error("picker button missing");
    for (const [next, code] of [["busy", "SETTINGS_PATH_PICKER_BUSY"], ["timeout", "SETTINGS_PATH_PICKER_TIMEOUT"], ["unsupported-platform", "SETTINGS_PATH_PICKER_UNSUPPORTED"],
      ["dialog-failed", "SETTINGS_PATH_PICKER_FAILED"]] as const) {
      reason = next;
      await act(async () => { button.click(); await Promise.resolve(); });
      assert.equal(surface.querySelector('[role="alert"]')?.textContent, formatErrorCatalogFailure(createErrorCatalogFailure(code, {})).text);
    }
    assert.deepEqual(selected, []);
  });
});

for (const replacement of ["client", "scope", "field", "value", "disabled"] as const) {
  for (const responseState of ["selected", "unavailable"] as const) {
    it(`ignores a delayed ${responseState} picker reply after ${replacement} changes`, async () => {
      const selected: string[] = [];
      let resolveReply: ((value: Awaited<ReturnType<DashboardClient["pickSettingsPath"]>>) => void) | undefined;
      const client = { pickSettingsPath: () => new Promise(resolve => { resolveReply = resolve; }) } as unknown as DashboardClient;
      host = document.createElement("div"); document.body.append(host); root = createRoot(host);
      const render = async (changed: boolean) => {
        await act(async () => root?.render(createElement(DashboardClientProvider, { client: changed && replacement === "client" ? { ...client } : client,
          children: createElement(FixtureCommandBinding, { actorId: "local-operator", requestKey: changed && replacement === "scope" ? 1 : 0,
            children: createElement(SettingsPathPicker, { field: changed && replacement === "field" ? "paths.reportsDir" : "paths.i9CheckTrackerPath",
              label: "Duo credential file", value: changed && replacement === "value" ? "/tmp/changed.json" : "/tmp/private/duo.json",
              disabled: changed && replacement === "disabled", onSelected: path => selected.push(path) }) }) })));
      };
      await render(false);
      const button = host.querySelector("button"); assert.ok(button instanceof HTMLButtonElement);
      await act(async () => button.click()); assert.ok(resolveReply);
      await render(true);
      await act(async () => resolveReply?.(responseState === "selected"
        ? { state: "selected", field: "paths.i9CheckTrackerPath", path: "/tmp/late.json" }
        : { state: "unavailable", field: "paths.i9CheckTrackerPath", reason: "dialog-failed" }));
      assert.deepEqual(selected, []); assert.equal(host.querySelector('[role="alert"]'), null);
      assert.equal(button.disabled, replacement === "disabled");
    });
  }
}
