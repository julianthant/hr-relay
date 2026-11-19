
import { systemClock } from "../../../rules/time/clock.js";
import { resolveSystemLoginUrl } from "../../../models/config/instance.js";
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
} from "../browser-shared/login-contract.js";
import {
  abortIfCancelled,
  raceCancellation,
  submitSsoForm,
  verifyUcsdAuthenticatedApplication,
  waitForAuthenticatedLanding,
  waitForSsoForm,
} from "../browser-shared/ucsd-sso.js";

const SYSTEM = "new-kronos" as const;

const NEW_KRONOS_APP_HOST = "ucsd-sso.prd.mykronos.com";
/** The routes authenticated WFD pages sit under; Go To -> Timecard lands on /timekeeping#/timecard. */
const NEW_KRONOS_APP_PATHS = ["/wfd", "/timekeeping"] as const;
// The WFD application issues kronosAuthToken on its exact domain; a redirect URL alone is not proof.
const NEW_KRONOS_SESSION_COOKIE = "kronosAuthToken";
const NEW_KRONOS_COOKIE_DOMAIN = "ucsd-sso.prd.mykronos.com";
// WFD can redirect and issue its application cookie while bootstrapping.
const LANDING_POLL_MS = 250;
const LANDING_TIMEOUT_MS = 20_000;

const SSO_FORM_SELECTOR =
  'input#ssousername, input#ssopassword, button[name="_eventId_proceed"], form[name="loginForm"]';


function isAuthenticatedNewKronosUrl(rawUrl: string): boolean {
  const url = URL.parse(rawUrl);
  if (url === null) return false;
  const path = url.pathname;
  return url.protocol === "https:" && url.host === NEW_KRONOS_APP_HOST
    && NEW_KRONOS_APP_PATHS.some(root => path === root || path.startsWith(`${root}/`));
}


export const verifyNewKronosAuthenticatedApplication: AuthenticatedApplicationVerifier = async (
  context, phase,
): Promise<AuthenticationProbe> => {
  const { page, assertCurrent } = context;
  const deadline = systemClock.monotonicMs() + LANDING_TIMEOUT_MS;
  const probe = () => verifyUcsdAuthenticatedApplication(SYSTEM, page, {
    assertCurrent,
    urlIsApplication: isAuthenticatedNewKronosUrl,
    urlRefusal:
      "the observed URL is not the UKG Dimensions (WFD) application; the ForgeRock sign-on host shares the mykronos.com domain and is refused here",
    positive: () => probeSessionCookie(page, {
      assertCurrent,
      name: NEW_KRONOS_SESSION_COOKIE,
      domainSuffix: NEW_KRONOS_COOKIE_DOMAIN,
      issuer: "UKG Dimensions (WFD)",
    }),
    additionalAbsences: [
      () => probeAbsentControl(page, {
        assertCurrent,
        selector: SSO_FORM_SELECTOR,
        description: "the UCSD single sign-on form and the ForgeRock XUI login shell",
      }),
    ],
  });
  let result = await probe();
  assertCurrent();
  while (!result.authenticated) {
    const awaitingLanding = phase === "landing" && result.check === "application-route";
    if (!awaitingLanding && result.check !== "positive-evidence") break;
    if (deadline - systemClock.monotonicMs() <= LANDING_POLL_MS) break;
    await new Promise<void>(resolve => setTimeout(resolve, LANDING_POLL_MS));
    assertCurrent();
    if (systemClock.monotonicMs() >= deadline) break;
    // A redirect invalidates the prior poll's cookie and form observations.
    result = await probe();
    assertCurrent();
  }
  return result;
};

export const newKronosLoginRecipe = defineVerifiedLoginRecipe({
  system: SYSTEM,
  verify: verifyNewKronosAuthenticatedApplication,
  navigate: async (context): Promise<void> => {
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
      recordBrowserAction("opened", "new-kronos.login-entry");
    } catch (error) {
      context.assertCurrent();
      if (error instanceof BrowserLoginError) throw error;
      throw new BrowserLoginError(
        SYSTEM,
        "navigate-login-entry",
        "the UKG Dimensions (WFD) home entry route did not load",
        page.url(),
        { cause: error },
      );
    }


  },
  ceremony: async (context, token): Promise<void> => {
    context.assertCurrent();
    const { config } = context;
    context.assertCurrent();
    await waitForSsoForm(SYSTEM, context, token);
    context.assertCurrent();
    await submitSsoForm(SYSTEM, context, token);
    context.assertCurrent();
    await waitForAuthenticatedLanding(
      SYSTEM,
      context,
      token,
      isAuthenticatedNewKronosUrl,
      config.timeouts.duoApprovalSeconds * 1_000,
    );
    context.assertCurrent();
  },
});
