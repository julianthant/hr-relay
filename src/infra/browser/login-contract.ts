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
 *    explicit authenticated-landing marker. Anything else throws
 *    `BrowserLoginError` naming the system and the step.
 * 2. **No silent retry loop.** A recipe navigates and waits on real readiness
 *    predicates under bounded timeouts. It never re-drives a whole login in a
 *    loop hoping a later attempt lands somewhere plausible.
 * 3. **A credential value never reaches a message.** Errors name the system,
 *    the step, and the observed URL — never a field value.
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

export interface SystemLoginContext {
  readonly page: Page;
  readonly config: Config;
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
