import assert from "node:assert/strict";
import { chromium, type BrowserContext } from "playwright";
import { it, vi } from "vitest";
import { DEFAULT_BROWSER_LAUNCHER } from "../../../../src/backend/runtime/browser/native-browser.js";
import { nativeSsoGuardKeys } from "../../../../src/backend/systems/browser-shared/ucsd-sso-guard.js";

it("uses bundled full Chromium for extension sessions and native closure probes", async () => {
  const addInitScript = vi.fn(async () => undefined);
  const context = { addInitScript } as unknown as BrowserContext;
  const launch = vi.spyOn(chromium, "launchPersistentContext").mockResolvedValue(context);
  try {
    for (const nativeOnly of [false, true]) {
      assert.equal(await DEFAULT_BROWSER_LAUNCHER.launch({ profileDirectory: "synthetic-profile", headless: nativeOnly,
        extensionDirectory: "synthetic-extension", acceptDownloads: false, downloadsPath: "synthetic-downloads",
        viewport: { width: 1100, height: 800 }, ...(nativeOnly ? { nativeOnly: true } : {}) }), context);
      const options = launch.mock.calls.at(-1)?.[1];
      assert.equal(addInitScript.mock.calls.length, nativeOnly ? 2 : 1);
      assert.ok(nativeSsoGuardKeys(context));
      assert.ok(options);
      assert.equal(options.channel, "chromium");
      assert.equal(options.headless, nativeOnly);
      assert.deepEqual(options.viewport, { width: 1100, height: 800 });
      assert.deepEqual(options.args, nativeOnly ? ["--disable-extensions"]
        : ["--disable-extensions-except=synthetic-extension", "--load-extension=synthetic-extension"]);
    }
  } finally { launch.mockRestore(); }
});


it("keeps unrelated browser work available when the SSO guard cannot install", async () => {
  const failure = new Error("fixture init script refused");
  const context = { addInitScript: async () => { throw failure; } } as unknown as BrowserContext;
  const launch = vi.spyOn(chromium, "launchPersistentContext").mockResolvedValue(context);
  try {
    const opened = await DEFAULT_BROWSER_LAUNCHER.launch({ profileDirectory: "synthetic-profile", headless: true,
      extensionDirectory: "synthetic-extension", acceptDownloads: false, downloadsPath: "synthetic-downloads",
      viewport: { width: 1100, height: 800 } });
    assert.equal(opened, context);
    assert.throws(() => nativeSsoGuardKeys(opened), error => error instanceof Error && error.cause === failure);
  } finally { launch.mockRestore(); }
});
