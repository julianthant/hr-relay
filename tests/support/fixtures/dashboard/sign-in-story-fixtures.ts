/** Sign-in, sign-up and Duo setup fixtures for the state gallery: Duo drafts at each method and browser state, and a port whose actions never answer. Browser-safe. */
import type { ProfileOnboardingBrowser, ProfileOnboardingMethodState, ProfileOnboardingState, PublicProfileState } from "../../../../src/models/profiles/public-profile.js";
import { validateOnboarding, type ServedOnboardingPort } from "../../../../src/dashboard/surfaces/shell/onboarding-model.js";

type MethodKind = ProfileOnboardingMethodState["state"];
const OPERATION = "00000000-0000-4000-8000-000000000001";
const PROFILE = "00000000-0000-4000-8000-000000000002";
const ATTEMPT = "00000000-0000-4000-8000-000000000003";

const method = (state: MethodKind): ProfileOnboardingMethodState => ({
  state, ...(state === "pending" || state === "unknown" ? { attemptId: ATTEMPT } : {}),
  ceremonyObserved: state === "complete", portalAccepted: state === "complete", operatorConfirmed: state === "complete", exactCredentialRequestObserved: state === "complete",
});

/** A Duo draft with the security key at the given state; complete is the ready step. */
export function duoDraft(key: MethodKind, browser: ProfileOnboardingBrowser = { state: "open", generation: 1 }): ProfileOnboardingState {
  return { state: "onboarding", operationId: OPERATION, profileId: PROFILE,
    step: key === "complete" ? "ready" : "duo", methods: { key: method(key) }, browser };
}

/** What a person has typed or pressed to bring a screen to its state. */
export interface SignInScene {
  readonly step?: "login" | "signup" | "duo" | "ready";
  readonly setup?: "fast" | "duo";
  readonly draft?: ProfileOnboardingState;
  /** Setup window opened over a signed-in profile that is setting Duo up again. */
  readonly reenrol?: boolean;
  readonly resumable?: boolean;
  /** The session's own answer, as the sign-in page receives it. */
  readonly session?: PublicProfileState;
  readonly authorityUnavailable?: boolean;
  readonly profileProblem?: string;
  /** The sign-in is refused, and the cancel and finish replies are lost. */
  readonly refuse?: boolean;
  readonly noReply?: boolean;
  readonly unavailable?: boolean;
  readonly fill?: boolean;
  readonly press?: readonly string[];
  /** Milliseconds the page clock runs on after the presses. */
  readonly wait?: number;
  readonly submit?: boolean;
  readonly confirm?: boolean;
  readonly duoPage?: boolean;
}

const never = <T,>() => new Promise<T>(() => undefined);
const refused = async (): Promise<PublicProfileState> => ({ state: "refused", code: "PROFILE_SIGN_IN_REFUSED" });
const lost = async (): Promise<never> => { throw new Error("lost response"); };

/** Every action stays pending, except a refused sign-in and lost finish and cancel replies, so a story shows the state and never moves on. */
export function sceneStubPort(scene: SignInScene): ServedOnboardingPort {
  return Object.freeze<ServedOnboardingPort>({
    validate: validateOnboarding, onboarding: scene.draft, ...(scene.reenrol === true ? { reenrol: true } : {}), ...(scene.unavailable === true ? { unavailable: true } : {}),
    complete: scene.noReply === true ? lost : never, cancel: scene.noReply === true ? lost : never, cancelDuo: never, showBrowser: never, reopenBrowser: never,
    openPortal: never, start: never, confirmDuo: never, resume: never, submit: scene.refuse === true ? refused : never,
  });
}

export const SIGN_IN_DETAILS = [["First name", "Ana"], ["Last name", "Lee"], ["Work email", "ana.lee@ucsd.edu"], ["Password", "fixture-password"]] as const;
