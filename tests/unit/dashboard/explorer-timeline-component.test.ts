// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import { WorkflowExplorerWireSchema } from "../../../src/domain/dashboard/explorer.js";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { WorkflowExplorer } from "../../../src/dashboard/surfaces/explorer/explorer.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { FIXTURE_BOOTSTRAP } from "../../parity/helpers/fixture-day.js";
import { EXPLORER_MULTI_TARGET_WIRE, EXPLORER_TIMELINE_PARENT_ID, EXPLORER_TIMELINE_WIRE } from "../../fixtures/explorer-timeline-wire.js";

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

function client(wire = EXPLORER_TIMELINE_WIRE): DashboardClient {
  return new Proxy({
    bootstrap: async () => FIXTURE_BOOTSTRAP,
    workflowExplorer: async () => { reads += 1; return wire; },
  }, {
    get(target, property): unknown {
      const value = target[property as keyof typeof target];
      if (value === undefined) throw new Error(`timeline preview unexpectedly called client.${String(property)}`);
      return value;
    },
  }) as DashboardClient;
}

function app(workflowId: string, wire = EXPLORER_TIMELINE_WIRE): ReactElement {
  return createElement(DashboardClientProvider, {
    client: client(wire),
    children: createElement(WorkflowExplorer, {
      workflowId,
      onWorkflow: () => undefined,
      onVersionRegistry: () => undefined,
    }),
  });
}

async function update(workflowId: string, wire = EXPLORER_TIMELINE_WIRE): Promise<void> {
  await act(async () => { root?.render(app(workflowId, wire)); });
  await act(async () => { await Promise.resolve(); });
}

async function render(workflowId = EXPLORER_TIMELINE_PARENT_ID, wire = EXPLORER_TIMELINE_WIRE): Promise<void> {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await update(workflowId, wire);
}

function text(): string { return (document.body.textContent ?? "").replace(/\s+/gu, " "); }

