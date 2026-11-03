import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";
import type { BrowserContext } from "playwright";
import { it } from "vitest";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { createBrowserRoots } from "../../../../src/backend/storage/browser-roots.js";
import { composeProfileRuntime } from "../../../../src/backend/app/composition/storage-compose.js";
import { createProfileOnboardingDuoProvider } from "../../../../src/backend/runtime/browser/onboarding-duo-provider.js";
import { DEFAULT_BROWSER_LAUNCHER } from "../../../../src/backend/runtime/browser/native-browser.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { runtimeLifetimeLock } from "../../../support/helpers/backend/runtime-lifetime.js";

for (const scenario of ["software", "abort", "timeout", "platform"] as const) it(`real enrollment bridge: ${scenario}`, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "duo-enrollment-")));
  for (const file of ["package.json", "package-lock.json"]) copyFileSync(file, join(root, file));
  const machine = acquireEntrypointAdmission(root, "exclusive", await runtimeLifetimeLock());
  const browserRoot = join(machine.stateRoot, "browsers", "onboarding");
  mkdirSync(browserRoot, { recursive: true, mode: 0o700 });
  let context: BrowserContext | undefined;
  const provider = createProfileOnboardingDuoProvider({ browserRoots: createBrowserRoots(machine), browserRoot,
    extensionDirectory: realpathSync("fast-duo"), clock: systemClock, closeProofMs: 5000, platform: "linux",
    launcher: { async launch(input) {
      if (input.nativeOnly) return DEFAULT_BROWSER_LAUNCHER.launch(input);
      context = await chromium.launchPersistentContext(input.profileDirectory, { channel: "chromium", headless: true,
        args: [`--disable-extensions-except=${input.extensionDirectory}`, `--load-extension=${input.extensionDirectory}`] });
      await context.route("https://enrollment.duosecurity.com/**", route => route.fulfill({ contentType: "text/html",
        body: "<!doctype html><body>Signed in as: synthetic-enrollment@ucsd.edu</body>" }));
      return context;
    } },
  });
  const profile = composeProfileRuntime({ admission: machine, hostFacts: { primaryDisplay: null }, clock: systemClock, onboardingDuo: provider });
  const draft = profile.session.signUp({ firstName: "Synthetic", lastName: "Enrollment", email: "synthetic-enrollment@ucsd.edu",
    password: "synthetic-enrollment-password", createdAt: systemClock.now().toISOString() });
  assert.equal(draft.state, "onboarding");
  if (draft.state !== "onboarding") throw new Error("synthetic draft missing");
  try {
    await profile.session.showOnboardingBrowser(draft.token, draft.operationId);
    assert.ok(context);
    const page = await context.newPage();
    await page.goto("https://enrollment.duosecurity.com/");
    const method = scenario === "platform" ? "touch" : "key";
    await profile.session.startOnboardingDuo(draft.token, draft.operationId, method);
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
      await expect.poll(() => profile.session.readOnboarding(draft.token, draft.operationId).methods.key.state).toBe("unknown");
      await assert.rejects(profile.session.startOnboardingDuo(draft.token, draft.operationId, "key"));
    } else {
      assert.deepEqual(outcome, { state: "created", attachment: scenario === "platform" ? "platform" : "cross-platform" });
      const state = profile.session.readOnboarding(draft.token, draft.operationId).methods[method];
      assert.equal(state.state, "pending"); assert.equal(state.ceremonyObserved, true); assert.equal(state.operatorConfirmed, false);
    }
  } finally {
    try { await profile.close(); }
    finally { try { await context?.close(); } finally { machine.release(); } }
  }
});
