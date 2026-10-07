import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { ExplorerNodeWire, ExplorerWorkflowWire } from "../../../../../src/models/dashboard/explorer.js";
import { explorerTimelineContainment, explorerTimelineOrder, explorerTimelinePath } from "../../../../../src/dashboard/surfaces/explorer-model.js";
import { FIXTURE_EXPLORER_WIRE } from "../../../../support/fixtures/dashboard/fixture-explorer.js";

const template = FIXTURE_EXPLORER_WIRE.workflows[0];
if (template === undefined) throw new Error("missing Explorer fixture");
const task = template.nodes[0];
if (task === undefined) throw new Error("missing Explorer task fixture");

type TimelineShape = ExplorerNodeWire["shape"];

function node(id: string, dependsOn: readonly string[] = [], shape: TimelineShape = task.shape): ExplorerNodeWire {
  return { ...task, id: id as ExplorerNodeWire["id"], label: id, dependsOn: dependsOn as ExplorerNodeWire["dependsOn"], shape };
}

function workflow(
  nodes: readonly ExplorerNodeWire[],
  timelineNodes: readonly ExplorerNodeWire[] = nodes,
): ExplorerWorkflowWire {
  return {
    ...template,
    nodes: [...nodes],
    timeline: timelineNodes.map((one) => ({ key: String(one.id), label: one.label, nodes: [one.id] })),
    edges: nodes.flatMap((one) => [
      ...one.dependsOn.map((from) => ({ from, to: one.id, kind: "depends-on" as const })),
      ...(one.shape.kind === "branch"
        ? one.shape.cases.flatMap((branchCase) => branchCase.nodes.map((to) => ({
          from: one.id, to, kind: "branch-case" as const, label: branchCase.name,
        })))
        : []),
      ...(one.shape.kind === "parallel"
        ? one.shape.branches.flatMap((parallelBranch) => parallelBranch.nodes.map((to) => ({
          from: one.id, to, kind: "parallel-branch" as const, label: parallelBranch.id,
        })))
        : []),
    ]),
  };
}

const branch = (cases: readonly { name: string; nodes: readonly string[] }[]): TimelineShape => ({
  kind: "branch",
  cases: cases.map((one) => ({ name: one.name, nodes: one.nodes as ExplorerNodeWire["id"][] })),
});

const parallel = (branches: readonly { id: string; nodes: readonly string[] }[]): TimelineShape => ({
  kind: "parallel",
  join: "all",
  branches: branches.map((one) => ({ id: one.id, nodes: one.nodes as ExplorerNodeWire["id"][] })),
});

function visibleIds(graph: ExplorerWorkflowWire, hidden: ReadonlySet<string>): string[] {
  return explorerTimelineOrder(graph).filter((one) => !hidden.has(String(one.id))).map((one) => String(one.id));
}

