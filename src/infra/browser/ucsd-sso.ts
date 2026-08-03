/**
 * The UCSD Shibboleth SSO page vocabulary, shared by every system whose login
 * lands on `a5.ucsd.edu` (UCPath, CRM, OnBase, Kuali, Kronos, ServiceNow, I-9).
 *
 * PORTED WITH PROVENANCE from legacy
 * hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc:
 *
 * - `src/infra/auth/sso-fields.ts` — the username/password 3-level locator
 *   chains and the `button[name="_eventId_proceed"]` submit selector. The
 *   comment there records WHY the submit is selected by name: the "Enroll in
 *   Two-Step Login" nav link also carries `role="button"` and the text "Login",
 *   so a role/name lookup matches the wrong element on ACT CRM.
 * - `src/infra/auth/login.ts` — the `a5.ucsd.edu` SSO host, the
 *   `duosecurity.com` Duo host, and the "Web Login Service - Stale Request"
 *   page that Shibboleth serves when a SAML execution context expires
 *   mid-login.
 *
 * Copied, never linked: the two repositories share no module graph (D93/D94).
 *
 * What deliberately did NOT come across: legacy's `page.waitForTimeout` settles
 * and its multi-attempt Duo poll loop. Doc 05 §5 requires waits on real
 * readiness predicates under bounded deadlines, and Duo Autopilot answers the
 * WebAuthn ceremony in-page, so the honest wait is "the authenticated landing
 * appears within the Duo window, or this login fails loud".
 */
import type { Locator, Page } from "playwright";
import { BrowserLoginError } from "./login-contract.js";
import type { BrowserLoginStep, SystemLoginContext } from "./login-contract.js";
import type { BrowserSystemId } from "../../domain/ids.js";

/** legacy src/infra/auth/login.ts — the TritON SSO host every UCSD flow hops through. */
export const UCSD_SSO_HOST = "a5.ucsd.edu";
/** legacy src/infra/auth/login.ts / duo-poll.ts — the Duo Universal Prompt host. */
export const DUO_HOST = "duosecurity.com";
/** legacy src/infra/auth/sso-fields.ts:34 — SSO_SUBMIT_SELECTOR. */
const SSO_SUBMIT_SELECTOR = 'button[name="_eventId_proceed"]';
/** legacy src/infra/auth/duo-poll.ts — the Shibboleth expired-execution page. */
const STALE_REQUEST_TEXT = "Web Login Service - Stale Request";

export function abortIfCancelled(
  system: BrowserSystemId,
  step: BrowserLoginStep,
  context: Pick<SystemLoginContext, "page" | "signal">,
): void {
  if (!context.signal.aborted) return;
  throw new BrowserLoginError(system, step, "the session was cancelled", context.page.url());
}

/**
 * Races a Playwright wait against cancellation. Playwright takes no
 * `AbortSignal`, so an aborted session would otherwise sit out the full
 * timeout holding the worker.
 */
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

/** legacy src/infra/auth/sso-fields.ts:19-22 — 3-level username chain. */
function usernameField(page: Page): Locator {
  return page.getByLabel("User name (or email address)")
    .or(page.getByLabel("Username"))
    .or(page.locator('input[name="j_username"]'))
    .first();
}

/** legacy src/infra/auth/sso-fields.ts:25-28 — 3-level password chain. */
function passwordField(page: Page): Locator {
  return page.getByLabel("Password:")
    .or(page.getByLabel("Password"))
    .or(page.locator('input[name="j_password"]'))
    .first();
}

export function ssoSubmitButton(page: Page): Locator {
  return page.locator(SSO_SUBMIT_SELECTOR).first();
}

/** True when the SSO submit control is present — legacy `isSsoFormReady`. */
export async function isSsoFormPresent(page: Page): Promise<boolean> {
  return await ssoSubmitButton(page).count() > 0;
}

/**
 * Waits for the Shibboleth form to paint. The SAML hop chain is client-side,
 * so a single load-state resolves on an interstitial and a form check then
 * fails spuriously (legacy `waitForSsoForm`, motivated by ServiceNow).
 */
export async function waitForSsoForm(
  system: BrowserSystemId,
  context: SystemLoginContext,
): Promise<void> {
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

/**
 * Fills the SSO credentials. The values arrive already resolved from
 * `domain/secrets.ts`; nothing here reads the environment and nothing here
 * puts a field value into a message.
 */
export async function fillSsoCredentials(
  system: BrowserSystemId,
  context: SystemLoginContext,
): Promise<void> {
  const timeout = context.config.timeouts.navigationMs;
  try {
    await usernameField(context.page).fill(context.credentials.userId, { timeout });
    await passwordField(context.page).fill(context.credentials.password, { timeout });
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

/** Clicks the SSO submit control. Duo Autopilot answers the prompt that follows. */
export async function submitSsoForm(
  system: BrowserSystemId,
  context: SystemLoginContext,
): Promise<void> {
  abortIfCancelled(system, "sso-submit", context);
  try {
    await ssoSubmitButton(context.page).click({ timeout: context.config.timeouts.navigationMs });
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

/**
 * Waits for Duo to clear into the authenticated landing.
 *
 * `landed` is the system's verified marker predicate over the URL. On timeout
 * the failure names what the page is actually showing — a Duo prompt that never
 * cleared, the Shibboleth stale-request page, or an unrecognized landing — so
 * the operator is not left guessing. There is NO fallback path: an unverified
 * page never counts as authenticated.
 */
export async function waitForAuthenticatedLanding(
  system: BrowserSystemId,
  context: SystemLoginContext,
  landed: (url: string) => boolean,
  timeoutMs: number,
): Promise<void> {
  try {
    await raceCancellation(
      context.page.waitForURL((url) => landed(url.href), { timeout: timeoutMs }),
      system,
      "duo-clearance",
      context,
    );
  } catch (error) {
    if (error instanceof BrowserLoginError) throw error;
    const observed = context.page.url();
    throw new BrowserLoginError(
      system,
      "duo-clearance",
      await describeStalledLanding(context, observed),
      observed,
      { cause: error },
    );
  }
}

/**
 * Turns a stalled login into a legible diagnosis. A page that cannot be probed
 * is reported as UNKNOWN, never as "no stale-request page found" — the failure
 * is already certain; only its explanation is at stake.
 */
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
    return "the Duo prompt never cleared; check that Duo Autopilot is loaded and its credential is current";
  }
  return "no authenticated landing appeared";
}

/**
 * The final verification. `landed` must hold AND the SSO form must be gone —
 * two independent facts, so a cached-looking URL on a page that is still
 * showing the login form cannot pass.
 */
export async function assertVerifiedLanding(
  system: BrowserSystemId,
  context: SystemLoginContext,
  landed: (url: string) => boolean,
): Promise<void> {
  const observed = context.page.url();
  if (!landed(observed)) {
    throw new BrowserLoginError(
      system,
      "verify-landing",
      "the post-login URL is not the authenticated application",
      observed,
    );
  }
  if (await isSsoFormPresent(context.page)) {
    throw new BrowserLoginError(
      system,
      "verify-landing",
      "the SSO form is still present on the landed page",
      observed,
    );
  }
}
