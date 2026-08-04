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
 * poll loop (doc 05 §5).
 */
import { resolveSystemLoginUrl } from "../../domain/config/instance.js";
import type { LoginResult } from "../../domain/session.js";
import {
  defineVerifiedLoginRecipe,
  probeAbsentControl,
  probeSessionCookie,
} from "../../infra/browser/authenticated-application.js";
import { BrowserLoginError } from "../../infra/browser/login-contract.js";
import type {
  AuthenticatedApplicationVerifier,
  AuthenticationProbe,
  SystemLoginContext,
} from "../../infra/browser/login-contract.js";
import {
  abortIfCancelled,
  fillSsoCredentials,
  raceCancellation,
  submitSsoForm,
  verifyUcsdAuthenticatedApplication,
  waitForAuthenticatedLanding,
  waitForSsoForm,
} from "../../infra/browser/ucsd-sso.js";
export { crmSession } from "./session-provider.js";

const SYSTEM = "crm" as const;
/** legacy src/infra/auth/login.ts:248 — the authenticated Communities host. */
const CRM_APP_HOST = "act-crm.my.site.com";
/** legacy src/infra/auth/login.ts:264 — the login-type option label. */
const ACTIVE_DIRECTORY_OPTION = "Active Directory";
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
 * `src/infra/browser/authenticated-application.ts` for why a URL is not one).
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
 * legacy src/infra/auth/login.ts:256-273 — the login-type picker. Active
 * Directory is normally pre-selected and the control is often absent
 * entirely; selecting it is only meaningful when the control exists AND
 * currently holds something else. Absence is a genuinely valid expected state
 * here (the legacy comment records both renderings), so it is not a failure —
 * but a present control that cannot be set IS, because submitting the form
 * under the wrong login type authenticates against the wrong realm.
 */
async function ensureActiveDirectorySelected(context: SystemLoginContext): Promise<void> {
  const picker = context.page.locator("select").first();
  const present = await picker.count();
  if (present === 0) return;
  try {
    const current = await picker.inputValue({ timeout: context.config.timeouts.navigationMs });
    if (current.includes(ACTIVE_DIRECTORY_OPTION)) return;
    await picker.selectOption(
      { label: ACTIVE_DIRECTORY_OPTION },
      { timeout: context.config.timeouts.navigationMs },
    );
  } catch (error) {
    throw new BrowserLoginError(
      SYSTEM,
      "sso-form",
      "the CRM login-type control is present but Active Directory could not be selected",
      context.page.url(),
      { cause: error },
    );
  }
}

export const crmLoginRecipe = defineVerifiedLoginRecipe({
  system: SYSTEM,
  verify: verifyCrmAuthenticatedApplication,
  flow: async (context, probe): Promise<LoginResult> => {
    const { page, config } = context;
    if ((await probe()).authenticated) return "already-authenticated";

    const loginUrl = resolveSystemLoginUrl(config, SYSTEM, context.instance, context.label);
    abortIfCancelled(SYSTEM, "navigate-login-entry", context);
    try {
      await raceCancellation(
        page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: config.timeouts.navigationMs }),
        SYSTEM,
        "navigate-login-entry",
        context,
      );
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
    if ((await probe()).authenticated) return "already-authenticated";

    await ensureActiveDirectorySelected(context);
    await waitForSsoForm(SYSTEM, context);
    await fillSsoCredentials(SYSTEM, context);
    await submitSsoForm(SYSTEM, context);
    await waitForAuthenticatedLanding(
      SYSTEM,
      context,
      isAuthenticatedCrmUrl,
      config.timeouts.duoApprovalCrmSeconds * 1_000,
    );
    return "logged-in";
  },
});
