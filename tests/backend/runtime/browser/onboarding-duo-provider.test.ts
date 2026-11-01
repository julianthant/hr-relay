import { onboardingProfileDirectory } from "../../../../src/backend/runtime/browser/native-profile-probe.js";
import { z } from "zod";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync, writeFileSync, realpathSync, unlinkSync, symlinkSync, linkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import type { BrowserContext, Worker } from "playwright";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { createProfileOnboardingDuoProvider, ProfileOnboardingDuoProviderError } from "../../../../src/backend/runtime/browser/onboarding-duo-provider.js";
import type { DraftDuoAttempt, DraftDuoBrowserOwner, DraftDuoCapability, DraftDuoObservedContext } from "../../../../src/backend/profiles/onboarding-duo.js";

function world(method: "key" | "touch" = "key") {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "relay-onboarding-provider-")));
  const browserRoot = join(directory, "browsers");
  const extensionDirectory = join(directory, "extension");
  mkdirSync(browserRoot, { mode: 0o700 }); mkdirSync(join(extensionDirectory, "src"), { recursive: true, mode: 0o700 });
  writeFileSync(join(extensionDirectory, "relay-manifest.json"), "{}");
  writeFileSync(join(extensionDirectory, "LICENSE"), "synthetic license fixture");
  writeFileSync(join(extensionDirectory, "THIRD_PARTY_NOTICES.md"), "synthetic notices fixture");
  mkdirSync(join(extensionDirectory, "src", "icons"), { mode: 0o700 });
  for (const name of ["options.html", "options.js", "popup.html", "popup.js", "relay-options.js", "styles.css", "icons/autopilot.svg", "icons/key-round.svg", "icons/plus.svg", "icons/shield-check.svg", "relay-background.js", "relay-content.js", "relay-inpage.js", "relay-native.js", "service.js", "crypto.js", "accounts.js", "duo-origin.js", "sign-count.js", "username.js"]) writeFileSync(join(extensionDirectory, "src", name), "");
  writeFileSync(join(extensionDirectory, "unlisted.txt"), "synthetic unlisted source");
  const clock = manualClock(new Date("2026-10-01T00:00:00.000Z"));
  const attempt: DraftDuoAttempt = { operationId: randomUUID(), profileId: randomUUID(), accountId: randomUUID(), generation: 1,
    attemptId: randomUUID(), method, expiresAt: "2026-10-01T00:10:00.000Z" };
  const requests: unknown[] = [];
  let waiter: ((value: unknown) => void) | undefined;
  let browserWaiter: ((value: unknown) => void) | undefined;
  let blockedStop = false, releaseStop: (() => void) | undefined, portalPages = 0;
  let lostActiveStopAck = false, blockedPump = false;
  let startupHold: Promise<void> | undefined, releaseStartup: (() => void) | undefined, startupEntered: (() => void) | undefined;
  const replies = new Map<string, (value: unknown) => void>();
  let closed = false, focusCount = 0, lostStopAck = false, missingCloseEvent = false;
  let launchCount = 0, nativeProbes = 0, nativeBusy = false, revokeDuringProbe = false, mutateOwnerDuringProbe = false;
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
      if (input.method === "install") { startupEntered?.(); await startupHold; return; }
      if (input.method === "browserInstall") return;
      if (input.method === "browserNext") return new Promise(resolve => { browserWaiter = resolve; });
      if (input.method === "browserStop") { if (lostStopAck) throw new Error("synthetic worker already closed"); browserWaiter?.(null); browserWaiter = undefined; return; }
      if (input.method === "assertContext") { if (!documentCurrent) throw new Error("synthetic document drift"); return; }
      if (input.method === "next") {
        if (requests.length) return requests.shift();
        return new Promise(resolve => { waiter = resolve; });
      }
      if (input.method === "reply") { replies.get(String(input.args[0]))?.(input.args[1]); return; }
      if (input.method === "stop") {
        if (blockedStop) await new Promise<void>(resolve => { releaseStop = resolve; });
        if (!blockedPump) { waiter?.(null); waiter = undefined; }
        if (lostActiveStopAck) throw new Error("synthetic active worker already closed");
        return;
      }
      throw new Error("unexpected operation");
    },
  } as unknown as Worker;
  function makePage() {
    let pageClosed = false;
    let url = "about:blank";
    return { bringToFront: async () => { focusCount++; }, url: () => url,
      goto: async (destination: string) => { if (!destination.startsWith("chrome-extension://")) { portalPages++; throw new Error("synthetic navigation failure"); } url = destination; },
      close: async () => { pageClosed = true; }, isClosed: () => closed || pageClosed };
  }
  let pages = [makePage()];
  const context = { serviceWorkers: () => [worker], pages: () => pages.filter(page => !page.isClosed()), on: (_event: string, callback: () => void) => { listeners.push(callback); },
    newPage: async () => { const page = makePage(); pages.push(page); return page; },
    close: async () => { closed = true; if (!missingCloseEvent) for (const listener of listeners) listener(); if (!blockedPump) { waiter?.(null); waiter = undefined; } browserWaiter?.(null); browserWaiter = undefined; } } as unknown as BrowserContext;
  const realProvider = createProfileOnboardingDuoProvider({ browserRoot, extensionDirectory, clock, closeProofMs: 50,
    launcher: { launch: async input => {
      if(input.nativeOnly===true){
        nativeProbes++;
        if(nativeBusy)throw new Error("Failed to create a ProcessSingleton for your profile directory.");
        if(revokeDuringProbe)current=false;
        if(mutateOwnerDuringProbe)Reflect.set(owner,"accountId",randomUUID());
        closed=false;pages=[makePage()];listeners.length=0;
        return context;
      }
      launchCount++; closed = false; pages = [makePage()]; listeners.length = 0; profile = input.profileDirectory;
      assert.equal(existsSync(join(input.extensionDirectory, "unlisted.txt")), false);
      assert.equal(readFileSync(join(input.extensionDirectory, "LICENSE"), "utf8"), "synthetic license fixture");
      assert.equal(readFileSync(join(input.extensionDirectory, "THIRD_PARTY_NOTICES.md"), "utf8"), "synthetic notices fixture");
      assert.equal(input.headless, false);
      const preferences = z.strictObject({ credentials_enable_service: z.boolean(), profile: z.strictObject({ password_manager_enabled: z.boolean() }) }).parse(JSON.parse(readFileSync(join(profile, "Default", "Preferences"), "utf8")));
      assert.equal(preferences.credentials_enable_service, false);
      assert.equal(preferences.profile.password_manager_enabled, false);
      return context;
    } },
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
      async signAssertion(request) { called("sign"); called("sign-return"); return { credentialId: request.credentialId,
        authenticatorData: "synthetic", clientDataJSON: "synthetic", signature: "synthetic", userHandle: null, transport: "usb", signCount: 5 }; },
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
  return { mutateOwnerDuringProbe:()=>{mutateOwnerDuringProbe=true;}, browserRoot, nativeProbes:()=>nativeProbes, refuseNative:()=>{nativeBusy=true;}, revokeDuringProbe:()=>{revokeDuringProbe=true;}, provider, rawProvider: realProvider, owner, attempt, bind, calls, send, clock, driftOn: (name: string) => { driftAfter = name; }, drift: () => { documentCurrent = false; }, extensionDirectory, reportFailure, failures, closeBrowser: () => context.close(), observed: () => observed, revoke: () => { current = false; },
    loseBrowserStopAck: () => { lostStopAck = true; }, withholdCloseEvent: () => { missingCloseEvent = true; }, closeSetup: () => pages[0].close(), pages: () => context.pages().length, focuses: () => focusCount, launches: () => launchCount, profile: () => profile,
    portalPages: () => portalPages, blockStop: () => { blockedStop = true; }, releaseStop: () => { releaseStop?.(); },
    loseActiveStopAck: () => { lostActiveStopAck = true; }, blockPump: () => { blockedPump = true; },
    releasePump: () => { blockedPump = false; waiter?.(null); waiter = undefined; },
    blockStartup: () => { startupHold = new Promise(resolve => { releaseStartup = resolve; }); return new Promise<void>(resolve => { startupEntered = resolve; }); },
    releaseStartup: () => { releaseStartup?.(); },
    async cleanup() {
      try { await provider.cancel(attempt); await provider.closeBrowser(owner); } catch (error) { assert.ok(error instanceof ProfileOnboardingDuoProviderError); }
      assert.ok(closed || launchCount === 0);
      rmSync(directory, { recursive: true, force: true });
    } };
}
const BIND = { documentId: "A0000000000040008000000000000007", tabId: 7, origin: "https://test.duosecurity.com", rpId: "duosecurity.com", username: "alex@example.edu" };

describe("draft Duo provider", () => {
  for(const pathKind of ["random","old-generation","changed-owner"] as const)it(`refuses an unbound ${pathKind} directory without effects`,async()=>{
    const w=world();
    const directory=pathKind==="random"?join(w.browserRoot,"onboarding-Abc123")
      :onboardingProfileDirectory(w.browserRoot,{...w.owner,...(pathKind==="old-generation"?{generation:w.owner.generation+1}:{accountId:randomUUID()})});
    mkdirSync(directory,{mode:0o700});const retained=join(directory,"retained.txt");writeFileSync(retained,"retained browser data");
    try{
      await assert.rejects(w.rawProvider.showBrowser(w.owner),error=>error instanceof ProfileOnboardingDuoProviderError&&error.kind==="unknown");
      assert.equal(readFileSync(retained,"utf8"),"retained browser data");assert.equal(w.launches(),0);assert.equal(w.nativeProbes(),0);assert.deepEqual(w.calls,[]);
    }finally{await w.cleanup();}
  });
  for(const failure of ["busy","unproved","owner-drift","owner-fields"] as const)it(`keeps the exact existing profile before ${failure} reuse refusal`,async()=>{
    const w=world(),directory=onboardingProfileDirectory(w.browserRoot,w.owner);
    mkdirSync(directory,{mode:0o700});const retained=join(directory,"retained.txt");writeFileSync(retained,"retained browser data");
    if(failure==="busy")w.refuseNative();
    if(failure==="unproved")w.withholdCloseEvent();
    if(failure==="owner-drift")w.revokeDuringProbe();
    if(failure==="owner-fields")w.mutateOwnerDuringProbe();
    try{
      await assert.rejects(w.rawProvider.showBrowser(w.owner));
      assert.equal(w.nativeProbes(),1);assert.equal(w.launches(),0);assert.equal(readFileSync(retained,"utf8"),"retained browser data");assert.deepEqual(w.calls,[]);
    }finally{await w.closeBrowser();await w.cleanup();}
  });
  it("reuses only the canonical owner path after native closure and keeps completed cleanup absent",async()=>{
    const w=world(),directory=onboardingProfileDirectory(w.browserRoot,w.owner);
    mkdirSync(directory,{mode:0o700});writeFileSync(join(directory,"retained.txt"),"old browser data");
    try{
      await w.rawProvider.showBrowser(w.owner);
      assert.equal(w.profile(),directory);assert.equal(w.nativeProbes(),1);assert.equal(w.launches(),1);assert.equal(existsSync(join(directory,"retained.txt")),false);
      assert.deepEqual(await w.rawProvider.closeBrowser(w.owner),{state:"closed"});assert.equal(existsSync(directory),false);
      await w.rawProvider.showBrowser(w.owner);assert.equal(w.nativeProbes(),1);assert.equal(w.launches(),2);
      assert.deepEqual(await w.rawProvider.closeBrowser(w.owner),{state:"closed"});assert.equal(existsSync(directory),false);
    }finally{await w.closeBrowser();await w.cleanup();}
  });
  for (const proof of ["proved", "missing-event"] as const) it(`lost active-stop ACK requires settled attempt and ${proof} physical closure`, async () => {
    const w = world();
    try {
      await w.provider.start(w.attempt, w.bind, w.reportFailure);
      await w.send("bind", BIND);
      await w.send("persist", { credentialId: "cHVibGljLWlk", privateKeyPkcs8: "synthetic", publicKeySpki: "synthetic",
        transport: "usb", isResidentCredential: false, createdAt: w.clock.now().toISOString() });
      await w.send("software-created", { credentialId: "cHVibGljLWlk", requestId: randomUUID() });
      w.loseActiveStopAck(); if (proof === "missing-event") w.withholdCloseEvent();
      assert.deepEqual(await w.provider.closeBrowser(w.owner), { state: proof === "proved" ? "closed" : "uncertain" });
      assert.ok(w.calls.includes("unknown")); assert.ok(!w.calls.includes("portal-accepted"));
      if (proof === "proved") { await w.provider.showBrowser(w.owner); assert.equal(w.launches(), 2); }
      else { await assert.rejects(w.provider.showBrowser(w.owner), error => {
        assert.ok(error instanceof ProfileOnboardingDuoProviderError);
        assert.ok(error.cause instanceof AggregateError);
        const stop: unknown = error.cause.errors[0];
        assert.ok(stop instanceof ProfileOnboardingDuoProviderError); assert.ok(stop.cause instanceof Error);
        assert.equal(stop.cause.message, "synthetic active worker already closed");
        assert.ok(error.cause.errors[1] instanceof ProfileOnboardingDuoProviderError);
        return true;
      }); assert.equal(w.launches(), 1); }
    } finally { await w.closeBrowser(); await w.cleanup(); }
  });
  it("hanging startup cannot prove active stop-only closure or permit replacement", async () => {
    const w = world();
    const entered = w.blockStartup();
    const starting = w.provider.start(w.attempt, w.bind, w.reportFailure);
    try {
      await entered; w.loseActiveStopAck();
      let settled = false;
      const closing = w.provider.closeBrowser(w.owner).then(result => { settled = true; return result; });
      await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(settled, false);
      assert.deepEqual(await closing, { state: "uncertain" });
      await assert.rejects(w.provider.showBrowser(w.owner)); assert.equal(w.launches(), 1);
    } finally { w.releaseStartup(); await starting; await w.closeBrowser(); await w.cleanup(); }
  });
  it("hanging pump cannot become eligible when it settles after the unchanged deadline", async () => {
    const w = world();
    try {
      await w.provider.start(w.attempt, w.bind, w.reportFailure);
      w.blockPump(); w.loseActiveStopAck();
      let settled = false;
      const closing = w.provider.closeBrowser(w.owner).then(result => { settled = true; return result; });
      await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(settled, false);
      assert.deepEqual(await closing, { state: "uncertain" });
      w.releasePump(); await new Promise<void>(resolve => setImmediate(resolve));
      await assert.rejects(w.provider.showBrowser(w.owner)); assert.equal(w.launches(), 1);
    } finally { w.releasePump(); await w.closeBrowser(); await w.cleanup(); }
  });
  it("a late dispatch retention failure cannot be superseded by physical closure", async () => {
    const w = world();
    let release!: () => void, entered!: () => void, unknowns = 0;
    const held = new Promise<void>(resolve => { release = resolve; });
    const dispatching = new Promise<void>(resolve => { entered = resolve; });
    try {
      await w.provider.start(w.attempt, async input => ({ ...await w.bind(input),
        async recordCeremony() { entered(); await held; throw new Error("synthetic late dispatch failure"); },
        async retainUnknown() { if (++unknowns > 1) throw new Error("synthetic late retention failure"); },
      }), w.reportFailure);
      await w.send("bind", BIND);
      await w.send("persist", { credentialId: "cHVibGljLWlk", privateKeyPkcs8: "synthetic", publicKeySpki: "synthetic",
        transport: "usb", isResidentCredential: false, createdAt: w.clock.now().toISOString() });
      const ceremony = w.send("software-created", { credentialId: "cHVibGljLWlk", requestId: randomUUID() });
      await dispatching; w.loseActiveStopAck();
      let settled = false;
      const closing = w.provider.closeBrowser(w.owner).then(result => { settled = true; return result; });
      await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(settled, false); release();
      assert.deepEqual(await ceremony, { ok: false });
      assert.deepEqual(await closing, { state: "uncertain" }); assert.equal(unknowns, 2);
      await assert.rejects(w.provider.showBrowser(w.owner)); assert.equal(w.launches(), 1);
    } finally { release(); await w.closeBrowser(); await w.cleanup(); }
  });
  it("a changed attempt or browser owner cannot replace a closing retained attempt", async () => {
    const w = world();
    try {
      await w.provider.start(w.attempt, w.bind, w.reportFailure); w.blockStop();
      const closing = w.provider.closeBrowser(w.owner);
      await assert.rejects(w.rawProvider.start({ ...w.attempt, attemptId: randomUUID() }, w.bind, w.reportFailure));
      await assert.rejects(w.provider.cancel({ ...w.attempt, attemptId: randomUUID() }));
      await assert.rejects(w.provider.showBrowser({ ...w.owner, generation: w.owner.generation + 1 }));
      w.releaseStop(); assert.deepEqual(await closing, { state: "closed" }); assert.equal(w.launches(), 1);
    } finally { w.releaseStop(); await w.closeBrowser(); await w.cleanup(); }
  });
  for (const proof of ["proved", "unproved"] as const) it(`lost worker-stop ACK requires ${proof} context closure before a new browser`, async () => {
    const w = world();
    try {
      await w.provider.showBrowser(w.owner); w.loseBrowserStopAck();
      if (proof === "unproved") w.withholdCloseEvent();
      assert.deepEqual(await w.provider.closeBrowser(w.owner), { state: proof === "proved" ? "closed" : "uncertain" });
      if (proof === "proved") { await w.provider.showBrowser(w.owner); assert.equal(w.launches(), 2); }
      else { await assert.rejects(w.provider.showBrowser(w.owner)); assert.equal(w.launches(), 1); }
    } finally { await w.closeBrowser(); await w.cleanup(); }
  });

  it("reopens only the setup tab in its live context once for concurrent Show commands", async () => {
    const w = world();
    try {
      await w.provider.showBrowser(w.owner);
      await w.closeSetup();
      await Promise.all([w.provider.showBrowser(w.owner), w.provider.showBrowser(w.owner)]);
      assert.equal(w.launches(), 1); assert.equal(w.pages(), 1); assert.equal(w.portalPages(), 0);
      assert.deepEqual(w.calls, []);
    } finally { await w.cleanup(); }
  });

  it("focuses an existing setup and waits for proved closed-browser settlement before reopening", async () => {
    const w = world();
    try {
      await w.provider.showBrowser(w.owner);
      await w.provider.showBrowser(w.owner);
      assert.equal(w.focuses(), 1); assert.equal(w.launches(), 1);
      await w.closeBrowser();
      await w.provider.showBrowser(w.owner);
      assert.equal(w.launches(), 2);
      assert.equal(w.portalPages(), 0);
      assert.deepEqual(w.calls, []);
    } finally { await w.cleanup(); }
  });

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
      await assert.rejects(w.provider.showBrowser(w.owner), error => error instanceof ProfileOnboardingDuoProviderError && error.kind === "unknown");
      assert.equal(w.launches(), 1);
    } finally { w.releaseStop(); await w.closeBrowser(); await w.cleanup(); }
  });

  it("retains broker and unknown-retention failures while fencing attempt and browser custody", async () => {
    const w = world();
    const original = new Error("synthetic broker failure"), retention = new Error("synthetic unknown-retention failure");
    try {
      await w.provider.start(w.attempt, async input => ({ ...await w.bind(input),
        async persistPending() { throw original; },
        async retainUnknown() { throw retention; },
      }), w.reportFailure);
      assert.deepEqual(await w.send("bind", BIND), { ok: true, value: { accountId: w.attempt.accountId } });
      assert.deepEqual(await w.send("persist", { credentialId: "cHVibGljLWlk", privateKeyPkcs8: "synthetic", publicKeySpki: "synthetic",
        transport: "usb", isResidentCredential: false, createdAt: w.clock.now().toISOString() }), { ok: false });
      await assert.rejects(w.provider.cancel(w.attempt), error => {
        assert.ok(error instanceof ProfileOnboardingDuoProviderError);
        assert.equal(error.kind, "unknown");
        let cause: unknown = error;
        while (cause instanceof Error && !(cause instanceof AggregateError)) cause = cause.cause;
        assert.ok(cause instanceof AggregateError);
        assert.equal(cause.errors.length, 2);
        assert.equal(cause.errors[0], original);
        assert.equal(cause.errors[1], retention);
        return true;
      });
      assert.deepEqual(w.failures, []);
      await assert.rejects(w.provider.start({ ...w.attempt, attemptId: randomUUID() }, w.bind, w.reportFailure),
        error => error instanceof ProfileOnboardingDuoProviderError && error.reason === "busy");
      assert.deepEqual(await w.provider.closeBrowser(w.owner), { state: "uncertain" });
      await assert.rejects(w.provider.showBrowser(w.owner), error => error instanceof ProfileOnboardingDuoProviderError && error.kind === "unknown");
      assert.equal(w.launches(), 1);
      assert.ok(existsSync(w.profile()));
    } finally { await w.closeBrowser(); await w.cleanup(); }
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
      assert.deepEqual(await w.send("persist", { credentialId: "cHVibGljLWlk", privateKeyPkcs8: "synthetic", publicKeySpki: "synthetic",
        transport: "usb", isResidentCredential: false, createdAt: w.clock.now().toISOString() }), { ok: true, value: { revision: 1 } });
      await w.send("software-created", { credentialId: "cHVibGljLWlk", requestId });
      await w.send("sign", { credentialId: "cHVibGljLWlk", requestId: randomUUID(), origin: BIND.origin, rpId: "duosecurity.com", challenge: "AQID" });
      await w.send("portal-accepted", { credentialId: "cHVibGljLWlk", requestId });
      assert.deepEqual(w.calls, ["persist", "fast-duo", "sign", "sign-return", "portal-accepted"]);
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
      assert.deepEqual(await w.send("persist", { credentialId: "cHVibGljLWlk", privateKeyPkcs8: "synthetic", publicKeySpki: "synthetic",
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
      await w.send("persist", { credentialId: "cHVibGljLWlk", privateKeyPkcs8: "synthetic", publicKeySpki: "synthetic",
        transport: "usb", isResidentCredential: false, createdAt: w.clock.now().toISOString() });
      await w.send("software-created", { credentialId: "cHVibGljLWlk", requestId: randomUUID() });
      await w.closeBrowser();
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.deepEqual(w.failures, []);
      assert.ok(w.calls.includes("unknown"));
      assert.ok(!w.calls.includes("portal-accepted"));
      assert.ok(existsSync(w.profile()), "context closure retains the profile until owner cleanup");
      assert.deepEqual(await w.provider.closeBrowser(w.owner), { state: "closed" });
      assert.equal(existsSync(w.profile()), false);
      const retained = [...w.calls];
      await w.provider.showBrowser(w.owner);
      assert.equal(w.launches(), 2); assert.equal(w.portalPages(), 0);
      assert.deepEqual(w.calls, retained);
    } finally { await w.cleanup(); }
  });

});


