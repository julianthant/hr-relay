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
 * and its multi-attempt Duo poll loop. Ref execution-and-sessions §5 requires waits on real
 * readiness predicates under bounded deadlines, and Duo Autopilot answers the
 * WebAuthn ceremony in-page, so the honest wait is "the authenticated landing
 * appears within the Duo window, or this login fails loud".
 */
import type { Locator, Page } from "playwright";
import { probeAbsentControl } from "./authenticated-application.js";
import type { ObservedFact } from "./authenticated-application.js";
import { BrowserLoginError } from "./login-contract.js";
import type {
  AuthenticationProbe,
  BrowserLoginStep,
  SystemLoginContext,
} from "./login-contract.js";
import type { BrowserSystemId } from "../../domain/ids.js";

/** legacy src/infra/auth/login.ts — the TritON SSO host every UCSD flow hops through. */
export const UCSD_SSO_HOST = "a5.ucsd.edu";
/** legacy src/infra/auth/login.ts / duo-poll.ts — the Duo Universal Prompt host. */
export const DUO_HOST = "duosecurity.com";
/** legacy src/infra/auth/sso-fields.ts:34 — SSO_SUBMIT_SELECTOR. Live-verified 2026-08-03. */
const SSO_SUBMIT_SELECTOR = 'button[name="_eventId_proceed"]';
/** legacy src/infra/auth/duo-poll.ts — the Shibboleth expired-execution page. */
const STALE_REQUEST_TEXT = "Web Login Service - Stale Request";
/**
 * Duo's OWN terminal refusal of a WebAuthn assertion (D243).
 *
 * Live-observed 2026-08-19, verbatim, on `api-ce13a1a7.duosecurity.com/prompt/…`:
 *
 * > Couldn't use security key
 * > Your login request using your security key was canceled or timed out.
 * > Show other options · Try again · Need help?
 *
 * It is TERMINAL for this runtime: it offers only a manual "Try again", nothing
 * here clicks it, and the observed screen sat unchanged for 46 s until the
 * acquisition bound tore the context down. So a login that reaches it is
 * already dead, and every further second is spent waiting for a page that has
 * stopped being about our request.
 *
 * The wording matched is the SENTENCE, not the heading: the heading names the
 * factor ("security key" for the `usb` credential, and only that arm has been
 * observed), while the sentence carries the outcome. `.first()` — a Duo prompt
 * renders it once, and a union that assumed exclusivity is D213's defect.
 */
const DUO_TERMINAL_REFUSAL_TEXT = /login request .*(?:canceled|cancelled) or timed out/i;
/**
 * What the refusal MEANS, stated where an operator reads it. §9.21's live
 * bisection is the evidence: the same profile logs in at ~19 s with a counter
 * ahead of Duo's view and burns the whole 60 s bound with one forced 1 063
 * BELOW it, with nothing else changed.
 */
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

/**
 * The TritON username field, RE-PORTED 2026-08-03 after a live CRM login failed
 * loud at `credential-fill`.
 *
 * The legacy chain (hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc
 * `src/infra/auth/sso-fields.ts:19-22`:
 * `getByLabel("User name (or email address)")` → `getByLabel("Username")` →
 * `input[name="j_username"]`) is LABEL-first, and the live page proves why that
 * is the wrong shape: TritON renders the SAME field under a different label per
 * login type, so the label answers "which realm is this form for", not "where
 * do the credentials go".
 *
 * Live-verified 2026-08-03 against `a5.ucsd.edu/tritON`:
 *
 * | login type ("Signing on using:") | username label                  |
 * |---------------------------------|---------------------------------|
 * | Business Systems (the default)  | "Account ID or email address"   |
 * | Active Directory (what HR uses) | "User name (or email address)"  |
 * | UCPath's SSO entry              | "Username"                      |
 *
 * `id="ssousername"` / `name="urn:mace:ucsd.edu:sso:username"` are the same on
 * ALL of them, so the structural anchors come first and every observed label is
 * kept behind them as a corroborating fallback. `input[name="j_username"]` did
 * NOT come across: it matches no page here and would only mask a real break.
 */
const SSO_USERNAME_SELECTOR = '#ssousername, input[name="urn:mace:ucsd.edu:sso:username"]';
const SSO_USERNAME_LABELS = [
  "User name (or email address)",
  "Account ID or email address",
  "Username",
] as const;
/**
 * legacy src/infra/auth/sso-fields.ts:25-28 — password chain. Live-verified
 * still current 2026-08-03: label "Password:", `id="ssopassword"`.
 */
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

/** True when the SSO submit control is present — legacy `isSsoFormReady`. */
export async function isSsoFormPresent(page: Page): Promise<boolean> {
  return await ssoSubmitButton(page).count() > 0;
}

/**
 * The NEGATIVE half of every UCSD system's authentication proof: the Shibboleth
 * SSO form is not on the page. Shared, because every UCSD system in scope hops
 * through the same `a5.ucsd.edu` form.
 */
