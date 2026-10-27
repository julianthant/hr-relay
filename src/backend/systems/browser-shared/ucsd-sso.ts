import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
// Select SSO submit by name: the enrollment navigation also looks like a Login button.
import type { Locator, Page } from "playwright";
import { recordBrowserAction } from "./action-notes.js";
import { assertDuoCeremonyLeaseToken } from "../../../workflow-kit/duo-ceremony-lease.js";
import type { DuoCeremonyLeaseToken } from "../../../workflow-kit/duo-ceremony-lease.js";
import { probeAbsentControl } from "./authenticated-application.js";
import type { ObservedFact } from "./authenticated-application.js";
import { BrowserLoginError, BrowserLandingStallError, DuoTerminalRefusalError } from "./login-contract.js";
import type {
  AuthenticationProbe,
  BrowserLoginStep,
  BrowserLandingStallCode,
  SystemLoginContext,
} from "./login-contract.js";
import type { BrowserSystemId } from "../../../rules/identity/ids.js";
import { systemClock } from "../../../rules/time/clock.js";



const DUO_HOST = "duosecurity.com";

const SSO_SUBMIT_SELECTOR = 'button[name="_eventId_proceed"]';
const TRAINING_REMINDER_SELECTOR = 'input[type="submit"][value*="Continue Log In"], button:has-text("Continue Log In")';

const STALE_REQUEST_TEXT = "Web Login Service - Stale Request";
// Match Duo's outcome sentence, not its factor-specific heading; use first for the union locator.
const DUO_TERMINAL_REFUSAL_PATTERN = /login request .*(?:canceled|cancelled) or timed out/i;


export function abortIfCancelled(
  system: BrowserSystemId,
  step: BrowserLoginStep,
  context: Pick<SystemLoginContext, "page" | "signal">,
): void {
  if (!context.signal.aborted) return;
  throw new BrowserLoginError(system, step, "the session was cancelled", context.page.url());
}

// Playwright waits take no AbortSignal; race cancellation so the session can release promptly.
export async function raceCancellation<Result>(
  operation: Promise<Result>,
  system: BrowserSystemId,
  step: BrowserLoginStep,
  context: Pick<SystemLoginContext, "page" | "signal">,
): Promise<Result> {
  abortIfCancelled(system, step, context);
  let removeListener = (): void => undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    const listener = (): void => {
      reject(new BrowserLoginError(system, step, "the session was cancelled", context.page.url()));
    };
    context.signal.addEventListener("abort", listener, { once: true });
    removeListener = (): void => context.signal.removeEventListener("abort", listener);
  });
  try {
    return await Promise.race([operation, cancelled]);
  } finally {
    removeListener();
  }
}

// TritON labels vary by login realm; stable id/name anchors identify the same username field.
const SSO_USERNAME_SELECTOR = '#ssousername, input[name="urn:mace:ucsd.edu:sso:username"]';
const SSO_USERNAME_LABELS = [
  "User name (or email address)",
  "Account ID or email address",
  "Username",
] as const;
// The password label and stable ssopassword ID bind the same SSO control.
const SSO_PASSWORD_SELECTOR = '#ssopassword, input[name="urn:mace:ucsd.edu:sso:password"]';
const SSO_PASSWORD_LABELS = ["Password:", "Password"] as const;

function byLabels(page: Page, base: Locator, labels: readonly string[]): Locator {
  return labels.reduce<Locator>((chain, label) => chain.or(page.getByLabel(label)), base);
}

function usernameField(page: Page): Locator {
  return byLabels(page, page.locator(SSO_USERNAME_SELECTOR), SSO_USERNAME_LABELS).first();
}

function passwordField(page: Page): Locator {
  return byLabels(page, page.locator(SSO_PASSWORD_SELECTOR), SSO_PASSWORD_LABELS).first();
}

