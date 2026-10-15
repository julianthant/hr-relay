import { servedFixtureSources as previewFixtureSources } from "../../../parity/helpers/workflow-composition.js";
import { buildWorkflowCatalog } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterAll,afterEach,beforeAll,describe,it } from "vitest";
import { allFields } from "../../../../src/dashboard/surfaces/explorer/explorer-flow-model.js";
import { buildEmergencyContactMock,buildOnboardingMock,DEFAULT_MOCK_SCENARIO,EXPLORER_MOCK_WORKFLOWS,mockFieldSource,updateMockScenario } from "../../../../src/dashboard/surfaces/explorer/explorer-mock-fixtures.js";
import { WorkflowExplorer } from "../../../../src/dashboard/surfaces/explorer/explorer.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
beforeAll(() => Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => undefined }));
afterAll(() => {
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScroll);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});
async function render(): Promise<void> {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(createElement(WorkflowExplorer, { catalog: buildWorkflowCatalog([], true, previewFixtureSources([])) })));
}
function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((node) => node.getAttribute("aria-label") === name || node.textContent?.trim() === name);
  assert.ok(found instanceof HTMLButtonElement, `missing button ${name}`);
  return found;
}
async function click(name: string): Promise<void> { await act(async () => button(name).click()); }
async function chooseControl(label: string, value: string): Promise<void> {
  const trigger = document.querySelector(`[aria-label="${label}"]`);
  assert.ok(trigger instanceof HTMLButtonElement, `missing choice ${label}`);
  await act(async () => trigger.click());
  const option = document.querySelector(`[role="option"][data-value="${value}"]`);
  assert.ok(option instanceof HTMLElement, `missing option ${value}`);
  await act(async () => option.click());
}
async function chooseWorkflow(value: string): Promise<void> { await chooseControl("Explorer workflow", value); }
async function choose(label: string, value: string): Promise<void> { await chooseControl(`${label} preview`, value); }
function hidden(number: number): boolean {
  const node = document.getElementById(`explorer-step-${number}`);
  return node === null || node.hidden;
}

