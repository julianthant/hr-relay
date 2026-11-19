// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it, vi } from "vitest";
import type { DashboardClient } from "../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import { useAuthenticatedImage, type AuthenticatedImage } from "../../../../src/dashboard/surfaces/shared/authenticated-image.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); });

type Pending = { url: string; signal: AbortSignal; resolve: (value: { url: string; release: () => void }) => void; reject: (error: Error) => void };
function setup() {
  const pending: Pending[] = [];
  const client = { fetchAuthenticatedResource: vi.fn((url: string, signal: AbortSignal) => new Promise<{ url: string; release: () => void }>((resolve, reject) => pending.push({ url, signal, resolve, reject }))) } as unknown as DashboardClient;
  let latest: AuthenticatedImage | undefined;
  function Probe({ source }: { source: string }) { latest = useAuthenticatedImage(source); return null; }
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const render = (source: string) => act(async () => root?.render(createElement(DashboardClientProvider, { client, children: createElement(Probe, { source }) })));
  return { pending, client, render, latest: () => latest };
}
const resource = (url: string) => ({ url, release: vi.fn() });

describe("authenticated image", () => {
  it("loads a protected resource as an object URL and releases it on unmount", async () => {
    const h = setup();
    await h.render("/artifacts/v1/one");
    assert.deepEqual(h.latest(), { src: undefined, failed: false });
    const one = resource("blob:one");
    await act(async () => h.pending[0].resolve(one));
    assert.deepEqual(h.latest(), { src: "blob:one", failed: false });
    await act(async () => root?.unmount()); root = undefined;
    assert.equal(one.release.mock.calls.length, 1);
  });
  it("fences stale results and releases the previous object URL when the source changes", async () => {
    const h = setup();
    await h.render("/artifacts/v1/one");
    const one = resource("blob:one"), two = resource("blob:two");
    await h.render("/artifacts/v1/two");
    assert.equal(h.pending[0].signal.aborted, true);
    await act(async () => h.pending[0].resolve(one));
    assert.equal(one.release.mock.calls.length, 1);
    assert.deepEqual(h.latest(), { src: undefined, failed: false });
    await act(async () => h.pending[1].resolve(two));
    assert.deepEqual(h.latest(), { src: "blob:two", failed: false });
    await h.render("/artifacts/v1/three");
    assert.equal(two.release.mock.calls.length, 1);
  });
  it("reports failure only for the current source", async () => {
    const h = setup();
    await h.render("/api/v1/runs/r/ocr/pages/1?revision=1");
    await act(async () => h.pending[0].reject(new Error("refused")));
    assert.deepEqual(h.latest(), { src: undefined, failed: true });
    await h.render("/api/v1/runs/r/ocr/pages/2?revision=1");
    assert.deepEqual(h.latest(), { src: undefined, failed: false });
  });
  it("passes non-dashboard URLs through without fetching", async () => {
    const h = setup();
    await h.render("data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E");
    assert.equal(h.latest()?.src, "data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E");
    await h.render("/logs-preview/form.svg");
    assert.equal(h.latest()?.src, "/logs-preview/form.svg");
    assert.equal((h.client.fetchAuthenticatedResource as unknown as { mock: { calls: unknown[] } }).mock.calls.length, 0);
  });
  it("refuses an invalid source without handing it to the image element", async () => {
    const h = setup();
    await h.render("http://[");
    assert.deepEqual(h.latest(), { src: undefined, failed: true });
    assert.equal(h.pending.length, 0);
  });
});
