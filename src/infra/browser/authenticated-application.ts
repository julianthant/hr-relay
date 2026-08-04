/**
 * "This page IS the authenticated application" — as an OBSERVATION.
 *
 * This module is the answer to a real production defect (2026-08-03): a live
 * UCPath login smoke reported success in ~3 seconds without ever authenticating,
 * because the recipe concluded "already authenticated" from a URL substring on
 * the PUBLIC UCPath portal, and that early return also skipped the second fact
 * the design intended. The neutral-reset path had the same hole from the other
 * side: it validated reuse with a URL predicate alone, so PeopleSoft's signon
 * page — same host, same route shape, titled "Oracle PeopleSoft Sign-in" —
 * passed as the application. A person lookup would then have scraped a sign-in
 * page and reported it as authenticated data.
 *
 * Two rules follow, and this module is where they are made structural:
 *
 * 1. **Two independent facts, both content-level.** A POSITIVE fact (a session
 *    artifact the server only issues after a completed authentication) and a
 *    NEGATIVE fact (no sign-in form is present). A URL may be a NECESSARY
 *    condition a system's verifier checks first; it is never sufficient.
 * 2. **One verification, on every return path.** `defineVerifiedLoginRecipe`
 *    wraps a recipe's flow so the proof runs AFTER the flow, whatever the flow
 *    decided. `already-authenticated` and `logged-in` are then only ever labels
 *    on the same proven state — a future edit cannot reintroduce a bypass by
 *    adding another early `return`.
 */
import type { Page } from "playwright";
import { BrowserLoginError } from "./login-contract.js";
import type {
  AuthenticatedApplicationEvidence,
  AuthenticatedApplicationVerifier,
  AuthenticationProbe,
  AuthenticationVerificationContext,
  SystemLoginContext,
  SystemLoginRecipe,
} from "./login-contract.js";
import type { BrowserSystemId } from "../../domain/ids.js";
import { LoginResultSchema } from "../../domain/session.js";
import type { LoginResult } from "../../domain/session.js";

/**
 * One observed fact. `holds` answers exactly the question the caller asked
 * ("the session cookie is present", "the sign-in form is absent"); `detail`
 * says how it was established, including when the probe itself failed.
 */
export interface ObservedFact {
  readonly holds: boolean;
  readonly detail: string;
}

function describeCause(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The POSITIVE fact for a server-session system: a named cookie, on the
 * expected domain, carrying a non-empty value.
 *
 * A cookie is the strongest cheap proof available here because the application
 * server ISSUES it — a page cannot fake one into the browser context, and a
 * sign-in page does not have one. The VALUE is never read into a message: only
 * the name, the domain, and the fact that it is non-empty.
 */
export async function probeSessionCookie(page: Page, input: Readonly<{
  name: string;
  domainSuffix: string;
  issuer: string;
}>): Promise<ObservedFact> {
  let issued: readonly { name: string; domain: string; value: string }[];
  try {
    issued = await page.context().cookies();
  } catch (error) {
    return {
      holds: false,
      detail: `the browser context store could not be read, so ${input.issuer} cannot be proven: ${describeCause(error)}`,
    };
  }
  const domain = input.domainSuffix.toLowerCase();
  const matched = issued.filter((entry) =>
    entry.name === input.name
    && entry.value.length > 0
    && (entry.domain.toLowerCase() === domain || entry.domain.toLowerCase().endsWith(`.${domain}`)));
  if (matched.length === 0) {
    const observedNames = [...new Set(issued.map((entry) => entry.name))].sort();
    return {
      holds: false,
      detail: `${input.issuer} never issued its ${input.name} session cookie for ${input.domainSuffix} (context holds ${String(observedNames.length)} name(s): ${observedNames.length === 0 ? "none" : observedNames.join(", ")})`,
    };
  }
  return {
    holds: true,
    detail: `${input.issuer} issued a non-empty ${input.name} session cookie for ${input.domainSuffix}`,
  };
}

/**
 * The NEGATIVE fact: no element matching `selector` is on the page.
 *
 * A probe that cannot run reports `holds: false` — "I could not prove the
 * sign-in form is gone" must never read the same as "it is gone".
 */
export async function probeAbsentControl(page: Page, input: Readonly<{
  selector: string;
  description: string;
}>): Promise<ObservedFact> {
  let present: number;
  try {
    present = await page.locator(input.selector).count();
  } catch (error) {
    return {
      holds: false,
      detail: `${input.description} could not be probed, so its absence is unproven: ${describeCause(error)}`,
    };
  }
  return present > 0
    ? { holds: false, detail: `${input.description} is still present on the page` }
    : { holds: true, detail: `${input.description} is absent` };
}

/**
 * Runs a system's verifier and turns a refusal into a loud `BrowserLoginError`.
 * The returned evidence is also pushed to the context's evidence channel, so an
 * operator surface can show WHAT proved the session rather than "trust me".
 */
export async function assertAuthenticatedApplication(
  system: BrowserSystemId,
  context: AuthenticationVerificationContext,
  verify: AuthenticatedApplicationVerifier,
  /**
   * How the refusal opens. The neutral reset and a login run the IDENTICAL
   * check, and an operator still has to be able to tell which one refused.
   */
  refusal = "the login could not prove the authenticated application",
): Promise<AuthenticatedApplicationEvidence> {
  const probe = await verify(context);
  if (!probe.authenticated) {
    throw new BrowserLoginError(system, "verify-landing", `${refusal}: ${probe.reason}`, context.page.url());
  }
  if (probe.evidence.system !== system) {
    throw new BrowserLoginError(
      system,
      "verify-landing",
      `authentication evidence was produced for ${probe.evidence.system}, not ${system}`,
      context.page.url(),
    );
  }
  context.recordEvidence(probe.evidence);
  return probe.evidence;
}

/**
 * Builds a login recipe whose verification CANNOT be skipped.
 *
 * The flow decides only the LABEL — did this call have to log in, or was the
 * session already live. Whatever it returns, the same content-level proof runs
 * before the recipe resolves. The flow is handed the same verifier as a `probe`
 * so its "are we already in?" decision is the identical two-fact check rather
 * than a cheaper URL guess.
 */
export function defineVerifiedLoginRecipe(input: Readonly<{
  system: BrowserSystemId;
  verify: AuthenticatedApplicationVerifier;
  flow: (
    context: SystemLoginContext,
    probe: () => Promise<AuthenticationProbe>,
  ) => Promise<LoginResult>;
}>): SystemLoginRecipe {
  return async (context: SystemLoginContext): Promise<LoginResult> => {
    const outcome = LoginResultSchema.parse(
      await input.flow(context, async () => input.verify(context)),
    );
    await assertAuthenticatedApplication(input.system, context, input.verify);
    return outcome;
  };
}
