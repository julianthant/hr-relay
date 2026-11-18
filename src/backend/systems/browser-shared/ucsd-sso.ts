import { nativeSsoGuardKeys, withPinnedSsoPost, type NativeSsoGuardKeys } from "./ucsd-sso-guard.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
// Select SSO submit by name: the enrollment navigation also looks like a Login button.
import type { Frame, JSHandle, Locator, Page } from "playwright";
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

function isDuoOrigin(url: URL | null): boolean {
  return url?.protocol === "https:" && url.port === "" && url.username === "" && url.password === ""
    && (url.hostname === DUO_HOST || url.hostname.endsWith(`.${DUO_HOST}`));
}

const SSO_SUBMIT_SELECTOR = 'button[name="_eventId_proceed"]';
const TRAINING_REMINDER_SELECTOR = 'input[type="submit"][value*="Continue Log In"], button:has-text("Continue Log In")';

const STALE_REQUEST_TEXT = "Web Login Service - Stale Request";
// Match Duo's outcome sentence, not its factor-specific heading; use first for the union locator.
const DUO_TERMINAL_REFUSAL_PATTERN = /login request .*(?:canceled|cancelled) or timed out/i;


export function abortIfCancelled(
  system: BrowserSystemId,
  step: BrowserLoginStep,
  context: Pick<SystemLoginContext, "page" | "signal" | "assertCurrent">,
): void {
  context.assertCurrent();
  if (!context.signal.aborted) return;
  throw new BrowserLoginError(system, step, "the session was cancelled", context.page.url());
}

// Playwright waits take no AbortSignal; race cancellation so the session can release promptly.
export async function raceCancellation<Result>(
  operation: () => Promise<Result>,
  system: BrowserSystemId,
  step: BrowserLoginStep,
  context: Pick<SystemLoginContext, "page" | "signal" | "assertCurrent">,
): Promise<Result> {
  abortIfCancelled(system, step, context);
  let removeListener = (): void => undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    const listener = (): void => {
      try { context.assertCurrent(); } catch (error) {
        reject(error instanceof Error ? error : new Error("Browser session authority refused", { cause: error }));
        return;
      }
      reject(new BrowserLoginError(system, step, "the session was cancelled", context.page.url()));
    };
    context.signal.addEventListener("abort", listener, { once: true });
    removeListener = (): void => context.signal.removeEventListener("abort", listener);
  });
  try {
    const owned = Promise.resolve().then(() => {
      abortIfCancelled(system, step, context);
      return operation();
    });
    const result = await Promise.race([owned, cancelled]);
    abortIfCancelled(system, step, context);
    return result;
  } finally {
    removeListener();
  }
}

// TritON labels vary by login realm; stable id/name anchors identify the same username field.
const SSO_USERNAME_SELECTOR = '#ssousername, input[name="urn:mace:ucsd.edu:sso:username"]';
const SSO_PASSWORD_SELECTOR = '#ssopassword, input[name="urn:mace:ucsd.edu:sso:password"]';

export async function waitForUcsdDuoSignIn(page: Page, assertCurrent: () => void, timeout: number): Promise<"sso-form" | "duo"> {
  const deadline = systemClock.monotonicMs() + timeout;
  const remaining = () => Math.max(1, deadline - systemClock.monotonicMs());
  const allowed = (url: URL) => url.protocol === "https:" && url.port === "" && url.username === "" && url.password === ""
    && (url.hostname === "a5.ucsd.edu" && url.pathname === "/tritON/profile/SAML2/Redirect/SSO"
      || isDuoOrigin(url));
  assertCurrent();
  try {
    await page.waitForURL(allowed, { waitUntil: "domcontentloaded", timeout: remaining() });
  } catch (cause) {
    assertCurrent();
    if (cause instanceof Error && cause.name === "TimeoutError") throw new Error("UCSD_SSO_REDIRECT_TIMEOUT", { cause });
    throw cause;
  }
  assertCurrent();
  const landing = new URL(page.url());
  if (!allowed(landing)) throw new Error("UCSD_SSO_SCOPE");
  if (landing.hostname !== "a5.ucsd.edu") return "duo";
  try {
    const ready = await page.waitForFunction(selectors => {
      const url = new URL(location.href);
      if (url.origin !== "https://a5.ucsd.edu" || url.username || url.password || url.pathname !== "/tritON/profile/SAML2/Redirect/SSO") return false;
      const controls = selectors.map(selector => document.querySelectorAll(selector));
      return controls.every(matches => matches.length === 1) && controls.every(matches => {
        const element = matches[0];
        return (element instanceof HTMLInputElement || element instanceof HTMLButtonElement)
          && !element.disabled && !(element instanceof HTMLInputElement && element.readOnly)
          && getComputedStyle(element).visibility === "visible" && element.getClientRects().length > 0;
      });
    }, [SSO_USERNAME_SELECTOR, SSO_PASSWORD_SELECTOR, SSO_SUBMIT_SELECTOR], { timeout: remaining() });
    await ready.dispose();
  } catch (cause) {
    assertCurrent();
    if (cause instanceof Error && cause.name === "TimeoutError") throw new Error("UCSD_SSO_FORM_TIMEOUT", { cause });
    throw cause;
  }
  assertCurrent();
  return "sso-form";
}

