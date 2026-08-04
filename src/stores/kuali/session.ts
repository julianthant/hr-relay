/**
 * Kuali Build session ownership: the provider value plus this store's LOGIN
 * RECIPE and its authenticated-application proof.
 *
 * Kuali sits behind the same UCSD Shibboleth/Duo realm as UCPath and CRM, so it
 * shares the credential and the Duo ceremony but not the session.
 *
 * PORTED WITH PROVENANCE from legacy
 * hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc
 * `src/infra/auth/login.ts` (`kualiNavigateAndFill` :649-680,
 * `kualiSubmitAndWaitForDuo` :682-742, `loginToKuali` :744-755) and
 * `src/config.ts:131-132` (`KUALI_SPACE_URL`):
 *
 * - the entry route IS the space URL — Kuali has no separate login route, so
 *   navigating the space is what triggers Shibboleth;
 * - the authenticated landing is any `ucsd.kualibuild.com` URL;
 * - a warm profile short-circuits: legacy returns `"already_logged_in"` as soon
 *   as the URL contains `kualibuild`.
 *
 * NOT ported: legacy's SAML-recovery re-`goto` with a 1.5s settle, its
 * `waitForTimeout` sleeps, and its Duo poll loop — doc 05 §5 owns waiting and
 * `defineVerifiedLoginRecipe` owns the landing wait.
 *
 * Live-verified read-only 2026-08-04 from a cold profile: entry → TritON SSO →
 * Duo cleared hands-off by Duo Autopilot → `ucsd.kualibuild.com`, ~32s wall end
 * to end, of which the Duo step was under 8s.
 */
import { resolveSystemLoginUrl } from "../../domain/config/instance.js";
import type { LoginResult } from "../../domain/session.js";
import {
  defineVerifiedLoginRecipe,
  probeAbsentControl,
} from "../../infra/browser/authenticated-application.js";
import type { ObservedFact } from "../../infra/browser/authenticated-application.js";
import { BrowserLoginError } from "../../infra/browser/login-contract.js";
import type {
  AuthenticatedApplicationVerifier,
  AuthenticationProbe,
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
export { kualiSession } from "./session-provider.js";

const SYSTEM = "kuali" as const;
/** legacy src/config.ts:131 / navigate.ts:14 — the Kuali Build application host. */
const KUALI_APP_HOST = "ucsd.kualibuild.com";
/**
 * The POSITIVE fact: the space chrome renders menu chrome only for an
 * authenticated user. Legacy uses the very same control family as its
 * "Action List loaded" signal (`navigate.ts:46-53`), and it was present on the
 * live 2026-08-04 read-only session.
 */
const KUALI_APP_CONTROL_SELECTOR = '[role="menuitem"], [role="menubar"]';
/**
 * How long the application chrome may take to render before its absence counts
 * as a refusal.
 *
 * Kuali Build is a client-rendered SPA: measured live 2026-08-04, the space
 * serves a body with ZERO `[role]` nodes at `domcontentloaded` and paints its
 * menubar ~1s later, on a warm authenticated profile. The landing wait resolves
 * on the URL, so a single immediate sample of the positive fact races the
 * hydration and reports "no application chrome" for a session that is in fact
 * authenticated — which is what the first live Kuali login attempt did.
 *
 * This is a bounded wait for the SAME fact, not a fallback: if the chrome never
 * renders inside the bound, the probe still reports `holds:false` and the login
 * still refuses. The bound costs nothing on the unauthenticated paths, because
 * `verifyUcsdAuthenticatedApplication` short-circuits on the URL first.
 */
const KUALI_APP_CONTROL_RENDER_MS = 15_000;
/** The TritON sign-in form; if it is on screen we are not in the application. */
const SSO_FORM_SELECTOR = 'input#ssousername, input[name="j_username"], input[type="password"]';

/**
 * legacy src/infra/auth/login.ts:662-665 — the landing predicate. NECESSARY,
 * never sufficient: `verifyKualiAuthenticatedApplication` is the proof. The
 * 2026-08-03 PeopleSoft incident is exactly why a URL alone cannot say
 * "authenticated" anywhere in this tree.
 */
export function isAuthenticatedKualiUrl(rawUrl: string): boolean {
  const url = rawUrl.toLowerCase();
  return url.includes(KUALI_APP_HOST) && !url.startsWith("chrome-error");
}

/**
 * The proof: the application host, application chrome present, and no SSO form.
 *
 * Kuali issues no cookie this repo has verified as an authenticated-only
 * issuer, so the positive fact is rendered application chrome rather than a
 * session cookie. That is honestly weaker than CRM's `sid`, and it is recorded
 * as such — it is paired with an explicit SSO-form absence so a Shibboleth
 * interstitial served on this host can never read as the application.
 */
export const verifyKualiAuthenticatedApplication: AuthenticatedApplicationVerifier = async (
  context,
): Promise<AuthenticationProbe> => verifyUcsdAuthenticatedApplication(SYSTEM, context.page, {
  urlIsApplication: isAuthenticatedKualiUrl,
  urlRefusal: "the observed URL is not the Kuali Build application",
  positive: async (): Promise<ObservedFact> => {
    const chrome = context.page.locator(KUALI_APP_CONTROL_SELECTOR);
    try {
      await chrome.first().waitFor({ state: "attached", timeout: KUALI_APP_CONTROL_RENDER_MS });
    } catch (error) {
      // Not a swallow: the timeout IS the observation, and it reports the
      // fact as NOT holding, which refuses the login.
      return {
        holds: false,
        detail: `no Kuali Build application chrome rendered within ${String(KUALI_APP_CONTROL_RENDER_MS)}ms `
          + `(${error instanceof Error ? error.message.split("\n")[0] ?? "timeout" : "timeout"})`,
      };
    }
    const count = await chrome.count();
    return count > 0
      ? { holds: true, detail: "Kuali Build application chrome is rendered" }
      : { holds: false, detail: "no Kuali Build application chrome is rendered on this page" };
  },
  additionalAbsences: [
    async () => probeAbsentControl(context.page, {
      selector: SSO_FORM_SELECTOR,
      description: "the UCSD single sign-on form",
    }),
  ],
});

export const kualiLoginRecipe = defineVerifiedLoginRecipe({
  system: SYSTEM,
  verify: verifyKualiAuthenticatedApplication,
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
        "the Kuali Build space entry route did not load",
        page.url(),
        { cause: error },
      );
    }

    // legacy login.ts:662-665 / :691-694 — a warm profile lands straight on the
    // space. Only the proof may say so; the URL alone may not.
    if ((await probe()).authenticated) return "already-authenticated";

    await waitForSsoForm(SYSTEM, context);
    await fillSsoCredentials(SYSTEM, context);
    await submitSsoForm(SYSTEM, context);
    await waitForAuthenticatedLanding(
      SYSTEM,
      context,
      isAuthenticatedKualiUrl,
      config.timeouts.duoApprovalSeconds * 1_000,
    );
    return "logged-in";
  },
});
