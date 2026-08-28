// @vitest-environment jsdom
/**
 * DCC5's pressed editor: render-safe served values, stale validation refusal,
 * truthful post-command readback, and focus return are interaction behavior.
 * Model tests cannot see these React transitions.
 */
import assert from "node:assert/strict";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { ExplorerEditValidationResultSchema, type ExplorerEditDraft, type ExplorerWorkflowWire } from "../../../src/domain/dashboard/explorer.js";
import { CommandResultSchema, type CommandResult } from "../../../src/domain/commands.js";
import { manualClock } from "../../../src/domain/clock.js";
import { FingerprintSchema } from "../../../src/domain/ids.js";
import { buildWorkflowExplorer } from "../../../src/server/dashboard/queries/explorer.js";
import { ExplorerEditDialog, WorkflowExplorer } from "../../../src/dashboard/surfaces/explorer.js";
import { explorerPresentationChange, explorerPresentationDraft } from "../../../src/dashboard/surfaces/explorer-model.js";
import { FIXTURE_BOOTSTRAP } from "../../parity/helpers/fixture-day.js";
import { explorerQueryDeps } from "../../fixtures/explorer-seams.js";

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
  static fromRect(): ZeroDOMRect { return new ZeroDOMRect(); }
  toJSON(): Readonly<Record<string, number>> { return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }; }
}

Reflect.set(globalThis, "ResizeObserver", MeasurementFreeResizeObserver);
Reflect.set(globalThis, "DOMRect", ZeroDOMRect);
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const CLOCK = manualClock(new Date("2026-08-28T19:00:00.000Z"));
const HASH = FingerprintSchema.parse("f".repeat(64));
const ACTOR_ID = "local-operator";

function servedWorkflows(): Readonly<{ wire: ReturnType<typeof buildWorkflowExplorer>; first: ExplorerWorkflowWire; second: ExplorerWorkflowWire }> {
  const wire = buildWorkflowExplorer(explorerQueryDeps(CLOCK, HASH));
  const first = wire.workflows[0];
  const second = wire.workflows[1];
  if (first === undefined || second === undefined) throw new Error("fixture needs two Explorer workflows");
  return { wire, first, second };
}

function ready(draft: ExplorerEditDraft) {
  const { first } = servedWorkflows();
  const task = first.nodes.flatMap((node) => node.tasks)[0];
  const scenario = first.scenarios[0];
  if (task === undefined || scenario === undefined) throw new Error("fixture needs task and scenario evidence");
  const change = draft.changes[0];
  if (change === undefined || !("value" in change)) throw new Error("fixture needs one presentation value change");
  const path = change.kind === "workflow-label" ? "presentation.label" : change.kind === "workflow-icon" ? "presentation.icon" : "presentation.category";
  return ExplorerEditValidationResultSchema.parse({
    state: "ready-to-apply",
    draft,
    override: {
      overrideVersion: 1,
      workflowId: draft.workflowId,
      descriptorVersion: draft.baseDescriptorVersion,
      contractFingerprint: draft.baseContractFingerprint,
      revision: draft.baseOverrideRevision + 1,
      presentation: change.kind === "workflow-label"
        ? { label: change.value }
        : change.kind === "workflow-icon"
          ? { icon: change.value }
          : { category: change.value },
    },
    semanticDiff: [{ path, before: "before", after: change.value }],
    impactedTasks: [task.taskId],
    impactedScenarios: [scenario.scenarioId],
  });
}

function strictClient(served: Partial<DashboardClient>): DashboardClient {
  return new Proxy(served, {
    get(target, property): unknown {
      const value = Reflect.get(target, property);
      if (value === undefined) throw new Error(`Explorer editor reached client.${String(property)} without a test response`);
      return value;
    },
  }) as DashboardClient;
}

let root: Root | undefined;

afterEach(async () => {
  const mounted = root;
  root = undefined;
  if (mounted !== undefined) await act(async () => { mounted.unmount(); });
  document.body.replaceChildren();
});

async function render(element: ReactElement): Promise<void> {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root?.render(element); });
}

async function settle(): Promise<void> {
  await act(async () => { await Promise.resolve(); });
}

function text(): string {
  return (document.body.textContent ?? "").replace(/\s+/gu, " ");
}

function button(name: string): HTMLButtonElement {
  const matches = [...document.body.querySelectorAll("button")]
    .filter((candidate) => (candidate.textContent ?? "").trim() === name);
  const only = matches[0];
  if (matches.length !== 1 || only === undefined) throw new Error(`expected one button ${name}, found ${String(matches.length)}`);
  return only;
}

async function press(name: string): Promise<void> {
  const target = button(name);
  target.focus();
  await act(async () => { target.click(); });
  await settle();
}

function setValue(node: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string): void {
  const prototype = node instanceof HTMLInputElement
    ? HTMLInputElement.prototype
    : node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter === undefined) throw new Error(`jsdom has no value setter for ${node.tagName}`);
  setter.call(node, value);
  node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

async function typeReason(value: string): Promise<void> {
  const node = document.body.querySelector("textarea");
  if (!(node instanceof HTMLTextAreaElement)) throw new Error("Explorer editor rendered no reason field");
  await act(async () => { setValue(node, value); });
}

