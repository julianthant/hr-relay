
import { resolveSystemLoginUrl } from "../../../models/config/instance.js";
import { recordBrowserAction } from "../browser-shared/action-notes.js";
import {
  defineVerifiedLoginRecipe,
  probeAbsentControl,
} from "../browser-shared/authenticated-application.js";
import type { ObservedFact } from "../browser-shared/authenticated-application.js";
import { BrowserLoginError } from "../browser-shared/login-contract.js";
import type {
  AuthenticatedApplicationVerifier,
  AuthenticationProbe,
} from "../browser-shared/login-contract.js";
import {
  abortIfCancelled,
  fillSsoCredentials,
  raceCancellation,
  submitSsoForm,
  verifyUcsdAuthenticatedApplication,
  waitForAuthenticatedLanding,
  waitForSsoForm,
} from "../browser-shared/ucsd-sso.js";

const SYSTEM = "kuali" as const;

const KUALI_APP_HOST = "ucsd.kualibuild.com";
// Application menu chrome proves a Kuali session; the host alone does not.
const KUALI_APP_CONTROL_SELECTOR = '[role="menuitem"], [role="menubar"]';
// Kuali SPA chrome appears after domcontentloaded; wait for its authenticated marker.
const KUALI_APP_CONTROL_RENDER_MS = 15_000;
/** The TritON sign-in form; if it is on screen we are not in the application. */
const SSO_FORM_SELECTOR = 'input#ssousername, input[name="j_username"], input[type="password"]';


function isAuthenticatedKualiUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const path = url.pathname;
    return url.protocol === "https:" && url.host === KUALI_APP_HOST
      && (path.startsWith("/app/") || path.startsWith("/build/space/"));
  } catch {
    return false;
  }
}

// Kuali has no verified authentication-only cookie; prove session with application chrome and absent SSO controls.
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
      recordBrowserAction("opened", "kuali.login-entry");
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
      isAuthenticatedKualiUrl,
      config.timeouts.duoApprovalSeconds * 1_000,
    );
  },
});
