import { servedFixtureSources } from "../../../../parity/helpers/workflow-composition.js";
import { buildWorkflowCatalog } from "../../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import { DashboardClientProvider } from "../../../../../src/dashboard/state/client-context.js";
import type { DashboardClient } from "../../../../../src/dashboard/client/index.js";
import {
  StartPlanRequestSchema as StartPlanSubmissionSchema,
  StartPlanWireSchema as StartPlanResponseSchema,
  type StartPlanWire as StartPlanResponse,
} from "../../../../../src/models/dashboard/start-plan.js";
import { CommandResultSchema, type CommandResult } from "../../../../../src/rules/commands/commands.js";
import { parseWorkflows } from "../../../../../src/dashboard/surfaces/shell/shell-model.js";
import { RunStartDialog, type RunStartWorkflow } from "../../../../../src/dashboard/surfaces/run-start/run-start.js";
import { START_DOOR_ABSENCE } from "../../../../../src/dashboard/surfaces/run-start/run-start-model.js";
import { FIXTURE_BOOTSTRAP, FIXTURE_START_PICKER_BOOTSTRAP } from "../../../../parity/helpers/fixture-day.js";

// jsdom lacks overlay measurement APIs; these stubs supply capabilities without asserting geometry.
class MeasurementFreeResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

class ZeroDOMRect {
  readonly x = 0;
  readonly y = 0;
  readonly width = 0;
  readonly height = 0;
  readonly top = 0;
  readonly left = 0;
  readonly right = 0;
  readonly bottom = 0;
  static fromRect(): ZeroDOMRect {
    return new ZeroDOMRect();
  }
  toJSON(): Readonly<Record<string, number>> {
    return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  }
}

Reflect.set(globalThis, "ResizeObserver", MeasurementFreeResizeObserver);
Reflect.set(globalThis, "DOMRect", ZeroDOMRect);
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const ACTOR_ID = "local-operator";
const WORKFLOW_ID = "person-lookup";
/** the descriptor's own first example, so the parser cannot refuse it */
const TYPED = "10873698";
const HASH = "a".repeat(64);


const WORKFLOWS: readonly RunStartWorkflow[] = parseWorkflows(FIXTURE_BOOTSTRAP.workflows).map(
  (entry): RunStartWorkflow => {
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
  },
);

/** parsed through the real wire schema, so a fixture cannot outlive its contract */
function planResponse(startPlanId: string): StartPlanResponse {
  return StartPlanResponseSchema.parse({
    wireVersion: 1,
    startPlanId,
    workflowId: WORKFLOW_ID,
    expectedVersion: 4,
    expiresAt: "2026-08-26T21:47:03.000Z",
    dryRun: false,
    priority: "interactive",
    plannedBy: ACTOR_ID,
    configSnapshotId: "c0000000-0000-4000-8000-000000000001",
    fingerprints: {
      descriptorFingerprint: HASH,
      configFingerprint: HASH,
      ingressSchemaHash: HASH,
      canonicalInputSchemaHash: HASH,
      inputFingerprint: HASH,
    },
    planned: [{
      logicalKey: "entry:1",
      title: "Ada Lovelace",
      subtitle: "E1234567",
      matchKey: "eid:E1234567",
    }],
    refused: [],
  });
}

const APPLIED: CommandResult = CommandResultSchema.parse({
  state: "applied",
  commandId: "3a000000-0000-4000-8000-000000000001",
  affectedTargets: [{
    family: "start",
    workflowId: WORKFLOW_ID,
    startPlanId: "5a000000-0000-4000-8000-000000000001",
    expectedVersion: 4,
  }],
});

const CONFLICT: CommandResult = CommandResultSchema.parse({
  state: "conflict",
  commandId: "3a000000-0000-4000-8000-000000000002",
  currentVersion: 7,
  message: "The start plan was built against version 4.",
});


