import { createRoot } from "react-dom/client";
import "../../../src/dashboard/ds/theme/hub-theme.css";
import type { ProfileOnboardingBrowser, ProfileOnboardingMethodState, ProfileOnboardingState, PublicProfileState } from "../../../src/models/profiles/public-profile.js";
import { TooltipProvider } from "../../../src/dashboard/ds/ui.js";
import { Onboarding } from "../../../src/dashboard/surfaces/shell/onboarding.js";
import { OnboardingSetup } from "../../../src/dashboard/surfaces/shell/onboarding-setup.js";
import { validateOnboarding, type OnboardingStep, type ServedOnboardingPort } from "../../../src/dashboard/surfaces/shell/onboarding-model.js";

type MethodKind = "idle" | "pending" | "complete" | "unknown";
const OPERATION = "00000000-0000-4000-8000-000000000001";
const PROFILE = "00000000-0000-4000-8000-000000000002";
const ATTEMPT = "00000000-0000-4000-8000-000000000003";

const method = (state: MethodKind): ProfileOnboardingMethodState => ({
  state, ...(state === "pending" || state === "unknown" ? { attemptId: ATTEMPT } : {}),
  ceremonyObserved: state === "complete", portalAccepted: state === "complete", operatorConfirmed: state === "complete", exactCredentialRequestObserved: state === "complete",
});

function draft(key: MethodKind, touch: MethodKind, browser: ProfileOnboardingBrowser = { state: "open", generation: 1 }): ProfileOnboardingState {
  return { state: "onboarding", operationId: OPERATION, profileId: PROFILE,
    step: key === "complete" && touch === "complete" ? "ready" : "duo", methods: { key: method(key), touch: method(touch) }, browser };
}

const never = <T,>() => new Promise<T>(() => undefined);
const refused = async (): Promise<PublicProfileState> => ({ state: "refused", code: "PROFILE_SIGN_IN_REFUSED" });
const lost = async (): Promise<never> => { throw new Error("lost response"); };
/** Every action stays pending, except a refused sign-in and a lost finish reply; scenes only render state. */
function stubPort(scene: Scene): ServedOnboardingPort {
  return Object.freeze<ServedOnboardingPort>({ validate: validateOnboarding, onboarding: scene.draft, ...(scene.reenrol === true ? { reenrol: true } : {}),
    complete: scene.noReply === true ? lost : never, cancel: never, cancelDuo: never, showBrowser: never, reopenBrowser: never, openPortal: never, start: never, confirmDuo: never, resume: never,
    submit: scene.refuse === true ? refused : never });
}

/**
 * `fill` types valid details, `press` clicks those buttons in order (the last match, so a dialog's button wins),
 * `wait` advances the page clock, and `shows` is the text the finished scene must show.
 */
export interface Scene {
  step?: OnboardingStep; setup?: boolean; duo?: boolean; confirm?: boolean; problem?: string; draft?: ProfileOnboardingState; submit?: boolean;
  reenrol?: boolean; resumable?: boolean; refuse?: boolean; noReply?: boolean; fill?: boolean; press?: readonly string[]; wait?: number; shows?: string;
}

