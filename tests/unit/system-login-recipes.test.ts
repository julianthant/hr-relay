/**
 * The UCPath and CRM login recipes (doc 05 §4).
 *
 * These flows drive REAL HR systems, so every arm here is about the same
 * question: can this code ever report "authenticated" without having observed
 * it? The landing predicates carry live-verified legacy knowledge and are
 * tested exhaustively; the flows are tested for their fail-loud behavior on
 * each step, including the landings that LOOK authenticated and are not.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { resolveConfig } from "../../src/domain/config/resolve.js";
import { BrowserLoginError } from "../../src/infra/browser/login-contract.js";
import type { SystemLoginContext } from "../../src/infra/browser/login-contract.js";
import { crmLoginRecipe, isAuthenticatedCrmUrl } from "../../src/stores/crm/session.js";
import { isAuthenticatedUcpathAppUrl, ucpathLoginRecipe } from "../../src/stores/ucpath/session.js";
import { fakeLoginPage, type FakePageScript } from "./fixtures/fake-login-page.js";

const CONFIG = resolveConfig({}, {}, manualClock(new Date("2026-08-03T09:00:00.000Z")));
const CREDENTIALS = Object.freeze({ userId: "fixture-user", password: "fixture-value" });
const UCPATH_APP = "https://ucphrprdpub.universityofcalifornia.edu/psc/ucphrprd/EMPLOYEE/HRMS/c/app";
const UCPATH_PORTAL = CONFIG.urls.ucpath.prod.login;
const SSO = "https://a5.ucsd.edu/idp/profile/SAML2/Redirect/SSO";
const DISCOVERY = "https://ucpath.universityofcalifornia.edu/ucpathdiscovery/disco?entity=ucsd";
const CRM_APP = "https://act-crm.my.site.com/hr/ONB_SearchOnboardings";
const CRM_ENTRY = CONFIG.urls.crm.prod.entry;

function contextFor(script: FakePageScript, signal = new AbortController().signal): {
  context: SystemLoginContext;
  harness: ReturnType<typeof fakeLoginPage>;
} {
  const harness = fakeLoginPage(script);
  return {
    harness,
    context: {
      page: harness.page,
      config: CONFIG,
      instance: "prod",
      label: "worker person-lookup-worker-1 session",
      signal,
      credentials: CREDENTIALS,
    },
  };
}

describe("ucpath landing verification", () => {
  it("accepts only the authenticated application URL", () => {
    assert.equal(isAuthenticatedUcpathAppUrl(UCPATH_APP), true);
    for (const rejected of [
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
});

describe("crm landing verification", () => {
  it("accepts only the authenticated Communities app", () => {
    assert.equal(isAuthenticatedCrmUrl(CRM_APP), true);
    for (const rejected of [
      "https://act-crm.my.site.com/hr/login",
      "https://crm.ucsd.edu/hr",
      SSO,
      "chrome-error://chromewebdata/",
    ]) {
      assert.equal(isAuthenticatedCrmUrl(rejected), false, rejected);
    }
  });
});

describe("ucpath login recipe", () => {
  it("reuses an already-authenticated page without navigating", async () => {
    const { context, harness } = contextFor({ url: UCPATH_APP });
    assert.equal(await ucpathLoginRecipe(context), "already-authenticated");
    assert.deepEqual(harness.actions(), []);
    assert.deepEqual(harness.filled(), []);
  });

  it("walks portal → campus discovery → SSO → verified landing", async () => {
    const { context, harness } = contextFor({
      url: "about:blank",
      navigation: { [UCPATH_PORTAL]: UCPATH_PORTAL },
      elements: {
        "portal-login": { navigatesTo: DISCOVERY },
        "campus-link": { navigatesTo: SSO },
        "sso-submit": {},
        "sso-username": {},
        "sso-password": {},
      },
      elementsByUrl: { [UCPATH_APP]: { "sso-submit": { count: 0 } } },
      settlesTo: [UCPATH_APP],
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
  });

  it("fails loud, naming the step, when the SSO form never renders", async () => {
    const { context } = contextFor({
      url: "about:blank",
      elements: {
        "portal-login": { navigatesTo: SSO },
        "sso-submit": { count: 0 },
      },
    });
    await assert.rejects(ucpathLoginRecipe(context), (error: unknown) => {
      assert.ok(error instanceof BrowserLoginError);
      assert.equal(error.system, "ucpath");
      assert.equal(error.step, "sso-form");
      assert.match(error.message, /SSO form never rendered/);
      return true;
    });
  });

  it("fails loud when Duo never clears, and never names a credential", async () => {
    const { context } = contextFor({
      url: "about:blank",
      elements: {
        "portal-login": { navigatesTo: SSO },
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

  it("diagnoses the Shibboleth stale-request page specifically", async () => {
    const { context } = contextFor({
      url: "about:blank",
      elements: {
        "portal-login": { navigatesTo: SSO },
        "sso-submit": {},
        "sso-username": {},
        "sso-password": {},
        "stale-request": { count: 1 },
      },
      settlesTo: [],
    });
    await assert.rejects(ucpathLoginRecipe(context), /stale-request page; the SAML execution expired/);
  });

  it("refuses a landing that still shows the SSO form", async () => {
    const { context } = contextFor({
      url: "about:blank",
      elements: {
        "portal-login": { navigatesTo: SSO },
        "sso-submit": {},
        "sso-username": {},
        "sso-password": {},
      },
      settlesTo: [UCPATH_APP],
    });
    await assert.rejects(ucpathLoginRecipe(context), (error: unknown) => {
      assert.ok(error instanceof BrowserLoginError);
      assert.equal(error.step, "verify-landing");
      assert.match(error.message, /SSO form is still present/);
      return true;
    });
  });

  it("stops on cancellation instead of finishing the ceremony", async () => {
    const controller = new AbortController();
    controller.abort();
    const { context, harness } = contextFor({ url: "about:blank" }, controller.signal);
    await assert.rejects(ucpathLoginRecipe(context), /login failed at navigate-login-entry: the session was cancelled/);
    assert.deepEqual(harness.actions(), []);
  });
});

describe("crm login recipe", () => {
  it("selects Active Directory only when the control disagrees", async () => {
    const preselected = contextFor({
      url: "about:blank",
      navigation: { [CRM_ENTRY]: SSO },
      elements: {
        "login-type-select": { value: "Active Directory" },
        "sso-submit": {},
        "sso-username": {},
        "sso-password": {},
      },
      elementsByUrl: { [CRM_APP]: { "sso-submit": { count: 0 } } },
      settlesTo: [CRM_APP],
    });
    assert.equal(await crmLoginRecipe(preselected.context), "logged-in");
    assert.equal(preselected.harness.actions().includes("select:login-type-select"), false);

    const wrongType = contextFor({
      url: "about:blank",
      navigation: { [CRM_ENTRY]: SSO },
      elements: {
        "login-type-select": { value: "Salesforce" },
        "sso-submit": {},
        "sso-username": {},
        "sso-password": {},
      },
      elementsByUrl: { [CRM_APP]: { "sso-submit": { count: 0 } } },
      settlesTo: [CRM_APP],
    });
    assert.equal(await crmLoginRecipe(wrongType.context), "logged-in");
    assert.equal(wrongType.harness.actions().includes("select:login-type-select"), true);

    // Absent control: a genuinely valid rendering, so it is not a failure.
    const absent = contextFor({
      url: "about:blank",
      navigation: { [CRM_ENTRY]: SSO },
      elements: {
        "login-type-select": { count: 0 },
        "sso-submit": {},
        "sso-username": {},
        "sso-password": {},
      },
      elementsByUrl: { [CRM_APP]: { "sso-submit": { count: 0 } } },
      settlesTo: [CRM_APP],
    });
    assert.equal(await crmLoginRecipe(absent.context), "logged-in");
  });

  it("fails loud when a present login-type control cannot be set", async () => {
    const { context } = contextFor({
      url: "about:blank",
      navigation: { [CRM_ENTRY]: SSO },
      elements: { "login-type-select": { failWith: "detached" } },
    });
    await assert.rejects(crmLoginRecipe(context), (error: unknown) => {
      assert.ok(error instanceof BrowserLoginError);
      assert.equal(error.system, "crm");
      assert.equal(error.step, "sso-form");
      assert.match(error.message, /Active Directory could not be selected/);
      return true;
    });
  });

  it("treats the Communities login page as unauthenticated, not as a landing", async () => {
    const { context } = contextFor({
      url: "about:blank",
      navigation: { [CRM_ENTRY]: "https://act-crm.my.site.com/hr/login" },
      elements: {
        "login-type-select": { count: 0 },
        "sso-submit": {},
        "sso-username": {},
        "sso-password": {},
        "stale-request": { count: 0 },
      },
      settlesTo: [],
    });
    await assert.rejects(crmLoginRecipe(context), (error: unknown) => {
      assert.ok(error instanceof BrowserLoginError);
      assert.equal(error.step, "duo-clearance");
      return true;
    });
  });
});