function stubClient(served: Partial<DashboardClient>): DashboardClient {
  const handler: ProxyHandler<Partial<DashboardClient>> = {
    get(target, property): unknown {
      const impl: unknown = Reflect.get(target, property);
      if (impl === undefined) {
        throw new Error(
          `the Run Modal reached for client.${String(property)}, which this case does not serve`,
        );
      }
      return impl;
    },
  };
  return new Proxy(served, handler) as DashboardClient;
}

let mounted: Root | undefined;

// Flush one settlement microtask inside act so React reports no out-of-scope state update.
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(async () => {
  window.sessionStorage.clear();
  const root = mounted;
  mounted = undefined;
  if (root !== undefined) {
    await act(async () => {
      root.unmount();
    });
  }
  document.body.replaceChildren();
});

async function render(element: ReactElement): Promise<void> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted = root;
  await act(async () => {
    root.render(element);
  });
}

interface OpenDialog {
  /** the typed-input box, present on Input and restored after every exit */
  readonly typedInput: () => HTMLTextAreaElement;

  readonly fill: (label: string, next: string) => Promise<void>;
  /** whether a control the dialog draws is currently disabled */
  readonly disabled: (name: string) => boolean;
  /** the stage the rail says is current */
  readonly stage: () => string;
  readonly text: () => string;
  readonly press: (name: string) => Promise<void>;
  readonly type: (next: string) => Promise<void>;
  readonly choosePriority: (next: string) => Promise<void>;
  readonly chooseBrowserMode: (next: string) => Promise<void>;
  readonly drop: (file: File) => Promise<void>;
}

function buttons(): HTMLButtonElement[] {
  return [...document.body.querySelectorAll("button")];
}

function buttonName(button: HTMLButtonElement): string {
  const explicit = button.getAttribute("aria-label");
  if (explicit !== null) return explicit;
  const labelledBy = button.getAttribute("aria-labelledby");
  if (labelledBy !== null) {
    return labelledBy.split(/\s+/u)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
  }
  return (button.textContent ?? "").trim();
}

// Use the native value setter to bypass React tracking before dispatching input.
function typeInto(node: HTMLTextAreaElement | HTMLSelectElement | HTMLInputElement, next: string): void {
  const prototype = node instanceof HTMLSelectElement
    ? HTMLSelectElement.prototype
    : node instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : HTMLTextAreaElement.prototype;
  const descriptor: { set?: (this: unknown, value: string) => void } | undefined =
    Object.getOwnPropertyDescriptor(prototype, "value");
  const setter = descriptor?.set;
  if (setter === undefined) {
    throw new Error(`this environment has no native value setter for <${node.tagName.toLowerCase()}>`);
  }
  setter.call(node, next);
  node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}


const closed: boolean[] = [];
const intakeHandoffs: { workflowId: string; intakeSessionId: string }[] = [];

