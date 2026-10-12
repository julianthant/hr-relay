// Select SSO submit by name: the enrollment navigation also looks like a Login button.
import type { Locator, Page } from "playwright";
import { recordBrowserAction } from "./action-notes.js";
import { assertDuoCeremonyLeaseToken } from "../../../workflow-kit/duo-ceremony-lease.js";
import type { DuoCeremonyLeaseToken } from "../../../workflow-kit/duo-ceremony-lease.js";
import { probeAbsentControl } from "./authenticated-application.js";
import type { ObservedFact } from "./authenticated-application.js";
import { BrowserLoginError, BrowserLandingStallError, DuoTerminalRefusalError, DUO_TERMINAL_REFUSAL_TEXT } from "./login-contract.js";
import type {
  AuthenticationProbe,
  BrowserLoginStep,
  BrowserLandingStallCode,
  SystemLoginContext,
} from "./login-contract.js";
import type { BrowserSystemId } from "../../../rules/identity/ids.js";



const DUO_HOST = "duosecurity.com";

const SSO_SUBMIT_SELECTOR = 'button[name="_eventId_proceed"]';

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
  try {
    const outcome = await raceCancellation(
      Promise.race<"landed" | "duo-refused">([
        context.page.waitForURL((url) => landed(url.href), { timeout: landingMs })
          .then(() => "landed"),
        observeDuoTerminalRefusal(context.page, landingMs),
      ]),
      system,
      "duo-clearance",
      context,
    );
    if (outcome === "duo-refused") {
      throw new DuoTerminalRefusalError(system, DUO_TERMINAL_REFUSAL_TEXT, context.page.url());
    }
  } catch (error) {
    if (error instanceof BrowserLoginError) throw error;
    const observed = URL.parse(context.page.url());
    let title = "";
    let diagnosis: BrowserLandingStallCode | "duo-refused" = "landing-probe-unavailable";
    const budget = Math.max(1, Math.min(1_000, context.acquisitionRemainingMs?.() ?? 1_000));
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
      throw new DuoTerminalRefusalError(system, DUO_TERMINAL_REFUSAL_TEXT, context.page.url(), { cause: error }, title);
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
    if (await context.page.getByText(STALE_REQUEST_TEXT).count() > 0) return "shibboleth-stale-request";
    const host = URL.parse(context.page.url())?.hostname;
    if (host === DUO_HOST || host?.endsWith(`.${DUO_HOST}`)) {
      try {
        if (await duoTerminalRefusalLocator(context.page).count() > 0) return "duo-refused";
      } catch { return "duo-refusal-unproven"; }
      return "duo-prompt-stalled";
    }
    if (await isSsoFormPresent(context.page)) return "sso-first-factor-rejected";
    return "authenticated-landing-missing";
  } catch { return "landing-probe-unavailable"; }
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
