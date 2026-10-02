/**
 * ACT CRM session ownership: the provider value plus this store's LOGIN RECIPE.
 *
 * CRM is a SEPARATE auth system from UCPath — Salesforce Communities in front
 * of the same UCSD Active-Directory SSO realm, so it shares the credential and
 * the Duo prompt but not the session.
 *
 * PORTED WITH PROVENANCE from legacy
 * hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc
 * `src/infra/auth/login.ts` (`loginToACTCrmFlow`):
 *
 * - the entry route `crm.ucsd.edu/hr`, which redirects into `a5.ucsd.edu`;
 * - the authenticated landing `act-crm.my.site.com` with the `login` exclusion
 *   (the Communities login page lives on the same host);
 * - the Active-Directory login-type `<select>`, which is normally pre-selected
 *   and only sometimes rendered;
 * - the shorter CRM Duo window (`timeouts.duoApprovalCrmSeconds`).
 *
 * A note the legacy file records and this port keeps: CRM's Duo prompt fires a
 * SECURITY-KEY ceremony rather than the platform authenticator the other UCSD
 * systems use, so Duo Autopilot needs the security-key credential enrolled for
 * this system specifically.
 *
 * Not ported: legacy's debug screenshots, `waitForTimeout` settles, and Duo
 * poll loop (ref execution-and-sessions §5).
 */
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
export { crmSession } from "./session-provider.js";

const SYSTEM = "crm" as const;
/** legacy src/infra/auth/login.ts:248 — the authenticated Communities host. */
const CRM_APP_HOST = "act-crm.my.site.com";
/** legacy src/infra/auth/login.ts:264 — the login-type option label. */
const ACTIVE_DIRECTORY_OPTION = "Active Directory";
/**
 * The login-type picker's own identity and the Active Directory option's VALUE,
 * live-verified 2026-08-03 on `a5.ucsd.edu/tritON`:
 * `select#authtype[name="authtype"]`, options
 * `_eventId_authn/PasswordRACF` (Business Systems — the DEFAULT),
 * `_eventId_authn/PasswordAD` (Active Directory), and
 * `_eventId_authn/PasswordKrb` (Student SSO).
 *
 * The value is what `inputValue()` returns, so comparing it to the LABEL — as
 * this recipe did — can never match and never could have detected the realm.
 */
const LOGIN_TYPE_SELECTOR = 'select#authtype, select[name="authtype"]';
const ACTIVE_DIRECTORY_VALUE = "_eventId_authn/PasswordAD";
/**
 * The POSITIVE fact. Salesforce issues `sid` — the Communities session id —
 * only after a completed authentication; the Communities login page, which
 * lives on the SAME host, has no `sid`. The value is never read.
 */
const SALESFORCE_SESSION_COOKIE = "sid";
const SALESFORCE_COOKIE_DOMAIN = "my.site.com";
/** Salesforce Communities' own login form, on the same host as the app. */
const COMMUNITIES_LOGIN_SELECTOR = 'input#username, input[name="username"], input[name="pw"]';

/**
 * legacy src/infra/auth/login.ts:247-251 — the landing predicate. NECESSARY,
 * never sufficient: `verifyCrmAuthenticatedApplication` is the proof (see
 * `src/backend/systems/browser-shared/authenticated-application.ts` for why a URL is not one).
 */
export function isAuthenticatedCrmUrl(rawUrl: string): boolean {
  const url = rawUrl.toLowerCase();
  return url.includes(CRM_APP_HOST)
    && !url.includes("login")
    && !url.startsWith("chrome-error");
}

/** The two-fact proof: Salesforce's own session cookie, and no sign-in form. */
export const verifyCrmAuthenticatedApplication: AuthenticatedApplicationVerifier = async (
  context,
): Promise<AuthenticationProbe> => verifyUcsdAuthenticatedApplication(SYSTEM, context.page, {
  urlIsApplication: isAuthenticatedCrmUrl,
  urlRefusal: "the observed URL is not the ACT CRM Communities application; the Communities login page shares this host and is refused here",
  positive: async () => probeSessionCookie(context.page, {
    name: SALESFORCE_SESSION_COOKIE,
    domainSuffix: SALESFORCE_COOKIE_DOMAIN,
    issuer: "ACT CRM Salesforce Communities",
  }),
  additionalAbsences: [
    async () => probeAbsentControl(context.page, {
      selector: COMMUNITIES_LOGIN_SELECTOR,
      description: "the Salesforce Communities login form",
    }),
  ],
});

