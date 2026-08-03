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
import { BrowserLoginError } from "../../infra/browser/login-contract.js";
import type { SystemLoginContext, SystemLoginRecipe } from "../../infra/browser/login-contract.js";
import {
  abortIfCancelled,
  assertVerifiedLanding,
  fillSsoCredentials,
  raceCancellation,
  submitSsoForm,
  waitForAuthenticatedLanding,
  waitForSsoForm,
} from "../../infra/browser/ucsd-sso.js";
export { crmSession } from "./session-provider.js";

const SYSTEM = "crm" as const;
/** legacy src/infra/auth/login.ts:248 — the authenticated Communities host. */
const CRM_APP_HOST = "act-crm.my.site.com";
/** legacy src/infra/auth/login.ts:264 — the login-type option label. */
const ACTIVE_DIRECTORY_OPTION = "Active Directory";

/** legacy src/infra/auth/login.ts:247-251 — authenticated landing predicate. */
export function isAuthenticatedCrmUrl(rawUrl: string): boolean {
  const url = rawUrl.toLowerCase();
  return url.includes(CRM_APP_HOST)
    && !url.includes("login")
    && !url.startsWith("chrome-error");
}

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

export const crmLoginRecipe: SystemLoginRecipe = async (context): Promise<LoginResult> => {
  const { page, config } = context;
  if (isAuthenticatedCrmUrl(page.url())) return "already-authenticated";

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

  // A warm profile can land straight on the Communities app.
  if (isAuthenticatedCrmUrl(page.url())) return "already-authenticated";

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

  await assertVerifiedLanding(SYSTEM, context, isAuthenticatedCrmUrl);
  return "logged-in";
};
