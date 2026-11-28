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
import { ERROR_CATALOG } from "../../../../../../src/models/failures/error-catalog.js";
import type { StartRefusalCode } from "../../../../../../src/models/run/start-refusal.js";
import type { RunChecksState } from "../../../../../../src/dashboard/surfaces/run-start/run-checks-model.js";
import {
  RUN_DIALOG_ACTOR, RUN_DIALOG_APPLIED, RUN_DIALOG_CHECK_CATALOG, RUN_DIALOG_DRY_RUN_CATALOG, RUN_DIALOG_PDF_CATALOG, RUN_DIALOG_PDF_REFERENCE_CATALOG, RUN_DIALOG_REFERENCE_CATALOG, RUN_DIALOG_SAVED_ROWS_CATALOG, RUN_DIALOG_CRM, RUN_DIALOG_SEVERAL_SHEETS_CATALOG, runDialogUpload, RUN_DIALOG_CATALOG, RUN_DIALOG_CONFLICT, RUN_DIALOG_RERUN_CATALOG, RUN_DIALOG_RERUN_SOURCE, RUN_DIALOG_TYPED, RUN_DIALOG_WORKFLOW,
  never, runDialogClient, runDialogPlan, runDialogReadiness, runDialogRerunSnapshot, runDialogRerunWarning, runDialogWriteRerunSnapshot, runDialogWriteRerunWarning, RUN_DIALOG_WRITE_RERUN_CATALOG, RUN_DIALOG_WORK_STUDY, type ServedCheck,
  RUN_DIALOG_SEPARATIONS, RUN_DIALOG_SEPARATIONS_CATALOG, RUN_DIALOG_SEPARATIONS_TYPED, runDialogSeparationsRerunSnapshot,
} from "../../../../fixtures/dashboard/run-dialog-story-fixtures.js";
import { RUN_DIALOG_CRM_SHAPE, RUN_DIALOG_REFERENCE_READS, runDialogReferenceReads } from "../../../../fixtures/dashboard/run-dialog-reference-fixtures.js";
import { FIXTURE_CHATGPT_OCR_SIGNED_OUT } from "../../../../fixtures/dashboard/fixture-chatgpt-account.js";
import { buildWorkflowCatalog } from "../../../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { compileWorkflow } from "../../../../../../src/workflow-kit/workflow-definition.js";
import { onboardingWorkflow } from "../../../../../../src/workflows/onboarding/workflow.js";
import type { RunStartWorkflow } from "../../../../../../src/dashboard/surfaces/run-start/run-start.js";
import { defineSurface, type Story } from "../story-catalogue.js";
import { SceneBinding } from "./scene-binding.js";
import { StoryFrame } from "./story-frame.js";

const noop = () => undefined;

function DialogScene({ client, rerun, before, catalog = RUN_DIALOG_CATALOG, workflowId = RUN_DIALOG_WORKFLOW }: { client: DashboardClient; rerun?: boolean; before?: () => void; catalog?: typeof RUN_DIALOG_CATALOG; workflowId?: string }) {
  before?.();
  return <StoryFrame><DashboardClientProvider client={client}><SceneBinding>
    <RunStartDialog open onOpenChange={noop} catalog={catalog} panelWorkflowId={workflowId} actorId={RUN_DIALOG_ACTOR}
      onOpenIntake={noop} onFixCheck={noop} {...(rerun === true ? { rerunSource: RUN_DIALOG_RERUN_SOURCE } : {})} />
  </SceneBinding></DashboardClientProvider></StoryFrame>;
}

const dialog = (page: Page) => page.getByRole("dialog");
const press = (page: Page, name: string) => dialog(page).getByRole("button", { name, exact: true }).click();
const current = (page: Page) => dialog(page).locator('[aria-current="step"]');
const at = (page: Page, stage: string) => current(page).filter({ hasText: stage }).waitFor();

