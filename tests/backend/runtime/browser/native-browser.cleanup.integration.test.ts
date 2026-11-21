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

it("attempts context close within the deadline when a sibling page stalls, and keeps the page refusal with the timeout", async () => {
  const refusal = new Error("fixture page close refused");
  let contextCloseAttempted = false;
  const pages = [
    { isClosed: () => false, close: async () => { throw refusal; } },
    { isClosed: () => false, close: () => new Promise<void>(() => undefined) },
  ] as unknown as Page[];
  const context = {
    pages: () => pages,
    on: () => undefined,
    close: () => { contextCloseAttempted = true; return new Promise<void>(() => undefined); },
  } as unknown as BrowserContext;
  let expire: (() => void) | undefined;
  const closing = closeContextWithProof({ clock: manualClock(new Date(0)),
    scheduler: { schedule: (_at: number, fire: () => void) => { expire = fire; return { cancel: () => undefined }; } }, closeProofMs: 1_000 },
  context, observeContextLifecycle(context), "fixture", "profile-reset");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(contextCloseAttempted, true);
  expire?.();
  await assert.rejects(closing, (error: unknown) => error instanceof AggregateError
    && error.errors.includes(refusal) && error.errors.some(entry => entry instanceof Error && /proof deadline/u.test(entry.message)));
});
