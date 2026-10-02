import { hostConfigFacts } from "../../../../../../src/models/config/host-display.js";
/**
 * The UCPath and CRM login recipes (ref execution-and-sessions §4).
 *
 * These flows drive REAL HR systems, so every arm here is about the same
 * question: can this code ever report "authenticated" without having observed
 * it? On 2026-08-03 the answer was yes — twice — so the arms below are written
 * against the two shapes that produced it:
 *
 *   - the PUBLIC UCPath portal, which sits inside the host substring the legacy
 *     landing predicate matched; and
 *   - PeopleSoft's signon page, which renders at the SAME route shape as the
 *     application it guards.
 *
 * Neither is distinguishable by URL, so the proof is content-level: a session
 * cookie the server only issues after a completed sign-in, plus the absence of
 * every sign-in form. The wrapper (`defineVerifiedLoginRecipe`) runs it on
 * EVERY return path, so the early "already authenticated" branch is pinned here
 * exactly as hard as the full login.
 */
import { fixtureDuoCeremonyGate } from "../../../../../support/helpers/duo-ceremony-fixtures.js";
import type { BrowserSystemId } from "../../../../../../src/rules/identity/ids.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import { resolveConfigWithProvenance } from "../../../../../../src/backend/app/config/resolve.js";
import { BrowserLoginError } from "../../../../../../src/backend/systems/browser-shared/login-contract.js";
import type {
  AuthenticatedApplicationEvidence,
  SystemLoginContext,
} from "../../../../../../src/backend/systems/browser-shared/login-contract.js";
import {
  crmLoginRecipe,
  isAuthenticatedCrmUrl,
  verifyCrmAuthenticatedApplication,
} from "../../../../../../src/backend/systems/crm/session.js";
import {
  isAuthenticatedUcpathAppUrl,
  isUcpathPostSsoLanding,
  ucpathLoginRecipe,
  verifyUcpathAuthenticatedApplication,
} from "../../../../../../src/backend/systems/ucpath/session.js";
import { verifyKualiAuthenticatedApplication } from "../../../../../../src/backend/systems/kuali/session.js";
import {
  NEVER_SETTLES,
  fakeLoginPage,
  type FakeCookie,
  type FakePageScript,
} from "../../../systems/browser-shared/fixtures/fake-login-page.js";

const CONFIG = resolveConfigWithProvenance({}, hostConfigFacts({}), manualClock(new Date("2026-08-03T09:00:00.000Z"))).config;
const CREDENTIALS = Object.freeze({ userId: "fixture-user", password: "fixture-value" });
const UCPATH_APP = "https://ucphrprdpub.universityofcalifornia.edu/psc/ucphrprd/EMPLOYEE/HRMS/c/app";
const UCPATH_ENTRY = CONFIG.urls.ucpath.prod.smartHr;
const UCPATH_PORTAL = CONFIG.urls.ucpath.prod.login;
/** The page that produced the false pass: public, unauthenticated, same host. */
const UCPATH_PUBLIC_PORTAL = "https://ucpath.universityofcalifornia.edu/";
const SSO = "https://a5.ucsd.edu/idp/profile/SAML2/Redirect/SSO";
/** The Duo Universal Prompt, as the live wedge observed it (§9.21, 2026-08-19). */
const DUO_PROMPT = "https://api-ce13a1a7.duosecurity.com/prompt/DA6QL3UFNF54WTIT1EQC";
const DISCOVERY = "https://ucpath.universityofcalifornia.edu/ucpathdiscovery/disco?entity=ucsd";
const CRM_APP = "https://act-crm.my.site.com/hr/ONB_SearchOnboardings";
const CRM_ENTRY = CONFIG.urls.crm.prod.entry;
/** Live-verified 2026-08-03 TritON login-type option values. */
const AD_TYPE = "_eventId_authn/PasswordAD";
const BUSINESS_TYPE = "_eventId_authn/PasswordRACF";

