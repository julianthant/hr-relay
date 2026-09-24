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
import { CommandResultSchema } from "../../../src/domain/commands.js";
import { manualClock } from "../../../src/domain/clock.js";
import { FingerprintSchema } from "../../../src/domain/ids.js";
import { buildWorkflowExplorer } from "../../../src/server/dashboard/queries/explorer.js";
import { createExplorerEditService, buildExplorerCompileAttestation } from "../../../src/server/dashboard/commands/explorer-edit-service.js";
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
  const deps = explorerQueryDeps(CLOCK, HASH);
  const wire = buildWorkflowExplorer(deps);
  const first = wire.workflows[0];
  if (first === undefined) throw new Error("fixture needs one Explorer workflow");
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
    compileAttestation: buildExplorerCompileAttestation(deps, first),
  });
}

function strictClient(served: Partial<DashboardClient>): DashboardClient {
  return new Proxy(served, {
    get(target, property): unknown {
      const value: unknown = target[property as keyof DashboardClient];
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

/**
 * By ACCESSIBLE name, not by text. D299 made the presentation edit doors
 * icon-only, so the name a keyboard operator hears — `Edit workflow icon` —
 * lives on `aria-label` and the button's own subtree is one `aria-hidden`
 * glyph. Matching text alone would find no door and report it as a missing
 * control rather than as a renamed one.
 */
function button(name: string): HTMLButtonElement {
  const accessibleName = (candidate: HTMLButtonElement): string => {
    const own = (candidate.textContent ?? "").trim();
    return own.length > 0 ? own : (candidate.getAttribute("aria-label") ?? "").trim();
  };
  const matches = [...document.body.querySelectorAll("button")]
    .filter((candidate) => accessibleName(candidate) === name);
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
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  const setter = descriptor === undefined
    ? undefined
    : Reflect.get(descriptor, "set") as ((this: unknown, next: string) => void) | undefined;
  if (setter === undefined) throw new Error(`jsdom has no value setter for ${node.tagName}`);
  Reflect.apply(setter, node, [value]);
  node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

async function typeReason(value: string): Promise<void> {
  const node = document.body.querySelector("textarea");
  if (!(node instanceof HTMLTextAreaElement)) throw new Error("Explorer editor rendered no reason field");
  await act(async () => { setValue(node, value); });
}

function dialog(client: DashboardClient, workflow: ExplorerWorkflowWire, field: "workflow-label" | "workflow-icon" | "workflow-category", actorId = ACTOR_ID) {
  return createElement(DashboardClientProvider, {
    client,
    children: createElement(ExplorerEditDialog, {
      workflow,
      field,
      actorId,
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
    assert.equal(button("Review change").disabled, false, "draft invalidation must clear the stale validation busy state");
    await act(async () => { settleValidation(ready(explorerPresentationDraft(first, explorerPresentationChange(first, "workflow-label", first.label)))); });
    await settle();
    assert.equal(document.body.querySelector("button")?.textContent?.includes("Apply presentation change") ?? false, false);
    assert.equal(button("Review change").disabled, false, "a late stale validation must not re-wedge the editor");
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
    await typeReason("Correct the second workflow display wording");
    assert.equal(button("Review change").disabled, false, "target reset must clear the stale validation busy state");
    await act(async () => { settleValidation(ready(explorerPresentationDraft(first, explorerPresentationChange(first, "workflow-label", first.label)))); });
    await settle();
    assert.equal(text().includes("Apply presentation change"), false);
    assert.equal(button("Review change").disabled, false, "a late prior-target response must not re-wedge the new target");
    const label = document.body.querySelector("input");
    assert.ok(label instanceof HTMLInputElement, "the switched editor rendered no label input");
    assert.equal(label.value, second.label);
  });

  it("returns to enabled validation after closing an in-flight review and ignores its late response", async () => {
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
    await press("Cancel");
    assert.equal(button("Review change").disabled, false, "close must clear the stale validation busy state");
    await act(async () => { settleValidation(ready(explorerPresentationDraft(first, explorerPresentationChange(first, "workflow-label", first.label)))); });
    await settle();
    assert.equal(text().includes("Apply presentation change"), false);
    assert.equal(button("Review change").disabled, false, "a late closed-editor response must remain ignored");
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
        });
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

  it.each(["conflict", "rejected"] as const)("treats a foreign %s command result as unknown, not not-applied", async (state) => {
    const { first } = servedWorkflows();
    const client = strictClient({
      validateExplorerEdit: async (draft) => ready(draft as ExplorerEditDraft),
      executeCommand: async () => CommandResultSchema.parse(
        state === "conflict"
          ? {
            state,
            commandId: "11111111-1111-4111-8111-111111111111",
            currentVersion: first.edit.overrideRevision + 1,
            message: "a foreign command conflicted",
          }
          : {
            state,
            commandId: "11111111-1111-4111-8111-111111111111",
            code: "policy-refused",
            message: "a foreign command was refused",
          },
      ),
    });
    await render(dialog(client, first, "workflow-label"));
    const label = document.body.querySelector("input");
    if (!(label instanceof HTMLInputElement)) throw new Error("Explorer editor rendered no label input");
    await act(async () => { setValue(label, `${first.label} reviewed`); });
    await typeReason("Correct display wording");
    await press("Review change");
    await press("Apply presentation change");
    assert.equal(text().includes("Explorer edit result is unknown"), true);
    assert.equal(text().includes("Explorer edit was not applied"), false);
    assert.equal(text().includes("Apply presentation change"), false);
  });

  it.each(["workflow-label", "workflow-icon", "workflow-category"] as const)(
    "retains the exact %s success through the real parent readback and reopens on the new revision",
    async (field) => {
      const { wire, first } = servedWorkflows();
      const value = field === "workflow-label" ? `${first.label} reviewed`
        : (field === "workflow-icon" ? first.edit.presentation.iconValues : first.edit.presentation.categoryValues)
          .find((option) => option !== (field === "workflow-icon" ? first.icon : first.category));
      assert.ok(value !== undefined);
      const draft = explorerPresentationDraft(first, explorerPresentationChange(first, field, value));
      const validator = createExplorerEditService({ explorer: explorerQueryDeps(CLOCK, HASH), overrides: { read: () => undefined, readAll: () => [] } });
      const validated = validator.validate(draft);
      assert.equal(validated.state, "ready-to-apply");
      if (validated.state !== "ready-to-apply") throw new Error("valid presentation control refused");
      const fresh = { ...wire, workflows: wire.workflows.map((workflow) => workflow.id === first.id
        ? { ...workflow, ...validated.override.presentation, edit: { ...workflow.edit, overrideRevision: validated.override.revision } }
        : workflow) };
      let commands = 0;
      let reads = 0;
      const client = strictClient({
        bootstrap: async () => FIXTURE_BOOTSTRAP,
        validateExplorerEdit: async (requested) => {
          assert.deepEqual(requested, draft);
          return validator.validate(requested);
        },
        workflowExplorer: async () => ++reads === 1 ? wire : fresh,
        executeCommand: async (request) => {
          const command = request as { commandId: string; requestedBy: string; reason: string; payload: unknown; target: unknown };
          commands += 1;
          assert.equal(command.requestedBy, ACTOR_ID);
          assert.equal(command.reason, "Correct presentation");
          assert.deepEqual(command.payload, { changes: draft.changes });
          assert.deepEqual(command.target, { workflowId: first.id, expectedVersion: first.version, contractFingerprint: first.contractFingerprint, expectedOverrideRevision: 0 });
          return CommandResultSchema.parse({ state: "applied", commandId: command.commandId,
            affectedTargets: [{ family: "explorer", workflowId: first.id, revision: 1 }] });
        },
      });
      await render(createElement(DashboardClientProvider, { client, children: createElement(WorkflowExplorer, {
        workflowId: String(first.id), onWorkflow: () => undefined, onVersionRegistry: () => undefined,
      }) }));
      await settle();
      const door = button(`Edit ${field.replace("-", " ")}`);
      await press(`Edit ${field.replace("-", " ")}`);
      const input = document.body.querySelector(field === "workflow-label" ? "input" : "select");
      assert.ok(input instanceof HTMLInputElement || input instanceof HTMLSelectElement);
      await act(async () => { setValue(input, value); });
      await typeReason("Correct presentation");
      await press("Review change");
      await press("Apply presentation change");
      assert.equal(commands, 1);
      assert.equal(reads, 2);
      assert.match(text(), /Applied and read back exactly/u);
      assert.match(text(), /override r1/u);
      assert.equal(text().includes("Review change"), false);
      assert.equal(text().includes("Apply presentation change"), false);
      const close = [...document.body.querySelectorAll("button")].find((candidate) => candidate.textContent === "Close");
      assert.ok(close !== undefined, "the success footer must offer Close");
      await act(async () => { close.click(); });
      await act(async () => { await new Promise<void>((resolve) => window.setTimeout(resolve, 0)); });
      assert.equal(document.activeElement, door);
      await press(`Edit ${field.replace("-", " ")}`);
      assert.equal(text().includes("Applied and read back exactly"), false);
      const reopened = document.body.querySelector(field === "workflow-label" ? "input" : "select");
      assert.ok(reopened instanceof HTMLInputElement || reopened instanceof HTMLSelectElement);
      assert.equal(reopened.value, value);
      assert.equal(button("Review change").disabled, true);
      assert.equal(commands, 1);
    },
  );

  it.each(["actor", "value"] as const)("drops late validation after the %s changes", async (changed) => {
    const { first } = servedWorkflows();
    let release: ((result: ReturnType<typeof ready>) => void) | undefined;
    const draft = explorerPresentationDraft(first, explorerPresentationChange(first, "workflow-label", first.label));
    const client = strictClient({ validateExplorerEdit: async () => new Promise((resolve) => { release = resolve; }) });
    await render(dialog(client, first, "workflow-label"));
    await typeReason("Review original value");
    await press("Review change");
    if (changed === "actor") await act(async () => { root?.render(dialog(client, first, "workflow-label", "other-operator")); });
    else {
      const input = document.body.querySelector("input");
      assert.ok(input instanceof HTMLInputElement);
      await act(async () => { setValue(input, "A different label"); });
    }
    assert.ok(release);
    await act(async () => { release?.(ready(draft)); });
    assert.equal(text().includes("Apply presentation change"), false);
  });

  it.each(["target", "actor", "close"] as const)("ignores a late apply response after %s invalidates the editor", async (changed) => {
    const { first, second } = servedWorkflows();
    let release: (() => void) | undefined;
    let reads = 0;
    const client = strictClient({
      validateExplorerEdit: async (draft) => ready(draft as ExplorerEditDraft),
      executeCommand: async (request) => new Promise((resolve) => {
        const command = request as { commandId: string };
        release = () => resolve(CommandResultSchema.parse({ state: "applied", commandId: command.commandId,
          affectedTargets: [{ family: "explorer", workflowId: first.id, revision: 1 }] }));
      }),
      workflowExplorer: async () => { reads += 1; return servedWorkflows().wire; },
    });
    await render(dialog(client, first, "workflow-label"));
    await typeReason("Review presentation");
    await press("Review change");
    await press("Apply presentation change");
    if (changed === "close") await press("Cancel");
    else await act(async () => { root?.render(dialog(client, changed === "target" ? second : first, "workflow-label", changed === "actor" ? "other-operator" : ACTOR_ID)); });
    assert.ok(release);
    await act(async () => { release?.(); });
    assert.equal(reads, 0, "a retired editor must not publish another target's readback");
    assert.equal(text().includes("Applied and read back exactly"), false);
    assert.equal(text().includes("Explorer edit applied but unverified"), false);
  });

  it("does not publish readback that arrives after close/reopen", async () => {
    const { wire, first } = servedWorkflows();
    let release: ((fresh: typeof wire) => void) | undefined;
    const client = strictClient({
      validateExplorerEdit: async (draft) => ready(draft as ExplorerEditDraft),
      executeCommand: async (request) => CommandResultSchema.parse({ state: "applied", commandId: (request as { commandId: string }).commandId,
        affectedTargets: [{ family: "explorer", workflowId: first.id, revision: 1 }] }),
      workflowExplorer: async () => new Promise((resolve) => { release = resolve; }),
    });
    await render(dialog(client, first, "workflow-label"));
    await typeReason("Review presentation");
    await press("Review change");
    await press("Apply presentation change");
    assert.ok(release);
    await press("Cancel");
    await act(async () => { root?.render(createElement("div")); });
    await act(async () => { root?.render(dialog(client, first, "workflow-label")); });
    await act(async () => { release?.({ ...wire, workflows: [{ ...first, edit: { ...first.edit, overrideRevision: 1 } }] }); });
    assert.equal(text().includes("Applied and read back exactly"), false);
    assert.equal(button("Review change").disabled, true);
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
