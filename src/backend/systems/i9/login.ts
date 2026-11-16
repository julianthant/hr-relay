import { resolveSystemLoginUrl } from "../../../models/config/instance.js";
import { recordBrowserAction } from "../browser-shared/action-notes.js";
import { defineVerifiedLoginRecipe } from "../browser-shared/authenticated-application.js";
import { BrowserLoginError, type AuthenticatedApplicationVerifier, type SystemLoginContext, type SystemLoginRecipe } from "../browser-shared/login-contract.js";
import { fillSsoCredentials, raceCancellation, ssoSubmitButton, submitSsoForm, verifyUcsdAuthenticatedApplication, waitForAuthenticatedLanding, waitForSsoForm } from "../browser-shared/ucsd-sso.js";
import { I9_APP_ORIGIN, I9_UI_REGISTRY as ui } from "./driver/ui-registry.js";

function isI9AppHost(raw: string): boolean {
  const url = URL.parse(raw);
  return url?.origin === I9_APP_ORIGIN && url.username === "" && url.password === "";
}

export function isAuthenticatedI9Url(raw: string): boolean {
  const url = URL.parse(raw);
  return url !== null && isI9AppHost(raw) && !/login|training/iu.test(url.pathname);
}

export const verifyI9AuthenticatedApplication: AuthenticatedApplicationVerifier = context => verifyUcsdAuthenticatedApplication("i9", context.page, {
  assertCurrent: context.assertCurrent,
  urlIsApplication: isAuthenticatedI9Url,
  urlRefusal: "the observed URL is not the I-9 Complete application",
  positive: async () => {
    context.assertCurrent();
    const marker = ui.searchOptions(context.page);
    const count = await marker.count();
    context.assertCurrent();
    if (count !== 1) return { holds: false, detail: "the I-9 Search Options application control is missing or ambiguous" };
    const visible = await marker.isVisible();
    context.assertCurrent();
    return { holds: visible, detail: visible ? "I-9 Complete rendered its Search Options application control" : "the I-9 application control is not visible" };
  },
  additionalAbsences: [async () => {
    context.assertCurrent();
    const visible = await ui.dismissTraining(context.page).isVisible();
    context.assertCurrent();
    return { holds: !visible, detail: visible ? "the I-9 training notification is still visible" : "the I-9 training notification is absent" };
  }],
});

async function dismissTraining(context: SystemLoginContext): Promise<void> {
  const { page, config } = context;
  const run = <T>(operation: () => Promise<T>) => raceCancellation(operation, "i9", "verify-landing", context);
  context.assertCurrent();
  const trainingRoute = /training/iu.test(new URL(page.url()).pathname);
  const dismiss = ui.dismissTraining(page);
  if (trainingRoute) await run(() => dismiss.waitFor({ state: "visible", timeout: config.timeouts.navigationMs }));
  if (await run(() => dismiss.isVisible())) {
    await run(() => dismiss.click({ timeout: config.timeouts.navigationMs }));
    recordBrowserAction("clicked", "i9.training.dismiss");
    await run(() => ui.confirmTraining(page).click({ timeout: config.timeouts.navigationMs }));
    recordBrowserAction("clicked", "i9.training.confirm");
  }
  // The training notice renders Search Options too, so only leaving its route proves the dismissal.
  if (/training/iu.test(new URL(page.url()).pathname)) {
    await run(() => page.waitForURL(url => isAuthenticatedI9Url(url.href), { timeout: config.timeouts.navigationMs }));
  }
  await run(() => ui.searchOptions(page).waitFor({ state: "visible", timeout: config.timeouts.navigationMs }));
}

const loginRecipe = defineVerifiedLoginRecipe({
  system: "i9",
  verify: verifyI9AuthenticatedApplication,
  navigate: async context => {
    context.assertCurrent();
    if (isI9AppHost(context.page.url())) {
      const trainingRoute = /training/iu.test(new URL(context.page.url()).pathname);
      const banner = await raceCancellation(() => ui.dismissTraining(context.page).isVisible(), "i9", "verify-landing", context);
      if (trainingRoute || banner) {
        await dismissTraining(context);
        return;
      }
    }
    const entry = resolveSystemLoginUrl(context.config, "i9", context.instance, context.label);
    await raceCancellation(() => context.page.goto(entry, { waitUntil: "domcontentloaded", timeout: context.config.timeouts.navigationMs }), "i9", "navigate-login-entry", context);
    recordBrowserAction("opened", "i9.login.entry");
  },
  ceremony: async (context, token) => {
    const { page, config } = context;
    const run = <T>(operation: () => Promise<T>) => raceCancellation(operation, "i9", "campus-discovery", context);
    context.assertCurrent();
    if (!isI9AppHost(page.url())) {
      const origin = new URL(page.url()).origin;
      if (origin !== "https://samlproxy.ucop.edu" && origin !== "https://a5.ucsd.edu") {
        await run(() => ui.launch(page).click({ timeout: config.timeouts.navigationMs }));
        recordBrowserAction("clicked", "i9.login.launch");
        await run(() => page.waitForURL(url => url.origin === "https://samlproxy.ucop.edu" || url.origin === "https://a5.ucsd.edu" || isI9AppHost(url.href), { timeout: config.timeouts.navigationMs }));
      }
      await run(() => ui.campus(page).or(ssoSubmitButton(page)).or(ui.searchOptions(page)).or(ui.dismissTraining(page)).first()
        .waitFor({ state: "visible", timeout: config.timeouts.navigationMs }));
      context.assertCurrent();
      if (new URL(page.url()).origin === "https://samlproxy.ucop.edu") {
        await run(() => ui.campus(page).selectOption({ label: "University of California, San Diego" }, { timeout: config.timeouts.navigationMs }));
        recordBrowserAction("selected", "i9.login.campus", "University of California, San Diego");
        await run(() => ui.selectCampus(page).click({ timeout: config.timeouts.navigationMs }));
        await run(() => page.waitForURL(url => url.origin === "https://a5.ucsd.edu" || isI9AppHost(url.href), { timeout: config.timeouts.navigationMs }));
      }
      context.assertCurrent();
      if (!isI9AppHost(page.url())) {
        await waitForSsoForm("i9", context, token);
        context.assertCurrent();
        if (new URL(page.url()).origin !== "https://a5.ucsd.edu") throw new BrowserLoginError("i9", "sso-form", "the UCSD SSO form is on an unexpected origin", page.url());
        await fillSsoCredentials("i9", context, token);
        await submitSsoForm("i9", context, token);
        await waitForAuthenticatedLanding("i9", context, token, isI9AppHost, config.timeouts.duoApprovalSeconds * 1_000);
      }
    }
    context.assertCurrent();
    await dismissTraining(context);
  },
});

export const i9LoginRecipe: SystemLoginRecipe = async context => {
  try {
    return await loginRecipe(context);
  } catch (error) {
    context.assertCurrent();
    if (error instanceof BrowserLoginError) throw error;
    throw new BrowserLoginError("i9", "verify-landing", "I-9 login could not prove the authenticated application", context.page.url(), { cause: error });
  }
};
