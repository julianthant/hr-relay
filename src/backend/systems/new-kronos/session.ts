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
 * its `waitForTimeout` sleeps, and its Duo poll loop — ref execution-and-sessions §5 owns waiting
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
import { resolveSystemLoginUrl } from "../../../domain/config/instance.js";
import { recordBrowserAction } from "../browser-shared/action-notes.js";
import {
  defineVerifiedLoginRecipe,
  probeAbsentControl,
  probeSessionCookie,
} from "../browser-shared/authenticated-application.js";
import { BrowserLoginError } from "../browser-shared/login-contract.js";
import type { ObservedFact } from "../browser-shared/authenticated-application.js";
import type {
  AuthenticatedApplicationVerifier,
  AuthenticationProbe,
} from "../browser-shared/login-contract.js";
import type { Page } from "playwright";
import {
  abortIfCancelled,
  fillSsoCredentials,
  raceCancellation,
  submitSsoForm,
  verifyUcsdAuthenticatedApplication,
  waitForAuthenticatedLanding,
  waitForSsoForm,
} from "../browser-shared/ucsd-sso.js";
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
 * How long the application may take to issue its own session cookie before its
 * absence counts as a refusal (80 polls, 250ms apart = 20s).
 *
 * WFD is a client-rendered SPA and `kronosAuthToken` is issued by the
 * APPLICATION's own bootstrap, not by the SSO redirect that lands the URL. The
 * landing wait resolves on the URL, so a single immediate sample races that
 * bootstrap — measured on the first live run (`sk-123452-7b1e`, 2026-08-12): the
 * URL was `…/wfd/home` and the context already held `AUTHN_TOKEN`,
 * `iPlanetDirectoryPro`, `authn_ssid` and `XSRF-TOKEN`, but not yet
 * `kronosAuthToken`, and the login refused a session that was in fact
 * authenticating. This is the same shape as Kuali's late-painting menubar.
 *
 * This is a bounded wait for the SAME fact, not a fallback: if the cookie never
 * arrives inside the bound the probe still reports `holds:false` and the login
 * still refuses, naming the cookie and listing what the context did hold. It costs nothing on the unauthenticated paths, because
 * `verifyUcsdAuthenticatedApplication` short-circuits on the URL first.
 */
const NEW_KRONOS_SESSION_COOKIE_POLL_MS = 250;
/** 80 x 250ms = a 20s bound on the application's own bootstrap. */
const NEW_KRONOS_SESSION_COOKIE_POLLS = 80;
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

/**
 * The positive fact, sampled repeatedly until the application issues it or the
 * bound elapses. The LAST observation is what the probe reports, so a refusal
 * still names the cookie and lists what the context actually held.
 */
async function probeIssuedSessionCookie(page: Page): Promise<ObservedFact> {
  // Bounded by a POLL COUNT rather than a wall-clock deadline: a verifier's
  // context carries no `Clock`, and `clock-single-source` rightly refuses a
  // second time source in a store. 80 polls x 250ms is the same 20s bound.
  let observed: ObservedFact = { holds: false, detail: "the session-cookie probe never ran" };
  for (let poll = 0; poll < NEW_KRONOS_SESSION_COOKIE_POLLS; poll++) {
    observed = await probeSessionCookie(page, {
      name: NEW_KRONOS_SESSION_COOKIE,
      domainSuffix: NEW_KRONOS_COOKIE_DOMAIN,
      issuer: "UKG Dimensions (WFD)",
    });
    if (observed.holds) return observed;
    await new Promise<void>((resolve) => { setTimeout(resolve, NEW_KRONOS_SESSION_COOKIE_POLL_MS); });
  }
  return {
    holds: false,
    detail: `${observed.detail} across ${String(NEW_KRONOS_SESSION_COOKIE_POLLS)} polls `
      + `${String(NEW_KRONOS_SESSION_COOKIE_POLL_MS)}ms apart after landing`,
  };
}

/** The two-fact proof: WFD's own session cookie, and no sign-in form. */
export const verifyNewKronosAuthenticatedApplication: AuthenticatedApplicationVerifier = async (
  context,
): Promise<AuthenticationProbe> => verifyUcsdAuthenticatedApplication(SYSTEM, context.page, {
  urlIsApplication: isAuthenticatedNewKronosUrl,
  urlRefusal:
    "the observed URL is not the UKG Dimensions (WFD) application; the ForgeRock sign-on host shares the mykronos.com domain and is refused here",
  positive: async () => probeIssuedSessionCookie(context.page),
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
      recordBrowserAction("opened", "new-kronos.login-entry");
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
    // WFD home. Only the proof may say so; the URL alone may not — the wrapper
    // probes again after this navigation and skips the ceremony when it holds.
  },
  ceremony: async (context, token): Promise<void> => {
    const { config } = context;
    await waitForSsoForm(SYSTEM, context, token);
    await fillSsoCredentials(SYSTEM, context, token);
    await submitSsoForm(SYSTEM, context, token);
    await waitForAuthenticatedLanding(
      SYSTEM,
      context,
      token,
      isAuthenticatedNewKronosUrl,
      config.timeouts.duoApprovalSeconds * 1_000,
    );
  },
});