/** Where each kind of dialog goes by Next, in order. */
const START_PATH = ["Input", "Start"] as const;
const RERUN_PATH = ["Steps", "Start"] as const;
/** Types the input of a start, then presses Next until `stage` is current. */
async function reach(page: Page, stage: RunStartStage, rerun: boolean, typed = RUN_DIALOG_TYPED): Promise<void> {
  const path: readonly string[] = rerun ? RERUN_PATH : START_PATH;
  if (!rerun && stage !== "Input") await dialog(page).locator("textarea").first().fill(typed);
  await at(page, path[0] ?? "");
  for (const next of path.slice(1)) {
    if (stage === path[0]) return;
    if (path.indexOf(next) > path.indexOf(stage)) return;
    await press(page, "Next");
    await at(page, next);
    if (next === stage) return;
  }
}

interface SceneOptions { readonly catalog?: typeof RUN_DIALOG_CATALOG; readonly workflowId?: string; readonly typed?: string; readonly rerun?: boolean; readonly then?: (page: Page) => Promise<void>; readonly before?: () => void }
const scene = (title: string, client: () => DashboardClient, stage: RunStartStage, extra: Partial<Story> & SceneOptions = {}): Story => {
  const { rerun = false, then, before, catalog, workflowId, typed, ...story } = extra;
  return { title, render: () => <DialogScene client={client()} rerun={rerun} {...(catalog === undefined ? {} : { catalog })} {...(workflowId === undefined ? {} : { workflowId })} {...(before === undefined ? {} : { before })} />, ready: '[role="dialog"]',
    play: async page => { await reach(page, stage, rerun, typed); await then?.(page);
      // The pointer rests on the button just pressed, which would draw its hover fill.
      await page.mouse.move(0, 0); }, ...story };
};
const reading = (...checks: ServedCheck[]) => () => runDialogClient({ readPreflight: async () => runDialogReadiness(checks) });
const PASS: ServedCheck = { check: PreflightCheckIdSchema.parse("config.valid"), status: "pass" };
const WARN: ServedCheck = { check: PreflightCheckIdSchema.parse("provider.census"), status: "warning", summary: "The address lookup is slow." };
const FIXABLE: ServedCheck = { check: PreflightCheckIdSchema.parse("secrets.ucpath-sso"), status: "fail", summary: "The UCPath password is missing." };
const UNFIXABLE: ServedCheck = { check: PreflightCheckIdSchema.parse("filesystem.health"), status: "fail", summary: "Relay is out of disk space." };
const rerunClient = (served: Partial<DashboardClient> = {}, outcome: "failed" | "done" = "failed") => () => runDialogClient({ rerunValues: async () => runDialogRerunSnapshot(outcome), previewRerunWarnings: async () => runDialogRerunWarning(false), ...served });
const writeRerunClient = (served: Partial<DashboardClient> = {}) => () => runDialogClient({ rerunValues: async () => runDialogWriteRerunSnapshot(), previewRerunWarnings: async () => runDialogRerunWarning(false), ...served });
const planning = (served: Partial<DashboardClient> = {}) => () => runDialogClient({ submitStartPlan: async () => runDialogPlan(), executeCommand: async () => RUN_DIALOG_APPLIED, ...served });
const start = (page: Page) => press(page, "Start run");

const stage = scene;
const WORK_STUDY_RERUN = { catalog: RUN_DIALOG_WRITE_RERUN_CATALOG, workflowId: RUN_DIALOG_WORK_STUDY } as const;

const customizeSteps = (page: Page) => dialog(page).getByRole("switch", { name: "Customize steps" }).click();