/** One state per scene, named for what the operator sees. */
export const ONBOARDING_SCENES = {
  "login-empty": { step: "login" },
  "login-errors": { step: "login", submit: true },
  "login-profile-problem": { step: "login", problem: "Relay could not reach your profile. Try again." },
  "login-logging-in": { step: "login", fill: true, press: ["Log in"], shows: "Logging in…" },
  "login-wrong-password": { step: "login", refuse: true, fill: true, press: ["Log in"], shows: "Wrong email or password" },
  "login-resuming": { step: "login", resumable: true, shows: "Opening your workspace…" },
  "signup-empty": { step: "signup" },
  "signup-errors": { step: "signup", submit: true },
  "signup-creating-profile": { step: "signup", fill: true, press: ["Create profile"], shows: "Creating profile…" },
  "duo-not-started": { step: "duo", draft: draft("idle", "idle") },
  "duo-opening": { step: "duo", draft: draft("idle", "idle", { state: "opening", generation: 1 }), shows: "Opening setup window…" },
  "duo-still-opening": { step: "duo", draft: draft("idle", "idle", { state: "opening", generation: 1 }), wait: 10_000, shows: "Still opening setup window…" },
  "duo-key-pending": { step: "duo", draft: draft("pending", "idle"), shows: "Waiting for Duo to add Security key" },
  "duo-still-waiting": { step: "duo", draft: draft("pending", "idle"), wait: 10_000, shows: "Still waiting for Duo to add Security key" },
  "duo-timed-out": { step: "duo", draft: draft("pending", "idle"), wait: 600_000, shows: "Duo did not add Security key" },
  "duo-cancel-confirm": { step: "duo", draft: draft("pending", "idle"), press: ["Cancel sign-up"], shows: "Cancel sign-up?" },
  "duo-cancelling": { step: "duo", draft: draft("pending", "idle"), press: ["Cancel sign-up", "Cancel sign-up"], shows: "Cancelling…" },
  "duo-both-complete": { step: "duo", draft: draft("complete", "complete") },
  "duo-finishing": { step: "duo", draft: draft("complete", "complete"), press: ["Finish setup"], shows: "Finishing…" },
  "duo-finish-no-reply": { step: "duo", noReply: true, draft: draft("complete", "complete"), press: ["Finish setup"], shows: "No reply from Relay. Reload the page to check." },
  "duo-key-complete": { step: "duo", draft: draft("complete", "idle") },
  "duo-browser-failed": { step: "duo", draft: draft("idle", "idle", { state: "failed", generation: 1, code: "DUO_SETUP_OPEN_FAILED" }) },
  "duo-reopen-failed": { step: "duo", draft: draft("idle", "idle", { state: "failed", generation: 2, code: "DUO_SETUP_STOP_FAILED" }), shows: "Could not reopen setup window" },
  "ready": { step: "ready", draft: draft("complete", "complete") },
  "ready-opening-dashboard": { step: "ready", draft: draft("complete", "complete"), press: ["Go to dashboard"], shows: "Opening dashboard…" },
  "setup-not-started": { setup: true, draft: draft("idle", "idle") },
  "setup-key-pending": { setup: true, draft: draft("pending", "idle") },
  "setup-still-waiting": { setup: true, draft: draft("pending", "idle"), wait: 10_000, shows: "Still waiting for Duo." },
  "setup-key-complete": { setup: true, draft: draft("complete", "idle") },
  "setup-both-complete": { setup: true, draft: draft("complete", "complete") },
  "setup-key-failed": { setup: true, draft: draft("unknown", "idle") },
  "setup-duo-waiting": { setup: true, duo: true, draft: draft("pending", "idle") },
  "setup-duo-confirm": { setup: true, duo: true, confirm: true, draft: draft("pending", "idle") },
  "setup-reenrol-switching": { setup: true, reenrol: true, draft: draft("complete", "complete"), press: ["Use new devices"], shows: "Switching…" },
  "setup-reenrol-cancelling": { setup: true, reenrol: true, draft: draft("complete", "complete"), press: ["Cancel setup"], shows: "Cancelling…" },
} as const satisfies Record<string, Scene>;
export type OnboardingSceneId = keyof typeof ONBOARDING_SCENES;
export const ONBOARDING_SCENE_IDS = Object.keys(ONBOARDING_SCENES) as OnboardingSceneId[];

const noop = () => undefined;

export function OnboardingScenePage({ id }: { id: OnboardingSceneId }) {
  const scene: Scene = ONBOARDING_SCENES[id];
  const port = stubPort(scene);
  return <div data-app-root="" className="flex h-screen min-h-[var(--ds-h-desktop-min)] min-w-[var(--ds-w-desktop-min)] flex-col overflow-hidden bg-[color:var(--ds-surface-page)] text-[color:var(--ds-fg)]">
    <TooltipProvider>{scene.setup
      ? <OnboardingSetup page={scene.duo === true ? "duo" : "fast"} port={port} />
      : <Onboarding step={scene.step ?? "login"} onStep={noop} onDashboard={noop} port={port} authenticated={false} resumable={scene.resumable === true} {...(scene.problem === undefined ? {} : { problem: scene.problem })} />}</TooltipProvider>
  </div>;
}

/** Browser entry: the scene id and theme come from the URL. */
export function mountOnboardingScene(): void {
  const query = new URLSearchParams(location.search);
  const theme = query.get("theme") === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-demo-theme", theme);
  document.body.setAttribute("data-demo-theme", theme);
  document.querySelector("[data-app-root]")?.setAttribute("data-demo-theme", theme);
  const id = ONBOARDING_SCENE_IDS.find(option => option === query.get("scene"));
  if (id === undefined) throw new Error(`onboarding-scene-invalid:${String(query.get("scene"))}`);
  const root = document.getElementById("root");
  if (root === null) throw new Error("onboarding-root-missing");
  createRoot(root).render(<OnboardingScenePage id={id} />);
  document.querySelector("[data-app-root]")?.setAttribute("data-demo-theme", theme);
}
