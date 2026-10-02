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
 * (ref execution-and-sessions §5 — real readiness predicates under bounded deadlines only).
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
import { resolveSystemEntryUrl, resolveSystemLoginUrl } from "../../../models/config/instance.js";
import { recordBrowserAction } from "../browser-shared/action-notes.js";
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
  isSsoFormPresent,
  raceCancellation,
  ssoSubmitButton,
  submitSsoForm,
  verifyUcsdAuthenticatedApplication,
  waitForAuthenticatedLanding,
  waitForSsoForm,
} from "../browser-shared/ucsd-sso.js";
export { ucpathSession } from "./session-provider.js";

const SYSTEM = "ucpath" as const;
/**
 * legacy src/infra/auth/login.ts:194 — the campus-discovery landing PATH.
 *
 * Live-verified 2026-08-03: UC no longer serves campus discovery there. The
 * "Select your UC location to log in" page is now served from the PeopleSoft
 * host ROOT (`https://ucphrprdpub.universityofcalifornia.edu/`), which carries
 * no distinguishing path at all. The marker is kept because a URL that DOES
 * carry it is still discovery and still must not read as a landing — but it can
 * no longer be how discovery is detected. Detection is the campus link itself.
 */
const CAMPUS_DISCOVERY_MARKER = "ucpathdiscovery/disco";
/** legacy src/infra/auth/login.ts:42 — the campus link text. Live-verified 2026-08-03. */
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

function campusLink(page: SystemLoginContext["page"]): ReturnType<SystemLoginContext["page"]["getByRole"]> {
  return page.getByRole("link", { name: CAMPUS_LINK_NAME });
}

async function selectUcSanDiego(context: SystemLoginContext): Promise<void> {
  try {
    await raceCancellation(
      campusLink(context.page)
        .first()
        .click({ timeout: context.config.timeouts.navigationMs }),
      SYSTEM,
      "campus-discovery",
      context,
    );
    recordBrowserAction("clicked", "ucpath.campus-discovery");
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
    recordBrowserAction("clicked", "ucpath.portal.login");
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

/**
 * What the portal's log-in control actually led to.
 *
 * The click resolves BEFORE the hop chain finishes, so reading `page.url()`
 * straight after it observes the page the login is leaving, not the one it
 * reached — that race is how the 2026-08-03 run skipped the whole SSO ceremony
 * and still called itself done. This waits for the chain to present one of the
 * things it can present, and reports WHICH, so no step is inferred from a URL.
 */
async function awaitLoginGate(
  context: SystemLoginContext,
): Promise<"campus-discovery" | "sso-form" | "application"> {
  const { page, config } = context;
  const campus = campusLink(page);
  try {
    await raceCancellation(
      campus.or(ssoSubmitButton(page))
        .first()
        .waitFor({ state: "visible", timeout: config.timeouts.navigationMs }),
      SYSTEM,
      "navigate-login-entry",
      context,
    );
  } catch (error) {
    if (error instanceof BrowserLoginError) throw error;
    // A live IdP session can carry the chain straight into PeopleSoft. That is
    // a real state, and it is NOT accepted here — it still has to survive the
    // verification below like every other path.
    if (isAuthenticatedUcpathAppUrl(page.url()) || await isSsoFormPresent(page)) {
      return isAuthenticatedUcpathAppUrl(page.url()) ? "application" : "sso-form";
    }
    throw new BrowserLoginError(
      SYSTEM,
      "navigate-login-entry",
      "the portal presented neither campus discovery, nor the SSO form, nor the authenticated application",
      page.url(),
      { cause: error },
    );
  }
  return await campus.count() > 0 ? "campus-discovery" : "sso-form";
}

/**
 * Live 2026-09-07: UCPath's post-SSO BuildPage navigation can supersede our
 * entry goto, then redirect to that same entry. Only this observed same-realm
 * interruption may be settled; other errors retain their ordinary refusal.
 */
function isEntryRedirectInterruption(error: unknown, observed: string, entry: string): boolean {
  if (!(error instanceof Error)
    || !error.message.includes(" is interrupted by another navigation to ")) return false;
  const expected = new URL(entry);
  const current = new URL(observed);
  const realm = /^\/ps[cp]\/([^/]+)\/EMPLOYEE\/HRMS\//u.exec(expected.pathname)?.[1];
  return realm !== undefined && current.origin === expected.origin
    && current.pathname === `/psp/${realm}/EMPLOYEE/HRMS/s/WEBLIB_IS_PB.ISCRIPT1.FieldFormula.IScript_BuildPage`;
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
      page.goto(entry, { waitUntil: "domcontentloaded", timeout: config.timeouts.navigationMs })
        .catch(async (error: unknown): Promise<void> => {
          if (!isEntryRedirectInterruption(error, page.url(), entry)) throw error;
          // Observe the existing navigation; never issue a second goto or
          // replay SSO. The wrapper still requires PS_TOKEN and absent forms.
          await page.waitForURL((url) => url.href === entry, {
            waitUntil: "domcontentloaded", timeout: config.timeouts.navigationMs,
          });
        }),
      SYSTEM,
      "verify-landing",
      context,
    );
    recordBrowserAction("opened", "ucpath.application");
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
      recordBrowserAction("opened", "ucpath.portal");
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
    // but only the two-fact probe may say so. The portal's own URL never can;
    // the wrapper probes again after this navigation and skips the ceremony.
  },
  ceremony: async (context, token): Promise<void> => {
    const { page, config } = context;
    // The portal's login control is the first navigation that can reach the
    // Duo ceremony, so it runs under the lease (ref execution-and-sessions §10.2).
    await clickPortalLoginControl(context);

    // Campus discovery only appears when the IdP has no live session; when it
    // does, selecting UC San Diego is what produces the SSO form.
    const gate = await awaitLoginGate(context);
    if (gate === "campus-discovery") await selectUcSanDiego(context);

    if (gate !== "application") {
      await waitForSsoForm(SYSTEM, context, token);
      await fillSsoCredentials(SYSTEM, context, token);
      await submitSsoForm(SYSTEM, context, token);
      await waitForAuthenticatedLanding(
        SYSTEM,
        context,
        token,
        (url) => isUcpathPostSsoLanding(url) || url.toLowerCase().includes(CAMPUS_DISCOVERY_MARKER),
        config.timeouts.duoApprovalSeconds * 1_000,
      );
    }

    // legacy src/infra/auth/login.ts:193-203 — the post-Duo redirect chain can
    // drop back onto campus discovery; re-select and settle, bounded. Detected
    // by the link, not the path: see CAMPUS_DISCOVERY_MARKER.
    for (let attempt = 0; attempt < CAMPUS_RESELECT_ATTEMPTS; attempt += 1) {
      if (await campusLink(page).count() === 0) break;
      await selectUcSanDiego(context);
      await waitForAuthenticatedLanding(
        SYSTEM,
        context,
        token,
        isUcpathPostSsoLanding,
        config.timeouts.navigationMs,
      );
    }

    await enterAuthenticatedApplication(context);
  },
});