const STAGE = {
  Input: stage("Input, nothing typed", () => runDialogClient(), "Input"),
  RerunSteps: stage("A rerun's Steps, each step as the source ended", rerunClient(), "Steps", { rerun: true, catalog: RUN_DIALOG_RERUN_CATALOG }),
  Warning: stage("A succeeded write run's rerun, warned that the source already filed", rerunClient({ previewRerunWarnings: async () => runDialogRerunWarning() }, "done"), "Steps", { rerun: true, catalog: RUN_DIALOG_RERUN_CATALOG,
    then: async page => { await press(page, "Next"); await press(page, "Start run"); await dialog(page).getByText("already submitted").waitFor(); } }),
  Start: stage("Start, options and checks, every check ready", reading(PASS), "Start"),
  StartCustomized: stage("Start with Customize steps on, Next to Steps", reading(PASS), "Start", { then: customizeSteps }),
  StartSteps: stage("A customized start's Steps, the last page", reading(PASS), "Start", {
    then: async page => { await customizeSteps(page); await press(page, "Next"); await at(page, "Steps"); } }),
  RerunStart: stage("A rerun's Start, options and checks", rerunClient(), "Start", { rerun: true, catalog: RUN_DIALOG_RERUN_CATALOG }),
  CancelledSteps: stage("A Work-Study run cancelled after it filed, with both switches on by default", writeRerunClient(), "Steps", { rerun: true, ...WORK_STUDY_RERUN }),
  CancelledReceipts: stage("That rerun's Start, naming the receipt the source already filed", writeRerunClient(), "Start", { rerun: true, ...WORK_STUDY_RERUN }),
  CancelledWarning: stage("That rerun warned before its filing step files again", writeRerunClient({ previewRerunWarnings: async () => runDialogWriteRerunWarning() }), "Start", { rerun: true, ...WORK_STUDY_RERUN,
    then: async page => { await press(page, "Start live run"); await dialog(page).getByText("already submitted").waitFor(); } }),
} satisfies Record<string, Story>;

const CHECKS = {
  checking: stage("Checks still being read", () => runDialogClient({ readPreflight: never }), "Start"),
  ready: stage("Checks with a warning", reading(PASS, WARN), "Start"),
  unavailable: stage("Checks that could not be read", () => runDialogClient({ readPreflight: async () => ({ state: "unavailable", reason: "The runtime is restarting." }) }), "Start"),
} satisfies Record<RunChecksState["state"], Story>;

const CHECK_COMBINATION = {
  "fixable-failure": stage("A failed check with a Fix button", reading(PASS, FIXABLE), "Start"),
  "unfixable-failure": stage("A failed check with no Fix button", reading(UNFIXABLE, PASS), "Start"),
  "failure-and-warning": stage("A failed check and a warning together", reading(FIXABLE, WARN, PASS), "Start"),
  "duo-key-missing": stage("A missing Duo key blocks Start", reading({ check: PreflightCheckIdSchema.parse("browser.duo-key"), status: "fail",
    summary: ERROR_CATALOG.DUO_READY_CREDENTIAL_REQUIRED.text }), "Start", { ready: '[data-run-check-fix="browser.duo-key"]' }),
} satisfies Record<string, Story>;

const RERUN_LOAD = {
  loading: stage("A rerun reading its source", () => runDialogClient({ rerunValues: never }), "Steps", { rerun: true }),
  failed: stage("A rerun whose source could not be read", () => runDialogClient({ rerunValues: async () => { throw new Error("The source run could not be read."); } }), "Steps", { rerun: true }),
  ready: stage("A rerun with its source read", rerunClient(), "Steps", { rerun: true, catalog: RUN_DIALOG_RERUN_CATALOG }),
} satisfies Record<RerunLoad["state"], Story>;

const ACTIVITY = {
  planning: stage("Start pressed, the plan being built", planning({ submitStartPlan: never }), "Start", { then: start }),
  "checking-warnings": stage("A rerun looking for repeat warnings", rerunClient({ previewRerunWarnings: never }), "Steps", { rerun: true, then: async page => { await press(page, "Next"); await press(page, "Start run"); } }),
  submitting: stage("The plan sent, waiting on the answer", planning({ executeCommand: never }), "Start", { then: start }),
  replanning: stage("An expired plan being built again", planning({ executeCommand: async () => CommandResultSchema.parse({ state: "rejected", commandId: "3a000000-0000-4000-8000-000000000003",
    code: "RUN_START_PLAN_EXPIRED", message: "The plan expired." }), submitStartPlan: never }), "Start", { then: start }),
} satisfies Record<Exclude<LaunchActivity["kind"], "idle">, Story>;

