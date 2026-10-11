import { hostConfigFacts } from "../../../../src/models/config/host-display.js";

import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import type {
AuthenticatedApplicationEvidence,
SystemLoginContext,
} from "../../../../src/backend/systems/browser-shared/login-contract.js";
import { BrowserLoginError } from "../../../../src/backend/systems/browser-shared/login-contract.js";
import {
crmLoginRecipe,
isAuthenticatedCrmUrl,
verifyCrmAuthenticatedApplication,
} from "../../../../src/backend/systems/crm/session.js";
import type { BrowserSystemId } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import {
fakeLoginPage,
type FakeCookie,
type FakePageScript
} from "../../../support/helpers/browser/fake-login-page.js";
import { fixtureDuoCeremonyGate } from "../../../support/helpers/duo-ceremony-fixtures.js";

const CONFIG = resolveConfigWithProvenance({}, hostConfigFacts({}), manualClock(new Date("2026-08-03T09:00:00.000Z"))).config;
const CREDENTIALS = Object.freeze({ userId: "fixture-user", password: "fixture-value" });
const SSO = "https://a5.ucsd.edu/idp/profile/SAML2/Redirect/SSO";
const CRM_APP = "https://act-crm.my.site.com/hr/ONB_SearchOnboardings";
const CRM_ENTRY = CONFIG.urls.crm.prod.entry;
// TritON option values are the verified login-type values.
const AD_TYPE = "_eventId_authn/PasswordAD";
const BUSINESS_TYPE = "_eventId_authn/PasswordRACF";
const SID: FakeCookie = { name: "sid", domain: "act-crm.my.site.com", value: "opaque" };


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

      duoCeremony: fixtureDuoCeremonyGate(system),
    },
  };
}

const crmContextFor = (script: FakePageScript, signal?: AbortSignal): ReturnType<typeof contextFor> =>
  contextFor(script, signal, "crm");

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
