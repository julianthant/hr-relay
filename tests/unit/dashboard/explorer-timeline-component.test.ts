// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { WorkflowExplorer } from "../../../src/dashboard/surfaces/explorer.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { FIXTURE_BOOTSTRAP } from "../../parity/helpers/fixture-day.js";
import { EXPLORER_TIMELINE_PARENT_ID, EXPLORER_TIMELINE_WIRE } from "../../fixtures/explorer-timeline-wire.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

let root: Root | undefined;
let reads = 0;

afterEach(async () => {
  const mounted = root;
  root = undefined;
  if (mounted !== undefined) await act(async () => { mounted.unmount(); });
  document.body.replaceChildren();
  reads = 0;
});

function client(): DashboardClient {
  return new Proxy({
    bootstrap: async () => FIXTURE_BOOTSTRAP,
    workflowExplorer: async () => { reads += 1; return EXPLORER_TIMELINE_WIRE; },
  }, {
    get(target, property): unknown {
      const value = target[property as keyof typeof target];
      if (value === undefined) throw new Error(`timeline preview unexpectedly called client.${String(property)}`);
      return value;
    },
  }) as DashboardClient;
}

function app(workflowId: string): ReactElement {
  return createElement(DashboardClientProvider, {
    client: client(),
    children: createElement(WorkflowExplorer, {
      workflowId,
      onWorkflow: () => undefined,
      onVersionRegistry: () => undefined,
    }),
  });
}

async function update(workflowId: string): Promise<void> {
  await act(async () => { root?.render(app(workflowId)); });
  await act(async () => { await Promise.resolve(); });
}

async function render(workflowId = EXPLORER_TIMELINE_PARENT_ID): Promise<void> {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await update(workflowId);
}

function text(): string { return (document.body.textContent ?? "").replace(/\s+/gu, " "); }

function labelledSelect(label: string): HTMLSelectElement {
  const labelNode = [...document.querySelectorAll("label")].find((candidate) => candidate.textContent?.trim() === label);
  const select = labelNode?.htmlFor ? document.getElementById(labelNode.htmlFor) : undefined;
  if (!(select instanceof HTMLSelectElement)) throw new Error(`missing path selector ${label}`);
  return select;
}