type SsoFormAction = { kind: "prove" | "check-worker" } | { kind: "arm" | "submit"; keys: NativeSsoGuardKeys | undefined } | { kind: "username" | "password"; value: string };
type UcsdSsoPath = "/tritON/profile/SAML2/Redirect/SSO" | "/idp/profile/SAML2/Redirect/SSO";

function requireSsoPath(path: string): UcsdSsoPath {
  if (path !== "/tritON/profile/SAML2/Redirect/SSO" && path !== "/idp/profile/SAML2/Redirect/SSO") throw new Error("UCSD_SSO_SCOPE");
  return path;
}

async function applyPinnedSsoAction(user: SVGElement | HTMLElement, input: {
  password: SVGElement | HTMLElement;
  button: SVGElement | HTMLElement;
  form: HTMLFormElement | null;
  action: SsoFormAction;
  pinnedDestination: string | undefined;
  path: UcsdSsoPath;
  url: string;
  selectors: { user: string; password: string; button: string };
}): Promise<boolean | string> {
  const { password, button, form, action } = input;
  if (!(user instanceof HTMLInputElement) || !(password instanceof HTMLInputElement)
    || !(button instanceof HTMLButtonElement) || !(form instanceof HTMLFormElement)) return false;

  const proof = {
    matches(selector: string, control: HTMLElement) {
      const nodes = document.querySelectorAll(selector);
      return nodes.length === 1 && nodes[0] === control && control.getClientRects().length > 0
        && getComputedStyle(control).visibility === "visible" && !control.matches(":disabled");
    },
    allowed(raw: string) {
      const target = URL.parse(raw);
      return target?.origin === "https://a5.ucsd.edu" && !target.username && !target.password && target.pathname === input.path;
    },
    destination() { return button.hasAttribute("formaction") ? button.formAction : form.action; },
    valid() {
      return (input.pinnedDestination === undefined || this.destination() === input.pinnedDestination) && location.href === input.url && this.allowed(location.href)
        && this.matches(input.selectors.user, user) && this.matches(input.selectors.password, password) && this.matches(input.selectors.button, button)
        && user.form === form && password.form === form && button.form === form
        && (user.type === "text" || user.type === "email") && !user.readOnly && !password.readOnly
        && password.type === "password" && button.type === "submit"
        && form.method === "post" && (button.formMethod === "" || button.formMethod === "post")
        && (form.target === "" || form.target === "_self") && (button.formTarget === "" || button.formTarget === "_self")
        && (form.target !== "" || ["", "_self"].includes(document.querySelector("base[target]")?.getAttribute("target") ?? ""))
        && this.allowed(form.action) && this.allowed(button.formAction);
    },
  };
  if (!proof.valid()) return false;
  const destination = proof.destination();
  if (action.kind === "prove") return destination;
  if (action.kind === "arm" || action.kind === "check-worker") {
    if (await navigator.serviceWorker.getRegistration(destination) || !proof.valid() || proof.destination() !== destination) return false;
    if (action.kind === "check-worker") return navigator.serviceWorker.controller === null;
  }
  if (action.kind === "username" || action.kind === "password") {
    if (navigator.serviceWorker.controller !== null) return false;
    const field = action.kind === "username" ? user : password;
    field.value = action.value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  } else if (action.kind === "arm" || action.kind === "submit") {
    const guard = window.relaySsoFormGuard;
    if (!action.keys || !guard || guard.installationId !== action.keys.installationId) return false;
    if (action.kind === "arm") {
      return guard.arm(action.keys.actionKey, { form, button, password, destination, valid() { return proof.valid(); } });
    }
    if (!guard.click(action.keys.actionKey, form)) return false;
    const requestUrl = new URL(destination);
    requestUrl.hash = "";
    return requestUrl.href;
  }
  return true;
}

