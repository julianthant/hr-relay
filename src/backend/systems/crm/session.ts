// CRM uses a security-key Duo ceremony; enroll its security-key credential for this system.
import { resolveSystemLoginUrl } from "../../../models/config/instance.js";
import { recordBrowserAction } from "../browser-shared/action-notes.js";
import type { DuoCeremonyLeaseToken } from "../../../workflow-kit/duo-ceremony-lease.js";
import {
  defineVerifiedLoginRecipe,
  probeAbsentControl,
  probeSessionCookie,
} from "../browser-shared/authenticated-application.js";
import { BrowserLoginError } from "../browser-shared/login-contract.js";
import type {
  AuthenticatedApplicationVerifier,
  AuthenticationProbe,
  SystemLoginContext,
} from "../browser-shared/login-contract.js";
import {
  abortIfCancelled,
  fillSsoCredentials,
  raceCancellation,
  submitSsoForm,
  verifyUcsdAuthenticatedApplication,
  waitForAuthenticatedLanding,
  waitForSsoForm,
} from "../browser-shared/ucsd-sso.js";

const SYSTEM = "crm" as const;

const CRM_APP_HOST = "act-crm.my.site.com";

const ACTIVE_DIRECTORY_OPTION = "Active Directory";
// The login-type control returns its option value, never the visible option label.
const LOGIN_TYPE_SELECTOR = 'select#authtype, select[name="authtype"]';
const ACTIVE_DIRECTORY_VALUE = "_eventId_authn/PasswordAD";
// Salesforce login shares the Communities host but has no sid; a nonempty sid proves a completed session.
const SALESFORCE_SESSION_COOKIE = "sid";
const SALESFORCE_COOKIE_DOMAIN = "my.site.com";
/** Salesforce Communities' own login form, on the same host as the app. */
const COMMUNITIES_LOGIN_SELECTOR = 'input#username, input[name="username"], input[name="pw"]';


export function isAuthenticatedCrmUrl(rawUrl: string): boolean {
  const url = URL.parse(rawUrl);
  if (url === null) return false;
  const path = url.pathname;
  return url.protocol === "https:" && url.host === CRM_APP_HOST
    && (path === "/hr" || path.startsWith("/hr/")) && !path.toLowerCase().includes("login");
}

/** The two-fact proof: Salesforce's own session cookie, and no sign-in form. */
export const verifyCrmAuthenticatedApplication: AuthenticatedApplicationVerifier = async (
  context,
): Promise<AuthenticationProbe> => verifyUcsdAuthenticatedApplication(SYSTEM, context.page, {
  assertCurrent: context.assertCurrent,
  urlIsApplication: isAuthenticatedCrmUrl,
  urlRefusal: "the observed URL is not the ACT CRM Communities application; the Communities login page shares this host and is refused here",
  positive: async () => probeSessionCookie(context.page, {
    assertCurrent: context.assertCurrent,
    name: SALESFORCE_SESSION_COOKIE,
    domainSuffix: SALESFORCE_COOKIE_DOMAIN,
    issuer: "ACT CRM Salesforce Communities",
  }),
  additionalAbsences: [
    async () => probeAbsentControl(context.page, {
      assertCurrent: context.assertCurrent,
      selector: COMMUNITIES_LOGIN_SELECTOR,
      description: "the Salesforce Communities login form",
    }),
  ],
});

// Wait for the SSO form before selecting login type; verify its value again after reload. An absent picker is a valid entry state.
async function ensureActiveDirectorySelected(context: SystemLoginContext, token: DuoCeremonyLeaseToken): Promise<void> {
  context.assertCurrent();
  const { page, config } = context;
  const picker = page.locator(LOGIN_TYPE_SELECTOR).first();
  context.assertCurrent();
  if (await picker.count() === 0) return;
  try {
    context.assertCurrent();
    if (await picker.inputValue({ timeout: config.timeouts.navigationMs }) === ACTIVE_DIRECTORY_VALUE) return;
    context.assertCurrent();
    await picker.selectOption(
      { label: ACTIVE_DIRECTORY_OPTION },
      { timeout: config.timeouts.navigationMs },
    );
    context.assertCurrent();
    recordBrowserAction("selected", "crm.sso.login-type", ACTIVE_DIRECTORY_OPTION);
  } catch (error) {
    context.assertCurrent();
    throw new BrowserLoginError(
      SYSTEM,
      "sso-form",
      "the CRM login-type control is present but Active Directory could not be selected",
      page.url(),
      { cause: error },
    );
  }

  context.assertCurrent();
  await waitForSsoForm(SYSTEM, context, token);
  context.assertCurrent();
  const settled = await page.locator(LOGIN_TYPE_SELECTOR).first()
    .inputValue({ timeout: config.timeouts.navigationMs });
  context.assertCurrent();
  if (settled !== ACTIVE_DIRECTORY_VALUE) {
    throw new BrowserLoginError(
      SYSTEM,
      "sso-form",
      `the CRM login type is ${settled}, not Active Directory; refusing to submit credentials against the wrong realm`,
      page.url(),
    );
  }
}

export const crmLoginRecipe = defineVerifiedLoginRecipe({
  system: SYSTEM,
  verify: verifyCrmAuthenticatedApplication,
  navigate: async (context): Promise<void> => {
    context.assertCurrent();
    const { page, config } = context;
    const loginUrl = resolveSystemLoginUrl(config, SYSTEM, context.instance, context.label);
    abortIfCancelled(SYSTEM, "navigate-login-entry", context);
    try {
      context.assertCurrent();
      await raceCancellation(
        () => page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: config.timeouts.navigationMs }),
        SYSTEM,
        "navigate-login-entry",
        context,
      );
      context.assertCurrent();
      recordBrowserAction("opened", "crm.login-entry");
    } catch (error) {
      context.assertCurrent();
      if (error instanceof BrowserLoginError) throw error;
      throw new BrowserLoginError(
        SYSTEM,
        "navigate-login-entry",
        "the ACT CRM entry route did not load",
        page.url(),
        { cause: error },
      );
    }


  },
  ceremony: async (context, token): Promise<void> => {
    context.assertCurrent();
    const { config } = context;
    // The form must exist BEFORE its login type can be read: the entry route is
    // still redirecting into `a5.ucsd.edu` when `goto` resolves.
    context.assertCurrent();
    await waitForSsoForm(SYSTEM, context, token);
    context.assertCurrent();
    await ensureActiveDirectorySelected(context, token);
    context.assertCurrent();
    await fillSsoCredentials(SYSTEM, context, token);
    context.assertCurrent();
    await submitSsoForm(SYSTEM, context, token);
    context.assertCurrent();
    await waitForAuthenticatedLanding(
      SYSTEM,
      context,
      token,
      isAuthenticatedCrmUrl,
      config.timeouts.duoApprovalCrmSeconds * 1_000,
    );
    context.assertCurrent();
  },
});
