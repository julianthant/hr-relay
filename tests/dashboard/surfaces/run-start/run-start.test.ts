import { servedFixtureSources as previewFixtureSources } from "../../../parity/helpers/workflow-composition.js";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { afterEach, describe, it, onTestFinished, vi } from "vitest";
import { StartPlanRequestSchema as StartPlanSubmissionSchema, type StartPlanWire as StartPlanResponse, StartPlanWireSchema as StartPlanResponseSchema } from "../../../../src/models/dashboard/start-plan.js";
import { type CommandResult } from "../../../../src/rules/commands/commands.js";
import { createRunStartDialogHarness } from "../../../support/helpers/dashboard/run-start-dialog-harness.js";
import { type DashboardClient, createDashboardClient } from "../../../../src/dashboard/client/index.js";
import { START_DOOR_ABSENCE } from "../../../../src/dashboard/surfaces/run-start/run-start-model.js";
import { type RunStartWorkflow, RunStartSurfaces } from "../../../../src/dashboard/surfaces/run-start/run-start.js";
import { parseWorkflows } from "../../../../src/dashboard/surfaces/shell/shell-model.js";
import { FIXTURE_START_PICKER_BOOTSTRAP } from "../../../parity/helpers/fixture-day.js";
import { createRoot, type Root } from "react-dom/client";
import { type AppRouteState } from "../../../../src/dashboard/app/navigation/url-state.js";
import { ViewNavigationProvider } from "../../../../src/dashboard/app/navigation/view-navigation.js";
import { ToastProvider } from "../../../../src/dashboard/ds/ui.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import { seedMockRuns } from "../../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js";
import { buildWorkflowCatalog } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";

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
  await dialog.press("Continue");
  await dialog.press("Continue");
  assert.deepEqual(revealed, []);
  await dialog.press("Start 1 run");
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
  await dialog.press("Continue");
  await dialog.press("Continue");
  await dialog.press("Start 1 run");
  assert.deepEqual(revealed, []);
});

describe("a settlement that arrives after the request moved is DROPPED", () => {
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
    await dialog.press("Continue");
    await dialog.press("Continue");
    const settlePlan = release;
    assert.ok(settlePlan !== undefined, "the dialog never called submitStartPlan");

    await dialog.press("Back");
    await dialog.type("10873698; Battistessa, Johnnie");

    await act(async () => {
      settlePlan(planResponse("5a000000-0000-4000-8000-000000000001"));
      await Promise.resolve();
    });
    await settle();

    assert.ok(!planIsDrawn(), "a superseded plan landed on the edited form");
    assert.equal(dialog.stage(), "Input");
  });

  it("does not land a result for a plan the operator has already edited away", async () => {

    let release: ((result: CommandResult) => void) | undefined;
    const dialog = await openDialog(stubClient({
      submitStartPlan: async () => planResponse("5a000000-0000-4000-8000-000000000001"),
      executeCommand: async () => new Promise<CommandResult>((resolve) => {
        release = resolve;
      }),
    }));

    await dialog.type(TYPED);
    await dialog.press("Continue");
    await dialog.press("Continue");
    await dialog.press("Start 1 run");
    const settleCommand = release;
    assert.ok(settleCommand !== undefined, "the dialog never called executeCommand");

    await dialog.press("Back");
    await dialog.press("Back");
    await dialog.type("10873698; Battistessa, Johnnie");

    await act(async () => {
      settleCommand(APPLIED);
      await Promise.resolve();
    });
    await settle();

    assert.ok(!dialog.text().includes("Start applied"), "a superseded result banner landed");
    assert.equal(dialog.stage(), "Input");
  });
});

describe("a plan outlives nothing that shaped it, in the dialog", () => {
  afterEach(cleanup);

  it("drops the plan when a run control moves under it", async () => {

    const dialog = await openDialog(stubClient({
      submitStartPlan: async () => planResponse("5a000000-0000-4000-8000-000000000001"),
    }));
    await dialog.type(TYPED);
    await dialog.press("Continue");
    assert.equal(dialog.stage(), "Options");
    await dialog.press("Continue");
    assert.ok(planIsDrawn(), "the plan never rendered");

    await dialog.press("Back");
    await dialog.choosePriority("bulk");

    assert.ok(!planIsDrawn(), "the plan survived a control that re-fingerprints the request");
    assert.equal(dialog.stage(), "Options");
  });

  it("drops a settled result banner when the typed text moves under it", async () => {
    const dialog = await reachResult();
    assert.ok(dialog.text().includes("The start plan moved under this form"));

    await dialog.press("Back");
    await dialog.press("Back");
    await dialog.type("10873698; Battistessa, Johnnie");

    assert.ok(!dialog.text().includes("The start plan moved under this form"), "a settled banner stood over an edited request");
    assert.equal(dialog.stage(), "Input");
  });
});

