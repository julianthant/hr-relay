
import type { BrowserDriver } from "../../../workflow-kit/task.js";
import type { Clock } from "../../../rules/time/clock.js";
import type { BrowserSystemId } from "../../../rules/identity/ids.js";
import type { AuthenticatedApplicationVerifier, SystemLoginRecipe } from "../../systems/browser-shared/login-contract.js";
import { createCrmOnboardingDriver } from "../../systems/crm/driver/interpreter.js";
import { createKualiRrssDocumentDriver } from "../../systems/kuali/driver/interpreter.js";
import { kualiLoginRecipe, verifyKualiAuthenticatedApplication } from "../../systems/kuali/session.js";
import { crmLoginRecipe, verifyCrmAuthenticatedApplication } from "../../systems/crm/session.js";
import { createNewKronosTimecardDriver } from "../../systems/new-kronos/driver/interpreter.js";
import {
  newKronosLoginRecipe,
  verifyNewKronosAuthenticatedApplication,
} from "../../systems/new-kronos/session.js";
import { createUcpathPersonOrgDriver } from "../../systems/ucpath/driver/interpreter.js";
import { ucpathLoginRecipe, verifyUcpathAuthenticatedApplication } from "../../systems/ucpath/session.js";
import type { Page } from "playwright";

export interface BrowserSystemBinding {
  readonly system: BrowserSystemId;

  readonly createDriver: (page: Page, clock: Clock, assertCurrent: () => void) => BrowserDriver;
  readonly login: SystemLoginRecipe;

  readonly verifyAuthenticated: AuthenticatedApplicationVerifier;
}

export type BrowserSystemBindings = Readonly<Partial<Record<BrowserSystemId, BrowserSystemBinding>>>;

// Missing system bindings refuse; an unimplemented driver is never a fallback.
export const BROWSER_SYSTEM_BINDINGS: BrowserSystemBindings = Object.freeze({
  ucpath: Object.freeze({
    system: "ucpath",
    createDriver: (page: Page, clock: Clock, assertCurrent: () => void): BrowserDriver =>
      createUcpathPersonOrgDriver(assertCurrent, page, clock),
    login: ucpathLoginRecipe,
    verifyAuthenticated: verifyUcpathAuthenticatedApplication,
  }),
  crm: Object.freeze({
    system: "crm",
    createDriver: (page: Page, _clock: Clock, assertCurrent: () => void): BrowserDriver => createCrmOnboardingDriver(assertCurrent, page),
    login: crmLoginRecipe,
    verifyAuthenticated: verifyCrmAuthenticatedApplication,
  }),
  kuali: Object.freeze({
    system: "kuali",
    createDriver: (page: Page, clock: Clock, assertCurrent: () => void): BrowserDriver =>
      createKualiRrssDocumentDriver(assertCurrent, page, clock),
    login: kualiLoginRecipe,
    verifyAuthenticated: verifyKualiAuthenticatedApplication,
  }),
  "new-kronos": Object.freeze({
    system: "new-kronos",
    createDriver: (page: Page, clock: Clock, assertCurrent: () => void): BrowserDriver =>
      createNewKronosTimecardDriver(assertCurrent, page, clock),
    login: newKronosLoginRecipe,
    verifyAuthenticated: verifyNewKronosAuthenticatedApplication,
  }),
} as const satisfies BrowserSystemBindings);