function dialog(client: DashboardClient, workflow: ExplorerWorkflowWire, field: "workflow-label" | "workflow-icon" | "workflow-category") {
  return createElement(DashboardClientProvider, {
    client,
    children: createElement(ExplorerEditDialog, {
      workflow,
      field,
      actorId: ACTOR_ID,
      onClose: () => undefined,
      onReadback: () => undefined,
    }),
  });
}

describe("DCC5 Explorer edit dialog", () => {
  it("opens icon and category editors with their served allowlisted value", async () => {
    const { first } = servedWorkflows();
    const client = strictClient({ validateExplorerEdit: async () => ready(explorerPresentationDraft(first, explorerPresentationChange(first, "workflow-icon", first.icon))) });
    await render(dialog(client, first, "workflow-icon"));
    const icon = document.body.querySelector("select");
    assert.ok(icon instanceof HTMLSelectElement, "the icon editor did not render its select");
    assert.equal(icon.value, first.icon);
    await act(async () => { root?.render(dialog(client, first, "workflow-category")); });
    const category = document.body.querySelector("select");
    assert.ok(category instanceof HTMLSelectElement, "the category editor did not render its select");
    assert.equal(category.value, first.category);
  });

  it("drops a ready validation that resolves after the editor draft changes", async () => {
    const { first } = servedWorkflows();
    let release: ((value: ReturnType<typeof ready>) => void) | undefined;
    const client = strictClient({
      validateExplorerEdit: async () => new Promise<ReturnType<typeof ready>>((resolve) => { release = resolve; }),
    });
    await render(dialog(client, first, "workflow-label"));
    await typeReason("Correct display wording");
    await press("Review change");
    const settleValidation = release;
    assert.ok(settleValidation !== undefined, "the dialog did not start validation");
    await typeReason("Correct a newer display wording");
    await act(async () => { settleValidation(ready(explorerPresentationDraft(first, explorerPresentationChange(first, "workflow-label", first.label)))); });
    await settle();
    assert.equal(document.body.querySelector("button")?.textContent?.includes("Apply presentation change") ?? false, false);
  });

  it("drops a ready validation after the workflow target switches", async () => {
    const { first, second } = servedWorkflows();
    let release: ((value: ReturnType<typeof ready>) => void) | undefined;
    const client = strictClient({
      validateExplorerEdit: async () => new Promise<ReturnType<typeof ready>>((resolve) => { release = resolve; }),
    });
    await render(dialog(client, first, "workflow-label"));
    await typeReason("Correct display wording");
    await press("Review change");
    const settleValidation = release;
    assert.ok(settleValidation !== undefined, "the dialog did not start validation");
    await act(async () => {
      root?.render(dialog(client, second, "workflow-label"));
    });
    await act(async () => { settleValidation(ready(explorerPresentationDraft(first, explorerPresentationChange(first, "workflow-label", first.label)))); });
    await settle();
    assert.equal(text().includes("Apply presentation change"), false);
    const label = document.body.querySelector("input");
    assert.ok(label instanceof HTMLInputElement, "the switched editor rendered no label input");
    assert.equal(label.value, second.label);
  });

  it("reports an acknowledged command with failed readback as applied but unverified", async () => {
    const { first } = servedWorkflows();
    const client = strictClient({
      validateExplorerEdit: async (draft) => ready(draft as ExplorerEditDraft),
      executeCommand: async (request) => {
        const command = request as { commandId: string; target: { workflowId: ExplorerWorkflowWire["id"]; expectedOverrideRevision: number } };
        return CommandResultSchema.parse({
          state: "applied",
          commandId: command.commandId,
          affectedTargets: [{ family: "explorer", workflowId: command.target.workflowId, revision: command.target.expectedOverrideRevision + 1 }],
        }) as CommandResult;
      },
      workflowExplorer: async () => { throw new Error("Explorer projection could not be refreshed"); },
    });
    await render(dialog(client, first, "workflow-label"));
    const label = document.body.querySelector("input");
    if (!(label instanceof HTMLInputElement)) throw new Error("Explorer editor rendered no label input");
    await act(async () => { setValue(label, `${first.label} reviewed`); });
    await typeReason("Correct display wording");
    await press("Review change");
    await press("Apply presentation change");
    assert.equal(text().includes("Explorer edit applied but unverified"), true);
    assert.equal(text().includes("Explorer edit was not applied"), false);
    assert.equal(text().includes("Apply presentation change"), false);
  });

  it("returns keyboard focus to the exact field-row edit door on close", async () => {
    const { wire, first } = servedWorkflows();
    const client = strictClient({
      bootstrap: async () => FIXTURE_BOOTSTRAP,
      workflowExplorer: async () => wire,
    });
    await render(createElement(DashboardClientProvider, {
      client,
      children: createElement(WorkflowExplorer, {
        workflowId: String(first.id),
        onWorkflow: () => undefined,
        onVersionRegistry: () => undefined,
        onClose: () => undefined,
      }),
    }));
    await settle();
    await settle();
    const door = button("Edit workflow icon");
    door.focus();
    await act(async () => { door.click(); });
    await settle();
    await press("Cancel");
    await act(async () => { await new Promise<void>((resolve) => window.setTimeout(resolve, 0)); });
    assert.equal(document.activeElement, door);
  });
});
