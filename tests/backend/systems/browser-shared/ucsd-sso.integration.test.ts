import assert from "node:assert/strict";
import { chromium } from "playwright";
import { it } from "vitest";
import { submitOnboardingSsoCredentials } from "../../../../src/backend/systems/browser-shared/ucsd-sso.js";

const SSO = "https://a5.ucsd.edu/tritON/profile/SAML2/Redirect/SSO";
const form = (action = SSO) => `<form action="${action}" method="post"><input id="ssousername" name="username"><input id="ssopassword" type="password" name="password"><button name="_eventId_proceed">Sign in</button></form>`;

it("submits the exact UCSD form once and refuses wrong origin, action, fields and authority before secrets", async () => {
  const browser = await chromium.launch({ channel: "chromium", headless: true });
  const context = await browser.newContext();
  let html = form(), acquisitions = 0, submissions = 0, current = true;
  await context.route("**/*", async route => {
    if (route.request().method() !== "GET") {
      submissions++;
      const values = new URLSearchParams(route.request().postData() ?? "");
      assert.equal(values.get("username"), "synthetic-user"); assert.equal(values.get("password"), "synthetic-password");
      await route.fulfill({ contentType: "text/html", body: "Awaiting native MFA" });
    }
    else await route.fulfill({ contentType: "text/html", body: html });
  });
  const page = await context.newPage();
  const acquire = async () => { acquisitions++; return { userId: "synthetic-user", password: "synthetic-password" }; };
  const assertCurrent = () => { if (!current) throw new Error("synthetic-revoked"); };
  try {
    await page.goto(SSO);
    await submitOnboardingSsoCredentials(page, acquire, assertCurrent, 1000);
    assert.equal(await page.locator("body").textContent(), "Awaiting native MFA");
    assert.equal(acquisitions, 1); assert.equal(submissions, 1);
    for (const [url, body] of [
      [SSO.replace("a5.ucsd.edu", "a5.ucsd.edu.invalid"), form()],
      [SSO.replace("https:", "http:"), form()],
      [SSO.replace("/tritON/", "/other/"), form()],
      [SSO, form("https://a5.ucsd.edu.invalid/tritON/profile/SAML2/Redirect/SSO")],
      [SSO, form("https://wrong@a5.ucsd.edu/tritON/profile/SAML2/Redirect/SSO")],
      [SSO, form("https://a5.ucsd.edu:444/tritON/profile/SAML2/Redirect/SSO")],
      [SSO, form().replace('method="post"', 'method="get"')],
      [SSO, form().replace('name="_eventId_proceed"', 'name="_eventId_proceed" formaction="https://elsewhere.invalid/"')],
      [SSO, form().replace('name="_eventId_proceed"', 'name="_eventId_proceed" formtarget="_blank"')],
      [SSO, form().replace('name="_eventId_proceed"', 'name="_eventId_proceed" disabled')],
      [SSO, '<form><input id="ssousername"></form>'],
      [SSO, form().replace('id="ssopassword"', 'hidden id="ssopassword"')],
      [SSO, '<form><input id="ssousername"></form><form><input id="ssopassword" type="password"></form>'],
    ]) {
      assert.ok(url && body); html = body; await page.goto(url);
      await assert.rejects(submitOnboardingSsoCredentials(page, acquire, assertCurrent, 1000));
      assert.equal(acquisitions, 1);
    }
    html = form(); await page.goto(SSO); current = false;
    await assert.rejects(submitOnboardingSsoCredentials(page, acquire, assertCurrent, 1000));
    assert.equal(acquisitions, 1); assert.equal(submissions, 1);
  } finally { await browser.close(); }
});

it("refuses replacement, navigation and generation changes during acquisition and a changed form before the password fill", async () => {
  const browser = await chromium.launch({ channel: "chromium", headless: true });
  const context = await browser.newContext();
  await context.route("**/*", route => route.fulfill({ contentType: "text/html", body: form() }));
  const page = await context.newPage();
  let current = true;
  const assertCurrent = () => { if (!current) throw new Error("synthetic-revoked"); };
  try {
    for (const change of ["replacement", "navigation", "generation"] as const) {
      current = true; await page.goto(SSO);
      await assert.rejects(submitOnboardingSsoCredentials(page, async () => {
        if (change === "replacement") await page.locator("form").evaluate(element => { element.replaceWith(element.cloneNode(true)); });
        else if (change === "navigation") await page.goto("https://elsewhere.invalid/");
        else current = false;
        return { userId: "synthetic-user", password: "synthetic-password" };
      }, assertCurrent, 1000));
      assert.equal(await page.locator("#ssousername").inputValue(), "");
      assert.equal(await page.locator("#ssopassword").inputValue(), "");
    }
    current = true; await page.goto(SSO);
    await page.locator("#ssousername").evaluate(element => {
      if (!(element instanceof HTMLInputElement) || !element.form) throw new Error("fixture form missing");
      const form = element.form; element.addEventListener("input", () => { form.action = "https://elsewhere.invalid/"; });
    });
    await assert.rejects(submitOnboardingSsoCredentials(page, async () => ({ userId: "synthetic-user", password: "synthetic-password" }), assertCurrent, 1000));
    assert.equal(await page.locator("#ssopassword").inputValue(), "");
  } finally { await browser.close(); }
});