describe("Explorer branching timeline", () => {
  it("keeps dependency order independent of node and edge input order while ties follow the timeline", () => {
    const fork = node("fork", [], parallel([
      { id: "left", nodes: ["left-step"] },
      { id: "right", nodes: ["right-step"] },
    ]));
    const right = node("right-step");
    const left = node("left-step");
    const join = node("join", ["left-step", "right-step"]);
    const graph = workflow([left, join, fork, right], [fork, right, left, join]);
    const permuted = { ...graph, nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() };

    assert.deepEqual(explorerTimelineOrder(graph).map((one) => String(one.id)), [
      "fork", "right-step", "left-step", "join",
    ]);
    assert.deepEqual(explorerTimelineOrder(permuted).map((one) => String(one.id)), [
      "fork", "right-step", "left-step", "join",
    ]);
    assert.equal(graph.edges.some((edge) => edge.kind === "depends-on"
      && ((String(edge.from) === "left-step" && String(edge.to) === "right-step")
        || (String(edge.from) === "right-step" && String(edge.to) === "left-step"))), false);
  });

  it("changes only case-dependent work and retains the dependency-proven shared continuation", () => {
    const graph = workflow([
      node("start"),
      node("prepared", ["start"]),
      node("choice", ["prepared"], branch([
        { name: "A", nodes: ["a"] },
        { name: "B", nodes: ["b"] },
      ])),
      node("a", ["prepared"]),
      node("b", ["prepared"]),
      node("after-a", ["a"]),
      node("after-b", ["b"]),
      node("continuation", ["after-a", "after-b"]),
      node("independent"),
    ]);
    const a = explorerTimelinePath(graph, { choice: "A" });
    const b = explorerTimelinePath(graph, { choice: "B" });
    const visibleA = visibleIds(graph, a.hidden);
    const visibleB = visibleIds(graph, b.hidden);
    const stable = ["start", "prepared", "choice", "continuation", "independent"];
    const changed = ["a", "after-a", "b", "after-b"];

    assert.deepEqual(visibleA.filter((id) => stable.includes(id)), stable);
    assert.deepEqual(visibleB.filter((id) => stable.includes(id)), stable);
    assert.deepEqual([...new Set([...visibleA, ...visibleB])].filter((id) => changed.includes(id)).sort(), [...changed].sort());
    assert.deepEqual(visibleA.filter((id) => changed.includes(id)), ["a", "after-a"]);
    assert.deepEqual(visibleB.filter((id) => changed.includes(id)), ["b", "after-b"]);
    assert.deepEqual([...a.selected].sort(), ["a", "after-a"]);
    assert.deepEqual([...b.selected].sort(), ["after-b", "b"]);
    assert.ok(a.rejoins.has("continuation"));
    assert.ok(b.rejoins.has("continuation"));
    assert.deepEqual(a.rejoinAt.get("continuation"), ["choice"]);
    assert.deepEqual(b.rejoinAt.get("continuation"), ["choice"]);
  });

  it("does not show controller-only or later work after a terminal nonjoining case", () => {
    const graph = workflow([
      node("choice", [], branch([
        { name: "Continue", nodes: ["work"] },
        { name: "Stop", nodes: ["stop"] },
      ])),
      node("work", ["choice"]),
      node("stop", ["choice"]),
      node("step-5", ["work"]),
      node("unjoined-continuation", ["choice"]),
      node("independent"),
    ]);
    const selected = explorerTimelinePath(graph, { choice: "Stop" });
    const visible = visibleIds(graph, selected.hidden);

    assert.ok(visible.includes("stop"));
    assert.ok(visible.includes("independent"));
    assert.ok(!visible.includes("work"));
    assert.ok(!visible.includes("step-5"));
    assert.ok(!visible.includes("unjoined-continuation"));
    assert.ok(selected.branchesWithoutRejoin.has("choice"));
    assert.equal(selected.rejoins.size, 0);
  });

  it("applies choices from two independent controllers without crossing their paths", () => {
    const graph = workflow([
      node("first", [], branch([{ name: "A", nodes: ["first-a"] }, { name: "B", nodes: ["first-b"] }])),
      node("first-a", ["first"]),
      node("first-b", ["first"]),
      node("second", [], branch([{ name: "X", nodes: ["second-x"] }, { name: "Y", nodes: ["second-y"] }])),
      node("second-x", ["second"]),
      node("second-y", ["second"]),
      node("independent"),
    ]);
    const selected = explorerTimelinePath(graph, { first: "B", second: "Y" });
    const visible = visibleIds(graph, selected.hidden);

    assert.ok(visible.includes("first-b"));
    assert.ok(visible.includes("second-y"));
    assert.ok(visible.includes("independent"));
    assert.ok(!visible.includes("first-a"));
    assert.ok(!visible.includes("second-x"));
  });

  it("omits nested alternatives when their controller is inactive and applies the nested choice when active", () => {
    const graph = workflow([
      node("outer", [], branch([{ name: "Nested", nodes: ["inner"] }, { name: "Direct", nodes: ["direct"] }])),
      node("inner", ["outer"], branch([{ name: "X", nodes: ["x"] }, { name: "Y", nodes: ["y"] }])),
      node("x", ["inner"]),
      node("y", ["inner"]),
      node("direct", ["outer"]),
    ]);
    const inactive = explorerTimelinePath(graph, { outer: "Direct", inner: "X" });
    const active = explorerTimelinePath(graph, { outer: "Nested", inner: "Y" });

    assert.ok(inactive.hidden.has("inner"));
    assert.ok(inactive.hidden.has("x"));
    assert.ok(inactive.hidden.has("y"));
    assert.ok(!inactive.hidden.has("direct"));
    assert.ok(active.hidden.has("x"));
    assert.ok(!active.hidden.has("inner"));
    assert.ok(!active.hidden.has("y"));
    assert.ok(!active.selected.has("x"));
    assert.ok(active.selected.has("y"));
    assert.deepEqual([...explorerTimelineContainment(graph, { outer: "Nested", inner: "Y" }, active)], [["inner", "outer"], ["y", "inner"]]);
    assert.deepEqual([...explorerTimelineContainment(graph, { outer: "Direct", inner: "X" }, inactive)], [["direct", "outer"]]);
  });

  it("contains shared selected members once and leaves downstream work and rejoin outside", () => {
    const graph = workflow([
      node("first", [], branch([{ name: "On", nodes: ["common"] }, { name: "Off", nodes: ["first-off"] }])),
      node("second", [], branch([{ name: "On", nodes: ["common"] }, { name: "Off", nodes: ["second-off"] }])),
      node("common", ["first", "second"]),
      node("next", ["common"]),
      node("first-off", ["first"]),
      node("second-off", ["second"]),
      node("rejoin", ["next", "first-off", "second-off"]),
    ]);
    const cases = { first: "On", second: "On" };
    const path = explorerTimelinePath(graph, cases);
    const owner = explorerTimelineContainment(graph, cases, path);
    assert.equal(owner.get("common"), "first");
    assert.equal([...owner.keys()].filter((id) => id === "common").length, 1);
    assert.equal(owner.has("next"), false);
    assert.equal(owner.has("rejoin"), false);
    assert.equal(path.hidden.has("rejoin"), false);
  });

  it("uses authored branch-case names without mapping executable scenario ids", () => {
    const scenarioId = String(template.scenarios[0]?.scenarioId ?? "registered-executable-scenario");
    const authoredA = "authored:" + scenarioId + ":A";
    const authoredB = "authored:" + scenarioId + ":B";
    const graph = workflow([
      node("choice", [], branch([
        { name: authoredA, nodes: ["a"] },
        { name: authoredB, nodes: ["b"] },
      ])),
      node("a", ["choice"]),
      node("b", ["choice"]),
    ]);
    const byCaseName = explorerTimelinePath(graph, { choice: authoredB });
    const byScenarioId = explorerTimelinePath(graph, { choice: scenarioId });

    assert.notEqual(authoredA, scenarioId);
    assert.notEqual(authoredB, scenarioId);
    assert.ok(byCaseName.hidden.has("a"));
    assert.ok(!byCaseName.hidden.has("b"));
    assert.ok(!byScenarioId.hidden.has("a"));
    assert.ok(byScenarioId.hidden.has("b"));
  });

  it("ignores stale selected cases after a workflow change and resets an invalid current case", () => {
    const graph = workflow([
      node("choice", [], branch([
        { name: "Current A", nodes: ["current-a"] },
        { name: "Current B", nodes: ["current-b"] },
      ])),
      node("current-a", ["choice"]),
      node("current-b", ["choice"]),
    ]);
    const staleController = explorerTimelinePath(graph, { previousChoice: "B" });
    const staleCase = explorerTimelinePath(graph, { choice: "B" });

    assert.ok(!staleController.hidden.has("current-a"));
    assert.ok(staleController.hidden.has("current-b"));
    assert.ok(!staleCase.hidden.has("current-a"));
    assert.ok(staleCase.hidden.has("current-b"));
  });

  it("refuses empty or malformed branch metadata and refuses disagreement with served edges", () => {
    const valid = workflow([
      node("choice", [], branch([{ name: "A", nodes: ["a"] }, { name: "B", nodes: ["b"] }])),
      node("a", ["choice"]),
      node("b", ["choice"]),
    ]);
    const empty = workflow([
      node("choice", [], branch([{ name: "A", nodes: [] }, { name: "B", nodes: ["b"] }])),
      node("b", ["choice"]),
    ]);
    const unknown = workflow([
      node("choice", [], branch([{ name: "A", nodes: ["missing"] }, { name: "B", nodes: ["b"] }])),
      node("b", ["choice"]),
    ]);
    const mismatch = {
      ...valid,
      edges: valid.edges.filter((edge) => edge.kind !== "branch-case" || edge.label !== "A"),
    };

    assert.throws(() => explorerTimelinePath(empty, {}), /case A has no nodes/u);
    assert.throws(() => explorerTimelinePath(unknown, {}), /names unknown node missing/u);
    assert.throws(() => explorerTimelinePath(mismatch, {}), /edges disagree/u);
  });

  it("keeps a declared child policy and nested workflow graph in the wire", () => {
    const child = template;
    const parent = workflow([node("call", [], {
      kind: "child-run", edgeId: "lookup", targetWorkflowId: child.id,
      cardinality: "many", await: "terminal", join: "all-settled",
      onChildFailed: "block-parent", cascadeCancel: "cascade",
      afterChildRetry: "manual-parent-resume", visibility: "inline",
    })]);
    const call = explorerTimelineOrder(parent)[0];
    assert.equal(call?.shape.kind, "child-run");
    if (call?.shape.kind !== "child-run") return;
    assert.equal(call.shape.targetWorkflowId, child.id);
    assert.equal(call.shape.join, "all-settled");
    assert.ok(explorerTimelineOrder(child).length > 0);
  });
});
