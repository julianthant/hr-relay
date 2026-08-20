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
import type { Clock } from "../../domain/clock.js";
import type { BrowserSystemId } from "../../domain/ids.js";
import type { AuthenticatedApplicationVerifier, SystemLoginRecipe } from "./login-contract.js";
import { createCrmOnboardingDriver } from "../../stores/crm/driver/interpreter.js";
import { createKualiRrssDocumentDriver } from "../../stores/kuali/driver/interpreter.js";
import { kualiLoginRecipe, verifyKualiAuthenticatedApplication } from "../../stores/kuali/session.js";
import { crmLoginRecipe, verifyCrmAuthenticatedApplication } from "../../stores/crm/session.js";
import { createNewKronosTimecardDriver } from "../../stores/new-kronos/driver/interpreter.js";
import {
  newKronosLoginRecipe,
  verifyNewKronosAuthenticatedApplication,
} from "../../stores/new-kronos/session.js";
import { createUcpathPersonOrgDriver } from "../../stores/ucpath/driver/interpreter.js";
import { ucpathLoginRecipe, verifyUcpathAuthenticatedApplication } from "../../stores/ucpath/session.js";
import type { Page } from "playwright";

export interface BrowserSystemBinding {
  readonly system: BrowserSystemId;
  /**
   * The injected `Clock` is the ONE time source a driver may read (ref clock-config-secrets);
   * a driver that stamps its own observations with `new Date()` would be a
   * second clock the manual-clock tests could never control.
   */
  readonly createDriver: (page: Page, clock: Clock) => BrowserDriver;
  readonly login: SystemLoginRecipe;
  /**
   * The authenticated-application PROOF — the same one the login recipe must
   * pass. A clean release re-navigates to the system's neutral entry route and
   * re-runs it; a page that cannot prove a live session is NOT reusable
   * (ref execution-and-sessions §4).
   *
   * This was a `(url: string) => boolean` predicate until 2026-08-03, when a
   * PeopleSoft signon page — same host, same route shape as the application —
   * passed the reset check and left a session that would have scraped a
   * sign-in page as authenticated data.
   */
  readonly verifyAuthenticated: AuthenticatedApplicationVerifier;
}

export type BrowserSystemBindings = Readonly<Partial<Record<BrowserSystemId, BrowserSystemBinding>>>;

/**
 * The systems whose driver AND login are both landed today. A system absent
 * here fails loud at session open rather than opening an unusable browser.
 */
export const BROWSER_SYSTEM_BINDINGS: BrowserSystemBindings = Object.freeze({
  ucpath: Object.freeze({
    system: "ucpath",
    createDriver: (page: Page, clock: Clock): BrowserDriver =>
      createUcpathPersonOrgDriver(page, clock),
    login: ucpathLoginRecipe,
    verifyAuthenticated: verifyUcpathAuthenticatedApplication,
  }),
  crm: Object.freeze({
    system: "crm",
    createDriver: (page: Page): BrowserDriver => createCrmOnboardingDriver(page),
    login: crmLoginRecipe,
    verifyAuthenticated: verifyCrmAuthenticatedApplication,
  }),
  kuali: Object.freeze({
    system: "kuali",
    createDriver: (page: Page, clock: Clock): BrowserDriver =>
      createKualiRrssDocumentDriver(page, clock),
    login: kualiLoginRecipe,
    verifyAuthenticated: verifyKualiAuthenticatedApplication,
  }),
  "new-kronos": Object.freeze({
    system: "new-kronos",
    createDriver: (page: Page, clock: Clock): BrowserDriver =>
      createNewKronosTimecardDriver(page, clock),
    login: newKronosLoginRecipe,
    verifyAuthenticated: verifyNewKronosAuthenticatedApplication,
  }),
} as const satisfies BrowserSystemBindings);
