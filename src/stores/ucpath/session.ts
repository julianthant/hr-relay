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
 * - `isAuthenticatedUcpathAppUrl` — the authenticated-landing predicate,
 *   including the exclusions that matter: the campus-discovery page
 *   (`ucpathdiscovery/disco`), the SSO and Duo hosts, and PeopleSoft's
 *   classic-PIA session-expiry landings `?cmd=login` / `?cmd=expire`, which
 *   live on the SAME host as an authenticated page and would otherwise read as
 *   success.
 * - `ucpathSubmitAndWaitForDuo` — the post-Duo re-selection of UC San Diego
 *   when the redirect chain drops back onto campus discovery.
 *
 * Not ported: legacy's fixed `waitForTimeout` settles and its Duo poll loop
 * (doc 05 §5 — real readiness predicates under bounded deadlines only).
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
 * legacy src/infra/auth/login.ts:69-85 — `isAuthenticatedUcpathAppUrl`, ported
 * in substance. Every exclusion is load-bearing; see the file header.
 */
export function isAuthenticatedUcpathAppUrl(rawUrl: string): boolean {
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

export const ucpathLoginRecipe: SystemLoginRecipe = async (context): Promise<LoginResult> => {
  const { page, config } = context;
  if (isAuthenticatedUcpathAppUrl(page.url())) return "already-authenticated";

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

  // A warm profile can ride an existing session straight through the portal.
  if (isAuthenticatedUcpathAppUrl(page.url())) return "already-authenticated";

  await clickPortalLoginControl(context);

  // Campus discovery only appears when the IdP has no live session; when it
  // does, selecting UC San Diego is what produces the SSO form.
  if (page.url().includes(CAMPUS_DISCOVERY_MARKER)) await selectUcSanDiego(context);

  if (!isAuthenticatedUcpathAppUrl(page.url())) {
    await waitForSsoForm(SYSTEM, context);
    await fillSsoCredentials(SYSTEM, context);
    await submitSsoForm(SYSTEM, context);
    await waitForAuthenticatedLanding(
      SYSTEM,
      context,
      (url) => isAuthenticatedUcpathAppUrl(url) || url.toLowerCase().includes(CAMPUS_DISCOVERY_MARKER),
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
      isAuthenticatedUcpathAppUrl,
      config.timeouts.navigationMs,
    );
  }

  await assertVerifiedLanding(SYSTEM, context, isAuthenticatedUcpathAppUrl);
  return "logged-in";
};
