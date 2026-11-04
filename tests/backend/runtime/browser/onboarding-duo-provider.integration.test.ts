import { createBrowserRoots } from "../../../../src/backend/storage/browser-roots.js";
import { DEFAULT_BROWSER_LAUNCHER } from "../../../../src/backend/runtime/browser/native-browser.js";
import { runtimeLifetimeLock } from "../../../support/helpers/backend/runtime-lifetime.js";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "@playwright/test";
import type { BrowserContext } from "playwright";
import { it } from "vitest";
import { z } from "zod";
import { createProfileOnboardingDuoProvider } from "../../../../src/backend/runtime/browser/onboarding-duo-provider.js";
import type { DraftDuoBrowserOwner } from "../../../../src/backend/profiles/onboarding-duo.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { composeProfileRuntime, RuntimeCustodyUncertainError } from "../../../../src/backend/app/composition/storage-compose.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { SignUpOperationSchema } from "../../../../src/models/profiles/profile.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";

const SSO = "https://a5.ucsd.edu/tritON/profile/SAML2/Redirect/SSO";
const FORM = `<!doctype html><form action="${SSO}" method="post"><label for="ssousername">Username</label><input id="ssousername" name="username"><label for="ssopassword">Password</label><input id="ssopassword" name="password" type="password"><button name="_eventId_proceed">Sign in</button></form>`;

