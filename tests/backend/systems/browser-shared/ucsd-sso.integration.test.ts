import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempDisposable, readFile } from "node:fs/promises";
import { createServer as createSecureServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, it, vi } from "vitest";
import { installNativeSsoGuard, withPinnedSsoPost } from "../../../../src/backend/systems/browser-shared/ucsd-sso-guard.js";
import { assertAuthenticatedApplication, probeSessionCookie } from "../../../../src/backend/systems/browser-shared/authenticated-application.js";
import { submitPinnedUcsdSsoCredentials, submitSsoForm, verifyUcsdAuthenticatedApplication, waitForAuthenticatedLanding, waitForUcsdDuoSignIn } from "../../../../src/backend/systems/browser-shared/ucsd-sso.js";
import { BrowserLandingStallError, BrowserLoginError, DuoTerminalRefusalError } from "../../../../src/backend/systems/browser-shared/login-contract.js";
import { crmLoginRecipe } from "../../../../src/backend/systems/crm/session.js";
import { i9LoginRecipe } from "../../../../src/backend/systems/i9/login.js";
import { kualiLoginRecipe } from "../../../../src/backend/systems/kuali/session.js";
import { newKronosLoginRecipe, verifyNewKronosAuthenticatedApplication } from "../../../../src/backend/systems/new-kronos/session.js";
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

async function guardedContext() {
  const context = await browser.newContext();
  await installNativeSsoGuard(context);
  return context;
}

const kronosSso = "https://a5.ucsd.edu/tritON/profile/SAML2/POST/SSO";
const kronosHome = "https://ucsd-sso.prd.mykronos.com/wfd/home";
const kronosHops = [
  "https://cust01-prd07-ath01.prd.mykronos.com/fixture/UI",
  "https://cust01-prd07-ath01.prd.mykronos.com/fixture/XUI/",
  "https://cust01-pid01.gss.mykronos.com/fixture/SSOPOST/fixture/idp",
  kronosSso,
  kronosHome,
];

it.each(["application", "sign-in form", "missing cookie"] as const)("proves the final WFD document after the reset redirect chain (%s)", async landing => {
  const browserContext = await guardedContext();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const schedule = globalThis.setTimeout;
  const timers = vi.spyOn(globalThis, "setTimeout").mockImplementation((callback, delay, ...args: unknown[]) => {
    const timer = schedule(callback, delay, ...args);
    // Advance one WFD poll after it is scheduled, leaving browser I/O outside virtual time.
    if (delay === 250) queueMicrotask(() => vi.advanceTimersByTime(delay));
    return timer;
  });
  try {
    const page = await browserContext.newPage();
    const { context, evidence } = await contextFor({ url: "about:blank" }, undefined, "new-kronos");
    let returned = false;
    await browserContext.route("**/*", route => route.fulfill({
      contentType: "text/html",
      body: returned && landing === "sign-in form" ? form(kronosSso) : "<main>Loading</main>",
    }));
    await page.goto(kronosHome, { waitUntil: "domcontentloaded" });
    await browserContext.addCookies([{ url: kronosHome, name: "kronosAuthToken", value: "fixture" }]);
    const cookies = browserContext.cookies.bind(browserContext);
    const reads = vi.spyOn(browserContext, "cookies").mockImplementationOnce(async urls => {
      const beforeRedirect = await cookies(urls);
      for (const hop of kronosHops) {
        returned = hop === kronosHome;
        await page.goto(hop);
      }
      if (landing === "missing cookie") await browserContext.clearCookies();
      return beforeRedirect;
    });
    const verifying = assertAuthenticatedApplication("new-kronos", { ...context, page }, verifyNewKronosAuthenticatedApplication);
    if (landing === "application") {
      assert.equal((await verifying).url, kronosHome);
      assert.equal(evidence().length, 1);
    } else {
      const check = landing === "sign-in form" ? "sign-in-form-absent" : "positive-evidence";
      await assert.rejects(verifying, { step: "verify-landing", check, observedUrl: kronosHome });
      assert.deepEqual(evidence(), []);
    }
    assert.ok(reads.mock.calls.length >= 2, "the replacement document requires its own cookie proof");
  } finally {
    timers.mockRestore();
    vi.useRealTimers();
    await browserContext.close();
  }
});

