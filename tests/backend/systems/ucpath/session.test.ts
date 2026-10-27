import { createSystemSessionTestWorld } from "../../../support/helpers/backend/system-session-world.js";
import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { ERROR_CATALOG } from "../../../../src/models/failures/error-catalog.js";
import { BrowserLoginError, BrowserLandingStallError } from "../../../../src/backend/systems/browser-shared/login-contract.js";
import { isAuthenticatedUcpathAppUrl, isUcpathPostSsoLanding, ucpathLoginRecipe, verifyUcpathAuthenticatedApplication } from "../../../../src/backend/systems/ucpath/session.js";
import { NEVER_SETTLES, type FakeCookie, type FakePageScript } from "../../../support/helpers/browser/fake-login-page.js";

const { CONFIG, CREDENTIALS, SSO, NO_SIGN_IN_FORMS, contextFor } = createSystemSessionTestWorld();

const UCPATH_APP = "https://ucphrprdpub.universityofcalifornia.edu/psc/ucphrprd/EMPLOYEE/HRMS/c/app";
const UCPATH_ENTRY = CONFIG.urls.ucpath.prod.smartHr;
const UCPATH_PORTAL = CONFIG.urls.ucpath.prod.login;
/** The page that produced the false pass: public, unauthenticated, same host. */
const UCPATH_PUBLIC_PORTAL = "https://ucpath.universityofcalifornia.edu/";

const DUO_PROMPT = "https://api-ce13a1a7.duosecurity.com/prompt/DA6QL3UFNF54WTIT1EQC";
const DISCOVERY = "https://ucpath.universityofcalifornia.edu/ucpathdiscovery/disco?entity=ucsd";

/** PeopleSoft's single-signon token, issued only after a completed sign-in. */
const PS_TOKEN: FakeCookie = {
  name: "PS_TOKEN",
  domain: "ucphrprdpub.universityofcalifornia.edu",
  value: "opaque",
};

describe("ucpath landing verification", () => {
  it("requires a PeopleSoft application route, not just the UC host", () => {
    assert.equal(isAuthenticatedUcpathAppUrl(UCPATH_APP), true);
    assert.equal(isAuthenticatedUcpathAppUrl(UCPATH_ENTRY), true);
    assert.equal(
      isAuthenticatedUcpathAppUrl(
        "https://ucphrprdpub.universityofcalifornia.edu/psp/ucphrprd/EMPLOYEE/HRMS/c/profile",
      ),
      true,
    );
    for (const rejected of [

      UCPATH_PUBLIC_PORTAL,
      "https://ucpath.universityofcalifornia.edu/dashboard",
      DISCOVERY,
      SSO,
      "https://duosecurity.com/frame/prompt",
      "https://ucpath.ucsd.edu/login",
      // PeopleSoft classic-PIA expiry lands on the SAME host as a real page.
      "https://ucphrprdpub.universityofcalifornia.edu/psp/ucphrprd/?cmd=login",
      "https://ucphrprdpub.universityofcalifornia.edu/psp/ucphrprd/?cmd=expire",
      "https://ucphrprdpub.universityofcalifornia.edu/Shibboleth.sso/SAML2/POST",
      "chrome-error://chromewebdata/",
    ]) {
      assert.equal(isAuthenticatedUcpathAppUrl(rejected), false, rejected);
    }
  });

  it("keeps the post-SSO WAIT predicate deliberately wider than the proof", () => {
    // The portal IS a legitimate place for the SSO chain to come back to; it is
    // simply not the application. Conflating the two is the defect.
    assert.equal(isUcpathPostSsoLanding(UCPATH_PUBLIC_PORTAL), true);
    assert.equal(isAuthenticatedUcpathAppUrl(UCPATH_PUBLIC_PORTAL), false);
    assert.equal(isUcpathPostSsoLanding(DISCOVERY), false);
    assert.equal(isUcpathPostSsoLanding(SSO), false);
  });
});

