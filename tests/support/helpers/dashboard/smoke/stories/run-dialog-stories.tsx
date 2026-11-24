/** Run dialog stories: the real dialog on a client that answers what each story scripts, driven through its own controls to the state it is for. */
import type { Page } from "@playwright/test";
import type { DashboardClient } from "../../../../../../src/dashboard/client/index.js";
import { CommandResultSchema } from "../../../../../../src/rules/commands/commands.js";
import { DashboardClientProvider } from "../../../../../../src/dashboard/state/client-context.js";
import { DashboardClientError } from "../../../../../../src/dashboard/client/errors.js";
import { RunStartDialog } from "../../../../../../src/dashboard/surfaces/run-start/run-start.js";
import type { RunStartStage } from "../../../../../../src/dashboard/surfaces/run-start/run-dialog-model.js";
import type { LaunchActivity, LaunchRecovery, RerunLoad } from "../../../../../../src/dashboard/surfaces/run-start/run-dialog-model.js";
import { PreflightCheckIdSchema } from "../../../../../../src/models/preflight/preflight-contract.js";
import type { StartRefusalCode } from "../../../../../../src/models/run/start-refusal.js";
import type { RunChecksState } from "../../../../../../src/dashboard/surfaces/run-start/run-checks-model.js";
import {
  RUN_DIALOG_ACTOR, RUN_DIALOG_APPLIED, RUN_DIALOG_CHECK_CATALOG, RUN_DIALOG_DRY_RUN_CATALOG, RUN_DIALOG_PDF_CATALOG, RUN_DIALOG_REFERENCE_CATALOG, runDialogUpload, RUN_DIALOG_CATALOG, RUN_DIALOG_CONFLICT, RUN_DIALOG_RERUN_SOURCE, RUN_DIALOG_TYPED, RUN_DIALOG_WORKFLOW,
  never, runDialogClient, runDialogPlan, runDialogReadiness, runDialogRerunSnapshot, runDialogRerunWarning, type ServedCheck,
} from "../../../../fixtures/dashboard/run-dialog-story-fixtures.js";
import { defineSurface, type Story } from "../story-catalogue.js";
import { SceneBinding } from "./scene-binding.js";
import { StoryFrame } from "./story-frame.js";

const noop = () => undefined;

function DialogScene({ client, rerun, before, catalog = RUN_DIALOG_CATALOG }: { client: DashboardClient; rerun?: boolean; before?: () => void; catalog?: typeof RUN_DIALOG_CATALOG }) {
  before?.();
  return <StoryFrame><DashboardClientProvider client={client}><SceneBinding>
    <RunStartDialog open onOpenChange={noop} catalog={catalog} panelWorkflowId={RUN_DIALOG_WORKFLOW} actorId={RUN_DIALOG_ACTOR}
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

interface SceneOptions { readonly catalog?: typeof RUN_DIALOG_CATALOG; readonly rerun?: boolean; readonly then?: (page: Page) => Promise<void>; readonly before?: () => void }
const scene = (title: string, client: () => DashboardClient, stage: RunStartStage, extra: Partial<Story> & SceneOptions = {}): Story => {
  const { rerun = false, then, before, catalog, ...story } = extra;
  return { title, render: () => <DialogScene client={client()} rerun={rerun} {...(catalog === undefined ? {} : { catalog })} {...(before === undefined ? {} : { before })} />, ready: '[role="dialog"]',
    play: async page => { await reach(page, stage, rerun); await then?.(page);
      // The pointer rests on the button just pressed, which would draw its hover fill.
      await page.mouse.move(0, 0); }, ...story };
};
const reading = (...checks: ServedCheck[]) => () => runDialogClient({ readPreflight: async () => runDialogReadiness(checks) });
const PASS: ServedCheck = { check: PreflightCheckIdSchema.parse("config.valid"), status: "pass" };
const WARN: ServedCheck = { check: PreflightCheckIdSchema.parse("fiscal.current"), status: "warning", summary: "The fiscal year ends soon." };
const FIXABLE: ServedCheck = { check: PreflightCheckIdSchema.parse("secrets.ucpath-sso"), status: "fail", summary: "The UCPath password is missing." };
const UNFIXABLE: ServedCheck = { check: PreflightCheckIdSchema.parse("filesystem.health"), status: "fail", summary: "Relay is out of disk space." };
const rerunClient = (served: Partial<DashboardClient> = {}) => () => runDialogClient({ rerunValues: async () => runDialogRerunSnapshot(), previewRerunWarnings: async () => runDialogRerunWarning(false), ...served });
const planning = (served: Partial<DashboardClient> = {}) => () => runDialogClient({ submitStartPlan: async () => runDialogPlan(), executeCommand: async () => RUN_DIALOG_APPLIED, ...served });
const start = (page: Page) => press(page, "Start run");

const stage = scene;

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
  conflict: stage("The start answered with a version conflict", planning({ executeCommand: async () => RUN_DIALOG_CONFLICT }), "Checks", { then: start }),
} satisfies Record<string, Story>;

