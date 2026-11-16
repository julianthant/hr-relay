import { AuthoritySourceClosureUnprovedError, createBrowserSourceRecovery } from "../../../../src/backend/storage/source-closure.js";
import { composeDashboardApplication } from "../../../../src/backend/app/composition/dashboard/compose.js";
import { PublicProfileStateSchema } from "../../../../src/models/profiles/public-profile.js";
import { createDuoBrowserFocus } from "../../../../src/backend/runtime/browser/native-browser-focus.js";
import { stageFastDuoExtension } from "../../../../src/backend/runtime/browser/fast-duo-extension.js";
import { PROFILE_ENROLLMENT_EXTENSION_MODE } from "../../../../src/models/config/duo-credential-store.js";
import { createBrowserRoots } from "../../../../src/backend/storage/browser-roots.js";
import { DEFAULT_BROWSER_LAUNCHER, type OwnedBrowserProcess } from "../../../../src/backend/runtime/browser/native-browser.js";
import { runtimeLifetimeLock } from "../../../support/helpers/backend/runtime-lifetime.js";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { chromium, type BrowserContext } from "playwright";
import { it } from "vitest";
import { z } from "zod";
import { createProfileOnboardingDuoProvider, ProfileOnboardingDuoProviderError } from "../../../../src/backend/runtime/browser/onboarding-duo-provider.js";
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
  let context: BrowserContext | undefined, launches = 0, submissions = 0, nativeProbes = 0, nativeClosures = 0;
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
      await context.route("https://**/*", async route => {
        const request = route.request();
        if (request.url().startsWith("chrome-extension://")) await route.continue();
        else if (request.method() === "POST" && request.url() === SSO) { submissions++; await route.abort(); }
        else if (request.url() === "https://duo.ucsd.edu/") await route.fulfill({ contentType: "text/html", body: `<script>location.replace(${JSON.stringify(SSO)})</script>` });
        else if (request.url() === "https://duo.ucsd.edu/devices") await route.fulfill({ contentType: "text/html", body: "<h1>Duo device management</h1>" });
        else if (request.url() === SSO) await route.fulfill({ contentType: "text/html", body: FORM });
        else await route.abort();
      });
      const focusWorker = context.serviceWorkers().find(worker => worker.url().endsWith("/src/relay-background.js"))
        ?? await context.waitForEvent("serviceworker", { predicate: worker => worker.url().endsWith("/src/relay-background.js"), timeout: 5000 });
      await focusWorker.evaluate("globalThis.relayFocusCalls = []; const originalWindowUpdate = chrome.windows.update.bind(chrome.windows); chrome.windows.update = async (windowId, options) => { relayFocusCalls.push({ windowId, focused: options.focused }); return originalWindowUpdate(windowId, options); };");
      await focusWorker.evaluate("globalThis.relayCreatedTabs = []; const createWindow = chrome.windows.create.bind(chrome.windows), createTab = chrome.tabs.create.bind(chrome.tabs); chrome.windows.create = async options => { const window = await createWindow(options); for (const tab of window.tabs) relayCreatedTabs.push({ id: tab.id, windowId: window.id }); return window; }; chrome.tabs.create = async options => { const tab = await createTab(options); relayCreatedTabs.push({ id: tab.id, windowId: tab.windowId }); return tab; };");
      return context;
    } },
  });
  const profile = composeProfileRuntime({ admission: machine,  hostFacts: { primaryDisplay: null }, clock: systemClock,
    onboardingDuo: { ...provider, async showBrowser(draft) {
      owner = draft;
      await provider.showBrowser(draft);
    } } });
  const draft = profile.session.signUp({ firstName: "Synthetic", lastName: "Operator", email: "synthetic-user@ucsd.edu", password: "synthetic-password", createdAt: systemClock.now().toISOString() });
  assert.equal(draft.state, "onboarding"); if (draft.state !== "onboarding") throw new Error("fixture draft required");
  const read = () => profile.session.readOnboarding(draft.token, draft.operationId);
  const finishManualSignIn = async (action: Promise<unknown>): Promise<void> => {
    await expect.poll(() => context?.pages().find(page => page.url() === SSO)).toBeTruthy();
    const form = context?.pages().find(page => page.url() === SSO);
    assert.ok(form);
    await expect(form.locator("#ssopassword")).toBeVisible();
    assert.equal(await form.locator("#ssousername").inputValue(), "");
    assert.equal(await form.locator("#ssopassword").inputValue(), "");
    assert.equal(submissions, 0);
    await form.waitForTimeout(200);
    await form.goto("https://duo.ucsd.edu/devices");
    await action;
  };
  let failure: unknown;
  try {
    await profile.session.showOnboardingBrowser(draft.token, draft.operationId);
    assert.ok(context);
    assert.equal(launches, 1); assert.equal(context.pages().length, 1); assert.equal(submissions, 0); assert.equal(read().methods.key.state, "idle");
    const focusWorker = context.serviceWorkers().find(worker => worker.url().endsWith("/src/relay-background.js")); assert.ok(focusWorker);
    const focusCalls = () => focusWorker.evaluate("globalThis.relayFocusCalls").then(value => z.array(z.strictObject({ windowId: z.number().int(), focused: z.literal(true) })).parse(value));
    assert.equal((await focusCalls()).length, 1);
    let setup = context.pages()[0]; assert.ok(setup);
    assert.match(setup.url(), /^chrome-extension:\/\/[^/]+\/src\/options\.html$/);
    await expect(setup.locator("#editorTitle")).toHaveText("Set up Security key");
    await expect(setup.getByRole("heading", { name: "Relay sign-in methods", exact: true })).toBeVisible();
    await expect(setup.locator(".brand small")).toHaveText("Relay sign-in setup");
    await expect(setup.locator("footer")).toHaveCount(0);
    await profile.session.showOnboardingBrowser(draft.token, draft.operationId); assert.equal(launches, 1);
    assert.equal((await focusCalls()).length, 2);
    await finishManualSignIn(setup.getByRole("button", { name: "Set up Security key", exact: true }).click());
    await expect(setup.getByRole("button", { name: "Show Duo", exact: true })).toBeEnabled();
    assert.equal(context.pages().length, 2);
    const portal = context.pages().find(page => page !== setup); assert.ok(portal);
    const worker = context.serviceWorkers().find(worker => worker.url().endsWith("/src/relay-background.js")); assert.ok(worker);
    const tabIdentity = z.object({ id: z.number().int(), windowId: z.number().int() });
    const windows = z.array(z.object({ id: z.number().int(), type: z.literal("normal"), tabs: z.array(tabIdentity) }))
      .parse(await worker.evaluate("chrome.windows.getAll({ populate: true })"));
    assert.equal(windows.length, 1); const window = windows[0]; assert.ok(window);
    assert.equal(window.tabs.length, 2); assert.ok(window.tabs.every(tab => tab.windowId === window.id));
    const createdTabs = z.array(tabIdentity).parse(await worker.evaluate("globalThis.relayCreatedTabs"));
    assert.equal(createdTabs.length, 2); assert.deepEqual(window.tabs, createdTabs);
    assert.equal(new Set(window.tabs.map(tab => tab.id)).size, 2);
    await expect(portal.getByRole("heading", { name: "Duo device management" })).toBeVisible();
    assert.equal(portal.url(), "https://duo.ucsd.edu/devices"); assert.equal(submissions, 0); assert.equal(read().methods.key.state, "pending");
    await profile.session.showOnboardingBrowser(draft.token, draft.operationId);
    assert.equal(await worker.evaluate("chrome.tabs.query({ active: true }).then(tabs => tabs[0].id)"), createdTabs[0].id);
    await setup.getByRole("button", { name: "Cancel setup", exact: true }).click();
    await expect(setup.getByRole("button", { name: "Set up Security key", exact: true })).toBeEnabled();
    assert.equal(read().methods.key.state, "idle");
    await context.route("https://duo.ucsd.edu/devices", route => route.fulfill({ contentType: "text/html", body: "<h1>Duo device management</h1>" }));
    await portal.goto("https://duo.ucsd.edu/devices");
    await profile.session.openOnboardingPortal(draft.token, draft.operationId); assert.equal(context.pages().length, 2);
    assert.equal(portal.url(), "https://duo.ucsd.edu/devices"); assert.equal(submissions, 0);
    await profile.session.showOnboardingBrowser(draft.token, draft.operationId);
    for (const method of ["key", "touch"] as const) {
      const label = method === "key" ? "Security key" : "Touch ID";
      await setup.locator(`.relay-method-card[data-method="${method}"]`).click();
      await setup.getByRole("button", { name: `Set up ${label}`, exact: true }).click();
      await expect(setup.getByRole("button", { name: "Cancel setup", exact: true })).toBeEnabled();
      assert.equal(read().methods[method].state, "pending");
      await profile.session.showOnboardingBrowser(draft.token, draft.operationId);
      await setup.getByRole("button", { name: "Cancel setup", exact: true }).click();
      await expect(setup.getByRole("button", { name: `Set up ${label}`, exact: true })).toBeEnabled();
      assert.equal(read().methods[method].state, "idle");
    }
    assert.equal(launches, 1); assert.equal(submissions, 0);
    await context.route("https://foreign.invalid/**", route => route.fulfill({ contentType: "text/html", body: "Foreign page" }));
    await portal.goto("https://foreign.invalid/");
    await assert.rejects(profile.session.openOnboardingPortal(draft.token, draft.operationId));
    assert.equal(submissions, 0); assert.equal(context.pages().length, 2);
    await setup.getByRole("button", { name: "Set up Touch ID", exact: true }).click();
    const portalFailure = "Relay could not trust this Duo page. Do not enter your password. Close the Duo tab, then try Show Duo again.";
    await expect(setup.locator("#message")).toHaveText(portalFailure);
    assert.equal(submissions, 0);
    await setup.evaluate(() => new Promise<void>(resolve => {
      const list = document.getElementById("accountList"); if (!list) throw new Error("fixture method list missing");
      const observer = new MutationObserver(() => { observer.disconnect(); resolve(); });
      observer.observe(list, { childList: true });
    }));
    await expect(setup.locator("#message")).toHaveText(portalFailure);
    await setup.getByRole("button", { name: "Cancel setup", exact: true }).click();
    await expect(setup.getByRole("button", { name: "Set up Touch ID", exact: true })).toBeEnabled();
    const methodsBeforeReopen = read().methods;
    await setup.close();
    await Promise.all([profile.session.showOnboardingBrowser(draft.token, draft.operationId), profile.session.showOnboardingBrowser(draft.token, draft.operationId)]);
    assert.equal(launches, 1); assert.equal(context.pages().length, 2);
    setup = context.pages().find(page => page !== portal)!; assert.ok(setup);
    await expect(setup.getByRole("heading", { name: "Relay sign-in methods", exact: true })).toBeVisible();
    assert.equal(submissions, 0); assert.deepEqual(read().methods, methodsBeforeReopen);
    await context.close();
    await profile.session.showOnboardingBrowser(draft.token, draft.operationId);
    assert.equal(launches, 2); assert.equal(context.pages().length, 1);
    assert.equal(submissions, 0); assert.deepEqual(read().methods, methodsBeforeReopen);
    await expect(context.pages()[0].getByRole("heading", { name: "Relay sign-in methods", exact: true })).toBeVisible();
    if (pendingClose) {
      setup = context.pages()[0];
      await setup.locator('.relay-method-card[data-method="key"]').click();
      await finishManualSignIn(setup.getByRole("button", { name: "Set up Security key", exact: true }).click());
      await expect(setup.getByRole("button", { name: "Cancel setup", exact: true })).toBeEnabled();
      assert.equal(read().methods.key.state, "pending");
      await context.route("https://synthetic.duosecurity.com/**", route => route.fulfill({ contentType: "text/html",
        body: "<!doctype html><body>Signed in as: synthetic-user@ucsd.edu</body>" }));
      const capture = context.pages().find(page => page !== setup); assert.ok(capture);
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
      assert.equal(read().methods.touch.state, "idle"); assert.equal(submissions, 0);
      await expect(context.pages()[0].locator("#accountList")).toContainText("Not confirmed");
      await profile.session.startOnboardingDuo(draft.token, draft.operationId, "touch");
      assert.equal(read().methods.touch.state, "pending");
      assert.equal(read().methods.key.state, "unknown"); assert.equal(read().methods.key.attemptId, captured.attemptId); assert.equal(launches, 3);
      assert.deepEqual(await profile.session.cancelOnboarding(draft.token, draft.operationId), { state: "signed-out" });
      assert.ok(owner); const stale = owner; assert.throws(() => stale.assertCurrent());
      assert.equal(machine.readProfileRegistry().profiles.length, 0);
    } else {
      assert.deepEqual(await profile.session.cancelOnboarding(draft.token, draft.operationId), { state: "signed-out" });
      assert.ok(owner); const stale = owner; assert.throws(() => stale.assertCurrent());
      assert.equal(machine.readProfileRegistry().profiles.length, 0);
    }
    assert.equal(launches, pendingClose ? 3 : 2); assert.equal(nativeProbes, launches);
    assert.equal(nativeClosures, nativeProbes); assert.equal(nativeContexts.size, 0);
  } catch (error) {
    failure = error;
    if (context && !context.isClosed()) failure = new Error(`onboarding native boundary: ${JSON.stringify({ submissions, pages: context.pages().map(page => page.url()) })}`, { cause: error });
  }
  try { await profile.close(); }
  catch (error) { failure = failure === undefined ? error : new AggregateError([failure, error], "onboarding fixture and cleanup failed"); }
  try { await context?.close(); }
  catch (error) { failure = failure === undefined ? error : new AggregateError([failure, error], "onboarding browser cleanup failed"); }
  try { machine.release(); }
  catch (error) { failure = failure === undefined ? error : new AggregateError([failure, error], "onboarding admission cleanup failed"); }
  if (failure !== undefined) throw new Error("onboarding fixture failed", { cause: failure });
});

