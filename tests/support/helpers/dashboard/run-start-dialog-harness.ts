import { ToastProvider } from "../../../../src/dashboard/ds/ui.js";
import { ItemAttemptHistoryResponseSchema } from "../../../../src/models/dashboard/item-attempt-history.js";
import { FixtureCommandBinding } from "./command-binding.js";
import { FIXTURE_DAY_WIRE } from "../../fixtures/dashboard/fixture-queue.js";
import { uuidOf } from "../../fixtures/dashboard/fixture-identity.js";
import { DashboardDayWireSchema, QueueSurfaceWireSchema } from "../../../../src/models/dashboard/projection.js";
import { StartCommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import type { RerunLaunchSource } from "../../../../src/dashboard/surfaces/run-start/run-launch-model.js";
import { buildWorkflowCatalog } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { servedFixtureSources } from "../../../mocks/helpers/workflow-composition.js";

import assert from "node:assert/strict";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { DashboardClient } from "../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import { START_DOOR_ABSENCE } from "../../../../src/dashboard/surfaces/run-start/run-start-model.js";
import { RunStartDialog, type RunStartWorkflow } from "../../../../src/dashboard/surfaces/run-start/run-start.js";
import { parseWorkflows } from "../../../../src/dashboard/surfaces/shell/shell-model.js";
import { StartPlanWireSchema as StartPlanResponseSchema, type StartPlanWire as StartPlanResponse } from "../../../../src/models/dashboard/start-plan.js";
import { CommandResultSchema, type CommandResult } from "../../../../src/rules/commands/commands.js";
import { FIXTURE_BOOTSTRAP } from "../../../mocks/helpers/fixture-day.js";

export function createRunStartDialogHarness() {
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
        spreadsheetIntake: start.spreadsheetIntake, requiredWorkbookFields: start.requiredWorkbookFields,
        workbookReference: start.workbookReference,
        referenceSources: FIXTURE_BOOTSTRAP.workbookCompatibility.workflows.find(workflow => workflow.workflowId === entry.id)?.sources ?? [],
      };
    },
  );

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
    const submitStartPlan = served.submitStartPlan;
    const executeCommand = served.executeCommand;
    let reviewedPlan: StartPlanResponse | undefined;
    let readback: ReturnType<typeof DashboardDayWireSchema.parse> | undefined;
    const methods: Partial<DashboardClient> = { ...served,
      ...(submitStartPlan === undefined ? {} : { submitStartPlan: async (input: unknown) => {
        reviewedPlan = await submitStartPlan(input);
        return reviewedPlan;
      } }),
      ...(executeCommand === undefined ? {} : { executeCommand: async (input: unknown) => {
        const command = StartCommandRequestSchema.parse(input);
        const reply = await executeCommand(input);
        if (reply.state !== "applied" && reply.state !== "already-applied") return { ...reply, commandId: command.commandId };
        assert.ok(reviewedPlan, "applied fixture requires its reviewed plan");
        const plan = reviewedPlan;
        const base = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.parent === null);
        assert.ok(base, "fixture has a canonical root row");
        const rows = plan.planned.map((_, index) => QueueSurfaceWireSchema.parse({ ...base,
          runId: uuidOf(600 + index), workflowId: command.target.workflowId, actorId: command.requestedBy,
          descriptorHash: plan.fingerprints.descriptorFingerprint, configFingerprint: plan.fingerprints.configFingerprint,
          dryRun: plan.dryRun, session: { state: "present", itemScope: command.target.workflowId === "person-lookup" ? "session" : "workflow", sessionId: uuidOf(900),
            origin: { kind: "start-plan", startPlanId: plan.startPlanId, actorId: command.requestedBy } }, actions: [],
        }));
        readback = DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE, queueSurfaces: rows });
        return CommandResultSchema.parse({ ...reply, commandId: command.commandId, affectedTargets: [
          { family: "start", ...command.target }, ...rows.map(row => ({ family: "run", runId: row.runId })),
        ] });
      } }),
      itemAttemptHistory: served.itemAttemptHistory ?? (async runId => {
        assert.ok(readback, "fixture history requires an admitted command");
        const row = readback.queueSurfaces.find(row => row.runId === runId);
        assert.ok(row, "fixture history selects the admitted run");
        const identity = { runId, workflowId: row.workflowId, itemId: row.itemId, attempt: row.attempt, rowRevision: row.rowRevision };
        return ItemAttemptHistoryResponseSchema.parse({ schemaVersion: 1, state: "available",
          selected: { ...identity, state: "present", disposition: "live" }, item: { workflowId: row.workflowId, itemId: row.itemId },
          page: { limit: 50, offset: 0, totalEntries: 1, nextCursor: null,
            entries: [{ ...identity, disposition: "live", partitionDay: readback.day }] },
        });
      }),
      dashboardDay: served.dashboardDay ?? (async () => {
        assert.ok(readback, "fixture readback requires an admitted command");
        return readback;
      }),
    };
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
    return new Proxy(methods, handler) as DashboardClient;
  }

  let mounted: Root | undefined;

  // Flush one settlement microtask inside act so React reports no out-of-scope state update.
  async function settle(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
    });
  }

  async function cleanup(): Promise<void> {
    window.sessionStorage.clear();
    const root = mounted;
    mounted = undefined;
    if (root !== undefined) {
      await act(async () => {
        root.unmount();
      });
    }
    document.body.replaceChildren();
  }

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

    readonly typedInput: () => HTMLTextAreaElement;

    readonly fill: (label: string, next: string) => Promise<void>;

    readonly disabled: (name: string) => boolean;

    readonly stage: () => string;
    readonly text: () => string;
    readonly press: (name: string) => Promise<void>;
    readonly type: (next: string) => Promise<void>;
    readonly enter: (options?: { shift?: boolean; on?: Element }) => Promise<boolean>;
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
    catalogue: Readonly<{ workflows: readonly RunStartWorkflow[]; panelWorkflowId: string; rerunSource?: RerunLaunchSource }> = {
      workflows: WORKFLOWS,
      panelWorkflowId: WORKFLOW_ID,
    },
    onApplied: (workflowId: string) => void = () => undefined,
  ): Promise<OpenDialog> {
    intakeHandoffs.length = 0; closed.length = 0;
    await render(createElement(ToastProvider, { children: createElement(DashboardClientProvider, {
      client,
      children: createElement(FixtureCommandBinding, { actorId: ACTOR_ID, children: createElement(RunStartDialog, {
        open: true,
        onOpenChange: next => closed.push(next),
        catalog: buildWorkflowCatalog(catalogue.workflows, false, servedFixtureSources(catalogue.workflows)),
        panelWorkflowId: catalogue.panelWorkflowId,
        actorId: ACTOR_ID,
        rerunSource: catalogue.rerunSource,
        onApplied,
        onOpenIntake: (workflowId: string, intakeSessionId: string) => {
          intakeHandoffs.push({ workflowId, intakeSessionId });
        },
      }) }),
    }) }));

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

    const switchNamed = (name: string): HTMLInputElement | undefined => [...document.body.querySelectorAll<HTMLInputElement>('[role="switch"], [role="checkbox"]')]
      .find(node => [name, `Include ${name}`, `${name} (required)`].includes(node.closest("label")?.querySelector(".ds-switch-copy > span")?.textContent ?? "") || node.getAttribute("aria-label") === name);
    const press = async (name: string): Promise<void> => {
      const action = name === "Continue" && buttons().some(button => button.textContent?.trim() === "Preview plan") ? "Preview plan" : name;
      const visibleMatches = buttons().filter((button) => (button.textContent ?? "").trim() === action);
      const matches = visibleMatches.length > 0
        ? visibleMatches
        : buttons().filter((button) => buttonName(button) === (name === "Continue" && buttons().some(entry => entry.textContent?.trim() === "Preview plan") ? "Preview plan" : name));
      const only = matches[0] ?? switchNamed(name);
      if (matches.length > 1 || only === undefined) {
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

    const enter = async (options: { shift?: boolean; on?: Element } = {}): Promise<boolean> => {
      const event = new KeyboardEvent("keydown", { key: "Enter", shiftKey: options.shift === true, bubbles: true, cancelable: true });
      await act(async () => { (options.on ?? typedInput()).dispatchEvent(event); });
      await settle();
      return event.defaultPrevented;
    };

    const chooseSwitch = async (name: string, on: boolean) => {
      const node = switchNamed(name);
      assert.ok(node, `missing switch ${name}`);
      if (node.checked !== on) await act(async () => node.click());
    };
    const chooseRadio = async (name: string, value: string) => {
      const radio = document.querySelector<HTMLInputElement>(`input[type="radio"][name^="${name}-"][value="${value}"]`);
      assert.ok(radio, `missing ${name}: ${value}`);
      await act(async () => radio.click());
    };
    const choosePriority = (value: string) => chooseSwitch("Priority", value === "interactive");
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

        control.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      });
    };

    const disabled = (name: string): boolean => {
      const found = buttons().filter((button) => buttonName(button) === (name === "Continue" && buttons().some(entry => entry.textContent?.trim() === "Preview plan") ? "Preview plan" : name));
      const only = found[0] ?? switchNamed(name);
      if (found.length > 1 || only === undefined) {
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
      enter,
      choosePriority,
      chooseBrowserMode,
      drop,
    };
  }

  async function chooseVersion(version: string): Promise<void> {
    const trigger = buttons().find(button => (button.getAttribute("aria-label") ?? "").endsWith(" version"));
    if (trigger === undefined) throw new Error("the reference row draws no version picker");
    await act(async () => { trigger.click(); });
    const option = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find(node => node.textContent?.includes(version));
    if (option === undefined) throw new Error(`no version ${version}`);
    await act(async () => { option.click(); });
    await settle();
  }

  /** Drives the Reference spreadsheets rows: Add (or Change) spreadsheet and search it, then optionally its version select and worksheet menu. */
  async function chooseReference(spreadsheet: string, version?: string, worksheet?: string): Promise<void> {
    const open = buttons().find(button => ["Add spreadsheet", "Change spreadsheet"].includes(button.textContent?.trim() ?? ""));
    if (open === undefined) throw new Error("the dialog draws no Add spreadsheet button");
    await act(async () => { open.click(); });
    const search = document.body.querySelector<HTMLInputElement>('input[aria-label="Find a spreadsheet"]');
    if (search === null) throw new Error("the Add spreadsheet menu drew no search");
    await act(async () => { typeInto(search, spreadsheet); });
    const item = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(node => node.textContent?.includes(spreadsheet));
    if (item === undefined) throw new Error(`no spreadsheet matches ${spreadsheet}`);
    await act(async () => { item.click(); });
    await settle();
    if (version !== undefined) await chooseVersion(version);
    if (worksheet !== undefined) {
      const trigger = buttons().find(button => /worksheet, /u.test(button.getAttribute("aria-label") ?? ""));
      if (trigger === undefined) throw new Error("the reference row draws no worksheet menu");
      await act(async () => { trigger.click(); });
      const choice = [...document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(node => node.textContent?.includes(worksheet));
      if (choice === undefined) throw new Error(`no worksheet ${worksheet}`);
      await act(async () => { choice.click(); });
      await settle();
    }
  }

  // Compare presence as a boolean; formatting a jsdom node can exhaust the assertion budget.
  function planIsDrawn(): boolean {
    return document.body.querySelector("#run-start-confirm") !== null;
  }

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
    assert.equal(closed.at(-1), false);
    return dialog;
  }

  return { cleanup, openDialog, stubClient, ACTOR_ID, WORKFLOW_ID, TYPED, HASH, WORKFLOWS, APPLIED, CONFLICT, planResponse, planIsDrawn, reachResult, closed, intakeHandoffs, settle, buttons, buttonName, chooseReference, chooseVersion };
}