it("waits for WFD when final verification starts on the SAML return hop", async () => {
  const browserContext = await guardedContext();
  try {
    const page = await browserContext.newPage();
    await browserContext.route("**/*", route => route.fulfill({ contentType: "text/html", body: "<main>Application</main>" }));
    await page.goto(kronosSso);
    await browserContext.addCookies([{ url: kronosHome, name: "kronosAuthToken", value: "fixture" }]);
    const reads = vi.spyOn(browserContext, "cookies");
    const { context } = await contextFor({ url: "about:blank" }, undefined, "new-kronos");
    const [proof] = await Promise.all([
      assertAuthenticatedApplication("new-kronos", { ...context, page }, verifyNewKronosAuthenticatedApplication),
      page.goto(kronosHome),
    ]);
    assert.equal(proof.url, kronosHome);
    assert.deepEqual(reads.mock.calls, [[kronosHome]]);
  } finally { await browserContext.close(); }
});

it("reports the exact WFD route observation even if the page moves before the refusal is raised", async () => {
  const browserContext = await guardedContext();
  try {
    const page = await browserContext.newPage();
    await browserContext.route("**/*", route => route.fulfill({ contentType: "text/html", body: "<main>Loading</main>" }));
    await page.goto(kronosSso);
    const { context } = await contextFor({ url: "about:blank" }, undefined, "new-kronos");
    await assert.rejects(assertAuthenticatedApplication("new-kronos", { ...context, page }, async input => {
      const refused = await verifyNewKronosAuthenticatedApplication(input);
      await page.goto(kronosHome);
      return refused;
    }), { step: "verify-landing", check: "application-route", observedUrl: kronosSso });
  } finally { await browserContext.close(); }
});

it("refuses a replacement form when WFD still shows the previous document during a pending navigation", async () => {
  const browserContext = await guardedContext();
  const release = Promise.withResolvers<void>();
  try {
    const page = await browserContext.newPage();
    const requested = Promise.withResolvers<void>();
    const observed = Promise.withResolvers<void>();
    const replacement = kronosHome + "?fixture=return";
    await browserContext.route("**/*", async route => {
      const returning = route.request().url() === replacement;
      if (returning) {
        requested.resolve();
        await release.promise;
      }
      await route.fulfill({ contentType: "text/html", body: returning ? form(kronosSso) : "<main>WFD</main>" });
    });
    await page.goto(kronosHome);
    await browserContext.addCookies([{ url: kronosHome, name: "kronosAuthToken", value: "fixture" }]);
    const locator = page.locator.bind(page);
    let redirected = false;
    vi.spyOn(page, "locator").mockImplementation((selector, options) => {
      const control = locator(selector, options);
      if (!redirected && selector.includes('form[name="loginForm"]')) {
        const count = control.count.bind(control);
        vi.spyOn(control, "count").mockImplementationOnce(async () => {
          const present = await count();
          redirected = true;
          await page.evaluate(url => { location.assign(url); }, replacement);
          await requested.promise;
          observed.resolve();
          return present;
        });
      }
      return control;
    });
    const { context, evidence } = await contextFor({ url: "about:blank" }, undefined, "new-kronos");
    const verifying = assertAuthenticatedApplication("new-kronos", { ...context, page }, verifyNewKronosAuthenticatedApplication);
    const checked = assert.rejects(verifying, { check: "sign-in-form-absent", observedUrl: replacement });
    void checked.catch(() => undefined);
    await observed.promise;
    assert.equal(page.url(), kronosHome);
    await new Promise<void>(resolve => setImmediate(resolve));
    release.resolve();
    await page.waitForURL(replacement);
    await checked;
    assert.deepEqual(evidence(), []);
  } finally { release.resolve(); await browserContext.close(); }
});

