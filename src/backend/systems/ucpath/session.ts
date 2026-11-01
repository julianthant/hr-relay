
import { resolveSystemEntryUrl, resolveSystemLoginUrl } from "../../../models/config/instance.js";
import { recordBrowserAction } from "../browser-shared/action-notes.js";
import {
  defineVerifiedLoginRecipe,
  probeAbsentControl,
  probeSessionCookie,
} from "../browser-shared/authenticated-application.js";
import { BrowserLoginError, BrowserLandingStallError } from "../browser-shared/login-contract.js";
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

import type { DuoCeremonyLeaseToken } from "../../../workflow-kit/duo-ceremony-lease.js";

const SYSTEM = "ucpath" as const;
// Detect campus discovery by its link; its post-SSO path need not match the entry route.
const CAMPUS_DISCOVERY_MARKER = "ucpathdiscovery/disco";

const CAMPUS_LINK_NAME = "University of California, San Diego";

const LOGIN_CONTROL_NAME = /log in to ucpath/i;

const CAMPUS_RESELECT_ATTEMPTS = 3;
// PeopleSoft psc and psp routes are application and portal servlets; require application evidence.
const PEOPLESOFT_APP_HOST = "ucphrprdpub.universityofcalifornia.edu";
const PEOPLESOFT_APP_PATHS = ["/psc/ucphrprd/EMPLOYEE/HRMS/", "/psp/ucphrprd/EMPLOYEE/HRMS/"] as const;
// PS_TOKEN proves the session; PS_TOKENEXPIRE may exist before authentication and cannot substitute.
const PEOPLESOFT_SESSION_COOKIE = "PS_TOKEN";
const PEOPLESOFT_COOKIE_DOMAIN = "universityofcalifornia.edu";
// PeopleSoft signon shares the application route shape; distinguish it by its form.
const PEOPLESOFT_SIGNON_SELECTOR = 'input#userid, input#pwd, input[name="userid"], input[name="pwd"]';

// A UC-host landing is only a wait predicate; the public portal also satisfies it.
export function isUcpathPostSsoLanding(rawUrl: string): boolean {
  const url = URL.parse(rawUrl);
  if (url === null) return false;
  const path = url.pathname.toLowerCase();
  return url.protocol === "https:"
    && (url.host === PEOPLESOFT_APP_HOST || url.host === "ucpath.universityofcalifornia.edu")
    && !path.includes(CAMPUS_DISCOVERY_MARKER) && !path.includes("/login") && !path.includes("shibboleth")
    && ![...url.searchParams].some(([key, value]) => key.toLowerCase() === "cmd"
      && (value.toLowerCase() === "login" || value.toLowerCase() === "expire"));
}


export function isAuthenticatedUcpathAppUrl(rawUrl: string): boolean {
  const url = URL.parse(rawUrl);
  if (url === null) return false;
  return isUcpathPostSsoLanding(rawUrl) && url.host === PEOPLESOFT_APP_HOST
    && PEOPLESOFT_APP_PATHS.some(path => url.pathname.startsWith(path));
}

/** The two-fact proof: PeopleSoft's own session token, and no sign-in form. */
export const verifyUcpathAuthenticatedApplication: AuthenticatedApplicationVerifier = async (
  context,
): Promise<AuthenticationProbe> => verifyUcsdAuthenticatedApplication(SYSTEM, context.page, {
  assertCurrent: context.assertCurrent,
  urlIsApplication: isAuthenticatedUcpathAppUrl,
  urlRefusal: "the observed URL is not a UCPath PeopleSoft application route; the public UCPath portal, campus discovery, SSO, Duo and the classic-PIA expiry landings are all refused here",
  positive: async () => probeSessionCookie(context.page, {
    assertCurrent: context.assertCurrent,
    name: PEOPLESOFT_SESSION_COOKIE,
    domainSuffix: PEOPLESOFT_COOKIE_DOMAIN,
    issuer: "UCPath PeopleSoft",
  }),
  additionalAbsences: [
    async () => probeAbsentControl(context.page, {
      assertCurrent: context.assertCurrent,
      selector: PEOPLESOFT_SIGNON_SELECTOR,
      description: "the PeopleSoft signon form",
    }),
  ],
});

