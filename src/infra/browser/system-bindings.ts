/**
 * What the browser-session factory needs to know about ONE system: how to
 * build its concrete semantic driver over a live page, how to authenticate it,
 * and how to prove it is still on its authenticated neutral state.
 *
 * The knowledge itself stays with each store (`stores/<system>/session.ts` and
 * `stores/<system>/driver/**`). This module only assembles it, so the factory
 * has one place to look and a live smoke can bind a subset.
 */
import type { BrowserDriver } from "../../base/task.js";
import type { BrowserSystemId } from "../../domain/ids.js";
import type { SystemLoginRecipe } from "./login-contract.js";
import { createCrmOnboardingDriver } from "../../stores/crm/driver/interpreter.js";
import { crmLoginRecipe, isAuthenticatedCrmUrl } from "../../stores/crm/session.js";
import { createUcpathPersonOrgDriver } from "../../stores/ucpath/driver/interpreter.js";
import { isAuthenticatedUcpathAppUrl, ucpathLoginRecipe } from "../../stores/ucpath/session.js";
import type { Page } from "playwright";

export interface BrowserSystemBinding {
  readonly system: BrowserSystemId;
  readonly createDriver: (page: Page) => BrowserDriver;
  readonly login: SystemLoginRecipe;
  /**
   * The authenticated-landing predicate. A clean release re-navigates to the
   * system's neutral entry route and re-checks this; a page that no longer
   * satisfies it is NOT reusable (doc 05 §4).
   */
  readonly isAuthenticatedUrl: (url: string) => boolean;
}

export type BrowserSystemBindings = Readonly<Partial<Record<BrowserSystemId, BrowserSystemBinding>>>;

/**
 * The systems whose driver AND login are both landed today. A system absent
 * here fails loud at session open rather than opening an unusable browser.
 */
export const BROWSER_SYSTEM_BINDINGS: BrowserSystemBindings = Object.freeze({
  ucpath: Object.freeze({
    system: "ucpath",
    createDriver: (page: Page): BrowserDriver => createUcpathPersonOrgDriver(page),
    login: ucpathLoginRecipe,
    isAuthenticatedUrl: isAuthenticatedUcpathAppUrl,
  }),
  crm: Object.freeze({
    system: "crm",
    createDriver: (page: Page): BrowserDriver => createCrmOnboardingDriver(page),
    login: crmLoginRecipe,
    isAuthenticatedUrl: isAuthenticatedCrmUrl,
  }),
} as const satisfies BrowserSystemBindings);
