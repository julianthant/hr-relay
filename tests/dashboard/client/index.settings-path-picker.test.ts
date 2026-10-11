// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,describe,it } from "vitest";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { SettingsPathPicker } from "../../../src/dashboard/surfaces/settings/general/settings-path-picker.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
let host: HTMLElement | undefined;
afterEach(() => { if (root !== undefined) act(() => root?.unmount()); host?.remove(); root = undefined; host = undefined; });

async function mount(pickSettingsPath: DashboardClient["pickSettingsPath"], onSelected: (path: string) => void) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const client = { pickSettingsPath } as DashboardClient;
  await act(async () => root?.render(createElement(DashboardClientProvider, { client,
    children: createElement(SettingsPathPicker, { field: "paths.duoCredential", label: "Duo credential file",
      value: "/tmp/private/duo.json", disabled: false, onSelected }) })));
  return host;
}

describe("native Paths picker control", () => {

  it("uses concise host and timeout messages without changing the path", async () => {
    let reason: "timeout" | "unsupported-platform" | "dialog-failed" = "timeout";
    const selected: string[] = [];
    const surface = await mount(() => Promise.resolve({ state: "unavailable", field: "paths.duoCredential", reason }), path => selected.push(path));
    const button = surface.querySelector("button");
    if (!(button instanceof HTMLButtonElement)) throw new Error("picker button missing");
    for (const [next, expected] of [["timeout", /timed out/u], ["unsupported-platform", /unavailable on this host/u],
      ["dialog-failed", /could not be opened/u]] as const) {
      reason = next;
      await act(async () => { button.click(); await Promise.resolve(); });
      assert.match(surface.querySelector('[role="alert"]')?.textContent ?? "", expected);
    }
    assert.deepEqual(selected, []);
  });
});