const REFUSAL_COPY: Readonly<Record<StartRefusalCode, string>> = {
  "input-invalid": "The employee number is not valid.", "active-run-exists": "A run for this person is already going.",
  "dry-run-unsupported": "This workflow cannot do a dry run.", "preflight-failed": "A check failed.", "capability-unavailable": "This workflow is not available.",
};
const refusal = (code: StartRefusalCode): Story => stage(REFUSAL_COPY[code], planning({ submitStartPlan: async () => ({ ...runDialogPlan(), planned: [], refused: [{ entry: 1, code, message: REFUSAL_COPY[code] }] }) }), "Start", { then: start });
const REFUSAL = {
  "input-invalid": refusal("input-invalid"), "active-run-exists": refusal("active-run-exists"), "dry-run-unsupported": refusal("dry-run-unsupported"),
  "preflight-failed": refusal("preflight-failed"), "capability-unavailable": refusal("capability-unavailable"),
} satisfies Record<StartRefusalCode, Story>;

const ANSWER = {
  conflict: stage("The start answered with a version conflict", planning({ executeCommand: async () => RUN_DIALOG_CONFLICT }), "Start", { then: start }),
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
  priority: stage("Options with Priority switched off", () => runDialogClient(), "Start", { then: page => dialog(page).getByRole("switch", { name: "Priority" }).click() }),
  "dry-run": stage("Options with Dry run switched on", () => runDialogClient(), "Start", { catalog: RUN_DIALOG_DRY_RUN_CATALOG, then: page => dialog(page).getByRole("switch", { name: "Dry run" }).click() }),
  "browser-mode": stage("Options with the browser hidden", () => runDialogClient(), "Start", { then: page => dialog(page).getByText("Hidden", { exact: true }).click() }),
} satisfies Record<OptionsControl, Story>;

/** What the operator sees of the PDFs a PDF workflow takes, from none chosen to a refused pick. */
type PdfInputState = "none" | "reading" | "selected" | "several" | "wrong-type" | "refused" | "upload-failed" | "choice-unpicked" | "choice-picked" | "ocr-unavailable";
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
  "choice-unpicked": pdfStage("Options, the required form choice not made", {}, "Input", async page => { await afterAttach(pdfFile("first.pdf"))(page); await press(page, "Next"); await at(page, "Start"); }),
  "choice-picked": pdfStage("Options, OCR off and a form chosen", {}, "Input", async page => { await afterAttach(pdfFile("first.pdf"))(page); await press(page, "Next"); await at(page, "Start");
    await dialog(page).getByRole("switch", { name: "Read with OCR" }).click(); await dialog(page).getByText("I-9", { exact: true }).click(); }),
  "ocr-unavailable": pdfStage("Start blocked by a disconnected OCR account", { checkChatGptAccount: async () => FIXTURE_CHATGPT_OCR_SIGNED_OUT }, "Input", async page => {
    await afterAttach(pdfFile("first.pdf"))(page);
    await press(page, "Next");
    await at(page, "Start");
    await dialog(page).getByText("I-9", { exact: true }).click();
    await dialog(page).getByText(ERROR_CATALOG.PROVIDER_UNAVAILABLE.text, { exact: true }).waitFor();
    // Begin the gallery's Tab walk before the radio groups.
    await dialog(page).focus();
  }),
} satisfies Record<PdfInputState, Story>;

/** What the dialog shows when the reference spreadsheets a workflow reads cannot be read or checked. */
type ReferenceState = "none-added" | "pdfs-none-added" | "loading" | "catalog-failed" | "compatibility-failed" | "unchecked" | "check-loading" | "check-failed" | "chosen" | "version-chosen" | "spreadsheet-menu" | "long-name-menu" | "worksheet-menu" | "one-of-several" | "three-worksheets" | "several-menu" | "two-start" | "two-rerun" | "start";
const unreadable = () => { throw new Error("The spreadsheets could not be read."); };
const reference = (title: string, served: Partial<DashboardClient>, catalog = RUN_DIALOG_REFERENCE_CATALOG, extra: Partial<Story> & SceneOptions = {}): Story =>
  stage(title, () => runDialogClient({ workbookTypes: async () => [], ...served }), "Input", { catalog, ...extra });