/** PeopleSoft's single-signon token, issued only after a completed sign-in. */
const PS_TOKEN: FakeCookie = {
  name: "PS_TOKEN",
  domain: "ucphrprdpub.universityofcalifornia.edu",
  value: "opaque",
};
const SID: FakeCookie = { name: "sid", domain: "act-crm.my.site.com", value: "opaque" };

/**
 * The page state of an authenticated app: no sign-in form of any kind, and no
 * campus-discovery link (discovery is detected by that link, not by a path).
 */
const NO_SIGN_IN_FORMS = {
  "campus-link": { count: 0 },
  "sso-submit": { count: 0 },
  "peoplesoft-signon": { count: 0 },
  "communities-login": { count: 0 },
} as const;

function contextFor(
  script: FakePageScript,
  signal = new AbortController().signal,
  system: BrowserSystemId = "ucpath",
): {
  context: SystemLoginContext;
  harness: ReturnType<typeof fakeLoginPage>;
  evidence: () => readonly AuthenticatedApplicationEvidence[];
} {
  const harness = fakeLoginPage(script);
  const recorded: AuthenticatedApplicationEvidence[] = [];
  return {
    harness,
    evidence: () => Object.freeze([...recorded]),
    context: {
      page: harness.page,
      config: CONFIG,
      instance: "prod",
      label: "worker person-lookup-worker-1 session",
      signal,
      credentials: CREDENTIALS,
      recordEvidence: (evidence) => recorded.push(evidence),
      // D267: a REAL gate over a throwaway authority database — the only way a
      // recipe test can hold a token the SSO helpers accept.
      duoCeremony: fixtureDuoCeremonyGate(system),
    },
  };
}

const crmContextFor = (script: FakePageScript, signal?: AbortSignal): ReturnType<typeof contextFor> =>
  contextFor(script, signal, "crm");

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
      // THE regression: the public portal is inside the legacy host substring.
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

