/**
 * UCPath session ownership: the provider value plus this store's LOGIN RECIPE.
 *
 * A store's `session.ts` is a sanctioned raw-browser owner (the task-driver
 * boundary guard) — task and workflow code never reaches it.
 *
 * PORTED WITH PROVENANCE from legacy
 * hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc
 * `src/infra/auth/login.ts`:
 *
 * - `ucpathNavigateAndFill` — the hop chain: portal → "Log in to UCPath" →
 *   campus discovery ("University of California, San Diego") → `a5.ucsd.edu`
 *   SSO form. The deep PeopleSoft routes are NOT reachable unauthenticated.
 * - `isAuthenticatedUcpathAppUrl` — the landing predicate, including the
 *   exclusions that matter: the campus-discovery page (`ucpathdiscovery/disco`),
 *   the SSO and Duo hosts, and PeopleSoft's classic-PIA session-expiry landings
 *   `?cmd=login` / `?cmd=expire`, which live on the SAME host as an
 *   authenticated page and would otherwise read as success.
 * - `ucpathSubmitAndWaitForDuo` — the post-Duo re-selection of UC San Diego
 *   when the redirect chain drops back onto campus discovery.
 *
 * Not ported: legacy's fixed `waitForTimeout` settles and its Duo poll loop
 * (doc 05 §5 — real readiness predicates under bounded deadlines only).
 *
 * ## 2026-08-03: what the ported URL predicate could not do
 *
 * The legacy predicate is a HOST-substring test, and UC serves the PUBLIC
 * UCPath portal (`https://ucpath.universityofcalifornia.edu/`) from inside that
 * substring. Ported verbatim, it read the public portal as the authenticated
 * application, so a login smoke returned `already-authenticated` in ~3s having
 * never touched `a5.ucsd.edu`, Duo, or PeopleSoft. Two things changed here:
 *
 * 1. The URL predicate now also requires a PeopleSoft APPLICATION route
 *    (`/psc/` or `/psp/`), so the portal can never satisfy it; and it is only a
 *    NECESSARY condition — the proof is `verifyUcpathAuthenticatedApplication`,
 *    whose positive fact is the `PS_TOKEN` cookie PeopleSoft issues only after
 *    a completed sign-in.
 * 2. The recipe is built by `defineVerifiedLoginRecipe`, so that proof runs on
 *    every return path including the early one.
 */
import { resolveSystemEntryUrl, resolveSystemLoginUrl } from "../../domain/config/instance.js";
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
  UCSD_SSO_HOST,
  abortIfCancelled,
  fillSsoCredentials,
  isSsoFormPresent,
  raceCancellation,
  submitSsoForm,
  verifyUcsdAuthenticatedApplication,
  waitForAuthenticatedLanding,
  waitForSsoForm,
} from "../../infra/browser/ucsd-sso.js";
export { ucpathSession } from "./session-provider.js";

const SYSTEM = "ucpath" as const;
/** legacy src/infra/auth/login.ts:194 — the campus-discovery landing. */
const CAMPUS_DISCOVERY_MARKER = "ucpathdiscovery/disco";
/** legacy src/infra/auth/login.ts:42 — the campus link text. */
const CAMPUS_LINK_NAME = "University of California, San Diego";
/** legacy src/infra/auth/login.ts:116 — the portal's login control. */
const LOGIN_CONTROL_NAME = /log in to ucpath/i;
/** Bounded post-Duo campus-discovery re-selection (legacy: 3 attempts). */
const CAMPUS_RESELECT_ATTEMPTS = 3;
/**
 * PeopleSoft's application servlets. `/psc/` is the component/content servlet
 * every configured route uses (`urls.ucpath.*.smartHr`, `jobSummary`,
 * `personalData`); `/psp/` is the portal servlet (`personProfile`). The public
 * UCPath portal has neither.
 */