const RETAINED_KEY = `hrauto:run-launch:v1:${RUN_DIALOG_ACTOR}`;
const retainedCommand = () => JSON.stringify({ version: 1, command: { commandId: "3a000000-0000-4000-8000-0000000000aa", requestedAt: "2026-08-26T21:00:00.000Z", requestedBy: RUN_DIALOG_ACTOR,
  source: "dashboard", family: "start", type: "start-run", target: { workflowId: RUN_DIALOG_WORKFLOW, startPlanId: "5a000000-0000-4000-8000-000000000001", expectedVersion: 4 },
  payload: { descriptorFingerprint: "a".repeat(64), configFingerprint: "a".repeat(64), ingressSchemaHash: "a".repeat(64), canonicalInputSchemaHash: "a".repeat(64), inputFingerprint: "a".repeat(64) } } });
/** A saved submission is read when the dialog opens; the story saves one first and clears it for the next story. */
const saved = (value: string | null) => () => { if (value === null) window.sessionStorage.removeItem(RETAINED_KEY); else window.sessionStorage.setItem(RETAINED_KEY, value); };
const RECOVERY = {
  none: stage("Nothing saved from an earlier start", () => runDialogClient(), "Input", { before: saved(null) }),
  unreadable: stage("A saved start that cannot be read", () => runDialogClient(), "Input", { before: saved("not json") }),
  retained: stage("A start sent earlier and not confirmed", planning({ executeCommand: never }), "Input", { before: saved(retainedCommand()) }),
} satisfies Record<LaunchRecovery["state"], Story>;

/** The Options stage's controls, each pressed once away from its default. */
type OptionsControl = "priority" | "dry-run" | "browser-mode";
const OPTIONS = {
  priority: stage("Options with Priority switched off", () => runDialogClient(), "Options", { then: page => dialog(page).getByRole("switch", { name: "Priority" }).click() }),
  "dry-run": stage("Options with Dry run switched on", () => runDialogClient(), "Options", { catalog: RUN_DIALOG_DRY_RUN_CATALOG, then: page => dialog(page).getByRole("switch", { name: "Dry run" }).click() }),
  "browser-mode": stage("Options with the browser hidden", () => runDialogClient(), "Options", { then: page => dialog(page).getByText("Hidden", { exact: true }).click() }),
} satisfies Record<OptionsControl, Story>;

/** What the operator sees of the PDFs a PDF workflow takes, from none chosen to a refused pick. */
type PdfInputState = "none" | "reading" | "selected" | "several" | "wrong-type" | "refused" | "upload-failed" | "choice-unpicked" | "choice-picked";
const pdfFile = (name: string, contents = "%PDF-1.4 story") => ({ name, mimeType: name.endsWith(".pdf") ? "application/pdf" : "text/plain", contents });
const attach = (...files: ReturnType<typeof pdfFile>[]) => async (page: Page) => { await dialog(page).locator('input[type="file"]').setInputFiles(files.map(({ name, mimeType, contents }) => ({ name, mimeType, buffer: Buffer.from(contents) }))); };
const pdfStage = (title: string, served: Partial<DashboardClient>, at: RunStartStage, then?: (page: Page) => Promise<void>): Story =>
  stage(title, () => runDialogClient({ uploadOcrSource: runDialogUpload, ...served }), at, { catalog: RUN_DIALOG_PDF_CATALOG, ...(then === undefined ? {} : { then }) });