for (const pendingClose of [false, true]) it(pendingClose
  ? "real synthetic MV3 pending software-key attempt retains UNKNOWN across whole-window closure and reopen"
  : "real Relay UI and private draft log in once in a separate same-window Duo tab and keep method attempts separate", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "onboarding-launch-")));
  for (const file of ["package.json", "package-lock.json"]) copyFileSync(file, join(root, file));
  const lifetime = await runtimeLifetimeLock();
  const machine = acquireEntrypointAdmission(root, "exclusive", lifetime);
  const browserRoot = join(machine.stateRoot, "browsers", "onboarding"); mkdirSync(browserRoot, { recursive: true, mode: 0o700 });
  const processLockRoot = join(root, rebuildRuntimeIsolation.processLockRoot); mkdirSync(processLockRoot, { recursive: true, mode: 0o700 });
  let context: BrowserContext | undefined, launches = 0, acquisitions = 0, submissions = 0, nativeProbes = 0, nativeClosures = 0;
  const nativeContexts = new Set<BrowserContext>();
  let owner: DraftDuoBrowserOwner | undefined;
  const provider = createProfileOnboardingDuoProvider({ focus: { async captureRelay() { return undefined; }, async show() {}, async returnToRelay() { throw new Error("unexpected native Return"); } }, browserRoots: createBrowserRoots(machine), browserRoot, extensionDirectory: realpathSync(join(process.cwd(), "fast-duo")), clock: systemClock, closeProofMs: 5000,
    launcher: { async launch(input) {
      if (input.nativeOnly === true) {
        assert.equal(input.headless, true); assert.equal(input.extensionDirectory, ""); assert.equal(input.acceptDownloads, false);
        nativeProbes++;
        const probe = await DEFAULT_BROWSER_LAUNCHER.launch(input); nativeContexts.add(probe);
        probe.once("close", () => { nativeClosures++; nativeContexts.delete(probe); });
        return probe;
      }
      launches++; assert.equal(input.headless, false);
      // Full Chromium exercises the synthetic extension UI without a desktop session.
      context = await DEFAULT_BROWSER_LAUNCHER.launch({ ...input, headless: true });
      await context.route("**/*", async route => {
        const request = route.request();
        if (request.url().startsWith("chrome-extension://")) await route.continue();
        else if (request.method() === "POST" && request.url() === SSO) {
          submissions++;
          const values = new URLSearchParams(request.postData() ?? "");
          assert.equal(values.get("username"), "synthetic-user@ucsd.edu"); assert.equal(values.get("password"), "synthetic-password");
          await route.fulfill({ contentType: "text/html", body: "<h1>Awaiting native MFA</h1>" });
        }
        else if (request.url() === "https://duo.ucsd.edu/") await route.fulfill({ contentType: "text/html", body: `<script>location.replace(${JSON.stringify(SSO)})</script>` });
        else if (request.url() === SSO) await route.fulfill({ contentType: "text/html", body: FORM });
        else await route.abort();
      });
      const focusWorker = context.serviceWorkers().find(worker => worker.url().endsWith("/src/relay-background.js"))
        ?? await context.waitForEvent("serviceworker", { predicate: worker => worker.url().endsWith("/src/relay-background.js"), timeout: 5000 });
      await focusWorker.evaluate("globalThis.relayFocusCalls = []; const originalWindowUpdate = chrome.windows.update.bind(chrome.windows); chrome.windows.update = async (windowId, options) => { relayFocusCalls.push({ windowId, focused: options.focused }); return originalWindowUpdate(windowId, options); };");
      return context;
    } },
  });
  const profile = composeProfileRuntime({ admission: machine,  hostFacts: { primaryDisplay: null }, clock: systemClock,
    onboardingDuo: { ...provider, async showBrowser(draft) {
      owner = draft;
      await provider.showBrowser({ ...draft, async acquireCredentials() { acquisitions++; return draft.acquireCredentials(); } });
    } } });
  const draft = profile.session.signUp({ firstName: "Synthetic", lastName: "Operator", email: "synthetic-user@ucsd.edu", password: "synthetic-password", createdAt: systemClock.now().toISOString() });
  assert.equal(draft.state, "onboarding"); if (draft.state !== "onboarding") throw new Error("fixture draft required");
  const read = () => profile.session.readOnboarding(draft.token, draft.operationId);
  let failure: unknown;
  try {
    await profile.session.showOnboardingBrowser(draft.token, draft.operationId);
    assert.ok(context);
    assert.equal(launches, 1); assert.equal(context.pages().length, 1); assert.equal(acquisitions, 0); assert.equal(read().methods.key.state, "idle");
    const focusWorker = context.serviceWorkers()[0]; assert.ok(focusWorker);
    const focusCalls = () => focusWorker.evaluate("globalThis.relayFocusCalls").then(value => z.array(z.strictObject({ windowId: z.number().int(), focused: z.literal(true) })).parse(value));
    assert.equal((await focusCalls()).length, 1);
    let setup = context.pages()[0]; assert.ok(setup);
    assert.match(setup.url(), /^chrome-extension:\/\/[^/]+\/src\/options\.html$/);
    await expect(setup.locator("#globalStatus")).toHaveText("Open Duo to begin");
    await expect(setup.getByRole("heading", { name: "Relay sign-in methods", exact: true })).toBeVisible();
    await expect(setup.locator(".brand small")).toHaveText("Relay sign-in setup");
    await expect(setup.locator("footer > span:last-child")).toHaveText("Continue in Relay when both methods are added.");
    await expect(setup.locator("#editorTitle")).toHaveText("Set up a sign-in method");
    await expect(setup.locator(".relay-setup-steps > li")).toHaveCount(3);
    await profile.session.showOnboardingBrowser(draft.token, draft.operationId); assert.equal(launches, 1);
    assert.equal((await focusCalls()).length, 2);
    await setup.getByRole("button", { name: "Open duo.ucsd.edu", exact: true }).click();
    await expect(setup.locator("#openLogin")).toBeEnabled();
    assert.equal(context.pages().length, 2);
    const portal = context.pages().find(page => page !== setup); assert.ok(portal);
    const worker = context.serviceWorkers()[0]; assert.ok(worker);
    const windows = z.array(z.number().int()).parse(await worker.evaluate("chrome.windows.getAll().then(windows => windows.map(window => window.id))"));
    const tabWindows = z.array(z.number().int()).parse(await worker.evaluate("chrome.tabs.query({}).then(tabs => tabs.map(tab => tab.windowId))"));
    assert.equal(windows.length, 1); assert.equal(tabWindows.length, 2); assert.ok(tabWindows.every(id => id === windows[0]));
    await expect(portal.getByRole("heading", { name: "Awaiting native MFA" })).toBeVisible();
    assert.equal(portal.url(), SSO); assert.equal(acquisitions, 1); assert.equal(submissions, 1); assert.equal(read().methods.key.state, "idle");
    await context.route("https://duo.ucsd.edu/devices", route => route.fulfill({ contentType: "text/html", body: "<h1>Duo device management</h1>" }));
    await portal.goto("https://duo.ucsd.edu/devices");
    await profile.session.openOnboardingPortal(draft.token, draft.operationId); assert.equal(context.pages().length, 2); assert.equal(acquisitions, 1);
    assert.equal(portal.url(), "https://duo.ucsd.edu/devices"); assert.equal(submissions, 1);
    for (const method of ["key", "touch"] as const) {
      await setup.getByRole("group", { name: "Sign-in method", exact: true }).getByRole("button", { name: method === "key" ? "Security key" : "Touch ID", exact: true }).click();
      await setup.getByRole("button", { name: `Set up ${method === "key" ? "Security key" : "Touch ID"}`, exact: true }).click();
      await expect(setup.locator("#cancelCapture")).toBeEnabled();
      assert.equal(read().methods[method].state, "pending");
      await setup.getByRole("button", { name: "Cancel setup", exact: true }).click();
      await expect(setup.locator("#transport button").first()).toBeEnabled();
      assert.equal(read().methods[method].state, "idle");
    }
    assert.equal(launches, 1); assert.equal(submissions, 1);
    await context.route("https://foreign.invalid/**", route => route.fulfill({ contentType: "text/html", body: "Foreign page" }));
    await portal.goto("https://foreign.invalid/");
    await assert.rejects(profile.session.openOnboardingPortal(draft.token, draft.operationId));
    assert.equal(submissions, 1); assert.equal(acquisitions, 1); assert.equal(context.pages().length, 2);
    await setup.getByRole("button", { name: "Open duo.ucsd.edu", exact: true }).click();
    await expect(setup.locator("#message")).toContainText("Relay could not finish that action");
    await setup.evaluate(() => new Promise<void>(resolve => {
      const list = document.getElementById("accountList"); if (!list) throw new Error("fixture method list missing");
      const observer = new MutationObserver(() => { observer.disconnect(); resolve(); });
      observer.observe(list, { childList: true });
    }));
    await expect(setup.locator("#message")).toContainText("Relay could not finish that action");
    const methodsBeforeReopen = read().methods;
    await setup.close();
    await Promise.all([profile.session.showOnboardingBrowser(draft.token, draft.operationId), profile.session.showOnboardingBrowser(draft.token, draft.operationId)]);
    assert.equal(launches, 1); assert.equal(context.pages().length, 2);
    setup = context.pages().find(page => page !== portal)!; assert.ok(setup);
    await expect(setup.getByRole("heading", { name: "Relay sign-in methods", exact: true })).toBeVisible();
    assert.equal(acquisitions, 1); assert.equal(submissions, 1); assert.deepEqual(read().methods, methodsBeforeReopen);
    await context.close();
    await profile.session.showOnboardingBrowser(draft.token, draft.operationId);
    assert.equal(launches, 2); assert.equal(context.pages().length, 1);
    assert.equal(acquisitions, 1); assert.equal(submissions, 1); assert.deepEqual(read().methods, methodsBeforeReopen);
    await expect(context.pages()[0].getByRole("heading", { name: "Relay sign-in methods", exact: true })).toBeVisible();
    if (pendingClose) {
      setup = context.pages()[0];
      await setup.getByRole("group", { name: "Sign-in method", exact: true }).getByRole("button", { name: "Security key", exact: true }).click();
      await setup.getByRole("button", { name: "Set up Security key", exact: true }).click();
      await expect(setup.locator("#cancelCapture")).toBeEnabled();
      assert.equal(read().methods.key.state, "pending");
      await context.route("https://synthetic.duosecurity.com/**", route => route.fulfill({ contentType: "text/html",
        body: "<!doctype html><body>Signed in as: synthetic-user@ucsd.edu</body>" }));
      const capture = await context.newPage();
      await capture.goto("https://synthetic.duosecurity.com/");
      const authenticator = await context.newCDPSession(capture);
      await authenticator.send("WebAuthn.enable");
      const { authenticatorId } = await authenticator.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "usb",
        hasResidentKey: false, hasUserVerification: false, automaticPresenceSimulation: true } });
      await capture.evaluate(async () => {
        const credential = await navigator.credentials.create({ publicKey: {
          challenge: new TextEncoder().encode("synthetic-pending-close"), rp: { id: "duosecurity.com", name: "Synthetic Duo" },
          user: { id: new TextEncoder().encode("synthetic-user"), name: "synthetic-user@ucsd.edu", displayName: "Synthetic Operator" },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
          authenticatorSelection: { authenticatorAttachment: "cross-platform", userVerification: "discouraged" },
        } });
        if (!credential) throw new Error("synthetic software credential absent");
      });
      assert.deepEqual((await authenticator.send("WebAuthn.getCredentials", { authenticatorId })).credentials, []);
      const captured = read().methods.key;
      assert.equal(captured.state, "pending"); assert.equal(captured.ceremonyObserved, true);
      assert.equal(captured.portalAccepted, false); assert.equal(captured.operatorConfirmed, false);
      assert.equal(captured.exactCredentialRequestObserved, false);
      await context.close();
      await profile.session.showOnboardingBrowser(draft.token, draft.operationId);
      assert.equal(launches, 3); assert.equal(context.pages().length, 1);
      const retained = read().methods.key;
      assert.equal(retained.state, "unknown"); assert.equal(retained.attemptId, captured.attemptId);
      const operation = SignUpOperationSchema.parse(JSON.parse(readFileSync(join(machine.stateRoot, "machine", "operations", `${draft.operationId}.json`), "utf8")));
      assert.deepEqual(operation.onboarding?.attempts.find(entry => entry.attemptId === captured.attemptId)?.failure, { kind: "unknown", causeTag: "browser-lifetime" });
      const debugAdmission = machine.admitProfile(draft.profileId);
      try {
        AuthorityDatabase.withProfileOnboardingTimeline(debugAdmission, systemClock, repository => {
          const events = repository.page({ after: 0, through: repository.highWaterMark(), limit: 500 });
          const failure = events.find(entry => entry.payload.kind === "debug" && entry.payload.event.correlationId === captured.attemptId);
          assert.ok(failure); assert.equal(failure.payload.kind, "debug");
          if (failure.payload.kind !== "debug") throw new Error("onboarding debug event missing");
          assert.equal(failure.payload.event.category, "duo"); assert.equal(failure.payload.event.phase, "failed");
          assert.equal(failure.payload.event.pinned, true);
          assert.deepEqual(JSON.parse(failure.payload.event.message ?? ""), { method: "key", kind: "unknown", causeTag: "browser-lifetime" });
          assert.doesNotMatch(JSON.stringify(events), /synthetic-password|synthetic-user@ucsd.edu|privateKey|stack/);
        });
      } finally { debugAdmission.release(); }
      assert.equal(retained.ceremonyObserved, true); assert.equal(retained.portalAccepted, false);
      assert.equal(retained.operatorConfirmed, false); assert.equal(retained.exactCredentialRequestObserved, false);
      assert.equal(read().methods.touch.state, "idle"); assert.equal(acquisitions, 1); assert.equal(submissions, 1);
      await expect(context.pages()[0].locator("#accountList")).toContainText("Failed");
      await assert.rejects(profile.session.startOnboardingDuo(draft.token, draft.operationId, "key"));
      await assert.rejects(profile.session.startOnboardingDuo(draft.token, draft.operationId, "touch"));
      assert.equal(read().methods.key.attemptId, captured.attemptId); assert.equal(launches, 3);
      assert.deepEqual(await profile.session.cancelOnboarding(draft.token, draft.operationId), { state: "signed-out" });
      assert.ok(owner); const stale = owner; assert.throws(() => stale.assertCurrent()); await assert.rejects(stale.acquireCredentials());
      assert.equal(machine.readProfileRegistry().profiles.length, 0);
    } else {
      assert.deepEqual(await profile.session.cancelOnboarding(draft.token, draft.operationId), { state: "signed-out" });
      assert.ok(owner); const stale = owner; assert.throws(() => stale.assertCurrent()); await assert.rejects(stale.acquireCredentials());
      assert.equal(machine.readProfileRegistry().profiles.length, 0);
    }
    assert.equal(launches, pendingClose ? 3 : 2); assert.equal(nativeProbes, launches);
    assert.equal(nativeClosures, nativeProbes); assert.equal(nativeContexts.size, 0);
  } catch (error) { failure = error; }
  try { await profile.close(); }
  catch (error) { failure = failure === undefined ? error : new AggregateError([failure, error], "onboarding fixture and cleanup failed"); }
  try { await context?.close(); }
  catch (error) { failure = failure === undefined ? error : new AggregateError([failure, error], "onboarding browser cleanup failed"); }
  try { machine.release(); }
  catch (error) { failure = failure === undefined ? error : new AggregateError([failure, error], "onboarding admission cleanup failed"); }
  if (failure !== undefined) throw new Error("onboarding fixture failed", { cause: failure });
});

