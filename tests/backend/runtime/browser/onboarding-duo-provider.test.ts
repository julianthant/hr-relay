import { mockBrowserRootPort } from "../../../support/helpers/browser/browser-roots.js";
import { onboardingProfileDirectory } from "../../../../src/backend/storage/browser-roots.js";
import { z } from "zod";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync, writeFileSync, realpathSync, unlinkSync, symlinkSync, linkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import type { BrowserContext, Page, Worker } from "playwright";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { createProfileOnboardingDuoProvider, ProfileOnboardingDuoProviderError } from "../../../../src/backend/runtime/browser/onboarding-duo-provider.js";
import type { DraftDuoAttempt, DraftDuoBrowserOwner, DraftDuoCapability, DraftDuoObservedContext, ProfileOnboardingDuoProvider } from "../../../../src/backend/profiles/onboarding-duo.js";
import { ProfileOnboardingStateSchema } from "../../../../src/models/profiles/public-profile.js";

function world(method: "key" | "touch" = "key", platform: NodeJS.Platform = "darwin") {
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
  const browserRequests: unknown[] = [];
  const events: import("../../../../src/models/profiles/profile.js").ProfileOnboardingDuoEvent[] = [];
  let waiter: ((value: unknown) => void) | undefined;
  let browserWaiter: ((value: unknown) => void) | undefined;
  const rejectPolls = new Map<string, (error: Error) => void>();
  let blockedStop = false, releaseStop: (() => void) | undefined, portalPages = 0;
  let lostActiveStopAck = false, blockedPump = false;
  let startupHold: Promise<void> | undefined, releaseStartup: (() => void) | undefined, startupEntered: (() => void) | undefined;
  const replies = new Map<string, (value: unknown) => void>();
  let windowFocusCount = 0, osFocusCount = 0, capturedRelay = 0, returnedRelay = 0, failInstall = false;
  let captureFailure: Error | undefined, focusFailure: Error | undefined, returnFailure: Error | undefined, selectionFailure: Error | undefined;
  let browserSetupFailure: Error | undefined, browserSetupDurationMs = 0;
  let portalFailure = new Error("synthetic navigation failure");
  let portalLanding: string | undefined;
  let portalSubmitFailure: Error | undefined;
  let typedCount = 0;
  let portalUrl = "";
  let setPortalUrl: (next: string) => void = () => undefined;
  let nativeProbeHold: Promise<void> | undefined, releaseNativeProbe: (() => void) | undefined, nativeProbeEntered: (() => void) | undefined;
  let installFailure: Error | undefined, installDurationMs = 0;
  let closed = false, closing = false, focusCount = 0, lostStopAck = false, missingCloseEvent = false;
  let launchCount = 0, nativeProbes = 0, nativeBusy = false, revokeDuringProbe = false, mutateOwnerDuringProbe = false;
  let profile = "";
  const listeners: (() => void)[] = [];
  const calls: string[] = [];
  const workerCalls: string[] = [];
  const selectedPages: string[] = [];
  let documentCurrent = true;
  let driftAfter: string | undefined;
  function called(name: string): void { calls.push(name); if (name === driftAfter) documentCurrent = false; }
  const failures: Error[] = [];
  const workerCloseListeners: (() => void)[] = [];
  const reportFailure = async (error: Error): Promise<void> => { failures.push(error); };
  let current = true;
  let sameOriginChildFrame = false;
  let observed: DraftDuoObservedContext | undefined;
  const worker = {
    on(_event: "close", callback: () => void) { workerCloseListeners.push(callback); },
    url: () => "chrome-extension://owned-extension/src/relay-background.js",
    async evaluate(_callback: unknown, input: { method: string; args: unknown[] }) {
      workerCalls.push(input.method);
      if (input.method === "install") { clock.advanceMonotonic(installDurationMs); if (installFailure) throw installFailure; startupEntered?.(); await startupHold; if (failInstall) throw new Error("synthetic arm initialization failed"); return; }
      if (input.method === "browserInstall") { clock.advanceMonotonic(browserSetupDurationMs); if (browserSetupFailure) throw browserSetupFailure; const url = `about:blank#relay-target=${String(input.args[0])}`; const page = makePage(url); pages.push(page); for (const resolve of pageWaiters.splice(0)) resolve(page as unknown as Page); return { tabId: pages.length, windowId: 1, url }; }
      if (input.method === "browserPage") { const page = makePage(String(input.args[0])); pages.push(page); for (const resolve of pageWaiters.splice(0)) resolve(page as unknown as Page); return { tabId: pages.length, windowId: 1, url: String(input.args[0]) }; }
      if (input.method === "browserSelect") { if (selectionFailure) throw selectionFailure; const page = pages[Number(input.args[0]) - 1]; assert.ok(page); assert.equal(input.args[1], 1); selectedPages.push(page.url()); focusCount++; return; }
      if (input.method === "browserFocus") { windowFocusCount++; return; }
      if (input.method === "browserNext") {
        if (browserRequests.length) return browserRequests.shift();
        return new Promise((resolve, reject) => { browserWaiter = resolve; rejectPolls.set(input.method, reject); });
      }
      if (input.method === "browserStop") { if (lostStopAck) throw new Error("synthetic worker already closed"); browserWaiter?.(null); browserWaiter = undefined; return; }
      if (input.method === "assertContext") { if (!documentCurrent) throw new Error("synthetic document drift"); return; }
      if (input.method === "next") {
        if (requests.length) return requests.shift();
        return new Promise((resolve, reject) => { waiter = resolve; rejectPolls.set(input.method, reject); });
      }
      if (input.method === "reply" || input.method === "browserReply") { replies.get(String(input.args[0]))?.(input.args[1]); return; }
      if (input.method === "stop") {
        if (blockedStop) await new Promise<void>(resolve => { releaseStop = resolve; });
        if (!blockedPump) { waiter?.(null); waiter = undefined; }
        if (lostActiveStopAck) throw new Error("synthetic active worker already closed");
        return;
      }
      throw new Error("unexpected operation");
    },
  } as unknown as Worker;
  function makePage(initialUrl = "about:blank") {
    let pageClosed = false;
    let url = initialUrl;
    const frame = { url: () => url, evaluate: async () => true };
    return { frames: () => sameOriginChildFrame ? [frame, { ...frame }] : [frame], evaluate: async () => true, bringToFront: async () => { focusCount++; }, url: () => url,
      goto: async (destination: string) => { if (!destination.startsWith("chrome-extension://") && !destination.startsWith("about:blank")) { portalPages++; if (portalLanding === undefined) throw portalFailure; url = portalLanding; portalUrl = url; setPortalUrl = (next: string) => { url = next; portalUrl = next; }; } else url = destination; },
      waitForURL: async (matches: string | ((candidate: URL) => boolean)) => { assert.ok(typeof matches === "string" ? url === matches : matches(new URL(url))); },
      waitForLoadState: async () => undefined, on: () => undefined,
      waitForFunction: async () => ({ dispose: async () => undefined }),
      locator: () => ({ count: async () => 1, elementHandle: async () => ({
        isVisible: async () => true, isEditable: async () => true, isEnabled: async () => true,
        evaluate: async () => true, fill: async () => { typedCount++; }, dispose: async () => undefined,
        click: async () => { typedCount++; if (portalSubmitFailure) throw portalSubmitFailure; throw new Error("unexpected synthetic submit"); },
      }) }),
      close: async () => { pageClosed = true; }, isClosed: () => closed || pageClosed };
  }
  let pages = [makePage()];
  const pageWaiters: ((page: Page) => void)[] = [];
  const context = { waitForEvent: () => new Promise<Page>(resolve => pageWaiters.push(resolve)), serviceWorkers: () => [worker], pages: () => pages.filter(page => !page.isClosed()), isClosed: () => closing || closed, on: (_event: string, callback: () => void) => { listeners.push(callback); },
    newCDPSession: async () => ({ async send(name: string, input?: { credentialId: string }) {
      if (["WebAuthn.enable", "WebAuthn.setResponseOverrideBits", "WebAuthn.setUserVerified", "WebAuthn.setAutomaticPresenceSimulation"].includes(name)) return {};
      if (name === "WebAuthn.addVirtualAuthenticator") return { authenticatorId: "synthetic-platform" };
      if (name === "WebAuthn.getCredential") return { credential: { credentialId: input?.credentialId, rpId: "duosecurity.com",
        privateKey: generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
        isResidentCredential: true, signCount: 1 } };
      throw new Error("unexpected platform operation");
    } }),
    newPage: async () => { const page = makePage(); pages.push(page); return page; },
    close: async () => { closed = true; if (!missingCloseEvent) for (const listener of listeners) listener(); if (!blockedPump) { waiter?.(null); waiter = undefined; } browserWaiter?.(null); browserWaiter = undefined; } } as unknown as BrowserContext;
  const relayTarget = platform === "win32" ? { platform: "win32" as const, processId: 72, windowHandle: "8192" }
    : { platform: "darwin" as const, processId: 72 };
  const browserRoots = mockBrowserRootPort().browserRoots;
  const realProvider = createProfileOnboardingDuoProvider({ browserRoots, browserRoot, extensionDirectory, clock, closeProofMs: 50, platform,
    focus: { async captureRelay() { capturedRelay++; if (captureFailure) throw captureFailure; return relayTarget; }, async show(owned) { assert.equal(owned, context); osFocusCount++; if (focusFailure) throw focusFailure; },
      async returnToRelay(target) { assert.equal(target, relayTarget); returnedRelay++; if (returnFailure) throw returnFailure; } },
    launcher: { launch: async input => {
      assert.equal(Object.hasOwn(input, "nativePlatform"), false);
      if(input.nativeOnly===true){
        nativeProbes++;
        nativeProbeEntered?.(); await nativeProbeHold;
        if(nativeBusy)throw new Error("Failed to create a ProcessSingleton for your profile directory.");
        if(revokeDuringProbe)current=false;
        if(mutateOwnerDuringProbe)Reflect.set(owner,"accountId",randomUUID());
        closed=false;closing=false;pages=[makePage()];listeners.length=0;
        return context;
      }
      input.ownedProcess?.({ exited: () => closed, onExit: callback => listeners.push(callback), stop: async () => { await context.close(); } });
      launchCount++; closed = false; closing = false; pages = [makePage(), ...(method === "touch" ? [makePage("https://test.duosecurity.com")] : [])]; listeners.length = 0; profile = input.profileDirectory;
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
    reportEvent(event) { events.push(event); },
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
  return { seedRoot(other = owner) { return browserRoots.beginSignupLaunch({ profileId: other.profileId, profileRoot: browserRoot, credentialFingerprint: null,
      owner: { kind: "signup", operationId: other.operationId, accountId: other.accountId, providerGeneration: other.generation } }).input.profileDirectory; }, sameOriginChildFrame: () => { sameOriginChildFrame = true; }, addDuoPage: () => { pages.push(makePage("https://test.duosecurity.com")); }, mutateOwnerDuringProbe:()=>{mutateOwnerDuringProbe=true;}, browserRoot, nativeProbes:()=>nativeProbes, refuseNative:()=>{nativeBusy=true;}, revokeDuringProbe:()=>{revokeDuringProbe=true;}, provider, rawProvider: realProvider, owner, attempt, bind, calls, workerCalls, send, clock, driftOn: (name: string) => { driftAfter = name; }, drift: () => { documentCurrent = false; }, extensionDirectory, reportFailure, failures, closeBrowser: () => context.close(), observed: () => observed, revoke: () => { current = false; },
    events, selectedPages,
    sendBrowser(kind: string) {
      const id = randomUUID(), request = { id, kind };
      const response = new Promise(resolve => replies.set(id, resolve));
      if (browserWaiter) { const resolve = browserWaiter; browserWaiter = undefined; resolve(request); }
      else browserRequests.push(request);
      return response;
    },
    refuseInstall(error: Error, durationMs: number) { installFailure = error; installDurationMs = durationMs; },
    refuseBrowserSetup(error: Error, durationMs: number) { browserSetupFailure = error; browserSetupDurationMs = durationMs; },
    refusePortal(error: Error) { portalFailure = error; },
    refuseSubmit(error: Error) { portalSubmitFailure = error; },
    landPortal(url: string) { portalLanding = url; },
    reachDuo(next: string) { setPortalUrl(next); },
    typed: () => typedCount,
    portalUrl: () => portalUrl,
    blockNativeProbe() { nativeProbeHold = new Promise(resolve => { releaseNativeProbe = resolve; }); return new Promise<void>(resolve => { nativeProbeEntered = resolve; }); },
    releaseNativeProbe() { releaseNativeProbe?.(); },
    refuseCapture(error: Error) { captureFailure = error; },
    refuseFocus(error: Error) { focusFailure = error; },
    refuseSelection(error: Error) { selectionFailure = error; },
    refuseReturn(error: Error) { returnFailure = error; },
    beginContextClose() { closing = true; },
    closeWorker() { for (const listener of workerCloseListeners) listener(); },
    rejectPoll(method: "next" | "browserNext", error: Error) { const reject = rejectPolls.get(method); assert.ok(reject); reject(error); },
    loseBrowserStopAck: () => { lostStopAck = true; }, withholdCloseEvent: () => { missingCloseEvent = true; }, closeSetup: () => pages[0].close(), pages: () => context.pages().length, focuses: () => focusCount, windowFocuses: () => windowFocusCount, osFocuses: () => osFocusCount, relayCaptures: () => capturedRelay, relayReturns: () => returnedRelay, failInstall: () => { failInstall = true; }, launches: () => launchCount, profile: () => profile,
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
const BIND = { documentId: "A0000000000040008000000000000007", tabId: 7, origin: "https://test.duosecurity.com", rpId: "duosecurity.com" };
class TargetClosedError extends Error {}

function assertUncertainBrowserClosure(closure: Awaited<ReturnType<ProfileOnboardingDuoProvider["closeBrowser"]>>) {
  assert.equal(closure.state, "uncertain");
  if (closure.state !== "uncertain") throw new Error("uncertain browser closure required");
  assert.ok(closure.cause instanceof Error);
  assert.deepEqual(Object.keys(closure).toSorted(), ["cause", "state"]);
  return closure.cause;
}

describe("draft Duo provider", () => {
  it("classifies a failed Relay target observation before browser launch or profile creation", async () => {
    const w = world(), failure = new Error("synthetic app observation refused"); w.refuseCapture(failure);
    try {
      await assert.rejects(w.provider.showBrowser(w.owner), error => error instanceof ProfileOnboardingDuoProviderError
        && error.kind === "unavailable" && error.reason === "provider" && error.cause === failure);
      assert.equal(w.launches(), 0); assert.equal(existsSync(onboardingProfileDirectory(w.browserRoot, 1)), false);
    } finally { await w.cleanup(); }
  });
  for (const method of ["next", "browserNext"] as const) it(`retains browser lifetime and the original cause when ${method} terminates before context closure`, async () => {
    const w = world(), original = new Error("synthetic broker transport closed");
    let reported!: (error: Error) => void;
    const failure = new Promise<Error>(resolve => { reported = resolve; });
    try {
      await w.provider.start(w.attempt, w.bind, async error => { await w.reportFailure(error); reported(error); });
      w.rejectPoll(method, original);
      const retained = await failure;
      assert.ok(retained instanceof ProfileOnboardingDuoProviderError);
      assert.equal(retained.kind, "unknown"); assert.equal(retained.reason, "browser-lifetime");
      assert.equal(retained.cause, original); assert.equal(w.failures.length, 1);
      assert.deepEqual(w.calls, []);
    } finally { await w.cleanup(); }
  });
  for (const poll of ["idle", "next", "browserNext"] as const) for (const kind of ["operation", "worker-closed"] as const) it(`retains a genuine ${poll} ${kind} failure rejected before closing but caught after closing begins`, async () => {
    const w = world(), original = kind === "operation" ? new Error("synthetic genuine pre-close worker failure") : new TargetClosedError("synthetic worker closed before its context");
    try {
      if (poll === "idle") await w.provider.showBrowser(w.owner);
      else await w.provider.start(w.attempt, w.bind, w.reportFailure);
      if (kind === "worker-closed") w.closeWorker();
      w.rejectPoll(poll === "idle" ? "browserNext" : poll, original);
      w.beginContextClose();
      await new Promise<void>(resolve => setImmediate(resolve));
      if (poll === "idle") {
        await w.closeBrowser();
        await assert.rejects(w.provider.showBrowser(w.owner), error => error instanceof ProfileOnboardingDuoProviderError
          && error.reason === "worker" && error.cause instanceof ProfileOnboardingDuoProviderError && error.cause.cause === original);
        assert.equal(w.launches(), 1);
      } else {
        assert.equal(w.failures.length, 1);
        const retained = w.failures[0]; assert.ok(retained instanceof ProfileOnboardingDuoProviderError);
        assert.equal(retained.reason, "browser-lifetime"); assert.equal(retained.cause, original);
      }
      assert.deepEqual(w.calls, []);
    } finally { await w.closeBrowser(); await w.cleanup(); }
  });
  for (const poll of ["next", "browserNext"] as const) it(`retains ${poll} rejection and a prior callback failure when the close event overtakes its catch`, async () => {
    const w = world(), original = new Error("synthetic pre-close rejection"), callback = new Error("synthetic closure callback failure");
    try {
      await w.provider.start(w.attempt, w.bind, async error => { await w.reportFailure(error); throw callback; });
      w.rejectPoll(poll, original);
      await w.closeBrowser();
      await new Promise<void>(resolve => setImmediate(resolve));
      await assert.rejects(w.provider.cancel(w.attempt), error => {
        const pending: unknown[] = [error], seen = new Set<unknown>();
        while (pending.length) {
          const value = pending.pop(); if (seen.has(value)) continue; seen.add(value);
          if (value instanceof AggregateError) { const nested: readonly unknown[] = value.errors; pending.push(...nested); }
          if (value instanceof Error) pending.push(value.cause);
        }
        assert.ok(seen.has(original)); assert.ok(seen.has(callback)); return true;
      });
      assertUncertainBrowserClosure(await w.provider.closeBrowser(w.owner));
      await assert.rejects(w.provider.showBrowser(w.owner)); assert.equal(w.launches(), 1);
    } finally { await w.closeBrowser(); await w.cleanup(); }
  });
  for (const poll of ["idle", "next", "browserNext"] as const) for (const proof of ["proved", "missing-event"] as const) {
    it(`settles ${poll} rejection during requested closure only after ${proof} physical closure`, async () => {
      const w = world();
      try {
        if (poll === "idle") await w.provider.showBrowser(w.owner);
        else await w.provider.start(w.attempt, w.bind, w.reportFailure);
        w.beginContextClose();
        w.rejectPoll(poll === "idle" ? "browserNext" : poll, new TargetClosedError("synthetic closing poll"));
        await new Promise<void>(resolve => setImmediate(resolve));
        assert.equal(w.failures.length, 0, "a pending close is not a separate worker failure");
        if (proof === "missing-event") w.withholdCloseEvent();
        await w.closeBrowser();
        const closure = await w.provider.closeBrowser(w.owner);
        if (proof === "proved") assert.deepEqual(closure, { state: "closed" }); else assertUncertainBrowserClosure(closure);
        if (poll !== "idle" && proof === "proved") {
          assert.equal(w.failures.length, 1);
          assert.ok(w.failures[0] instanceof ProfileOnboardingDuoProviderError);
          assert.equal(w.failures[0].kind, "unavailable");
        } else assert.deepEqual(w.failures, []);
        if (proof === "proved") { await w.provider.showBrowser(w.owner); assert.equal(w.launches(), 2); }
        else { await assert.rejects(w.provider.showBrowser(w.owner)); assert.equal(w.launches(), 1); }
        assert.deepEqual(w.calls, []);
      } finally { await w.closeBrowser(); await w.cleanup(); }
    });
  }
  for (const method of ["next", "browserNext"] as const) for (const proof of ["proved", "missing-event"] as const) {
    it(`retains a captured key after ${method} rejects before ${proof} physical closure`, async () => {
      const w = world();
      let acknowledge!: () => void;
      const retained = new Promise<void>(resolve => { acknowledge = resolve; });
      try {
        await w.provider.start(w.attempt, async input => ({ ...await w.bind(input),
          async retainUnknown() { w.calls.push("unknown"); acknowledge(); },
        }), w.reportFailure);
        await w.send("bind", BIND);
        await w.send("persist", { credentialId: "cHVibGljLWlk", privateKeyPkcs8: "synthetic", publicKeySpki: "synthetic",
          transport: "usb", isResidentCredential: false, createdAt: w.clock.now().toISOString() });
        await w.send("software-created", { credentialId: "cHVibGljLWlk", requestId: randomUUID() });
        await new Promise<void>(resolve => setImmediate(resolve));
        w.rejectPoll(method, new Error("synthetic target closed before context event"));
        await retained;
        if (proof === "missing-event") w.withholdCloseEvent();
        await w.closeBrowser();
        const closure = await w.provider.closeBrowser(w.owner);
        if (proof === "proved") assert.deepEqual(closure, { state: "closed" }); else assertUncertainBrowserClosure(closure);
        assert.deepEqual(w.failures, []);
        assert.ok(w.calls.includes("unknown")); assert.ok(!w.calls.includes("portal-accepted"));
        if (proof === "proved") { await w.provider.showBrowser(w.owner); assert.equal(w.launches(), 2); }
        else { await assert.rejects(w.provider.showBrowser(w.owner)); assert.equal(w.launches(), 1); }
      } finally { await w.cleanup(); }
    });
  }
  for(const pathKind of ["random","old-generation","changed-owner"] as const)it(`refuses an unbound ${pathKind} directory without effects`,async()=>{
    const w=world();
    const directory=pathKind==="random"?join(w.browserRoot,"onboarding-Abc123")
      :w.seedRoot({...w.owner,...(pathKind==="old-generation"?{generation:w.owner.generation+1}:{accountId:randomUUID()})});
    mkdirSync(directory,{mode:0o700});const retained=join(directory,"retained.txt");writeFileSync(retained,"retained browser data");
    try{
      await assert.rejects(w.rawProvider.showBrowser(w.owner),error=>error instanceof ProfileOnboardingDuoProviderError&&error.kind==="unknown");
      assert.equal(readFileSync(retained,"utf8"),"retained browser data");assert.equal(w.launches(),0);assert.equal(w.nativeProbes(),0);assert.deepEqual(w.calls,[]);
    }finally{await w.cleanup();}
  });
  for(const failure of ["busy","unproved","owner-drift","owner-fields"] as const)it(`keeps the exact existing profile before ${failure} reuse refusal`,async()=>{
    const w=world(),directory=w.seedRoot();
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
  it("replaces a registered root only after native closure and keeps retired handles absent",async()=>{
    const w=world(),directory=w.seedRoot();
    mkdirSync(directory,{mode:0o700});writeFileSync(join(directory,"retained.txt"),"old browser data");
    try{
      await w.rawProvider.showBrowser(w.owner);
      assert.notEqual(w.profile(),directory);assert.equal(existsSync(directory),false);assert.equal(w.nativeProbes(),1);assert.equal(w.launches(),1);assert.equal(existsSync(join(directory,"retained.txt")),false);
      assert.deepEqual(await w.rawProvider.closeBrowser(w.owner),{state:"closed"});assert.equal(existsSync(directory),false);assert.equal(w.nativeProbes(),2);
      await w.rawProvider.showBrowser(w.owner);assert.equal(w.nativeProbes(),2);assert.equal(w.launches(),2);
      assert.deepEqual(await w.rawProvider.closeBrowser(w.owner),{state:"closed"});assert.equal(existsSync(directory),false);assert.equal(w.nativeProbes(),3);
      assert.deepEqual(w.workerCalls,["browserInstall","browserNext","browserSelect","browserFocus","browserStop","browserInstall","browserNext","browserSelect","browserFocus","browserStop"]);
      assert.deepEqual(w.calls,[]);
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
      const closure = await w.provider.closeBrowser(w.owner);
        if (proof === "proved") assert.deepEqual(closure, { state: "closed" }); else assertUncertainBrowserClosure(closure);
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
      assertUncertainBrowserClosure(await closing);
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
      assertUncertainBrowserClosure(await closing);
      w.releasePump(); await new Promise<void>(resolve => setImmediate(resolve));
      await assert.rejects(w.provider.showBrowser(w.owner)); assert.equal(w.launches(), 1);
    } finally { w.releasePump(); await w.closeBrowser(); await w.cleanup(); }
  });
  it("reports the close stage and preserves the profile when a native probe settles after the deadline", async () => {
    const w = world();
    try {
      await w.provider.showBrowser(w.owner);
      const entered = w.blockNativeProbe();
      const closing = w.provider.closeBrowser(w.owner);
      await entered;
      assertUncertainBrowserClosure(await closing);
      assert.ok(w.events.some(event => event.operation === "close-native-proof" && event.detail === "browser-lifetime"));
      assert.ok(existsSync(w.profile()));
      w.releaseNativeProbe();
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.ok(existsSync(w.profile()), "a late proof must not delete the profile after uncertain custody was retained");
      await assert.rejects(w.provider.showBrowser(w.owner));
      assert.equal(w.launches(), 1);
    } finally { w.releaseNativeProbe(); await w.closeBrowser(); await w.cleanup(); }
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
      assertUncertainBrowserClosure(await closing); assert.equal(unknowns, 2);
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
      const closure = await w.provider.closeBrowser(w.owner);
        if (proof === "proved") assert.deepEqual(closure, { state: "closed" }); else assertUncertainBrowserClosure(closure);
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

  it("focuses both the setup page and its OS window on the first opening", async () => {
    const w = world();
    try {
      await w.provider.showBrowser(w.owner);
      assert.equal(w.focuses(), 1); assert.equal(w.windowFocuses(), 1);
      assert.equal(w.osFocuses(), 1); assert.equal(w.relayCaptures(), 1);
      assert.equal(w.launches(), 1); assert.deepEqual(w.calls, []);
    } finally { await w.cleanup(); }
  });

  it("keeps macOS setup, enrollment and portal attempts available after a foreground refusal", async () => {
    const w = world();
    w.refuseFocus(new Error("synthetic foreground refusal"));
    try {
      await w.provider.showBrowser(w.owner);
      await w.provider.start(w.attempt, w.bind, w.reportFailure);
      assert.ok(w.workerCalls.includes("install"));
      assert.equal(w.failures.length, 0);
      assert.ok(w.events.some(event => event.code === "ONBOARDING_DUO_FOCUS_FAILED" && event.operation === "browser-focus"));
      await assert.rejects(w.provider.openPortal(w.owner), error => error instanceof ProfileOnboardingDuoProviderError
        && error.cause instanceof Error && error.cause.message === "synthetic navigation failure");
      assert.equal(w.portalPages(), 1);
      assert.equal(w.failures.length, 0);
    } finally { await w.cleanup(); }
  });

  for (const platform of ["darwin", "win32"] as const) it(`refuses an unproved exact target before ${platform} foreground handling`, async () => {
    const w = world("key", platform), failure = new Error("ONBOARDING_DUO_SCOPE");
    try {
      await w.provider.showBrowser(w.owner);
      const activations = w.osFocuses(), windowActivations = w.windowFocuses();
      w.refuseSelection(failure);
      await assert.rejects(w.provider.showBrowser(w.owner), error => error === failure);
      assert.equal(w.osFocuses(), activations); assert.equal(w.windowFocuses(), windowActivations);
      assert.deepEqual(w.calls, []);
    } finally { await w.cleanup(); }
  });

  for (const platform of ["darwin", "win32"] as const) it(`activates each ${platform} show and returns to the original Relay target without starting an attempt`, async () => {
    const w = world("key", platform);
    const idle = { state: "idle", ceremonyObserved: false, portalAccepted: false, operatorConfirmed: false, exactCredentialRequestObserved: false };
    const state = ProfileOnboardingStateSchema.parse({ browser: { state: "open" as const, generation: 1 }, state: "onboarding", operationId: w.attempt.operationId, profileId: w.attempt.profileId,
      step: "duo", methods: { key: idle, touch: idle } });
    w.owner.readState = () => state;
    try {
      await w.provider.showBrowser(w.owner); await w.provider.showBrowser(w.owner);
      assert.equal(w.osFocuses(), 2); assert.equal(w.windowFocuses(), 2); assert.equal(w.relayCaptures(), 1);
      assert.deepEqual(await w.sendBrowser("return"), { ok: true, value: state });
      assert.equal(w.relayReturns(), 1); assert.equal(w.launches(), 1); assert.deepEqual(w.calls, []);
    } finally { await w.cleanup(); }
  });

  for (const url of ["https://duosecurity.com/", "https://test.duosecurity.com/"]) it(`opens a direct Duo landing at ${url} without acquiring or submitting credentials`, async () => {
    const w = world();
    w.landPortal(url);
    try {
      await w.provider.openPortal(w.owner);
      await w.provider.openPortal(w.owner);
      assert.equal(w.portalPages(), 1);
      assert.equal(w.typed(), 0);
      assert.equal(w.failures.length, 0);
      assert.deepEqual(w.calls, []);
    } finally { await w.cleanup(); }
  });

  it("leaves the UCSD sign-in form empty and continues when the page reaches Duo", async () => {
    const w = world();
    const form = "https://a5.ucsd.edu/tritON/profile/SAML2/Redirect/SSO";
    Object.assign(w.attempt, { expiresAt: new Date(w.clock.nowMs() + 5_000).toISOString() });
    w.landPortal(form);
    try {
      await w.provider.start(w.attempt, w.bind, w.reportFailure);
      let settled = false;
      const opening = w.provider.openPortal(w.owner).finally(() => { settled = true; });
      opening.catch(() => undefined);
      await new Promise(resolve => setTimeout(resolve, 80));
      assert.equal(settled, false);
      assert.equal(w.typed(), 0);
      assert.equal(w.portalUrl(), form);
      w.reachDuo("https://duosecurity.com/");
      await opening;
      assert.equal(w.typed(), 0);
      assert.equal(w.selectedPages.at(-1), "https://duosecurity.com/");
      assert.equal(w.failures.length, 0);
    } finally { await w.cleanup(); }
  });

  it("logs an unverified macOS return without failing the finished Duo state", async () => {
    const w = world();
    const complete = { state: "complete", ceremonyObserved: true, portalAccepted: true, operatorConfirmed: false, exactCredentialRequestObserved: false };
    const state = ProfileOnboardingStateSchema.parse({ browser: { state: "open" as const, generation: 1 }, state: "onboarding", operationId: w.attempt.operationId, profileId: w.attempt.profileId,
      step: "ready", methods: { key: complete, touch: complete } });
    w.owner.readState = () => state;
    w.refuseReturn(new Error("synthetic return verification failure"));
    try {
      await w.provider.showBrowser(w.owner);
      assert.deepEqual(await w.sendBrowser("return"), { ok: true, value: state });
      assert.equal(w.failures.length, 0);
      assert.ok(w.events.some(event => event.code === "ONBOARDING_DUO_FOCUS_FAILED" && event.operation === "browser-return"));
      assert.equal(w.pages(), 1);
    } finally { await w.cleanup(); }
  });

  it("reopening after a failed arm focuses the owned window without another attempt", async () => {
    const w = world();
    try {
      await w.provider.showBrowser(w.owner); w.failInstall();
      await assert.rejects(w.rawProvider.start(w.attempt, w.bind, w.reportFailure));
      assert.equal(w.failures.length, 1);
      const failure = w.failures[0]; assert.ok(failure instanceof ProfileOnboardingDuoProviderError); assert.equal(failure.kind, "unavailable");
      await w.closeBrowser();
      await w.provider.showBrowser(w.owner);
      assert.equal(w.focuses(), 3); assert.equal(w.windowFocuses(), 2);
      assert.equal(w.osFocuses(), 2);
      assert.equal(w.launches(), 2); assert.equal(w.workerCalls.filter(call => call === "install").length, 1);
      assert.equal(w.portalPages(), 0); assert.deepEqual(w.calls, []);
    } finally { await w.closeBrowser(); await w.cleanup(); }
  });

  it("focuses an existing setup and waits for proved closed-browser settlement before reopening", async () => {
    const w = world();
    try {
      await w.provider.showBrowser(w.owner);
      await w.provider.showBrowser(w.owner);
      assert.equal(w.focuses(), 2); assert.equal(w.windowFocuses(), 2); assert.equal(w.launches(), 1);
      await w.closeBrowser();
      await w.provider.showBrowser(w.owner);
      assert.equal(w.launches(), 2);
      assert.equal(w.portalPages(), 0);
      assert.deepEqual(w.calls, []);
    } finally { await w.cleanup(); }
  });

  it("single-flights concurrent portal commands and retries a failed initialization in the same tab", async () => {
    const w = world();
    try {
      await w.provider.showBrowser(w.owner);
      const attempts = await Promise.allSettled([w.provider.openPortal(w.owner), w.provider.openPortal(w.owner)]);
      assert.ok(attempts.every(result => result.status === "rejected"));
      assert.equal(w.portalPages(), 1);
      assert.equal(w.pages(), 2);
      await assert.rejects(w.provider.openPortal(w.owner));
      assert.equal(w.portalPages(), 2);
      assert.equal(w.pages(), 2);
    } finally { await w.cleanup(); }
  });

  for (const code of ["UCSD_SSO_SCOPE", "UCSD_SSO_FIELDS", "UCSD_SSO_REDIRECT_TIMEOUT", "UCSD_SSO_FORM_TIMEOUT", "synthetic secret person@example.edu"] as const) {
    it(`records only allowlisted portal causes (${code.startsWith("UCSD_") ? code : "unknown"}) and retains the original failure`, async () => {
      const w = world();
      const original = new TypeError(code);
      w.refusePortal(original);
      try {
        await w.provider.showBrowser(w.owner);
        await assert.rejects(w.provider.openPortal(w.owner), error => error instanceof ProfileOnboardingDuoProviderError && error.cause === original);
        const event = w.events.find(event => event.operation === "portal-open");
        assert.ok(event);
        assert.equal(event.code, code.startsWith("UCSD_") ? code : "ONBOARDING_DUO_PROVIDER_FAILED");
        assert.equal(event.exceptionType, "TypeError");
        assert.doesNotMatch(JSON.stringify(w.events), /synthetic secret|person@example|stack|message/);
      } finally { await w.cleanup(); }
    });
  }

  it("gives a navigation timeout its closed code and preserves the original cause", async () => {
    const w = world();
    const original = new Error("synthetic secret person@example.edu");
    original.name = "TimeoutError";
    w.refusePortal(original);
    try {
      await assert.rejects(w.provider.openPortal(w.owner), error => error instanceof ProfileOnboardingDuoProviderError
        && error.cause instanceof Error && error.cause.message === "UCSD_DUO_NAVIGATION_TIMEOUT" && error.cause.cause === original);
      assert.equal(w.typed(), 0);
      const event = w.events.find(event => event.operation === "portal-open");
      assert.equal(event?.code, "UCSD_DUO_NAVIGATION_TIMEOUT");
      assert.doesNotMatch(JSON.stringify(w.events), /synthetic secret|person@example|synthetic-password|stack|message/);
    } finally { await w.cleanup(); }
  });

  for (const url of ["https://foreign.invalid/", "http://duo.ucsd.edu/", "https://duo.ucsd.edu:444/", "https://wrong@duo.ucsd.edu/", "https://a5.ucsd.edu/idp/"]) {
    it(`refuses manual sign-in advice for the untrusted portal URL ${url}`, async () => {
      const w = world();
      w.landPortal(url);
      try {
        await w.provider.showBrowser(w.owner);
        assert.deepEqual(await w.sendBrowser("portal"), { ok: false, portalFailure: "untrusted" });
        const activations = w.osFocuses();
        assert.deepEqual(await w.sendBrowser("portal-show"), { ok: false });
        assert.equal(w.osFocuses(), activations);
        assert.equal(w.typed(), 0); assert.deepEqual(w.calls, []);
      } finally { await w.cleanup(); }
    });
  }
  it("offers manual sign-in when the sign-in form is still open at attempt expiry", async () => {
    const w = world();
    const form = "https://a5.ucsd.edu/tritON/profile/SAML2/Redirect/SSO";
    Object.assign(w.attempt, { expiresAt: new Date(w.clock.nowMs() + 5_000).toISOString() });
    w.landPortal(form);
    try {
      await w.provider.start(w.attempt, w.bind, w.reportFailure);
      const started = Date.now();
      let settled = false;
      const opening = w.sendBrowser("portal").finally(() => { settled = true; });
      opening.catch(() => undefined);
      await new Promise(resolve => setTimeout(resolve, 80));
      assert.equal(settled, false);
      assert.equal(w.typed(), 0);
      assert.equal(w.portalUrl(), form);
      w.clock.setWall(new Date(w.attempt.expiresAt));
      assert.deepEqual(await opening, { ok: false, portalFailure: "sign-in" });
      const elapsed = Date.now() - started;
      assert.ok(elapsed >= 80 && elapsed < 1_000);
      assert.equal(w.typed(), 0);
      assert.equal(w.portalUrl(), form);
    } finally { await w.cleanup(); }
  });

  it("bounded failed arm closure stays uncertain and cannot permit a replacement attempt", async () => {
    const w = world();
    try {
      await w.provider.start(w.attempt, w.bind, w.reportFailure); w.blockStop();
      await assert.rejects(w.provider.cancel(w.attempt), error => error instanceof ProfileOnboardingDuoProviderError && error.kind === "unknown");
      await assert.rejects(w.provider.start({ ...w.attempt, attemptId: randomUUID() }, w.bind, w.reportFailure));
      assertUncertainBrowserClosure(await w.provider.closeBrowser(w.owner));
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
      assertUncertainBrowserClosure(await w.provider.closeBrowser(w.owner));
      await assert.rejects(w.provider.showBrowser(w.owner), error => error instanceof ProfileOnboardingDuoProviderError && error.kind === "unknown");
      assert.equal(w.launches(), 1);
      assert.ok(existsSync(w.profile()));
    } finally { await w.closeBrowser(); await w.cleanup(); }
  });

  it("retains the named scope cause when a bound attempt holding a key becomes Unknown", async () => {
    const w = world();
    try {
      await w.provider.start(w.attempt, w.bind, w.reportFailure);
      await w.send("bind", BIND);
      await w.send("persist", { credentialId: "cHVibGljLWlk", privateKeyPkcs8: "synthetic", publicKeySpki: "synthetic",
        transport: "usb", isResidentCredential: false, createdAt: w.clock.now().toISOString() });
      assert.deepEqual(await w.send("software-created", { credentialId: "b3RoZXItaWQ", requestId: randomUUID() }), { ok: false });
      const failure = w.failures[0]; assert.ok(failure instanceof ProfileOnboardingDuoProviderError);
      assert.equal(failure.kind, "unknown"); assert.equal(failure.reason, "scope");
      assert.ok(w.calls.includes("unknown"));
    } finally { await w.closeBrowser(); await w.cleanup(); }
  });

  it("binds real observed username independently of issuer account ID and keeps repeated start idempotent", async () => {
    const w = world();
    try {
      await w.provider.start(w.attempt, w.bind, w.reportFailure);
      await w.provider.start(w.attempt, w.bind, w.reportFailure);
      assert.equal(w.launches(), 1);
      assert.deepEqual(await w.send("bind", BIND), { ok: true, value: { accountId: w.attempt.accountId } });
      assert.equal(w.observed()?.tabId, 7);
      assert.equal(w.observed()?.contextId, BIND.documentId);
      const requestId = randomUUID();
      assert.deepEqual(await w.send("persist", { credentialId: "cHVibGljLWlk", privateKeyPkcs8: "synthetic", publicKeySpki: "synthetic",
        transport: "usb", isResidentCredential: false, createdAt: w.clock.now().toISOString() }), { ok: true, value: { revision: 1 } });
      await w.send("software-created", { credentialId: "cHVibGljLWlk", requestId });
      await w.send("sign", { credentialId: "cHVibGljLWlk", requestId: randomUUID(), origin: BIND.origin, rpId: "duosecurity.com", challenge: "AQID" });
      const osFocusBeforeCompletion = w.osFocuses();
      await w.send("portal-accepted", { credentialId: "cHVibGljLWlk", requestId });
      assert.deepEqual(w.calls, ["persist", "fast-duo", "sign", "sign-return", "portal-accepted"]);
      assert.equal(w.selectedPages.at(-1), "chrome-extension://owned-extension/src/options.html");
      assert.equal(w.osFocuses(), osFocusBeforeCompletion, "background completion selects its tab without activating the app");
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
  it("persists the emulated macOS key before recording separate ceremony and portal facts", async () => {
    const w = world("touch");
    try {
      await w.provider.start(w.attempt, w.bind, w.reportFailure);
      await w.send("bind", BIND);
      const requestId = randomUUID();
      await w.send("native-created", { credentialId: "native-public-id", requestId });
      assert.deepEqual(w.calls, ["persist", "chromium-platform"]);
      await w.send("portal-accepted", { credentialId: "native-public-id", requestId });
      assert.deepEqual(w.calls, ["persist", "chromium-platform", "portal-accepted"]);
    } finally { await w.cleanup(); }
  });

  it("retains the virtual platform key before recording its ceremony on Windows", async () => {
    const w = world("touch", "win32");
    try {
      await w.provider.start(w.attempt, w.bind, w.reportFailure);
      assert.deepEqual(await w.send("bind", BIND), { ok: true, value: { accountId: w.attempt.accountId } });
      const requestId = randomUUID(), credentialId = Buffer.from("virtual-public-id").toString("base64url");
      assert.deepEqual(await w.send("native-created", { credentialId, requestId }), { ok: true, value: { observed: true } });
      assert.deepEqual(w.calls, ["persist", "chromium-platform"]);
      await w.send("portal-accepted", { credentialId, requestId });
      assert.deepEqual(w.calls, ["persist", "chromium-platform", "portal-accepted"]);
    } finally { await w.cleanup(); }
  });

  it("binds the verified top-level Duo page when it also contains same-origin child frames", async () => {
    const w = world("touch");
    w.sameOriginChildFrame();
    try {
      await w.provider.start(w.attempt, w.bind, w.reportFailure);
      assert.deepEqual(await w.send("bind", BIND), { ok: true, value: { accountId: w.attempt.accountId } });
      await w.send("native-created", { credentialId: "native-public-id", requestId: randomUUID() });
      assert.deepEqual(w.calls, ["persist", "chromium-platform"]);
    } finally { await w.cleanup(); }
  });

  it("refuses ambiguous top-level Duo pages before preparing an authenticator", async () => {
    const w = world("touch");
    try {
      await w.provider.start(w.attempt, w.bind, w.reportFailure);
      w.addDuoPage();
      assert.deepEqual(await w.send("bind", BIND), { ok: false });
      assert.deepEqual(w.calls, []);
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
      assert.equal(w.calls.includes("unknown"), boundary !== "portal-accepted");
      assert.equal(w.failures.length, boundary === "portal-accepted" ? 0 : 1);
      if (boundary === "sign" || boundary === "sign-return") assert.ok(w.calls.includes("sign"));
    } finally { await w.cleanup(); }
  });

  it("ends a keyless attempt as retryable when the document changes during binding", async () => {
    const w = world();
    try {
      await w.provider.start(w.attempt, async input => { const capability = await w.bind(input); w.drift(); return capability; }, w.reportFailure);
      assert.deepEqual(await w.send("bind", BIND), { ok: false });
      await w.provider.cancel(w.attempt);
      assert.ok(!w.calls.includes("unknown"));
      assert.equal(w.failures.length, 1);
      const failure = w.failures[0]; assert.ok(failure instanceof ProfileOnboardingDuoProviderError); assert.equal(failure.kind, "refused");
    } finally { await w.cleanup(); }
  });
});

it("reports backend failures with exception type and measures processing without idle poll warnings", async () => {
  const w = world();
  try {
    await w.provider.showBrowser(w.owner);
    w.clock.advanceMonotonic(5000);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(w.events.some(event => event.stage === "slow-operation"), false);
    const idle = { state: "idle", ceremonyObserved: false, portalAccepted: false, operatorConfirmed: false, exactCredentialRequestObserved: false };
    const state = ProfileOnboardingStateSchema.parse({ browser: { state: "open" as const, generation: 1 }, state: "onboarding", operationId: w.attempt.operationId, profileId: w.attempt.profileId,
      step: "duo", methods: { key: idle, touch: idle } });
    w.owner.readState = () => { w.clock.advanceMonotonic(1500); return state; };
    await w.sendBrowser("state");
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.ok(w.events.some(event => event.stage === "slow-operation" && event.operation === "browser-request" && event.durationMs === 1500));
    w.owner.readState = () => { throw new TypeError("secret-password", { cause: new Error("private-key") }); };
    await w.sendBrowser("state");
    assert.ok(w.events.some(event => event.code === "ONBOARDING_DUO_PROVIDER_FAILED" && event.exceptionType === "TypeError"));
    assert.doesNotMatch(JSON.stringify(w.events), /secret-password|private-key/);
  } finally { await w.cleanup(); }
});

function containsFailure(error: unknown, expected: Error): boolean {
  return error === expected || error instanceof AggregateError && error.errors.some((item: unknown) => containsFailure(item, expected))
    || error instanceof Error && containsFailure(error.cause, expected);
}

for (const failedReport of ["failure", "slow"] as const) it(`preserves setup and ${failedReport} diagnostic failures while proving browser closure`, async () => {
  const w = world(), original = new Error("synthetic setup failure"), logging = new Error("synthetic log unavailable");
  w.refuseBrowserSetup(original, 1500);
  let reports = 0;
  w.owner.reportEvent = event => { reports++; if (failedReport === "failure" || event.stage === "slow-operation") throw logging; };
  try {
    await assert.rejects(w.provider.showBrowser(w.owner), error => containsFailure(error, original) && containsFailure(error, logging));
    assert.equal(reports, failedReport === "failure" ? 1 : 2);
    assert.deepEqual(await w.provider.closeBrowser(w.owner), { state: "closed" });
    assert.equal(w.pages(), 0);
  } finally { await w.cleanup(); }
});

it("replies to a failed idle STATE command, revokes the pump, and preserves diagnostics without retrying the sink", async () => {
  const w = world(), original = new TypeError("synthetic read failure"), logging = new Error("synthetic log unavailable");
  let reports = 0;
  try {
    await w.provider.showBrowser(w.owner);
    w.owner.readState = () => { throw original; };
    w.owner.reportEvent = () => { reports++; throw logging; };
    assert.deepEqual(await w.sendBrowser("state"), { ok: false });
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(reports, 1);
    await assert.rejects(w.provider.showBrowser(w.owner), error => containsFailure(error, original) && containsFailure(error, logging));
    assert.equal(w.launches(), 1);
    assert.deepEqual(await w.provider.closeBrowser(w.owner), { state: "closed" });
    assert.equal(w.pages(), 0);
  } finally { await w.cleanup(); }
});

it("retains a captured key when backend diagnostics fail without inventing failed physical closure", async () => {
  const w = world();
  try {
    await w.provider.start(w.attempt, w.bind, w.reportFailure);
    await w.send("bind", BIND);
    await w.send("persist", { credentialId: "cHVibGljLWlk", privateKeyPkcs8: "synthetic", publicKeySpki: "synthetic",
      transport: "usb", isResidentCredential: false, createdAt: w.clock.now().toISOString() });
    let reports = 0;
    w.owner.reportEvent = () => { reports++; throw new Error("synthetic log unavailable"); };
    assert.deepEqual(await w.send("scope-lost", { requestId: randomUUID() }), { ok: false });
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.ok(w.calls.includes("unknown"));
    assert.ok(w.failures[0] instanceof ProfileOnboardingDuoProviderError && w.failures[0].kind === "unknown");
    assert.equal(reports, 1);
    assert.deepEqual(await w.provider.closeBrowser(w.owner), { state: "closed" });
  } finally { await w.cleanup(); }
});

it("preserves a known worker-unavailable code in backend setup diagnostics", async () => {
  const w = world(); w.refuseBrowserSetup(new Error("ONBOARDING_DUO_WORKER_UNAVAILABLE"), 0);
  try {
    await assert.rejects(w.provider.showBrowser(w.owner));
    assert.ok(w.events.some(event => event.code === "ONBOARDING_DUO_WORKER_UNAVAILABLE"));
  } finally { await w.cleanup(); }
});

it("preserves the failed attempt install when its slow diagnostic also fails", async () => {
  const w = world(), original = new Error("synthetic install failure"), logging = new Error("synthetic log unavailable");
  let reports = 0;
  try {
    await w.provider.showBrowser(w.owner);
    w.refuseInstall(original, 1500);
    w.owner.reportEvent = () => { reports++; throw logging; };
    await assert.rejects(w.provider.start(w.attempt, w.bind, w.reportFailure), error => containsFailure(error, original) && containsFailure(error, logging));
    assert.equal(reports, 1);
    assert.ok(containsFailure(w.failures[0], original) && containsFailure(w.failures[0], logging));
    assert.deepEqual(await w.provider.closeBrowser(w.owner), { state: "closed" });
  } finally { await w.cleanup(); }
});

for (const phase of ["prelaunch", "clean-setup", "unproved-setup"] as const) it(`proves old recovery before independent replacement failure: ${phase}`, async () => {
  const w = world(), original = new Error("persistent replacement fixture failure");
  try {
    const recover = w.rawProvider.recoverBrowser?.bind(w.rawProvider), readState = w.rawProvider.browserState?.bind(w.rawProvider);
    assert.ok(recover); assert.ok(readState);
    await w.rawProvider.showBrowser(w.owner);
    const oldDirectory = w.profile();
    await assert.rejects(recover(w.owner, 0));
    await assert.rejects(recover({ ...w.owner, operationId: randomUUID() }, 1));
    assert.equal(w.nativeProbes(), 0); assert.equal(w.launches(), 1);
    await recover(w.owner, 1);
    assert.equal(w.nativeProbes(), 1); assert.equal(existsSync(oldDirectory), false); assert.equal(w.launches(), 1);
    if (phase === "prelaunch") w.refuseCapture(original);
    else { w.refuseBrowserSetup(original, 0); if (phase === "unproved-setup") w.refuseNative(); }
    await assert.rejects(w.rawProvider.showBrowser(w.owner), error => {
      if (phase === "prelaunch") assert.ok(error instanceof ProfileOnboardingDuoProviderError && error.cause === original);
      else if (phase === "clean-setup") assert.equal(error, original);
      else assert.ok(error instanceof AggregateError && error.errors.includes(original));
      return true;
    });
    assert.equal(w.launches(), phase === "prelaunch" ? 1 : 2);
    const state = readState(w.owner.operationId); assert.equal(state.state, "failed");
    if (state.state === "failed") assert.equal(state.code, phase === "unproved-setup" ? "DUO_SETUP_FILES_BUSY" : "DUO_SETUP_OPEN_FAILED");
    const closure = await w.rawProvider.closeBrowser(w.owner);
    assert.equal(closure.state, phase === "unproved-setup" ? "uncertain" : "closed");
    if (phase !== "unproved-setup") assert.equal(existsSync(w.profile()), false);
  } finally { await w.closeBrowser(); await w.cleanup(); }
});
