// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import type { DashboardClient } from "../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import { OperationObservedGroup, OperationTimeline } from "../../../../src/dashboard/surfaces/operation-structure.js";
import { OperationSourceNavigation } from "../../../../src/dashboard/surfaces/operation-source-navigation.js";
import { definitionActionAddress, operationAddress } from "../../../../src/dashboard/surfaces/operation-structure-model.js";
import { OperationActionObservationWireSchema } from "../../../../src/domain/dashboard/operation-structure.js";
import { freezeWorkflowOperationDisplaySnapshot } from "../../../../src/domain/workflow/operation-display-snapshot.js";
import { plan1Leaf } from "../../../fixtures/plan1-operation-workflows.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
const frames: FrameRequestCallback[] = [];
Reflect.set(globalThis, "requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
Reflect.set(globalThis, "cancelAnimationFrame", () => undefined);
Element.prototype.scrollIntoView = () => undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); frames.length = 0; });
const base = freezeWorkflowOperationDisplaySnapshot({ display: plan1Leaf.descriptor.operationDisplay, workflowId: plan1Leaf.descriptor.id, definitionFingerprint: plan1Leaf.descriptor.contractFingerprint })!;
const template = { id: "comment", variables: [{ id: "text", slot: "text" }], segments: [{ kind: "literal" as const, value: "Exact: " }, { kind: "variable" as const, variable: "text" }, { kind: "optional" as const, when: { kind: "equals" as const, variable: "text", value: "yes" }, segments: [{ kind: "literal" as const, value: ". Conditional." }] }], join: { separator: "", trim: "none" as const } };
const definition = { ...base, invocations: base.invocations.map((invocation) => ({ ...invocation, operation: { ...invocation.operation, templates: [template], actions: [
  { id: "form", kind: "open-page" as const, label: "Evidence form", children: [...invocation.operation.actions, { id: "fill-text", kind: "fill-field" as const, label: "Comments", valueSlot: "text", templateId: "comment", confirmationActionId: "verify-fill-text" }, { id: "verify-fill-text", kind: "verify" as const }], outcomes: [{ id: "yes", label: "Matched", when: { kind: "equals" as const, variable: "text", value: "yes" } }] },
] } })) };
const runId = "00000000-0000-4000-8000-000000000001";
const source = OperationActionObservationWireSchema.parse({ logId: runId, at: "2026-09-29T12:00:00Z", action: "read", targetId: "consume-text", occurrence: {
  runId, definitionFingerprint: definition.definitionFingerprint, invocationId: "first-operation", occurrencePath: ["first"], nodeId: "first", taskId: "ocr/extract-form-page", logicalActionId: "consume-text", logicalSessionId: "plan1-local", attempt: 1, claimGeneration: 1, taskAttempt: 1, occurrence: 1, state: "completed",
  value: { slot: "text", fieldPath: "text", producer: { kind: "run-input", path: "text" }, state: "observed", classification: "local-operator", value: "yes" },
} });
const { value: _sourceValue, ...identity } = source.occurrence;
const filled = OperationActionObservationWireSchema.parse({ ...source, logId: "00000000-0000-4000-8000-000000000002", action: "typed", targetId: "fill-text", occurrence: { ...source.occurrence, logicalActionId: "fill-text", occurrence: 2, state: "confirmed", confirmation: { verificationActionId: "verify-fill-text", verificationOccurrence: 3, verifiedAt: "2026-09-29T12:00:01Z" }, value: { ...source.occurrence.value, producer: { kind: "task-output", entryId: "first", path: "text", source: identity }, value: "Exact: yes. Conditional." } } });

const button = (name: string) => {
  const found = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === name);
  if (found === undefined) throw new Error(`missing button ${name}`);
  return found;
};
async function click(name: string) { await act(async () => button(name).click()); }
async function mount(element: ReturnType<typeof createElement>) { const host = document.createElement("div"); document.body.append(host); root = createRoot(host); await act(async () => root?.render(element)); }
async function animate() { await act(async () => { while (frames.length > 0) frames.shift()!(0); }); }

describe("shared operation interactions", () => {
  it("keeps result footers visible when every form is collapsed", async () => {
    await mount(createElement(OperationTimeline, { definition }));
    assert.equal(document.querySelectorAll(".operation-form-body").length, 2);
    await click("Collapse all");
    assert.equal(document.querySelectorAll(".operation-form-body").length, 0);
    assert.equal(document.querySelectorAll(".operation-read-footer").length, 2);
    await click("Expand all");
    assert.equal(document.querySelectorAll(".operation-form-body").length, 2);
  });
  it("uses the runtime template grammar for an explicit Explorer preview", async () => {
    await mount(createElement(OperationTimeline, { definition }));
    const input = document.querySelector('input[aria-label="Comments preview text"]');
    assert.ok(input instanceof HTMLInputElement);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "yes");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert.match(document.querySelector(".operation-template-preview")?.textContent ?? "", /Exact: yes\. Conditional\./u);
    assert.equal(document.querySelectorAll(".operation-template-clause").length, 2);
    assert.ok(document.getElementById(definitionActionAddress("first-operation", "fill-text")));
  });
  it("reveals the exact loaded diagnostic source, highlights it, and restores focus on Escape", async () => {
    let reads = 0;
    const client = new Proxy({ operationSource: async () => { reads += 1; return { state: "found", structure: { state: "observed", runId, definition, observations: [source] } }; } }, { get(target, property) { if (!Object.hasOwn(target, property)) throw new Error(`unexpected client.${String(property)}`); return target[property as keyof typeof target]; } }) as unknown as DashboardClient;
    await mount(createElement(DashboardClientProvider, { client, children: createElement(OperationSourceNavigation, { observations: [source, filled], children: createElement(OperationObservedGroup, { definition, observations: [source, filled], ownerRunId: runId }) }) }));
    assert.equal(document.querySelectorAll(".operation-template-inputs").length, 0, "Logs never expose scenario/template editors");
    const trigger = button("Step first · text");
    await click("Step first · text");
    await click("Go to field in logs");
    await animate();
    const exact = document.getElementById(`operation-${operationAddress(identity)}`);
    assert.ok(exact);
    assert.equal(exact.getAttribute("data-operation-highlight"), "true");
    assert.equal(document.activeElement, exact);
    assert.equal(reads, 1);
    await act(async () => exact.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    assert.equal(document.activeElement, trigger);
    assert.equal(document.querySelectorAll("[data-operation-highlight=true]").length, 0);
  });
});
