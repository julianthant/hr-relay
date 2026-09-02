// @vitest-environment jsdom
/**
 * THE RUN MODAL, PRESSED — the half of D272 items 8 and 9 that no fold can hold.
 *
 * `run-start-model.test.ts` pins the folds (`startRequestFingerprint`,
 * `runControlGroups`) and `run-start-kit-render.test.ts` pins the pieces the
 * dialog draws. Neither can see the WIRING between them, and every finding this
 * file exists for lives exactly there:
 *
 *   - C109's reset effect is a `useEffect` in `run-start.tsx`. The fingerprint
 *     fold was pinned; the effect that CONSUMES it was not, so deleting the
 *     whole `useEffect` left every test in this tree green while a settled plan
 *     stood over a request the operator had already edited away.
 *   - the launcher's compact path hides the input control at Confirm but keeps
 *     the exact input in the confirmation summary; dropping that summary would
 *     let the operator authorise a plan without seeing its basis.
 *   - the settle-after-edit RACE is a fold's blind spot by construction: the
 *     fingerprint is right, and an in-flight request that resolves after the
 *     edit re-lands the superseded answer on top of the cleared state.
 *   - and the two exits from a settled banner (Close / Dismiss, Reload the
 *     form) are `onDismiss` / `onReload` PROPS — pinned in the kit as words on
 *     a button, unpinned as the state transition they trigger.
 *
 * So this file renders the real `RunStartDialog` into a real document and
 * presses the real controls. It is the second file in the unit lane to do so —
 * `session-panel-pool-press.test.ts` is the first, and its rule applies here
 * unchanged: the standing rule that behaviour belongs to the Playwright parity
 * lane still holds for anything about PIXELS. Which stage the rail says it is
 * on, and whether a stale plan re-lands, are not pixels.
 *
 * Every case below was run against a mutation of the line it pins; the mutation
 * is named in the case.
 */
import assert from "node:assert/strict";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import {
  FIXTURE_INTAKE_IDS,
  FIXTURE_INTAKE_MAPPING,
} from "../../parity/helpers/fixture-intake.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import {
  StartPlanResponseSchema,
  StartPlanSubmissionSchema,
  type StartPlanResponse,
} from "../../../src/dashboard/client/commands.js";
import { CommandResultSchema, type CommandResult } from "../../../src/domain/commands.js";
import { parseWorkflows } from "../../../src/dashboard/surfaces/shell-model.js";
import { RunStartDialog, type RunStartWorkflow } from "../../../src/dashboard/surfaces/run-start.js";
import { START_DOOR_ABSENCE } from "../../../src/dashboard/surfaces/run-start-model.js";
import { FIXTURE_BOOTSTRAP } from "../../parity/helpers/fixture-day.js";

/**
 * The two browser APIs Radix's overlay layers ask for that jsdom does not
 * implement. They are STUBS for measurement only — nothing in this file asserts
 * a position, and anything that did would be asserting against these stubs
 * rather than against a layout engine, which is what the parity lane is for.
 */
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

/**
 * The catalogue, composed exactly as `dashboard-app.tsx` composes it, from the
 * SAME served bootstrap the parity corpus photographs. A hand-built workflow
 * here would let this file pass against a shape the composition root never
 * produces.
 *
 * It is a module constant because `RunStartDialog`'s open effect keys on the
 * `workflows` identity: a fresh array per render would re-select the default
 * workflow forever and clear the form under every press.
 */
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

/**
 * The workflow's own served label, and the session the fixture upload opens —
 * both read off the SAME fixtures the corpus and the workspace read, so a case
 * here cannot pass against a shape neither ever produces (D298).
 */
