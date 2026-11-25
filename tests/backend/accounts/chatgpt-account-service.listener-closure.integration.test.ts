import assert from "node:assert/strict";
import { Server } from "node:http";
import { afterEach, it, vi } from "vitest";
import { createBoundProfileFixture } from "../../support/helpers/admission-fixture.js";
import { chatGptFixture } from "../../support/helpers/chatgpt-account-fixtures.js";

const stuck = new Set<Server>();
afterEach(async () => {
  vi.restoreAllMocks();
  for (const server of stuck) await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); });
  stuck.clear();
});

/** Every listener refuses to close, so nothing proves its port was released. */
async function unclosable() {
  const profile = await createBoundProfileFixture(), f = await chatGptFixture(profile.admission);
  const cause = new Error("private listener failure");
  vi.spyOn(Server.prototype, "close").mockImplementation(function close(this: Server, done) { stuck.add(this); done?.(cause); return this; });
  const reports = (error: unknown): boolean => {
    assert.equal((error as { code?: string }).code, "CHATGPT_RESOURCE_CLOSURE_UNPROVED");
    const pending: unknown[] = [error], seen = new Set<unknown>();
    while (pending.length !== 0) {
      const value = pending.pop(); if (seen.has(value)) continue; seen.add(value);
      if (value instanceof AggregateError) { const causes: readonly unknown[] = value.errors; pending.push(...causes); }
      if (value instanceof Error) pending.push(value.cause);
    }
    assert.equal(seen.has(cause), true);
    return true;
  };
  return { ...f, profile, reports };
}

it("keeps an attempt held when its settle cannot close the listener", async () => {
  const f = await unclosable();
  try {
    const attempt = await f.service.signIn({ usePlan: true });
    await f.callback(attempt, { error: "access_denied" });
    await assert.rejects(attempt.completion, { code: "CHATGPT_AUTH_UNAVAILABLE" });
    assert.equal(attempt.held, true); assert.equal(attempt.signingIn, false);
    assert.throws(() => f.service.readStatus(), { code: "CHATGPT_RESOURCE_CLOSURE_UNPROVED" });
    await assert.rejects(f.service.signIn({ usePlan: true }), { code: "CHATGPT_AUTH_BUSY" });
    await assert.rejects(attempt.cancel(), f.reports);
    await assert.rejects(f.service.signIn({ usePlan: true }), { code: "CHATGPT_AUTH_BUSY" });
    await assert.rejects(f.service.signOut(), f.reports);
    await assert.rejects(f.service.signIn({ usePlan: true }), { code: "CHATGPT_AUTH_BUSY" });
    await assert.rejects(f.service.close(), f.reports);
  } finally { await f.profile.close(); }
});

it("keeps an attempt held when its cancel cannot close the listener", async () => {
  const f = await unclosable();
  try {
    const attempt = await f.service.signIn({ usePlan: true });
    await assert.rejects(attempt.cancel(), f.reports);
    await assert.rejects(attempt.completion, { code: "CHATGPT_AUTH_UNAVAILABLE" });
    assert.equal(attempt.signingIn, false);
    await assert.rejects(f.service.signIn({ usePlan: true }), { code: "CHATGPT_AUTH_BUSY" });
    await assert.rejects(f.service.close(), f.reports);
  } finally { await f.profile.close(); }
});

it("keeps a failed startup held when it cannot close the listener", async () => {
  const f = await unclosable();
  try {
    vi.spyOn(Server.prototype, "address").mockReturnValue(null);
    await assert.rejects(f.service.signIn({ usePlan: true }), f.reports);
    await assert.rejects(f.service.signIn({ usePlan: true }), { code: "CHATGPT_AUTH_BUSY" });
    await assert.rejects(f.service.close(), f.reports);
  } finally { await f.profile.close(); }
});

it("keeps an attempt held through the sign-out that could not close its listener", async () => {
  const f = await unclosable();
  try {
    await f.service.signIn({ usePlan: true });
    const before = f.repository.read();
    await assert.rejects(f.service.signOut(), f.reports);
    assert.deepEqual(f.repository.read(), before);
    await assert.rejects(f.service.signIn({ usePlan: true }), { code: "CHATGPT_AUTH_BUSY" });
    await assert.rejects(f.service.close(), f.reports);
  } finally { await f.profile.close(); }
});

it("reports at close a listener that a close could not close", async () => {
  const f = await unclosable();
  try {
    const attempt = await f.service.signIn({ usePlan: true });
    for (let close = 0; close < 2; close++) await assert.rejects(f.service.close(), f.reports);
    await assert.rejects(attempt.completion, { code: "CHATGPT_AUTH_UNAVAILABLE" });
  } finally { await f.profile.close(); }
});