export async function submitOnboardingSsoCredentials(page: Page,
  acquire: () => Promise<Readonly<{ userId: string; password: string }>>,
  assertCurrent: () => void, timeout: number): Promise<void> {
  const url = page.url(), path = "/tritON/profile/SAML2/Redirect/SSO";
  const allowed = (value: string) => {
    const parsed = URL.parse(value);
    return parsed?.origin === "https://a5.ucsd.edu" && parsed.username === "" && parsed.password === "" && parsed.port === "" && parsed.pathname === path;
  };
  const check = () => { assertCurrent(); if (page.url() !== url || !allowed(url)) throw new Error("ONBOARDING_SSO_SCOPE"); };
  check();
  const username = page.locator(SSO_USERNAME_SELECTOR), password = page.locator(SSO_PASSWORD_SELECTOR), submit = page.locator(SSO_SUBMIT_SELECTOR);
  const users = await username.count(); check();
  const passwords = await password.count(); check();
  const buttons = await submit.count(); check();
  if (users !== 1 || passwords !== 1 || buttons !== 1) throw new Error("ONBOARDING_SSO_FIELDS");
  let user: Awaited<ReturnType<typeof username.elementHandle>> = null;
  let secret: Awaited<ReturnType<typeof password.elementHandle>> = null;
  let button: Awaited<ReturnType<typeof submit.elementHandle>> = null;
  try {
    user = await username.elementHandle(); check();
    secret = await password.elementHandle(); check();
    button = await submit.elementHandle(); check();
    if (!user || !secret || !button) throw new Error("ONBOARDING_SSO_FIELDS");
    const pinnedUser = user, pinnedSecret = secret, pinnedSubmit = button;
    const controls = async () => {
      check();
      for (const field of [pinnedUser, pinnedSecret]) {
        const visible = await field.isVisible(); check();
        const editable = await field.isEditable(); check();
        if (!visible || !editable) throw new Error("ONBOARDING_SSO_FIELDS");
      }
      const visible = await pinnedSubmit.isVisible(); check();
      const enabled = await pinnedSubmit.isEnabled(); check();
      if (!visible || !enabled) throw new Error("ONBOARDING_SSO_FIELDS");
      const valid = await pinnedUser.evaluate((element, input) => {
        if (!(element instanceof HTMLInputElement) || !(input.other instanceof HTMLInputElement) || !(input.submit instanceof HTMLButtonElement)) return false;
        const form = element.form, action = form === null ? null : new URL(form.action);
        const buttonAction = new URL(input.submit.formAction);
        return element.isConnected && input.other.isConnected && input.submit.isConnected
          && element.ownerDocument === document && input.other.ownerDocument === document && input.submit.ownerDocument === document
          && form !== null && form === input.other.form && form === input.submit.form && input.other.type === "password" && input.submit.type === "submit"
          && form.method === "post" && (input.submit.formMethod === "" || input.submit.formMethod === "post")
          && (form.target === "" || form.target === "_self") && (input.submit.formTarget === "" || input.submit.formTarget === "_self")
          && buttonAction.origin === "https://a5.ucsd.edu" && buttonAction.username === "" && buttonAction.password === "" && buttonAction.port === "" && buttonAction.pathname === input.path
          && action?.origin === "https://a5.ucsd.edu" && action.username === "" && action.password === "" && action.port === "" && action.pathname === input.path;
      }, { other: pinnedSecret, submit: pinnedSubmit, path });
      check(); if (!valid) throw new Error("ONBOARDING_SSO_FIELDS");
    };
    await controls();
    const credentials = await acquire(); check();
    await controls();
    await user.fill(credentials.userId, { timeout }); check();
    await controls();
    await secret.fill(credentials.password, { timeout }); check();
    await controls();
    await button.click({ timeout }); assertCurrent();
  } finally { try { await user?.dispose(); } finally { try { await secret?.dispose(); } finally { await button?.dispose(); } } }
}


export function ssoSubmitButton(page: Page): Locator {
  return page.locator(SSO_SUBMIT_SELECTOR).first();
}


export async function isSsoFormPresent(page: Page): Promise<boolean> {
  return await ssoSubmitButton(page).count() > 0;
}


async function probeSsoFormAbsent(page: Page): Promise<ObservedFact> {
  return probeAbsentControl(page, {
    selector: `${SSO_SUBMIT_SELECTOR}, ${SSO_USERNAME_SELECTOR}`,
    description: "the UCSD TritON SSO form",
  });
}