async function choose(label: string, value: string): Promise<void> {
  const select = labelledSelect(label);
  const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  const setter = descriptor === undefined
    ? undefined
    : Reflect.get(descriptor, "set") as ((this: unknown, value: string) => void) | undefined;
  if (setter === undefined) throw new Error("jsdom select has no value setter");
  await act(async () => {
    Reflect.apply(setter, select, [value]);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((candidate) => (candidate.textContent ?? "").trim() === name);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`missing button ${name}`);
  return found;
}

describe("Workflow Explorer timeline interactions", () => {
  it("previews only selected downstream paths, preserves dependency rejoin, and never starts a run", async () => {
    await render();
    assert.match(text(), /Call child A/u);
    assert.doesNotMatch(text(), /Call child B/u);
    const routePanel = labelledSelect("Path preview for Select route").closest("li");
    assert.ok(routePanel?.textContent?.includes("Call child A"), "selected dependent work stays inside its branch panel");
    assert.match(text(), /Shared continuation/u);
    assert.match(text(), /rejoins after Select route/u);
    assert.match(text(), /Preview only; choosing a path does not start a workflow or run\./u);
    await choose("Path preview for Select route", "Route B");
    assert.match(text(), /Call child B/u);
    assert.doesNotMatch(text(), /Call child A/u);
    assert.ok(routePanel?.textContent?.includes("Call child B"), "changing the case updates the same branch panel");
    assert.match(text(), /Shared continuation/u);
    assert.equal(reads, 1, "changing the preview must not dispatch or reload a workflow");
  });

  it("keeps independent controllers and terminal no-rejoin choices separate", async () => {
    await render();
    await choose("Path preview for Select route", "Route B");
    await choose("Path preview for Independent route", "Skip");
    await choose("Path preview for Choose terminal path", "Stop");
    const visible = text();
    assert.match(visible, /Call child B/u);
    assert.match(visible, /Independent skipped step/u);
    assert.match(visible, /Stop here/u);
    assert.doesNotMatch(visible, /Late work|Late follow-up|Unjoined continuation/u);
    assert.match(visible, /No shared continuation is declared for these cases\./u);
  });

  it("keeps nested disclosure occurrences unique, exposes served policy facts, and states unavailable detail", async () => {
    await render();
    const nestedBranches = [...document.querySelectorAll("label")]
      .filter((label) => label.textContent?.trim().startsWith("Path preview for Child outcome in "));
    assert.equal(nestedBranches.length, 3, "the active child call sites each show their own child detail");
    const ids = nestedBranches.map((label) => label.htmlFor);
    assert.equal(new Set(ids).size, ids.length, "repeated child instances need occurrence-unique control ids");
    assert.equal(new Set(nestedBranches.map((label) => label.textContent?.trim())).size, 3, "repeated child controls need occurrence-specific names");
    await choose("Path preview for Child outcome in Call child A", "Stop");
    assert.equal((text().match(/Child stop/gu) ?? []).length, 1, "the nested choice affects one child occurrence");
    assert.equal((text().match(/Return path/gu) ?? []).length, 2, "the other repeated child occurrences keep their defaults");
    assert.match(text(), /Waits for child terminal state/u);
    assert.match(text(), /return route is not declared/u);
    assert.match(text(), /no join/u);
    for (const disclosure of [...document.querySelectorAll("button")].filter((candidate) => candidate.textContent?.trim() === "Delegation policy")) {
      await act(async () => { disclosure.click(); });
    }
    assert.match(text(), /On child failure: fail-parent/u);
    assert.match(text(), /On child failure: block-parent/u);
    assert.match(text(), /cancel: independent/u);
    assert.match(text(), /retry: manual-parent-resume/u);
    assert.match(text(), /Return policy and selectable child results are unavailable in the served metadata\./u);
    assert.match(text(), /Child workflow detail is unavailable in the served registry\./u);
    assert.doesNotMatch(text(), /Child result/u);
    await act(async () => { button("Call child collection").click(); });
    await act(async () => { button("Full contract").click(); });
    assert.match(text(), /joinall/u);
    assert.equal(reads, 1);
  });

  it("closes hidden node detail, restores its opener on close, and resets preview state by workflow", async () => {
    await render();
    const inspect = button("After A");
    inspect.focus();
    await act(async () => { inspect.click(); });
    assert.match(text(), /Close step inspection/u);
    await choose("Path preview for Select route", "Route B");
    assert.doesNotMatch(text(), /Close step inspection/u, "detail for a newly hidden node must close");
    const selectedInspect = button("After B");
    selectedInspect.focus();
    await act(async () => { selectedInspect.click(); });
    await act(async () => { button("Close step inspection").click(); });
    await act(async () => { await new Promise<void>((resolve) => window.setTimeout(resolve, 0)); });
    assert.equal(document.activeElement, selectedInspect);

    await act(async () => { button("Graph and source evidence").click(); });
    const evidenceNode = [...document.querySelectorAll("button")]
      .find((candidate) => candidate.textContent?.includes("after-b"));
    assert.ok(evidenceNode instanceof HTMLButtonElement, "the dependency graph should retain a keyboard-selectable detail door");
    evidenceNode.focus();
    await act(async () => { evidenceNode.click(); });
    assert.match(text(), /Close step inspection/u);
    await act(async () => { button("Close step inspection").click(); });
    await act(async () => { await new Promise<void>((resolve) => window.setTimeout(resolve, 0)); });
    assert.equal(document.activeElement, evidenceNode, "source graph detail close restores focus to its own opener");

    const childDisclosure = button("Nested timeline child steps for Call child B");
    await act(async () => { childDisclosure.click(); });
    assert.equal(childDisclosure.getAttribute("aria-expanded"), "false");

    await update("timeline-child");
    await update(EXPLORER_TIMELINE_PARENT_ID);
    assert.equal(labelledSelect("Path preview for Select route").value, "Route A");
    assert.equal(button("Nested timeline child steps for Call child A").getAttribute("aria-expanded"), "true");
    assert.equal(reads, 3);
  });

  it("keeps linear registered workflows free of empty branch controls and handles invalid links", async () => {
    await render("person-lookup");
    assert.equal(document.querySelectorAll("label").length, 0);
    assert.doesNotMatch(text(), /Path preview for/u);
    await update("separations");
    assert.match(text(), /a dry run stops here/u, "the write boundary remains in the primary timeline");
    assert.match(text(), /Transaction/u);
    await update("missing-workflow");
    assert.match(text(), /No workflow is registered as "missing-workflow"/u);
    assert.doesNotMatch(text(), /Path preview for/u);
  });
});
