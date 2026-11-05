import assert from "node:assert/strict";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, it } from "vitest";
import { submitPinnedUcsdSsoCredentials, waitForUcsdDuoSignIn } from "../../../../src/backend/systems/browser-shared/ucsd-sso.js";

const SSO = "https://a5.ucsd.edu/tritON/profile/SAML2/Redirect/SSO";
const form = (action = SSO) => `<form action="${action}" method="post"><input id="ssousername" name="username"><input id="ssopassword" type="password" name="password"><button name="_eventId_proceed">Sign in</button></form>`;

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ channel: "chromium", headless: true }); });
afterAll(async () => { await browser?.close(); });

it("waits through a client redirect and a delayed ready form before acquiring credentials", async () => {
  const context = await browser.newContext();
  let acquisitions = 0, submissions = 0;
  await context.route("**/*", async route => {
    if (route.request().method() === "POST") submissions++;
    await route.fulfill({ contentType: "text/html", body: "<main>Loading</main>" });
  });
  const page = await context.newPage();
  try {
    await page.goto("https://portal.example.invalid/");
    const signing = (async () => {
      assert.equal(await waitForUcsdDuoSignIn(page, () => undefined, 1000), "sso-form");
      await submitPinnedUcsdSsoCredentials(page, async () => {
        acquisitions++;
        return { userId: "synthetic-user", password: "synthetic-password" };
      }, () => undefined, 1000, "/tritON/profile/SAML2/Redirect/SSO");
    })();
    void signing.catch(() => undefined);
    assert.equal(acquisitions, 0);
    await page.evaluate(url => { location.href = url; }, SSO);
    await page.waitForURL(SSO);
    assert.equal(acquisitions, 0);
    await page.locator("body").evaluate((body, html) => { body.innerHTML = html; }, form().replace('type="password"', 'type="password" disabled'));
    assert.equal(acquisitions, 0);
    await page.locator("#ssopassword").evaluate(element => { if (element instanceof HTMLInputElement) element.disabled = false; });
    await signing;
    assert.equal(acquisitions, 1); assert.equal(submissions, 1);
  } finally { await context.close(); }
});

it("reports redirect and form timeouts without acquiring or sending credentials", async () => {
  const context = await browser.newContext();
  let submissions = 0;
  await context.route("**/*", async route => {
    if (route.request().method() === "POST") submissions++;
    await route.fulfill({ contentType: "text/html", body: form() });
  });
  const page = await context.newPage();
  try {
    for (const url of ["https://elsewhere.invalid/", SSO.replace("/tritON/", "/idp/"), SSO.replace("a5.ucsd.edu", "a5.ucsd.edu.invalid")]) {
      await page.goto(url);
      await assert.rejects(waitForUcsdDuoSignIn(page, () => undefined, 100), { message: "UCSD_SSO_REDIRECT_TIMEOUT" });
      assert.equal(await page.locator("#ssopassword").inputValue(), "");
    }
    await page.goto(SSO);
    await page.locator("#ssopassword").evaluate(element => { if (element instanceof HTMLInputElement) element.disabled = true; });
    await assert.rejects(waitForUcsdDuoSignIn(page, () => undefined, 100), { message: "UCSD_SSO_FORM_TIMEOUT" });
    assert.equal(submissions, 0);
  } finally { await context.close(); }
});

it("hands a direct Duo landing back without treating a page on another host as an SSO form", async () => {
  const context = await browser.newContext();
  let submissions = 0;
  await context.route("**/*", async route => {
    if (route.request().method() !== "GET") submissions++;
    await route.fulfill({ contentType: "text/html", body: form() });
  });
  const page = await context.newPage();
  try {
    for (const url of ["https://duo.ucsd.edu/", "https://duosecurity.com/", "https://test.duosecurity.com/"]) {
      await page.goto(url);
      assert.equal(await waitForUcsdDuoSignIn(page, () => undefined, 100), "duo");
      assert.equal(await page.locator("#ssopassword").inputValue(), "");
    }
    for (const url of ["http://test.duosecurity.com/", "https://test.duosecurity.com:444/", "https://duosecurity.com.invalid/", "https://duo.ucsd.edu.invalid/"]) {
      await page.goto(url);
      await assert.rejects(waitForUcsdDuoSignIn(page, () => undefined, 100), { message: "UCSD_SSO_REDIRECT_TIMEOUT" });
    }
    assert.equal(submissions, 0);
  } finally { await context.close(); }
});

it("submits the exact UCSD form once and refuses wrong origin, action, fields and authority before secrets", async () => {
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
    await submitPinnedUcsdSsoCredentials(page, acquire, assertCurrent, 1000, "/tritON/profile/SAML2/Redirect/SSO");
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
      await assert.rejects(submitPinnedUcsdSsoCredentials(page, acquire, assertCurrent, 1000, "/tritON/profile/SAML2/Redirect/SSO"));
      assert.equal(acquisitions, 1);
    }
    html = form(); await page.goto(SSO); current = false;
    await assert.rejects(submitPinnedUcsdSsoCredentials(page, acquire, assertCurrent, 1000, "/tritON/profile/SAML2/Redirect/SSO"));
    assert.equal(acquisitions, 1); assert.equal(submissions, 1);
  } finally { await context.close(); }
});

it("refuses replacement, navigation and generation changes during acquisition and a changed form before the password fill", async () => {
  const context = await browser.newContext();
  await context.route("**/*", route => route.fulfill({ contentType: "text/html", body: form() }));
  const page = await context.newPage();
  let current = true;
  const assertCurrent = () => { if (!current) throw new Error("synthetic-revoked"); };
  try {
    for (const change of ["replacement", "navigation", "generation"] as const) {
      current = true; await page.goto(SSO);
      await assert.rejects(submitPinnedUcsdSsoCredentials(page, async () => {
        if (change === "replacement") await page.locator("form").evaluate(element => { element.replaceWith(element.cloneNode(true)); });
        else if (change === "navigation") await page.goto("https://elsewhere.invalid/");
        else current = false;
        return { userId: "synthetic-user", password: "synthetic-password" };
      }, assertCurrent, 1000, "/tritON/profile/SAML2/Redirect/SSO"));
      assert.equal(await page.locator("#ssousername").inputValue(), "");
      assert.equal(await page.locator("#ssopassword").inputValue(), "");
    }
    current = true; await page.goto(SSO);
    await page.locator("#ssousername").evaluate(element => {
      if (!(element instanceof HTMLInputElement) || !element.form) throw new Error("fixture form missing");
      const form = element.form; element.addEventListener("input", () => { form.action = "https://elsewhere.invalid/"; });
    });
    await assert.rejects(submitPinnedUcsdSsoCredentials(page, async () => ({ userId: "synthetic-user", password: "synthetic-password" }), assertCurrent, 1000, "/tritON/profile/SAML2/Redirect/SSO"));
    assert.equal(await page.locator("#ssopassword").inputValue(), "");
  } finally { await context.close(); }
});
