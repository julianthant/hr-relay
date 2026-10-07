// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import type { DashboardClient } from "../../../../../src/dashboard/client/index.js";
import { createSettingsQueries } from "../../../../../src/dashboard/client/settings-queries.js";
import { createDashboardTransport } from "../../../../../src/dashboard/client/transport.js";
import { DashboardClientProvider } from "../../../../../src/dashboard/state/client-context.js";
import { SettingsPathPicker } from "../../../../../src/dashboard/surfaces/settings-path-picker.js";
import { NativePathPickerRequestSchema, type NativePathPickerResponse } from "../../../../../src/models/dashboard/native-path-picker.js";

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
  it("shows the full accessible path, selects one file, and leaves cancellation untouched", async () => {
    const selected: string[] = [];
    const requests: unknown[] = [];
    let response: NativePathPickerResponse = { state: "selected", field: "paths.duoCredential", path: "/tmp/private/new.json" };
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
    assert.deepEqual(requests, [{ field: "paths.duoCredential", initialPath: "/tmp/private/duo.json" }]);
    assert.deepEqual(selected, ["/tmp/private/new.json"]);
    response = { state: "cancelled", field: "paths.duoCredential" };
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
    await act(async () => release?.({ state: "unavailable", field: "paths.duoCredential", reason: "busy" }));
    assert.match(surface.querySelector('[role="alert"]')?.textContent ?? "", /Another path picker is already open/u);
    assert.deepEqual(selected, []);
  });

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

  it("does not apply a selection after the row unmounts", async () => {
    let release: ((value: NativePathPickerResponse) => void) | undefined;
    const selected: string[] = [];
    await mount(() => new Promise(resolve => { release = resolve; }), path => selected.push(path));
    await act(async () => host?.querySelector("button")?.click());
    act(() => root?.unmount()); root = undefined;
    await act(async () => release?.({ state: "selected", field: "paths.duoCredential", path: "/tmp/stale.json" }));
    assert.deepEqual(selected, []);
  });
});

describe("native Paths picker client", () => {
  it("uses one guarded POST and preserves selected, cancellation, and typed unavailable states", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const responses: { status: number; body: NativePathPickerResponse }[] = [
      { status: 200, body: { state: "selected", field: "paths.stateRoot", path: "/tmp/new-state" } },
      { status: 200, body: { state: "cancelled", field: "paths.stateRoot" } },
      { status: 409, body: { state: "unavailable", field: "paths.stateRoot", reason: "busy" } },
      { status: 503, body: { state: "unavailable", field: "paths.stateRoot", reason: "timeout" } },
      { status: 503, body: { state: "unavailable", field: "paths.stateRoot", reason: "unsupported-platform" } },
    ];
    const queries = createSettingsQueries(createDashboardTransport({ baseUrl: "http://127.0.0.1:4371",
      fetchImpl: (url, init) => {
        calls.push({ url, init });
        const next = responses.shift(); if (next === undefined) throw new Error("unexpected picker retry");
        return Promise.resolve(new Response(JSON.stringify(next.body), { status: next.status }));
      } }));
    for (const state of ["selected", "cancelled", "unavailable", "unavailable", "unavailable"]) {
      assert.equal((await queries.pickSettingsPath({ field: "paths.stateRoot", initialPath: "/tmp/state" })).state, state);
    }
    assert.equal(calls.length, 5);
    assert.ok(calls.every(call => call.url === "http://127.0.0.1:4371/api/v1/settings/path-picker" && call.init?.method === "POST"));
    assert.ok(calls.every(call => new Headers(call.init?.headers).get("origin") === "http://127.0.0.1:4371"));
    assert.ok(calls.every(call => typeof call.init?.body === "string"
      && NativePathPickerRequestSchema.parse(JSON.parse(call.init.body) as unknown).field === "paths.stateRoot"));
  });

  it("rejects a selected path for a different field", async () => {
    const queries = createSettingsQueries(createDashboardTransport({ baseUrl: "http://127.0.0.1:4371",
      fetchImpl: () => Promise.resolve(new Response(JSON.stringify({ state: "selected", field: "paths.artifactRoot", path: "/tmp/other" }), { status: 200 })) }));
    await assert.rejects(queries.pickSettingsPath({ field: "paths.stateRoot" }), /selected field differs/u);
  });
});