it("expires a blocked WFD proof before a late cookie read can record evidence", async () => {
  const browserContext = await guardedContext();
  const release = Promise.withResolvers<void>();
  try {
    const page = await browserContext.newPage();
    await browserContext.route("**/*", route => route.fulfill({ contentType: "text/html", body: "<main>WFD</main>" }));
    await page.goto(kronosHome);
    await browserContext.addCookies([{ url: kronosHome, name: "kronosAuthToken", value: "fixture" }]);
    const { context, evidence } = await contextFor({ url: "about:blank" }, undefined, "new-kronos");
    const entered = Promise.withResolvers<void>();
    const cookies = await browserContext.cookies(kronosHome);
    vi.spyOn(browserContext, "cookies").mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      return cookies;
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const verifying = assertAuthenticatedApplication("new-kronos", { ...context, page }, verifyNewKronosAuthenticatedApplication);
    let refusal: unknown;
    const settled = verifying.catch((error: unknown) => { refusal = error; });
    await entered.promise;
    await vi.advanceTimersByTimeAsync(20_001);
    const expired = refusal;
    release.resolve();
    vi.useRealTimers();
    await settled;
    assert.ok(expired instanceof BrowserLoginError, "the assertion must settle while the cookie read is still blocked");
    assert.equal(expired.step, "verify-landing");
    assert.match(expired.detail, /deadline/u);
    assert.deepEqual(evidence(), []);
  } finally { release.resolve(); vi.useRealTimers(); await browserContext.close(); }
});

it("keeps the tested WFD URL on a proof invalidated by navigation", async () => {
  const browserContext = await guardedContext();
  try {
    const page = await browserContext.newPage();
    await browserContext.route("**/*", route => route.fulfill({ contentType: "text/html", body: "<main>WFD</main>" }));
    await page.goto(kronosHome);
    const { context } = await contextFor({ url: "about:blank" }, undefined, "new-kronos");
    await assert.rejects(assertAuthenticatedApplication("new-kronos", { ...context, page }, () =>
      verifyUcsdAuthenticatedApplication("new-kronos", page, {
        assertCurrent: context.assertCurrent,
        urlIsApplication: url => url === kronosHome,
        urlRefusal: "expected WFD",
        positive: async () => {
          await page.goto(kronosSso);
          return { holds: true, detail: "fixture cookie" };
        },
      })), { check: "application-route", observedUrl: kronosHome });
  } finally { await browserContext.close(); }
});

it.each([
  ["new-kronos", kronosSso, kronosSso, true],
  ["new-kronos", kronosSso, SSO, false],
  ["new-kronos", kronosSso + "/", kronosSso + "/", false],
  ["ucpath", kronosSso, kronosSso, false],
] as const)("pins the New Kronos POST binding (%s, page %s, action %s)", async (system, landing, destination, allowed) => {
  const browserContext = await guardedContext();
  try {
    const posts: string[] = [];
    await browserContext.route("**/*", route => {
      if (route.request().method() === "POST") posts.push(route.request().url());
      return route.fulfill({ contentType: "text/html", body: form(destination) });
    });
    const page = await browserContext.newPage();
    await page.goto(landing);
    const { context } = await contextFor({ url: landing }, undefined, system);
    let reads = 0;
    const signing = context.duoCeremony.withCeremony(token => submitSsoForm(system, {
      ...context, page, get credentials() { reads++; return context.credentials; },
    }, token));
    if (allowed) await signing;
    else await assert.rejects(signing, { name: "BrowserLoginError", system, step: "credential-fill", detail: "the pinned UCSD SSO form could not be proved or submitted" });
    assert.equal(reads, allowed ? 1 : 0);
    assert.deepEqual(posts, allowed ? [destination] : []);
  } finally { await browserContext.close(); }
});

