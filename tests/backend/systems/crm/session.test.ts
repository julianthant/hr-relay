import { createSystemSessionTestWorld } from "../../../support/helpers/backend/system-session-world.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { BrowserLoginError } from "../../../../src/backend/systems/browser-shared/login-contract.js";
import { crmLoginRecipe, isAuthenticatedCrmUrl, verifyCrmAuthenticatedApplication } from "../../../../src/backend/systems/crm/session.js";
import { type FakeCookie, type FakePageScript } from "../../../support/helpers/browser/fake-login-page.js";

const { CONFIG, SSO, NO_SIGN_IN_FORMS, contextFor } = createSystemSessionTestWorld();

const CRM_APP = "https://act-crm.my.site.com/hr/ONB_SearchOnboardings";
const CRM_ENTRY = CONFIG.urls.crm.prod.entry;
// TritON option values are the verified login-type values.
const AD_TYPE = "_eventId_authn/PasswordAD";
const BUSINESS_TYPE = "_eventId_authn/PasswordRACF";
const SID: FakeCookie = { name: "sid", domain: "act-crm.my.site.com", value: "opaque" };

const crmContextFor = async (script: FakePageScript, signal?: AbortSignal): Promise<Awaited<ReturnType<typeof contextFor>>> =>
  await contextFor(script, signal, "crm");

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
    const { context } = await contextFor({ url: CRM_APP, elements: NO_SIGN_IN_FORMS, cookies: [SID] });
    const probe = await verifyCrmAuthenticatedApplication(context);
    assert.ok(probe.authenticated);
    assert.match(probe.evidence.positive, /sid session cookie for my\.site\.com/);

    const noSession = await contextFor({ url: CRM_APP, elements: NO_SIGN_IN_FORMS });
    const refused = await verifyCrmAuthenticatedApplication(noSession.context);
    assert.ok(!refused.authenticated);
    assert.match(refused.reason, /never issued its sid session cookie/);

    const communitiesLogin = await contextFor({
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
    const preselected = await crmContextFor({
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

    const wrongType = await crmContextFor({
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
    const absent = await crmContextFor({
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

    const { context, harness } = await crmContextFor({
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
      assert.match(error.detail, /not Active Directory; refusing to submit credentials/);
      return true;
    });
    assert.deepEqual(harness.filled(), [], "no credential may be typed into the wrong realm's form");
  });

  it("fails loud when a present login-type control cannot be set", async () => {
    const { context } = await crmContextFor({
      url: "about:blank",
      navigation: { [CRM_ENTRY]: SSO },
      elements: { "login-type-select": { failWith: "detached" } },
    });
    await assert.rejects(crmLoginRecipe(context), (error: unknown) => {
      assert.ok(error instanceof BrowserLoginError);
      assert.equal(error.system, "crm");
      assert.equal(error.step, "sso-form");
      assert.match(error.detail, /Active Directory could not be selected/);
      return true;
    });
  });

  it("treats the Communities login page as unauthenticated, not as a landing", async () => {
    const { context } = await crmContextFor({
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
    const { context } = await crmContextFor({
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
      assert.match(error.detail, /never issued its sid session cookie/);
      return true;
    });
  });
});
