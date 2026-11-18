import assert from "node:assert/strict";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, it } from "vitest";
import { probeSessionCookie } from "../../../../src/backend/systems/browser-shared/authenticated-application.js";
import { submitPinnedUcsdSsoCredentials, waitForAuthenticatedLanding, waitForUcsdDuoSignIn } from "../../../../src/backend/systems/browser-shared/ucsd-sso.js";
import { BrowserLandingStallError, DuoTerminalRefusalError } from "../../../../src/backend/systems/browser-shared/login-contract.js";
import { crmLoginRecipe } from "../../../../src/backend/systems/crm/session.js";
import { i9LoginRecipe } from "../../../../src/backend/systems/i9/login.js";
import { kualiLoginRecipe } from "../../../../src/backend/systems/kuali/session.js";
import { newKronosLoginRecipe } from "../../../../src/backend/systems/new-kronos/session.js";
import { onbaseLoginRecipe } from "../../../../src/backend/systems/onbase/login.js";
import { ucpathLoginRecipe } from "../../../../src/backend/systems/ucpath/session.js";
import { resolveSystemLoginUrl } from "../../../../src/models/config/instance.js";
import { createSystemSessionTestWorld } from "../../../support/helpers/backend/system-session-world.js";

const { contextFor } = createSystemSessionTestWorld();
const SSO = "https://a5.ucsd.edu/tritON/profile/SAML2/Redirect/SSO";
const form = (action = SSO) => `<form action="${action}" method="post"><input id="ssousername" name="username"><input id="ssopassword" type="password" name="password"><button name="_eventId_proceed">Sign in</button></form>`;

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ channel: "chromium", headless: true }); });
afterAll(async () => { await browser?.close(); });

it("requires the session cookie to apply to the current application path", async () => {
  const context = await browser.newContext();
  try {
    const domain = "application.example.invalid";
    await context.route("**/*", route => route.fulfill({ body: "Application" }));
    await context.addCookies([{ domain, name: "sid", value: "fixture", path: "/app" }]);
    const page = await context.newPage();
    const probe = () => probeSessionCookie(page, {
      assertCurrent: () => undefined, name: "sid", domainSuffix: domain, issuer: "application",
    });
    for (const [path, applies] of [["/app", true], ["/app/home", true], ["/application", false]] as const) {
      await page.goto(`https://${domain}${path}`);
      assert.equal((await probe()).holds, applies, path);
    }
  } finally { await context.close(); }
});

for (const [system, recipe] of [
  ["crm", crmLoginRecipe], ["kuali", kualiLoginRecipe], ["new-kronos", newKronosLoginRecipe],
  ["ucpath", ucpathLoginRecipe], ["i9", i9LoginRecipe], ["onbase", onbaseLoginRecipe],
] as const) {
  it.each(["trusted", "wrong-origin", "wrong-destination"] as const)(`${system} requests credentials only for the proved SSO form (%s)`, async scenario => {
    const browserContext = await browser.newContext();
    try {
      const page = await browserContext.newPage();
      const { context } = await contextFor({ url: "about:blank" }, undefined, system);
      const other = "https://sso.example.invalid/login";
      const landing = scenario === "wrong-origin" ? other : SSO;
      const config = {
        ...context.config,
        timeouts: { ...context.config.timeouts, navigationMs: 1000 },
        urls: { ...context.config.urls, kuali: { prod: { entry: landing } }, newKronos: { prod: { entry: landing } } },
      };
      const entry = new URL(resolveSystemLoginUrl(config, system, "prod", "fixture")).href;
      const fieldPage = form(scenario === "wrong-destination" ? other : SSO)
        + '<select id="authtype"><option value="_eventId_authn/PasswordAD" selected>AD</option></select>';
      let servedForm = false;
      let credentialReads = 0;
      await browserContext.route("**/*", async route => {
        if (route.request().url() === landing) {
          servedForm = true;
          await route.fulfill({ contentType: "text/html", body: fieldPage });
        } else if (route.request().url() === entry) {
          if (system === "ucpath" || system === "i9") {
            const link = system === "ucpath" ? "Log in to UCPath" : "Tracker I-9 Complete Application";
            await route.fulfill({ contentType: "text/html", body: `<a href="${landing}">${link}</a>` });
          } else {
            await route.fulfill({ contentType: "text/html", body: `<meta http-equiv="refresh" content="0; url=${landing}">` });
          }
        } else await route.abort();
      });
      await assert.rejects(recipe({
        ...context, page, config,
        get credentials(): typeof context.credentials {
          credentialReads++;
          throw new Error("fixture stopped at credential acquisition");
        },
      }));
      assert.equal(servedForm, true);
      assert.equal(credentialReads, scenario === "trusted" ? 1 : 0);
      assert.equal(await page.locator("#ssopassword").inputValue(), "");
    } finally { await browserContext.close(); }
  });
}