it.each(["missing guard", "late installation", "worker-controlled document", "registered worker"] as const)("refuses credentials before filling an unguarded form (%s)", async scenario => {
  const context = scenario === "missing guard" || scenario === "late installation" ? await browser.newContext() : await guardedContext();
  try {
    if (scenario === "worker-controlled document") await context.addInitScript(() => {
      Object.defineProperty(navigator.serviceWorker, "controller", { get: () => ({}) });
    });
    if (scenario === "registered worker") await context.addInitScript(() => {
      Object.defineProperty(navigator.serviceWorker, "getRegistration", { value: async () => ({}) });
    });
    await context.route("**/*", route => route.fulfill({ contentType: "text/html", body: form() }));
    const page = await context.newPage();
    await page.goto(SSO);
    if (scenario === "late installation") await installNativeSsoGuard(context);
    let reads = 0;
    await assert.rejects(submitPinnedUcsdSsoCredentials(page, async () => { reads++; return { userId: "fixture", password: "" }; },
      () => undefined, 1000, "/tritON/profile/SAML2/Redirect/SSO"), /UCSD_SSO_FIELDS/);
    assert.equal(reads, 0);
    assert.equal(await page.locator("#ssopassword").inputValue(), "");
  } finally { await context.close(); }
});

it.each(["registration", "execution URL"] as const)("rechecks a changed %s after acquiring credentials", async change => {
  const context = await guardedContext();
  try {
    await context.route("**/*", route => route.fulfill({ contentType: "text/html", body: form() }));
    const page = await context.newPage();
    await page.goto(SSO);
    await assert.rejects(submitPinnedUcsdSsoCredentials(page, async () => {
      await page.evaluate(change => {
        if (change === "registration") Object.defineProperty(navigator.serviceWorker, "getRegistration", { value: async () => ({}) });
        else document.forms[0]?.setAttribute("action", "?execution=changed");
      }, change);
      return { userId: "fixture", password: "fixture-password" };
    }, () => undefined, 1000, "/tritON/profile/SAML2/Redirect/SSO"), /UCSD_SSO_FIELDS/);
    assert.equal(await page.locator("#ssopassword").inputValue(), "");
  } finally { await context.close(); }
});

