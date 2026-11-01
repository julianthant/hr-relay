// Login requires positive application evidence and no sign-in form; shared hosts and redirects prove neither.
import { ERROR_CATALOG, type ErrorCatalogCode } from "../../../models/failures/error-catalog.js";
import type { Page } from "playwright";
import type { DuoCeremonyGate } from "../../../workflow-kit/duo-ceremony-lease.js";
import type { Config } from "../../../models/config/schema.js";
import type { RuntimeInstance } from "../../../models/config/instance.js";
import type { BrowserSystemId } from "../../../rules/identity/ids.js";
import type { LoginResult } from "../../../models/sessions/session.js";

/** The bounded step vocabulary a login failure can name. */
export type BrowserLoginStep =
  | "navigate-login-entry"
  | "campus-discovery"
  | "sso-form"
  | "credential-fill"
  | "sso-submit"
  | "duo-clearance"
  | "verify-landing";


type BrowserSignInCode = Extract<ErrorCatalogCode, `${string}_SIGN_IN_FAILED`>;
export type BrowserLandingStallCode = Extract<ErrorCatalogCode,
  | "TRAINING_REMINDER_REPEATED" | "SHIBBOLETH_STALE_REQUEST" | "DUO_PROMPT_STALLED"
  | "DUO_REFUSAL_UNPROVEN" | "SSO_FIRST_FACTOR_REJECTED" | "LANDING_PROBE_UNAVAILABLE"
  | "AUTHENTICATED_LANDING_MISSING"
>;
type BrowserLoginFailureCode = BrowserSignInCode | BrowserLandingStallCode
  | Extract<ErrorCatalogCode, "DUO_TERMINAL_REFUSAL">;
const SIGN_IN_CODES = {
  ucpath: "UCPATH_SIGN_IN_FAILED", crm: "CRM_SIGN_IN_FAILED", onbase: "ONBASE_SIGN_IN_FAILED",
  kuali: "KUALI_SIGN_IN_FAILED", servicenow: "SERVICENOW_SIGN_IN_FAILED", i9: "I9_SIGN_IN_FAILED",
  "new-kronos": "NEW_KRONOS_SIGN_IN_FAILED", "old-kronos": "OLD_KRONOS_SIGN_IN_FAILED", sharepoint: "SHAREPOINT_SIGN_IN_FAILED",
} as const satisfies Record<BrowserSystemId, BrowserSignInCode>;

export class BrowserLoginError extends Error {
  constructor(
    readonly system: BrowserSystemId,
    readonly step: BrowserLoginStep,
    readonly detail: string,
    readonly observedUrl: string,
    options?: ErrorOptions,
    readonly code: BrowserLoginFailureCode = SIGN_IN_CODES[system],
  ) {
    super(ERROR_CATALOG[code].text, options);
    this.name = "BrowserLoginError";
  }
}

export function browserLoginFailure(error: unknown): BrowserLoginError | undefined {
  const seen = new Set<unknown>();
  let current = error;
  while (current instanceof Error && !seen.has(current)) {
    if (current instanceof BrowserLoginError) return current;
    seen.add(current);
    current = current.cause;
  }
  return undefined;
}

// A refused Duo assertion burns the profile; only this failure permits one fresh-profile retry under the same lease.
export class DuoTerminalRefusalError extends BrowserLoginError {
  override readonly code = "DUO_TERMINAL_REFUSAL" as const;
  readonly refusal = "duo-terminal-refusal" as const;
  readonly host: string;
  readonly path: string;
  readonly title: string;

  constructor(system: BrowserSystemId, detail: string, observedUrl: string, options?: ErrorOptions, title = "") {
    super(system, "duo-clearance", detail, observedUrl, options, "DUO_TERMINAL_REFUSAL");
    this.name = "DuoTerminalRefusalError";
    const url = URL.parse(observedUrl);
    this.host = url?.hostname ?? "unknown";
    this.path = url?.pathname ?? "unknown";
    this.title = title.replace(/https?:\/\/\S+/giu, "[URL]").slice(0, 200);
  }
}


export class BrowserLandingStallError extends BrowserLoginError {
  override readonly code: BrowserLandingStallCode;
  readonly host: string;
  readonly path: string;
  readonly title: string;

  constructor(system: BrowserSystemId, code: BrowserLandingStallCode,
    page: Readonly<{ host: string; path: string; title: string }>, options?: ErrorOptions) {
    super(system, "duo-clearance", ERROR_CATALOG[code].text, "", options, code);
    this.name = "BrowserLandingStallError";
    this.code = code;
    const url = URL.parse(`https://${page.host}${page.path}`);
    this.host = url?.hostname ?? "unknown";
    this.path = url?.pathname ?? "unknown";
    this.title = page.title.replace(/https?:\/\/\S+/giu, "[URL]").slice(0, 200);
  }
}

export interface AuthenticatedApplicationEvidence {
  readonly system: BrowserSystemId;
  readonly url: string;
  /** The content-level fact that cannot exist without a completed login. */
  readonly positive: string;
  /** The absence fact: no sign-in form of any kind is present. */
  readonly negative: string;
}

// An unprovable probe is unauthenticated with its own reason, never an inferred session.
export type AuthenticationProbe =
  | Readonly<{ authenticated: true; evidence: AuthenticatedApplicationEvidence }>
  | Readonly<{ authenticated: false; reason: string }>;


export interface AuthenticationVerificationContext {
  readonly assertCurrent: () => void;
  readonly page: Page;
  readonly config: Config;
  // Authentication evidence must reach a readable channel; a hidden proof cannot explain a session.
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

  readonly credentials: Readonly<{ userId: string; password: string }>;

  readonly duoCeremony: DuoCeremonyGate;
  readonly acquisitionRemainingMs?: () => number;
  readonly claimStaleRequestRecovery?: () => boolean;
}

export type SystemLoginRecipe = (context: SystemLoginContext) => Promise<LoginResult>;
