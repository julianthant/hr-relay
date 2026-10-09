// Login requires positive application evidence and no sign-in form; shared hosts and redirects prove neither.
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

// A refused Duo assertion burns the profile; only this failure permits one fresh-profile retry under the same lease.
export class DuoTerminalRefusalError extends BrowserLoginError {
  readonly refusal = "duo-terminal-refusal" as const;

  constructor(system: BrowserSystemId, detail: string, observedUrl: string, options?: ErrorOptions) {
    super(system, "duo-clearance", detail, observedUrl, options);
    this.name = "DuoTerminalRefusalError";
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
}

export type SystemLoginRecipe = (context: SystemLoginContext) => Promise<LoginResult>;

export type BrowserLoginRegistry = Readonly<Partial<Record<BrowserSystemId, SystemLoginRecipe>>>;