it("requires the session cookie to apply to the current application path", async () => {
  const context = await guardedContext();
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

it.each(["cookie read", "absence check"] as const)("refuses mixed application documents after a reload during %s", async stage => {
  const context = await guardedContext();
  try {
    const domain = "application.example.invalid";
    const url = `https://${domain}/app`;
    await context.route("**/*", route => route.fulfill({ contentType: "text/html", body: "Application" }));
    await context.addCookies([{ domain, path: "/app", name: "sid", value: "fixture" }]);
    const page = await context.newPage();
    await page.goto(url);
    const assertCurrent = () => undefined;
    const result = await verifyUcsdAuthenticatedApplication("crm", page, {
      assertCurrent, urlIsApplication: raw => raw === url, urlRefusal: "unexpected application URL",
      positive: async () => {
        const fact = await probeSessionCookie(page, { assertCurrent, name: "sid", domainSuffix: domain, issuer: "application" });
        if (stage === "cookie read") await page.reload();
        return fact;
      },
      additionalAbsences: [async () => {
        if (stage === "absence check") await page.reload();
        return { holds: true, detail: "no sign-in control" };
      }],
    });
    assert.equal(result.authenticated, false);
  } finally { await context.close(); }
});

it("checks the submitted form after its fields are serialized", async () => {
  const context = await guardedContext();
  try {
    let posts = 0;
    await context.route("**/*", route => {
      if (route.request().method() === "POST") posts++;
      return route.fulfill({ contentType: "text/html", body: form() });
    });
    const page = await context.newPage();
    await page.goto(SSO);
    await page.locator("form").evaluate(form => {
      form.addEventListener("formdata", () => form.setAttribute("method", "dialog"), { once: true });
    });
    await assert.rejects(submitPinnedUcsdSsoCredentials(page, async () => ({ userId: "fixture", password: "" }),
      () => undefined, 1000, "/tritON/profile/SAML2/Redirect/SSO"), /UCSD_SSO_FIELDS/);
    assert.equal(posts, 0);
  } finally { await context.close(); }
});

it("refuses a submit handler that changes the pinned execution URL", async () => {
  const context = await guardedContext();
  try {
    let posts = 0;
    await context.route("**/*", route => {
      if (route.request().method() === "POST") posts++;
      return route.fulfill({ contentType: "text/html", body: form() });
    });
    const page = await context.newPage();
    await page.goto(SSO);
    await page.locator("form").evaluate(form => {
      form.addEventListener("submit", () => form.setAttribute("action", "?execution=changed"));
    });
    await assert.rejects(submitPinnedUcsdSsoCredentials(page, async () => ({ userId: "fixture", password: "" }),
      () => undefined, 1000, "/tritON/profile/SAML2/Redirect/SSO"), /UCSD_SSO_FIELDS/);
    await page.locator("form").waitFor();
    assert.equal(posts, 0);
  } finally { await context.close(); }
});

it.each(["prepare", "cancel click", "cancel submit"] as const)("honors the original sign-in handlers (%s)", async behavior => {
  const context = await guardedContext();
  try {
    const posted: (string | null)[] = [];
    await context.route("**/*", route => {
      if (route.request().method() === "POST") posted.push(new URLSearchParams(route.request().postData() ?? "").get("stage"));
      return route.fulfill({ contentType: "text/html", body: form().replace("</form>", '<input name="stage" type="hidden"></form>') });
    });
    const page = await context.newPage();
    await page.goto(SSO);
    await page.evaluate(behavior => {
      const form = document.forms[0];
      const button = form?.querySelector("button");
      const stage = form?.elements.namedItem("stage");
      if (!form || !button || !(stage instanceof HTMLInputElement)) throw new Error("fixture form missing");
      button.onclick = event => {
        if (event instanceof MouseEvent) stage.value = "clicked";
        if (behavior === "cancel click") event.preventDefault();
      };
      form.onsubmit = event => {
        const prepared = new FormData(form).get("stage");
        if (event.isTrusted && prepared === "clicked" && event.submitter === button) stage.value += "-submitted";
        if (behavior === "cancel submit") {
          event.preventDefault();
          location.hash = "cancelled";
        }
      };
    }, behavior);
    const actions: string[] = [];
    const signing = submitPinnedUcsdSsoCredentials(page, async () => ({ userId: "fixture", password: "" }),
      () => undefined, 1000, "/tritON/profile/SAML2/Redirect/SSO", kind => actions.push(kind));
    if (behavior === "prepare") {
      await signing;
      assert.deepEqual(posted, ["clicked-submitted"]);
      assert.deepEqual(actions, ["typed", "typed", "clicked"]);
    } else {
      await assert.rejects(signing);
      assert.deepEqual(posted, []);
      assert.deepEqual(actions, ["typed", "typed"]);
    }
  } finally { await context.close(); }
});

it.each(["GET", "POST"] as const)("verifies the committed redirect receipt after the pinned POST (%s)", async recordedMethod => {
  const context = await guardedContext();
  const server = createServer((request, response) => {
    if (request.url === "/sw.js") {
      response.setHeader("content-type", "application/javascript");
      response.end('self.addEventListener("fetch", event => { if (new URL(event.request.url).pathname === "/worker-check") event.respondWith(new Response("worker")); });');
    } else response.end("Application");
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const destination = SSO + "?execution=fixture";
    const landing = `http://127.0.0.1:${address.port}/signed-in`;
    await context.route("https://a5.ucsd.edu/**", route => {
      const request = route.request();
      if (request.method() === "POST" && request.url() === destination) {
        return route.fulfill({ status: 303, headers: { location: landing } });
      }
      return route.fulfill({ contentType: "text/html", body: form(destination) });
    });
    const page = await context.newPage();
    await page.goto(SSO);
    if (recordedMethod === "POST") {
      const waitForCommit = page.waitForNavigation.bind(page);
      vi.spyOn(page, "waitForNavigation").mockImplementation(async options => {
        const response = await waitForCommit(options);
        assert.ok(response);
        assert.ok(response.request().redirectedFrom());
        vi.spyOn(response.request(), "method").mockReturnValue("POST");
        return response;
      });
    }
    const actions: string[] = [];
    const signing = submitPinnedUcsdSsoCredentials(page, async () => ({ userId: "fixture", password: "" }),
      () => undefined, 1000, "/tritON/profile/SAML2/Redirect/SSO", kind => actions.push(kind));
    if (recordedMethod === "POST") {
      await assert.rejects(signing, /UCSD_SSO_SUBMIT_UNPROVED/);
      assert.equal(page.url(), landing);
      assert.deepEqual(actions, ["typed", "typed"]);
      return;
    }
    await signing;
    assert.equal(page.url(), landing);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    assert.equal(await page.evaluate(async () => (await fetch("/worker-check")).text()), "worker");
  } finally {
    try { await context.close(); } finally { await server[Symbol.asyncDispose](); }
  }
});

it("checks a normally worker-handled SSO navigation and restores the tab after success and refusal", async () => {
  await using directory = await mkdtempDisposable(join(tmpdir(), "relay-sso-"));
  const key = join(directory.path, "key.pem"), cert = join(directory.path, "cert.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost",
    "-keyout", key, "-out", cert], { stdio: "ignore" });
  let posts = 0, status = 200;
  await using server = createSecureServer({ key: await readFile(key), cert: await readFile(cert) }, (request, response) => {
    if (request.url === "/sw.js") {
      response.setHeader("content-type", "application/javascript");
      response.end('self.addEventListener("fetch", event => event.respondWith(new Response("worker")));');
    } else if (request.method === "POST") {
      posts++;
      if (status !== 200 && request.url === new URL(SSO).pathname) response.writeHead(status, { location: "/refused" });
      response.end("network");
    } else response.end("network");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await using ownedBrowser = await chromium.launch({ channel: "chromium", headless: true, args: ["--no-proxy-server",
    "--ignore-certificate-errors", `--host-resolver-rules=MAP a5.ucsd.edu 127.0.0.1:${address.port}, MAP * ~NOTFOUND`] });
  const context = await ownedBrowser.newContext();
  await installNativeSsoGuard(context);
  const page = await context.newPage();
  const other = await context.newPage();
  await page.goto(SSO);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
  });
  await other.goto(SSO);
  for (const scenario of ["mismatched pin", "success", "307", "308"] as const) {
    status = scenario === "307" ? 307 : scenario === "308" ? 308 : 200;
    const before = posts;
    const original = await page.goto(SSO);
    assert.ok(original?.fromServiceWorker());
    await page.locator("body").evaluate((body, html) => { body.innerHTML = html; }, form());
    const destination = scenario === "mismatched pin" ? SSO + "?execution=other" : SSO;
    const signing = withPinnedSsoPost(page, destination, () => undefined, async (allowPost, verifyCommit) => {
      assert.ok((await other.reload())?.fromServiceWorker());
      allowPost();
      const [response] = await Promise.all([page.waitForNavigation({ waitUntil: "commit", timeout: 3000 }), page.locator("button").click()]);
      verifyCommit(response);
    });
    if (scenario === "mismatched pin") await assert.rejects(signing, /UCSD_SSO_POST_REFUSED/);
    else if (status !== 200) await assert.rejects(signing, /UCSD_SSO_POST_REDIRECT_REFUSED/);
    else {
      await signing;
      assert.equal(await page.locator("body").textContent(), "network");
    }
    assert.equal(posts - before, scenario === "mismatched pin" ? 0 : 1);
    assert.ok((await page.goto(SSO))?.fromServiceWorker());
  }
});

it("refuses to fill the password if the native submit guard cannot attach", async () => {
  const context = await guardedContext();
  try {
    await context.route("**/*", route => route.fulfill({ contentType: "text/html", body: form() }));
    const page = await context.newPage();
    await page.goto(SSO);
    const unavailable = new Error("fixture network guard unavailable");
    vi.spyOn(context, "newCDPSession").mockRejectedValue(unavailable);
    await assert.rejects(submitPinnedUcsdSsoCredentials(page, async () => ({ userId: "fixture", password: "fixture-password" }),
      () => undefined, 1000, "/tritON/profile/SAML2/Redirect/SSO"), error => error === unavailable);
    assert.equal(await page.locator("#ssopassword").inputValue(), "");
  } finally { await context.close(); }
});

it("requires the pinned POST to complete before recording submission", async () => {
  const context = await guardedContext();
  try {
    await context.route("**/*", route => route.request().method() === "POST"
      ? route.abort() : route.fulfill({ contentType: "text/html", body: form() }));
    const page = await context.newPage();
    await page.goto(SSO);
    const actions: string[] = [];
    await assert.rejects(submitPinnedUcsdSsoCredentials(page, async () => ({ userId: "fixture", password: "" }),
      () => undefined, 1000, "/tritON/profile/SAML2/Redirect/SSO", kind => actions.push(kind)));
    assert.deepEqual(actions, ["typed", "typed"]);
  } finally { await context.close(); }
});

for (const [system, recipe] of [
  ["crm", crmLoginRecipe], ["kuali", kualiLoginRecipe], ["new-kronos", newKronosLoginRecipe],
  ["ucpath", ucpathLoginRecipe], ["i9", i9LoginRecipe], ["onbase", onbaseLoginRecipe],
] as const) {
  const scenarios = ["trusted", "wrong-origin", "wrong-destination"] as const;
  it.each(system === "crm" ? [...scenarios, "unverified-entry"] as const : scenarios)(`${system} requests credentials only for the proved SSO form (%s)`, async scenario => {
    const browserContext = await guardedContext();
    try {
      const page = await browserContext.newPage();
      const { context } = await contextFor({ url: "about:blank" }, undefined, system);
      const other = SSO.replace("a5.ucsd.edu", "sso.example.invalid");
      const unverifiedEntry = scenario === "unverified-entry";
      const landing = unverifiedEntry ? kronosSso : scenario === "wrong-origin" ? other : SSO;
      const config = {
        ...context.config,
        timeouts: { ...context.config.timeouts, navigationMs: 1000 },
        urls: {
          ...context.config.urls,
          crm: { prod: {
            ...context.config.urls.crm.prod,
            entry: unverifiedEntry ? "https://crm.ucsd.edu/other" : context.config.urls.crm.prod.entry,
          } },
          kuali: { prod: { entry: landing } },
          newKronos: { prod: { entry: landing } },
        },
      };
      const entry = new URL(resolveSystemLoginUrl(config, system, "prod", "fixture")).href;
      const fieldPage = form(scenario === "wrong-destination" ? other : landing)
        + '<select id="authtype"><option value="_eventId_authn/PasswordAD" selected>AD</option></select>';
      let servedForm = false;
      let credentialReads = 0;
      let posts = 0;
      await browserContext.route("**/*", async route => {
        if (route.request().method() === "POST") {
          posts++;
          await route.abort();
          return;
        }
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
      const signing = recipe({
        ...context, page, config,
        get credentials(): typeof context.credentials {
          credentialReads++;
          throw new Error("fixture stopped at credential acquisition");
        },
      });
      if (unverifiedEntry) {
        await assert.rejects(signing, error => error instanceof BrowserLoginError
          && error.system === "crm" && error.code === "CRM_SIGN_IN_FAILED" && error.step === "sso-form"
          && error.observedUrl === kronosSso && error.cause instanceof Error && error.cause.message === "UCSD_SSO_SCOPE");
      } else await assert.rejects(signing);
      assert.equal(servedForm, true);
      assert.equal(credentialReads, scenario === "trusted" ? 1 : 0);
      assert.equal(posts, 0);
      assert.equal(await page.locator("#ssopassword").inputValue(), "");
    } finally { await browserContext.close(); }
  });
}

it.each(["pinned destination", "wrong destination", "credentials unavailable"] as const)("signs in to ACT CRM through the UCSD SSO POST route only at the pinned destination (%s)", async scenario => {
  const browserContext = await guardedContext();
  try {
    const page = await browserContext.newPage();
    const { context, evidence } = await contextFor({ url: "about:blank" }, undefined, "crm");
    const entry = "https://crm.ucsd.edu/hr";
    const sso = kronosSso + "?execution=fixture";
    const application = "https://act-crm.my.site.com/hr/";
    const redirect = "https://act-crm.my.site.com/hr/fixture-sso-redirect";
    const wrongDestination = scenario === "wrong destination";
    const destination = wrongDestination ? SSO : sso;
    const posts: string[] = [];
    let credentialReads = 0;
    await browserContext.addCookies([{ url: application, name: "sid", value: "fixture" }]);
    await browserContext.route("**/*", route => {
      const request = route.request();
      const url = request.url();
      if (request.method() === "POST") {
        posts.push(url);
        if (url !== sso) return route.abort();
        return route.fulfill({ contentType: "text/html",
          body: `<meta http-equiv="refresh" content="1; url=${redirect}">` });
      }
      if (url === entry) return route.fulfill({ contentType: "text/html",
        body: `<meta http-equiv="refresh" content="0; url=${sso}">` });
      if (url === sso) return route.fulfill({ contentType: "text/html",
        body: form(destination) + '<select id="authtype"><option value="_eventId_authn/PasswordAD" selected>Active Directory</option></select>' });
      if (url === redirect) return route.fulfill({ contentType: "text/html",
        body: `<meta http-equiv="refresh" content="2; url=${application}">` });
      if (url === application) return route.fulfill({ contentType: "text/html", body: "<main>Onboarding</main>" });
      return route.abort();
    });
    const signing = crmLoginRecipe({
      ...context, page,
      get credentials() {
        credentialReads++;
        if (scenario === "credentials unavailable") throw new Error("fixture credential read refused");
        return context.credentials;
      },
    });
    if (scenario === "pinned destination") {
      assert.equal(await signing, "logged-in");
      assert.equal(credentialReads, 1);
      assert.deepEqual(posts, [sso]);
      assert.equal(evidence()[0]?.url, application);
    } else {
      await assert.rejects(signing, error => error instanceof BrowserLoginError
        && error.code === "CRM_SIGN_IN_FAILED" && error.step === (wrongDestination ? "sso-form" : "credential-fill")
        && error.cause instanceof Error && error.cause.message === (wrongDestination ? "UCSD_SSO_FIELDS" : "fixture credential read refused"));
      assert.equal(credentialReads, wrongDestination ? 0 : 1);
      assert.deepEqual(posts, []);
      assert.equal(await page.locator("#ssopassword").inputValue(), "");
    }
  } finally { await browserContext.close(); }
});

it.each(["application", "duo", "embedded-duo"] as const)("binds terminal refusal text to the Duo document (%s)", async surface => {
  const browserContext = await guardedContext();
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
  const context = await guardedContext();
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
  const context = await guardedContext();
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
  const context = await guardedContext();
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
  const context = await guardedContext();
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
  const context = await guardedContext();
  let focused: string | null = null;
  let html = form().replace("</form>", '<input type="hidden" name="focused" value="no"></form>'), acquisitions = 0, submissions = 0, current = true;
  await context.route("**/*", async route => {
    if (route.request().method() !== "GET") {
      submissions++;
      const values = new URLSearchParams(route.request().postData() ?? "");
      focused = values.get("focused"); assert.ok(values.has("_eventId_proceed"));
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
    await page.locator("form").evaluate(form => {
      const focused = form.querySelector('input[name="focused"]');
      if (!(focused instanceof HTMLInputElement)) throw new Error("missing focus observation");
      form.addEventListener("focusin", () => { focused.value = "yes"; });
    });
    await submitPinnedUcsdSsoCredentials(page, acquire, assertCurrent, 1000, "/tritON/profile/SAML2/Redirect/SSO");
    assert.equal(await page.locator("body").textContent(), "Awaiting native MFA");
    assert.equal(acquisitions, 1); assert.equal(submissions, 1);
    assert.equal(focused, "no");
    for (const [url, body] of [
      [SSO.replace("a5.ucsd.edu", "a5.ucsd.edu.invalid"), form()],
      [SSO.replace("https:", "http:"), form()],
      [SSO.replace("/tritON/", "/other/"), form()],
      [SSO, form("https://a5.ucsd.edu.invalid/tritON/profile/SAML2/Redirect/SSO")],
      [SSO, form("https://wrong@a5.ucsd.edu/tritON/profile/SAML2/Redirect/SSO")],
      [SSO, form("https://a5.ucsd.edu:444/tritON/profile/SAML2/Redirect/SSO")],
      [SSO, '<base target="_blank">' + form()],
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
  const context = await guardedContext();
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