describe("keeps optional steps and removes only the per-start destination", () => {
  afterEach(cleanup);

  it("keeps Options and the separate Steps screen while omitting destination controls", async () => {
    let submitted: unknown;
    const dialog = await openDialog(stubClient({
      submitStartPlan: async (input) => {
        submitted = input;
        return planResponse("5a000000-0000-4000-8000-000000000001");
      },
    }));

    await dialog.type(TYPED);
    await dialog.press("Continue");
    assert.equal(dialog.stage(), "Options");
    assert.ok(dialog.text().includes("Customize steps"));
    assert.ok(!dialog.text().includes("Destination"));
    assert.ok(!dialog.text().includes("Test instance"));
    assert.equal(document.querySelectorAll('input[type="radio"][name^="Priority-"]').length, 2);
    assert.equal(document.querySelectorAll('input[type="radio"][name^="Browser mode-"]').length, 2);
    assert.ok(dialog.text().includes("Active policy"));
    assert.ok(dialog.text().includes("Fixed by the selected workflow."));
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
    await dialog.press("Continue");
    assert.equal(dialog.stage(), "Steps");
    assert.ok(dialog.text().includes("CRM Dates"), "the optional step disappeared");
    await dialog.press("CRM Dates");
    await dialog.press("Continue");
    assert.equal(dialog.stage(), "Confirm");
    assert.ok(!dialog.text().includes("Destination"));
    assert.ok(!dialog.text().includes("Test instance"));
    assert.ok(!dialog.text().includes("Test destination"));
    assert.ok(!dialog.text().toLowerCase().includes("test ·"), "Confirm still draws a test-target badge");

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
    await dialog.press("Continue");
    const modes = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"][name^="Browser mode-"]')];
    assert.deepEqual(modes.map(mode => mode.value), ["headed", "headless"]);
    assert.equal(modes.find(mode => mode.value === "headed")?.checked, true);
    const screenshotControl = buttons().find(button => buttonName(button) === "Capture screenshots");
    assert.equal(screenshotControl, undefined, "Required screenshots must not have an off control");
    assert.ok(dialog.text().includes("Always on"));
    await dialog.chooseBrowserMode("headless");
    await dialog.press("Continue");
    const request = StartPlanSubmissionSchema.parse(submitted);
    assert.equal(request.browserMode, "headless");
    assert.equal(request.captureBrowserScreenshots, true);
    assert.ok(dialog.text().includes("Headless · screenshots required"));
    assert.ok([...document.querySelectorAll("dt")].some(label => label.textContent === "Browser"));
  });
});

describe("the compact confirmation keeps the exact input basis", () => {
  afterEach(cleanup);

  it("summarizes what was typed after the result settles", async () => {
    const dialog = await reachResult();
    assert.ok(dialog.text().includes(TYPED));
  });

  it("summarizes what was typed at Confirm", async () => {
    const dialog = await openDialog(stubClient({
      submitStartPlan: async () => planResponse("5a000000-0000-4000-8000-000000000001"),
    }));
    await dialog.type(TYPED);
    await dialog.press("Continue");
    await dialog.press("Continue");
    assert.equal(dialog.stage(), "Confirm");
    assert.ok(dialog.text().includes(TYPED));
  });
});

