import assert from "node:assert/strict";
import type { Page } from "playwright";
import { it } from "vitest";
import { BrowserLoginError, type SystemLoginContext } from "../../../../src/backend/systems/browser-shared/login-contract.js";
import { raceCancellation } from "../../../../src/backend/systems/browser-shared/ucsd-sso.js";

function context(signal: AbortSignal, assertCurrent: () => void): Pick<SystemLoginContext, "page" | "signal" | "assertCurrent"> {
  return { page: { url: () => "https://sso.example.invalid/login" } as unknown as Page, signal, assertCurrent };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, refuse) => { resolve = accept; reject = refuse; });
  return { promise, resolve, reject };
}

it("never starts an operation after an initial owner refusal", async () => {
  const refusal = new Error("fixture owner revoked");
  let started = false;
  const run = raceCancellation(() => {
    started = true;
    return Promise.reject(new Error("operation must not start"));
  }, "ucpath", "navigate-login-entry", context(new AbortController().signal, () => { throw refusal; }));
  await assert.rejects(run, error => error === refusal);
  assert.equal(started, false);
});

it("rechecks ownership before invoking the deferred operation producer", async () => {
  const refusal = new Error("fixture owner revoked");
  let current = true, started = false;
  const run = raceCancellation(() => {
    started = true;
    return Promise.resolve("private result");
  }, "ucpath", "navigate-login-entry", context(new AbortController().signal, () => { if (!current) throw refusal; }));
  current = false;
  await assert.rejects(run, error => error === refusal);
  assert.equal(started, false);
});

it("rejects a final read result when ownership was revoked while the operation awaited", async () => {
  const refusal = new Error("fixture owner revoked");
  const read = deferred<string>();
  let current = true, started = false;
  const run = raceCancellation(() => {
    started = true;
    return read.promise;
  }, "ucpath", "verify-landing", context(new AbortController().signal, () => { if (!current) throw refusal; }));
  await Promise.resolve();
  assert.equal(started, true);
  current = false;
  read.resolve("private result");
  await assert.rejects(run, error => error === refusal);
});

it("observes a late owned-operation rejection after returning the primary cancellation failure", async () => {
  const controller = new AbortController();
  const owned = deferred<string>();
  let started = false;
  const unhandled: unknown[] = [];
  const onUnhandled = (error: unknown) => { unhandled.push(error); };
  process.on("unhandledRejection", onUnhandled);
  try {
    const run = raceCancellation(() => {
      started = true;
      return owned.promise;
    }, "ucpath", "navigate-login-entry", context(controller.signal, () => undefined));
    await Promise.resolve();
    assert.equal(started, true);
    controller.abort();
    await assert.rejects(run, error => error instanceof BrowserLoginError
      && error.system === "ucpath" && error.step === "navigate-login-entry" && error.detail === "the session was cancelled");
    owned.reject(new Error("navigation closed during owned cleanup"));
    await new Promise<void>(resolve => { setImmediate(resolve); });
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

it("keeps the named owner refusal when cancellation observes revocation", async () => {
  const controller = new AbortController();
  const refusal = new Error("fixture owner revoked"), owned = deferred<string>();
  let current = true, started = false;
  const run = raceCancellation(() => {
    started = true;
    return owned.promise;
  }, "ucpath", "navigate-login-entry", context(controller.signal, () => { if (!current) throw refusal; }));
  await Promise.resolve();
  assert.equal(started, true);
  current = false;
  controller.abort();
  await assert.rejects(run, error => error === refusal);
  owned.resolve("late private result");
});

it("returns the exact result while the owner remains current", async () => {
  const result = { state: "authenticated" };
  assert.equal(await raceCancellation(() => Promise.resolve(result), "ucpath", "verify-landing",
    context(new AbortController().signal, () => undefined)), result);
});
