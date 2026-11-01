import { test as base, type Browser } from "@playwright/test";

export const test = base.extend<object, {
  browserFor: (name: "chromium" | "webkit") => Promise<Browser>;
}>({
  browserFor: [async ({ browser, playwright }, use) => {
    let webkit: Browser | undefined;
    try {
      await use(async name => {
        if (name === "chromium") return browser;
        webkit ??= await playwright.webkit.launch();
        return webkit;
      });
    } finally {
      await webkit?.close();
    }
  }, { scope: "worker" }],
});
