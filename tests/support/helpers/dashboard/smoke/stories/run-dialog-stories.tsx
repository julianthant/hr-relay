/** Run dialog stories: the real dialog on a client that answers what each story scripts, driven through its own controls to the state it is for. */
import type { Page } from "@playwright/test";
import type { DashboardClient } from "../../../../../../src/dashboard/client/index.js";
import { useMemo, type ReactNode } from "react";
import type { DashboardAuthority } from "../../../../../../src/dashboard/app/dashboard-app-model.js";
import type { FrontendBootstrapWire } from "../../../../../../src/models/dashboard/bootstrap.js";
import { ActorIdSchema } from "../../../../../../src/rules/identity/ids.js";
import { serverLocalDay } from "../../../../../../src/dashboard/surfaces/shell/date-navigation-model.js";
import { LOADING } from "../../../../../../src/dashboard/state/async-resource.js";
import { CommandResultSchema } from "../../../../../../src/rules/commands/commands.js";
import { DashboardClientProvider, DashboardCommandBindingProvider, useDashboardClient, useDashboardCommandExecutor } from "../../../../../../src/dashboard/state/client-context.js";
import { RunStartDialog } from "../../../../../../src/dashboard/surfaces/run-start/run-start.js";
import type { RunStartStage } from "../../../../../../src/dashboard/surfaces/run-start/run-dialog-model.js";
import type { LaunchActivity, LaunchRecovery, RerunLoad } from "../../../../../../src/dashboard/surfaces/run-start/run-dialog-model.js";
import type { StartRefusalCode } from "../../../../../../src/models/run/start-refusal.js";
import type { RunChecksState } from "../../../../../../src/dashboard/surfaces/run-start/run-checks-model.js";
import {
  RUN_DIALOG_ACTOR, RUN_DIALOG_APPLIED, RUN_DIALOG_BOOTSTRAP, RUN_DIALOG_CATALOG, RUN_DIALOG_CONFLICT, RUN_DIALOG_RERUN_SOURCE, RUN_DIALOG_TYPED, RUN_DIALOG_WORKFLOW,
  never, runDialogClient, runDialogPlan, runDialogReadiness, runDialogRerunSnapshot, runDialogRerunWarning, type ServedCheck,
} from "../../../../fixtures/dashboard/run-dialog-story-fixtures.js";
import { defineSurface, type Story } from "../story-catalogue.js";
import { StoryFrame } from "./story-frame.js";

const noop = () => undefined;

/** The command binding the app composes, over the saved bootstrap; the dialog reads only the clock, the day and the actor from it. */
function SceneBinding({ children }: { children: ReactNode }) {
  const client = useDashboardClient();
  const executor = useDashboardCommandExecutor();
  const binding = useMemo(() => {
    const bootstrap = RUN_DIALOG_BOOTSTRAP as unknown as FrontendBootstrapWire;
    const epoch = Object.freeze({ client, bootstrap });
    const day = serverLocalDay(bootstrap.serverClock);
    const request = Object.freeze({ client, day, epoch, revision: 0 });
    const authority: DashboardAuthority = Object.freeze({ epoch, catalog: [], now: () => bootstrap.serverClock.now, today: day, day,
      dayState: { subscribePublications: () => { throw new Error("the story serves no publications"); }, request, day: LOADING, connection: { state: "connecting" as const },
        refresh: () => { throw new Error("the story serves no day refresh"); } },
      selection: { route: { start: false }, workflowId: "" } });
    return Object.freeze({ authority, executor, scope: Object.freeze({ actorId: ActorIdSchema.parse(RUN_DIALOG_ACTOR), client, authority: epoch, dayRequest: request }), feedback: noop });
  }, [client, executor]);
  return <DashboardCommandBindingProvider binding={binding}>{children}</DashboardCommandBindingProvider>;
}

function DialogScene({ client, rerun, before }: { client: DashboardClient; rerun?: boolean; before?: () => void }) {
  before?.();
  return <StoryFrame><DashboardClientProvider client={client}><SceneBinding>
    <RunStartDialog open onOpenChange={noop} catalog={RUN_DIALOG_CATALOG} panelWorkflowId={RUN_DIALOG_WORKFLOW} actorId={RUN_DIALOG_ACTOR}
      onOpenIntake={noop} onFixCheck={noop} {...(rerun === true ? { rerunSource: RUN_DIALOG_RERUN_SOURCE } : {})} />
  </SceneBinding></DashboardClientProvider></StoryFrame>;
}

const dialog = (page: Page) => page.getByRole("dialog");
const press = (page: Page, name: string) => dialog(page).getByRole("button", { name, exact: true }).click();
const current = (page: Page) => dialog(page).locator('[aria-current="step"]');
const at = (page: Page, stage: string) => current(page).filter({ hasText: stage }).waitFor();

