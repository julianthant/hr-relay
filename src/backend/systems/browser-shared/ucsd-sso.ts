// Select SSO submit by name: the enrollment navigation also looks like a Login button.
import type { Locator, Page } from "playwright";
import { recordBrowserAction } from "./action-notes.js";
import { assertDuoCeremonyLeaseToken } from "../../../workflow-kit/duo-ceremony-lease.js";
import type { DuoCeremonyLeaseToken } from "../../../workflow-kit/duo-ceremony-lease.js";
import { probeAbsentControl } from "./authenticated-application.js";
import type { ObservedFact } from "./authenticated-application.js";
import { BrowserLoginError, DuoTerminalRefusalError } from "./login-contract.js";
import type {
  AuthenticationProbe,
  BrowserLoginStep,
  SystemLoginContext,
} from "./login-contract.js";
import type { BrowserSystemId } from "../../../rules/identity/ids.js";



const DUO_HOST = "duosecurity.com";

const SSO_SUBMIT_SELECTOR = 'button[name="_eventId_proceed"]';

const STALE_REQUEST_TEXT = "Web Login Service - Stale Request";
// Match Duo's outcome sentence, not its factor-specific heading; use first for the union locator.
const DUO_TERMINAL_REFUSAL_TEXT = /login request .*(?:canceled|cancelled) or timed out/i;
// A refused security-key assertion can indicate a stale authenticator counter; waiting longer cannot repair it.
const DUO_TERMINAL_REFUSAL_MESSAGE =
  "Duo REFUSED the WebAuthn assertion and rendered its terminal \"canceled or timed out\" screen; "
  + "this login is dead and the prompt will not clear on its own. The cause is almost never Duo "
  + "hand-approval: it is a Duo Autopilot signCount regression, where this browser profile's stored "
  + "counter has fallen BEHIND the value Duo has already observed for the shared credential (a "
  + "counter that does not advance is a cloned-key signal), which is what happens when any other "
  + "profile using the same credential signed more recently. Check the extension's stored signCount "
  + "before touching timeouts.duoApprovalSeconds or timeouts.sessionAcquireMs";

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
    recordBrowserAction("typed", "ucsd.sso.username", context.credentials.userId);
    await passwordField(context.page).fill(context.credentials.password, { timeout });
    recordBrowserAction("typed", "ucsd.sso.password", context.credentials.password);
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
  return page.getByText(DUO_TERMINAL_REFUSAL_TEXT).first();
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
  try {
    const outcome = await raceCancellation(
      Promise.race<"landed" | "duo-refused">([
        context.page.waitForURL((url) => landed(url.href), { timeout: timeoutMs })
          .then(() => "landed"),
        observeDuoTerminalRefusal(context.page, timeoutMs),
      ]),
      system,
      "duo-clearance",
      context,
    );
    if (outcome === "duo-refused") {
      throw new DuoTerminalRefusalError(system, DUO_TERMINAL_REFUSAL_MESSAGE, context.page.url());
    }
  } catch (error) {
    if (error instanceof BrowserLoginError) throw error;
    const observed = context.page.url();
    const diagnosis = await describeStalledLanding(context, observed);
    if (diagnosis === DUO_TERMINAL_REFUSAL_MESSAGE) {

      throw new DuoTerminalRefusalError(system, diagnosis, observed, { cause: error });
    }
    throw new BrowserLoginError(system, "duo-clearance", diagnosis, observed, { cause: error });
  }
}


async function describeStalledLanding(
  context: Pick<SystemLoginContext, "page">,
  observed: string,
): Promise<string> {
  let staleCount: number;
  try {
    staleCount = await context.page.getByText(STALE_REQUEST_TEXT).count();
  } catch {
    return "no authenticated landing appeared, and the stalled page could not be probed";
  }
  if (staleCount > 0) {
    return "Shibboleth served its stale-request page; the SAML execution expired during login";
  }
  if (observed.includes(DUO_HOST)) {
    // Probe a stalled Duo page for explicit refusal before blaming the approval timeout.
    let refusalCount: number;
    try {
      refusalCount = await duoTerminalRefusalLocator(context.page).count();
    } catch (error) {
      return `the Duo prompt never cleared, and whether Duo had already refused it could not be probed: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (refusalCount > 0) return DUO_TERMINAL_REFUSAL_MESSAGE;
    return "the Duo prompt never cleared; check that Duo Autopilot is loaded and its credential is current";
  }
  // TritON can reject the first factor by repainting its form at the same URL.
  let ssoStillPresent: boolean;
  try {
    ssoStillPresent = await isSsoFormPresent(context.page);
  } catch (error) {
    return `no authenticated landing appeared, and the stalled page could not be probed further: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (ssoStillPresent) {
    return "the UCSD SSO form is still on the page; the first factor was rejected, so no Duo prompt was ever reached";
  }
  return "no authenticated landing appeared";
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
