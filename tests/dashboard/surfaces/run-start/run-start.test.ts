// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { afterEach, describe, it, onTestFinished } from "vitest";
import { StartPlanRequestSchema as StartPlanSubmissionSchema, type StartPlanWire as StartPlanResponse, StartPlanWireSchema as StartPlanResponseSchema } from "../../../../src/models/dashboard/start-plan.js";
import { type CommandResult } from "../../../../src/rules/commands/commands.js";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";
import { type DashboardClient } from "../../../../src/dashboard/client/index.js";
import { START_DOOR_ABSENCE } from "../../../../src/dashboard/surfaces/run-start/run-start-model.js";
import { type RunStartWorkflow } from "../../../../src/dashboard/surfaces/run-start/run-start.js";
import { parseWorkflows } from "../../../../src/dashboard/surfaces/shell/shell-model.js";
import { FIXTURE_START_PICKER_BOOTSTRAP } from "../../../support/helpers/dashboard/mock-world/fixture-day.js";

{
const { cleanup, openDialog, stubClient, WORKFLOW_ID, TYPED, WORKFLOWS, APPLIED, CONFLICT, planResponse, planIsDrawn, reachResult, closed, intakeHandoffs, settle, buttons, buttonName } = createRunStartDialogHarness();


it("reveals the launched workflow after an applied start", async () => {
  onTestFinished(cleanup);
  const revealed: string[] = [];
  const client = stubClient({
    submitStartPlan: async () => planResponse("5a000000-0000-4000-8000-000000000001"),
    executeCommand: async () => APPLIED,
  });
  const dialog = await openDialog(client, undefined, (workflowId) => revealed.push(workflowId));
  await dialog.type(TYPED);
  await dialog.press("Next");
  assert.deepEqual(revealed, []);
  await dialog.press("Start run");
  assert.deepEqual(revealed, [WORKFLOW_ID]);
  assert.deepEqual(closed, [false], "a confirmed start must dismiss the modal");
  assert.equal(window.sessionStorage.length, 0, "an applied submission must clear durable recovery");
  assert.ok(!dialog.text().includes("Start applied"));
});

it("keeps the current view after a refused start", async () => {
  onTestFinished(cleanup);
  const revealed: string[] = [];
  const dialog = await openDialog(stubClient({
    submitStartPlan: async () => planResponse("5a000000-0000-4000-8000-000000000001"),
    executeCommand: async () => CONFLICT,
  }), undefined, (workflowId) => revealed.push(workflowId));
  await dialog.type(TYPED);
  await dialog.press("Next");
  await dialog.press("Start run");
  assert.deepEqual(revealed, []);
});

it("Enter advances and starts, Shift+Enter keeps its newline, buttons keep their own Enter", async () => {
  onTestFinished(cleanup);
  const revealed: string[] = [];
  const dialog = await openDialog(stubClient({
    submitStartPlan: async () => planResponse("5a000000-0000-4000-8000-000000000001"),
    executeCommand: async () => APPLIED,
  }), undefined, (workflowId) => revealed.push(workflowId));
  assert.equal(await dialog.enter(), false, "Enter does nothing while Continue is unavailable");
  await dialog.type(TYPED);
  assert.doesNotMatch(dialog.text(), /Enter to/u, "the footer names no shortcut");
  assert.equal(await dialog.enter({ shift: true }), false, "Shift+Enter keeps its newline");
  assert.equal(dialog.stage(), "Input");
  const close = buttons().find(button => button.getAttribute("aria-label") === "Close");
  assert.ok(close);
  assert.equal(await dialog.enter({ on: close }), false, "a focused button keeps its Enter");
  assert.equal(await dialog.enter(), true);
  assert.equal(dialog.stage(), "Start");
  for (let wait = 0; wait < 6; wait += 1) await settle();
  assert.doesNotMatch(dialog.text(), /Enter to/u);
  assert.deepEqual(revealed, []);
  await dialog.enter({ on: document.body });
  assert.deepEqual(revealed, [WORKFLOW_ID]);
});

describe("a settlement and the request it answers", () => {
  afterEach(cleanup);

  it("does not land a plan for text the operator has already edited away", async () => {

    let release: ((plan: StartPlanResponse) => void) | undefined;
    const dialog = await openDialog(stubClient({
      submitStartPlan: async () => new Promise<StartPlanResponse>((resolve) => {
        release = resolve;
      }),
      executeCommand: async () => {
        throw new Error("no command may be sent while a plan is in flight");
      },
    }));

    await dialog.type(TYPED);
    await dialog.press("Next");
    await dialog.press("Start run");
    const settlePlan = release;
    assert.ok(settlePlan !== undefined, "the dialog never called submitStartPlan");

    await dialog.press("1 Input");
    await dialog.type("10873698; Battistessa, Johnnie");

    await act(async () => {
      settlePlan(planResponse("5a000000-0000-4000-8000-000000000001"));
      await Promise.resolve();
    });
    await settle();

    assert.ok(!planIsDrawn(), "a superseded plan landed on the edited form");
    assert.equal(dialog.stage(), "Input");
  });

  it("offers no way back to edit a plan whose command is out, and lands its reply", async () => {

    let release: ((result: CommandResult) => void) | undefined;
    const dialog = await openDialog(stubClient({
      submitStartPlan: async () => planResponse("5a000000-0000-4000-8000-000000000001"),
      executeCommand: async () => new Promise<CommandResult>((resolve) => {
        release = resolve;
      }),
    }));

    await dialog.type(TYPED);
    await dialog.press("Next");
    await dialog.press("Start run");
    const settleCommand = release;
    assert.ok(settleCommand !== undefined, "the dialog never called executeCommand");

    assert.equal(dialog.disabled("1 Input"), true);
    await dialog.press("1 Input");
    assert.equal(dialog.stage(), "Start");

    await act(async () => {
      settleCommand(APPLIED);
      await Promise.resolve();
    });
    for (let wait = 0; wait < 4; wait += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

    assert.deepEqual(closed, [false], "the applied reply closed the dialog");
  });
});

describe("a plan with a refused entry", () => {
  afterEach(cleanup);

  it("starts by neither the button nor Enter until it is fixed", async () => {
    const commands: unknown[] = [];
    const dialog = await openDialog(stubClient({
      submitStartPlan: async () => ({ ...planResponse("5a000000-0000-4000-8000-000000000001"), priority: "bulk", refused: [{ entry: 2, code: "input-invalid", message: "Bad row." }] }),
      executeCommand: async command => { commands.push(command); return APPLIED; },
    }));
    await dialog.type(`${TYPED}\n10873699`);
    await dialog.press("Start run");
    for (let wait = 0; wait < 6; wait += 1) await settle();
    assert.ok(planIsDrawn(), "the plan never rendered");
    assert.equal(dialog.disabled("Start run"), true);
    assert.equal(await dialog.enter({ on: document.body }), false, "Enter does what the button does: nothing");
    for (let wait = 0; wait < 6; wait += 1) await settle();
    assert.deepEqual(commands, []);
    assert.ok(!dialog.text().includes("Enter to start"));
  });
});

describe("a plan outlives nothing that shaped it, in the dialog", () => {
  afterEach(cleanup);

  it.each([false, true])("drops the plan for every choice and switch on the last page (Customize steps %s)", async customize => {
    const workflow = WORKFLOWS.find(entry => entry.workflowId === WORKFLOW_ID);
    assert.ok(workflow?.inputRun.state === "present");
    const dryRuns = { ...workflow, inputRun: { ...workflow.inputRun, surface: { ...workflow.inputRun.surface, supportsDryRun: true } } };
    const offered = () => [...document.querySelectorAll<HTMLInputElement>('.launch-content :is(input[type="radio"], [role="switch"], [role="checkbox"])')]
      .filter(node => !node.matches(":disabled") && !(node.type === "radio" && node.checked));
    const planned = async () => {
      const dialog = await openDialog(stubClient({
        submitStartPlan: async () => ({ ...planResponse("5a000000-0000-4000-8000-000000000001"), planned: [], refused: [{ entry: 1, code: "input-invalid", message: "Bad row." }] }),
      }), { workflows: [dryRuns], panelWorkflowId: WORKFLOW_ID });
      await dialog.type(TYPED);
      await dialog.press("Next");
      if (customize) { await dialog.press("Customize steps"); await dialog.press("Next"); }
      for (let wait = 0; wait < 6; wait += 1) await settle();
      await dialog.press("Start live run");
      for (let wait = 0; wait < 6; wait += 1) await settle();
      assert.ok(planIsDrawn(), "the plan never rendered");
      return offered();
    };
    const count = (await planned()).length;
    assert.ok(count >= (customize ? 1 : 4), `the steps, or Customize steps, Dry run, Priority and Browser mode: ${String(count)}`);
    for (let index = 0; index < count; index += 1) {
      await cleanup();
      const node = (await planned())[index];
      await act(async () => node.click());
      await settle();
      assert.ok(!planIsDrawn(), `the plan survived ${node.getAttribute("aria-label") ?? node.closest("label")?.textContent ?? node.outerHTML}`);
    }
  });

  it("drops the plan when a run control moves under it", async () => {

    const dialog = await openDialog(stubClient({
      submitStartPlan: async () => ({ ...planResponse("5a000000-0000-4000-8000-000000000001"), priority: "bulk", refused: [{ entry: 2, code: "input-invalid", message: "Bad row." }] }),
    }));
    await dialog.type(`${TYPED}\n10873699`);
    await dialog.press("Next");
    assert.equal(dialog.stage(), "Start");
    await dialog.press("Start run");
    assert.ok(planIsDrawn(), "the plan never rendered");

    await dialog.choosePriority("interactive");

    assert.ok(!planIsDrawn(), "the plan survived a control that re-fingerprints the request");
    assert.equal(dialog.stage(), "Start");
  });


});

describe("keeps optional steps and removes only the per-start destination", () => {
  afterEach(cleanup);

  it("keeps Options and the Steps page while omitting destination controls", async () => {
    let submitted: unknown;
    const dialog = await openDialog(stubClient({
      submitStartPlan: async (input) => {
        submitted = input;
        return planResponse("5a000000-0000-4000-8000-000000000001");
      },
    }));

    await dialog.type(TYPED);
    await dialog.press("Next");
    assert.equal(dialog.stage(), "Start");
    assert.ok(dialog.text().includes("Customize steps"));
    assert.ok(!dialog.text().includes("CRM Dates"), "Steps show only once Customize steps is on");
    assert.ok(!dialog.text().includes("Destination"));
    assert.ok(!dialog.text().includes("Test instance"));
    assert.ok(dialog.text().includes("Runs before bulk batches."));
    assert.equal(document.querySelectorAll('input[type="radio"][name^="Browser mode-"]').length, 2);
    assert.doesNotMatch(dialog.text(), /Active policy|Workflow version|Fixed by the selected workflow/u);
    const selectedWorkflow = document.body.querySelector('nav[aria-label="Workflow"] button[aria-current="page"]');
    const workflow = WORKFLOWS.find((candidate) => candidate.workflowId === WORKFLOW_ID);
    assert.ok(workflow !== undefined);
    assert.ok(selectedWorkflow?.textContent?.includes(workflow.label), "the desktop picker must identify the selected workflow");
    assert.equal(
      document.body.querySelectorAll("select:disabled").length,
      0,
      "fixed workflow facts must not draw disabled dropdowns",
    );

    await dialog.press("Customize steps");
    await dialog.press("Next");
    assert.equal(dialog.stage(), "Steps");
    assert.ok(dialog.text().includes("CRM Dates"), "the optional step disappeared");
    await dialog.press("CRM Dates");
    await dialog.press("Start run");
    assert.equal(dialog.stage(), "Steps");
    assert.ok(!dialog.text().includes("Destination"));
    assert.ok(!dialog.text().includes("Test instance"));
    assert.ok(!dialog.text().includes("Test destination"));
    assert.ok(!dialog.text().toLowerCase().includes("test ·"), "the last stage still draws a test-target badge");

    assert.ok(typeof submitted === "object" && submitted !== null, "the dialog never requested a start plan");
    assert.equal(
      Object.hasOwn(submitted, "requestedInstance"),
      false,
      "the dashboard request still carries requestedInstance",
    );
    const request = StartPlanSubmissionSchema.parse(submitted);
    assert.deepEqual(
      request.selectedStepKeys,
      ["searching", "cross-verify", "active-status", "crm-dates"],
      "Customize steps sent stale/default keys instead of the operator's exact selection",
    );
  });
});

describe("browser presentation is an immutable Run Options choice", () => {
  afterEach(cleanup);

  it("offers both modes, defaults to headed with required screenshots, and submits an explicit browser override", async () => {
    let submitted: unknown;
    const dialog = await openDialog(stubClient({ submitStartPlan: async (input) => {
      submitted = input;
      return planResponse("5a000000-0000-4000-8000-000000000001");
    } }));
    await dialog.type(TYPED);
    await dialog.press("Next");
    const modes = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"][name^="Browser mode-"]')];
    assert.deepEqual(modes.map(mode => mode.value), ["headed", "headless"]);
    assert.equal(modes.find(mode => mode.value === "headed")?.checked, true);
    const screenshotControl = buttons().find(button => buttonName(button) === "Capture screenshots");
    assert.equal(screenshotControl === undefined, true, "Required screenshots must not have an off control");
    assert.ok(!dialog.text().includes("Always on"), "the Screenshots row is gone");
    assert.ok(!dialog.text().includes("Screenshots"), "the Screenshots row is gone");
    await dialog.chooseBrowserMode("headless");
    await dialog.press("Start run");
    const request = StartPlanSubmissionSchema.parse(submitted);
    assert.equal(request.browserMode, "headless");
    assert.equal(request.captureBrowserScreenshots, true);
  });
});

describe("the compact confirmation keeps the exact input basis", () => {
  afterEach(cleanup);

  it("summarizes what was typed after the result settles", async () => {
    const dialog = await reachResult();
    assert.equal(closed.at(-1), false);
    assert.equal(dialog.typedInput().value, TYPED);
  });

});

describe("a terminal refusal closes and invalidates the plan", () => {
  afterEach(cleanup);
  it("closes with the typed draft intact and no terminal panel", async () => {
    const dialog = await reachResult();
    assert.equal(closed.at(-1), false);
    assert.equal(dialog.stage(), "Input");
    assert.equal(planIsDrawn(), false);
    assert.equal(dialog.typedInput().value, TYPED);
    assert.equal(window.sessionStorage.length, 0);
    assert.equal(dialog.text().includes("The start plan moved under this form"), false);
  });
});

describe("spreadsheet registration stays outside Run", () => {
  afterEach(cleanup);

  it("keeps typed Input as the start method without import tabs", async () => {
    const dialog = await openDialog(stubClient({}));
    assert.equal(document.querySelectorAll('[role="tab"]').length, 0);
    assert.equal(dialog.stage(), "Input");
    assert.equal(dialog.typedInput().value, "");
  });
  it("keeps the full run path and offers no upload that could enqueue spreadsheet rows", async () => {
    await openDialog(stubClient({}));
    assert.equal(document.querySelectorAll('[aria-label="Run configuration path"] li').length, 2);
    assert.equal(document.querySelectorAll('input[type="file"]').length, 0);
    assert.deepEqual(intakeHandoffs, []);
  });
  it("a served intake capability does not restore the retired upload action", async () => {
    const dialog = await openDialog(stubClient({}));
    await dialog.type(TYPED); await dialog.press("Next");
    assert.ok(!dialog.text().includes("Import a spreadsheet"));
    assert.deepEqual(intakeHandoffs, []);
  });
  it("omits reference controls for a workflow without declared references", async () => {
    let submission: unknown;
    const dialog = await openDialog(stubClient({ submitStartPlan: async input => { submission = input; return planResponse("5a000000-0000-4000-8000-000000000001"); } }));
    await dialog.type(TYPED); await dialog.press("Next");
    assert.equal(dialog.text().includes("Workbook · Optional"), false);
    assert.equal(dialog.text().includes("Reference spreadsheet"), false);
    await dialog.press("Start run");
    const request = StartPlanSubmissionSchema.parse(submission);
    assert.equal(request.submissions.length, 1); assert.equal(Object.hasOwn(request, "workbookId"), false);
  });
  it("keeps mock registration from becoming a prerequisite for a live start", async () => {
    const dialog = await openDialog(stubClient({ submitStartPlan: async () => planResponse("5a000000-0000-4000-8000-000000000001") }));
    await dialog.type(TYPED); await dialog.press("Next");
    assert.equal(dialog.stage(), "Start"); assert.equal(dialog.disabled("Start run"), false);
    assert.equal([...document.querySelectorAll("dt")].some(label => label.textContent === "Workbook"), false);
    assert.ok(!dialog.text().includes("Import spreadsheet"));
  });
  it("returning from Start preserves typed input and the complete path", async () => {
    const dialog = await openDialog(stubClient({}));
    await dialog.type(TYPED); await dialog.press("Next"); await dialog.press("1 Input");
    assert.equal(dialog.stage(), "Input"); assert.equal(dialog.typedInput().value, TYPED);
    assert.equal(document.querySelectorAll('[aria-label="Run configuration path"] li').length, 2);
    assert.equal(document.querySelectorAll('input[type="file"]').length, 0);
  });
});
}

{
type OpenDialog = Awaited<ReturnType<typeof openDialog>>;
const { cleanup, openDialog, stubClient, ACTOR_ID, HASH, APPLIED, closed } = createRunStartDialogHarness();


const SEPARATIONS_WORKFLOWS: readonly RunStartWorkflow[] = parseWorkflows(
  FIXTURE_START_PICKER_BOOTSTRAP.workflows,
).map((entry): RunStartWorkflow => {
  const start = entry.start;
  return {
    workflowId: String(entry.id),
    label: entry.label,
    categoryId: entry.categoryId,
    role: entry.role,
    icon: entry.icon,
    ...(entry.code === undefined ? {} : { code: entry.code }),
    ...(start.summary === undefined ? {} : { summary: start.summary }),
    enqueue: start.enqueue,
    version: start.version,
    steps: start.steps,
    inputRun:
      start.inputRun === undefined
        ? { state: "absent", reason: START_DOOR_ABSENCE["no-typed-input"] }
        : { state: "present", surface: start.inputRun },
    spreadsheetIntake: start.spreadsheetIntake, requiredWorkbookFields: start.requiredWorkbookFields,
    workbookReference: start.workbookReference,
  };
});

const SEPARATIONS = Object.freeze({ workflows: SEPARATIONS_WORKFLOWS, panelWorkflowId: "separations" });

// These Steps-screen tests supply their own omittable controls.
const SEPARATIONS_OMITTABLE_WRITES = Object.freeze({
  panelWorkflowId: "separations",
  workflows: SEPARATIONS_WORKFLOWS.map((workflow): RunStartWorkflow => workflow.workflowId !== "separations"
    ? workflow
    : {
      ...workflow,
      steps: workflow.steps.map((step): RunStartWorkflow["steps"][number] => {
        if (step.key === "ucpath-transaction") {
          return {
            ...step,
            control: {
              state: "omittable",
              forces: [],
              form: {
                fields: [
                  {
                    key: "transactionNumber",
                    label: "UCPath transaction number",
                    kind: "text",
                    help: "The T-number of the termination already filed in UCPath (T followed by 6–12 digits). This run files nothing in UCPath.",
                  },
                  {
                    key: "approvalStatus",
                    label: "Approval status",
                    kind: "enum",
                    values: ["Approved", "Manually Processed", "Pending"],
                    help: "The transaction's approval status as UCPath shows it now. Only a status that means the termination took effect can be asserted.",
                    replaces: { nodeId: "receipt", path: "approvalStatus" },
                  },
                ],
              },
            },
          };
        }
        if (step.key === "kuali-finalization") return { ...step, control: { state: "omittable", forces: [], form: { fields: [] } } };
        return step;
      }),
    }),
});

const DOCUMENT = "4502";

function separationsPlan(omittedSteps?: readonly string[]): StartPlanResponse {
  return StartPlanResponseSchema.parse({
    wireVersion: 1,
    startPlanId: "5a000000-0000-4000-8000-000000000009",
    workflowId: "separations",
    expectedVersion: 4,
    expiresAt: "2026-08-26T21:47:03.000Z",
    dryRun: false,
    priority: "interactive",
    plannedBy: ACTOR_ID,
    configSnapshotId: "c0000000-0000-4000-8000-000000000001",
    ...(omittedSteps === undefined || omittedSteps.length === 0 ? {} : { omittedSteps: [...omittedSteps] }),
    fingerprints: {
      descriptorFingerprint: HASH,
      configFingerprint: HASH,
      ingressSchemaHash: HASH,
      canonicalInputSchemaHash: HASH,
      inputFingerprint: HASH,
    },
    planned: [{
      logicalKey: "entry:9",
      title: "Fixture plan row",
      subtitle: DOCUMENT,
      matchKey: `kuali-document:${DOCUMENT}`,
    }],
    refused: [],
  });
}

it("keeps staging's dry-run sentence for a typed workflow", async () => {
  onTestFinished(cleanup);
  const base = SEPARATIONS_WORKFLOWS.find(workflow => workflow.workflowId === "separations");
  assert.ok(base?.inputRun.state === "present");
  const typed = {
    ...base,
    inputRun: { state: "present" as const, surface: { ...base.inputRun.surface, supportsDryRun: true } },
  };
  const dialog = await openDialog(stubClient({}), {
    workflows: SEPARATIONS_WORKFLOWS.map(workflow => workflow.workflowId === typed.workflowId ? typed : workflow),
    panelWorkflowId: "separations",
  });
  await dialog.type(DOCUMENT);
  await dialog.press("Next");
  assert.equal(dialog.stage(), "Start");
  const row = [...document.querySelectorAll(".ds-run-row")].find(node => node.textContent?.includes("Dry run"));
  assert.ok(row, "the typed dry-run row is missing");
  assert.match(row.textContent ?? "", /Fill and check every step without submitting\./u);
  assert.equal((row.textContent ?? "").includes("or saving"), false);
});

async function openSteps(client: DashboardClient, typed: string = DOCUMENT, scenario: typeof SEPARATIONS = SEPARATIONS): Promise<OpenDialog> {
  const dialog = await openDialog(client, scenario);
  await dialog.type(typed);
  await dialog.press("Next");
  await dialog.press("Customize steps");
  await dialog.press("Next");
  assert.equal(dialog.stage(), "Steps");
  return dialog;
}

describe("an omittable step draws its own form when it is left out", () => {
  afterEach(cleanup);

  it("draws nothing while the step is included, and the step's declared fields once it is not", async () => {

    const dialog = await openSteps(stubClient({}));
    assert.ok(!dialog.text().includes("Last day worked"), "an included step already asked for facts");

    await dialog.press("Kronos timecard");
    assert.ok(dialog.text().includes("Last day worked"), "omitting the step drew no form");
    assert.ok(dialog.text().includes("Separation date"));

    assert.ok(dialog.text().includes("Enter last day worked for kronos timecard."), "the first missing field drew no error in place of its help");
    assert.ok(dialog.text().includes("The last day on pay status, MM/DD/YYYY"), "a field without an error drew no help line");
    assert.ok(dialog.text().includes("7 of 8 included"));
  });

  it("draws nothing under an omitted step that asks for nothing at all", async () => {
    const dialog = await openSteps(stubClient({}), DOCUMENT, SEPARATIONS_OMITTABLE_WRITES);
    await dialog.press("Kuali finalization");
    const row = [...document.body.querySelectorAll(".ds-run-row")].find(candidate => candidate.textContent?.includes("Kuali finalization"));
    assert.ok(row !== undefined, "the step's row is drawn");
    assert.equal(row.children.length, 1, "a form with no fields drew something under its row");
  });

  it("draws an enum as a choice with NO pre-selected value", async () => {

    const dialog = await openSteps(stubClient({}), DOCUMENT, SEPARATIONS_OMITTABLE_WRITES);
    await dialog.press("UCPath transaction");
    const label = [...document.body.querySelectorAll("label")]
      .find((candidate) => (candidate.textContent ?? "").trim() === "Approval status");
    assert.ok(label !== undefined, "the enum field drew no label");
    const select = document.getElementById(label.htmlFor);
    assert.ok(select instanceof HTMLButtonElement && select.getAttribute("role") === "combobox");
    assert.equal(select.dataset.value, "", "an approval status was chosen for the operator");
    await act(async () => select.click());
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
    assert.deepEqual(options.map(option => option.dataset.value), ["", "Approved", "Manually Processed", "Pending"]);
    assert.equal(options.filter(option => option.getAttribute("aria-selected") === "true").length, 1);
    assert.equal(options.find(option => option.getAttribute("aria-selected") === "true")?.dataset.value, "");
    await act(async () => select.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));

  });
});

describe("Start is not sent while an omitted step's form does not parse", () => {
  afterEach(cleanup);

  it("holds the Steps stage, draws the declared refusal, and never asks the server", async () => {

    let asked = 0;
    const dialog = await openSteps(stubClient({
      submitStartPlan: async () => {
        asked += 1;
        return separationsPlan(["kronos-timecard"]);
      },
    }));
    await dialog.press("Kronos timecard");
    await dialog.fill("Last day worked", "6/30/2026");
    await dialog.fill("Separation date", "07/01/2026");

    assert.equal(dialog.disabled("Start live run"), true, "Start stayed on with an unparsable fact");
    assert.equal(dialog.stage(), "Steps", "an unparsable fact reached the server");
    assert.equal(asked, 0, "the dialog asked the server for a plan it knew would be refused");
    assert.equal(document.body.querySelectorAll('[role="alert"]').length, 1, "the refusal was not drawn as one alert");
    assert.ok(dialog.text().includes("Last day worked must be a valid date in MM/DD/YYYY format."), "the first failure was not drawn");

    await dialog.fill("Last day worked", "06/30/2026");
    await dialog.press("Start live run");
    assert.equal(asked, 1);
  });
});

describe("Enter in a manual-values editor", () => {
  afterEach(cleanup);

  it("stays in the editor and never launches a run, even when every fact is valid", async () => {
    let asked = 0;
    const dialog = await openSteps(stubClient({
      submitStartPlan: async () => {
        asked += 1;
        return separationsPlan(["kronos-timecard", "ucpath-transaction"]);
      },
    }), DOCUMENT, SEPARATIONS_OMITTABLE_WRITES);
    await dialog.press("UCPath transaction");
    await dialog.press("Kronos timecard");
    await dialog.fill("Last day worked", "06/30/2026");
    await dialog.fill("Separation date", "07/01/2026");
    await dialog.fill("UCPath transaction number", "T1234567");
    await dialog.fill("Approval status", "Approved");
    assert.equal(dialog.disabled("Start live run"), false, "the facts are valid, so Start is available");
    const label = [...document.querySelectorAll("label")].find(candidate => candidate.textContent?.trim() === "UCPath transaction number");
    const editor = label === undefined ? null : label.control ?? label.querySelector("input");
    assert.ok(editor?.closest('[aria-labelledby="run-start-steps"]'), "the fact's editor is inside Steps");
    assert.equal(await dialog.enter({ on: editor ?? undefined }), false, "Enter in the editor does nothing");
    assert.equal(asked, 0, "no plan was asked for");
  });
});

describe("Options while a run is starting", () => {
  afterEach(cleanup);
  const dryRunnable = () => {
    const base = SEPARATIONS_WORKFLOWS.find(workflow => workflow.workflowId === "separations");
    assert.ok(base?.inputRun.state === "present");
    const typed = { ...base, inputRun: { state: "present" as const, surface: { ...base.inputRun.surface, supportsDryRun: true } } };
    return { workflows: SEPARATIONS_WORKFLOWS.map(workflow => workflow.workflowId === typed.workflowId ? typed : workflow), panelWorkflowId: "separations" };
  };
  const optionSwitch = (name: string) => [...document.body.querySelectorAll<HTMLElement>('[role="switch"], [role="checkbox"]')]
    .find(node => node.getAttribute("aria-label") === name || node.closest(".ds-run-row")?.textContent?.includes(name) === true);

  it("does not launch from Enter on a focused switch", async () => {
    let planned = 0, launched = 0;
    const dialog = await openDialog(stubClient({
      submitStartPlan: async () => { planned += 1; return separationsPlan(); },
      executeCommand: async () => { launched += 1; return APPLIED; },
    }), dryRunnable());
    await dialog.type(DOCUMENT);
    await dialog.press("Next");
    const dryRun = optionSwitch("Dry run"); assert.ok(dryRun, "the Dry run switch");
    assert.equal(await dialog.enter({ on: dryRun }), false, "Enter on the switch is left to the switch");
    assert.equal(planned, 0, "no plan was asked for");
    assert.equal(launched, 0, "no launch was sent");
  });

  it("locks Priority and Dry run while the command is out and settles a delayed applied reply", async () => {
    let release: ((result: CommandResult) => void) | undefined;
    const dialog = await openDialog(stubClient({
      submitStartPlan: async () => separationsPlan(),
      executeCommand: async () => new Promise<CommandResult>(resolve => { release = resolve; }),
    }), dryRunnable());
    await dialog.type(DOCUMENT);
    await dialog.press("Next");
    await dialog.press("Start live run");
    const settleCommand = release; assert.ok(settleCommand !== undefined, "the dialog never called executeCommand");
    for (const name of ["Priority", "Dry run"]) {
      const node = optionSwitch(name); assert.ok(node, name);
      assert.equal(node.hasAttribute("disabled") || node.getAttribute("aria-disabled") === "true", true, `${name} is locked while the command is out`);
      await act(async () => node.click());
    }
    await act(async () => { settleCommand(APPLIED); await Promise.resolve(); });
    for (let wait = 0; wait < 4; wait += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.deepEqual(closed, [false], "the delayed applied reply dismissed the modal");
    assert.equal(window.sessionStorage.length, 0, "the applied submission cleared durable recovery");
  });
});

describe("the request carries the operator's omissions", () => {
  afterEach(cleanup);

  it("sends one entry per omitted step, in timeline order, with the typed facts", async () => {

    let submitted: unknown;
    const dialog = await openSteps(stubClient({
      submitStartPlan: async (input) => {
        submitted = input;
        return separationsPlan(["kronos-timecard", "ucpath-transaction"]);
      },
    }), DOCUMENT, SEPARATIONS_OMITTABLE_WRITES);
    await dialog.press("UCPath transaction");
    await dialog.press("Kronos timecard");
    await dialog.fill("Last day worked", "06/30/2026");
    await dialog.fill("Separation date", "07/01/2026");
    await dialog.fill("UCPath transaction number", "T1234567");
    await dialog.fill("Approval status", "Approved");
    await dialog.press("Start live run");

    const request = StartPlanSubmissionSchema.parse(submitted);
    assert.deepEqual(request.stepOmissions, [
      { step: "kronos-timecard", facts: { lastDayWorked: "06/30/2026", separationDate: "07/01/2026" } },
      { step: "ucpath-transaction", facts: { transactionNumber: "T1234567", approvalStatus: "Approved" } },
    ], "the omissions must ride in TIMELINE order, whatever order the boxes were pressed in");
    assert.ok(
      !(request.selectedStepKeys ?? []).includes("kronos-timecard"),
      "an omitted step was still selected",
    );

    assert.ok(dialog.text().includes("6 of 8 included"));
  });

  it("sends no omissions at all when the operator omitted nothing", async () => {
    let submitted: unknown;
    const dialog = await openSteps(stubClient({
      submitStartPlan: async (input) => {
        submitted = input;
        return separationsPlan();
      },
    }));
    await dialog.press("Start live run");
    const request = StartPlanSubmissionSchema.parse(submitted);
    assert.equal(request.stepOmissions, undefined, "an empty omission list still rode the wire");
  });
});

describe("a plan that omits a different set cannot be started", () => {
  afterEach(cleanup);

  it("refuses Start and says which set each side named", async () => {

    const dialog = await openSteps(stubClient({
      submitStartPlan: async () => separationsPlan(["kuali-finalization"]),
    }));
    await dialog.press("Kronos timecard");
    await dialog.fill("Last day worked", "06/30/2026");
    await dialog.fill("Separation date", "07/01/2026");
    await dialog.press("Start live run");
    assert.equal(dialog.stage(), "Steps");

    assert.ok(dialog.text().includes("but the plan omits"));
    assert.ok(dialog.text().includes("kronos-timecard"));
    assert.ok(dialog.text().includes("kuali-finalization"));
    assert.equal(dialog.disabled("Start live run"), true, "a plan for a different run was startable");
  });

  it("starts when the plan names exactly the set the dialog sent", async () => {
    let sent = 0;
    const dialog = await openSteps(stubClient({
      submitStartPlan: async () => separationsPlan(["kronos-timecard"]),
      executeCommand: async () => { sent += 1; return APPLIED; },
    }));
    await dialog.press("Kronos timecard");
    await dialog.fill("Last day worked", "06/30/2026");
    await dialog.fill("Separation date", "07/01/2026");
    await dialog.press("Start live run");
    assert.ok(!dialog.text().includes("but the plan omits"));
    assert.equal(sent, 1);
  });
});

describe("typed facts describe ONE subject", () => {
  afterEach(cleanup);

  it("does not offer an omission for a box that would create several runs", async () => {

    const dialog = await openSteps(stubClient({}), "4502; 4510");
    assert.equal(
      dialog.disabled("Kronos timecard"),
      true,
      "a multi-subject box still offered to omit a step",
    );
    assert.ok(dialog.text().includes("One person only."), dialog.text());
  });

  it("keeps a step done by hand on when a skipped read reaches it, and holds Start until it is turned off", async () => {
    const dialog = await openSteps(stubClient({}));
    await dialog.press("Kuali extraction");
    assert.ok(dialog.text().includes("5 of 8 included"), `a skipped read turned a form action off as if it were done by hand: ${dialog.text()}`);
    assert.equal(dialog.disabled("Kuali finalization"), false);
    assert.ok(dialog.text().includes("Needs Kuali extraction. Turn off if done by hand."), dialog.text());
    assert.ok(dialog.text().includes("Turn off Kuali finalization if done by hand."), dialog.text());
    await dialog.press("Kuali finalization");
    assert.ok(dialog.text().includes("4 of 8 included"), dialog.text());
    assert.ok(!dialog.text().includes("Turn off Kuali finalization if done by hand."), dialog.text());
    assert.ok(dialog.text().includes("Done outside Relay."), dialog.text());
  });

  it("lets several people skip a step done by hand, which types nothing", async () => {
    const dialog = await openSteps(stubClient({}), "4502; 4510");
    assert.equal(dialog.disabled("Kuali finalization"), false);
    await dialog.press("Kuali finalization");
    assert.ok(dialog.text().includes("Done outside Relay."), dialog.text());
    assert.ok(!dialog.text().includes("Typed values fit one person"), dialog.text());
    assert.equal(dialog.disabled("Start live run"), false);
  });
});

const CASCADING_SEPARATIONS = Object.freeze({
  panelWorkflowId: "separations",
  workflows: SEPARATIONS_OMITTABLE_WRITES.workflows.map((workflow): RunStartWorkflow => workflow.workflowId !== "separations"
    ? workflow
    : {
      ...workflow,
      steps: workflow.steps.map((step) => step.key !== "kronos-timecard" || step.control.state !== "omittable"
        ? step
        : { ...step, control: { ...step.control, forces: ["ucpath-transaction"] } }),
    }),
});

describe("a forced step is unchecked and LOCKED while the choice that forces it stands", () => {
  afterEach(cleanup);

  it("names the forced step up front, drags it out, locks it, and puts it back", async () => {

    let submitted: unknown;
    const dialog = await openDialog(stubClient({
      submitStartPlan: async (input) => {
        submitted = input;
        return separationsPlan(["kronos-timecard", "ucpath-transaction"]);
      },
    }), CASCADING_SEPARATIONS);
    await dialog.type(DOCUMENT);
    await dialog.press("Next");
    await dialog.press("Customize steps");
    await dialog.press("Next");

    assert.ok(dialog.text().includes("Also omits: UCPath transaction"));
    assert.equal(dialog.disabled("UCPath transaction"), false);

    await dialog.press("Kronos timecard");
    assert.ok(dialog.text().includes("6 of 8 included"), dialog.text());
    assert.equal(dialog.disabled("UCPath transaction"), true, "the forced row stayed pressable");
    assert.ok(dialog.text().includes("Omitted with Kronos timecard."));

    await dialog.press("UCPath transaction");
    assert.ok(dialog.text().includes("6 of 8 included"));

    await dialog.fill("Last day worked", "06/30/2026");
    await dialog.fill("Separation date", "07/01/2026");
    await dialog.fill("UCPath transaction number", "T1234567");
    await dialog.fill("Approval status", "Manually Processed");
    await dialog.press("Start live run");
    const request = StartPlanSubmissionSchema.parse(submitted);
    assert.deepEqual(request.stepOmissions?.map(({ step }) => step), ["kronos-timecard", "ucpath-transaction"]);

    await dialog.press("Kronos timecard");
    assert.ok(dialog.text().includes("8 of 8 included"), "undoing the choice left the forced step out");
    assert.equal(dialog.disabled("UCPath transaction"), false);
  });
});
}