function labelledSelect(label: string): HTMLSelectElement {
  const select = [...document.querySelectorAll("select")].find((candidate) => candidate.getAttribute("aria-label") === label);
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
  const found = [...document.querySelectorAll("button")].find((candidate) => (candidate.textContent ?? "").trim() === name)
    ?? [...document.querySelectorAll("[title]")].find((candidate) => candidate.getAttribute("title") === name)?.querySelector("button");
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
    assert.ok(!routePanel?.textContent?.includes("After A"), "later parent work stays outside the scenario expansion");
    assert.equal(document.querySelectorAll('[aria-label="Inspect After A"]').length, 1);
    assert.match(text(), /Shared continuation/u);
    assert.match(text(), /rejoins after Select route/u);
    assert.match(text(), /Preview only; choosing a path does not start a workflow or run\./u);
    await choose("Path preview for Select route", "Route B");
    assert.match(text(), /Call child B/u);
    assert.doesNotMatch(text(), /Call child A/u);
    assert.ok(routePanel?.textContent?.includes("Call child B"), "changing the case updates the same branch panel");
    const context = document.querySelector('[aria-label="Workflow context"]')?.textContent ?? "";
    assert.match(context, /Continues without waiting/u, "context describes the active child policy");
    assert.doesNotMatch(context, /Call child A/u, "bypassed first child must leave the inspector");
    assert.match(context, /Call child B/u);
    assert.match(context, /Call child collection/u);
    assert.match(context, /Call child without join/u, "multiple active child occurrences stay explicit");
    assert.match(text(), /Shared continuation/u);
    assert.equal(reads, 1, "changing the preview must not dispatch or reload a workflow");
  });

  it("keeps display numbers distinct when a case contains two child occurrences", async () => {
    const wire = WorkflowExplorerWireSchema.parse({
      ...EXPLORER_TIMELINE_WIRE,
      workflows: EXPLORER_TIMELINE_WIRE.workflows.map(workflow => String(workflow.id) !== EXPLORER_TIMELINE_PARENT_ID ? workflow : {
        ...workflow,
        nodes: workflow.nodes.map(node => String(node.id) !== "route" || node.shape.kind !== "branch" ? node : {
          ...node, shape: { ...node.shape, cases: [...node.shape.cases, { name: "Both", nodes: ["call-a", "call-b"] }] },
        }),
        edges: [...workflow.edges,
          { from: "route", to: "call-a", kind: "branch-case", label: "Both" },
          { from: "route", to: "call-b", kind: "branch-case", label: "Both" },
        ],
      }),
    });
    await render(EXPLORER_TIMELINE_PARENT_ID, wire);
    await choose("Path preview for Select route", "Both");
    const firstNumber = (name: string): string | null | undefined => [...document.querySelectorAll("[title]")]
      .find(element => element.getAttribute("title") === `Nested timeline child steps for ${name}`)
      ?.querySelector(".explorer-child-step .explorer-step-heading > span")?.textContent;
    assert.equal(firstNumber("Call child A"), "2.1.1");
    assert.equal(firstNumber("Call child B"), "2.2.1");
    assert.equal(document.querySelectorAll('[title="Nested timeline child steps for Call child A"]').length, 1);
    assert.equal(document.querySelectorAll('[title="Nested timeline child steps for Call child B"]').length, 1);
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
    assert.equal(document.querySelectorAll('[aria-label="Inspect Shared continuation"]').length, 1, "the shared rejoin appears exactly once");
    assert.match(visible, /No shared continuation is declared for these cases\./u);
  });

  it("keeps nested disclosure occurrences unique, exposes served policy facts, and states unavailable detail", async () => {
    await render();
    const nestedBranches = [...document.querySelectorAll("select")]
      .filter((select) => select.getAttribute("aria-label")?.startsWith("Path preview for Child outcome in "));
    assert.equal(nestedBranches.length, 3, "the active child call sites each show their own child detail");
    const ids = nestedBranches.map((select) => select.id);
    assert.equal(document.querySelectorAll(".explorer-child-step .explorer-condition").length, 3, "compact child occurrences retain their authored condition");
    assert.match(text(), /includeOptional/u);
    assert.equal(new Set(ids).size, ids.length, "repeated child instances need occurrence-unique control ids");
    assert.equal(new Set(nestedBranches.map((select) => select.getAttribute("aria-label"))).size, 3, "repeated child controls need occurrence-specific names");
    await choose("Path preview for Child outcome in Call child A", "Stop");
    assert.equal((text().match(/Child stop/gu) ?? []).length, 1, "the nested choice affects one child occurrence");
    assert.equal((text().match(/Return path/gu) ?? []).length, 2, "the other repeated child occurrences keep their defaults");
    assert.match(text(), /Waits for Nested timeline child/u);
    assert.match(text(), /Return routing isn’t defined/u);

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
    await act(async () => { button("Inspect Call child collection").click(); });
    await act(async () => { button("Full contract").click(); });
    assert.match(text(), /joinall/u);
    assert.equal(reads, 1);
  });

  it("keeps one parent identity and keyboard-readable source warnings for every occurrence", async () => {
    await render();
    const context = document.querySelector('[aria-label="Workflow context"]');
    assert.ok(context);
    assert.equal([...context.querySelectorAll("dt")].filter(one => one.textContent === "Parent").length, 1);
    assert.equal(context.querySelectorAll(".explorer-context-child").length, 4);
    const detail = context.querySelector<HTMLButtonElement>(".explorer-source-details");
    assert.ok(detail);
    detail.focus();
    assert.equal(document.activeElement, detail);
    assert.equal(detail.getAttribute("aria-expanded"), "false");
    await act(async () => { detail.click(); });
    assert.equal(detail.getAttribute("aria-expanded"), "true");
    const warning = detail.closest(".explorer-source-warning");
    assert.match(warning?.textContent ?? "", /Attempted path.*Reason/u);
    assert.ok(warning?.querySelector("dd")?.textContent?.length);
    assert.equal(warning?.querySelector("a"), null, "unavailable source is not a working link");
  });

  it("groups an identical source path while retaining both roles", async () => {
    const wire = WorkflowExplorerWireSchema.parse({ ...EXPLORER_TIMELINE_WIRE, workflows: EXPLORER_TIMELINE_WIRE.workflows.map(workflow => ({ ...workflow, sources: { ...workflow.sources,
      descriptor: { state: "resolved", path: "tests/fixtures/explorer-timeline-wire.ts" },
      module: { state: "resolved", path: "tests/fixtures/explorer-timeline-wire.ts" },
    } })) });
    await render(EXPLORER_TIMELINE_PARENT_ID, wire);
    await act(async () => { button("Source").click(); });
    const popover = document.querySelector('[data-radix-popper-content-wrapper]');
    assert.ok(popover);
    assert.match(popover.textContent ?? "", /descriptor · module/u);
    assert.equal((popover.textContent?.match(/tests\/fixtures\/explorer-timeline-wire.ts/gu) ?? []).length, 1);
  });

  it("keeps distinct registered targets and nested child-run controls independent without mutations", async () => {
    await render("timeline-multi-target", EXPLORER_MULTI_TARGET_WIRE);
    const context = document.querySelector('[aria-label="Workflow context"]');
    const occurrences = [...context?.querySelectorAll(".explorer-context-child") ?? []];
    assert.equal(occurrences.length, 2);
    assert.match(occurrences[0]?.textContent ?? "", /Resolve identity call.*Identity resolver child/u);
    assert.match(occurrences[1]?.textContent ?? "", /Direct evidence call.*Identity evidence child/u);
    const nestedLabel = "Path preview for Evidence route in Resolve identity call → Nested evidence call";
    const directLabel = "Path preview for Evidence route in Direct evidence call";
    const nested = labelledSelect(nestedLabel);
    const direct = labelledSelect(directLabel);
    assert.notEqual(nested.id, direct.id);
    assert.equal(nested.value, "Check");
    assert.equal(direct.value, "Check");
    await choose(nestedLabel, "Skip");
    assert.equal(nested.value, "Skip");
    assert.equal(direct.value, "Check");
    const nestedOccurrence = [...document.querySelectorAll("[title]")].find(element => element.getAttribute("title") === "Identity evidence child steps for Nested evidence call");
    assert.match(nestedOccurrence?.textContent ?? "", /Skip evidence/u);
    assert.doesNotMatch(nestedOccurrence?.textContent ?? "", /Check evidence/u);
    assert.equal(reads, 1, "preview only reads the wire once; unexpected mutation client calls throw");
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
