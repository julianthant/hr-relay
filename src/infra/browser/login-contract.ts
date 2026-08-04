/**
 * The per-system login recipe contract (doc 05 §4 · doc 01 §7B session seam).
 *
 * Browser/context creation belongs to the worker session factory; the LOGIN
 * RECIPE belongs to the system's store, which owns that system's page
 * knowledge. This module declares the seam between them, and it is one of the
 * two raw-browser owner families: only `src/infra/browser/**` and a store's
 * `driver/**` / `session.ts` may name a Playwright type.
 *
 * Every recipe obeys three rules the factory cannot enforce for it:
 *
 * 1. **Verify, never assume.** A recipe returns only after observing an
 *    explicit authenticated-application PROOF. Anything else throws
 *    `BrowserLoginError` naming the system and the step.
 * 2. **No silent retry loop.** A recipe navigates and waits on real readiness
 *    predicates under bounded timeouts. It never re-drives a whole login in a
 *    loop hoping a later attempt lands somewhere plausible.
 * 3. **A credential value never reaches a message.** Errors name the system,
 *    the step, and the observed URL — never a field value.
 *
 * ## Why a URL is not a proof (2026-08-03)
 *
 * A live smoke once "passed" in ~3s having never logged in: the recipe read the
 * PUBLIC UCPath portal's URL, matched a host SUBSTRING, and returned
 * `already-authenticated`. A URL is chosen by whoever served the redirect; a
 * sign-in page and its application routinely share a host, and PeopleSoft's
 * signon renders at the same route shape as the app itself. So this module
 * declares authentication as a CONTENT-level observation:
 *
 * - a **positive** fact — a session artifact that cannot exist without a
 *   completed authentication (a server-issued session cookie, an app-only DOM
 *   marker); and
 * - a **negative** fact — no sign-in form of any kind is on the page.
 *
 * Both must hold, and every return path runs the same check (see
 * `defineVerifiedLoginRecipe` in `authenticated-application.ts`).
 */
import type { Page } from "playwright";
import type { Config } from "../../domain/config/schema.js";
import type { RuntimeInstance } from "../../domain/config/instance.js";
import type { BrowserSystemId } from "../../domain/ids.js";
import type { LoginResult } from "../../domain/session.js";

/** The bounded step vocabulary a login failure can name. */
export type BrowserLoginStep =
  | "navigate-login-entry"
  | "campus-discovery"
  | "sso-form"
  | "credential-fill"
  | "sso-submit"
  | "duo-clearance"
  | "verify-landing";

/**
 * A structured, legible login failure. `system` + `step` + `observedUrl` are
 * exactly what an operator needs to tell "SSO never rendered" from "Duo never
 * cleared" from "we landed somewhere that is not the authenticated app".
 */
export class BrowserLoginError extends Error {
  readonly system: BrowserSystemId;
  readonly step: BrowserLoginStep;
  readonly observedUrl: string;

  constructor(
    system: BrowserSystemId,
    step: BrowserLoginStep,
    detail: string,
    observedUrl: string,
    options?: ErrorOptions,
  ) {
    super(`${system} login failed at ${step}: ${detail} (observed URL ${observedUrl})`, options);
    this.name = "BrowserLoginError";
    this.system = system;
    this.step = step;
    this.observedUrl = observedUrl;
  }
}

/**
 * What was actually OBSERVED to conclude "this page is the authenticated
 * application". Every field is a description, never a value: `positive` and
 * `negative` name the artifact and how it was found, so an operator reading a
 * smoke log or an event can tell a real session from a plausible URL.
 */
export interface AuthenticatedApplicationEvidence {
  readonly system: BrowserSystemId;
  readonly url: string;
  /** The content-level fact that cannot exist without a completed login. */
  readonly positive: string;
  /** The absence fact: no sign-in form of any kind is present. */
  readonly negative: string;
}

/**
 * The result of asking a live page whether it is the authenticated application.
 *
 * `authenticated: false` deliberately covers BOTH "this is a sign-in page" and
 * "the page could not be probed" — its `reason` distinguishes them in text.
 * Collapsing an unprovable check into "authenticated" is the exact defect this
 * type exists to prevent; collapsing it into "not authenticated" is safe in
 * both directions (a login re-runs, a verification fails loud).
 */
export type AuthenticationProbe =
  | Readonly<{ authenticated: true; evidence: AuthenticatedApplicationEvidence }>
  | Readonly<{ authenticated: false; reason: string }>;

/**
 * Everything a verifier may look at. Narrower than a login context on purpose:
 * the neutral-reset path has no credentials and must still run the SAME check.
 */
export interface AuthenticationVerificationContext {
  readonly page: Page;
  readonly config: Config;
  /**
   * The evidence channel. Required, never optional: a proof nobody can read is
   * indistinguishable from no proof, and the smoke/operator surfaces need the
   * marker that was actually observed.
   */
  readonly recordEvidence: (evidence: AuthenticatedApplicationEvidence) => void;
}

export type AuthenticatedApplicationVerifier = (
  context: AuthenticationVerificationContext,
) => Promise<AuthenticationProbe>;

export interface SystemLoginContext extends AuthenticationVerificationContext {
  readonly instance: RuntimeInstance;
  /** Names the requesting worker/system session in fail-loud messages. */
  readonly label: string;
  readonly signal: AbortSignal;
  /**
   * Resolved SSO credentials. The factory reads them through
   * `src/domain/secrets.ts` (the single credential reader) and hands the values
   * in; a recipe never touches `process.env`.
   */
  readonly credentials: Readonly<{ userId: string; password: string }>;
}

export type SystemLoginRecipe = (context: SystemLoginContext) => Promise<LoginResult>;

export type BrowserLoginRegistry = Readonly<Partial<Record<BrowserSystemId, SystemLoginRecipe>>>;
