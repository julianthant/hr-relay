/** Sign-in surface stories: the Log in, Sign up, Duo and ready steps, what the session says, each Duo method and
 * setup-window state, every press in flight, and the Duo setup window. The real components run on a port whose actions never answer. */
import type { Page } from "@playwright/test";
import type { ProfileOnboardingBrowser, ProfileOnboardingMethodState, PublicProfileState } from "../../../../../../src/models/profiles/public-profile.js";
import { ErrorCodeSchema } from "../../../../../../src/rules/identity/ids.js";
import { TooltipProvider } from "../../../../../../src/dashboard/ds/ui.js";
import { Onboarding } from "../../../../../../src/dashboard/surfaces/shell/onboarding.js";
import { OnboardingSetup } from "../../../../../../src/dashboard/surfaces/shell/onboarding-setup.js";
import { signInProblems, type OnboardingStep } from "../../../../../../src/dashboard/surfaces/shell/onboarding-model.js";
import { SIGN_IN_DETAILS, duoDraft, sceneStubPort, type SignInScene } from "../../../../fixtures/dashboard/sign-in-story-fixtures.js";
import { defineSurface, type Story } from "../story-catalogue.js";

type MethodState = ProfileOnboardingMethodState["state"];
type BrowserState = ProfileOnboardingBrowser["state"];
type SessionState = Exclude<PublicProfileState["state"], "active">;
const noop = () => undefined;
const OPERATION = "00000000-0000-4000-8000-000000000001";

function SignInPage({ scene }: { scene: SignInScene }) {
  const port = sceneStubPort(scene);
  const problems = signInProblems(scene.session, scene.authorityUnavailable === true);
  return <div data-app-root="" data-demo-theme="dark" className="flex h-screen min-h-[var(--ds-h-desktop-min)] min-w-[var(--ds-w-desktop-min)] flex-col overflow-hidden bg-[color:var(--ds-surface-page)] text-[color:var(--ds-fg)]">
    <TooltipProvider>{scene.setup !== undefined
      ? <OnboardingSetup page={scene.setup} port={port} />
      : <Onboarding step={scene.step ?? "login"} onStep={noop} onDashboard={noop} port={port} authenticated={false} resumable={scene.resumable === true}
        {...(problems.problem === undefined ? {} : { problem: problems.problem })} {...(problems.signInProblem === undefined ? {} : { signInProblem: problems.signInProblem })} />}</TooltipProvider>
  </div>;
}

/** What each scene must show, so a scene that stopped short fails at its ready point and names what it looked for. */
async function play(page: Page, scene: SignInScene): Promise<void> {
  if (scene.fill === true) for (const [label, value] of SIGN_IN_DETAILS) {
    const input = page.getByLabel(label, { exact: true });
    if (await input.count() > 0) await input.fill(value);
  }
  for (const name of scene.press ?? []) await page.getByRole("button", { name, exact: true }).last().click();
  if (scene.wait !== undefined) await page.clock.runFor(scene.wait);
  if (scene.submit === true) await page.getByRole("button", { name: scene.step === "signup" ? "Create profile" : "Log in" }).click();
  if (scene.confirm === true) await page.getByRole("button", { name: "Add this device" }).click();
  // The keyboard walk starts at the top of the page, as it does for a person who has just arrived.
  await page.evaluate(() => { getSelection()?.setPosition(document.body, 0); });
}

/** `shows` is the text the finished story must show; without it the story's own first control is the ready point. */
function scene(title: string, input: SignInScene, shows?: string): Story {
  const waits = input.wait !== undefined;
  const ready = shows !== undefined ? `text="${shows}"` : input.confirm === true ? '[role="dialog"]'
    : input.setup !== undefined ? 'h1:has-text("Set up Duo"), h2:has-text("Set up Duo")'
    : input.step === "signup" ? 'button:has-text("Create profile")' : input.step === "ready" ? 'button:has-text("Go to dashboard")'
    : input.step === "duo" ? '[aria-label="Duo methods"]' : 'button:has-text("Log in")';
  return { title, render: () => <SignInPage scene={input} />, ready, play: page => play(page, input), ...(waits ? { clock: true as const } : {}) };
}