for (const scenario of ["software", "abort", "timeout", "platform"] as const) it(`real enrollment bridge: ${scenario}`, async () => {
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
        body: scenario === "software" ? "<!doctype html><body>Signed in as: synthetic-enrollment@ucsd.edu</body>" : "<!doctype html><body>Duo device management</body>" }));
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
    if (scenario === "abort" || scenario === "timeout") {
      assert.equal(outcome.state, "failed");
      assert.equal(outcome.name, scenario === "abort" ? "AbortError" : "NotAllowedError");
      await expect.poll(() => SignUpOperationSchema.parse(JSON.parse(readFileSync(join(machine.stateRoot, "machine", "operations", `${draft.operationId}.json`), "utf8"))).onboarding?.attempts[0]?.failure)
        .toEqual({ kind: "refused", causeTag: scenario === "abort" ? "aborted" : "timed-out" });
      const failed = profile.session.readOnboarding(draft.token, draft.operationId).methods.key;
      assert.equal(failed.state, "idle");
      await profile.session.startOnboardingDuo(draft.token, draft.operationId, "key");
      const restarted = profile.session.readOnboarding(draft.token, draft.operationId).methods.key;
      assert.equal(restarted.state, "pending"); assert.notEqual(restarted.attemptId, failed.attemptId);
    } else {
      assert.deepEqual(outcome, { state: "created", attachment: scenario === "platform" ? "platform" : "cross-platform" });
      const state = profile.session.readOnboarding(draft.token, draft.operationId).methods[method];
      assert.equal(state.state, "pending"); assert.equal(state.ceremonyObserved, true); assert.equal(state.operatorConfirmed, false);
      await page.evaluate(heading => { const element = document.createElement("h2"); element.textContent = heading; document.body.append(element); },
        scenario === "platform" ? "Added Touch ID (Chrome)" : "Added security key");
      await expect.poll(() => profile.session.readOnboarding(draft.token, draft.operationId).methods[method].state).toBe("complete");
      const done = profile.session.readOnboarding(draft.token, draft.operationId).methods[method];
      assert.equal(done.portalAccepted, true); assert.equal(done.operatorConfirmed, false);
    }
    const debugAdmission = machine.admitProfile(draft.profileId);
    try {
      AuthorityDatabase.withProfileOnboardingTimeline(debugAdmission, systemClock, repository => {
        const events = repository.page({ after: 0, through: repository.highWaterMark(), limit: 500 });
        const reasons = events.flatMap(entry => entry.payload.kind === "debug" && entry.payload.event.category === "duo" ? [entry.payload.event.reason] : []);
        assert.ok(reasons.includes("intercepted"));
        if (scenario === "software" || scenario === "platform") {
          for (const reason of ["forwarded", "backend-received", "replied"]) assert.ok(reasons.includes(reason), reason);
        } else assert.ok(reasons.includes(scenario === "abort" ? "aborted" : "timed-out"));
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

it("measures, centers and clamps the exact native setup normal window and executes owned app focus", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "duo-popup-bounds-"))), extensionDirectory = join(root, "extension");
  stageFastDuoExtension(realpathSync("fast-duo"), extensionDirectory, PROFILE_ENROLLMENT_EXTENSION_MODE);
  const focus = createDuoBrowserFocus(5000);
  // Relay's own window is frontmost when it opens setup; a headed stand-in owned by this test plays that window on any desktop.
  const relayBrowser = await chromium.launch({ headless: false });
  let process: OwnedBrowserProcess | undefined;
  try {
  const relayContext = await relayBrowser.newContext(), relayPage = await relayContext.newPage();
  await focus.show(relayContext, relayPage);
  const relay = await focus.captureRelay(); assert.ok(relay?.workArea);
  const context = await DEFAULT_BROWSER_LAUNCHER.launch({ profileDirectory: root, extensionDirectory, headless: false, acceptDownloads: false,
    downloadsPath: root, viewport: { width: 640, height: 720 }, timeoutMs: 5000, ownedProcess: owned => { process = owned; } });
  try {
    const worker = context.serviceWorkers().find(worker => worker.url().endsWith("/src/relay-background.js"))
      ?? await context.waitForEvent("serviceworker", { predicate: worker => worker.url().endsWith("/src/relay-background.js"), timeout: 5000 });
    const target = z.object({ tabId: z.number(), windowId: z.number(), url: z.string() }).parse(await worker.evaluate(`globalThis.relayOnboarding.browserInstall(crypto.randomUUID())`));
    await expect.poll(() => context.pages().some(page => page.url() === target.url)).toBe(true);
    const page = context.pages().find(page => page.url() === target.url); assert.ok(page);
    const idle = { state: "idle", ceremonyObserved: false, portalAccepted: false, operatorConfirmed: false, exactCredentialRequestObserved: false };
    const initial = { methods: { key: idle, touch: idle } };
    const reply = worker.evaluate(async initial => {
      const owner: unknown = Reflect.get(globalThis, "relayOnboarding");
      if (typeof owner !== "object" || owner === null) throw new Error("fixture broker required");
      const next: unknown = Reflect.get(owner, "browserNext"), respond: unknown = Reflect.get(owner, "browserReply");
      if (typeof next !== "function" || typeof respond !== "function") throw new Error("fixture broker API required");
      const request: unknown = await Reflect.apply(next, owner, []);
      if (typeof request !== "object" || request === null || Reflect.get(request, "kind") !== "state") throw new Error("fixture state request required");
      Reflect.apply(respond, owner, [Reflect.get(request, "id"), { ok: true, value: initial }]);
    }, initial);
    await page.goto(new URL("options.html", worker.url()).href, { waitUntil: "domcontentloaded", timeout: 5000 }); await reply;
    await worker.evaluate(`globalThis.relayOnboarding.browserSelect(${target.tabId}, ${target.windowId})`);
    await worker.evaluate(`globalThis.relayOnboarding.browserFocus()`);
    await focus.show(context, page);
    const frame = await page.evaluate(() => ({ width: window.outerWidth - window.innerWidth, height: window.outerHeight - window.innerHeight }));
    const area = relay.workArea;
    const resized = z.object({ left: z.number(), top: z.number(), width: z.number(), height: z.number() }).parse(await worker.evaluate(
      `globalThis.relayOnboarding.browserBounds(${JSON.stringify(area)}, ${JSON.stringify(frame)})`));
    assert.ok(resized.width > frame.width && resized.width <= area.width);
    assert.ok(resized.height > frame.height && resized.height <= area.height);
    assert.equal(resized.left, area.left + Math.floor((area.width - resized.width) / 2));
    assert.equal(resized.top, area.top + Math.floor((area.height - resized.height) / 2));
    const actual = z.object({ id: z.number(), left: z.number(), top: z.number(), width: z.number(), height: z.number() }).parse(await worker.evaluate(`chrome.windows.get(${target.windowId})`));
    assert.deepEqual(actual, { id: target.windowId, ...resized });
    const content = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    assert.deepEqual(content, { width: resized.width - frame.width, height: resized.height - frame.height });
    await focus.returnToRelay(relay);
    await focus.show(context, page);
  } finally { assert.ok(process); await process.stop(5000, true); assert.equal(process.exited(), true); }
  } finally { await relayBrowser.close(); }
});