describe("every exit from a settled banner returns the form to Input", () => {
  afterEach(cleanup);

  it("Close resets the stage with the result, and puts focus back in the box", async () => {

    const dialog = await reachResult();

    await dialog.press("Close");

    assert.ok(!dialog.text().includes("Start applied"));
    assert.equal(dialog.stage(), "Input");
    assert.ok(!planIsDrawn(), "the spent plan token survived the close");
    assert.ok(document.activeElement === dialog.typedInput(), "focus was left on the control that just unmounted");
  });

  it("Reload the form drops the spent token, returns to Input and focuses the box", async () => {

    const dialog = await openDialog(stubClient({
      submitStartPlan: async () => planResponse("5a000000-0000-4000-8000-000000000001"),
      executeCommand: async () => CONFLICT,
    }));
    await dialog.type(TYPED);
    await dialog.press("Continue");
    await dialog.press("Continue");
    await dialog.press("Start 1 run");
    assert.ok(dialog.text().includes("The start plan moved under this form"));

    await dialog.press("Reload the form");

    assert.ok(!dialog.text().includes("The start plan moved under this form"));
    assert.equal(dialog.stage(), "Input");
    assert.ok(!planIsDrawn(), "the spent plan token survived the reload");
    assert.equal(dialog.typedInput().value, TYPED, "the operator's own text was thrown away");
    assert.ok(document.activeElement === dialog.typedInput(), "focus was left on the control that just unmounted");
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
    assert.equal(document.querySelectorAll('[aria-label="Run configuration path"] li').length, 3);
    assert.equal(document.querySelectorAll('input[type="file"]').length, 0);
    assert.deepEqual(intakeHandoffs, []);
  });
  it("a served intake capability does not restore the retired upload action", async () => {
    let uploads = 0;
    const dialog = await openDialog(stubClient({ uploadIntakeFile: async () => { uploads++; throw new Error("unexpected intake"); } }));
    await dialog.type(TYPED); await dialog.press("Continue");
    assert.ok(!dialog.text().includes("Import a spreadsheet"));
    assert.equal(uploads, 0); assert.deepEqual(intakeHandoffs, []);
  });
  it("describes workbook reference use and excludes it from the live request", async () => {
    let submission: unknown;
    const dialog = await openDialog(stubClient({ submitStartPlan: async input => { submission = input; return planResponse("5a000000-0000-4000-8000-000000000001"); } }));
    await dialog.type(TYPED); await dialog.press("Continue");
    assert.ok(dialog.text().includes("Workbook · Optional"));
    assert.ok(dialog.text().includes("Choose an already imported workbook for reference or results."));
    await dialog.press("Continue");
    const request = StartPlanSubmissionSchema.parse(submission);
    assert.equal(request.submissions.length, 1); assert.equal(Object.hasOwn(request, "workbookId"), false);
  });
  it("keeps mock registration from becoming a prerequisite for a live start", async () => {
    const dialog = await openDialog(stubClient({ submitStartPlan: async () => planResponse("5a000000-0000-4000-8000-000000000001") }));
    await dialog.type(TYPED); await dialog.press("Continue"); await dialog.press("Continue");
    assert.equal(dialog.stage(), "Confirm"); assert.equal(dialog.disabled("Start 1 run"), false);
    assert.equal([...document.querySelectorAll("dt")].some(label => label.textContent === "Workbook"), false);
    assert.ok(!dialog.text().includes("Import spreadsheet"));
  });
  it("returning from Options preserves typed input and the complete path", async () => {
    const dialog = await openDialog(stubClient({}));
    await dialog.type(TYPED); await dialog.press("Continue"); await dialog.press("Back");
    assert.equal(dialog.stage(), "Input"); assert.equal(dialog.typedInput().value, TYPED);
    assert.equal(document.querySelectorAll('[aria-label="Run configuration path"] li').length, 3);
    assert.equal(document.querySelectorAll('input[type="file"]').length, 0);
  });
});
}