const PEOPLESOFT_APP_SERVLETS = ["/psc/", "/psp/"] as const;
/**
 * The POSITIVE fact. PeopleSoft issues `PS_TOKEN` — its single-signon token —
 * only after a successful authentication to a node; the signon page does not
 * have one. `PS_TOKENEXPIRE` is deliberately NOT accepted: PeopleSoft writes
 * that one at signon time, so a prefix match would prove nothing.
 */
const PEOPLESOFT_SESSION_COOKIE = "PS_TOKEN";
const PEOPLESOFT_COOKIE_DOMAIN = "universityofcalifornia.edu";
/**
 * PeopleSoft's own signon form — the page that produced the 2026-08-03 false
 * pass. It renders at the SAME route shape as the application (no `cmd=login`
 * in the URL), so only its DOM distinguishes it.
 */
const PEOPLESOFT_SIGNON_SELECTOR = 'input#userid, input#pwd, input[name="userid"], input[name="pwd"]';

/**
 * A landing that has come back from SSO/Duo onto a UC host. This is the WAIT
 * predicate, not a proof: the public portal satisfies it, which is exactly why
 * it must never be the thing a login concludes from.
 *
 * legacy src/infra/auth/login.ts:69-85 — `isAuthenticatedUcpathAppUrl`, ported
 * in substance. Every exclusion is load-bearing; see the file header.
 */
export function isUcpathPostSsoLanding(rawUrl: string): boolean {
  const url = rawUrl.toLowerCase();
  return url.includes("universityofcalifornia.edu")
    && !url.includes(CAMPUS_DISCOVERY_MARKER)
    && !url.includes("duosecurity.com")
    && !url.includes("a5.ucsd.edu")
    && !url.includes("/login")
    && !url.includes("cmd=login")
    && !url.includes("cmd=expire")
    && !url.includes("shibboleth")
    && !url.startsWith("chrome-error");
}

/**
 * The NECESSARY URL condition: a post-SSO landing that is also a PeopleSoft
 * application route. Necessary, never sufficient — see the file header.
 */
export function isAuthenticatedUcpathAppUrl(rawUrl: string): boolean {
  const url = rawUrl.toLowerCase();
  return isUcpathPostSsoLanding(url)
    && PEOPLESOFT_APP_SERVLETS.some((servlet) => url.includes(servlet));
}

/** The two-fact proof: PeopleSoft's own session token, and no sign-in form. */
export const verifyUcpathAuthenticatedApplication: AuthenticatedApplicationVerifier = async (
  context,
): Promise<AuthenticationProbe> => verifyUcsdAuthenticatedApplication(SYSTEM, context.page, {
  urlIsApplication: isAuthenticatedUcpathAppUrl,
  urlRefusal: "the observed URL is not a UCPath PeopleSoft application route; the public UCPath portal, campus discovery, SSO, Duo and the classic-PIA expiry landings are all refused here",
  positive: async () => probeSessionCookie(context.page, {
    name: PEOPLESOFT_SESSION_COOKIE,
    domainSuffix: PEOPLESOFT_COOKIE_DOMAIN,
    issuer: "UCPath PeopleSoft",
  }),
  additionalAbsences: [
    async () => probeAbsentControl(context.page, {
      selector: PEOPLESOFT_SIGNON_SELECTOR,
      description: "the PeopleSoft signon form",
    }),
  ],
});

async function selectUcSanDiego(context: SystemLoginContext): Promise<void> {
  try {
    await raceCancellation(
      context.page.getByRole("link", { name: CAMPUS_LINK_NAME })
        .first()
        .click({ timeout: context.config.timeouts.navigationMs }),
      SYSTEM,
      "campus-discovery",
      context,
    );
  } catch (error) {
    if (error instanceof BrowserLoginError) throw error;
    throw new BrowserLoginError(
      SYSTEM,
      "campus-discovery",
      "the UC San Diego campus link could not be selected",
      context.page.url(),
      { cause: error },
    );
  }
}

