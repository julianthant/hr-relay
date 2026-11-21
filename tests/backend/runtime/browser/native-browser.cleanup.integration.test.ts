import assert from "node:assert/strict";
import type { BrowserContext, Page } from "playwright";
import { it } from "vitest";
import { closeContextWithProof, observeContextLifecycle } from "../../../../src/backend/runtime/browser/native-browser.js";
import { manualClock } from "../../../../src/rules/time/clock.js";

it("closes every sibling page and the context after one page refuses to close, then reports that refusal", async () => {
  const refusal = new Error("fixture page close refused");
  const closed: string[] = [];
  const page = (name: string, fails: boolean): Page => {
    let isClosed = false;
    return {
      isClosed: () => isClosed,
      close: async () => { if (fails) throw refusal; isClosed = true; closed.push(name); },
    } as unknown as Page;
  };
  const pages = [page("first", true), page("second", false)];
  let onClose: () => void = () => undefined;
  const context = {
    pages: () => pages.filter((entry) => !entry.isClosed()),
    on: (_event: "close", listener: () => void) => { onClose = listener; },
    close: async () => { closed.push("context"); onClose(); },
  } as unknown as BrowserContext;
  const lifecycle = observeContextLifecycle(context);
  await assert.rejects(
    closeContextWithProof({ clock: manualClock(new Date(0)), scheduler: { schedule: () => ({ cancel: () => undefined }) }, closeProofMs: 1_000 },
      context, lifecycle, "fixture", "profile-reset"),
    (error: unknown) => error === refusal,
  );
  assert.deepEqual(closed, ["second", "context"]);
  assert.equal(lifecycle.closed(), true);
});
