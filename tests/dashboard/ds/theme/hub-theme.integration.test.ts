import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, describe, it } from "vitest";

const hubTheme = readFileSync(resolve("src/dashboard/ds/theme/hub-theme.css"), "utf8");
const SURFACE = "rgb(24, 24, 27)";
const page = `<html data-hub data-demo-theme="dark"><style>${hubTheme}
:root{--ds-surface-overlay:#18181b;--ds-surface-scrim:rgba(0,0,0,.66)}
#scrim{position:fixed;inset:0;background:var(--ds-surface-scrim)}
#dialog{position:fixed;left:20%;top:20%;width:60%;height:60%;background:var(--ds-surface-overlay)}</style>
<body><div id="scrim"></div><div id="dialog" role="dialog" tabindex="-1" data-state="open"><h2>Start run</h2></div></body></html>`;

const browsers: Browser[] = [];
afterAll(async () => { await Promise.all(browsers.map(browser => browser.close())); });

describe("a key press never makes the Run dialog see-through", () => {
  it.each(["'", "a", "Shift+'", "Tab"])("key %s keeps the surface and the scrim", async key => {
    const browser = await chromium.launch({ headless: true });
    browsers.push(browser);
    const tab = await browser.newPage();
    await tab.setContent(page);
    await tab.locator("#dialog h2").click();
    await tab.keyboard.press(key);
    const paint = await tab.evaluate(() => ({
      focusVisible: document.querySelector("#dialog")!.matches(":focus-visible"),
      surface: getComputedStyle(document.querySelector("#dialog")!).backgroundColor,
      scrim: getComputedStyle(document.querySelector("#scrim")!).backgroundColor,
    }));
    if (key !== "Tab") assert.equal(paint.focusVisible, true);
    assert.equal(paint.surface, SURFACE);
    assert.equal(paint.scrim, "rgba(0, 0, 0, 0.66)");
  });
});