async function clickPortalLoginControl(context: SystemLoginContext): Promise<void> {
  const { page, config } = context;
  try {
    await raceCancellation(
      page.getByRole("button", { name: LOGIN_CONTROL_NAME })
        .or(page.getByRole("link", { name: LOGIN_CONTROL_NAME }))
        .first()
        .click({ timeout: config.timeouts.navigationMs }),
      SYSTEM,
      "navigate-login-entry",
      context,
    );
  } catch (error) {
    if (error instanceof BrowserLoginError) throw error;
    throw new BrowserLoginError(
      SYSTEM,
      "navigate-login-entry",
      "the portal's log-in control could not be clicked",
      page.url(),
      { cause: error },
    );
  }
}

async function isSsoCeremonyPending(context: SystemLoginContext): Promise<boolean> {
  const url = context.page.url().toLowerCase();
  if (isAuthenticatedUcpathAppUrl(url)) return false;
  if (url.includes(UCSD_SSO_HOST)) return true;
  return isSsoFormPresent(context.page);
}

/**
 * Enters the authenticated APPLICATION.
 *
 * The SSO chain returns to the UCPath portal, which is not PeopleSoft — so a
 * login that stopped there would have no application to prove. Navigating to
 * the configured entry route is what makes the proof possible, and it is the
 * same route the neutral reset uses. This is not a fallback: it is the last hop
 * of the login, and the verification after it is loud.
 */
async function enterAuthenticatedApplication(context: SystemLoginContext): Promise<void> {
  const { page, config } = context;
  if (isAuthenticatedUcpathAppUrl(page.url())) return;
  const entry = resolveSystemEntryUrl(config, SYSTEM, context.instance, context.label);
  try {
    await raceCancellation(
      page.goto(entry, { waitUntil: "domcontentloaded", timeout: config.timeouts.navigationMs }),
      SYSTEM,
      "verify-landing",
      context,
    );
  } catch (error) {
    if (error instanceof BrowserLoginError) throw error;
    throw new BrowserLoginError(
      SYSTEM,
      "verify-landing",
      "the authenticated UCPath application route did not load after SSO cleared",
      page.url(),
      { cause: error },
    );
  }
}

export const ucpathLoginRecipe = defineVerifiedLoginRecipe({
  system: SYSTEM,
  verify: verifyUcpathAuthenticatedApplication,
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
        "the UCPath portal did not load",
        page.url(),
        { cause: error },
      );
    }

    // A warm profile can ride an existing session straight through the portal —
    // but only the two-fact probe may say so. The portal's own URL never can.
    if ((await probe()).authenticated) return "already-authenticated";

    await clickPortalLoginControl(context);

    // Campus discovery only appears when the IdP has no live session; when it
    // does, selecting UC San Diego is what produces the SSO form.
    if (page.url().includes(CAMPUS_DISCOVERY_MARKER)) await selectUcSanDiego(context);

    // Whether the Shibboleth ceremony still has to run is an OBSERVATION, not a
    // URL guess: a warm IdP session comes straight back, and the public portal
    // is reachable with no session at all — so "which UC host am I on" cannot
    // answer it. The SSO host, or the form itself being on the page, can.
    if (await isSsoCeremonyPending(context)) {
      await waitForSsoForm(SYSTEM, context);
      await fillSsoCredentials(SYSTEM, context);
      await submitSsoForm(SYSTEM, context);
      await waitForAuthenticatedLanding(
        SYSTEM,
        context,
        (url) => isUcpathPostSsoLanding(url) || url.toLowerCase().includes(CAMPUS_DISCOVERY_MARKER),
        config.timeouts.duoApprovalSeconds * 1_000,
      );
    }

    // legacy src/infra/auth/login.ts:193-203 — the post-Duo redirect chain can
    // drop back onto campus discovery; re-select and settle, bounded.
    for (let attempt = 0; attempt < CAMPUS_RESELECT_ATTEMPTS; attempt += 1) {
      if (!page.url().includes(CAMPUS_DISCOVERY_MARKER)) break;
      await selectUcSanDiego(context);
      await waitForAuthenticatedLanding(
        SYSTEM,
        context,
        isUcpathPostSsoLanding,
        config.timeouts.navigationMs,
      );
    }

    await enterAuthenticatedApplication(context);
    return "logged-in";
  },
});
