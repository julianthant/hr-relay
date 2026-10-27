import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync, writeFileSync, realpathSync, unlinkSync, symlinkSync, linkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import type { BrowserContext, Worker } from "playwright";
import { manualClock } from "../../../src/rules/time/clock.js";
import { createProfileOnboardingDuoProvider, ProfileOnboardingDuoProviderError } from "../../../src/backend/profiles/onboarding-duo-provider.js";
import type { DraftDuoAttempt, DraftDuoCapability, DraftDuoObservedContext } from "../../../src/backend/profiles/onboarding-duo.js";

function world(method: "key" | "touch" = "key") {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "relay-onboarding-provider-")));
  const browserRoot = join(directory, "browsers");
  const extensionDirectory = join(directory, "extension");
  mkdirSync(browserRoot, { mode: 0o700 }); mkdirSync(join(extensionDirectory, "src"), { recursive: true, mode: 0o700 });
  writeFileSync(join(extensionDirectory, "relay-manifest.json"), "{}");
  for (const name of ["relay-background.js", "relay-content.js", "relay-inpage.js", "service.js", "crypto.js", "accounts.js", "sign-count.js", "username.js"]) writeFileSync(join(extensionDirectory, "src", name), "");
  writeFileSync(join(extensionDirectory, "unlisted.txt"), "synthetic unlisted source");
  const clock = manualClock(new Date("2026-10-01T00:00:00.000Z"));
  const attempt: DraftDuoAttempt = { operationId: randomUUID(), profileId: randomUUID(), accountId: randomUUID(), generation: 1,
    attemptId: randomUUID(), method, expiresAt: "2026-10-01T00:10:00.000Z" };
  const requests: unknown[] = [];
  let waiter: ((value: unknown) => void) | undefined;
  const replies = new Map<string, (value: unknown) => void>();
  let closed = false;
  let launchCount = 0;
  let profile = "";
  const listeners: (() => void)[] = [];
  const calls: string[] = [];
  const failures: Error[] = [];
  const reportFailure = async (error: Error): Promise<void> => { failures.push(error); };
  let current = true;
  let observed: DraftDuoObservedContext | undefined;
  const worker = {
    url: () => "chrome-extension://owned-extension/src/relay-background.js",
    async evaluate(_callback: unknown, input: { method: string; args: unknown[] }) {
      if (input.method === "install") return;
      if (input.method === "next") {
        if (requests.length) return requests.shift();
        return new Promise(resolve => { waiter = resolve; });
      }
      if (input.method === "reply") { replies.get(String(input.args[0]))?.(input.args[1]); return; }
      if (input.method === "stop") { waiter?.(null); waiter = undefined; return; }
      throw new Error("unexpected operation");
    },
  } as unknown as Worker;
  const page = { goto: async () => undefined, close: async () => undefined, isClosed: () => closed };
  const context = { serviceWorkers: () => [worker], pages: () => closed ? [] : [page], on: (_event: string, callback: () => void) => { listeners.push(callback); },
    close: async () => { closed = true; for (const listener of listeners) listener(); waiter?.(null); waiter = undefined; } } as unknown as BrowserContext;
  const provider = createProfileOnboardingDuoProvider({ browserRoot, extensionDirectory, clock, closeProofMs: 50,
    launcher: { launch: async input => {
      launchCount++; profile = input.profileDirectory;
      assert.equal(existsSync(join(input.extensionDirectory, "unlisted.txt")), false);
      assert.equal(input.headless, false);
      const preferences = JSON.parse(readFileSync(join(profile, "Default", "Preferences"), "utf8"));
      assert.equal(preferences.credentials_enable_service, false);
      assert.equal(preferences.profile.password_manager_enabled, false);
      return context;
    }, observeProcess: () => ({ pid: 123, observation: closed ? { state: "gone" } : { state: "alive", identity: { platform: "darwin", startToken: "synthetic-process" } } }) },
  });
  const bind = async (input: DraftDuoObservedContext): Promise<DraftDuoCapability> => {
    observed = input;
    return {
      attempt, scope: { armId: randomUUID(), contextId: input.contextId, accountId: attempt.accountId, tabId: input.tabId,
        origin: input.origin, rpId: input.rpId, armedAt: clock.now().toISOString(), expiresAt: attempt.expiresAt },
      assertCurrent() { if (!current) throw new Error("synthetic revoked capability"); },
      async persistPending() { calls.push("persist"); return { revision: 1 }; },
      async provision(credentialId) { calls.push("provision"); return { credentialId, privateKeyPkcs8: "synthetic", publicKeySpki: "synthetic", transport: "usb", isResidentCredential: false, createdAt: clock.now().toISOString(), highWater: 4 }; },
      async reserveSignCount() { calls.push("reserve"); return { count: 5, revision: 2 }; },
      async recordCeremony(receipt) { calls.push(receipt.mechanism); },
      async recordPortalAcceptance(receipt) { calls.push(receipt.acceptance); },
      async retainUnknown() { calls.push("unknown"); },
    };
  };
  function send(kind: string, data: unknown): Promise<unknown> {
    const id = randomUUID();
    const result = new Promise(resolve => replies.set(id, resolve));
    const request = { id, kind, data };
    if (waiter) { const resolve = waiter; waiter = undefined; resolve(request); }
    else requests.push(request);
    return result;
  }
  return { provider, attempt, bind, calls, send, clock, extensionDirectory, reportFailure, failures, closeBrowser: () => context.close(), observed: () => observed, revoke: () => { current = false; },
    launches: () => launchCount, profile: () => profile,
    async cleanup() {
      try { await provider.cancel(attempt); } catch (error) { assert.ok(error instanceof ProfileOnboardingDuoProviderError); }
      assert.ok(closed || launchCount === 0);
      rmSync(directory, { recursive: true, force: true });
    } };
}
const BIND = { tabId: 7, origin: "https://test.duosecurity.com", rpId: "duosecurity.com", username: "alex@example.edu" };