it.each(["application", "duo", "embedded-duo"] as const)("binds terminal refusal text to the Duo document (%s)", async surface => {
  const browserContext = await browser.newContext();
  try {
    const page = await browserContext.newPage();
    const { context } = await contextFor({ url: "about:blank" });
    const duo = "https://fixture.duosecurity.com/prompt";
    const app = "https://application.example.invalid/home";
    await browserContext.route("**/*", route => route.fulfill({ contentType: "text/html",
      body: surface === "embedded-duo" && route.request().url() === app
        ? `<iframe src="${duo}"></iframe>` : "<p>Login request was canceled or timed out</p>",
    }));
    await page.goto(surface === "duo" ? duo : app);
    const landing = context.duoCeremony.withCeremony(token => waitForAuthenticatedLanding(
      "ucpath", { ...context, page }, token, () => false, 500,
    ));
    if (surface === "application") {
      await assert.rejects(landing, error => error instanceof BrowserLandingStallError && error.code === "AUTHENTICATED_LANDING_MISSING");
    } else {
      await assert.rejects(landing, error => error instanceof DuoTerminalRefusalError
        && error.host === "fixture.duosecurity.com" && error.path === "/prompt");
    }
  } finally { await browserContext.close(); }
});

it("waits through a client redirect and a delayed ready form before acquiring credentials", async () => {
  const context = await browser.newContext();
  let acquisitions = 0, submissions = 0;
  await context.route("**/*", async route => {
    if (route.request().method() === "POST") submissions++;
    await route.fulfill({ contentType: "text/html", body: "<main>Loading</main>" });
  });
  const page = await context.newPage();
  try {
    await page.goto("https://duo.ucsd.edu/");
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

it("waits at duo.ucsd.edu for a delayed client redirect to the exact a5 form", async () => {
  const context = await browser.newContext();
  await context.route("**/*", route => route.fulfill({ contentType: "text/html", body: route.request().url() === SSO ? form() : "<main>Loading</main>" }));
  const page = await context.newPage();
  try {
    await page.goto("https://duo.ucsd.edu/");
    const landing = waitForUcsdDuoSignIn(page, () => undefined, 1000);
    void landing.catch(() => undefined);
    await page.evaluate(url => { setTimeout(() => { location.href = url; }, 50); }, SSO);
    assert.equal(await landing, "sso-form");
    assert.equal(page.url(), SSO);
    assert.equal(await page.locator("#ssopassword").inputValue(), "");
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
    for (const url of ["https://duosecurity.com/", "https://test.duosecurity.com/"]) {
      await page.goto(url);
      assert.equal(await waitForUcsdDuoSignIn(page, () => undefined, 100), "duo");
      assert.equal(await page.locator("#ssopassword").inputValue(), "");
    }
    for (const url of ["https://duo.ucsd.edu/", "http://test.duosecurity.com/", "https://test.duosecurity.com:444/", "https://duosecurity.com.invalid/", "https://duo.ucsd.edu.invalid/"]) {
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