for (const scenario of ["software", "abort", "timeout", "platform", "scope-refused"] as const) it(`real enrollment bridge: ${scenario}`, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "duo-enrollment-")));
  for (const file of ["package.json", "package-lock.json"]) copyFileSync(file, join(root, file));
  const machine = acquireEntrypointAdmission(root, "exclusive", await runtimeLifetimeLock());
  const browserRoot = join(machine.stateRoot, "browsers", "onboarding");
  mkdirSync(browserRoot, { recursive: true, mode: 0o700 });
  let context: BrowserContext | undefined;
  const provider = createProfileOnboardingDuoProvider({ focus: { async captureRelay() { return undefined; }, async show() {}, async returnToRelay() { throw new Error("unexpected native Return"); } }, browserRoots: createBrowserRoots(machine), browserRoot,
    extensionDirectory: realpathSync("fast-duo"), clock: systemClock, closeProofMs: 5000, platform: "win32",
    launcher: { async launch(input) {
      if (input.nativeOnly) return DEFAULT_BROWSER_LAUNCHER.launch(input);
      context = await DEFAULT_BROWSER_LAUNCHER.launch({ ...input, headless: true });
      await context.route("https://enrollment.duosecurity.com/**", route => route.fulfill({ contentType: "text/html",
        body: scenario === "scope-refused" ? "<!doctype html><body>Duo device management</body>" : "<!doctype html><body>Signed in as: synthetic-enrollment@ucsd.edu</body>" }));
      return context;
    } },
  });
  const profile = composeProfileRuntime({ admission: machine, hostFacts: { primaryDisplay: null }, clock: systemClock, onboardingDuo: provider });
  const draft = profile.session.signUp({ firstName: "Synthetic", lastName: "Enrollment", email: "synthetic-enrollment@ucsd.edu",
    password: "synthetic-enrollment-password", createdAt: systemClock.now().toISOString() });
  assert.equal(draft.state, "onboarding");
  if (draft.state !== "onboarding") throw new Error("synthetic draft missing");
  let failure: unknown;
  try {
    await profile.session.showOnboardingBrowser(draft.token, draft.operationId);
    assert.ok(context);
    const page = await context.newPage();
    await page.goto("https://enrollment.duosecurity.com/");
    const method = scenario === "platform" ? "touch" : "key";
    await profile.session.startOnboardingDuo(draft.token, draft.operationId, method);
    await page.bringToFront();
    assert.equal(await page.evaluate(() => document.hasFocus()), true);
    if (scenario === "platform") {
      assert.equal(await page.evaluate(() => PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()), true);
    }
    const outcome = await page.evaluate(async scenario => {
      const controller = new AbortController();
      if (scenario === "abort") window.addEventListener("message", event => {
        const message: unknown = event.data;
        if (event.source === window && typeof message === "object" && message !== null
          && "type" in message && message.type === "RELAY_DUO_REQUEST" && "operation" in message && message.operation === "DUO_AUTOPILOT_ENROLL") controller.abort();
      }, { once: true });
      try {
        const credential = await navigator.credentials.create({ signal: controller.signal, publicKey: {
          rp: { id: "duosecurity.com", name: "Duo Security" },
          challenge: new TextEncoder().encode("synthetic-enrollment-challenge"),
          user: { id: new TextEncoder().encode("synthetic-handle"), name: "synthetic-enrollment@ucsd.edu", displayName: "Synthetic Enrollment" },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
          excludeCredentials: [{ type: "public-key", id: new Uint8Array([8, 9]), transports: ["usb", "internal"] }],
          authenticatorSelection: { authenticatorAttachment: scenario === "platform" ? "platform" : "cross-platform",
            residentKey: "discouraged", requireResidentKey: false, userVerification: scenario === "platform" ? "required" : "discouraged" },
          attestation: "direct", timeout: scenario === "timeout" ? 1 : 10000,
        } });
        if (!(credential instanceof PublicKeyCredential)) throw new Error("credential missing");
        return { state: "created", attachment: credential.authenticatorAttachment };
      } catch (error) {
        return { state: "failed", name: error instanceof Error ? error.name : "unknown" };
      }
    }, scenario);
    if (scenario === "abort" || scenario === "timeout" || scenario === "scope-refused") {
      assert.equal(outcome.state, "failed");
      assert.equal(outcome.name, scenario === "abort" ? "AbortError" : "NotAllowedError");
      await expect.poll(() => profile.session.readOnboarding(draft.token, draft.operationId).methods.key.state).toBe("unknown");
      await assert.rejects(profile.session.startOnboardingDuo(draft.token, draft.operationId, "key"));
      const operation = SignUpOperationSchema.parse(JSON.parse(readFileSync(join(machine.stateRoot, "machine", "operations", `${draft.operationId}.json`), "utf8")));
      assert.equal(operation.onboarding?.attempts[0]?.failure?.causeTag, scenario === "scope-refused" ? "request-refused" : scenario === "abort" ? "aborted" : "timed-out");
    } else {
      assert.deepEqual(outcome, { state: "created", attachment: scenario === "platform" ? "platform" : "cross-platform" });
      const state = profile.session.readOnboarding(draft.token, draft.operationId).methods[method];
      assert.equal(state.state, "pending"); assert.equal(state.ceremonyObserved, true); assert.equal(state.operatorConfirmed, false);
    }
    const debugAdmission = machine.admitProfile(draft.profileId);
    try {
      AuthorityDatabase.withProfileOnboardingTimeline(debugAdmission, systemClock, repository => {
        const events = repository.page({ after: 0, through: repository.highWaterMark(), limit: 500 });
        const reasons = events.flatMap(entry => entry.payload.kind === "debug" && entry.payload.event.category === "duo" ? [entry.payload.event.reason] : []);
        assert.ok(reasons.includes("intercepted"));
        if (scenario === "software" || scenario === "platform") {
          for (const reason of ["forwarded", "backend-received", "replied"]) assert.ok(reasons.includes(reason), reason);
        } else assert.ok(reasons.includes(scenario === "scope-refused" ? "refused-account" : scenario === "abort" ? "aborted" : "timed-out"));
        assert.doesNotMatch(JSON.stringify(events), /synthetic-enrollment@ucsd.edu|synthetic-enrollment-password|synthetic-handle|synthetic-enrollment-challenge|privateKey|publicKey|stack/);
      });
    } finally { debugAdmission.release(); }
  } catch (error) {
    failure = error;
    try {
      const debugAdmission = machine.admitProfile(draft.profileId);
      try {
        AuthorityDatabase.withProfileOnboardingTimeline(debugAdmission, systemClock, repository => {
          const reasons = repository.page({ after: 0, through: repository.highWaterMark(), limit: 500 })
            .flatMap(entry => entry.payload.kind === "debug" && entry.payload.event.category === "duo" ? [entry.payload.event.reason] : []);
          failure = new Error(`enrollment fixture ${scenario}: ${reasons.join(", ")}`, { cause: error });
        });
      } finally { debugAdmission.release(); }
    } catch (diagnosticError) { failure = new AggregateError([error, diagnosticError], "enrollment fixture and diagnostics failed"); }
  }
  try {
    if (profile.session.readOnboarding(draft.token, draft.operationId).methods[scenario === "platform" ? "touch" : "key"].state === "unknown") {
      await assert.rejects(profile.close(), error => error instanceof RuntimeCustodyUncertainError
        && error.errors.some(cause => cause instanceof AggregateError && cause.message === "profile-onboarding-custody-unproved"));
    } else await profile.close();
  } catch (error) { failure = failure === undefined ? error : new AggregateError([failure, error], "enrollment fixture and profile cleanup failed"); }
  try { await context?.close(); }
  catch (error) { failure = failure === undefined ? error : new AggregateError([failure, error], "enrollment fixture and browser cleanup failed"); }
  try { machine.release(); }
  catch (error) { failure = failure === undefined ? error : new AggregateError([failure, error], "enrollment fixture and admission cleanup failed"); }
  if (failure !== undefined) throw new Error("enrollment fixture failed", { cause: failure });
});