function campusLink(page: SystemLoginContext["page"]): ReturnType<SystemLoginContext["page"]["getByRole"]> {
  return page.getByRole("link", { name: CAMPUS_LINK_NAME });
}

async function selectUcSanDiego(context: SystemLoginContext): Promise<void> {
  context.assertCurrent();
  try {
    await raceCancellation(
      () => campusLink(context.page)
        .first()
        .click({ timeout: context.config.timeouts.navigationMs }),
      SYSTEM,
      "campus-discovery",
      context,
    );
    context.assertCurrent();
    recordBrowserAction("clicked", "ucpath.campus-discovery");
  } catch (error) {
    context.assertCurrent();
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
  context.assertCurrent();
  const { page, config } = context;
  try {
    context.assertCurrent();
    await raceCancellation(
      () => page.getByRole("button", { name: LOGIN_CONTROL_NAME })
        .or(page.getByRole("link", { name: LOGIN_CONTROL_NAME }))
        .first()
        .click({ timeout: config.timeouts.navigationMs }),
      SYSTEM,
      "navigate-login-entry",
      context,
    );
    context.assertCurrent();
    recordBrowserAction("clicked", "ucpath.portal.login");
  } catch (error) {
    context.assertCurrent();
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

// A click resolves before the SSO hop chain; wait for the observed destination.
async function awaitLoginGate(
  context: SystemLoginContext,
): Promise<"campus-discovery" | "sso-form" | "application"> {
  context.assertCurrent();
  const { page, config } = context;
  const campus = campusLink(page);
  try {
    context.assertCurrent();
    await raceCancellation(
      () => campus.or(ssoSubmitButton(page))
        .first()
        .waitFor({ state: "visible", timeout: config.timeouts.navigationMs }),
      SYSTEM,
      "navigate-login-entry",
      context,
    );
    context.assertCurrent();
  } catch (error) {
    context.assertCurrent();
    if (error instanceof BrowserLoginError) throw error;

    context.assertCurrent();
    if (isAuthenticatedUcpathAppUrl(page.url()) || await isSsoFormPresent(page, context.assertCurrent)) {
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
  context.assertCurrent();
  const count = await campus.count();
  context.assertCurrent();
  return count > 0 ? "campus-discovery" : "sso-form";
}

// UCPath BuildPage may interrupt entry goto and redirect back to that entry; settle only the same-realm interruption.
function isEntryRedirectInterruption(error: unknown, observed: string, entry: string): boolean {
  if (!(error instanceof Error)
    || !error.message.includes(" is interrupted by another navigation to ")) return false;
  const expected = new URL(entry);
  const current = new URL(observed);
  const realm = /^\/ps[cp]\/([^/]+)\/EMPLOYEE\/HRMS\//u.exec(expected.pathname)?.[1];
  return realm !== undefined && current.origin === expected.origin
    && current.pathname === `/psp/${realm}/EMPLOYEE/HRMS/s/WEBLIB_IS_PB.ISCRIPT1.FieldFormula.IScript_BuildPage`;
}

// SSO returns to the public portal; enter the application and verify content before accepting login.
async function enterAuthenticatedApplication(context: SystemLoginContext): Promise<void> {
  context.assertCurrent();
  const { page, config } = context;
  if (isAuthenticatedUcpathAppUrl(page.url())) return;
  const entry = resolveSystemEntryUrl(config, SYSTEM, context.instance, context.label);
  try {
    context.assertCurrent();
    await raceCancellation(
      () => page.goto(entry, { waitUntil: "domcontentloaded", timeout: config.timeouts.navigationMs })
        .catch(async (error: unknown): Promise<void> => {
          context.assertCurrent();
          if (!isEntryRedirectInterruption(error, page.url(), entry)) throw error;
          // Observe the existing navigation; never issue a second goto or
          // replay SSO. The wrapper still requires PS_TOKEN and absent forms.
          context.assertCurrent();
          await page.waitForURL((url) => url.href === entry, {
            waitUntil: "domcontentloaded", timeout: config.timeouts.navigationMs,
          });
          context.assertCurrent();
        }),
      SYSTEM,
      "verify-landing",
      context,
    );
    context.assertCurrent();
    recordBrowserAction("opened", "ucpath.application");
  } catch (error) {
    context.assertCurrent();
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

async function navigateUcpathLoginEntry(context: SystemLoginContext): Promise<void> {
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
    recordBrowserAction("opened", "ucpath.portal");
  } catch (error) {
    context.assertCurrent();
    if (error instanceof BrowserLoginError) throw error;
    throw new BrowserLoginError(
      SYSTEM,
      "navigate-login-entry",
      "the UCPath portal did not load",
      page.url(),
      { cause: error },
    );
  }
}

async function completeUcpathCeremony(context: SystemLoginContext, token: DuoCeremonyLeaseToken): Promise<void> {
  context.assertCurrent();
  const { page, config } = context;
  // The portal's login control is the first navigation that can reach the
  // Duo ceremony, so it runs under the lease (ref execution-and-sessions ).
  context.assertCurrent();
  await clickPortalLoginControl(context);
  context.assertCurrent();

  // Campus discovery only appears when the IdP has no live session; when it
  // does, selecting UC San Diego is what produces the SSO form.
  context.assertCurrent();
  const gate = await awaitLoginGate(context);
  context.assertCurrent();
  if (gate === "campus-discovery") {
    context.assertCurrent();
    await selectUcSanDiego(context);
    context.assertCurrent();
  }

  if (gate !== "application") {
    context.assertCurrent();
    await waitForSsoForm(SYSTEM, context, token);
    context.assertCurrent();
    await fillSsoCredentials(SYSTEM, context, token);
    context.assertCurrent();
    await submitSsoForm(SYSTEM, context, token);
    context.assertCurrent();
    await waitForAuthenticatedLanding(
      SYSTEM,
      context,
      token,
      (url) => isUcpathPostSsoLanding(url) || url.toLowerCase().includes(CAMPUS_DISCOVERY_MARKER),
      config.timeouts.duoApprovalSeconds * 1_000,
    );
    context.assertCurrent();
  }

  // Duo can return to campus discovery; detect its link and reselect under the bounded retry.
  for (let attempt = 0; attempt < CAMPUS_RESELECT_ATTEMPTS; attempt += 1) {
    context.assertCurrent();
    if (await campusLink(page).count() === 0) break;
    context.assertCurrent();
    await selectUcSanDiego(context);
    context.assertCurrent();
    await waitForAuthenticatedLanding(
      SYSTEM,
      context,
      token,
      isUcpathPostSsoLanding,
      config.timeouts.navigationMs,
    );
    context.assertCurrent();
  }

  context.assertCurrent();
  await enterAuthenticatedApplication(context);
  context.assertCurrent();
}

export const ucpathLoginRecipe = defineVerifiedLoginRecipe({
  system: SYSTEM,
  verify: verifyUcpathAuthenticatedApplication,
  navigate: navigateUcpathLoginEntry,
  ceremony: async (context, token): Promise<void> => {
    context.assertCurrent();
    try {
      await completeUcpathCeremony(context, token);
      context.assertCurrent();
    } catch (error) {
      context.assertCurrent();
      if (!(error instanceof BrowserLandingStallError)
        || error.code !== "SHIBBOLETH_STALE_REQUEST" || error.host !== "a5.ucsd.edu"
        || context.signal.aborted
        || (context.acquisitionRemainingMs !== undefined && context.acquisitionRemainingMs() <= 1_000)
        || context.claimStaleRequestRecovery?.() === false) throw error;
      context.assertCurrent();
      await navigateUcpathLoginEntry(context);
      context.assertCurrent();
      await completeUcpathCeremony(context, token);
      context.assertCurrent();
    }
  },
});