for (const expire of [false, true]) it(`real public Reopen proves owned stop, native retry and exact request custody (expired=${expire})`, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "duo-public-reopen-")));
  for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(root, name));
  const lifetime = await runtimeLifetimeLock(), machine = acquireEntrypointAdmission(root, "exclusive", lifetime);
  const browserRoot = join(machine.stateRoot, "browsers", "onboarding"); mkdirSync(browserRoot, { recursive: true, mode: 0o700 });
  mkdirSync(join(root, rebuildRuntimeIsolation.processLockRoot), { recursive: true, mode: 0o700 });
  const roots = createBrowserRoots(machine), processes: { process: OwnedBrowserProcess; native: boolean }[] = [];
  let stopRefused = false, nativeCloseRefused = false, holdNative = false, mainLaunches = 0, nativeLaunches = 0;
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let lateDone: ReturnType<typeof Promise.withResolvers<void>> | undefined;
  const provider = createProfileOnboardingDuoProvider({ browserRoots: { ...roots, async withUnused(directory, probe, body, owner) {
    try { return await roots.withUnused(directory, probe, body, owner); } finally { lateDone?.resolve(); }
  } }, browserRoot, extensionDirectory: realpathSync("fast-duo"), clock: systemClock, closeProofMs: 5000,
    focus: { async captureRelay() { return undefined; }, async show() {}, async returnToRelay() { throw new Error("unexpected native return"); } },
    launcher: { async launch(input) {
      const native = input.nativeOnly === true;
      const context = await DEFAULT_BROWSER_LAUNCHER.launch({ ...input, headless: true, ownedProcess: process => {
        processes.push({ process, native });
        input.ownedProcess?.({ exited: () => process.exited(), onExit: callback => process.onExit(callback), async stop(timeout, graceful) {
          if (!native && stopRefused || native && nativeCloseRefused && graceful) throw new Error("synthetic owned stop refused");
          await process.stop(timeout, graceful);
        } });
      } });
      if (native) { nativeLaunches++; if (holdNative) { entered.resolve(); await release.promise; } }
      else { mainLaunches++; await context.route("https://**/*", route => route.abort()); }
      return context;
    } },
  });
  const runtime = await composeDashboardApplication({ admission: machine, lifetimeLock: lifetime, isolation: rebuildRuntimeIsolation,
    backendPortOverride: 0, frontendPortOverride: 0, env: {}, onboardingDuo: provider });
  const base = `http://127.0.0.1:${runtime.port}`;
  let cookie: string | undefined, failure: unknown;
  const post = (path: string, body: unknown, session = cookie) => fetch(`${base}/api/v1/profile/${path}`, { method: "POST", headers: {
    origin: base, "content-type": "application/json", ...(session === undefined ? {} : { cookie: session }) }, body: JSON.stringify(body) });
  try {
    const signup = await post("sign-up", { firstName: "Synthetic", lastName: "Reopen", email: "synthetic-reopen@ucsd.edu", password: "synthetic-reopen-password" });
    const draft = PublicProfileStateSchema.parse(await signup.json()); assert.equal(draft.state, "onboarding"); if (draft.state !== "onboarding") throw new Error("draft required");
    cookie = signup.headers.get("set-cookie")?.split(";", 1)[0]; assert.ok(cookie);
    const shown = PublicProfileStateSchema.parse(await (await post("onboarding/duo/browser", { operationId: draft.operationId })).json());
    assert.equal(shown.state, "onboarding"); if (shown.state !== "onboarding") throw new Error("open draft required");
    const request = { operationId: draft.operationId, generation: shown.browser.generation };
    const operationPath = join(machine.stateRoot, "machine", "operations", `${draft.operationId}.json`), before = readFileSync(operationPath);
    const reopen = () => post("onboarding/duo/reopen", request);
    assert.equal((await post("onboarding/duo/reopen", { ...request, generation: request.generation - 1 })).status, 409);
    assert.equal(mainLaunches, 1); assert.equal(nativeLaunches, 0);
    stopRefused = true;
    const stopped = await reopen(); assert.equal(stopped.status, 409); assert.deepEqual(await stopped.json(), { state: "refused", code: "DUO_SETUP_STOP_FAILED" });
    assert.equal(processes[0]?.process.exited(), false);
    for (const action of ["duo/browser", "duo/portal", "duo/start", "cancel", "complete"]) {
      const refused = await post(`onboarding/${action}`, { operationId: draft.operationId, ...(action === "duo/start" ? { method: "key" } : {}) });
      assert.equal(refused.status, 409); assert.deepEqual(await refused.json(), { state: "refused", code: "BROWSER_CLOSURE_UNPROVED" });
    }
    assert.deepEqual(readFileSync(operationPath), before); assert.equal(mainLaunches, 1); assert.equal(nativeLaunches, 0);
    stopRefused = false; nativeCloseRefused = true;
    const files = await reopen(); assert.equal(files.status, 409); assert.deepEqual(await files.json(), { state: "refused", code: "DUO_SETUP_FILES_BUSY" });
    assert.equal(processes[0]?.process.exited(), true); assert.equal(processes[1]?.process.exited(), false);
    assert.equal(mainLaunches, 1); assert.equal(nativeLaunches, 1);
    assert.equal((await post("onboarding/duo/reopen", request, "relay-profile-onboarding=foreign")).status, 409);
    assert.equal(processes[1]?.process.exited(), false, "a foreign request cannot stop the retained probe");
    nativeCloseRefused = false;
    if (expire) {
      holdNative = true; lateDone = Promise.withResolvers<void>();
      const first = reopen(), duplicate = reopen(); await entered.promise;
      const directory = roots.signupRoot({ profileId: draft.profileId, profileRoot: browserRoot, credentialFingerprint: null,
        owner: { kind: "signup", operationId: draft.operationId, accountId: SignUpOperationSchema.parse(JSON.parse(before.toString())).onboarding!.accountId, providerGeneration: 1 } })?.profileDirectory;
      assert.ok(directory);
      for (const response of await Promise.all([first, duplicate])) { assert.equal(response.status, 409); assert.deepEqual(await response.json(), { state: "refused", code: "DUO_SETUP_FILES_BUSY" }); }
      assert.equal(mainLaunches, 1); assert.equal(nativeLaunches, 2); assert.deepEqual(readFileSync(operationPath), before);
      holdNative = false; release.resolve(); await lateDone.promise;
      assert.equal(realpathSync(directory), directory, "late native closure cannot remove the old profile after its request expired");
      assert.deepEqual(readFileSync(operationPath), before);
    }
    const [first, duplicate] = await Promise.all([reopen(), reopen()]);
    assert.equal(first.status, 200); assert.equal(duplicate.status, 200);
    const fresh = PublicProfileStateSchema.parse(await first.json()); assert.equal(fresh.state, "onboarding"); if (fresh.state !== "onboarding") throw new Error("fresh draft required");
    assert.equal(fresh.browser.generation, request.generation + 1); assert.equal(mainLaunches, 2);
    assert.equal((await reopen()).status, 409, "stale generation cannot stop the fresh child");
    assert.equal(processes.filter(entry => !entry.native).at(-1)?.process.exited(), false);
    const cancelled = await post("onboarding/cancel", { operationId: draft.operationId }); assert.equal(cancelled.status, 200);
    assert.deepEqual(await cancelled.json(), { state: "signed-out" }); assert.ok(processes.every(entry => entry.process.exited()));
    assert.deepEqual(machine.readProfileRegistry().profiles, []);
  } catch (error) { failure = error; }
  finally {
    release.resolve();
    for (const entry of processes) try { await entry.process.stop(5000); } catch (error) { failure = failure === undefined ? error : new AggregateError([failure, error]); }
    try { await runtime.stop(); machine.release(); } catch (error) { failure = failure === undefined ? error : new AggregateError([failure, error]); }
  }
  if (failure !== undefined) throw failure instanceof Error ? failure : new Error("native-public-reopen-failed", { cause: failure });
});