{
type OpenDialog = Awaited<ReturnType<typeof openDialog>>;
const { cleanup, openDialog, stubClient, ACTOR_ID, HASH } = createRunStartDialogHarness();


const SEPARATIONS_WORKFLOWS: readonly RunStartWorkflow[] = parseWorkflows(
  FIXTURE_START_PICKER_BOOTSTRAP.workflows,
).map((entry): RunStartWorkflow => {
  const start = entry.start;
  return {
    workflowId: String(entry.id),
    label: entry.label,
    categoryId: entry.categoryId,
    role: entry.role,
    ...(entry.code === undefined ? {} : { code: entry.code }),
    ...(start.summary === undefined ? {} : { summary: start.summary }),
    enqueue: start.enqueue,
    version: start.version,
    steps: start.steps,
    inputRun:
      start.inputRun === undefined
        ? { state: "absent", reason: START_DOOR_ABSENCE["no-typed-input"] }
        : { state: "present", surface: start.inputRun },
    spreadsheetIntake: start.spreadsheetIntake,
  };
});

const SEPARATIONS = Object.freeze({ workflows: SEPARATIONS_WORKFLOWS, panelWorkflowId: "separations" });

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

async function openSteps(client: DashboardClient, typed: string = DOCUMENT): Promise<OpenDialog> {
  const dialog = await openDialog(client, SEPARATIONS);
  await dialog.type(typed);
  await dialog.press("Continue");
  await dialog.press("Customize steps");
  await dialog.press("Continue");
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

    assert.ok(dialog.text().includes("The employee's last physical day of work, MM/DD/YYYY"));
    assert.ok(dialog.text().includes("5 / 6 included"));
  });

  it("says so when the omitted step asks for nothing at all", async () => {
    const dialog = await openSteps(stubClient({}));
    await dialog.press("Kuali finalization");
    assert.ok(
      dialog.text().includes("This step asks for nothing"),
      "a form with no fields drew an empty box instead of saying it is empty",
    );
  });

  it("draws an enum as a choice with NO pre-selected value", async () => {

    const dialog = await openSteps(stubClient({}));
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

describe("Confirm is not reachable while an omitted step's form does not parse", () => {
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
    await dialog.press("Continue");

    assert.equal(dialog.stage(), "Steps", "an unparsable fact reached Confirm");
    assert.equal(asked, 0, "the dialog asked the server for a plan it knew would be refused");
    assert.ok(dialog.text().includes("a date fact must be MM/DD/YYYY"), "the declared refusal was not drawn");
    assert.ok(dialog.text().includes("Fill in the facts"), "the footer never said why Next did nothing");

    await dialog.fill("Last day worked", "06/30/2026");
    await dialog.press("Continue");
    assert.equal(dialog.stage(), "Confirm");
    assert.equal(asked, 1);
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
    }));
    await dialog.press("UCPath transaction");
    await dialog.press("Kronos timecard");
    await dialog.fill("Last day worked", "06/30/2026");
    await dialog.fill("Separation date", "07/01/2026");
    await dialog.fill("UCPath transaction number", "T1234567");
    await dialog.fill("Approval status", "Approved");
    await dialog.press("Continue");
    assert.equal(dialog.stage(), "Confirm");

    const request = StartPlanSubmissionSchema.parse(submitted);
    assert.deepEqual(request.stepOmissions, [
      { step: "kronos-timecard", facts: { lastDayWorked: "06/30/2026", separationDate: "07/01/2026" } },
      { step: "ucpath-transaction", facts: { transactionNumber: "T1234567", approvalStatus: "Approved" } },
    ], "the omissions must ride in TIMELINE order, whatever order the boxes were pressed in");
    assert.ok(
      !(request.selectedStepKeys ?? []).includes("kronos-timecard"),
      "an omitted step was still selected",
    );

    const confirmed = dialog.text();
    assert.ok(confirmed.includes("Omitted: Kronos timecard, UCPath transaction"), confirmed);
    assert.ok(confirmed.includes("Last day worked: 06/30/2026"));
    assert.ok(confirmed.includes("Separation date: 07/01/2026"));
    assert.ok(confirmed.includes("UCPath transaction number: T1234567"));
    assert.ok(confirmed.includes("Approval status: Approved"));
    assert.ok(confirmed.includes("4 / 6 included"));
  });

  it("sends no omissions at all when the operator omitted nothing", async () => {
    let submitted: unknown;
    const dialog = await openSteps(stubClient({
      submitStartPlan: async (input) => {
        submitted = input;
        return separationsPlan();
      },
    }));
    await dialog.press("Continue");
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
    await dialog.press("Continue");
    assert.equal(dialog.stage(), "Confirm");

    assert.ok(dialog.text().includes("This plan does not describe the steps you omitted"));
    assert.ok(dialog.text().includes("kronos-timecard"));
    assert.ok(dialog.text().includes("kuali-finalization"));
    assert.equal(dialog.disabled("Start 1 run"), true, "a plan for a different run was startable");
  });

  it("starts when the plan names exactly the set the dialog sent", async () => {
    const dialog = await openSteps(stubClient({
      submitStartPlan: async () => separationsPlan(["kronos-timecard"]),
    }));
    await dialog.press("Kronos timecard");
    await dialog.fill("Last day worked", "06/30/2026");
    await dialog.fill("Separation date", "07/01/2026");
    await dialog.press("Continue");
    assert.ok(!dialog.text().includes("This plan does not describe"));
    assert.equal(dialog.disabled("Start 1 run"), false);
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
    assert.ok(dialog.text().includes("this run would create 2"), dialog.text());
  });
});