const WORKFLOW_LABEL = WORKFLOWS.find((entry) => entry.workflowId === WORKFLOW_ID)?.label ?? WORKFLOW_ID;
const INTAKE_SESSION_ID = FIXTURE_INTAKE_IDS.mapping;

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
    configSnapshotId: "cfg-1",
    fingerprints: {
      descriptorFingerprint: HASH,
      configFingerprint: HASH,
      ingressSchemaHash: HASH,
      canonicalInputSchemaHash: HASH,
      inputFingerprint: HASH,
    },
    planned: [{
      runId: "1a000000-0000-4000-8000-000000000001",
      traceId: "tr-000000000001",
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

/**
 * A client that serves exactly what the case wires and THROWS for anything else.
 *
 * A blanket no-op stub would let a surface reach for a query this file never
 * meant it to have and answer with `undefined` — the silent substitution this
 * repo bans, wearing a test's clothes.
 */
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

/**
 * A press resolves a promise, and the dialog records the settlement one
 * microtask later. Flushing it here is not cosmetic: an unflushed settlement is
 * a React `act` warning today and a state update landing inside the NEXT case
 * tomorrow.
 */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(async () => {
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

/**
 * Set a control's value the way a keystroke does.
 *
 * React keeps its own value tracker on the DOM node, so assigning `.value`
 * directly leaves the tracker agreeing with the new text and React discards the
 * event that follows as "nothing changed". The PROTOTYPE's setter is the one
 * that moves the tracker, which is what makes the dispatched event real.
 *
 * The descriptor is annotated rather than used raw because `PropertyDescriptor`
 * declares `set` in method shorthand, and pulling a method off an object
 * without binding it is a lint error in this tree — correctly, in general.
 */
function typeInto(node: HTMLTextAreaElement | HTMLSelectElement, next: string): void {
  const prototype = node instanceof HTMLSelectElement
    ? HTMLSelectElement.prototype
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

/**
 * Every handoff this mount saw, in order (D296, reshaped by D298): the
 * workflow AND the session the drop opened, because the dialog now uploads
 * before it hands over.
 */
const intakeHandoffs: { workflowId: string; intakeSessionId: string }[] = [];

async function openDialog(client: DashboardClient): Promise<OpenDialog> {
  intakeHandoffs.length = 0;
  await render(createElement(DashboardClientProvider, {
    client,
    children: createElement(RunStartDialog, {
      open: true,
      onOpenChange: () => undefined,
      workflows: WORKFLOWS,
      panelWorkflowId: WORKFLOW_ID,
      actorId: ACTOR_ID,
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
    const visibleMatches = buttons().filter((button) => (button.textContent ?? "").trim() === name);
    const matches = visibleMatches.length > 0
      ? visibleMatches
      : buttons().filter((button) => buttonName(button) === name);
    const only = matches[0];
    if (matches.length !== 1 || only === undefined) {
      throw new Error(
        `expected exactly one control named "${name}", found ${String(matches.length)} among `
        + `[${buttons().map((button) => JSON.stringify(buttonName(button))).join(", ")}]`,
      );
    }
    // Focus first, the way a pointer or a Tab would: a `click()` in jsdom moves
    // no focus of its own, so without this the focus assertions below would be
    // asserting that focus never left the box in the first place.
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

  /**
   * The control BY ITS VISIBLE LABEL, through the `<label for>` the DS `Field`
   * emits — the same association a screen reader follows. Naming the control
   * keeps the test stable if another select joins the Options screen later.
   */
  const choosePriority = async (next: string): Promise<void> => {
    const label = [...document.body.querySelectorAll("label")]
      .find((candidate) => (candidate.textContent ?? "").trim() === "Priority");
    if (label === undefined) throw new Error("the run-control rail drew no Priority field");
    const select = document.getElementById(label.htmlFor);
    if (!(select instanceof HTMLSelectElement)) {
      throw new Error(`the Priority label names ${label.htmlFor}, which is not a select`);
    }
    await act(async () => {
      typeInto(select, next);
    });
  };

  const chooseBrowserMode = async (next: string): Promise<void> => {
    const label = [...document.body.querySelectorAll("label")]
      .find((candidate) => (candidate.textContent ?? "").trim() === "Browser mode");
    if (label === undefined) throw new Error("the run-control rail drew no Browser mode field");
    const select = document.getElementById(label.htmlFor);
    if (!(select instanceof HTMLSelectElement)) throw new Error(`the Browser mode label names ${label.htmlFor}, which is not a select`);
    await act(async () => { typeInto(select, next); });
  };

  /**
   * Drop a file on the spreadsheet arm's zone (D298).
   *
   * jsdom has no `DataTransfer`, so the FileList is installed on the real
   * `<input type="file">` the `Dropzone` wraps and `change` is dispatched —
   * which is the exact path a click-to-browse takes. The zone's drag handlers
   * are pixels and belong to the parity lane; what this file pins is what the
   * dialog DOES with the file.
   */
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

  return {
    typedInput,
    stage,
    text: () => (document.body.textContent ?? "").replace(/\s+/gu, " "),
    press,
    type,
    choosePriority,
    chooseBrowserMode,
    drop,
  };
}

/**
 * Is the plan region drawn? Asked as a BOOLEAN, never as the element itself.
 *
 * `assert.equal(element, null)` on a jsdom node spends the whole test budget
 * inside `util.inspect` walking a live DOM tree and takes the worker process
 * out with it — the failure that reports nothing at all. Every DOM identity in
 * this file is compared before it reaches an assertion for that reason.
 */
function planIsDrawn(): boolean {
  return document.body.querySelector("ul[aria-label='Runs this start will create']") !== null;
}

/** the whole happy path, up to a settled `applied` banner */
async function reachResult(): Promise<OpenDialog> {
  const dialog = await openDialog(stubClient({
    submitStartPlan: async () => planResponse("5a000000-0000-4000-8000-000000000001"),
    executeCommand: async () => APPLIED,
  }));
  await dialog.type(TYPED);
  await dialog.press("Next");
  assert.equal(dialog.stage(), "Options");
  await dialog.press("Next");
  assert.equal(dialog.stage(), "Confirm");
  await dialog.press("Start run");
  assert.equal(dialog.stage(), "Confirm");
  return dialog;
}

// ---------------------------------------------------------------------------

describe("a settlement that arrives after the request moved is DROPPED", () => {
  it("does not land a plan for text the operator has already edited away", async () => {
    // The mutation: delete the dispatch-time fingerprint capture in
    // `submitPlan` and let `setPlan(next)` run unconditionally. The plan for
    // `10873698` then lands on top of a form that now says something else, and
    // the footer offers to start it.
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
    await dialog.press("Next");
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
    // Same shape one stage later, and the more dangerous half: the banner would
    // say a start was applied for a request this form no longer describes.
    let release: ((result: CommandResult) => void) | undefined;
    const dialog = await openDialog(stubClient({
      submitStartPlan: async () => planResponse("5a000000-0000-4000-8000-000000000001"),
      executeCommand: async () => new Promise<CommandResult>((resolve) => {
        release = resolve;
      }),
    }));

    await dialog.type(TYPED);
    await dialog.press("Next");
    await dialog.press("Next");
    await dialog.press("Start run");
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

describe("C109 — a plan outlives nothing that shaped it, in the dialog", () => {
  it("drops the plan when a run control moves under it", async () => {
    // The mutation: delete the whole `useEffect` keyed on `requestFingerprint`
    // in `run-start.tsx`. `startRequestFingerprint` stays correct and every
    // fold case stays green, while the plan the operator is about to authorise
    // is one the server would no longer make.
    const dialog = await openDialog(stubClient({
      submitStartPlan: async () => planResponse("5a000000-0000-4000-8000-000000000001"),
    }));
    await dialog.type(TYPED);
    await dialog.press("Next");
    assert.equal(dialog.stage(), "Options");
    await dialog.press("Next");
    assert.ok(planIsDrawn(), "the plan never rendered");

    await dialog.press("Back");
    await dialog.choosePriority("bulk");

    assert.ok(!planIsDrawn(), "the plan survived a control that re-fingerprints the request");
    assert.equal(dialog.stage(), "Options");
  });

  it("drops a settled result banner when the typed text moves under it", async () => {
    const dialog = await reachResult();
    assert.ok(dialog.text().includes("Start applied"));

    await dialog.press("Back");
    await dialog.press("Back");
    await dialog.type("10873698; Battistessa, Johnnie");

    assert.ok(!dialog.text().includes("Start applied"), "a settled banner stood over an edited request");
    assert.equal(dialog.stage(), "Input");
  });
});

describe("D293 keeps D285 and removes only per-start destination", () => {
  it("keeps Options and the separate Steps screen while omitting destination controls", async () => {
    let submitted: unknown;
    const dialog = await openDialog(stubClient({
      submitStartPlan: async (input) => {
        submitted = input;
        return planResponse("5a000000-0000-4000-8000-000000000001");
      },
    }));

    await dialog.type(TYPED);
    await dialog.press("Next");
    assert.equal(dialog.stage(), "Options");
    assert.ok(dialog.text().includes("Customize steps"));
    assert.ok(!dialog.text().includes("Destination"));
    assert.ok(!dialog.text().includes("Test instance"));
    assert.equal(
      document.body.querySelectorAll("select").length,
      3,
      "Options must retain the workflow picker, Priority, and Browser mode controls",
    );

    await dialog.press("Customize steps");
    await dialog.press("Next");
    assert.equal(dialog.stage(), "Steps");
    assert.ok(dialog.text().includes("CRM Dates"), "the optional D285 step disappeared");
    await dialog.press("CRM Dates");
    await dialog.press("Next");
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
    await dialog.press("Next");
    const modeLabel = [...document.body.querySelectorAll("label")]
      .find((candidate) => (candidate.textContent ?? "").trim() === "Browser mode");
    assert.ok(modeLabel !== undefined, "Options drew no Browser mode label");
    const mode = document.getElementById(modeLabel.htmlFor);
    assert.ok(mode instanceof HTMLSelectElement, "Browser mode label did not name a select");
    assert.equal(mode.value, "headed");
    assert.deepEqual([...mode.options].map(option => [option.value, option.text]), [
      ["headless", "Headless"],
      ["headed", "Headed"],
    ]);
    const screenshotControl = buttons().find(button => buttonName(button) === "Capture browser screenshots");
    assert.ok(screenshotControl !== undefined, "Options drew no screenshot capture control");
    assert.equal(screenshotControl.getAttribute("data-state"), "checked", "screenshot capture must default on");
    await dialog.chooseBrowserMode("headless");
    await dialog.press("Capture browser screenshots");
    await dialog.press("Next");
    const request = StartPlanSubmissionSchema.parse(submitted);
    assert.equal(request.browserMode, "headless");
    assert.equal(request.captureBrowserScreenshots, false);
    assert.ok(dialog.text().includes("Browser: Headless"));
    assert.ok(dialog.text().includes("Browser screenshots: Off"));
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
    await dialog.press("Next");
    await dialog.press("Next");
    assert.equal(dialog.stage(), "Confirm");
    assert.ok(dialog.text().includes(TYPED));
  });
});

describe("every exit from a settled banner returns the form to Input", () => {
  it("Close resets the stage with the result, and puts focus back in the box", async () => {
    // The mutation: put `onDismiss` back to `() => setResult(null)`. The rail
    // then names Result as the current step over an empty region, and focus is
    // on an element that no longer exists.
    const dialog = await reachResult();

    await dialog.press("Close");

    assert.ok(!dialog.text().includes("Start applied"));
    assert.equal(dialog.stage(), "Input");
    assert.ok(!planIsDrawn(), "the spent plan token survived the close");
    assert.ok(document.activeElement === dialog.typedInput(), "focus was left on the control that just unmounted");
  });

  it("Reload the form drops the spent token, returns to Input and focuses the box", async () => {
    // The mutation: delete `setStage("input")` from `onReload`, or the focus
    // call after it. Both leave the operator on a stage whose region is empty,
    // and the second leaves the keyboard on `document.body`.
    const dialog = await openDialog(stubClient({
      submitStartPlan: async () => planResponse("5a000000-0000-4000-8000-000000000001"),
      executeCommand: async () => CONFLICT,
    }));
    await dialog.type(TYPED);
    await dialog.press("Next");
    await dialog.press("Next");
    await dialog.press("Start run");
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

describe("D296 — the spreadsheet method is the intake workspace's one door", () => {
  it("offers both methods for a spreadsheet-capable workflow, and typed is the default", async () => {
    // The mutation: derive the method set from anything but the served
    // `spreadsheetIntake` — a workflow-id check, or a constant pair. Person
    // Lookup is the only registered module with an intake projection, so a
    // hardcoded pair passes here and offers a dead door on every other
    // workflow the picker serves.
    const dialog = await openDialog(stubClient({}));

    const tabs = [...document.body.querySelectorAll('[role="tab"]')];
    assert.deepEqual(
      tabs.map((tab) => (tab.textContent ?? "").trim()),
      ["Type values", "Import a spreadsheet"],
    );
    assert.deepEqual(tabs.map((tab) => tab.getAttribute("aria-selected")), ["true", "false"]);
    // Typed is the default arm, so the box the operator types into is drawn
    // and the stage rail is the full three-stage path.
    assert.equal(dialog.stage(), "Input");
    assert.ok(dialog.text().includes("Next"));
  });

  it("the spreadsheet arm collapses the rail to Input and IS the dropzone", async () => {
    // The mutation: leave `runStartStages` keyed on `customizeSteps` alone.
    // The rail then numbers Options and Confirm for an arm that reaches
    // neither, and `Next` sits under a stage that has no next.
    const dialog = await openDialog(stubClient({}));
    await dialog.press("Import a spreadsheet");

    assert.equal(dialog.stage(), "Input");
    assert.equal(
      document.body.querySelectorAll('[aria-label="Run configuration path"] li').length,
      1,
      "the handoff arm numbered stages it cannot reach",
    );
    // D298 — the panel is the zone, not a paragraph about it. The real
    // `<input type="file">` is the claim: a div with a drop handler would
    // leave the keyboard and the screen reader with no way in.
    assert.ok(
      document.body.querySelector('input[type="file"]') instanceof HTMLInputElement,
      "the spreadsheet arm drew no file input",
    );
    assert.ok(
      dialog.text().includes(`Drop a spreadsheet of people for ${WORKFLOW_LABEL}`),
      "the zone did not name the workflow the columns will be mapped onto",
    );
    // The two controls that retired with the explanatory panel.
    assert.ok(!dialog.text().includes("Open the intake"), "the deleted handoff primary is still drawn");
    assert.ok(!dialog.text().includes("Next"), "the handoff arm still offers a stage to advance to");
  });

  it("a dropped file is uploaded, and the handoff carries the workflow AND the new session", async () => {
    // The mutation: hand `onOpenIntake` the panel's workflow, or route to the
    // retired `new` sentinel instead of the session the upload just opened.
    // The first maps the operator's file onto a workflow they did not choose;
    // the second lands them on an address that no longer resolves.
    const uploads: string[] = [];
    const dialog = await openDialog(stubClient({
      uploadIntakeFile: async (request) => {
        uploads.push(request.fileName);
        return { state: "created", session: FIXTURE_INTAKE_MAPPING };
      },
    }));
    await dialog.press("Import a spreadsheet");
    await dialog.drop(new File(["a,b\n1,2\n"], "roster.csv", { type: "text/csv" }));

    assert.deepEqual(uploads, ["roster.csv"]);
    assert.deepEqual(intakeHandoffs, [{ workflowId: WORKFLOW_ID, intakeSessionId: INTAKE_SESSION_ID }]);
  });

  it("a REFUSED upload prints the server's own code and opens no session", async () => {
    // The mutation: treat `state: "refused"` as a session — or swallow it and
    // route anyway. Either sends the operator to a workspace for a file the
    // server never accepted, which is the silent substitution this program
    // bans: "the check failed" must not read as "the check passed".
    const dialog = await openDialog(stubClient({
      uploadIntakeFile: async () => ({
        state: "refused",
        code: "MEDIA_TYPE_UNSUPPORTED",
        message: "roster.pdf is application/pdf; intake reads .csv and .xlsx",
      }),
    }));
    await dialog.press("Import a spreadsheet");
    await dialog.drop(new File(["%PDF-1.4"], "roster.pdf", { type: "application/pdf" }));

    const text = dialog.text();
    assert.ok(text.includes("MEDIA_TYPE_UNSUPPORTED"), "the refusal dropped the server's code");
    assert.ok(text.includes("intake reads .csv and .xlsx"), "the refusal dropped the server's sentence");
    assert.ok(text.includes("no session was opened"), "the refusal did not say what was NOT done");
    assert.deepEqual(intakeHandoffs, [], "a refused file still handed the operator over");
  });

  it("a transport failure says the file never landed, and opens no session", async () => {
    // The mutation: `.catch(() => undefined)` on the upload. The zone then
    // goes idle with nothing on screen, which is indistinguishable from a
    // dropped file the page ignored.
    const dialog = await openDialog(stubClient({
      uploadIntakeFile: async () => { throw new Error("fetch failed"); },
    }));
    await dialog.press("Import a spreadsheet");
    await dialog.drop(new File(["a,b\n"], "roster.csv", { type: "text/csv" }));

    assert.ok(dialog.text().includes("fetch failed"), "the transport failure was swallowed");
    assert.deepEqual(intakeHandoffs, [], "a failed upload still handed the operator over");
  });

  it("the typed arm comes back with its box and its full path", async () => {
    // The mutation: derive the rail from `method` state rather than from the
    // arm actually rendered. A tab press that does not restore the path leaves
    // the operator on a one-stage rail with a box they cannot advance from.
    const dialog = await openDialog(stubClient({}));
    await dialog.press("Import a spreadsheet");
    await dialog.press("Type values");

    assert.equal(
      document.body.querySelectorAll('[aria-label="Run configuration path"] li').length,
      3,
    );
    assert.equal(dialog.typedInput().value, "");
    assert.ok(dialog.text().includes("Next"));
  });
});