/** Where each kind of dialog goes by Continue, in order. */
const START_PATH = ["Input", "Options", "Checks"] as const;
const RERUN_PATH = ["Steps", "Values", "Options", "Checks"] as const;
/** Types the input of a start, then presses Continue until `stage` is current. */
async function reach(page: Page, stage: RunStartStage, rerun: boolean): Promise<void> {
  const path: readonly string[] = rerun ? RERUN_PATH : START_PATH;
  if (!rerun && stage !== "Input") await dialog(page).locator("textarea").first().fill(RUN_DIALOG_TYPED);
  await at(page, path[0] ?? "");
  for (const next of path.slice(1)) {
    if (stage === "Input" || stage === "Steps") return;
    if (path.indexOf(next) > path.indexOf(stage)) return;
    await press(page, "Continue");
    await at(page, next);
    if (next === stage) return;
  }
}

interface SceneOptions { readonly rerun?: boolean; readonly then?: (page: Page) => Promise<void>; readonly before?: () => void }
const scene = (title: string, client: () => DashboardClient, stage: RunStartStage, extra: Partial<Story> & SceneOptions = {}): Story => {
  const { rerun = false, then, before, ...story } = extra;
  return { title, render: () => <DialogScene client={client()} rerun={rerun} {...(before === undefined ? {} : { before })} />, ready: '[role="dialog"]',
    play: async page => { await reach(page, stage, rerun); await then?.(page);
      // The pointer rests on the button just pressed, which would draw its hover fill.
      await page.mouse.move(0, 0); }, ...story };
};
const reading = (...checks: ServedCheck[]) => () => runDialogClient({ readPreflight: async () => runDialogReadiness(checks) });
const PASS: ServedCheck = { check: "config.valid", status: "pass" };
const WARN: ServedCheck = { check: "fiscal.current", status: "warning", summary: "The fiscal year ends soon." };
const FIXABLE: ServedCheck = { check: "secrets.ucpath-sso", status: "fail", summary: "The UCPath password is missing." };
const UNFIXABLE: ServedCheck = { check: "filesystem.health", status: "fail", summary: "Relay is out of disk space." };
const rerunClient = (served: Partial<DashboardClient> = {}) => () => runDialogClient({ rerunValues: async () => runDialogRerunSnapshot(), previewRerunWarnings: async () => runDialogRerunWarning(false), ...served });
const planning = (served: Partial<DashboardClient> = {}) => () => runDialogClient({ submitStartPlan: async () => runDialogPlan(), executeCommand: async () => RUN_DIALOG_APPLIED, ...served });
const start = (page: Page) => press(page, "Start run");

/** Every dialog is built from the same large banded shell, which draws its body padding off the design system's, and holds a control no keyboard reaches. */
const SHELL_BREAK = { "dialogs-share-shape": "#532", "named-and-focusable": "#532" } as const;
const stage = (title: string, client: () => DashboardClient, at: RunStartStage, extra: Partial<Story> & SceneOptions = {}) =>
  scene(title, client, at, { knownFailures: SHELL_BREAK, ...extra });

const STAGE = {
  Input: stage("Input, nothing typed", () => runDialogClient(), "Input"),
  Options: stage("Options, input typed", () => runDialogClient(), "Options"),
  Steps: stage("A rerun's Steps, each step as the source ended", rerunClient(), "Steps", { rerun: true }),
  Values: stage("A rerun's Values, the input the source ran on", rerunClient(), "Values", { rerun: true }),
  Warning: stage("A rerun's warning that the source already filed", rerunClient({ previewRerunWarnings: async () => runDialogRerunWarning() }), "Steps", { rerun: true,
    then: async page => { await press(page, "Continue"); await dialog(page).getByText("already submitted").waitFor(); } }),
  Checks: stage("Checks, every check ready", reading(PASS), "Checks"),
} satisfies Record<RunStartStage, Story>;

const CHECKS = {
  checking: stage("Checks still being read", () => runDialogClient({ readPreflight: never }), "Checks", { slowFetch: { region: '[aria-label="Checking"]' } }),
  ready: stage("Checks with a warning", reading(PASS, WARN), "Checks"),
  unavailable: stage("Checks that could not be read", () => runDialogClient({ readPreflight: async () => ({ state: "unavailable", reason: "The runtime is restarting." }) }), "Checks"),
} satisfies Record<RunChecksState["state"], Story>;

const CHECK_COMBINATION = {
  "fixable-failure": stage("A failed check with a Fix button", reading(PASS, FIXABLE), "Checks"),
  "unfixable-failure": stage("A failed check with no Fix button", reading(UNFIXABLE, PASS), "Checks"),
  "failure-and-warning": stage("A failed check and a warning together", reading(FIXABLE, WARN, PASS), "Checks"),
} satisfies Record<string, Story>;