describe("draft document observations around native authority awaits", () => {
  for (const boundary of ["persist", "sign", "sign-return", "fast-duo", "portal-accepted"] as const) it(`withholds ACK when document changes during ${boundary}`, async () => {
    const w = world();
    try {
      await w.provider.start(w.attempt, w.bind, w.reportFailure);
      await w.send("bind", BIND);
      const requestId = randomUUID();
      const pending = { credentialId: "cHVibGljLWlk", privateKeyPkcs8: "synthetic", publicKeySpki: "synthetic",
        transport: "usb", isResidentCredential: false, createdAt: w.clock.now().toISOString() };
      if (boundary !== "persist") await w.send("persist", pending);
      if (["sign", "sign-return", "portal-accepted"].includes(boundary)) await w.send("software-created", { credentialId: "cHVibGljLWlk", requestId });
      w.driftOn(boundary);
      const result = boundary === "persist" ? await w.send("persist", pending)
        : boundary === "fast-duo" ? await w.send("software-created", { credentialId: "cHVibGljLWlk", requestId })
        : boundary === "portal-accepted" ? await w.send("portal-accepted", { credentialId: "cHVibGljLWlk", requestId })
        : await w.send("sign", { credentialId: "cHVibGljLWlk", requestId: randomUUID(), origin: BIND.origin, rpId: "duosecurity.com", challenge: "AQID" });
      assert.deepEqual(result, { ok: false });
      await w.provider.cancel(w.attempt);
      assert.ok(w.calls.includes("unknown"));
      assert.equal(w.failures.length, 1);
      if (boundary === "sign" || boundary === "sign-return") assert.ok(w.calls.includes("sign"));
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