const CASCADING_SEPARATIONS = Object.freeze({
  panelWorkflowId: "separations",
  workflows: SEPARATIONS_WORKFLOWS.map((workflow): RunStartWorkflow => workflow.workflowId !== "separations"
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
    await dialog.press("Continue");
    await dialog.press("Customize steps");
    await dialog.press("Continue");

    assert.ok(dialog.text().includes("Also omits: UCPath transaction"));
    assert.equal(dialog.disabled("UCPath transaction"), false);

    await dialog.press("Kronos timecard");
    assert.ok(dialog.text().includes("4 / 6 included"), dialog.text());
    assert.equal(dialog.disabled("UCPath transaction"), true, "the forced row stayed pressable");
    assert.ok(dialog.text().includes("Omitted with Kronos timecard."));

    await dialog.press("UCPath transaction");
    assert.ok(dialog.text().includes("4 / 6 included"));

    await dialog.fill("Last day worked", "06/30/2026");
    await dialog.fill("Separation date", "07/01/2026");
    await dialog.fill("UCPath transaction number", "T1234567");
    await dialog.fill("Approval status", "Manually Processed");
    await dialog.press("Continue");
    assert.equal(dialog.stage(), "Confirm");
    const request = StartPlanSubmissionSchema.parse(submitted);
    assert.deepEqual(request.stepOmissions?.map(({ step }) => step), ["kronos-timecard", "ucpath-transaction"]);

    await dialog.press("Back");
    await dialog.press("Kronos timecard");
    assert.ok(dialog.text().includes("6 / 6 included"), "undoing the choice left the forced step out");
    assert.equal(dialog.disabled("UCPath transaction"), false);
  });
});
}

{
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
let root: Root | undefined;

async function mount(element: ReturnType<typeof createElement>) { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root?.render(element)); return host; }
const button = (name: string) => { const found = [...document.querySelectorAll('button')].find(node => (node.getAttribute('aria-label') ?? node.textContent?.trim()) === name); assert(found, name); return found; };
const press = async (name: string) => act(async () => button(name).click());
describe('mounted frontend reliability contracts', () => {
  afterEach(async () => { await act(async () => root?.unmount()); document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('keeps mock rerun stages under the mock form when its routed dialog mounts or restores', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const runs = seedMockRuns(), source = runs.find(run => run.workflowId === 'onboarding'); assert(source);
    const previewLaunch = { workflowId: source.workflowId, source }, catalog = buildWorkflowCatalog([], true, previewFixtureSources([]));
    const requests: string[] = [];
    const client = createDashboardClient({ baseUrl: 'http://localhost', fetchImpl: async url => { requests.push(String(url)); throw new Error('Unexpected backend request'); } });
    let current: AppRouteState;
    function Harness() {
      const [route, setRoute] = useState<AppRouteState>({ start: true, view: { launchStage: 'Steps' } }); current = route;
      return createElement(ViewNavigationProvider, { route, setRoute, children: createElement(DashboardClientProvider, { client, children: createElement(ToastProvider, { children: createElement(RunStartSurfaces, {
        catalog, open: true, onOpenChange: () => {}, panelWorkflowId: previewLaunch.workflowId, actorId: 'local-operator', previewLaunch, previewRuns: runs,
        onSubmitPreview: () => {}, onOpenIntake: () => { throw new Error('Unexpected intake'); },
      }) }) }) });
    }
    await mount(createElement(Harness));
    assert.match(document.body.textContent ?? '', /Choose what to run again/u);
    assert.equal(current!.view?.launchStage, 'Steps');
    await press('Continue'); assert.match(document.body.textContent ?? '', /Values for the new run/u);
    assert.equal(current!.view?.launchStage, 'Values');
    await press('Back'); assert.equal(current!.view?.launchStage, 'Steps');
    await press('Continue'); await press('Continue'); await press('Preview plan');
    assert.match(document.body.textContent ?? '', /Review the plan/u); assert.equal(current!.view?.launchStage, 'Confirm');
    assert.deepEqual(requests, [], 'a local mock rerun must not ask a served planner to reconcile its stage');
  });
});
}