export async function submitPinnedUcsdSsoCredentials(page: Page,
  acquire: () => Promise<Readonly<{ userId: string; password: string }>>,
  assertCurrent: () => void, timeout: number,
  path: UcsdSsoPath, onAction?: (kind: "typed" | "clicked", targetId: string) => void): Promise<void> {
  assertCurrent();
  const url = page.url();
  requireSsoPath(path);
  const allowed = (value: string) => {
    const parsed = URL.parse(value);
    return parsed?.origin === "https://a5.ucsd.edu" && parsed.username === "" && parsed.password === "" && parsed.port === "" && parsed.pathname === path;
  };
  const check = () => { assertCurrent(); if (page.url() !== url || !allowed(url)) throw new Error("UCSD_SSO_SCOPE"); };
  check();
  const username = page.locator(SSO_USERNAME_SELECTOR), password = page.locator(SSO_PASSWORD_SELECTOR), submit = page.locator(SSO_SUBMIT_SELECTOR);
  const users = await username.count(); check();
  const passwords = await password.count(); check();
  const buttons = await submit.count(); check();
  if (users === 0) throw new Error("UCSD_SSO_USERNAME_MISSING");
  if (passwords === 0) throw new Error("UCSD_SSO_PASSWORD_MISSING");
  if (users !== 1 || passwords !== 1 || buttons !== 1) throw new Error("UCSD_SSO_FIELDS");
  let user: Awaited<ReturnType<typeof username.elementHandle>> | null = null;
  let secret: Awaited<ReturnType<typeof password.elementHandle>> | null = null;
  let button: Awaited<ReturnType<typeof submit.elementHandle>> | null = null;
  let formHandle: JSHandle<HTMLFormElement | null> | undefined;
  let failure: { error: unknown } | undefined;
  const cleanup: unknown[] = [];
  try {
    user = await username.elementHandle({ timeout }); check();
    secret = await password.elementHandle({ timeout }); check();
    button = await submit.elementHandle({ timeout }); check();
    if (!user || !secret || !button) throw new Error("UCSD_SSO_FIELDS");
    const pinnedUser = user, pinnedSecret = secret, pinnedSubmit = button;
    formHandle = await pinnedUser.evaluateHandle(el => el instanceof HTMLInputElement ? el.form : null);
    check();
    const pinnedForm = formHandle;
    const evaluateAction = async (action: SsoFormAction, pinnedDestination: string | undefined) => {
      check();
      const valid = await pinnedUser.evaluate(applyPinnedSsoAction, { password: pinnedSecret, button: pinnedSubmit, form: pinnedForm, action, path, url, pinnedDestination,
        selectors: { user: SSO_USERNAME_SELECTOR, password: SSO_PASSWORD_SELECTOR, button: SSO_SUBMIT_SELECTOR } });
      assertCurrent();
      if (!valid) throw new Error("UCSD_SSO_FIELDS");
      return valid;
    };
    const keys = nativeSsoGuardKeys(page.context());
    const destination = await evaluateAction({ kind: "prove" }, undefined);
    if (typeof destination !== "string") throw new Error("UCSD_SSO_FIELDS");
    const act = (action: SsoFormAction) => evaluateAction(action, destination);
    await act({ kind: "arm", keys });
    check();
    const credentials = await acquire();
    await act({ kind: "username", value: credentials.userId });
    onAction?.("typed", "ucsd.sso.username");
    await act({ kind: "check-worker" });
    await withPinnedSsoPost(page, destination, assertCurrent, async allowPost => {
      await act({ kind: "password", value: credentials.password });
      onAction?.("typed", "ucsd.sso.password");
      const stop = new AbortController();
      const navigation = page.waitForNavigation({ waitUntil: "commit", timeout, signal: stop.signal })
        .then(response => ({ response }), (error: unknown) => ({ error }));
      try {
        allowPost();
        const postedUrl = await act({ kind: "submit", keys });
        const outcome = await navigation;
        if ("error" in outcome) throw outcome.error;
        let request = outcome.response?.request();
        while (request) {
          const prior = request.redirectedFrom();
          if (!prior) break;
          if (request.method() !== "GET") throw new Error("UCSD_SSO_SUBMIT_UNPROVED");
          request = prior;
        }
        if (!request || request.method() !== "POST" || request.url() !== postedUrl) throw new Error("UCSD_SSO_SUBMIT_UNPROVED");
      } finally { stop.abort(); }
    });
    assertCurrent();
    onAction?.("clicked", "ucsd.sso.submit");
  } catch (error) { failure = { error }; }
  finally {
    for (const handle of [user, secret, button, formHandle]) {
      try { await handle?.dispose(); } catch (error) { cleanup.push(error); }
    }
  }
  if (cleanup.length !== 0) throw new AggregateError(failure === undefined ? cleanup : [failure.error, ...cleanup], "UCSD_SSO_CLEANUP");
  if (failure !== undefined) throw failure.error;
}


