import { resolveSystemLoginUrl } from "../../../models/config/instance.js";
import { defineVerifiedLoginRecipe } from "../browser-shared/authenticated-application.js";
import type { AuthenticatedApplicationVerifier } from "../browser-shared/login-contract.js";
import { fillSsoCredentials, raceCancellation, submitSsoForm, verifyUcsdAuthenticatedApplication, waitForAuthenticatedLanding, waitForSsoForm } from "../browser-shared/ucsd-sso.js";
import { ONBASE_UI_REGISTRY as ui } from "./driver/ui-registry.js";

const appUrl = (raw: string): boolean => {
  const url = URL.parse(raw);
  return url?.origin === "https://ucsd.hylandcloud.com" && url.pathname === "/251ids/NavPanel.aspx";
};
export const verifyOnbaseAuthenticatedApplication: AuthenticatedApplicationVerifier = context => verifyUcsdAuthenticatedApplication("onbase", context.page, {
  assertCurrent: context.assertCurrent, urlIsApplication: appUrl, urlRefusal: "The OnBase application route is missing.",
  positive: async () => {
    context.assertCurrent(); const menu = ui.mainMenu(context.page), count = await menu.count(); context.assertCurrent();
    const visible = count === 1 && await menu.isVisible(); context.assertCurrent();
    return { holds: visible, detail: visible ? "OnBase rendered its Main Menu." : "The OnBase Main Menu is missing or ambiguous." };
  },
});
export const onbaseLoginRecipe = defineVerifiedLoginRecipe({
  system: "onbase", verify: verifyOnbaseAuthenticatedApplication,
  navigate: async context => { await raceCancellation(() => context.page.goto(resolveSystemLoginUrl(context.config, "onbase", context.instance, context.label),
    { waitUntil: "domcontentloaded", timeout: context.config.timeouts.navigationMs }), "onbase", "navigate-login-entry", context); },
  ceremony: async (context, token) => {
    await waitForSsoForm("onbase", context, token);
    await fillSsoCredentials("onbase", context, token);
    await submitSsoForm("onbase", context, token);
    await waitForAuthenticatedLanding("onbase", context, token, appUrl, context.config.timeouts.duoApprovalSeconds * 1000);
  },
});
