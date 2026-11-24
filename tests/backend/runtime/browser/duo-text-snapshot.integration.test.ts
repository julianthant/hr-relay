import assert from "node:assert/strict";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, it } from "vitest";
import { duoTextSnapshot } from "../../../../src/backend/runtime/browser/onboarding-duo-provider.js";

const SECRET = "value-sentinel";
const FIELDS = `<input name="code" value="${SECRET}-attr"><input name="typed" type="password"><textarea>${SECRET}-textarea</textarea>
  <select><option>${SECRET}-option</option></select><div contenteditable="true"><p>${SECRET}-editable</p></div>`;
let browser: Browser;

beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
afterAll(async () => { await browser.close(); });

async function served(pages: Record<string, string>) {
  const context = await browser.newContext();
  await context.route("https://**/*", async route => {
    const { origin, pathname } = new URL(route.request().url()), body = pages[`${origin}${pathname}`];
    if (body === undefined) await route.abort(); else await route.fulfill({ contentType: "text/html", body });
  });
  return context;
}

it("records frame hosts, headings, labels and status text but no field values, even inside an iframe", async () => {
  const context = await served({
    "https://api-test.duosecurity.com/frame/prompt": `<h1>Check for a Duo Push</h1><div role="alert">Pushed a login request</div>${FIELDS}
      <button>Other options</button><a href="/help?ticket=${SECRET}">Need help?</a><button hidden>Hidden control</button>
      <iframe src="https://frame-test.duosecurity.com/inner?token=${SECRET}"></iframe>`,
    "https://frame-test.duosecurity.com/inner": `<h2>Inner heading</h2>${FIELDS}<button>Inner button</button>`,
  });
  try {
    const page = await context.newPage();
    await page.goto(`https://api-test.duosecurity.com/frame/prompt?sid=${SECRET}#${SECRET}`);
    const inner = page.frameLocator("iframe");
    await inner.getByRole("button", { name: "Inner button" }).waitFor();
    await page.fill("input[name=typed]", `${SECRET}-typed`);
    await inner.locator("input[name=typed]").fill(`${SECRET}-typed`);
    await page.locator("textarea").fill(`${SECRET}-typed-textarea`);
    const text = await duoTextSnapshot(page);
    assert.doesNotMatch(text, new RegExp(SECRET, "u"));
    assert.equal(text, [
      "frame api-test.duosecurity.com/frame/prompt", "  headings: Check for a Duo Push", "  controls: Other options", "  controls: Need help?",
      "  text: Pushed a login request", "frame frame-test.duosecurity.com/inner", "  headings: Inner heading", "  controls: Inner button", "",
    ].join("\n"));
  } finally { await context.close(); }
});

it("records only the SSO host, path and labels after a redirect", async () => {
  const sso = "https://a5.ucsd.edu/tritON/profile/SAML2/Redirect/SSO";
  const context = await served({
    "https://api-test.duosecurity.com/frame/prompt": `<script>location.replace(${JSON.stringify(`${sso}?execution=${SECRET}#${SECRET}`)})</script>`,
    [sso]: `<form><label for="u">Username</label><input id="u" name="username"><label for="p">Password</label><input id="p" type="password"><button>Sign in</button></form>`,
  });
  try {
    const page = await context.newPage();
    await page.goto("https://api-test.duosecurity.com/frame/prompt");
    await page.waitForURL(url => url.href.startsWith(sso));
    await page.fill("#u", `${SECRET}-user`); await page.fill("#p", `${SECRET}-password`);
    assert.equal(await duoTextSnapshot(page), "frame a5.ucsd.edu/tritON/profile/SAML2/Redirect/SSO\n  controls: Sign in\n");
  } finally { await context.close(); }
});