export async function probeSsoFormAbsent(page: Page): Promise<ObservedFact> {
  return probeAbsentControl(page, {
    selector: `${SSO_SUBMIT_SELECTOR}, ${SSO_USERNAME_SELECTOR}`,
    description: "the UCSD TritON SSO form",
  });
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
  // A chain that matches nothing must say SO, and say which chain, rather than
  // burning a navigation timeout on an ambiguous "could not be filled". This is
  // how the 2026-08-03 CRM failure was diagnosed down to the relabelled TritON
  // username field; the refusal itself stays loud either way.
  await requireMatchedField(system, context, usernameField(context.page), "username", SSO_USERNAME_SELECTOR);
  await requireMatchedField(system, context, passwordField(context.page), "password", SSO_PASSWORD_SELECTOR);
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

/** The locator for Duo's terminal refusal. Exported so a probe can assert it. */
export function duoTerminalRefusalLocator(page: Page): Locator {
  return page.getByText(DUO_TERMINAL_REFUSAL_TEXT).first();
}

/**
 * Resolves ONLY when Duo has rendered its terminal refusal.
 *
 * Absence is deliberately not an answer this arm may give. It races the landing
 * wait, which owns the timeout; settling here on "the refusal never appeared"
 * would report a healthy-but-slow login as a refusal AND would pre-empt the
 * landing's own diagnosis with a locator error. So the absent case never
 * settles — it is bounded entirely by the arm beside it, which always settles.
 */
async function observeDuoTerminalRefusal(page: Page, timeoutMs: number): Promise<"duo-refused"> {
  try {
    await duoTerminalRefusalLocator(page).waitFor({ state: "visible", timeout: timeoutMs });
  } catch {
    return await new Promise<"duo-refused">(() => undefined);
  }
  return "duo-refused";
}

/**
 * Waits for Duo to clear into the authenticated landing.
 *
 * `landed` is the system's verified marker predicate over the URL. On timeout
 * the failure names what the page is actually showing — a Duo prompt that never
 * cleared, the Shibboleth stale-request page, or an unrecognized landing — so
 * the operator is not left guessing. There is NO fallback path: an unverified
 * page never counts as authenticated.
 *
 * ## D243 — why the wait also WATCHES for a refusal
 *
 * Waiting for the landing alone can only ever learn "it did not happen", and
 * only when its own bound expires. That bound is `duoApprovalSeconds` (180 s by
 * default), which is deliberately LARGER than `sessionAcquireMs` (60 s), so on
 * a Duo stall the acquisition envelope always fires first and cancels this wait
 * — which means `describeStalledLanding`, the function whose whole job is to
 * explain a stalled Duo login, is unreachable at the shipped defaults and the
 * operator is handed a bound message naming Duo hand-approval instead (D125's
 * message, a real cause and not this one — separations §9.17 item 5).
 *
 * Duo does not make us infer it. It SAYS so, in words, about a second after the
 * assertion is rejected. So the wait races the landing against that observation
 * and refuses by name in ~12 s instead of burning 60 s and mis-attributing it.
 */
export async function waitForAuthenticatedLanding(
  system: BrowserSystemId,
  context: SystemLoginContext,
  landed: (url: string) => boolean,
  timeoutMs: number,
): Promise<void> {
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
      throw new BrowserLoginError(
        system,
        "duo-clearance",
        DUO_TERMINAL_REFUSAL_MESSAGE,
        context.page.url(),
      );
    }
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
    // D243: a stall ON the Duo host is two different failures wearing one
    // message. Ask the page which one it is before generalising, because the
    // generic answer sends the operator at `timeouts.duoApprovalSeconds`, and
    // for the refusal that leaf is not the cause and moving it changes nothing.
    let refusalCount: number;
    try {
      refusalCount = await duoTerminalRefusalLocator(context.page).count();
    } catch (error) {
      return `the Duo prompt never cleared, and whether Duo had already refused it could not be probed: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (refusalCount > 0) return DUO_TERMINAL_REFUSAL_MESSAGE;
    return "the Duo prompt never cleared; check that Duo Autopilot is loaded and its credential is current";
  }
  // Live-verified 2026-08-03: TritON re-renders its OWN form, on the same URL,
  // when the first factor is rejected ("The username you entered cannot be
  // identified" — the CRM login-type defect). Reporting that as "Duo never
  // cleared" sent the diagnosis a whole ceremony downstream of the failure.
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

/**
 * Composes one UCSD system's authentication proof from the facts every such
 * system shares plus the ones only it can supply.
 *
 * The order is cheapest-first and is a REFUSAL ladder, not a scoring function:
 * the URL is a necessary precondition, the positive artifact is what actually
 * proves a session exists, and the sign-in-form absences close the case. Any
 * one of them failing means "not authenticated", with the reason preserved
 * verbatim — `assertAuthenticatedApplication` turns that into the loud error.
 *
 * `assertVerifiedLanding` (URL predicate + SSO-form absence) was the previous
 * shape. It is gone on purpose: its URL half could be satisfied by a public
 * portal, and a recipe could return before ever reaching it.
 */
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
