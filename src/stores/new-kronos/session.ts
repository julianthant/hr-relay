/**
 * New Kronos (UKG Dimensions / WFD) session ownership: the provider value plus
 * this store's LOGIN RECIPE and its authenticated-application proof.
 *
 * PORTED WITH PROVENANCE from legacy
 * hr-automation@1bffbd658db34ce84a08e69484db3a40b3658d6e
 * `src/infra/auth/login.ts` (`newKronosNavigateAndFill` :772-798,
 * `newKronosSubmitAndWaitForDuo` :801-843, `loginToNewKronos` :848-852) and
 * `src/config.ts:133` (`NEW_KRONOS_URL`):
 *
 * - the entry route IS the WFD home — UKG has no separate login route, so
 *   navigating `…/wfd/home` is what triggers the SSO chain;
 * - the authenticated landing is a `ucsd-sso.prd.mykronos.com/wfd` URL;
 * - a warm profile short-circuits: legacy returns early as soon as the URL
 *   contains `mykronos.com/wfd`.
 *
 * NOT ported: legacy's `#failedLogin` re-`goto` recovery with its 1.5s settle,
 * its `waitForTimeout` sleeps, and its Duo poll loop — doc 05 §5 owns waiting
 * and `defineVerifiedLoginRecipe` owns the landing wait.
 *
 * ## The finding this recipe exists to record (live, 2026-08-12)
 *
 * **New Kronos does NOT hop through `a5.ucsd.edu`.** Every other browser system
 * in this tree reaches TritON; UKG's SSO chain lands on ForgeRock at
 * `cust01-prd07-ath01.prd.mykronos.com/authn/XUI/?realm=ucsd_prd_01&service=30847CustomerIDPChain`
 * — a different host, a different product, and a page whose heading reads
 * `Signing on using: Active Directory` with **no** login-type picker (CRM's
 * realm hazard cannot occur here). The FORM, however, is the same UCSD-issued
 * one: `input#ssousername` (`name="urn:mace:ucsd.edu:sso:username"`),
 * `input#ssopassword`, and `button[name="_eventId_proceed"]` labelled `Login`.
 * So the shared `ucsd-sso.ts` field recipes port unchanged and are re-verified
 * here rather than assumed — `UCSD_SSO_HOST` is deliberately not referenced.
 *
 * Live cold-profile proof (2026-08-12, Duo cleared hands-off by Duo Autopilot):
 * entry → ForgeRock SSO form ≈ 1.5 s; credential submit → `…/wfd/home`
 * **3.32 s** measured; whole browser-launch-to-home ≈ 33 s.
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
export { newKronosSession } from "./session-provider.js";

const SYSTEM = "new-kronos" as const;
/** legacy src/config.ts:133 / navigate.ts:30 — the WFD application host. */
const NEW_KRONOS_APP_HOST = "ucsd-sso.prd.mykronos.com";
/** The application route every authenticated WFD page sits under. */
const NEW_KRONOS_APP_PATH = "/wfd";
/**
 * The POSITIVE fact: `kronosAuthToken`, which the WFD APPLICATION issues on
 * `ucsd-sso.prd.mykronos.com` once a session exists — observed live 2026-08-12
 * alongside `securityToken`, `widgetToken` and `falconAuthCookie`, none of
 * which is present before authentication. Its value is never read.
 *
 * `AUTHN_TOKEN` (the RS256 JWT the IDP issues on `.prd.mykronos.com`) was the
 * alternative and is deliberately NOT the chosen fact: it proves the IDENTITY
 * PROVIDER authenticated somebody, which is a weaker claim than "the WFD
 * application handed this browser a session", and it is scoped to a parent
 * domain that includes the SSO host itself.
 */
const NEW_KRONOS_SESSION_COOKIE = "kronosAuthToken";
const NEW_KRONOS_COOKIE_DOMAIN = "ucsd-sso.prd.mykronos.com";
/**
 * Both sign-in surfaces that can appear on the way in: the UCSD credential form
 * (rendered by ForgeRock here, not TritON) and ForgeRock's own XUI login shell.
 * If either is on screen we are not in the application, whatever the URL says.
 */
const SSO_FORM_SELECTOR =
  'input#ssousername, input#ssopassword, button[name="_eventId_proceed"], form[name="loginForm"]';

/**
 * legacy src/infra/auth/login.ts:782,806 — the landing predicate. NECESSARY,
 * never sufficient: `verifyNewKronosAuthenticatedApplication` is the proof. The
 * 2026-08-03 PeopleSoft incident (D120) is why a URL alone cannot say
 * "authenticated" anywhere in this tree — and it applies with force here,
 * because the ForgeRock login page and the application both live under
 * `*.prd.mykronos.com`.
 */
export function isAuthenticatedNewKronosUrl(rawUrl: string): boolean {
  const url = rawUrl.toLowerCase();
  return url.includes(NEW_KRONOS_APP_HOST)
    && url.includes(NEW_KRONOS_APP_PATH)
    && !url.startsWith("chrome-error");
}

/** The two-fact proof: WFD's own session cookie, and no sign-in form. */
export const verifyNewKronosAuthenticatedApplication: AuthenticatedApplicationVerifier = async (
  context,
): Promise<AuthenticationProbe> => verifyUcsdAuthenticatedApplication(SYSTEM, context.page, {
  urlIsApplication: isAuthenticatedNewKronosUrl,
  urlRefusal:
    "the observed URL is not the UKG Dimensions (WFD) application; the ForgeRock sign-on host shares the mykronos.com domain and is refused here",
  positive: async () => probeSessionCookie(context.page, {
    name: NEW_KRONOS_SESSION_COOKIE,
    domainSuffix: NEW_KRONOS_COOKIE_DOMAIN,
    issuer: "UKG Dimensions (WFD)",
  }),
  additionalAbsences: [
    async () => probeAbsentControl(context.page, {
      selector: SSO_FORM_SELECTOR,
      description: "the UCSD single sign-on form and the ForgeRock XUI login shell",
    }),
  ],
});

export const newKronosLoginRecipe = defineVerifiedLoginRecipe({
  system: SYSTEM,
  verify: verifyNewKronosAuthenticatedApplication,
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
        "the UKG Dimensions (WFD) home entry route did not load",
        page.url(),
        { cause: error },
      );
    }

    // legacy login.ts:782-785 / :806-809 — a warm profile lands straight on the
    // WFD home. Only the proof may say so; the URL alone may not.
    if ((await probe()).authenticated) return "already-authenticated";

    await waitForSsoForm(SYSTEM, context);
    await fillSsoCredentials(SYSTEM, context);
    await submitSsoForm(SYSTEM, context);
    await waitForAuthenticatedLanding(
      SYSTEM,
      context,
      isAuthenticatedNewKronosUrl,
      config.timeouts.duoApprovalSeconds * 1_000,
    );
    return "logged-in";
  },
});