// Shibboleth paints through client-side interstitials; load-state alone does not prove form readiness.
export async function waitForSsoForm(
  system: BrowserSystemId,
  context: SystemLoginContext,
  token: DuoCeremonyLeaseToken,
): Promise<void> {
  assertDuoCeremonyLeaseToken(token, { system });
  await raceCancellation(
    ssoSubmitButton(context.page)
      .waitFor({ state: "visible", timeout: context.config.timeouts.navigationMs }),
    system,
    "sso-form",
    context,
  ).catch((error: unknown) => {
    if (error instanceof BrowserLoginError) throw error;
    throw new BrowserLoginError(
      system,
      "sso-form",
      "the UCSD SSO form never rendered",
      context.page.url(),
      { cause: error },
    );
  });
}


export async function fillSsoCredentials(
  system: BrowserSystemId,
  context: SystemLoginContext,
  token: DuoCeremonyLeaseToken,
): Promise<void> {
  assertDuoCeremonyLeaseToken(token, { system });
  const timeout = context.config.timeouts.navigationMs;

  await requireMatchedField(system, context, usernameField(context.page), "username", SSO_USERNAME_SELECTOR);
  await requireMatchedField(system, context, passwordField(context.page), "password", SSO_PASSWORD_SELECTOR);
  try {
    await usernameField(context.page).fill(context.credentials.userId, { timeout });
    recordBrowserAction("typed", "ucsd.sso.username");
    await passwordField(context.page).fill(context.credentials.password, { timeout });
    recordBrowserAction("typed", "ucsd.sso.password");
  } catch (error) {
    throw new BrowserLoginError(
      system,
      "credential-fill",
      "the SSO username/password fields could not be filled",
      context.page.url(),
      { cause: error },
    );
  }
}

async function requireMatchedField(
  system: BrowserSystemId,
  context: SystemLoginContext,
  field: Locator,
  role: "username" | "password",
  anchors: string,
): Promise<void> {
  let matches: number;
  try {
    matches = await field.count();
  } catch (error) {
    throw new BrowserLoginError(
      system,
      "credential-fill",
      `the SSO ${role} field could not be counted, so its presence is unproven`,
      context.page.url(),
      { cause: error },
    );
  }
  if (matches === 0) {
    throw new BrowserLoginError(
      system,
      "credential-fill",
      `the SSO ${role} field matched no element; the ported locator chain (${anchors}, then its visible label) is stale and must be re-verified against the live page`,
      context.page.url(),
    );
  }
}

/** Clicks the SSO submit control. Duo Autopilot answers the prompt that follows. */
export async function submitSsoForm(
  system: BrowserSystemId,
  context: SystemLoginContext,
  token: DuoCeremonyLeaseToken,
): Promise<void> {

  assertDuoCeremonyLeaseToken(token, { system });
  abortIfCancelled(system, "sso-submit", context);
  try {
    await ssoSubmitButton(context.page).click({ timeout: context.config.timeouts.navigationMs });
    recordBrowserAction("clicked", "ucsd.sso.submit");
  } catch (error) {
    throw new BrowserLoginError(
      system,
      "sso-submit",
      "the SSO submit control could not be clicked",
      context.page.url(),
      { cause: error },
    );
  }
}

function duoTerminalRefusalLocator(page: Page): Locator {
  return page.getByText(DUO_TERMINAL_REFUSAL_PATTERN).first();
}

// Only a terminal refusal settles this arm; the parallel landing wait owns its timeout.
async function observeDuoTerminalRefusal(page: Page, timeoutMs: number): Promise<"duo-refused"> {
  try {
    await duoTerminalRefusalLocator(page).waitFor({ state: "visible", timeout: timeoutMs });
  } catch {
    return await new Promise<"duo-refused">(() => undefined);
  }
  return "duo-refused";
}

async function observeStaleRequest(page: Page, timeoutMs: number): Promise<"stale-request"> {
  try {
    await page.getByText(STALE_REQUEST_TEXT).first().waitFor({ state: "visible", timeout: timeoutMs });
    if (URL.parse(page.url())?.hostname === "a5.ucsd.edu") return "stale-request";
  } catch { /* The landing arm owns timeout and diagnosis. */ }
  return await new Promise<"stale-request">(() => undefined);
}