describe("authenticated-application proof", () => {
  it("proves a UCPath session from the session cookie AND the absent sign-in forms", async () => {
    const { context, evidence } = contextFor({
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
    const { context } = contextFor({
      url: UCPATH_PUBLIC_PORTAL,
      elements: NO_SIGN_IN_FORMS,
      cookies: [PS_TOKEN],
    });
    const probe = await verifyUcpathAuthenticatedApplication(context);
    assert.ok(!probe.authenticated);
    assert.match(probe.reason, /not a UCPath PeopleSoft application route/);
  });

  it("refuses the PeopleSoft signon page, which shares the application's URL shape", async () => {
    // Exactly the 2026-08-03 page: right host, right route, titled
    // "Oracle PeopleSoft Sign-in", no session, signon form rendered.
    const { context } = contextFor({
      url: UCPATH_ENTRY,
      elements: { ...NO_SIGN_IN_FORMS, "peoplesoft-signon": { count: 1 } },
    });
    const probe = await verifyUcpathAuthenticatedApplication(context);
    assert.ok(!probe.authenticated);
    // The cookie is checked first, so THAT is what indicts the page; the form
    // is the backstop for a session that exists but has dropped to signon.
    assert.match(probe.reason, /never issued its PS_TOKEN session cookie/);

    const withStaleSession = contextFor({
      url: UCPATH_ENTRY,
      elements: { ...NO_SIGN_IN_FORMS, "peoplesoft-signon": { count: 1 } },
      cookies: [PS_TOKEN],
    });
    const second = await verifyUcpathAuthenticatedApplication(withStaleSession.context);
    assert.ok(!second.authenticated);
    assert.match(second.reason, /PeopleSoft signon form is still present/);
  });

  it("refuses a page still showing the UCSD SSO form", async () => {
    const { context } = contextFor({
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
      const { context } = contextFor({
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
    const { context } = contextFor({
      url: UCPATH_APP,
      elements: NO_SIGN_IN_FORMS,
      cookieStoreFailsWith: "context detached",
    });
    const probe = await verifyUcpathAuthenticatedApplication(context);
    assert.ok(!probe.authenticated);
    assert.match(probe.reason, /could not be read, so UCPath PeopleSoft cannot be proven/);
  });

  it("proves a CRM session from the Salesforce session cookie and absent forms", async () => {
    const { context } = contextFor({ url: CRM_APP, elements: NO_SIGN_IN_FORMS, cookies: [SID] });
    const probe = await verifyCrmAuthenticatedApplication(context);
    assert.ok(probe.authenticated);
    assert.match(probe.evidence.positive, /sid session cookie for my\.site\.com/);

    const noSession = contextFor({ url: CRM_APP, elements: NO_SIGN_IN_FORMS });
    const refused = await verifyCrmAuthenticatedApplication(noSession.context);
    assert.ok(!refused.authenticated);
    assert.match(refused.reason, /never issued its sid session cookie/);

    const communitiesLogin = contextFor({
      url: CRM_APP,
      elements: { ...NO_SIGN_IN_FORMS, "communities-login": { count: 1 } },
      cookies: [SID],
    });
    const refusedForm = await verifyCrmAuthenticatedApplication(communitiesLogin.context);
    assert.ok(!refusedForm.authenticated);
    assert.match(refusedForm.reason, /Communities login form is still present/);
  });
});

describe("ucpath login recipe", () => {
  it("reuses a PROVEN session without navigating, and records what proved it", async () => {
    const { context, harness, evidence } = contextFor({
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
    // The exact false pass. `goto` lands on the public portal, which the legacy
    // predicate accepted; the recipe must keep going into the SSO chain, and —
    // with no SSO form scripted — fail loud rather than report success.
    const { context, harness } = contextFor({
      url: "about:blank",
      navigation: { [UCPATH_PORTAL]: UCPATH_PUBLIC_PORTAL },
      elements: {
        "portal-login": { navigatesTo: SSO },
        "campus-link": { count: 0 },
        "sso-submit": { count: 0 },
      },
      // A cookie jar that would satisfy the positive fact if the URL were an
      // application route: the refusal has to come from the URL, not luck.
      cookies: [PS_TOKEN],
    });
    await assert.rejects(ucpathLoginRecipe(context), (error: unknown) => {
      assert.ok(error instanceof BrowserLoginError);
      assert.equal(error.step, "navigate-login-entry");
      assert.match(error.message, /neither campus discovery, nor the SSO form/);
      return true;
    });
    assert.equal(harness.actions().includes("click:portal-login"), true);
  });

  it("walks portal → campus discovery → SSO → verified landing", async () => {
    const { context, harness, evidence } = contextFor({
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
    const { context, harness } = contextFor({
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

  // Live 2026-09-07: the post-SSO BuildPage redirect interrupts our entry goto,
  // then UCPath itself reaches the requested HR Tasks route. No login is retried.
  const buildPage = new URL(
    "/psp/ucphrprd/EMPLOYEE/HRMS/s/WEBLIB_IS_PB.ISCRIPT1.FieldFormula.IScript_BuildPage",
    UCPATH_ENTRY,
  ).href;
  const interruptedEntry = `page.goto: Navigation to "${UCPATH_ENTRY}" is interrupted by another navigation to "${buildPage}"`;

  function interruptedLanding(overrides: Partial<FakePageScript> = {}): ReturnType<typeof contextFor> {
    return contextFor({
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
    const { context, harness, evidence } = interruptedLanding();
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
    const { context, harness, evidence } = interruptedLanding(overrides);
    await assert.rejects(ucpathLoginRecipe(context), (error: unknown) => {
      assert.ok(error instanceof BrowserLoginError);
      assert.equal(error.step, "verify-landing");
      return true;
    });
    assert.equal(harness.actions().filter((action) => action === `goto:${UCPATH_ENTRY}`).length, 1);
    assert.deepEqual(evidence(), []);
  });

  it("refuses a logged-in landing that never got a PeopleSoft session", async () => {
    const { context } = contextFor({
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
      assert.match(error.message, /the login could not prove the authenticated application/);
      assert.match(error.message, /never issued its PS_TOKEN session cookie/);
      return true;
    });
  });

  it("fails loud, naming the step, when the SSO form never renders", async () => {
    const { context } = contextFor({
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
      assert.match(error.message, /SSO form never rendered/);
      return true;
    });
  });

  it("fails loud, naming the stale chain, when the username field matches nothing", async () => {
    // The 2026-08-03 CRM failure mode, pinned for every UCSD system: a
    // relabelled TritON field must never be filled "somewhere else" or skipped.
    const { context, harness } = contextFor({
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
      assert.match(error.message, /username field matched no element/);
      assert.match(error.message, /ssousername/);
      return true;
    });
    assert.deepEqual(harness.filled(), [], "nothing may be typed into an unidentified page");
  });

  it("fails loud when Duo never clears, and never names a credential", async () => {
    const { context } = contextFor({
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
    // D243 / §9.21. The live wedge does NOT time out on the Duo host — Duo
    // ANSWERS, about a second after the assertion, with "Your login request
    // using your security key was canceled or timed out", and then sits there.
    // `NEVER_SETTLES` is that shape: the landing wait can only ever learn "not
    // yet", so a recipe that watches only the URL is structurally unable to
    // finish, and 48 s later the acquisition bound blames Duo hand-approval.
    const { context } = contextFor({
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
    assert.match(settled.message, /signCount/);
    assert.match(settled.message, /Duo REFUSED/);
    assert.doesNotMatch(settled.message, /fixture-value|fixture-user/);
  });

  it("still reports a plain Duo stall as a stall — the refusal probe is not a catch-all", async () => {
    // The negative control. Two different failures share the Duo host, and the
    // fix must not collapse them: a prompt that is merely slow (or genuinely
    // waiting on a hand approval) is the one case where
    // `timeouts.duoApprovalSeconds` IS the leaf to move, and saying "signCount"
    // there would be the same mis-attribution pointed the other way.
    const { context } = contextFor({
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
      assert.match(error.message, /the Duo prompt never cleared/);
      assert.doesNotMatch(error.message, /signCount/);
      return true;
    });
  });

  it("diagnoses the Shibboleth stale-request page specifically", async () => {
    const { context } = contextFor({
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
  });

  it("refuses a landing that still shows the SSO form", async () => {
    const { context } = contextFor({
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
      assert.match(error.message, /TritON SSO form is still present/);
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
  const authenticatedCrm = {
    elementsByUrl: { [CRM_APP]: NO_SIGN_IN_FORMS },
    cookiesByUrl: { [CRM_APP]: [SID] },
  } as const;

  it("selects Active Directory only when the control disagrees", async () => {
    const preselected = crmContextFor({
      url: "about:blank",
      navigation: { [CRM_ENTRY]: SSO },
      elements: {
        "login-type-select": { value: AD_TYPE },
        "sso-submit": {},
        "sso-username": {},
        "sso-password": {},
      },
      ...authenticatedCrm,
      settlesTo: [CRM_APP],
    });
    assert.equal(await crmLoginRecipe(preselected.context), "logged-in");
    assert.equal(preselected.harness.actions().includes("select:login-type-select"), false);
    assert.equal(preselected.evidence().length, 1);

    const wrongType = crmContextFor({
      url: "about:blank",
      navigation: { [CRM_ENTRY]: SSO },
      elements: {
        "login-type-select": { value: BUSINESS_TYPE, valueAfterSelect: AD_TYPE },
        "sso-submit": {},
        "sso-username": {},
        "sso-password": {},
      },
      ...authenticatedCrm,
      settlesTo: [CRM_APP],
    });
    assert.equal(await crmLoginRecipe(wrongType.context), "logged-in");
    assert.equal(wrongType.harness.actions().includes("select:login-type-select"), true);

    // Absent control: a genuinely valid rendering, so it is not a failure.
    const absent = crmContextFor({
      url: "about:blank",
      navigation: { [CRM_ENTRY]: SSO },
      elements: {
        "login-type-select": { count: 0 },
        "sso-submit": {},
        "sso-username": {},
        "sso-password": {},
      },
      ...authenticatedCrm,
      settlesTo: [CRM_APP],
    });
    assert.equal(await crmLoginRecipe(absent.context), "logged-in");
  });

  it("refuses to submit credentials when the realm did not actually switch", async () => {
    // The live 2026-08-03 failure: TritON defaults to Business Systems, the
    // credentials go to the wrong realm, and Shibboleth answers "the username
    // you entered cannot be identified" — a whole Duo window later.
    const { context, harness } = crmContextFor({
      url: "about:blank",
      navigation: { [CRM_ENTRY]: SSO },
      elements: {
        "login-type-select": { value: BUSINESS_TYPE, valueAfterSelect: BUSINESS_TYPE },
        "sso-submit": {},
        "sso-username": {},
        "sso-password": {},
      },
      ...authenticatedCrm,
      settlesTo: [CRM_APP],
    });
    await assert.rejects(crmLoginRecipe(context), (error: unknown) => {
      assert.ok(error instanceof BrowserLoginError);
      assert.equal(error.step, "sso-form");
      assert.match(error.message, /not Active Directory; refusing to submit credentials/);
      return true;
    });
    assert.deepEqual(harness.filled(), [], "no credential may be typed into the wrong realm's form");
  });

  it("fails loud when a present login-type control cannot be set", async () => {
    const { context } = crmContextFor({
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
    const { context } = crmContextFor({
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

  it("refuses a Communities landing with no Salesforce session", async () => {
    const { context } = crmContextFor({
      url: "about:blank",
      navigation: { [CRM_ENTRY]: SSO },
      elements: {
        "login-type-select": { count: 0 },
        "sso-submit": {},
        "sso-username": {},
        "sso-password": {},
      },
      elementsByUrl: { [CRM_APP]: NO_SIGN_IN_FORMS },
      settlesTo: [CRM_APP],
    });
    await assert.rejects(crmLoginRecipe(context), (error: unknown) => {
      assert.ok(error instanceof BrowserLoginError);
      assert.equal(error.step, "verify-landing");
      assert.match(error.message, /never issued its sid session cookie/);
      return true;
    });
  });
});

/**
 * Kuali Build is CLIENT-RENDERED, and the first live Kuali session (2026-08-04)
 * proved that matters: `waitForAuthenticatedLanding` resolves on the URL, and
 * the space serves a body with ZERO `[role]` nodes at `domcontentloaded`,
 * painting its menubar ~1s later. A verifier that COUNTS the chrome once at
 * that instant reports "no Kuali Build application chrome" for a session that
 * is in fact authenticated — and the flow then hunts for an SSO form that will
 * never render. These arms pin the wait, and pin that the wait is not a
 * fallback: chrome that never renders still refuses.
 */
describe("kuali landing verification — a client-rendered positive fact", () => {
  const KUALI_APP = CONFIG.urls.kuali.prod.entry;

  it("proves the session when the application chrome renders AFTER the landing URL settles", async () => {
    const { context } = contextFor({
      url: KUALI_APP,
      elements: {
        ...NO_SIGN_IN_FORMS,
        "sso-username": { count: 0 },
        "sso-password": { count: 0 },
        "kuali-app-chrome": { count: 1, rendersAfterWait: true },
      },
    });
    const probe = await verifyKualiAuthenticatedApplication(context);
    assert.equal(probe.authenticated, true, "a late-painting menubar is still a rendered menubar");
  });

  it("still refuses when the application chrome never renders", async () => {
    const { context } = contextFor({
      url: KUALI_APP,
      elements: { ...NO_SIGN_IN_FORMS, "kuali-app-chrome": { count: 0 } },
    });
    const probe = await verifyKualiAuthenticatedApplication(context);
    assert.equal(probe.authenticated, false);
    assert.match(probe.authenticated ? "" : probe.reason, /no Kuali Build application chrome/);
  });

  it("never pays the wait off the application host: the URL is checked first", async () => {
    const { context } = contextFor({
      url: SSO,
      elements: { "kuali-app-chrome": { count: 0 } },
    });
    const probe = await verifyKualiAuthenticatedApplication(context);
    assert.equal(probe.authenticated, false);
    assert.match(probe.authenticated ? "" : probe.reason, /not the Kuali Build application/);
  });
});