const STEP = {
  login: scene("Log in, nothing typed", { step: "login" }),
  signup: scene("Sign up, nothing typed", { step: "signup" }),
  duo: scene("Duo step, nothing started", { step: "duo", draft: duoDraft("idle") }),
  ready: scene("Setup finished, ready for the dashboard", { step: "ready", draft: duoDraft("complete") }),
} satisfies Record<OnboardingStep, Story>;

const SESSION = {
  "signed-out": scene("Signed out of a machine with no profile", { step: "signup", session: { state: "signed-out", signUpRequired: true } }),
  error: scene("The session could not be read", { step: "login", session: { state: "error", code: ErrorCodeSchema.parse("PROFILE_AUTHORITY_UNAVAILABLE") } }),
  cancelling: scene("A log out still settling", { step: "login", session: { state: "cancelling", operationId: OPERATION } }),
  onboarding: scene("A sign-up part way through Duo", { step: "duo", draft: duoDraft("pending"), session: duoDraft("pending") }),
  refused: scene("A sign-in the session refused", { step: "login", session: { state: "refused", code: "PROFILE_SIGN_IN_REFUSED" } }),
} satisfies Record<SessionState, Story>;

/** Problems a person meets on Log in that no single session state names. */
type SignInProblem = "authority-unavailable" | "logout-blocked" | "logout-incomplete" | "browser-closure-unproved" | "resuming" | "wrong-password" | "field-errors" | "sign-up-field-errors";
const PROBLEM = {
  "authority-unavailable": scene("Relay could not reach the profile", { step: "login", authorityUnavailable: true }),
  "logout-blocked": scene("A log out blocked by a running profile", { step: "login", session: { state: "refused", code: "PROFILE_LOGOUT_BLOCKED" } }),
  "logout-incomplete": scene("A log out that did not finish", { step: "login", session: { state: "signed-out", logoutIncomplete: true } }),
  "browser-closure-unproved": scene("The last browser was not proved closed", { step: "login", session: { state: "error", code: ErrorCodeSchema.parse("BROWSER_CLOSURE_UNPROVED") } }),
  resuming: scene("Opening the workspace of a person still signed in", { step: "login", resumable: true }, "Opening your workspace…"),
  "wrong-password": scene("A sign-in answered with a wrong password", { step: "login", refuse: true, fill: true, press: ["Log in"] }, "Wrong email or password"),
  "field-errors": scene("Log in sent empty", { step: "login", submit: true }),
  "sign-up-field-errors": scene("Sign up sent empty", { step: "signup", submit: true }),
} satisfies Record<SignInProblem, Story>;

const METHOD = {
  unavailable: scene("Security key cannot be set up from here", { step: "duo", draft: duoDraft("unavailable") }),
  idle: scene("Security key not started", { step: "duo", draft: duoDraft("idle") }),
  pending: scene("Waiting for Duo to add the security key", { step: "duo", draft: duoDraft("pending") }, "Waiting for Duo to add Security key"),
  complete: scene("Security key added", { step: "duo", draft: duoDraft("complete") }),
  unknown: scene("Security key attempt not confirmed", { step: "duo", draft: duoDraft("unknown") },
    "Relay could not confirm your security key. In Duo, remove any device you do not recognize, then start over."),
} satisfies Record<MethodState, Story>;

const withBrowser = (browser: ProfileOnboardingBrowser) => ({ step: "duo", draft: duoDraft("idle", browser) }) as const satisfies SignInScene;
const BROWSER = {
  checking: scene("Checking the setup window", { ...withBrowser({ state: "checking", generation: 1 }), unavailable: true }),
  opening: scene("Opening the setup window", withBrowser({ state: "opening", generation: 1 }), "Opening setup window…"),
  open: scene("Setup window open", withBrowser({ state: "open", generation: 1 })),
  closed: scene("Setup window closed", withBrowser({ state: "closed", generation: 1 })),
  reopening: scene("Reopening the setup window", withBrowser({ state: "reopening", generation: 2 })),
  failed: scene("Setup window failed to open", withBrowser({ state: "failed", generation: 1, code: "DUO_SETUP_OPEN_FAILED" })),
} satisfies Record<BrowserState, Story>;

