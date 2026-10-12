// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it, vi } from "vitest";
import { useAttentionAnnounce } from "../../../../src/dashboard/surfaces/queue/queue-model.js";

let root: Root | undefined;
let host: HTMLElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mountAnnouncement(status: Parameters<typeof useAttentionAnnounce>[0]) {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  let announcing = false;
  function Row({ status }: { status: Parameters<typeof useAttentionAnnounce>[0] }) {
    announcing = useAttentionAnnounce(status);
    return null;
  }
  const render = async (status: Parameters<typeof useAttentionAnnounce>[0]) => {
    await act(async () => root?.render(createElement(Row, { status })));
    return announcing;
  };
  await render(status);
  return { render, announcing: () => announcing };
}

it("clears the attention announcement when a row returns to running within 900 ms", async () => {
  const row = await mountAnnouncement("running");
  assert.equal(row.announcing(), false);
  assert.equal(await row.render("waiting"), true);
  await act(async () => vi.advanceTimersByTimeAsync(100));
  assert.equal(await row.render("running"), false);
  await act(async () => vi.advanceTimersByTimeAsync(900));
  assert.equal(row.announcing(), false);
});

it("does not announce an attention row on mount and settles a later entry after 900 ms", async () => {
  const row = await mountAnnouncement("waiting");
  assert.equal(row.announcing(), false);
  assert.equal(await row.render("running"), false);
  assert.equal(await row.render("failed"), true);
  await act(async () => vi.advanceTimersByTimeAsync(899));
  assert.equal(row.announcing(), true);
  await act(async () => vi.advanceTimersByTimeAsync(1));
  assert.equal(row.announcing(), false);
});