const READING = { slowFetch: { region: '[aria-label="Loading reference data"]' } };
const chooseRoster = async (page: Page) => {
  await dialog(page).getByRole("button", { name: /Add spreadsheet|Change spreadsheet/u }).click();
  await page.getByRole("searchbox", { name: "Find a spreadsheet" }).fill("Roster");
  await page.getByRole("menuitem").filter({ hasText: "Roster" }).first().click();
  await dialog(page).getByText("Roster").first().waitFor();
};
const SHEETS = ["Oct. 19", "Oct 26", "Nov 2", "Nov 9", "Nov. 16", "Nov. 30"];
const worksheetSearch = (page: Page) => page.getByRole("searchbox", { name: "Find a worksheet" });
const chooseThree = async (page: Page) => { await chooseRoster(page);
  await dialog(page).getByRole("button", { name: /worksheets, /u }).click(); await worksheetSearch(page).waitFor();
  for (const name of ["Nov. 16", "Nov 9"]) await page.getByRole("menuitemcheckbox", { name }).click(); };
const several = (title: string, then: (page: Page) => Promise<void>) => reference(title, runDialogReferenceReads(SHEETS, "onboarding-roster", RUN_DIALOG_CRM_SHAPE), RUN_DIALOG_SEVERAL_SHEETS_CATALOG, { then, workflowId: RUN_DIALOG_CRM });
const onboarding = compileWorkflow(onboardingWorkflow).descriptor;
const onboardingReference = onboarding.workbookReference, onboardingInput = onboarding.surfaces.inputRun;
if (onboardingReference === undefined || onboardingInput === undefined) throw new Error("The Onboarding story requires saved roster input");
const onboardingFlow: RunStartWorkflow = {
  workflowId: onboarding.id, label: onboarding.label, categoryId: onboarding.category, role: onboardingWorkflow.role, icon: onboarding.icon,
  enqueue: onboarding.enqueue, version: onboarding.version, spreadsheetIntake: false, requiredWorkbookFields: onboarding.requiredWorkbookFields,
  workbookReference: onboardingReference, inputRun: { state: "present", surface: onboardingInput },
  steps: onboarding.timeline.map(({ key, label }) => ({ key, label, includedByDefault: true, control: { state: "required", reason: "This workflow requires every node in this step." } })),
};
const onboardingCatalog = buildWorkflowCatalog([onboardingFlow], { [onboarding.id]: "served" });
const onboardingReads = runDialogReferenceReads(["People", "Archive"], onboardingReference.id, {
  workflowId: onboarding.id, label: onboarding.label, keyFieldId: onboardingReference.keyFieldId,
  fields: onboarding.requiredWorkbookFields, writableFields: onboardingReference.writableFields,
  row: ["hire@example.test", "Example Hire", null, null, null],
});
const twoWorksheetPicker = (page: Page) => dialog(page).getByRole("button", { name: "Roster worksheets, 2 worksheets" });
const waitForTwoWorksheets = async (page: Page) => {
  for (const name of ["People", "Archive"]) {
    await page.getByRole("menuitemcheckbox", { name, checked: true }).waitFor();
  }
};
export const LONG_NAME = "Roster of all onboarding and separation candidates for the fall quarter 2026 final reviewed edition v3 (do not edit).xlsx";
const REFERENCE = {
  "none-added": reference("The reference field before any spreadsheet is picked", RUN_DIALOG_REFERENCE_READS),
  "pdfs-none-added": reference("PDFs chosen, the reference field still empty", { ...RUN_DIALOG_REFERENCE_READS, uploadOcrSource: runDialogUpload }, RUN_DIALOG_PDF_REFERENCE_CATALOG, { then: afterAttach(pdfFile("first.pdf"), pdfFile("second.pdf", "%PDF-1.4 two")) }),
  loading: reference("Reference spreadsheets still loading", { workbookCatalog: never, workbookCompatibility: never }, RUN_DIALOG_REFERENCE_CATALOG, READING),
  "catalog-failed": reference("The spreadsheet list could not be read", { workbookCatalog: async () => unreadable(), workbookCompatibility: async () => ({ workflows: [], libraries: [] }) }),
  "compatibility-failed": reference("The spreadsheet check could not be read", { workbookCatalog: async () => [], workbookCompatibility: async () => unreadable() }),
  unchecked: reference("Relay has no spreadsheet check for the workflow", { workbookCatalog: async () => [], workbookCompatibility: async () => ({ workflows: [], libraries: [] }) }),
  "check-loading": reference("The optional check still loading", { workbookCatalog: never, workbookCompatibility: never }, RUN_DIALOG_CHECK_CATALOG, READING),
  "check-failed": reference("The optional check's list could not be read", { workbookCatalog: async () => unreadable(), workbookCompatibility: async () => ({ workflows: [], libraries: [] }) }, RUN_DIALOG_CHECK_CATALOG),
  chosen: reference("A saved spreadsheet chosen for the reference field", RUN_DIALOG_REFERENCE_READS, RUN_DIALOG_REFERENCE_CATALOG, { then: chooseRoster }),
  "version-chosen": reference("A saved spreadsheet with an earlier named version chosen", runDialogReferenceReads(["First"], "roster-type", undefined, "Roster", true), RUN_DIALOG_REFERENCE_CATALOG, { then: async page => { await chooseRoster(page);
    await dialog(page).getByRole("combobox", { name: "Roster version" }).click(); await page.getByRole("option", { name: /Before audit/u }).click(); await dialog(page).getByRole("combobox", { name: "Roster version" }).filter({ hasText: "Before audit" }).waitFor(); } }),
  "spreadsheet-menu": reference("The Add spreadsheet menu open, searching Roster", RUN_DIALOG_REFERENCE_READS, RUN_DIALOG_REFERENCE_CATALOG, { knownFailures: { "named-and-focusable": "#532" }, then: async page => {
    await dialog(page).getByRole("button", { name: /Add spreadsheet|Change spreadsheet/u }).click(); await page.getByRole("searchbox", { name: "Find a spreadsheet" }).fill("Roster"); await page.getByRole("menuitem").filter({ hasText: "Roster" }).first().waitFor(); } }),
  "long-name-menu": reference("The Add spreadsheet menu open on a spreadsheet with a very long name", runDialogReferenceReads(["First"], "roster-type", undefined, LONG_NAME), RUN_DIALOG_REFERENCE_CATALOG, { knownFailures: { "named-and-focusable": "#532" }, then: async page => {
    await dialog(page).getByRole("button", { name: /Add spreadsheet|Change spreadsheet/u }).click(); await page.getByRole("searchbox", { name: "Find a spreadsheet" }).fill("Roster"); await page.getByRole("menuitem").filter({ hasText: "Roster" }).first().waitFor(); } }),
  "worksheet-menu": reference("The chosen spreadsheet's worksheet menu open", runDialogReferenceReads(SHEETS), RUN_DIALOG_REFERENCE_CATALOG, { then: async page => { await chooseRoster(page);
    await dialog(page).getByRole("button", { name: /worksheets, /u }).click(); await page.getByRole("searchbox", { name: "Find a worksheet" }).waitFor(); } }),
  "one-of-several": several("A reference that takes several worksheets, one chosen", chooseRoster),
  "three-worksheets": several("Three reference worksheets chosen, the menu closed", async page => { await chooseThree(page); await page.keyboard.press("Escape"); await worksheetSearch(page).waitFor({ state: "hidden" }); }),
  "several-menu": several("The worksheet menu of a several-worksheet reference, three checked", chooseThree),
  "two-start": reference("Onboarding Start with People and Archive selected", onboardingReads, onboardingCatalog, { workflowId: onboarding.id, then: async page => {
    await chooseRoster(page);
    await dialog(page).getByRole("button", { name: "Roster worksheets, Archive" }).click();
    await page.getByRole("menuitemcheckbox", { name: "People" }).click();
    await waitForTwoWorksheets(page);
  } }),
  "two-rerun": stage("Onboarding Rerun with both retained worksheets shown", () => runDialogClient({ ...onboardingReads, rerunValues: async () => ({
    state: "available", snapshot: {
      source: { runId: RUN_DIALOG_RERUN_SOURCE.runId, version: RUN_DIALOG_RERUN_SOURCE.expectedVersion, workflow: onboarding.id,
        descriptorVersion: onboarding.version, contractFingerprint: onboarding.contractFingerprint, outcome: "failed", dryRun: false, priority: "interactive", browserMode: "headless" },
      sourceInput: { state: "available", value: { email: "hire@example.test", mode: "new-hire" } }, values: [], transactions: [],
      spreadsheets: ["first", "sheet-1"].map(sheetId => ({ typeId: onboardingReference.id, libraryId: "roster", versionId: "version", sheetId })),
      steps: onboarding.timeline.map(({ key, nodes }) => ({ key, state: "unfinished", nodes: nodes.map(({ id }) => ({ nodeId: id, state: "unfinished", reason: "not-recorded" })) })),
    },
  }) }), "Steps", { catalog: onboardingCatalog, workflowId: onboarding.id, rerun: true, then: async page => {
    await twoWorksheetPicker(page).click();
    await waitForTwoWorksheets(page);
  } }),
  start: reference("Start, with the chosen spreadsheet", RUN_DIALOG_REFERENCE_READS, RUN_DIALOG_REFERENCE_CATALOG, { then: async page => { await chooseRoster(page); await dialog(page).locator("textarea").first().fill(RUN_DIALOG_TYPED); await press(page, "Next"); await at(page, "Start"); } }),
} satisfies Record<ReferenceState, Story>;