describe("authenticated-application proof", () => {
  it("proves a UCPath session from the session cookie AND the absent sign-in forms", async () => {
    const { context, evidence } = await contextFor({
      url: UCPATH_APP,
      elements: NO_SIGN_IN_FORMS,
      cookies: [PS_TOKEN],
    });
    const probe = await verifyUcpathAuthenticatedApplication(context);
    assert.ok(probe.authenticated);
    assert.equal(probe.evidence.system, "ucpath");
    assert.equal(probe.evidence.url, UCPATH_APP);
    assert.match(probe.evidence.positive, /PS_TOKEN session cookie/);
    assert.match(probe.evidence.negative, /TritON SSO form is absent/);
    assert.match(probe.evidence.negative, /PeopleSoft signon form is absent/);
    // A probe is not an assertion: nothing is recorded until something asserts.
    assert.deepEqual(evidence(), []);
  });

  it("refuses the public portal even when a session cookie exists", async () => {
    const { context } = await contextFor({
      url: UCPATH_PUBLIC_PORTAL,
      elements: NO_SIGN_IN_FORMS,
      cookies: [PS_TOKEN],
    });
    const probe = await verifyUcpathAuthenticatedApplication(context);
    assert.ok(!probe.authenticated);
    assert.match(probe.reason, /not a UCPath PeopleSoft application route/);
  });

  it("refuses the PeopleSoft signon page, which shares the application's URL shape", async () => {

    const { context } = await contextFor({
      url: UCPATH_ENTRY,
      elements: { ...NO_SIGN_IN_FORMS, "peoplesoft-signon": { count: 1 } },
    });
    const probe = await verifyUcpathAuthenticatedApplication(context);
    assert.ok(!probe.authenticated);
    // The cookie is checked first, so THAT is what indicts the page; the form
    // is the backstop for a session that exists but has dropped to signon.
    assert.match(probe.reason, /never issued its PS_TOKEN session cookie/);

    const withStaleSession = await contextFor({
      url: UCPATH_ENTRY,
      elements: { ...NO_SIGN_IN_FORMS, "peoplesoft-signon": { count: 1 } },
      cookies: [PS_TOKEN],
    });
    const second = await verifyUcpathAuthenticatedApplication(withStaleSession.context);
    assert.ok(!second.authenticated);
    assert.match(second.reason, /PeopleSoft signon form is still present/);
  });

  it("refuses a page still showing the UCSD SSO form", async () => {
    const { context } = await contextFor({
      url: UCPATH_APP,
      elements: { ...NO_SIGN_IN_FORMS, "sso-submit": { count: 1 } },
      cookies: [PS_TOKEN],
    });
    const probe = await verifyUcpathAuthenticatedApplication(context);
    assert.ok(!probe.authenticated);
    assert.match(probe.reason, /TritON SSO form is still present/);
  });

  it("does not accept PS_TOKENEXPIRE, a blank token, or a foreign domain", async () => {
    for (const issued of [
      { ...PS_TOKEN, name: "PS_TOKENEXPIRE" },
      { ...PS_TOKEN, value: "" },
      { ...PS_TOKEN, domain: "ucpath.ucsd.edu" },
    ]) {
      const { context } = await contextFor({
        url: UCPATH_APP,
        elements: NO_SIGN_IN_FORMS,
        cookies: [issued],
      });
      const probe = await verifyUcpathAuthenticatedApplication(context);
      assert.ok(!probe.authenticated, `${issued.name} ${issued.domain}`);
      assert.match(probe.reason, /never issued its PS_TOKEN session cookie/);
    }
  });

  it("treats an unreadable cookie store as unproven, never as proven", async () => {
    const { context } = await contextFor({
      url: UCPATH_APP,
      elements: NO_SIGN_IN_FORMS,
      cookieStoreFailsWith: "context detached",
    });
    const probe = await verifyUcpathAuthenticatedApplication(context);
    assert.ok(!probe.authenticated);
    assert.match(probe.reason, /could not be read, so UCPath PeopleSoft cannot be proven/);
  });
});