async function observeTrainingReminder(
  system: BrowserSystemId,
  context: SystemLoginContext,
  deadline: number,
  isWaiting: () => boolean,
  ownClick: (operation: Promise<void>) => void,
): Promise<"TRAINING_REMINDER_REPEATED"> {
  const control = context.page.locator(TRAINING_REMINDER_SELECTOR).first();
  const remaining = (): number => Math.max(1, deadline - systemClock.monotonicMs());
  try {
    await control.waitFor({ state: "visible", timeout: remaining() });
  } catch {
    return await new Promise<"TRAINING_REMINDER_REPEATED">(() => undefined);
  }
  if (!isWaiting() || URL.parse(context.page.url())?.hostname !== "a5.ucsd.edu") {
    return await new Promise<"TRAINING_REMINDER_REPEATED">(() => undefined);
  }
  const navigated = context.page.waitForEvent("framenavigated", {
    predicate: frame => frame === context.page.mainFrame(), timeout: remaining(),
  });
  void navigated.catch(() => undefined);
  const click = (async (): Promise<void> => {
    try {
      const element = await control.elementHandle({ timeout: remaining() });
      if (element === null) throw new Error("training reminder control disappeared");
      let clickFailure: unknown;
      try {
        if (!isWaiting() || URL.parse(context.page.url())?.hostname !== "a5.ucsd.edu") return;
        await element.click({ timeout: remaining() });
        recordBrowserAction("clicked", "ucsd.sso.training-reminder-continue");
      } catch (error) {
        clickFailure = error;
        throw error;
      } finally {
        await element.dispose().catch((disposeError: unknown) => {
          throw clickFailure === undefined ? disposeError : new AggregateError([clickFailure, disposeError]);
        });
      }
    } catch (error) {
      throw new BrowserLoginError(system, "duo-clearance",
        "the UCSD training reminder Continue Log In control could not be clicked", "", { cause: error });
    }
  })();
  ownClick(click);
  await click;
  if (!isWaiting()) return await new Promise<"TRAINING_REMINDER_REPEATED">(() => undefined);
  try {
    await Promise.race([navigated, control.waitFor({ state: "hidden", timeout: remaining() })]);
    if (isWaiting()) await control.waitFor({ state: "visible", timeout: remaining() });
    if (isWaiting() && URL.parse(context.page.url())?.hostname === "a5.ucsd.edu") {
      return "TRAINING_REMINDER_REPEATED";
    }
  } catch { /* The landing arm owns timeout and diagnosis. */ }
  return await new Promise<"TRAINING_REMINDER_REPEATED">(() => undefined);
}