/** Saved onboarding rows: the spreadsheet is listed and checked, but the version behind its row list cannot be read. */
const rowsFailing = (): Partial<DashboardClient> => ({ ...RUN_DIALOG_REFERENCE_READS, workbookLibraryVersion: async () => unreadable() });
const SAVED_ROWS = {
  unavailable: reference("Saved rows that could not be read", rowsFailing(), RUN_DIALOG_SAVED_ROWS_CATALOG, { then: chooseRoster, ready: 'text="Couldn\'t read the rows of Roster (Reviewed): This could not load."' }),
} satisfies Record<"unavailable", Story>;

const SEPARATIONS_FLOW = { catalog: RUN_DIALOG_SEPARATIONS_CATALOG, workflowId: RUN_DIALOG_SEPARATIONS, typed: RUN_DIALOG_SEPARATIONS_TYPED } as const;
const toggle = (page: Page, name: string) => dialog(page).getByRole("switch", { name: `Include ${name}`, exact: true }).click();
/** Separations Steps on a customized start, with the named rows switched off in order. */
const separationsSteps = (title: string, off: readonly string[]): Story => stage(title, reading(PASS), "Start", { ...SEPARATIONS_FLOW,
  then: async page => { await customizeSteps(page); await press(page, "Next"); await at(page, "Steps"); for (const name of off) await toggle(page, name); } });
