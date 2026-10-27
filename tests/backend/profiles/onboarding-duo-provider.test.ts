import { z } from "zod";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync, writeFileSync, realpathSync, unlinkSync, symlinkSync, linkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import type { BrowserContext, Worker } from "playwright";
import { manualClock } from "../../../src/rules/time/clock.js";
import { createProfileOnboardingDuoProvider, ProfileOnboardingDuoProviderError } from "../../../src/backend/profiles/onboarding-duo-provider.js";
import type { DraftDuoAttempt, DraftDuoBrowserOwner, DraftDuoCapability, DraftDuoObservedContext } from "../../../src/backend/profiles/onboarding-duo.js";

function world(method: "key" | "touch" = "key") {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "relay-onboarding-provider-")));
  const browserRoot = join(directory, "browsers");
  const extensionDirectory = join(directory, "extension");
  mkdirSync(browserRoot, { mode: 0o700 }); mkdirSync(join(extensionDirectory, "src"), { recursive: true, mode: 0o700 });
  writeFileSync(join(extensionDirectory, "relay-manifest.json"), "{}");
  writeFileSync(join(extensionDirectory, "LICENSE"), "synthetic license fixture");
  writeFileSync(join(extensionDirectory, "THIRD_PARTY_NOTICES.md"), "synthetic notices fixture");
  mkdirSync(join(extensionDirectory, "src", "icons"), { mode: 0o700 });
  for (const name of ["options.html", "options.js", "popup.html", "popup.js", "relay-options.js", "styles.css", "icons/autopilot.svg", "icons/key-round.svg", "icons/plus.svg", "icons/shield-check.svg", "relay-background.js", "relay-content.js", "relay-inpage.js", "relay-native.js", "service.js", "crypto.js", "accounts.js", "sign-count.js", "username.js"]) writeFileSync(join(extensionDirectory, "src", name), "");
  writeFileSync(join(extensionDirectory, "unlisted.txt"), "synthetic unlisted source");
  const clock = manualClock(new Date("2026-10-01T00:00:00.000Z"));
  const attempt: DraftDuoAttempt = { operationId: randomUUID(), profileId: randomUUID(), accountId: randomUUID(), generation: 1,
    attemptId: randomUUID(), method, expiresAt: "2026-10-01T00:10:00.000Z" };
  const requests: unknown[] = [];
  let waiter: ((value: unknown) => void) | undefined;
  let browserWaiter: ((value: unknown) => void) | undefined;
  let blockedStop = false, releaseStop: (() => void) | undefined, portalPages = 0;
  const replies = new Map<string, (value: unknown) => void>();
  let closed = false;
  let launchCount = 0;
  let profile = "";
  const listeners: (() => void)[] = [];
  const calls: string[] = [];
  let documentCurrent = true;
  let driftAfter: string | undefined;
  function called(name: string): void { calls.push(name); if (name === driftAfter) documentCurrent = false; }
  const failures: Error[] = [];
  const reportFailure = async (error: Error): Promise<void> => { failures.push(error); };
  let current = true;
  let observed: DraftDuoObservedContext | undefined;
  const worker = {
    url: () => "chrome-extension://owned-extension/src/relay-background.js",
    async evaluate(_callback: unknown, input: { method: string; args: unknown[] }) {
      if (["install", "browserInstall"].includes(input.method)) return;
      if (input.method === "browserNext") return new Promise(resolve => { browserWaiter = resolve; });
      if (input.method === "browserStop") { browserWaiter?.(null); browserWaiter = undefined; return; }
      if (input.method === "assertContext") { if (!documentCurrent) throw new Error("synthetic document drift"); return; }
      if (input.method === "next") {
        if (requests.length) return requests.shift();
        return new Promise(resolve => { waiter = resolve; });
      }
      if (input.method === "reply") { replies.get(String(input.args[0]))?.(input.args[1]); return; }
      if (input.method === "stop") { if (blockedStop) await new Promise<void>(resolve => { releaseStop = resolve; }); waiter?.(null); waiter = undefined; return; }
      throw new Error("unexpected operation");
    },
  } as unknown as Worker;
  const page = { bringToFront: async () => undefined, goto: async () => undefined, close: async () => undefined, isClosed: () => closed };
  const context = { serviceWorkers: () => [worker], pages: () => closed ? [] : [page], on: (_event: string, callback: () => void) => { listeners.push(callback); },
    newPage: async () => { portalPages++; return { goto: async () => { throw new Error("synthetic navigation failure"); } }; },
    close: async () => { closed = true; for (const listener of listeners) listener(); waiter?.(null); waiter = undefined; browserWaiter?.(null); browserWaiter = undefined; } } as unknown as BrowserContext;
  const realProvider = createProfileOnboardingDuoProvider({ browserRoot, extensionDirectory, clock, closeProofMs: 50,
    launcher: { launch: async input => {
      launchCount++; profile = input.profileDirectory;
      assert.equal(existsSync(join(input.extensionDirectory, "unlisted.txt")), false);
      assert.equal(readFileSync(join(input.extensionDirectory, "LICENSE"), "utf8"), "synthetic license fixture");
      assert.equal(readFileSync(join(input.extensionDirectory, "THIRD_PARTY_NOTICES.md"), "utf8"), "synthetic notices fixture");
      assert.equal(input.headless, false);
      const preferences = z.strictObject({ credentials_enable_service: z.boolean(), profile: z.strictObject({ password_manager_enabled: z.boolean() }) }).parse(JSON.parse(readFileSync(join(profile, "Default", "Preferences"), "utf8")));
      assert.equal(preferences.credentials_enable_service, false);
      assert.equal(preferences.profile.password_manager_enabled, false);
      return context;
    }, observeProcess: () => ({ pid: 123, observation: closed ? { state: "gone" } : { state: "alive", identity: { platform: "darwin", startToken: "synthetic-process" } } }) },
  });
  const owner: DraftDuoBrowserOwner = { ...attempt, assertCurrent() { if (!current) throw new Error("synthetic revoked"); },
    async acquireCredentials() { throw new Error("unexpected credential acquisition"); },
    readState() { throw new Error("unexpected UI state"); }, async start() { throw new Error("unexpected UI start"); },
    async cancel() { throw new Error("unexpected UI cancel"); }, confirm() { throw new Error("unexpected UI confirmation"); } };
  const provider = { ...realProvider,
    async start(...args: Parameters<typeof realProvider.start>) {
      if (Date.parse(args[0].expiresAt) > clock.nowMs()) await realProvider.showBrowser(owner);
      return realProvider.start(...args);
    },
  };
  const bind = async (input: DraftDuoObservedContext): Promise<DraftDuoCapability> => {
    observed = input;
    return {
      attempt, scope: { armId: randomUUID(), contextId: input.contextId, accountId: attempt.accountId, tabId: input.tabId,
        origin: input.origin, rpId: input.rpId, armedAt: clock.now().toISOString(), expiresAt: attempt.expiresAt },
      assertCurrent() { if (!current) throw new Error("synthetic revoked capability"); },
      async persistPending() { called("persist"); return { revision: 1 }; },
      async provision(credentialId) { called("provision"); return { credentialId, privateKeyPkcs8: "synthetic", publicKeySpki: "synthetic", transport: "usb", isResidentCredential: false, createdAt: clock.now().toISOString(), highWater: 4 }; },
      async reserveSignCount() { called("reserve"); return { count: 5, revision: 2 }; },
      async recordCeremony(receipt) { called(receipt.mechanism); },
      async recordPortalAcceptance(receipt) { called(receipt.acceptance); },
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
  return { provider, owner, attempt, bind, calls, send, clock, driftOn: (name: string) => { driftAfter = name; }, drift: () => { documentCurrent = false; }, extensionDirectory, reportFailure, failures, closeBrowser: () => context.close(), observed: () => observed, revoke: () => { current = false; },
    launches: () => launchCount, profile: () => profile,
    portalPages: () => portalPages, blockStop: () => { blockedStop = true; }, releaseStop: () => { releaseStop?.(); },
    async cleanup() {
      try { await provider.cancel(attempt); await provider.closeBrowser(owner); } catch (error) { assert.ok(error instanceof ProfileOnboardingDuoProviderError); }
      assert.ok(closed || launchCount === 0);
      rmSync(directory, { recursive: true, force: true });
    } };
}
const BIND = { documentId: "A0000000000040008000000000000007", tabId: 7, origin: "https://test.duosecurity.com", rpId: "duosecurity.com", username: "alex@example.edu" };

describe("draft Duo provider", () => {
  it("single-flights concurrent portal commands and retains failed initialization instead of claiming a later success", async () => {
    const w = world();
    try {
      await w.provider.showBrowser(w.owner);
      const attempts = await Promise.allSettled([w.provider.openPortal(w.owner), w.provider.openPortal(w.owner)]);
      assert.ok(attempts.every(result => result.status === "rejected"));
      assert.equal(w.portalPages(), 1);
      await assert.rejects(w.provider.openPortal(w.owner));
      assert.equal(w.portalPages(), 1);
    } finally { await w.cleanup(); }
  });

  it("bounded failed arm closure stays uncertain and cannot permit a replacement attempt", async () => {
    const w = world();
    try {
      await w.provider.start(w.attempt, w.bind, w.reportFailure); w.blockStop();
      await assert.rejects(w.provider.cancel(w.attempt), error => error instanceof ProfileOnboardingDuoProviderError && error.kind === "unknown");
      await assert.rejects(w.provider.start({ ...w.attempt, attemptId: randomUUID() }, w.bind, w.reportFailure));
      assert.deepEqual(await w.provider.closeBrowser(w.owner), { state: "uncertain" });
    } finally { w.releaseStop(); await w.closeBrowser(); await w.cleanup(); }
  });

  it("binds real observed username independently of issuer account ID and keeps repeated start idempotent", async () => {
    const w = world();
    try {
      await w.provider.start(w.attempt, w.bind, w.reportFailure);
      await w.provider.start(w.attempt, w.bind, w.reportFailure);
      assert.equal(w.launches(), 1);
      assert.deepEqual(await w.send("bind", BIND), { ok: true, value: { accountId: w.attempt.accountId } });
      assert.equal(w.observed()?.accountName, BIND.username);
      assert.equal(w.observed()?.tabId, 7);
      assert.equal(w.observed()?.contextId, BIND.documentId);
      const requestId = randomUUID();
      assert.deepEqual(await w.send("persist", { credentialId: "public-id", privateKeyPkcs8: "synthetic", publicKeySpki: "synthetic",
        transport: "usb", isResidentCredential: false, createdAt: w.clock.now().toISOString() }), { ok: true, value: { revision: 1 } });
      await w.send("software-created", { credentialId: "public-id", requestId });
      await w.send("reserve", { credentialId: "public-id", requestId: randomUUID() });
      await w.send("portal-accepted", { credentialId: "public-id", requestId });
      assert.deepEqual(w.calls, ["persist", "fast-duo", "provision", "reserve", "portal-accepted"]);
      assert.deepEqual(await w.provider.cancel(w.attempt), { state: "closed" });
      assert.equal(existsSync(w.profile()), true);
      assert.deepEqual(await w.provider.closeBrowser(w.owner), { state: "closed" });
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


describe("draft document observations around native authority awaits", () => {
  for (const boundary of ["persist", "provision", "reserve", "fast-duo", "portal-accepted"] as const) it(`withholds ACK when document changes during ${boundary}`, async () => {
    const w = world();
    try {
      await w.provider.start(w.attempt, w.bind, w.reportFailure);
      await w.send("bind", BIND);
      const requestId = randomUUID();
      const pending = { credentialId: "public-id", privateKeyPkcs8: "synthetic", publicKeySpki: "synthetic",
        transport: "usb", isResidentCredential: false, createdAt: w.clock.now().toISOString() };
      if (boundary !== "persist") await w.send("persist", pending);
      if (["provision", "reserve", "portal-accepted"].includes(boundary)) await w.send("software-created", { credentialId: "public-id", requestId });
      w.driftOn(boundary);
      const result = boundary === "persist" ? await w.send("persist", pending)
        : boundary === "fast-duo" ? await w.send("software-created", { credentialId: "public-id", requestId })
        : boundary === "portal-accepted" ? await w.send("portal-accepted", { credentialId: "public-id", requestId })
        : await w.send("reserve", { credentialId: "public-id", requestId: randomUUID() });
      assert.deepEqual(result, { ok: false });
      await w.provider.cancel(w.attempt);
      assert.ok(w.calls.includes("unknown"));
      assert.equal(w.failures.length, 1);
      if (boundary === "provision") assert.equal(w.calls.includes("reserve"), false);
    } finally { await w.cleanup(); }
  });

  it("retains the issued capability when document changes during binding", async () => {
    const w = world();
    try {
      await w.provider.start(w.attempt, async input => { const capability = await w.bind(input); w.drift(); return capability; }, w.reportFailure);
      assert.deepEqual(await w.send("bind", BIND), { ok: false });
      await w.provider.cancel(w.attempt);
      assert.ok(w.calls.includes("unknown"));
      assert.equal(w.failures.length, 1);
    } finally { await w.cleanup(); }
  });
});