export async function waitForAuthenticatedLanding(
  system: BrowserSystemId,
  context: SystemLoginContext,
  token: DuoCeremonyLeaseToken,
  landed: (url: string) => boolean,
  timeoutMs: number,
): Promise<void> {
  assertDuoCeremonyLeaseToken(token, { system });
  const remaining = context.acquisitionRemainingMs?.() ?? timeoutMs + 1_000;
  const landingMs = Math.max(1, Math.min(timeoutMs, remaining - Math.min(1_000, remaining / 2)));
  const deadline = systemClock.monotonicMs() + landingMs;
  let waiting = true;
  let activeClick: Promise<void> | undefined;
  const isWaiting = (): boolean => waiting && !context.signal.aborted
    && systemClock.monotonicMs() < deadline && !landed(context.page.url());
  try {
    const result = await raceCancellation(
      Promise.race<"landed" | "duo-refused" | "stale-request" | "TRAINING_REMINDER_REPEATED">([
        context.page.waitForURL((url) => landed(url.href), { timeout: landingMs })
          .then(() => "landed"),
        observeDuoTerminalRefusal(context.page, landingMs),
        observeStaleRequest(context.page, landingMs),
        observeTrainingReminder(system, context, deadline, isWaiting, operation => { activeClick = operation; }),
      ]),
      system,
      "duo-clearance",
      context,
    ).finally(() => { waiting = false; }).then(
      outcome => ({ outcome }), (error: unknown) => ({ error }),
    );
    try {
      await activeClick;
    } catch (clickError) {
      if (context.signal.aborted || ("error" in result && result.error !== clickError)) {
        throw new BrowserLoginError(system, "duo-clearance", context.signal.aborted
          ? "the session was cancelled" : "the landing wait and training reminder click both failed", "", {
          cause: "error" in result && result.error !== clickError
            ? new AggregateError([result.error, clickError]) : clickError,
        });
      }
      throw clickError;
    }
    if ("error" in result) throw result.error;
    abortIfCancelled(system, "duo-clearance", context);
    const outcome = result.outcome;
    if (outcome === "TRAINING_REMINDER_REPEATED") {
      const observed = URL.parse(context.page.url());
      throw new BrowserLandingStallError(system, outcome, {
        host: observed?.hostname ?? "", path: observed?.pathname ?? "", title: "",
      });
    }
    if (outcome === "stale-request") throw new Error("Shibboleth stale request observed");
    if (outcome === "duo-refused") {
      throw new DuoTerminalRefusalError(system, ERROR_CATALOG.DUO_TERMINAL_REFUSAL.text, context.page.url());
    }
  } catch (error) {
    if (error instanceof BrowserLoginError) throw error;
    const observed = URL.parse(context.page.url());
    let title = "";
    let diagnosis: BrowserLandingStallCode | "duo-refused" = "LANDING_PROBE_UNAVAILABLE";
    const budget = Math.max(1, Math.min(900, (context.acquisitionRemainingMs?.() ?? 1_000) - 100));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await raceCancellation(Promise.race([
        Promise.all([describeStalledLanding(context), context.page.title()]),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("landing diagnosis deadline")), budget); }),
      ]), system, "duo-clearance", context);
      [diagnosis, title] = result;
    } catch (probeError) {
      if (context.signal.aborted) throw probeError;
    } finally {
      clearTimeout(timer);
    }
    if (diagnosis === "duo-refused") {
      throw new DuoTerminalRefusalError(system, ERROR_CATALOG.DUO_TERMINAL_REFUSAL.text, context.page.url(), { cause: error }, title);
    }
    throw new BrowserLandingStallError(system, diagnosis, {
      host: observed?.hostname ?? "",
      path: observed?.pathname ?? "",
      title: title,
    }, { cause: error });
  }
}

async function describeStalledLanding(
  context: Pick<SystemLoginContext, "page">,
): Promise<BrowserLandingStallCode | "duo-refused"> {
  try {
    if (URL.parse(context.page.url())?.hostname === "a5.ucsd.edu"
      && await context.page.getByText(STALE_REQUEST_TEXT).count() > 0) return "SHIBBOLETH_STALE_REQUEST";
    const host = URL.parse(context.page.url())?.hostname;
    if (host === DUO_HOST || host?.endsWith(`.${DUO_HOST}`)) {
      try {
        if (await duoTerminalRefusalLocator(context.page).count() > 0) return "duo-refused";
      } catch { return "DUO_REFUSAL_UNPROVEN"; }
      return "DUO_PROMPT_STALLED";
    }
    if (await isSsoFormPresent(context.page)) return "SSO_FIRST_FACTOR_REJECTED";
    return "AUTHENTICATED_LANDING_MISSING";
  } catch { return "LANDING_PROBE_UNAVAILABLE"; }
}


export async function verifyUcsdAuthenticatedApplication(
  system: BrowserSystemId,
  page: Page,
  input: Readonly<{
    urlIsApplication: (url: string) => boolean;
    urlRefusal: string;
    positive: () => Promise<ObservedFact>;
    additionalAbsences?: readonly (() => Promise<ObservedFact>)[];
  }>,
): Promise<AuthenticationProbe> {
  const url = page.url();
  if (!input.urlIsApplication(url)) return { authenticated: false, reason: input.urlRefusal };

  const positive = await input.positive();
  if (!positive.holds) return { authenticated: false, reason: positive.detail };

  const absences = [await probeSsoFormAbsent(page)];
  for (const absence of input.additionalAbsences ?? []) absences.push(await absence());
  const present = absences.find((fact) => !fact.holds);
  if (present !== undefined) return { authenticated: false, reason: present.detail };

  return {
    authenticated: true,
    evidence: {
      system,
      url,
      positive: positive.detail,
      negative: absences.map((fact) => fact.detail).join("; "),
    },
  };
}