describe("draft Duo provider", () => {
  it("binds real observed username independently of issuer account ID and keeps repeated start idempotent", async () => {
    const w = world();
    try {
      await w.provider.start(w.attempt, w.bind, w.reportFailure);
      await w.provider.start(w.attempt, w.bind, w.reportFailure);
      assert.equal(w.launches(), 1);
      assert.deepEqual(await w.send("bind", BIND), { ok: true, value: { accountId: w.attempt.accountId } });
      assert.equal(w.observed()?.accountName, BIND.username);
      assert.equal(w.observed()?.tabId, 7);
      const requestId = randomUUID();
      assert.deepEqual(await w.send("persist", { credentialId: "public-id", privateKeyPkcs8: "synthetic", publicKeySpki: "synthetic",
        transport: "usb", isResidentCredential: false, createdAt: w.clock.now().toISOString() }), { ok: true, value: { revision: 1 } });
      await w.send("software-created", { credentialId: "public-id", requestId });
      await w.send("reserve", { credentialId: "public-id", requestId: randomUUID() });
      await w.send("portal-accepted", { credentialId: "public-id", requestId });
      assert.deepEqual(w.calls, ["persist", "fast-duo", "provision", "reserve", "portal-accepted"]);
      assert.deepEqual(await w.provider.cancel(w.attempt), { state: "closed" });
      assert.equal(existsSync(w.profile()), false);
    } finally { await w.cleanup(); }
  });

  it("refuses foreign attempt cancellation without closing the owned browser", async () => {
    const w = world();
    try {
      await w.provider.start(w.attempt, w.bind, w.reportFailure);
      await assert.rejects(w.provider.cancel({ ...w.attempt, attemptId: randomUUID() }), error => error instanceof ProfileOnboardingDuoProviderError && error.kind === "refused");
      assert.equal(existsSync(w.profile()), true);
    } finally { await w.cleanup(); }
  });

  for (const reason of ["expiry", "revocation"] as const) it(`rejects ${reason} before pending custody and never grants a stale ACK`, async () => {
    const w = world();
    try {
      await w.provider.start(w.attempt, w.bind, w.reportFailure);
      await w.send("bind", BIND);
      if (reason === "expiry") w.clock.advanceWall(600001); else w.revoke();
      assert.deepEqual(await w.send("persist", { credentialId: "public-id", privateKeyPkcs8: "synthetic", publicKeySpki: "synthetic",
        transport: "usb", isResidentCredential: false, createdAt: w.clock.now().toISOString() }), { ok: false });
      assert.ok(!w.calls.includes("persist"));
    } finally { await w.cleanup(); }
  });

  it("refuses a binder returning a different operation before accepting any enrollment", async () => {
    const w = world();
    try {
      await w.provider.start(w.attempt, async input => ({ ...await w.bind(input), attempt: { ...w.attempt, operationId: randomUUID() } }), w.reportFailure);
      assert.deepEqual(await w.send("bind", BIND), { ok: false });
      assert.ok(!w.calls.includes("persist"));
      assert.ok(!w.calls.includes("unknown"));
    } finally { await w.cleanup(); }
  });

  it("refuses expired start before browser launch", async () => {
    const w = world();
    try {
      w.clock.advanceWall(600001);
      await assert.rejects(w.provider.start(w.attempt, w.bind, w.reportFailure), error => error instanceof ProfileOnboardingDuoProviderError && error.kind === "refused");
      assert.equal(w.launches(), 0);
    } finally { await w.cleanup(); }
  });
  it("requires native ceremony and portal facts independently without persisting a private native key", async () => {
    const w = world("touch");
    try {
      await w.provider.start(w.attempt, w.bind, w.reportFailure);
      await w.send("bind", BIND);
      const requestId = randomUUID();
      await w.send("native-created", { credentialId: "native-public-id", requestId });
      assert.deepEqual(w.calls, ["native-platform"]);
      await w.send("portal-accepted", { credentialId: "native-public-id", requestId });
      assert.deepEqual(w.calls, ["native-platform", "portal-accepted"]);
    } finally { await w.cleanup(); }
  });

  for (const kind of ["symlink", "hardlink"] as const) it(`refuses ${kind} public source before launch`, async () => {
    const w = world();
    try {
      const source = join(w.extensionDirectory, "src", "relay-background.js");
      const target = join(w.extensionDirectory, "unlisted.txt");
      unlinkSync(source);
      if (kind === "symlink") symlinkSync(target, source); else linkSync(target, source);
      await assert.rejects(w.provider.start(w.attempt, w.bind, w.reportFailure), error => error instanceof ProfileOnboardingDuoProviderError && error.kind === "unavailable");
      assert.equal(w.launches(), 0);
    } finally { await w.cleanup(); }
  });

  it("reports real browser closure before binding through the issued attempt callback", async () => {
    const w = world();
    try {
      await w.provider.start(w.attempt, w.bind, w.reportFailure);
      await w.closeBrowser();
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(w.failures.length, 1);
      const failure = w.failures[0];
      assert.ok(failure instanceof ProfileOnboardingDuoProviderError);
      assert.equal(failure.kind, "unavailable");
    } finally { await w.cleanup(); }
  });

  it("ordinary software-key window close does not invent a portal failure or erase pending custody", async () => {
    const w = world();
    try {
      await w.provider.start(w.attempt, w.bind, w.reportFailure);
      await w.send("bind", BIND);
      await w.send("persist", { credentialId: "public-id", privateKeyPkcs8: "synthetic", publicKeySpki: "synthetic",
        transport: "usb", isResidentCredential: false, createdAt: w.clock.now().toISOString() });
      await w.send("software-created", { credentialId: "public-id", requestId: randomUUID() });
      await w.closeBrowser();
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.deepEqual(w.failures, []);
      assert.ok(w.calls.includes("unknown"));
      assert.ok(!w.calls.includes("portal-accepted"));
    } finally { await w.cleanup(); }
  });

});