export function ssoSubmitButton(page: Page): Locator {
  return page.locator(SSO_SUBMIT_SELECTOR).first();
}


export async function isSsoFormPresent(page: Page, assertCurrent: () => void): Promise<boolean> {
  assertCurrent();
  const count = await ssoSubmitButton(page).count();
  assertCurrent();
  return count > 0;
}


async function probeSsoFormAbsent(page: Page, assertCurrent: () => void): Promise<ObservedFact> {
  assertCurrent();
  return probeAbsentControl(page, {
    assertCurrent,
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
  context.assertCurrent();
  assertDuoCeremonyLeaseToken(token, { system });
  context.assertCurrent();
  await raceCancellation(
    () => ssoSubmitButton(context.page)
      .waitFor({ state: "visible", timeout: context.config.timeouts.navigationMs }),
    system,
    "sso-form",
    context,
  ).catch((error: unknown) => {
    context.assertCurrent();
    if (error instanceof BrowserLoginError) throw error;
    throw new BrowserLoginError(
      system,
      "sso-form",
      "the UCSD SSO form never rendered",
      context.page.url(),
      { cause: error },
    );
  });
  context.assertCurrent();
}


export async function submitSsoForm(
  system: BrowserSystemId,
  context: SystemLoginContext,
  token: DuoCeremonyLeaseToken,
): Promise<void> {
  let step: BrowserLoginStep = "credential-fill";
  const assertCurrent = (): void => {
    abortIfCancelled(system, step, context);
    assertDuoCeremonyLeaseToken(token, { system });
  };
  assertCurrent();
  const { page } = context;
  try {
    await submitPinnedUcsdSsoCredentials(page, async () => context.credentials, assertCurrent,
      context.config.timeouts.navigationMs, requireSsoPath(new URL(page.url()).pathname), (kind, targetId) => {
        if (targetId === "ucsd.sso.password") step = "sso-submit";
        recordBrowserAction(kind, targetId);
      });
  } catch (error) {
    if (error instanceof AggregateError) throw error;
    assertCurrent();
    const detail = error instanceof Error && error.message === "UCSD_SSO_USERNAME_MISSING"
      ? `the SSO username field matched no element (${SSO_USERNAME_SELECTOR})`
      : error instanceof Error && error.message === "UCSD_SSO_PASSWORD_MISSING"
        ? "the SSO password field matched no element"
        : "the pinned UCSD SSO form could not be proved or submitted";
    throw new BrowserLoginError(system, step, detail, page.url(), { cause: error });
  }
}

interface DuoRefusal {
  readonly duoUrl: string;
}

async function findDuoRefusal(page: Page, assertCurrent: () => void): Promise<DuoRefusal | undefined> {
  assertCurrent();
  for (const frame of page.frames()) {
    const url = frame.url();
    if (!isDuoOrigin(URL.parse(url))) continue;
    const matches = frame.getByText(DUO_TERMINAL_REFUSAL_PATTERN).filter({ visible: true });
    const refused = await matches.evaluateAll((nodes, expectedUrl) =>
      nodes.length > 0 && location.href === expectedUrl, url);
    assertCurrent();
    if (refused) return { duoUrl: url };
  }
  return undefined;
}

// Frames may appear or navigate while the application landing is pending.
async function observeDuoTerminalRefusal(page: Page, isWaiting: () => boolean, assertCurrent: () => void): Promise<DuoRefusal> {
  while (isWaiting()) {
    try {
      const refusal = await findDuoRefusal(page, assertCurrent);
      if (refusal && isWaiting()) return refusal;
    } catch {
      assertCurrent();
    }
    if (isWaiting()) await new Promise<void>(resolve => setTimeout(resolve, 100));
  }
  return await new Promise<DuoRefusal>(() => undefined);
}

async function observeStaleRequest(page: Page, timeoutMs: number, assertCurrent: () => void): Promise<"stale-request"> {
  assertCurrent();
  try {
    await page.getByText(STALE_REQUEST_TEXT).first().waitFor({ state: "visible", timeout: timeoutMs });
    assertCurrent();
    if (URL.parse(page.url())?.hostname === "a5.ucsd.edu") return "stale-request";
  } catch {
    assertCurrent();
  }
  assertCurrent();
  return await new Promise<"stale-request">(() => undefined);
}


async function observeTrainingReminder(
  system: BrowserSystemId,
  context: SystemLoginContext,
  deadline: number,
  isWaiting: () => boolean,
  ownClick: (operation: Promise<void>) => void,
): Promise<"TRAINING_REMINDER_REPEATED"> {
  context.assertCurrent();
  const control = context.page.locator(TRAINING_REMINDER_SELECTOR).first();
  const remaining = (): number => Math.max(1, deadline - systemClock.monotonicMs());
  try {
    context.assertCurrent();
    await control.waitFor({ state: "visible", timeout: remaining() });
    context.assertCurrent();
  } catch {
    context.assertCurrent();
    return await new Promise<"TRAINING_REMINDER_REPEATED">(() => undefined);
  }
  if (!isWaiting() || URL.parse(context.page.url())?.hostname !== "a5.ucsd.edu") {
    context.assertCurrent();
    return await new Promise<"TRAINING_REMINDER_REPEATED">(() => undefined);
  }
  const navigated = context.page.waitForEvent("framenavigated", {
    predicate: frame => frame === context.page.mainFrame(), timeout: remaining(),
  });
  void navigated.catch(() => undefined);
  const click = (async (): Promise<void> => {
    context.assertCurrent();
    try {
      const element = await control.elementHandle({ timeout: remaining() });
      if (element === null) throw new Error("training reminder control disappeared");
      let clickFailure: unknown;
      try {
        context.assertCurrent();
        if (!isWaiting() || URL.parse(context.page.url())?.hostname !== "a5.ucsd.edu") return;
        context.assertCurrent();
        await element.click({ timeout: remaining() });
        context.assertCurrent();
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
  context.assertCurrent();
  if (!isWaiting()) return await new Promise<"TRAINING_REMINDER_REPEATED">(() => undefined);
  try {
    context.assertCurrent();
    await Promise.race([navigated, control.waitFor({ state: "hidden", timeout: remaining() })]);
    context.assertCurrent();
    if (isWaiting()) {
      context.assertCurrent();
      await control.waitFor({ state: "visible", timeout: remaining() });
      context.assertCurrent();
    }
    if (isWaiting() && URL.parse(context.page.url())?.hostname === "a5.ucsd.edu") {
      return "TRAINING_REMINDER_REPEATED";
    }
  } catch {
    context.assertCurrent();
  }
  context.assertCurrent();
  return await new Promise<"TRAINING_REMINDER_REPEATED">(() => undefined);
}


export async function waitForAuthenticatedLanding(
  system: BrowserSystemId,
  context: SystemLoginContext,
  token: DuoCeremonyLeaseToken,
  landed: (url: string) => boolean,
  timeoutMs: number,
): Promise<void> {
  context.assertCurrent();
  assertDuoCeremonyLeaseToken(token, { system });
  const remaining = context.acquisitionRemainingMs?.() ?? timeoutMs + 1_000;
  const landingMs = Math.max(1, Math.min(timeoutMs, remaining - Math.min(1_000, remaining / 2)));
  const deadline = systemClock.monotonicMs() + landingMs;
  let waiting = true;
  let activeClick: Promise<void> | undefined;
  const isWaiting = (): boolean => waiting && !context.signal.aborted
    && systemClock.monotonicMs() < deadline && !landed(context.page.url());
  try {
    context.assertCurrent();
    const result = await raceCancellation(
      () => Promise.race<"landed" | DuoRefusal | "stale-request" | "TRAINING_REMINDER_REPEATED">([
        context.page.waitForURL((url) => landed(url.href), { timeout: landingMs })
          .then(() => "landed"),
        observeDuoTerminalRefusal(context.page, isWaiting, context.assertCurrent),
        observeStaleRequest(context.page, landingMs, context.assertCurrent),
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
    if (typeof outcome === "object") {
      throw new DuoTerminalRefusalError(system, ERROR_CATALOG.DUO_TERMINAL_REFUSAL.text, outcome.duoUrl);
    }
  } catch (error) {
    if (error instanceof BrowserLoginError) throw error;
    context.assertCurrent();
    const observed = URL.parse(context.page.url());
    let title = "";
    let diagnosis: BrowserLandingStallCode | DuoRefusal = "LANDING_PROBE_UNAVAILABLE";
    const budget = Math.max(1, Math.min(900, (context.acquisitionRemainingMs?.() ?? 1_000) - 100));
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      context.assertCurrent();
      const result = await raceCancellation(() => Promise.race([
        Promise.all([describeStalledLanding(context), context.page.title()]),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("landing diagnosis deadline")), budget); }),
      ]), system, "duo-clearance", context);
      context.assertCurrent();
      [diagnosis, title] = result;
    } catch (probeError) {
      context.assertCurrent();
      if (context.signal.aborted) throw probeError;
    } finally {
      clearTimeout(timer);
    }
    if (typeof diagnosis === "object") {
      throw new DuoTerminalRefusalError(system, ERROR_CATALOG.DUO_TERMINAL_REFUSAL.text, diagnosis.duoUrl, { cause: error }, title);
    }
    throw new BrowserLandingStallError(system, diagnosis, {
      host: observed?.hostname ?? "",
      path: observed?.pathname ?? "",
      title: title,
    }, { cause: error });
  }
}

async function describeStalledLanding(
  context: Pick<SystemLoginContext, "page" | "assertCurrent">,
): Promise<BrowserLandingStallCode | DuoRefusal> {
  context.assertCurrent();
  try {
    if (URL.parse(context.page.url())?.hostname === "a5.ucsd.edu") {
      const count = await context.page.getByText(STALE_REQUEST_TEXT).count();
      context.assertCurrent();
      if (count > 0) return "SHIBBOLETH_STALE_REQUEST";
    }
    const duo = isDuoOrigin(URL.parse(context.page.url()));
    try {
      const refusal = await findDuoRefusal(context.page, context.assertCurrent);
      if (refusal) return refusal;
    } catch (error) {
      context.assertCurrent();
      if (duo) return "DUO_REFUSAL_UNPROVEN";
      throw error;
    }
    if (duo) return "DUO_PROMPT_STALLED";
    if (await isSsoFormPresent(context.page, context.assertCurrent)) return "SSO_FIRST_FACTOR_REJECTED";
    context.assertCurrent();
    return "AUTHENTICATED_LANDING_MISSING";
  } catch {
    context.assertCurrent();
    return "LANDING_PROBE_UNAVAILABLE";
  }
}


export async function verifyUcsdAuthenticatedApplication(
  system: BrowserSystemId,
  page: Page,
  input: Readonly<{
    assertCurrent: () => void;
    urlIsApplication: (url: string) => boolean;
    urlRefusal: string;
    positive: () => Promise<ObservedFact>;
    additionalAbsences?: readonly (() => Promise<ObservedFact>)[];
  }>,
): Promise<AuthenticationProbe> {
  input.assertCurrent();
  const url = page.url();
  if (!input.urlIsApplication(url)) return { authenticated: false, reason: input.urlRefusal, check: "application-route" };

  let navigated = false;
  const onNavigation = (frame: Frame): void => {
    if (frame === page.mainFrame()) navigated = true;
  };
  page.on("framenavigated", onNavigation);
  try {
    input.assertCurrent();
    const positive = await input.positive();
    input.assertCurrent();
    if (!positive.holds) return { authenticated: false, reason: positive.detail, check: "positive-evidence" };

    const absences = [await probeSsoFormAbsent(page, input.assertCurrent)];
    for (const absence of input.additionalAbsences ?? []) {
      input.assertCurrent();
      absences.push(await absence());
    }
    input.assertCurrent();
    if (navigated || page.url() !== url) {
      return { authenticated: false, reason: "the application page navigated during verification", check: "application-route" };
    }
    const present = absences.find((fact) => !fact.holds);
    if (present !== undefined) return { authenticated: false, reason: present.detail, check: "sign-in-form-absent" };

    return {
      authenticated: true,
      evidence: {
        system,
        url,
        positive: positive.detail,
        negative: absences.map((fact) => fact.detail).join("; "),
      },
    };
  } finally {
    page.off("framenavigated", onNavigation);
  }
}