/**
 * legacy src/infra/auth/login.ts:256-273 — the login-type picker.
 *
 * ## 2026-08-03: this ran before the form existed, and against the wrong string
 *
 * Live forensics on a cold CRM login: TritON defaults to **Business Systems**,
 * the credentials went in under that realm, and Shibboleth answered "The
 * username you entered cannot be identified" — then the recipe waited out the
 * whole Duo window and blamed Duo. Two bugs met:
 *
 * 1. the picker was probed straight after `goto`, while the browser was still
 *    redirecting into `a5.ucsd.edu`, so `count()` was 0 and "absent" — a real
 *    rendering the legacy comment records — swallowed the actual page; and
 * 2. `inputValue()` returns the option VALUE (`_eventId_authn/PasswordAD`),
 *    which never `includes("Active Directory")`, so even a present picker could
 *    not be seen as already correct.
 *
 * It now runs only once the SSO form has rendered, matches on the verified
 * value, re-waits for the form the reload rebuilds, and CONFIRMS the realm
 * afterwards. Absence is still tolerated — the picker genuinely is not rendered
 * on every TritON entry — but a present control that cannot be proven to hold
 * Active Directory is fatal, because submitting under the wrong login type
 * sends this user's real credentials to the wrong realm.
 */
async function ensureActiveDirectorySelected(context: SystemLoginContext, token: DuoCeremonyLeaseToken): Promise<void> {
  const { page, config } = context;
  const picker = page.locator(LOGIN_TYPE_SELECTOR).first();
  if (await picker.count() === 0) return;
  try {
    if (await picker.inputValue({ timeout: config.timeouts.navigationMs }) === ACTIVE_DIRECTORY_VALUE) return;
    await picker.selectOption(
      { label: ACTIVE_DIRECTORY_OPTION },
      { timeout: config.timeouts.navigationMs },
    );
    recordBrowserAction("selected", "crm.sso.login-type", ACTIVE_DIRECTORY_OPTION);
  } catch (error) {
    throw new BrowserLoginError(
      SYSTEM,
      "sso-form",
      "the CRM login-type control is present but Active Directory could not be selected",
      page.url(),
      { cause: error },
    );
  }
  // Selecting fires the picker's onchange, which re-posts and rebuilds the form
  // under the new realm. The credentials must go into THAT form, not the one
  // that is being torn down.
  await waitForSsoForm(SYSTEM, context, token);
  const settled = await page.locator(LOGIN_TYPE_SELECTOR).first()
    .inputValue({ timeout: config.timeouts.navigationMs });
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
    const { page, config } = context;
    const loginUrl = resolveSystemLoginUrl(config, SYSTEM, context.instance, context.label);
    abortIfCancelled(SYSTEM, "navigate-login-entry", context);
    try {
      await raceCancellation(
        page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: config.timeouts.navigationMs }),
        SYSTEM,
        "navigate-login-entry",
        context,
      );
      recordBrowserAction("opened", "crm.login-entry");
    } catch (error) {
      if (error instanceof BrowserLoginError) throw error;
      throw new BrowserLoginError(
        SYSTEM,
        "navigate-login-entry",
        "the ACT CRM entry route did not load",
        page.url(),
        { cause: error },
      );
    }

    // A warm profile can land straight on the Communities app — but only the
    // two-fact probe may say so; the Communities login page shares the host.
    // The wrapper probes again after this navigation and skips the ceremony.
  },
  ceremony: async (context, token): Promise<void> => {
    const { config } = context;
    // The form must exist BEFORE its login type can be read: the entry route is
    // still redirecting into `a5.ucsd.edu` when `goto` resolves.
    await waitForSsoForm(SYSTEM, context, token);
    await ensureActiveDirectorySelected(context, token);
    await fillSsoCredentials(SYSTEM, context, token);
    await submitSsoForm(SYSTEM, context, token);
    await waitForAuthenticatedLanding(
      SYSTEM,
      context,
      token,
      isAuthenticatedCrmUrl,
      config.timeouts.duoApprovalCrmSeconds * 1_000,
    );
  },
});