describe("frontend-only Explorer mock workflows", () => {
  it("lists launched systems first and defers contact authentication until review", () => {
    const onboarding = buildOnboardingMock(DEFAULT_MOCK_SCENARIO);
    assert.equal(onboarding.steps[0]?.title, "Open browser sessions");
    assert.deepEqual(onboarding.steps[0]?.parts, [{ kind: "sessions", systems: ["CRM", "UCPath", "I-9"] }]);
    assert.equal(onboarding.steps[1]?.number, 2);
    assert.equal(onboarding.steps[1]?.title, "Choose the hire type");
    assert.ok(onboarding.steps[1]?.parts.some(part => part.kind === "mock-choice" && part.id === "fixture-hire-mode"));
    assert.deepEqual(onboarding.steps.map(step => step.number), Array.from({ length: 11 }, (_, index) => index + 1));
    const contact = buildEmergencyContactMock(DEFAULT_MOCK_SCENARIO);
    assert.equal(contact.steps[0]?.title, "Open browser sessions");
    assert.deepEqual(contact.steps[0]?.parts[0], { kind: "sessions", systems: ["UCPath"] });
    assert.equal(contact.steps[1]?.title, "Extract the contact packet");
    assert.equal(contact.path.step, 3);
    const held = buildEmergencyContactMock({ ...DEFAULT_MOCK_SCENARIO, "fixture-contact-review": "pending" });
    assert.equal(held.stopAfter, 3);
    assert.ok(held.steps.find((step) => step.number === 5)?.parts.some((part) => part.kind === "action" && part.text === "Authenticate the per-person session after packet review"));
  });
  it("keeps fixture identifiers, unique field addresses and reachable sources on alternate paths", () => {
    assert.equal(EXPLORER_MOCK_WORKFLOWS.length, 3);
    assert.ok(EXPLORER_MOCK_WORKFLOWS.every((workflow) => workflow.id.startsWith("fixture-")));
    for (const scenario of [DEFAULT_MOCK_SCENARIO, { ...DEFAULT_MOCK_SCENARIO, "fixture-hire-mode": "rehire", "fixture-person": "matched" }, { ...DEFAULT_MOCK_SCENARIO, "fixture-i9": "present", "fixture-contact-address": "manual" }]) {
      for (const flow of [buildOnboardingMock(scenario), buildEmergencyContactMock(scenario)]) {
        const addresses = flow.steps.flatMap((step) => allFields(step.parts).map((field) => `${step.number}:${field.id}`));
        assert.equal(new Set(addresses).size, addresses.length);
        for (const step of flow.steps) for (const field of allFields(step.parts).filter((item) => item.mode === "fill")) {
          const source = mockFieldSource(field.source!);
          assert.ok(source, `${step.number}:${field.id} needs a source`);
          for (const read of source.reads ?? []) {
            const target = flow.steps.find((node) => node.number === read.step);
            assert.ok(target);
            if (read.fieldId) assert.ok(allFields(target.parts).some((item) => item.id === read.fieldId));
          }
        }
      }
    }
    assert.throws(() => updateMockScenario(DEFAULT_MOCK_SCENARIO, "unknown", "none"), /explorer-mock-choice-unknown/);
    assert.throws(() => updateMockScenario(DEFAULT_MOCK_SCENARIO, "fixture-person", "guess"), /explorer-mock-choice-invalid/);
  });
  it("holds onboarding writes, supports concurrent hire, and stages I-9 and Smart HR without filing during rehearsal", async () => {
    await render(); await chooseWorkflow("fixture-onboarding");
    await choose("Person search result", "review"); assert.equal(hidden(7), true);
    await choose("Person search result", "rejected"); assert.equal(hidden(10), true);
    await choose("Person search result", "none"); assert.equal(hidden(11), false);
    await choose("Hire type", "rehire"); assert.equal(hidden(7), true, "rehire cannot proceed without a matched EID");
    await choose("Person search result", "matched"); assert.equal(hidden(11), false);
    assert.match(document.getElementById("explorer-step-7")?.textContent ?? "", /Skip I-9 creation/);
    assert.match(document.getElementById("explorer-step-8")?.textContent ?? "", /UC_CONC_HIRE/);
    await choose("Hire rehearsal", "dry"); assert.equal(hidden(7), false); assert.equal(hidden(8), false); assert.equal(hidden(10), true);
    await choose("Hire type", "new"); await choose("Person search result", "none"); await choose("Hire rehearsal", "write");
    await choose("I-9 profile", "present");
    assert.match(document.getElementById("explorer-step-7")?.textContent ?? "", /reuse the existing profile ID/);
    assert.doesNotMatch(document.getElementById("explorer-step-7")?.textContent ?? "", /Create the I-9 profile/);
  });
  it("holds contact writes on review/identity, skips exact duplicates and keeps rollup after dry run", async () => {
    await render(); await chooseWorkflow("fixture-emergency-contact");
    await choose("Contact review", "pending"); assert.equal(hidden(4), true); assert.equal(hidden(5), true);
    await choose("Contact review", "rejected"); assert.equal(hidden(10), true);
    await choose("Contact review", "approved"); await choose("Contact identity", "mismatch"); assert.equal(hidden(6), true);
    await choose("Contact identity", "verified"); await choose("Existing contact", "exact");
    assert.equal(hidden(8), true); assert.equal(hidden(10), true); assert.equal(hidden(11), false);
    await choose("Existing contact", "fuzzy");
    assert.match(document.getElementById("explorer-step-7")?.textContent ?? "", /Demote the existing/);
    await choose("Contact rehearsal", "dry");
    assert.doesNotMatch(document.getElementById("explorer-step-7")?.textContent ?? "", /Demote the existing/);
    assert.equal(hidden(8), false); assert.equal(hidden(10), true); assert.equal(hidden(11), false);
    await choose("Contact address", "manual");
    await click("Show source for Street · city · state · postal code · country");
    assert.match(document.querySelector('[role="dialog"]')?.textContent ?? "", /Emergency Contact Form/);
    await click("Close field source");
    await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
    assert.equal(document.activeElement, button("Show source for Street · city · state · postal code · country"));
  });
});
