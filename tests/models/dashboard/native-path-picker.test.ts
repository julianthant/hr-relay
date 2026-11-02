// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,describe,it } from "vitest";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { SettingsPathPicker } from "../../../src/dashboard/surfaces/settings/general/settings-path-picker.js";
import { type NativePathPickerResponse } from "../../../src/models/dashboard/native-path-picker.js";

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
  it("shows the full accessible path, selects one file, and leaves cancellation untouched", async () => {
    const selected: string[] = [];
    const requests: unknown[] = [];
    let response: NativePathPickerResponse = { state: "selected", field: "paths.i9CheckTrackerPath", path: "/tmp/private/new.json" };
    const surface = await mount(request => { requests.push(request); return Promise.resolve(response); }, path => selected.push(path));
    const value = surface.querySelector(".ds-path-value");
    assert.equal(value?.getAttribute("aria-label"), "/tmp/private/duo.json");
    assert.equal(value?.getAttribute("title"), null);
    assert.equal((value as HTMLElement | null)?.tabIndex, 0);
    assert.equal(value?.querySelector(".sr-only")?.textContent, "/tmp/private/duo.json");
    assert.equal(value?.querySelector(".ds-path-basename")?.textContent, "duo.json");
    const button = surface.querySelector('button[aria-label="Change Duo credential file"]');
    if (!(button instanceof HTMLButtonElement)) throw new Error("picker button missing");
    await act(async () => { button.click(); await Promise.resolve(); });
    assert.deepEqual(requests, [{ field: "paths.i9CheckTrackerPath", initialPath: "/tmp/private/duo.json" }]);
    assert.deepEqual(selected, ["/tmp/private/new.json"]);
    response = { state: "cancelled", field: "paths.i9CheckTrackerPath" };
    await act(async () => { button.click(); await Promise.resolve(); });
    assert.deepEqual(selected, ["/tmp/private/new.json"]);
  });

  it("keeps unavailable reasons local and blocks repeated dialog opens", async () => {
    let release: ((value: NativePathPickerResponse) => void) | undefined;
    let calls = 0;
    const selected: string[] = [];
    const surface = await mount(() => { calls += 1; return new Promise(resolve => { release = resolve; }); }, path => selected.push(path));
    const button = surface.querySelector("button");
    if (!(button instanceof HTMLButtonElement)) throw new Error("picker button missing");
    await act(async () => button.click());
    assert.equal(button.disabled, true);
    button.click();
    assert.equal(calls, 1);
    await act(async () => release?.({ state: "unavailable", field: "paths.i9CheckTrackerPath", reason: "busy" }));
    assert.match(surface.querySelector('[role="alert"]')?.textContent ?? "", /Another path picker is already open/u);
    assert.deepEqual(selected, []);
  });

  it("does not apply a selection after the row unmounts", async () => {
    let release: ((value: NativePathPickerResponse) => void) | undefined;
    const selected: string[] = [];
    await mount(() => new Promise(resolve => { release = resolve; }), path => selected.push(path));
    await act(async () => host?.querySelector("button")?.click());
    act(() => root?.unmount()); root = undefined;
    await act(async () => release?.({ state: "selected", field: "paths.i9CheckTrackerPath", path: "/tmp/stale.json" }));
    assert.deepEqual(selected, []);
  });
});
