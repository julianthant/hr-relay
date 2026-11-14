import assert from "node:assert/strict";
import { afterEach, it, vi } from "vitest";
import { chatGptFixture } from "../../support/helpers/chatgpt-account-fixtures.js";
import { ERROR_CATALOG } from "../../../src/models/failures/error-catalog.js";
import { createChatGptAccountService, nextChatGptAttemptStep, nextChatGptLifecycle, type ChatGptAttempt, type ChatGptAttemptEvent,
  type ChatGptAttemptStep, type ChatGptLifecycle, type ChatGptLifecycleEvent } from "../../../src/backend/accounts/chatgpt-account-service.js";

afterEach(() => { vi.restoreAllMocks(); });

const fakeAttempt = (generation: number): ChatGptAttempt => ({ generation, step: "listening", cancel: async () => {} });
const lifetime = (): Extract<ChatGptLifecycle, { phase: "signing-out" }>["lifetime"] => new Promise(() => {});

// Design section 4, entry 21. `same` = the state object comes back unchanged; a code = the event is refused with it.
type Expected = "same" | "CHATGPT_AUTH_BUSY" | "CHATGPT_SERVICE_CLOSED" | { readonly phase: ChatGptLifecycle["phase"]; readonly epoch: number };
it("walks every lifecycle phase and event against the design table", () => {
  const current = fakeAttempt(5), other = fakeAttempt(4), out = lifetime();
  const states: Record<ChatGptLifecycle["phase"], ChatGptLifecycle> = {
    idle: { phase: "idle", epoch: 5 },
    "signing-in": { phase: "signing-in", epoch: 5, attempt: current },
    "signing-out": { phase: "signing-out", epoch: 5, lifetime: out },
    closed: { phase: "closed", epoch: 5, attempt: other, lifetime: out },
  };
  const events = {
    "sign-in": { kind: "sign-in", attempt: fakeAttempt(6) },
    release: { kind: "release", attempt: current },
    "release-other": { kind: "release", attempt: other },
    cancel: { kind: "cancel", attempt: current },
    "cancel-stale": { kind: "cancel", attempt: other },
    "sign-out": { kind: "sign-out", lifetime: lifetime() },
    "sign-out-done": { kind: "sign-out-done", lifetime: out },
    "sign-out-done-other": { kind: "sign-out-done", lifetime: lifetime() },
    close: { kind: "close" },
  } satisfies Record<string, ChatGptLifecycleEvent>;
  const table: Record<ChatGptLifecycle["phase"], Record<keyof typeof events, Expected>> = {
    idle: { "sign-in": { phase: "signing-in", epoch: 6 }, release: "same", "release-other": "same",
      // The design's cell says not-signing-in; the old generation rule still fences a settled attempt whose generation is current.
      cancel: { phase: "idle", epoch: 6 }, "cancel-stale": "same",
      "sign-out": { phase: "signing-out", epoch: 6 }, "sign-out-done": "same", "sign-out-done-other": "same", close: { phase: "closed", epoch: 6 } },
    "signing-in": { "sign-in": "CHATGPT_AUTH_BUSY", release: { phase: "idle", epoch: 5 }, "release-other": "same",
      cancel: { phase: "signing-in", epoch: 6 }, "cancel-stale": "same",
      "sign-out": { phase: "signing-out", epoch: 6 }, "sign-out-done": "same", "sign-out-done-other": "same", close: { phase: "closed", epoch: 6 } },
    "signing-out": { "sign-in": "CHATGPT_AUTH_BUSY", release: "same", "release-other": "same", cancel: "same", "cancel-stale": "same",
      "sign-out": "CHATGPT_AUTH_BUSY", "sign-out-done": { phase: "idle", epoch: 5 }, "sign-out-done-other": "same", close: { phase: "closed", epoch: 6 } },
    closed: { "sign-in": "CHATGPT_SERVICE_CLOSED", release: "same", "release-other": "same", cancel: "same", "cancel-stale": "same",
      "sign-out": "same", "sign-out-done": "same", "sign-out-done-other": "same",
      // The design's cell says closed; the old generation rule bumps on every close.
      close: { phase: "closed", epoch: 6 } },
  };
  for (const [phase, row] of Object.entries(table) as [ChatGptLifecycle["phase"], Record<keyof typeof events, Expected>][])
    for (const [name, expected] of Object.entries(row) as [keyof typeof events, Expected][]) {
      const state = states[phase], cell = `${phase} x ${name}`;
      if (expected === "CHATGPT_AUTH_BUSY" || expected === "CHATGPT_SERVICE_CLOSED") {
        assert.throws(() => nextChatGptLifecycle(state, events[name]), { code: expected }, cell); continue;
      }
      const next = nextChatGptLifecycle(state, events[name]);
      if (expected === "same") { assert.equal(next, state, cell); continue; }
      assert.deepEqual({ phase: next.phase, epoch: next.epoch }, expected, cell);
      if (next.phase === "signing-in") assert.equal(next.attempt, name === "sign-in" ? events["sign-in"].attempt : current, cell);
      if (next.phase === "signing-out") assert.equal(next.lifetime, events["sign-out"].lifetime, cell);
      // Closed keeps the attempt or sign-out it drains, so an overlapping close waits for it too.
      if (next.phase === "closed") assert.deepEqual([next.attempt, next.lifetime], phase === "signing-in" ? [current, undefined]
        : phase === "signing-out" ? [undefined, out] : phase === "closed" ? [other, out] : [undefined, undefined], cell);
    }
});