/** A press that has been sent and has not been answered, or a wait that has run long. */
type InFlight = "logging-in" | "creating-profile" | "opening-slow" | "waiting-slow" | "cancel-confirm" | "cancelling" | "cancel-no-reply"
  | "finishing" | "finish-no-reply" | "opening-dashboard";
const ACTION = {
  "logging-in": scene("Log in sent, waiting for an answer", { step: "login", fill: true, press: ["Log in"] }, "Logging in…"),
  "creating-profile": scene("Sign up sent, waiting for an answer", { step: "signup", fill: true, press: ["Create profile"] }, "Creating profile…"),
  "opening-slow": scene("Setup window taking longer than usual", { step: "duo", draft: duoDraft("idle", { state: "opening", generation: 1 }), wait: 10_000 }, "Still opening setup window…"),
  "waiting-slow": scene("Duo taking longer than usual", { step: "duo", draft: duoDraft("pending"), wait: 10_000 }, "Still waiting for Duo to add Security key"),
  "cancel-confirm": scene("Asked to confirm cancelling the sign-up", { step: "duo", draft: duoDraft("pending"), press: ["Cancel sign-up"] }, "Cancel sign-up?"),
  cancelling: scene("Cancelling the sign-up", { step: "duo", draft: duoDraft("pending"), press: ["Cancel sign-up", "Cancel sign-up"] }, "Cancelling…"),
  "cancel-no-reply": scene("No reply to cancelling the sign-up", { step: "duo", noReply: true, draft: duoDraft("pending"), press: ["Cancel sign-up", "Cancel sign-up"] },
    "No reply from Relay. Reload the page to check."),
  finishing: scene("Finish setup sent, waiting for an answer", { step: "duo", draft: duoDraft("complete"), press: ["Finish setup"] }, "Finishing…"),
  "finish-no-reply": scene("No reply to Finish setup", { step: "duo", noReply: true, draft: duoDraft("complete"), press: ["Finish setup"] },
    "No reply from Relay. Reload the page to check."),
  "opening-dashboard": scene("Go to dashboard sent, waiting for an answer", { step: "ready", draft: duoDraft("complete"), press: ["Go to dashboard"] }, "Opening dashboard…"),
} satisfies Record<InFlight, Story>;

/** The Duo setup window the browser opens, and setting Duo up again over a signed-in profile. */
type SetupWindow = "not-started" | "key-pending" | "still-waiting" | "key-complete" | "key-failed" | "duo-page" | "duo-confirm" | "reenrol-switching" | "reenrol-cancelling";
const SETUP = {
  "not-started": scene("Setup window, nothing started", { setup: "fast", draft: duoDraft("idle") }),
  "key-pending": scene("Setup window waiting for the security key", { setup: "fast", draft: duoDraft("pending") }),
  "still-waiting": scene("Setup window waiting longer than usual", { setup: "fast", draft: duoDraft("pending"), wait: 10_000 }, "Still waiting for Duo."),
  "key-complete": scene("Setup window with the security key added", { setup: "fast", draft: duoDraft("complete") }),
  "key-failed": scene("Setup window with the key not confirmed", { setup: "fast", draft: duoDraft("unknown") }),
  "duo-page": scene("Setup window on the Duo page", { setup: "duo", draft: duoDraft("pending") }),
  "duo-confirm": scene("Asked to confirm the device Duo added", { setup: "duo", draft: duoDraft("pending"), confirm: true }),
  "reenrol-switching": scene("Switching to the new key", { setup: "fast", reenrol: true, draft: duoDraft("complete"), press: ["Use new key"] }, "Switching…"),
  "reenrol-cancelling": scene("Cancelling setting Duo up again", { setup: "fast", reenrol: true, draft: duoDraft("complete"), press: ["Cancel setup"] }, "Cancelling…"),
} satisfies Record<SetupWindow, Story>;

export const SIGN_IN_STORIES = defineSurface("sign-in", { step: STEP, session: SESSION, problem: PROBLEM, method: METHOD, browser: BROWSER, action: ACTION, setup: SETUP });
