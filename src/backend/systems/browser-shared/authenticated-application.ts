// A shared URL is not authentication proof; require application evidence and absence of sign-in controls.
import type { Page } from "playwright";
import type { DuoCeremonyLeaseToken } from "../../../workflow-kit/duo-ceremony-lease.js";
import { BrowserLoginError } from "./login-contract.js";
import type {
  AuthenticatedApplicationEvidence,
  AuthenticatedApplicationVerifier,
  AuthenticationProbe,
  AuthenticationVerificationContext,
  SystemLoginContext,
  SystemLoginRecipe,
} from "./login-contract.js";
import type { BrowserSystemId } from "../../../rules/identity/ids.js";
import { LoginResultSchema } from "../../../models/sessions/session.js";
import type { LoginResult } from "../../../models/sessions/session.js";


export interface ObservedFact {
  readonly holds: boolean;
  readonly detail: string;
}

function describeCause(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Require a nonempty session cookie on the exact expected domain without logging its value.
export async function probeSessionCookie(page: Page, input: Readonly<{
  assertCurrent: () => void;
  name: string;
  domainSuffix: string;
  issuer: string;
}>): Promise<ObservedFact> {
  input.assertCurrent();
  let issued: readonly { name: string; domain: string; value: string }[];
  try {
    input.assertCurrent();
    issued = await page.context().cookies();
    input.assertCurrent();
  } catch (error) {
    input.assertCurrent();
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

// A failed absence probe is not proof that the sign-in form is absent.
export async function probeAbsentControl(page: Page, input: Readonly<{
  assertCurrent: () => void;
  selector: string;
  description: string;
}>): Promise<ObservedFact> {
  input.assertCurrent();
  let present: number;
  try {
    input.assertCurrent();
    present = await page.locator(input.selector).count();
    input.assertCurrent();
  } catch (error) {
    input.assertCurrent();
    return {
      holds: false,
      detail: `${input.description} could not be probed, so its absence is unproven: ${describeCause(error)}`,
    };
  }
  return present > 0
    ? { holds: false, detail: `${input.description} is still present on the page` }
    : { holds: true, detail: `${input.description} is absent` };
}


export async function assertAuthenticatedApplication(
  system: BrowserSystemId,
  context: AuthenticationVerificationContext,
  verify: AuthenticatedApplicationVerifier,

  refusal = "the login could not prove the authenticated application",
): Promise<AuthenticatedApplicationEvidence> {
  context.assertCurrent();
  const probe = await verify(context);
  context.assertCurrent();
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


export function defineVerifiedLoginRecipe(input: Readonly<{
  system: BrowserSystemId;
  verify: AuthenticatedApplicationVerifier;
  navigate: (context: SystemLoginContext) => Promise<void>;
  ceremony: (context: SystemLoginContext, token: DuoCeremonyLeaseToken) => Promise<void>;
}>): SystemLoginRecipe {
  return async (context: SystemLoginContext): Promise<LoginResult> => {
    context.assertCurrent();
    const probe = async (): Promise<AuthenticationProbe> => {
      context.assertCurrent();
      const result = await input.verify(context);
      context.assertCurrent();
      return result;
    };
    if ((await probe()).authenticated) {
      await assertAuthenticatedApplication(input.system, context, input.verify);
      return LoginResultSchema.parse("already-authenticated");
    }
    context.assertCurrent();
    await input.navigate(context);
    context.assertCurrent();
    if ((await probe()).authenticated) {
      await assertAuthenticatedApplication(input.system, context, input.verify);
      return LoginResultSchema.parse("already-authenticated");
    }
    context.assertCurrent();
    await context.duoCeremony.withCeremony(async (token) => {
      context.assertCurrent();
      await input.ceremony(context, token);
      context.assertCurrent();
      await assertAuthenticatedApplication(input.system, context, input.verify);
    });
    context.assertCurrent();
    return LoginResultSchema.parse("logged-in");
  };
}
