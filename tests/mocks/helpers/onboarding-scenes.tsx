import { createRoot } from "react-dom/client";
import "../../../src/dashboard/ds/theme/hub-theme.css";
import type { ProfileOnboardingBrowser, ProfileOnboardingMethodState, ProfileOnboardingState } from "../../../src/models/profiles/public-profile.js";
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
/** Every action stays pending; scenes only render state. */
function stubPort(onboarding?: ProfileOnboardingState): ServedOnboardingPort {
  return Object.freeze<ServedOnboardingPort>({ validate: validateOnboarding, onboarding,
    complete: never, cancel: never, cancelDuo: never, showBrowser: never, reopenBrowser: never, openPortal: never, start: never, confirmDuo: never, resume: never, submit: never });
}

interface Scene { step?: OnboardingStep; setup?: boolean; duo?: boolean; confirm?: boolean; problem?: string; draft?: ProfileOnboardingState; submit?: boolean }

/** One state per scene, named for what the operator sees. */
export const ONBOARDING_SCENES = {
  "login-empty": { step: "login" },
  "login-errors": { step: "login", submit: true },
  "login-profile-problem": { step: "login", problem: "Relay could not reach your profile. Try again." },
  "signup-empty": { step: "signup" },
  "signup-errors": { step: "signup", submit: true },
  "duo-not-started": { step: "duo", draft: draft("idle", "idle") },
  "duo-key-pending": { step: "duo", draft: draft("pending", "idle") },
  "duo-key-complete": { step: "duo", draft: draft("complete", "idle") },
  "duo-browser-failed": { step: "duo", draft: draft("idle", "idle", { state: "failed", generation: 1, code: "DUO_SETUP_OPEN_FAILED" }) },
  "ready": { step: "ready", draft: draft("complete", "complete") },
  "setup-not-started": { setup: true, draft: draft("idle", "idle") },
  "setup-key-pending": { setup: true, draft: draft("pending", "idle") },
  "setup-key-complete": { setup: true, draft: draft("complete", "idle") },
  "setup-both-complete": { setup: true, draft: draft("complete", "complete") },
  "setup-key-failed": { setup: true, draft: draft("unknown", "idle") },
  "setup-duo-waiting": { setup: true, duo: true, draft: draft("pending", "idle") },
  "setup-duo-confirm": { setup: true, duo: true, confirm: true, draft: draft("pending", "idle") },
} as const satisfies Record<string, Scene>;
export type OnboardingSceneId = keyof typeof ONBOARDING_SCENES;
export const ONBOARDING_SCENE_IDS = Object.keys(ONBOARDING_SCENES) as OnboardingSceneId[];

const noop = () => undefined;

export function OnboardingScenePage({ id }: { id: OnboardingSceneId }) {
  const scene: Scene = ONBOARDING_SCENES[id];
  const port = stubPort(scene.draft);
  return <div data-app-root="" className="flex h-screen min-h-[var(--ds-h-desktop-min)] min-w-[var(--ds-w-desktop-min)] flex-col overflow-hidden bg-[color:var(--ds-surface-page)] text-[color:var(--ds-fg)]">
    <TooltipProvider>{scene.setup
      ? <OnboardingSetup page={scene.duo === true ? "duo" : "fast"} port={port} />
      : <Onboarding step={scene.step ?? "login"} onStep={noop} onDashboard={noop} port={port} authenticated={false} {...(scene.problem === undefined ? {} : { problem: scene.problem })} />}</TooltipProvider>
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