const SEPARATIONS_STEPS = {
  "all-on": separationsSteps("Separations Steps: every step on and switchable", []),
  "read-off": separationsSteps("Read Kuali document off: its values and the reads it feeds open; Finalize waits to be turned off", ["Read Kuali document"]),
  "approval-off": separationsSteps("Approve identity off: the run's Employee ID typed as the approval", ["Approve identity"]),
  "by-hand": separationsSteps("Form actions done by hand: pending check, submit and finalize off", ["Check pending termination", "Submit termination", "Finalize Kuali document"]),
  rerun: stage("A Separations rerun: timecard typed, UCPath done by hand, finalize failed", () => runDialogClient({ rerunValues: async () => runDialogSeparationsRerunSnapshot(),
    previewRerunWarnings: async () => runDialogRerunWarning(false) }), "Steps", { rerun: true, catalog: RUN_DIALOG_SEPARATIONS_CATALOG, workflowId: RUN_DIALOG_SEPARATIONS }),
} satisfies Record<string, Story>;

export const RUN_DIALOG_STORIES = defineSurface("run-dialog", {
  "separations-steps": SEPARATIONS_STEPS,
  stage: STAGE, checks: CHECKS, "check-combination": CHECK_COMBINATION, "rerun-load": RERUN_LOAD, activity: ACTIVITY, refusal: REFUSAL, answer: ANSWER, recovery: RECOVERY, options: OPTIONS, pdf: PDF, reference: REFERENCE, "saved-rows": SAVED_ROWS,
});