async function openDialog(
  client: DashboardClient,
  catalogue: Readonly<{ workflows: readonly RunStartWorkflow[]; panelWorkflowId: string }> = {
    workflows: WORKFLOWS,
    panelWorkflowId: WORKFLOW_ID,
  },
  onApplied: (workflowId: string) => void = () => undefined,
): Promise<OpenDialog> {
  intakeHandoffs.length = 0; closed.length = 0;
  await render(createElement(DashboardClientProvider, {
    client,
    children: createElement(RunStartDialog, {
      open: true,
      onOpenChange: next => closed.push(next),
      catalog: buildWorkflowCatalog(catalogue.workflows, false, servedFixtureSources(catalogue.workflows)),
      panelWorkflowId: catalogue.panelWorkflowId,
      actorId: ACTOR_ID,
      onApplied,
      onOpenIntake: (workflowId: string, intakeSessionId: string) => {
        intakeHandoffs.push({ workflowId, intakeSessionId });
      },
    }),
  }));

  const typedInput = (): HTMLTextAreaElement => {
    const box = document.body.querySelector("textarea");
    if (box === null) throw new Error("the Run Modal drew no typed-input box");
    return box;
  };

  const stage = (): string => {
    const current = document.body.querySelector('[aria-current="step"]');
    if (current === null) throw new Error("the stage rail names no current stage");
    return (current.textContent ?? "").replace(/^\d+/u, "").trim();
  };

  const press = async (name: string): Promise<void> => {
    const action = name === "Continue" && buttons().some(button => button.textContent?.trim() === "Preview plan") ? "Preview plan" : name;
    const visibleMatches = buttons().filter((button) => (button.textContent ?? "").trim() === action);
    const matches = visibleMatches.length > 0
      ? visibleMatches
      : buttons().filter((button) => buttonName(button) === (name === "Continue" && buttons().some(entry => entry.textContent?.trim() === "Preview plan") ? "Preview plan" : name));
    const only = matches[0];
    if (matches.length !== 1 || only === undefined) {
      throw new Error(
        `expected exactly one control named "${name}", found ${String(matches.length)} among `
        + `[${buttons().map((button) => JSON.stringify(buttonName(button))).join(", ")}]`,
      );
    }
    // jsdom click does not move focus; focus the control before testing its handoff.
    only.focus();
    await act(async () => {
      only.click();
    });
    await settle();
  };

  const type = async (next: string): Promise<void> => {
    const box = typedInput();
    await act(async () => {
      typeInto(box, next);
    });
  };


  const chooseRadio = async (name: string, value: string) => {
    const radio = document.querySelector<HTMLInputElement>(`input[type="radio"][name^="${name}-"][value="${value}"]`);
    assert.ok(radio, `missing ${name}: ${value}`);
    await act(async () => radio.click());
  };
  const choosePriority = (value: string) => chooseRadio("Priority", value);
  const chooseBrowserMode = (value: string) => chooseRadio("Browser mode", value);

  // jsdom has no DataTransfer; install FileList on the Dropzone input.
  const drop = async (file: File): Promise<void> => {
    const input = document.body.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("the spreadsheet arm drew no file input");
    }
    Object.defineProperty(input, "files", {
      configurable: true,
      value: { 0: file, length: 1, item: (index: number) => (index === 0 ? file : null) },
    });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    await settle();
  };


  const fill = async (label: string, next: string): Promise<void> => {
    const found = [...document.body.querySelectorAll("label")]
      .filter((candidate) => (candidate.textContent ?? "").trim() === label);
    const only = found[0];
    if (found.length !== 1 || only === undefined) {
      throw new Error(`expected exactly one control labelled "${label}", found ${String(found.length)}`);
    }
    const control = document.getElementById(only.htmlFor);
    if (control instanceof HTMLButtonElement && control.getAttribute("role") === "combobox") {
      await act(async () => control.click());
      const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(node => node.dataset.value === next);
      assert.ok(option, `the "${label}" choice has no option ${next}`);
      await act(async () => option.click());
      return;
    }
    if (!(control instanceof HTMLInputElement
      || control instanceof HTMLSelectElement
      || control instanceof HTMLTextAreaElement)) {
      throw new Error(`the "${label}" label names ${only.htmlFor}, which is not a form control`);
    }
    await act(async () => {
      typeInto(control, next);
      // React maps `onBlur` onto the BUBBLING `focusout`; a non-bubbling
      // `blur` reaches no React handler and would silently prove nothing.
      control.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
  };

  const disabled = (name: string): boolean => {
    const found = buttons().filter((button) => buttonName(button) === (name === "Continue" && buttons().some(entry => entry.textContent?.trim() === "Preview plan") ? "Preview plan" : name));
    const only = found[0];
    if (found.length !== 1 || only === undefined) {
      throw new Error(`expected exactly one control named "${name}", found ${String(found.length)}`);
    }
    return only.disabled || only.getAttribute("data-disabled") !== null;
  };

  return {
    typedInput,
    fill,
    disabled,
    stage,
    text: () => (document.body.textContent ?? "").replace(/\s+/gu, " "),
    press,
    type,
    choosePriority,
    chooseBrowserMode,
    drop,
  };
}

// Compare presence as a boolean; formatting a jsdom node can exhaust the assertion budget.
function planIsDrawn(): boolean {
  return document.body.querySelector("#run-start-confirm") !== null;
}

/** the whole happy path, up to a settled `applied` banner */
async function reachResult(): Promise<OpenDialog> {
  const dialog = await openDialog(stubClient({
    submitStartPlan: async () => planResponse("5a000000-0000-4000-8000-000000000001"),
    executeCommand: async () => CONFLICT,
  }));
  await dialog.type(TYPED);
  await dialog.press("Continue");
  assert.equal(dialog.stage(), "Options");
  await dialog.press("Continue");
  assert.equal(dialog.stage(), "Confirm");
  await dialog.press("Start 1 run");
  assert.equal(dialog.stage(), "Confirm");
  return dialog;
}

// ---------------------------------------------------------------------------

it("reveals the launched workflow after an applied start", async () => {
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

    // The operator keeps typing while the round-trip is open.
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
  it("offers both modes, defaults to headed with screenshots on, and submits an explicit override", async () => {
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
    assert.ok(screenshotControl !== undefined, "Options drew no screenshot capture control");
    assert.equal(screenshotControl.getAttribute("data-state"), "checked", "screenshot capture must default on");
    await dialog.chooseBrowserMode("headless");
    await dialog.press("Capture screenshots");
    await dialog.press("Continue");
    const request = StartPlanSubmissionSchema.parse(submitted);
    assert.equal(request.browserMode, "headless");
    assert.equal(request.captureBrowserScreenshots, false);
    assert.ok(dialog.text().includes("Headless · screenshots off"));
    assert.ok([...document.querySelectorAll("dt")].some(label => label.textContent === "Browser"));
  });
});

describe("the compact confirmation keeps the exact input basis", () => {
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

// ---------------------------------------------------------------------------

describe("spreadsheet registration stays outside Run", () => {
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

/** the descriptor's own first example, so the parser cannot refuse it */
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

/** walk to the Steps screen with Customize steps on */
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
  it("draws nothing while the step is included, and the step's declared fields once it is not", async () => {
    // The mutation: draw the form for every omittable step rather than for the
    // omitted ones. It leaves the fields on screen before the checkbox moves.
    const dialog = await openSteps(stubClient({}));
    assert.ok(!dialog.text().includes("Last day worked"), "an included step already asked for facts");

    await dialog.press("Kronos timecard");
    assert.ok(dialog.text().includes("Last day worked"), "omitting the step drew no form");
    assert.ok(dialog.text().includes("Separation date"));
    // the DECLARED help line, verbatim — a form drawn without it would leave
    // the operator guessing what the fact means
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
    // The mutation: seed the select with `values[0]`. It would assert
    // "Approved" about a real person the operator never chose.
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
  it("holds the Steps stage, draws the declared refusal, and never asks the server", async () => {
    // The mutation: let `advance` submit regardless. The dialog would send a
    // date the descriptor's own schema refuses and land on the server's 400.
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
  it("sends one entry per omitted step, in timeline order, with the typed facts", async () => {
    // The mutation: send `stepOmissions` unconditionally, or drop the facts.
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

    // The operator's own confirmation names the step and every field LABEL it
    // asserted, with the value typed into it.
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
  it("refuses Start and says which set each side named", async () => {
    // The mutation: trust `plan.omittedSteps`. The operator would authorise a
    // run that keeps a step they omitted, or omits one they kept.
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
  it("does not offer an omission for a box that would create several runs", async () => {
    // The mutation: ignore the entry count. The dialog would send facts about
    // one person for a plan that asserts them for two.
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

    // named BEFORE the press, so the choice is not a surprise
    assert.ok(dialog.text().includes("Also omits: UCPath transaction"));
    assert.equal(dialog.disabled("UCPath transaction"), false);

    await dialog.press("Kronos timecard");
    assert.ok(dialog.text().includes("4 / 6 included"), dialog.text());
    assert.equal(dialog.disabled("UCPath transaction"), true, "the forced row stayed pressable");
    assert.ok(dialog.text().includes("Omitted with Kronos timecard."));

    // pressing the locked row changes nothing
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
