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

export const DUO_TERMINAL_REFUSAL_TEXT =
  "Duo REFUSED the WebAuthn assertion and rendered its terminal \"canceled or timed out\" screen; "
  + "this login is dead and the prompt will not clear on its own. The cause is almost never Duo "
  + "hand-approval: it is a Duo Autopilot signCount regression, where this browser profile's stored "
  + "counter has fallen BEHIND the value Duo has already observed for the shared credential (a "
  + "counter that does not advance is a cloned-key signal), which is what happens when any other "
  + "profile using the same credential signed more recently. Check the extension's stored signCount "
  + "before touching timeouts.duoApprovalSeconds or timeouts.sessionAcquireMs";

// A refused Duo assertion burns the profile; only this failure permits one fresh-profile retry under the same lease.
export class DuoTerminalRefusalError extends BrowserLoginError {
  readonly code = "duo-terminal-refusal" as const;
  readonly refusal = "duo-terminal-refusal" as const;
  readonly host: string;
  readonly path: string;
  readonly title: string;

  constructor(system: BrowserSystemId, detail: string, observedUrl: string, options?: ErrorOptions, title = "") {
    super(system, "duo-clearance", detail, observedUrl, options);
    this.name = "DuoTerminalRefusalError";
    const url = URL.parse(observedUrl);
    this.host = url?.hostname ?? "unknown";
    this.path = url?.pathname ?? "unknown";
    this.title = title.replace(/https?:\/\/\S+/giu, "[URL]").slice(0, 200);
  }
}


export const BROWSER_LANDING_STALL_TEXT = {
  "training-reminder-repeated": "the UCSD training reminder appeared again after Continue Log In",
  "shibboleth-stale-request": "Shibboleth served its stale-request page; the SAML execution expired during login",
  "duo-prompt-stalled": "the Duo prompt never cleared; check that Duo Autopilot is loaded and its credential is current",
  "duo-refusal-unproven": "the Duo prompt never cleared, and its terminal refusal could not be probed",
  "sso-first-factor-rejected": "the UCSD SSO form is still on the page; the first factor was rejected",
  "landing-probe-unavailable": "no authenticated landing appeared, and the stalled page could not be probed",
  "authenticated-landing-missing": "no authenticated landing appeared",
} as const;
export type BrowserLandingStallCode = keyof typeof BROWSER_LANDING_STALL_TEXT;

export class BrowserLandingStallError extends BrowserLoginError {
  readonly code: BrowserLandingStallCode;
  readonly host: string;
  readonly path: string;
  readonly title: string;

  constructor(system: BrowserSystemId, code: BrowserLandingStallCode,
    page: Readonly<{ host: string; path: string; title: string }>, options?: ErrorOptions) {
    super(system, "duo-clearance", BROWSER_LANDING_STALL_TEXT[code], "", options);
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