it("walks every attempt step and event against the design table", () => {
  const steps: ChatGptAttemptStep[] = ["starting", "listening", "exchanging", "stored", "settling"];
  const out = { refused: "out-of-order" } as const;
  const advance: Record<string, Partial<Record<ChatGptAttemptEvent, ReturnType<typeof nextChatGptAttemptStep>>>> = {
    starting: { listening: "listening", "callback-accepted": out, "session-stored": out },
    listening: { listening: out, "callback-accepted": "exchanging", "session-stored": out },
    exchanging: { listening: out, "callback-accepted": out, "session-stored": "stored" },
    // D2: once the session is stored, the timer can no longer fail the attempt as expired.
    stored: { listening: out, "callback-accepted": out, "session-stored": out, expire: { refused: "session-stored" } },
  };
  const events: ChatGptAttemptEvent[] = ["listening", "callback-accepted", "session-stored", "settle-ok", "expire", "cancel", "callback-error", "startup-failed"];
  for (const step of steps)
    for (const event of events) {
      // Each settling event moves any non-settling step to settling; a second one is refused.
      const expected = step === "settling" ? { refused: "already-settling" } : advance[step]?.[event] ?? "settling";
      assert.deepEqual(nextChatGptAttemptStep(step, event), expected, `${step} x ${event}`);
    }
});

it("bumps the exported attempt generation exactly at sign-in, cancel, sign-out and close", async () => {
  const f = await chatGptFixture();
  try {
    const generation = async () => (await f.service.readAuthority()).attemptGeneration;
    const availability = async () => (await f.service.readAuthority()).availability;
    assert.equal(await generation(), 0);
    const first = await f.service.signIn({ usePlan: true });
    assert.equal(await generation(), 1); assert.equal(await availability(), "pending");
    await assert.rejects(f.service.signIn({ usePlan: true }), { code: "CHATGPT_AUTH_BUSY" });
    await f.callback(first); assert.equal((await first.completion).state, "connected");
    assert.equal(await generation(), 1); assert.equal(await availability(), "available");
    // A settled attempt whose generation is still current fences in-flight work when cancelled (the old generation rule).
    await first.cancel(); assert.equal(await generation(), 2); await first.cancel(); assert.equal(await generation(), 2);
    const cancelled = await f.service.signIn({ usePlan: true }); assert.equal(await generation(), 3);
    await cancelled.cancel(); assert.equal(await generation(), 4); assert.equal(await availability(), "available");
    await assert.rejects(cancelled.completion, { code: "CHATGPT_AUTH_CANCELLED" });
    const revoking = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
    f.setRevocationHook(async () => { entered.resolve(); await revoking.promise; });
    const signingOut = f.service.signOut(); await entered.promise;
    assert.equal(await generation(), 5); assert.equal(await availability(), "pending");
    assert.deepEqual(f.service.readAccount(), { state: "unavailable", code: "CHATGPT_AUTH_BUSY", message: ERROR_CATALOG.CHATGPT_AUTH_BUSY.text });
    await assert.rejects(f.service.signIn({ usePlan: true }), { code: "CHATGPT_AUTH_BUSY" });
    await assert.rejects(f.service.signOut(), { code: "CHATGPT_AUTH_BUSY" });
    revoking.resolve(); assert.equal((await signingOut).state, "signed-out");
    assert.equal(await generation(), 5); assert.equal(await availability(), "signed-out");
    await f.service.close(); assert.equal(await generation(), 6); assert.equal(await availability(), "closed");
    await assert.rejects(f.service.signIn({ usePlan: true }), { code: "CHATGPT_SERVICE_CLOSED" });
    await assert.rejects(f.service.signOut(), { code: "CHATGPT_SERVICE_CLOSED" });
    await f.service.close(); assert.equal(await generation(), 7);
  } finally { await f.cleanup(); }
});

it("releases admission by attempt identity so the next sign-in is admitted after any settle", async () => {
  const f = await chatGptFixture();
  try {
    const denied = await f.service.signIn({ usePlan: true });
    await f.callback(denied, { error: "access_denied" }); await assert.rejects(denied.completion, { code: "CHATGPT_AUTH_CANCELLED" });
    const next = await f.service.signIn({ usePlan: true });
    // A stale attempt's cancel neither fences nor releases the current one.
    const before = (await f.service.readAuthority()).attemptGeneration;
    await denied.cancel();
    assert.equal((await f.service.readAuthority()).attemptGeneration, before);
    await assert.rejects(f.service.signIn({ usePlan: true }), { code: "CHATGPT_AUTH_BUSY" });
    await next.cancel();
  } finally { await f.cleanup(); }
});

