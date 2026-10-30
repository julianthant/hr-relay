import { runtimeLifetimeLock } from "../../support/helpers/backend/runtime-lifetime.js";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";
import type { BrowserContext } from "playwright";
import { it } from "vitest";
import { z } from "zod";
import { createProfileOnboardingDuoProvider } from "../../../src/backend/profiles/onboarding-duo-provider.js";
import type { DraftDuoBrowserOwner } from "../../../src/backend/profiles/onboarding-duo.js";
import { systemClock } from "../../../src/rules/time/clock.js";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { composeProfileRuntime } from "../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";

const SSO = "https://a5.ucsd.edu/tritON/profile/SAML2/Redirect/SSO";
const FORM = `<!doctype html><form action="${SSO}" method="post"><label for="ssousername">Username</label><input id="ssousername" name="username"><label for="ssopassword">Password</label><input id="ssopassword" name="password" type="password"><button name="_eventId_proceed">Sign in</button></form>`;

for (const pendingClose of [false, true]) it(pendingClose
  ? "real synthetic MV3 pending software-key attempt retains UNKNOWN across whole-window closure and reopen"
  : "real Relay UI and private draft log in once in a separate same-window Duo tab and keep method attempts separate", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "onboarding-launch-")));
  const browserRoot = join(root, "browsers"); mkdirSync(browserRoot, { mode: 0o700 });
  for (const file of ["package.json", "package-lock.json"]) copyFileSync(file, join(root, file));
  const lifetime = await runtimeLifetimeLock();
  const machine = acquireEntrypointAdmission(root, "exclusive", lifetime);
  const processLockRoot = join(root, rebuildRuntimeIsolation.processLockRoot); mkdirSync(processLockRoot, { recursive: true, mode: 0o700 });
  let context: BrowserContext | undefined, launches = 0, acquisitions = 0, submissions = 0;
  let owner: DraftDuoBrowserOwner | undefined;
  const provider = createProfileOnboardingDuoProvider({ browserRoot, extensionDirectory: realpathSync(join(process.cwd(), "fast-duo")), clock: systemClock, closeProofMs: 5000,
    launcher: { async launch(input) {
      launches++; assert.equal(input.headless, false);
      context = await chromium.launchPersistentContext(input.profileDirectory, { channel: "chromium", headless: false,
        args: [`--disable-extensions-except=${input.extensionDirectory}`, `--load-extension=${input.extensionDirectory}`] });
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
    let setup = context.pages()[0]; assert.ok(setup);
    assert.match(setup.url(), /^chrome-extension:\/\/[^/]+\/src\/options\.html$/);
    await expect(setup.locator("#globalStatus")).toHaveText("Sign-in methods not started");
    await expect(setup.getByRole("heading", { name: "Relay sign-in methods", exact: true })).toBeVisible();
    await expect(setup.locator(".brand small")).toHaveText("Relay sign-in setup");
    await expect(setup.locator("footer > span:last-child")).toHaveText("Private Relay sign-in methods.");
    await expect(setup.locator("#connection h3")).toHaveText("Set up a sign-in method");
    await expect(setup.locator("#connection > p").first()).toContainText("same window");
    await profile.session.showOnboardingBrowser(draft.token, draft.operationId); assert.equal(launches, 1);
    await setup.getByRole("button", { name: "Open duo.ucpath.edu", exact: true }).click();
    await expect(setup.locator("#openLogin")).toBeEnabled();
    assert.equal(context.pages().length, 2);
    const portal = context.pages().find(page => page !== setup); assert.ok(portal);
    const worker = context.serviceWorkers()[0]; assert.ok(worker);
    const windows = z.array(z.number().int()).parse(await worker.evaluate("chrome.windows.getAll().then(windows => windows.map(window => window.id))"));
    const tabWindows = z.array(z.number().int()).parse(await worker.evaluate("chrome.tabs.query({}).then(tabs => tabs.map(tab => tab.windowId))"));
    assert.equal(windows.length, 1); assert.equal(tabWindows.length, 2); assert.ok(tabWindows.every(id => id === windows[0]));
    await expect(portal.getByRole("heading", { name: "Awaiting native MFA" })).toBeVisible();
    assert.equal(portal.url(), SSO); assert.equal(acquisitions, 1); assert.equal(submissions, 1); assert.equal(read().methods.key.state, "idle");
    await profile.session.openOnboardingPortal(draft.token, draft.operationId); assert.equal(context.pages().length, 2); assert.equal(acquisitions, 1);
    for (const [method, value] of [["key", "usb"], ["touch", "internal"]] as const) {
      await setup.locator("#transport").selectOption(value);
      await setup.getByRole("button", { name: "Set up selected method", exact: true }).click();
      await expect(setup.locator("#cancelCapture")).toBeEnabled();
      assert.equal(read().methods[method].state, "pending");
      await setup.getByRole("button", { name: "Cancel capture", exact: true }).click();
      await expect(setup.locator("#transport")).toBeEnabled();
      assert.equal(read().methods[method].state, "idle");
    }
    assert.equal(launches, 1); assert.equal(submissions, 1);
    await context.route("https://foreign.invalid/**", route => route.fulfill({ contentType: "text/html", body: "Foreign page" }));
    await portal.goto("https://foreign.invalid/");
    await assert.rejects(profile.session.openOnboardingPortal(draft.token, draft.operationId));
    assert.equal(submissions, 1); assert.equal(acquisitions, 1); assert.equal(context.pages().length, 2);
    await setup.getByRole("button", { name: "Open duo.ucpath.edu", exact: true }).click();
    await expect(setup.locator("#message")).toContainText("Duo could not complete this setup action");
    await setup.evaluate(() => new Promise<void>(resolve => {
      const list = document.getElementById("accountList"); if (!list) throw new Error("fixture method list missing");
      const observer = new MutationObserver(() => { observer.disconnect(); resolve(); });
      observer.observe(list, { childList: true });
    }));
    await expect(setup.locator("#message")).toContainText("Duo could not complete this setup action");
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
      await setup.locator("#transport").selectOption("usb");
      await setup.getByRole("button", { name: "Set up selected method", exact: true }).click();
      await expect(setup.locator("#cancelCapture")).toBeEnabled();
      assert.equal(read().methods.key.state, "pending");
      await context.route("https://synthetic.duosecurity.com/**", route => route.fulfill({ contentType: "text/html",
        body: "<!doctype html><body>Signed in as: synthetic-user@ucsd.edu</body>" }));
      const capture = await context.newPage();
      await capture.goto("https://synthetic.duosecurity.com/");
      await capture.evaluate(async () => {
        const credential = await navigator.credentials.create({ publicKey: {
          challenge: new TextEncoder().encode("synthetic-pending-close"), rp: { id: "duosecurity.com", name: "Synthetic Duo" },
          user: { id: new TextEncoder().encode("synthetic-user"), name: "synthetic-user@ucsd.edu", displayName: "Synthetic Operator" },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
          authenticatorSelection: { authenticatorAttachment: "cross-platform", userVerification: "discouraged" },
        } });
        if (!credential) throw new Error("synthetic software credential absent");
      });
      const captured = read().methods.key;
      assert.equal(captured.state, "pending"); assert.equal(captured.ceremonyObserved, true);
      assert.equal(captured.portalAccepted, false); assert.equal(captured.operatorConfirmed, false);
      assert.equal(captured.exactCredentialRequestObserved, false);
      await context.close();
      await profile.session.showOnboardingBrowser(draft.token, draft.operationId);
      assert.equal(launches, 3); assert.equal(context.pages().length, 1);
      const retained = read().methods.key;
      assert.equal(retained.state, "unknown"); assert.equal(retained.attemptId, captured.attemptId);
      assert.equal(retained.ceremonyObserved, true); assert.equal(retained.portalAccepted, false);
      assert.equal(retained.operatorConfirmed, false); assert.equal(retained.exactCredentialRequestObserved, false);
      assert.equal(read().methods.touch.state, "idle"); assert.equal(acquisitions, 1); assert.equal(submissions, 1);
      await expect(context.pages()[0].locator("#accountList")).toContainText("Failed");
      await assert.rejects(profile.session.cancelOnboarding(draft.token, draft.operationId));
      assert.equal(machine.readProfileRegistry().profiles.length, 0);
    } else {
      assert.deepEqual(await profile.session.cancelOnboarding(draft.token, draft.operationId), { state: "signed-out" });
      assert.ok(owner); const stale = owner; assert.throws(() => stale.assertCurrent()); await assert.rejects(stale.acquireCredentials());
      assert.equal(machine.readProfileRegistry().profiles.length, 0);
    }
  } catch (error) { failure = error; }
  try { await profile.close(); }
  catch (error) { failure = failure === undefined ? error : new AggregateError([failure, error], "onboarding fixture and cleanup failed"); }
  try { await context?.close(); }
  catch (error) { failure = failure === undefined ? error : new AggregateError([failure, error], "onboarding browser cleanup failed"); }
  try { machine.release(); }
  catch (error) { failure = failure === undefined ? error : new AggregateError([failure, error], "onboarding admission cleanup failed"); }
  if (failure !== undefined) throw new Error("onboarding fixture failed", { cause: failure });
});