for (const phase of ["prelaunch", "clean-setup", "unproved-setup", "foreign"] as const) it(`real public Cancel after old Unknown recovery and failed replacement: ${phase}`, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "duo-failed-replacement-")));
  for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(root, name));
  const lifetime = await runtimeLifetimeLock(), machine = acquireEntrypointAdmission(root, "exclusive", lifetime);
  const browserRoot = join(machine.stateRoot, "browsers", "onboarding"); mkdirSync(browserRoot, { recursive: true, mode: 0o700 });
  mkdirSync(join(root, rebuildRuntimeIsolation.processLockRoot), { recursive: true, mode: 0o700 });
  const processes: { process: OwnedBrowserProcess; native: boolean }[] = [], foreign = new AuthoritySourceClosureUnprovedError([new Error("controlled foreign source")]);
  const foreignProof = createBrowserSourceRecovery(); foreignProof.retain(foreign);
  let failReplacement = false, failCapture = false, nativeCloseRefused = false, mainLaunches = 0, nativeLaunches = 0;
  const original = new Error("controlled replacement target observation failure");
  const provider = createProfileOnboardingDuoProvider({ browserRoots: createBrowserRoots(machine), browserRoot,
    extensionDirectory: realpathSync("fast-duo"), clock: systemClock, closeProofMs: 5000,
    focus: { async captureRelay() { if (failCapture) throw original; return undefined; }, async show() {}, async returnToRelay() { throw new Error("unexpected Return"); } },
    launcher: { async launch(input) {
      const native = input.nativeOnly === true;
      const context = await DEFAULT_BROWSER_LAUNCHER.launch({ ...input, headless: true, ownedProcess: process => {
        processes.push({ process, native });
        input.ownedProcess?.({ exited: () => process.exited(), onExit: callback => process.onExit(callback), async stop(timeout, graceful) {
          if (native && nativeCloseRefused && graceful) throw new Error("controlled replacement native stop refused");
          await process.stop(timeout, graceful);
        } });
      } });
      if (native) nativeLaunches++;
      else {
        mainLaunches++; await context.route("https://**/*", route => route.abort());
        if (failReplacement) {
          nativeCloseRefused = phase === "unproved-setup";
          const worker = context.serviceWorkers().find(worker => worker.url().endsWith("/src/relay-background.js"))
            ?? await context.waitForEvent("serviceworker", { predicate: worker => worker.url().endsWith("/src/relay-background.js"), timeout: 5000 });
          await worker.evaluate(() => {
            const owner: unknown = Reflect.get(globalThis, "relayOnboarding");
            if (typeof owner !== "object" || owner === null) throw new Error("fixture broker required");
            Reflect.set(globalThis, "relayOnboarding", { ...owner, browserInstall() { throw new Error("controlled replacement setup failure"); } });
          });
        }
      }
      return context;
    } },
  });
  const runtime = await composeDashboardApplication({ admission: machine, lifetimeLock: lifetime, isolation: rebuildRuntimeIsolation,
    backendPortOverride: 0, frontendPortOverride: 0, env: {}, onboardingDuo: { ...provider,
      async start(_attempt, _bind, report) { await report(new ProfileOnboardingDuoProviderError("unknown", "worker", phase === "foreign" ? foreign : undefined)); },
    } });
  const base = `http://127.0.0.1:${runtime.port}`;
  let cookie: string | undefined, failure: unknown;
  const post = (path: string, body: unknown, session = cookie) => fetch(`${base}/api/v1/profile/${path}`, { method: "POST", headers: {
    origin: base, "content-type": "application/json", ...(session === undefined ? {} : { cookie: session }) }, body: JSON.stringify(body) });
  try {
    const signup = await post("sign-up", { firstName: "Synthetic", lastName: "Recovery", email: "synthetic-recovery@ucsd.edu", password: "synthetic-recovery-password" });
    const draft = PublicProfileStateSchema.parse(await signup.json()); assert.equal(draft.state, "onboarding"); if (draft.state !== "onboarding") throw new Error("draft required");
    cookie = signup.headers.get("set-cookie")?.split(";", 1)[0]; assert.ok(cookie);
    const call = (action: string, extra = {}) => post(`onboarding/${action}`, { operationId: draft.operationId, ...extra });
    assert.equal((await call("duo/start", { method: "touch" })).status, 200);
    const operationPath = join(machine.stateRoot, "machine", "operations", `${draft.operationId}.json`);
    const readOperation = () => SignUpOperationSchema.parse(JSON.parse(readFileSync(operationPath, "utf8")));
    const old = readOperation().onboarding?.attempts[0]; assert.ok(old); assert.equal(old.state, "unknown");
    const state = PublicProfileStateSchema.parse(await (await fetch(`${base}/api/v1/profile/state`, { headers: { cookie } })).json());
    assert.equal(state.state, "onboarding"); if (state.state !== "onboarding") throw new Error("current draft required");
    const request = { operationId: draft.operationId, generation: state.browser.generation };
    failCapture = phase === "prelaunch" || phase === "foreign"; failReplacement = !failCapture;
    const reopened = await post("onboarding/duo/reopen", request); assert.equal(reopened.status, 409);
    assert.deepEqual(await reopened.json(), { state: "refused", code: phase === "unproved-setup" ? "BROWSER_CLOSURE_UNPROVED" : "DUO_SETUP_OPEN_FAILED" });
    assert.ok(processes[0]?.process.exited()); assert.ok(nativeLaunches >= 1);
    const retained = readOperation().onboarding?.attempts[0]; assert.ok(retained);
    assert.equal(retained.attemptId, old.attemptId); assert.equal(retained.state, "unknown"); assert.deepEqual(retained.failure, old.failure);
    assert.equal(readOperation().onboarding?.abort, undefined); assert.equal(readOperation().onboarding?.finish, undefined);
    if (phase === "unproved-setup" || phase === "foreign") {
      const held = readFileSync(operationPath);
      const refused = await call("cancel"); assert.equal(refused.status, 409); assert.deepEqual(await refused.json(), { state: "refused", code: "BROWSER_CLOSURE_UNPROVED" });
      assert.equal((await call("complete")).status, 409); assert.deepEqual(readFileSync(operationPath), held);
      assert.deepEqual(machine.readProfileRegistry().profiles, []);
      if (phase === "foreign") await foreignProof.prove(async () => {});
      else {
        nativeCloseRefused = false; failReplacement = false; failCapture = true;
        const current = provider.browserState?.(draft.operationId); assert.ok(current);
        const failedOpen = await post("onboarding/duo/reopen", { ...request, generation: current.generation });
        assert.equal(failedOpen.status, 409); assert.deepEqual(await failedOpen.json(), { state: "refused", code: "DUO_SETUP_OPEN_FAILED" });
      }
    }
    const launches = mainLaunches;
    const cancelled = await call("cancel"); assert.equal(cancelled.status, 200); assert.deepEqual(await cancelled.json(), { state: "signed-out" });
    assert.ok(retained.providerClosedAt, "old closure was recorded before Cancel, independently of replacement opening");
    assert.equal(mainLaunches, launches); assert.equal(mainLaunches, phase === "prelaunch" || phase === "foreign" ? 1 : 2);
    assert.ok(processes.every(entry => entry.process.exited())); assert.deepEqual(machine.readProfileRegistry().profiles, []);
  } catch (error) { failure = error; }
  finally {
    for (const entry of processes) try { await entry.process.stop(5000); } catch (error) { failure = failure === undefined ? error : new AggregateError([failure, error]); }
    try { await runtime.stop(); machine.release(); } catch (error) { failure = failure === undefined ? error : new AggregateError([failure, error]); }
  }
  if (failure !== undefined) throw failure instanceof Error ? failure : new Error("native-failed-replacement-control", { cause: failure });
});
