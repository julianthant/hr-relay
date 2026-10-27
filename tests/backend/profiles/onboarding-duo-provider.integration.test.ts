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

it("real Relay UI and private draft log in once in a separate same-window Duo tab and keep method attempts separate", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "onboarding-launch-")));
  const browserRoot = join(root, "browsers"); mkdirSync(browserRoot, { mode: 0o700 });
  for (const file of ["package.json", "package-lock.json"]) copyFileSync(file, join(root, file));
  const machine = acquireEntrypointAdmission(root, "exclusive");
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
  const profile = composeProfileRuntime({ admission: machine, processLockRoot, hostFacts: { primaryDisplay: null }, clock: systemClock,
    onboardingDuo: { ...provider, async showBrowser(draft) {
      owner = draft;
      await provider.showBrowser({ ...draft, async acquireCredentials() { acquisitions++; return draft.acquireCredentials(); } });
    } } });
  const draft = profile.session.signUp({ firstName: "Synthetic", lastName: "Operator", email: "synthetic-user@ucsd.edu", password: "synthetic-password", createdAt: systemClock.now().toISOString() });
  assert.equal(draft.state, "onboarding"); if (draft.state !== "onboarding") throw new Error("fixture draft required");
  const read = () => profile.session.readOnboarding(draft.token, draft.operationId);
  try {
    await profile.session.showOnboardingBrowser(draft.token, draft.operationId);
    assert.ok(context);
    assert.equal(launches, 1); assert.equal(context.pages().length, 1); assert.equal(acquisitions, 0); assert.equal(read().methods.key.state, "idle");
    const setup = context.pages()[0]; assert.ok(setup);
    assert.match(setup.url(), /^chrome-extension:\/\/[^/]+\/src\/options\.html$/);
    await expect(setup.locator("#globalStatus")).toHaveText("Duo setup in progress");
    await profile.session.showOnboardingBrowser(draft.token, draft.operationId); assert.equal(launches, 1);
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
    await profile.session.openOnboardingPortal(draft.token, draft.operationId); assert.equal(context.pages().length, 2); assert.equal(acquisitions, 1);
    for (const [method, value] of [["key", "usb"], ["touch", "internal"]] as const) {
      await setup.locator("#transport").selectOption(value);
      await setup.getByRole("button", { name: "Start capture", exact: true }).click();
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
    assert.deepEqual(await profile.session.cancelOnboarding(draft.token, draft.operationId), { state: "signed-out" });
    assert.ok(owner); const stale = owner; assert.throws(() => stale.assertCurrent()); await assert.rejects(stale.acquireCredentials());
    assert.equal(machine.readProfileRegistry().profiles.length, 0);
  } finally {
    try { await profile.close(); } finally { await context?.close(); machine.release(); }
  }
});