const settledFlag = (promise: Promise<unknown>) => { const flag = { settled: false }; void promise.then(() => { flag.settled = true; }, () => { flag.settled = true; }); return flag; };

it("close during a sign-in returns only after the attempt has settled, and holds closed", async () => {
  const f = await chatGptFixture();
  try {
    const attempt = await f.service.signIn({ usePlan: true }), completion = settledFlag(attempt.completion);
    await f.service.close();
    assert.equal(completion.settled, true);
    await assert.rejects(attempt.completion, { code: "CHATGPT_AUTH_CANCELLED" });
    assert.equal((await f.service.readAuthority()).availability, "closed");
  } finally { await f.cleanup(); }
});

it("an overlapping second close waits for the drain the first close started", async () => {
  const f = await chatGptFixture();
  try {
    const attempt = await f.service.signIn({ usePlan: true }), completion = settledFlag(attempt.completion);
    const first = f.service.close();
    await f.service.close();
    assert.equal(completion.settled, true);
    await first;
    assert.equal((await f.service.readAuthority()).attemptGeneration, 3);
  } finally { await f.cleanup(); }
});

it("a second cancel during a settle keeps admission reserved until the first settle has closed the callback server", async () => {
  const f = await chatGptFixture();
  try {
    const attempt = await f.service.signIn({ usePlan: true }), completion = settledFlag(attempt.completion);
    const first = attempt.cancel(), second = attempt.cancel(), secondDone = settledFlag(second);
    // The server's close lands on a later tick; Node runs all queued promise jobs first, so a cancel that skipped the drain is done by now.
    for (let turn = 0; turn < 50; turn++) await Promise.resolve();
    assert.equal(secondDone.settled, false);
    assert.equal(attempt.signingIn, true);
    await assert.rejects(f.service.signIn({ usePlan: true }), { code: "CHATGPT_AUTH_BUSY" });
    await second;
    assert.equal(completion.settled, true); assert.equal(attempt.signingIn, false);
    await first;
  } finally { await f.cleanup(); }
});

it("close during a sign-out that drains a sign-in waits for both and stays closed when the sign-out ends", async () => {
  const f = await chatGptFixture();
  try {
    const attempt = await f.service.signIn({ usePlan: true }), completion = settledFlag(attempt.completion);
    const signingOut = f.service.signOut(), signOut = settledFlag(signingOut);
    await f.service.close();
    assert.equal(completion.settled, true); assert.equal(signOut.settled, true);
    await assert.rejects(attempt.completion, { code: "CHATGPT_AUTH_CANCELLED" });
    await assert.rejects(signingOut, { code: "CHATGPT_SERVICE_CLOSED" });
    assert.equal((await f.service.readAuthority()).availability, "closed");
  } finally { await f.cleanup(); }
});

it("D2: the sign-in timer cannot fail an attempt after its session is stored", async () => {
  const f = await chatGptFixture(), realSetTimeout = globalThis.setTimeout;
  let expire: (() => void) | undefined, exchanged = false, fired = false;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((handler: () => void, ms?: number, ...rest: unknown[]) => {
    if (ms === 300_000) expire = handler;
    return realSetTimeout(handler, ms, ...rest);
  }) as typeof setTimeout);
  // The timer fires in the first turn after the session file is replaced, before the attempt finishes.
  const service = createChatGptAccountService({ admission: f.admission, stateRoot: f.root, clock: f.clock, fetch: f.transport,
    credentialHooks: { afterRename: () => { if (exchanged && !fired && expire !== undefined) { fired = true; queueMicrotask(expire); } } } });
  f.setTokenHook(async () => { exchanged = true; });
  try {
    const attempt = await service.signIn({ usePlan: true });
    await f.callback(attempt);
    assert.equal((await attempt.completion).state, "connected");
    assert.equal(fired, true);
    assert.equal(service.readAccount().state, "connected");
  } finally { await service.close(); await f.cleanup(); }
});

it("D3: an attempt reports signing-in from the service lifecycle and stops when the service settles it", async () => {
  const f = await chatGptFixture();
  try {
    const attempt = await f.service.signIn({ usePlan: true });
    assert.equal(attempt.signingIn, true);
    const observed = attempt.completion.then(() => attempt.signingIn);
    await f.callback(attempt);
    assert.equal(await observed, false);
    const cancelled = await f.service.signIn({ usePlan: true });
    const cancelling = cancelled.cancel();
    assert.equal(cancelled.signingIn, true);
    await cancelling; assert.equal(cancelled.signingIn, false);
    const fenced = await f.service.signIn({ usePlan: true });
    const signingOut = f.service.signOut();
    assert.equal(fenced.signingIn, false);
    await signingOut;
  } finally { await f.cleanup(); }
});
