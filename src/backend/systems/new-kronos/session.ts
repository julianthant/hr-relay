
import { resolveSystemLoginUrl } from "../../../models/config/instance.js";
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

const SYSTEM = "new-kronos" as const;

const NEW_KRONOS_APP_HOST = "ucsd-sso.prd.mykronos.com";
/** The application route every authenticated WFD page sits under. */
const NEW_KRONOS_APP_PATH = "/wfd";
// The WFD application issues kronosAuthToken on its exact domain; a redirect URL alone is not proof.
const NEW_KRONOS_SESSION_COOKIE = "kronosAuthToken";
const NEW_KRONOS_COOKIE_DOMAIN = "ucsd-sso.prd.mykronos.com";
// WFD issues its application cookie after SPA loading, not at the initial SSO redirect.
const NEW_KRONOS_SESSION_COOKIE_POLL_MS = 250;
/** 80 x 250ms = a 20s bound on the application's own bootstrap. */
const NEW_KRONOS_SESSION_COOKIE_POLLS = 80;

const SSO_FORM_SELECTOR =
  'input#ssousername, input#ssopassword, button[name="_eventId_proceed"], form[name="loginForm"]';


function isAuthenticatedNewKronosUrl(rawUrl: string): boolean {
  const url = URL.parse(rawUrl);
  if (url === null) return false;
  const path = url.pathname;
  return url.protocol === "https:" && url.host === NEW_KRONOS_APP_HOST
    && (path === NEW_KRONOS_APP_PATH || path.startsWith(`${NEW_KRONOS_APP_PATH}/`));
}


async function probeIssuedSessionCookie(page: Page, assertCurrent: () => void): Promise<ObservedFact> {
  assertCurrent();
  // Bound verification by poll count; the verifier has no Clock and cannot invent a wall-clock source.
  let observed: ObservedFact = { holds: false, detail: "the session-cookie probe never ran" };
  for (let poll = 0; poll < NEW_KRONOS_SESSION_COOKIE_POLLS; poll++) {
    assertCurrent();
    observed = await probeSessionCookie(page, {
      assertCurrent,
      name: NEW_KRONOS_SESSION_COOKIE,
      domainSuffix: NEW_KRONOS_COOKIE_DOMAIN,
      issuer: "UKG Dimensions (WFD)",
    });
    assertCurrent();
    if (observed.holds) return observed;
    assertCurrent();
    await new Promise<void>((resolve) => { setTimeout(resolve, NEW_KRONOS_SESSION_COOKIE_POLL_MS); });
    assertCurrent();
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
  assertCurrent: context.assertCurrent,
  urlIsApplication: isAuthenticatedNewKronosUrl,
  urlRefusal:
    "the observed URL is not the UKG Dimensions (WFD) application; the ForgeRock sign-on host shares the mykronos.com domain and is refused here",
  positive: async () => probeIssuedSessionCookie(context.page, context.assertCurrent),
  additionalAbsences: [
    async () => probeAbsentControl(context.page, {
      assertCurrent: context.assertCurrent,
      selector: SSO_FORM_SELECTOR,
      description: "the UCSD single sign-on form and the ForgeRock XUI login shell",
    }),
  ],
});

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
    await fillSsoCredentials(SYSTEM, context, token);
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