describe("ucpath login recipe", () => {
  it("reuses a PROVEN session without navigating, and records what proved it", async () => {
    const { context, harness, evidence } = await contextFor({
      url: UCPATH_APP,
      elements: NO_SIGN_IN_FORMS,
      cookies: [PS_TOKEN],
    });
    assert.equal(await ucpathLoginRecipe(context), "already-authenticated");
    assert.deepEqual(harness.actions(), []);
    assert.deepEqual(harness.filled(), []);
    assert.equal(evidence().length, 1);
    assert.match(evidence()[0]?.positive ?? "", /PS_TOKEN/);
  });

  it("REGRESSION: the public portal never short-circuits the login", async () => {

    const { context, harness } = await contextFor({
      url: "about:blank",
      navigation: { [UCPATH_PORTAL]: UCPATH_PUBLIC_PORTAL },
      elements: {
        "portal-login": { navigatesTo: SSO },
        "campus-link": { count: 0 },
        "sso-submit": { count: 0 },
      },

      cookies: [PS_TOKEN],
    });
    await assert.rejects(ucpathLoginRecipe(context), (error: unknown) => {
      assert.ok(error instanceof BrowserLoginError);
      assert.equal(error.step, "navigate-login-entry");
      assert.match(error.detail, /neither campus discovery, nor the SSO form/);
      return true;
    });
    assert.equal(harness.actions().includes("click:portal-login"), true);
  });

  it("walks portal → campus discovery → SSO → verified landing", async () => {
    const { context, harness, evidence } = await contextFor({
      url: "about:blank",
      navigation: { [UCPATH_PORTAL]: UCPATH_PORTAL },
      elements: {
        "portal-login": { navigatesTo: DISCOVERY },
        "campus-link": { navigatesTo: SSO },
        "sso-submit": {},
        "sso-username": {},
        "sso-password": {},
      },
      elementsByUrl: { [UCPATH_APP]: NO_SIGN_IN_FORMS },
      settlesTo: [UCPATH_APP],
      cookiesByUrl: { [UCPATH_APP]: [PS_TOKEN] },
    });
    assert.equal(await ucpathLoginRecipe(context), "logged-in");
    assert.deepEqual(harness.actions(), [
      `goto:${UCPATH_PORTAL}`,
      "click:portal-login",
      "click:campus-link",
      "click:sso-submit",
    ]);
    assert.deepEqual(harness.filled(), [
      `sso-username=${CREDENTIALS.userId}`,
      `sso-password=${CREDENTIALS.password}`,
    ]);
    assert.equal(harness.url(), UCPATH_APP);
    assert.equal(evidence().length, 1);
  });

  it("enters the application when SSO returns to the portal instead", async () => {
    const { context, harness } = await contextFor({
      url: "about:blank",
      navigation: { [UCPATH_PORTAL]: UCPATH_PORTAL, [UCPATH_ENTRY]: UCPATH_APP },
      elements: {
        "portal-login": { navigatesTo: SSO },
        "campus-link": { count: 0 },
        "sso-submit": {},
        "sso-username": {},
        "sso-password": {},
      },
      elementsByUrl: { [UCPATH_APP]: NO_SIGN_IN_FORMS },
      settlesTo: [UCPATH_PUBLIC_PORTAL],
      cookiesByUrl: { [UCPATH_APP]: [PS_TOKEN] },
    });
    assert.equal(await ucpathLoginRecipe(context), "logged-in");
    assert.equal(harness.actions().includes(`goto:${UCPATH_ENTRY}`), true);
    assert.equal(harness.url(), UCPATH_APP);
  });

  // UCPath BuildPage redirects can interrupt goto before the requested application route settles.
  const buildPage = new URL(
    "/psp/ucphrprd/EMPLOYEE/HRMS/s/WEBLIB_IS_PB.ISCRIPT1.FieldFormula.IScript_BuildPage",
    UCPATH_ENTRY,
  ).href;
  const interruptedEntry = `page.goto: Navigation to "${UCPATH_ENTRY}" is interrupted by another navigation to "${buildPage}"`;

  async function interruptedLanding(overrides: Partial<FakePageScript> = {}): Promise<Awaited<ReturnType<typeof contextFor>>> {
    return await contextFor({
      url: "about:blank",
      elements: {
        "portal-login": { navigatesTo: SSO },
        "campus-link": { count: 0 },
        "sso-submit": {},
        "sso-username": {},
        "sso-password": {},
      },
      elementsByUrl: { [UCPATH_ENTRY]: NO_SIGN_IN_FORMS },
      navigationFailures: { [UCPATH_ENTRY]: { message: interruptedEntry, landedAt: buildPage } },
      settlesTo: [UCPATH_PUBLIC_PORTAL, UCPATH_ENTRY],
      cookiesByUrl: { [UCPATH_ENTRY]: [PS_TOKEN] },
      ...overrides,
    });
  }

  it("observes the exact entry after the known BuildPage interruption and proves authentication", async () => {
    const { context, harness, evidence } = await interruptedLanding();
    assert.equal(await ucpathLoginRecipe(context), "logged-in");
    assert.equal(harness.url(), UCPATH_ENTRY);
    assert.equal(harness.actions().filter((action) => action === `goto:${UCPATH_ENTRY}`).length, 1);
    assert.equal(evidence().length, 1);
  });

  it.each([
    ["missing session cookie", { cookiesByUrl: {} }],
    ["remaining sign-in form", { elementsByUrl: { [UCPATH_ENTRY]: { ...NO_SIGN_IN_FORMS, "peoplesoft-signon": { count: 1 } } } }],
    ["wrong final route", { settlesTo: [UCPATH_PUBLIC_PORTAL, UCPATH_APP] }],
    ["unsettled redirect", { settlesTo: [UCPATH_PUBLIC_PORTAL, undefined] }],
    ["foreign redirect", { navigationFailures: { [UCPATH_ENTRY]: { message: interruptedEntry, landedAt: "https://example.invalid/psp/ucphrprd/EMPLOYEE/HRMS/s/WEBLIB_IS_PB.ISCRIPT1.FieldFormula.IScript_BuildPage" } } }],
    ["unrelated navigation error", { navigationFailures: { [UCPATH_ENTRY]: { message: "page.goto: net::ERR_CONNECTION_RESET", landedAt: buildPage } } }],
  ] satisfies ReadonlyArray<readonly [string, Partial<FakePageScript>]>) ("refuses the interrupted entry with %s", async (_name, overrides) => {
    const { context, harness, evidence } = await interruptedLanding(overrides);
    await assert.rejects(ucpathLoginRecipe(context), (error: unknown) => {
      assert.ok(error instanceof BrowserLoginError);
      assert.equal(error.step, "verify-landing");
      return true;
    });
    assert.equal(harness.actions().filter((action) => action === `goto:${UCPATH_ENTRY}`).length, 1);
    assert.deepEqual(evidence(), []);
  });

  it("refuses a logged-in landing that never got a PeopleSoft session", async () => {
    const { context } = await contextFor({
      url: "about:blank",
      navigation: { [UCPATH_PORTAL]: UCPATH_PORTAL },
      elements: {
        "portal-login": { navigatesTo: SSO },
        "campus-link": { count: 0 },
        "sso-submit": {},
        "sso-username": {},
        "sso-password": {},
      },
      elementsByUrl: { [UCPATH_APP]: NO_SIGN_IN_FORMS },
      settlesTo: [UCPATH_APP],
    });
    await assert.rejects(ucpathLoginRecipe(context), (error: unknown) => {
      assert.ok(error instanceof BrowserLoginError);
      assert.equal(error.step, "verify-landing");
      assert.match(error.detail, /the login could not prove the authenticated application/);
      assert.match(error.detail, /never issued its PS_TOKEN session cookie/);
      return true;
    });
  });

  it("fails loud, naming the step, when the SSO form never renders", async () => {
    const { context } = await contextFor({
      url: "about:blank",
      elements: {
        "portal-login": { navigatesTo: DISCOVERY },
        "campus-link": { navigatesTo: SSO },
      },
      elementsByUrl: { [SSO]: { "campus-link": { count: 0 }, "sso-submit": { count: 0 } } },
    });
    await assert.rejects(ucpathLoginRecipe(context), (error: unknown) => {
      assert.ok(error instanceof BrowserLoginError);
      assert.equal(error.system, "ucpath");
      assert.equal(error.step, "sso-form");
      assert.match(error.detail, /SSO form never rendered/);
      return true;
    });
  });

  it("fails loud, naming the stale chain, when the username field matches nothing", async () => {

    const { context, harness } = await contextFor({
      url: "about:blank",
      elements: {
        "portal-login": { navigatesTo: SSO },
        "campus-link": { count: 0 },
        "sso-submit": {},
        "sso-username": { count: 0 },
        "sso-password": {},
      },
    });
    await assert.rejects(ucpathLoginRecipe(context), (error: unknown) => {
      assert.ok(error instanceof BrowserLoginError);
      assert.equal(error.step, "credential-fill");
      assert.match(error.detail, /username field matched no element/);
      assert.match(error.detail, /ssousername/);
      return true;
    });
    assert.deepEqual(harness.filled(), [], "nothing may be typed into an unidentified page");
  });

  it("fails loud when Duo never clears, and never names a credential", async () => {
    const { context } = await contextFor({
      url: "about:blank",
      elements: {
        "portal-login": { navigatesTo: SSO },
        "campus-link": { count: 0 },
        "sso-submit": {},
        "sso-username": {},
        "sso-password": {},
        "stale-request": { count: 0 },
      },
      settlesTo: [],
    });
    await assert.rejects(ucpathLoginRecipe(context), (error: unknown) => {
      assert.ok(error instanceof BrowserLoginError);
      assert.equal(error.step, "duo-clearance");
      assert.doesNotMatch(error.message, /fixture-value|fixture-user/);
      return true;
    });
  });

  it("refuses the moment Duo renders its terminal refusal, without waiting out the landing", async () => {

    const { context } = await contextFor({
      url: "about:blank",
      elements: {
        "portal-login": { navigatesTo: SSO },
        "campus-link": { count: 0 },
        "sso-submit": { navigatesTo: DUO_PROMPT },
        "sso-username": {},
        "sso-password": {},
        "duo-refusal": { count: 1 },
      },
      settlesTo: [NEVER_SETTLES],
    });
    const settled: unknown = await Promise.race([
      ucpathLoginRecipe(context).then(() => "the recipe reported success", (error: unknown) => error),
      new Promise((resolve) => setTimeout(() => resolve("the recipe was still waiting"), 500)),
    ]);
    assert.ok(settled instanceof BrowserLoginError, `expected a refusal; got ${String(settled)}`);
    assert.equal(settled.step, "duo-clearance");
    assert.equal(settled.message, ERROR_CATALOG.DUO_TERMINAL_REFUSAL.text);
    assert.match(settled.message, /Duo refused/);
    assert.doesNotMatch(settled.message, /fixture-value|fixture-user/);
  });

  it("still reports a plain Duo stall as a stall — the refusal probe is not a catch-all", async () => {

    const { context } = await contextFor({
      url: "about:blank",
      elements: {
        "portal-login": { navigatesTo: SSO },
        "campus-link": { count: 0 },
        "sso-submit": { navigatesTo: DUO_PROMPT },
        "sso-username": {},
        "sso-password": {},
        "stale-request": { count: 0 },
        "duo-refusal": { count: 0 },
      },
      settlesTo: [],
    });
    await assert.rejects(ucpathLoginRecipe(context), (error: unknown) => {
      assert.ok(error instanceof BrowserLoginError);
      assert.equal(error.step, "duo-clearance");
      assert.match(error.message, /The Duo prompt never cleared/);
      assert.equal(error.message, ERROR_CATALOG.DUO_PROMPT_STALLED.text);
      return true;
    });
  });

  it("diagnoses a landing before acquisition expires and excludes URL secrets", async () => {
    const { context } = await contextFor({
      url: "about:blank",
      elements: {
        "portal-login": { navigatesTo: SSO }, "campus-link": { count: 0 },
        "sso-submit": { navigatesTo: `${DUO_PROMPT}?token=private#private` },
        "sso-username": {}, "sso-password": {}, "stale-request": { count: 0 },
        "duo-refusal": { count: 0 },
      },
    });
    let observedTimeout = 0;
    context.page.waitForURL = async (_predicate, options) => {
      observedTimeout = options?.timeout ?? 0;
      throw new Error("fixture landing timeout with private detail");
    };
    context.page.title = async () => "Duo https://auth.example/?private#private";
    await assert.rejects(ucpathLoginRecipe({ ...context, acquisitionRemainingMs: () => 600 }), error => {
      assert.ok(error instanceof BrowserLandingStallError);
      assert.equal(error.code, "DUO_PROMPT_STALLED");
      assert.equal(error.host, "api-ce13a1a7.duosecurity.com");
      assert.equal(error.path, "/prompt/DA6QL3UFNF54WTIT1EQC");
      assert.equal(error.title, "Duo [URL]");
      assert.doesNotMatch(error.message, /private|token=/);
      assert.equal(observedTimeout, 300);
      return true;
    });
  });

  it("bounds a stuck diagnosis before the acquisition deadline", async () => {
    const { context } = await contextFor({
      url: "about:blank",
      elements: {
        "portal-login": { navigatesTo: SSO }, "campus-link": { count: 0 },
        "sso-submit": {}, "sso-username": {}, "sso-password": {},
      },
    });
    context.page.title = async () => await new Promise<string>(() => undefined);
    const timers = vi.spyOn(globalThis, "setTimeout");
    try {
      await assert.rejects(ucpathLoginRecipe({ ...context, acquisitionRemainingMs: () => 150 }), error => {
        assert.ok(error instanceof BrowserLandingStallError);
        assert.equal(error.code, "LANDING_PROBE_UNAVAILABLE");
        assert.equal(error.title, "");
        return true;
      });
      assert.ok(timers.mock.calls.some(([, delay]) => delay === 50));
    } finally { timers.mockRestore(); }
  });

  it("recovers a visible Shibboleth stale request once inside the same ceremony deadline", async () => {
    const stale = `${SSO}?execution=private`;
    const { context, harness } = await contextFor({
      url: "about:blank",
      elements: {
        "portal-login": { navigatesTo: SSO }, "campus-link": { count: 0 },
        "sso-submit": { navigatesTo: stale }, "sso-username": {}, "sso-password": {},
        "stale-request": { count: 0 },
      },
      elementsByUrl: { [stale]: { "stale-request": { count: 1 } }, [UCPATH_APP]: NO_SIGN_IN_FORMS },
      settlesTo: [UCPATH_APP], cookiesByUrl: { [UCPATH_APP]: [PS_TOKEN] },
    });
    const originalWait = context.page.waitForURL.bind(context.page);
    let waits = 0;
    let remaining = 60_000;
    const waitBudgets: number[] = [];
    context.page.waitForURL = async (predicate, options) => {
      waitBudgets.push(options?.timeout ?? 0);
      if (waits++ === 0) {
        remaining = 45_000;
        return await new Promise<void>(() => undefined);
      }
      return originalWait(predicate, options);
    };
    let gates = 0;
    const originalGate = context.duoCeremony;
    const bounded = { ...context, acquisitionRemainingMs: () => remaining,
      duoCeremony: originalGate };
    bounded.duoCeremony = { withCeremony: async run => {
      gates += 1;
      return originalGate.withCeremony(run);
    } };
    assert.equal(await ucpathLoginRecipe(bounded), "logged-in");
    assert.equal(gates, 1);
    assert.deepEqual(waitBudgets, [59_000, 44_000]);
    assert.equal(harness.actions().filter(action => action === `goto:${UCPATH_PORTAL}`).length, 2);
    assert.equal(harness.actions().filter(action => action === "click:sso-submit").length, 2);
  });

  it("refuses stale text outside UCSD Shibboleth and an exhausted recovery budget", async () => {
    for (const [stalled, remaining, code, canRecover] of [
      ["https://other.example/stale", 60_000, "SSO_FIRST_FACTOR_REJECTED", true],
      [SSO, 1_000, "SHIBBOLETH_STALE_REQUEST", true],
      [SSO, 60_000, "SHIBBOLETH_STALE_REQUEST", false],
    ] as const) {
      const { context, harness } = await contextFor({
        url: "about:blank",
        elements: {
          "portal-login": { navigatesTo: SSO }, "campus-link": { count: 0 },
          "sso-submit": { navigatesTo: stalled }, "sso-username": {}, "sso-password": {},
          "stale-request": { count: 1 },
        },
      });
      await assert.rejects(ucpathLoginRecipe({ ...context, acquisitionRemainingMs: () => remaining, claimStaleRequestRecovery: () => canRecover }), error => {
        assert.ok(error instanceof BrowserLandingStallError);
        assert.equal(error.code, code);
        return true;
      });
      assert.equal(harness.actions().filter(action => action === `goto:${UCPATH_PORTAL}`).length, 1);
    }
  });

  it("diagnoses the Shibboleth stale-request page specifically", async () => {
    const { context, harness } = await contextFor({
      url: "about:blank",
      elements: {
        "portal-login": { navigatesTo: SSO },
        "campus-link": { count: 0 },
        "sso-submit": {},
        "sso-username": {},
        "sso-password": {},
        "stale-request": { count: 1 },
      },
      settlesTo: [],
    });
    await assert.rejects(ucpathLoginRecipe(context), /stale-request page; the SAML execution expired/);
    assert.equal(harness.actions().filter(action => action === `goto:${UCPATH_PORTAL}`).length, 2);
  });

  it("refuses a landing that still shows the SSO form", async () => {
    const { context } = await contextFor({
      url: "about:blank",
      elements: {
        "portal-login": { navigatesTo: SSO },
        "campus-link": { count: 0 },
        "sso-submit": {},
        "sso-username": {},
        "sso-password": {},
      },
      elementsByUrl: { [UCPATH_APP]: { "peoplesoft-signon": { count: 0 } } },
      settlesTo: [UCPATH_APP],
      cookiesByUrl: { [UCPATH_APP]: [PS_TOKEN] },
    });
    await assert.rejects(ucpathLoginRecipe(context), (error: unknown) => {
      assert.ok(error instanceof BrowserLoginError);
      assert.equal(error.step, "verify-landing");
      assert.match(error.detail, /TritON SSO form is still present/);
      return true;
    });
  });

  it("stops on cancellation instead of finishing the ceremony", async () => {
    const controller = new AbortController();
    controller.abort();
    const { context, harness } = await contextFor({ url: "about:blank" }, controller.signal);
    await assert.rejects(ucpathLoginRecipe(context), (error: unknown) => {
      assert.ok(error instanceof BrowserLoginError);
      assert.equal(error.code, "UCPATH_SIGN_IN_FAILED");
      assert.equal(error.step, "navigate-login-entry");
      assert.equal(error.detail, "the session was cancelled");
      return true;
    });
    assert.deepEqual(harness.actions(), []);
  });
});