const afterAttach = (...files: ReturnType<typeof pdfFile>[]) => async (page: Page) => { await attach(...files)(page); await dialog(page).getByText(/PDFs? selected|Choose valid|refused|could not/u).first().waitFor(); };
const PDF = {
  none: pdfStage("A PDF workflow, no PDFs chosen", {}, "Input"),
  reading: pdfStage("PDFs being read", { uploadOcrSource: never }, "Input", attach(pdfFile("first.pdf"))),
  selected: pdfStage("One PDF chosen", {}, "Input", afterAttach(pdfFile("first.pdf"))),
  several: pdfStage("Seven PDFs chosen, the list capped", {}, "Input", afterAttach(...Array.from({ length: 7 }, (_unused, index) => pdfFile(`scan-${index + 1}.pdf`, `%PDF-1.4 ${index}`)))),
  "wrong-type": pdfStage("A file that is not a PDF", {}, "Input", afterAttach(pdfFile("notes.txt"))),
  refused: pdfStage("A PDF the server side refuses (empty)", {}, "Input", afterAttach(pdfFile("empty.pdf", ""))),
  "upload-failed": pdfStage("A PDF whose upload failed", { uploadOcrSource: async () => { throw new DashboardClientError({ kind: "network", message: "offline", retryable: true }); } }, "Input", afterAttach(pdfFile("first.pdf"))),
  "choice-unpicked": pdfStage("Options, the required form choice not made", {}, "Input", async page => { await afterAttach(pdfFile("first.pdf"))(page); await press(page, "Continue"); await at(page, "Options"); }),
  "choice-picked": pdfStage("Options, OCR off and a form chosen", {}, "Input", async page => { await afterAttach(pdfFile("first.pdf"))(page); await press(page, "Continue"); await at(page, "Options");
    await dialog(page).getByRole("switch", { name: "Read with OCR" }).click(); await dialog(page).getByText("I-9", { exact: true }).click(); }),
} satisfies Record<PdfInputState, Story>;

/** What the dialog shows when the reference spreadsheets a workflow reads cannot be read or checked. */
type ReferenceState = "loading" | "catalog-failed" | "compatibility-failed" | "unchecked" | "check-loading" | "check-failed";
const unreadable = () => { throw new Error("The spreadsheets could not be read."); };
const reference = (title: string, served: Partial<DashboardClient>, catalog = RUN_DIALOG_REFERENCE_CATALOG, extra: Partial<Story> = {}): Story =>
  stage(title, () => runDialogClient({ workbookTypes: async () => [], ...served }), "Input", { catalog, ...extra });
const READING = { slowFetch: { region: '[aria-label="Loading reference data"]' } };
const REFERENCE = {
  loading: reference("Reference spreadsheets still loading", { workbookCatalog: never, workbookCompatibility: never }, RUN_DIALOG_REFERENCE_CATALOG, READING),
  "catalog-failed": reference("The spreadsheet list could not be read", { workbookCatalog: async () => unreadable(), workbookCompatibility: async () => ({ workflows: [], libraries: [] }) }),
  "compatibility-failed": reference("The spreadsheet check could not be read", { workbookCatalog: async () => [], workbookCompatibility: async () => unreadable() }),
  unchecked: reference("Relay has no spreadsheet check for the workflow", { workbookCatalog: async () => [], workbookCompatibility: async () => ({ workflows: [], libraries: [] }) }),
  "check-loading": reference("The optional check still loading", { workbookCatalog: never, workbookCompatibility: never }, RUN_DIALOG_CHECK_CATALOG, READING),
  "check-failed": reference("The optional check's list could not be read", { workbookCatalog: async () => unreadable(), workbookCompatibility: async () => ({ workflows: [], libraries: [] }) }, RUN_DIALOG_CHECK_CATALOG),
} satisfies Record<ReferenceState, Story>;

export const RUN_DIALOG_STORIES = defineSurface("run-dialog", {
  stage: STAGE, checks: CHECKS, "check-combination": CHECK_COMBINATION, "rerun-load": RERUN_LOAD, activity: ACTIVITY, refusal: REFUSAL, answer: ANSWER, recovery: RECOVERY, options: OPTIONS, pdf: PDF, reference: REFERENCE,
});