const RERUN_LOAD = {
  loading: stage("A rerun reading its source", () => runDialogClient({ rerunValues: never }), "Steps", { rerun: true }),
  failed: stage("A rerun whose source could not be read", () => runDialogClient({ rerunValues: async () => { throw new Error("The source run could not be read."); } }), "Steps", { rerun: true }),
  ready: stage("A rerun with its source read", rerunClient(), "Steps", { rerun: true }),
} satisfies Record<RerunLoad["state"], Story>;

const ACTIVITY = {
  planning: stage("Start pressed, the plan being built", planning({ submitStartPlan: never }), "Checks", { then: start }),
  "checking-warnings": stage("A rerun looking for repeat warnings", rerunClient({ previewRerunWarnings: never }), "Steps", { rerun: true, then: page => press(page, "Continue") }),
  submitting: stage("The plan sent, waiting on the answer", planning({ executeCommand: never }), "Checks", { then: start }),
  replanning: stage("An expired plan being built again", planning({ executeCommand: async () => CommandResultSchema.parse({ state: "rejected", commandId: "3a000000-0000-4000-8000-000000000003",
    code: "RUN_START_PLAN_EXPIRED", message: "The plan expired." }), submitStartPlan: never }), "Checks", { then: start }),
} satisfies Record<Exclude<LaunchActivity["kind"], "idle">, Story>;

const REFUSAL_COPY: Readonly<Record<StartRefusalCode, string>> = {
  "input-invalid": "The employee number is not valid.", "active-run-exists": "A run for this person is already going.",
  "dry-run-unsupported": "This workflow cannot do a dry run.", "preflight-failed": "A check failed.", "capability-unavailable": "This workflow is not available.",
};
const refusal = (code: StartRefusalCode): Story => stage(REFUSAL_COPY[code], planning({ submitStartPlan: async () => ({ ...runDialogPlan(), planned: [], refused: [{ entry: 1, code, message: REFUSAL_COPY[code] }] }) }), "Checks", { then: start });
const REFUSAL = {
  "input-invalid": refusal("input-invalid"), "active-run-exists": refusal("active-run-exists"), "dry-run-unsupported": refusal("dry-run-unsupported"),
  "preflight-failed": refusal("preflight-failed"), "capability-unavailable": refusal("capability-unavailable"),
} satisfies Record<StartRefusalCode, Story>;

const ANSWER = {
  conflict: stage("The start answered with a version conflict", planning({ executeCommand: async () => RUN_DIALOG_CONFLICT }), "Checks", { then: start,
    knownFailures: { ...SHELL_BREAK, "no-banned-text": "#532" } }),
} satisfies Record<string, Story>;

const RETAINED_KEY = `hrauto:run-launch:v1:${RUN_DIALOG_ACTOR}`;
const retainedCommand = () => JSON.stringify({ version: 1, command: { commandId: "3a000000-0000-4000-8000-0000000000aa", requestedAt: "2026-08-26T21:00:00.000Z", requestedBy: RUN_DIALOG_ACTOR,
  source: "dashboard", family: "start", type: "start-run", target: { workflowId: RUN_DIALOG_WORKFLOW, startPlanId: "5a000000-0000-4000-8000-000000000001", expectedVersion: 4 },
  payload: { descriptorFingerprint: "a".repeat(64), configFingerprint: "a".repeat(64), ingressSchemaHash: "a".repeat(64), canonicalInputSchemaHash: "a".repeat(64), inputFingerprint: "a".repeat(64) } } });
/** A saved submission is read when the dialog opens; the story saves one first and clears it for the next story. */
const saved = (value: string | null) => () => { if (value === null) window.sessionStorage.removeItem(RETAINED_KEY); else window.sessionStorage.setItem(RETAINED_KEY, value); };
const RECOVERY = {
  none: stage("Nothing saved from an earlier start", () => runDialogClient(), "Input", { before: saved(null) }),
  unreadable: stage("A saved start that cannot be read", () => runDialogClient(), "Input", { before: saved("not json"), knownFailures: { ...SHELL_BREAK, "no-banned-text": "#532" } }),
  retained: stage("A start sent earlier and not confirmed", planning({ executeCommand: never }), "Input", { before: saved(retainedCommand()), knownFailures: { ...SHELL_BREAK, "no-banned-text": "#532" } }),
} satisfies Record<LaunchRecovery["state"], Story>;

export const RUN_DIALOG_STORIES = defineSurface("run-dialog", {
  stage: STAGE, checks: CHECKS, "check-combination": CHECK_COMBINATION, "rerun-load": RERUN_LOAD, activity: ACTIVITY, refusal: REFUSAL, answer: ANSWER, recovery: RECOVERY,
});
