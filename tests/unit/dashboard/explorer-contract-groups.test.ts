/**
 * D302 — the node panel's contract is one CARD per task arm, an Inputs and an
 * Outputs group inside it, and the group head states the side's `Recorded`
 * fact ONCE.
 *
 * The fold half (`contractFieldGroups`) is pinned against hand-built arms so
 * each rule is named by the case that needs it. The render half runs the REAL
 * projection through `NodeDetail`, because the claim that matters — a policy
 * printed once per side rather than once per row — is a count no fold can see.
 * Each case was run against the table this replaces: there the `unbounded`
 * count equalled the output-row count, and the per-row `in ·` prefix appeared
 * on every input row.
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { manualClock } from "../../../src/domain/clock.js";
import { FingerprintSchema } from "../../../src/domain/ids.js";
import {
  ExplorerTaskWireSchema,
  type ExplorerTaskWire,
  type ExplorerWorkflowWire,
} from "../../../src/domain/dashboard/explorer.js";
import { buildWorkflowExplorer } from "../../../src/backend/runs/dashboard/queries/explorer.js";
import { explorerQueryDeps } from "../../fixtures/explorer-seams.js";
import { NodeDetail } from "../../../src/dashboard/surfaces/explorer.js";
import { contractFieldGroups } from "../../../src/dashboard/surfaces/explorer-model.js";

const CLOCK = manualClock(new Date("2026-08-09T12:00:00.000Z"));
const HASH = FingerprintSchema.parse("b".repeat(64));

function firstWorkflow(): ExplorerWorkflowWire {
  const wire = buildWorkflowExplorer(explorerQueryDeps(CLOCK, HASH));
  const workflow = wire.workflows[0];
  if (workflow === undefined) throw new Error("the explorer projection served no workflow");
  return workflow;
}

/** A served READ arm whose outputs are all `observed` under one default — the common case. */
function servedReadArm(): ExplorerTaskWire {
  for (const workflow of buildWorkflowExplorer(explorerQueryDeps(CLOCK, HASH)).workflows) {
    for (const node of workflow.nodes) {
      const task = node.tasks.find(
        (one) => one.effect === "read"
          && one.freshness !== undefined
          && one.provenance !== undefined
          && one.fields.filter((field) => field.side === "output").length >= 2,
      );
      if (task !== undefined) return task;
    }
  }
  throw new Error("no served read arm declares both policies over two or more output fields");
}

/** Re-parse an arm with its policies and fields replaced. */
function withArm(base: ExplorerTaskWire, patch: Record<string, unknown>): ExplorerTaskWire {
  return ExplorerTaskWireSchema.parse({ ...base, ...patch });
}

const OBSERVED = (path: string, extra: Record<string, unknown> = {}) => ({
  path,
  side: "output",
  kind: "string",
  presence: "always",
  recorded: { state: "observed", source: "live", maxAge: "unbounded", override: "audited", ...extra },
});

describe("D302 — contractFieldGroups lifts the side's shared fact to the group", () => {
  it("returns Inputs then Outputs, with inputs bound and read outputs under the arm's default", () => {
    const task = servedReadArm();
    const groups = contractFieldGroups(task);
    assert.deepEqual(groups.map((group) => group.side), ["input", "output"]);
    const [inputs, outputs] = groups;
    assert.deepEqual(inputs?.shared, { kind: "bound" });
    assert.equal(outputs?.shared.kind, "observed");
    if (outputs?.shared.kind !== "observed") return;
    assert.equal(outputs.shared.source, task.provenance?.default);
    assert.equal(outputs.shared.maxAge, task.freshness?.defaultMaxAge);
    assert.equal(outputs.shared.override, task.freshness?.defaultOverride);
    // The common case: no row departs from its head.
    assert.equal(inputs?.fields.every((row) => row.deviations.length === 0), true);
    assert.equal(outputs.fields.every((row) => row.deviations.length === 0), true);
  });

  it("draws ONE chip for the one facet a byField rule changes, and leaves the rest alone", () => {
    const base = servedReadArm();
    const task = withArm(base, {
      freshness: { defaultMaxAge: "unbounded", defaultOverride: "audited", byField: [{ path: "a", maxAge: 900000 }] },
      provenance: { default: "live", byField: [{ path: "b", source: "derived" }] },
      fields: [
        OBSERVED("a", { maxAge: 900000 }),
        OBSERVED("b", { source: "derived" }),
        OBSERVED("c"),
      ],
    });
    const outputs = contractFieldGroups(task)[1];
    assert.deepEqual(
      outputs?.fields.map((row) => row.deviations.map((chip) => `${chip.label ?? ""}=${chip.value}`)),
      [["fresh=15m"], ["from=derived"], []],
    );
  });

  it("states unknown on the head when the arm declares no policy, carrying the server's reason", () => {
    const base = servedReadArm();
    const reason = "this read contract declares no provenance policy, so nothing states how the field is observed";
    const task = withArm(base, {
      provenance: undefined,
      fields: [
        { ...OBSERVED("a"), recorded: { state: "unknown", reason } },
        { ...OBSERVED("b"), recorded: { state: "unknown", reason } },
      ],
    });
    const outputs = contractFieldGroups(task)[1];
    assert.deepEqual(outputs?.shared, { kind: "unknown", reason });
    // The rows share the head's fact, so none of them repeats it.
    assert.equal(outputs?.fields.every((row) => row.deviations.length === 0), true);
  });

  it("prepare and commit arms state their side once, from the arm's effect", () => {
    const base = servedReadArm();
    const prepare = withArm(base, {
      arm: "prepare",
      effect: "prepare",
      fields: [{ ...OBSERVED("a"), recorded: { state: "not-recorded", reason: "in-memory" } }],
    });
    const commit = withArm(base, {
      arm: "commit",
      effect: "commit",
      fields: [{ ...OBSERVED("a"), recorded: { state: "checkpointed", reason: "D144" } }],
    });
    assert.deepEqual(contractFieldGroups(prepare)[1]?.shared, { kind: "not-recorded" });
    assert.deepEqual(contractFieldGroups(commit)[1]?.shared, { kind: "checkpointed" });
    assert.equal(contractFieldGroups(prepare)[1]?.fields[0]?.deviations.length, 0);
    assert.equal(contractFieldGroups(commit)[1]?.fields[0]?.deviations.length, 0);
  });

  it("names a row whose STATE contradicts its head as a warning, never folds it in", () => {
    // The wire schema does not forbid an `unknown` leaf under an arm that
    // declares both policies. The head states the default; the row that is not
    // under it says so by name, with the server's reason on the chip.
    const base = servedReadArm();
    const task = withArm(base, {
      fields: [OBSERVED("a"), { ...OBSERVED("b"), recorded: { state: "unknown", reason: "why" } }],
    });
    const outputs = contractFieldGroups(task)[1];
    assert.deepEqual(outputs?.fields[1]?.deviations, [{ value: "unknown", tone: "warning", title: "why" }]);
  });
});

describe("D302 — NodeDetail draws each side's fact once", () => {
  function servedNodeWithReadArm() {
    const workflow = firstWorkflow();
    const node = workflow.nodes.find((one) => one.tasks.some((task) =>
      task.effect === "read" && task.freshness !== undefined
        && task.fields.filter((field) => field.side === "output").length >= 2));
    if (node === undefined) throw new Error(`workflow ${String(workflow.id)} serves no read arm with two outputs`);
    return { workflow, node };
  }

  it("prints the read arm's freshness bound once per arm, not once per output row", () => {
    const { workflow, node } = servedNodeWithReadArm();
    const html = renderToStaticMarkup(createElement(NodeDetail, { workflow, node }));
    for (const task of node.tasks.filter((one) => one.effect === "read" && one.freshness !== undefined)) {
      const outputs = task.fields.filter((field) => field.side === "output").length;
      const bound = task.freshness === undefined ? "" : `>${task.freshness.defaultMaxAge === "unbounded" ? "unbounded" : ""}<`;
      if (bound === "><") continue;
      const count = html.split(bound).length - 1;
      assert.ok(outputs >= 2, "precondition: the arm has rows the old table would have repeated on");
      assert.ok(count >= 1 && count < outputs, `the bound is drawn ${String(count)} times across ${String(outputs)} output rows`);
    }
  });

  it("heads each side with its count and no longer prefixes rows with the side", () => {
    const { workflow, node } = servedNodeWithReadArm();
    const html = renderToStaticMarkup(createElement(NodeDetail, { workflow, node }));
    const task = node.tasks.find((one) => one.effect === "read");
    if (task === undefined) throw new Error("no read arm");
    const inputs = task.fields.filter((field) => field.side === "input").length;
    const outputs = task.fields.filter((field) => field.side === "output").length;
    assert.equal(html.includes(`Inputs · ${String(inputs)}`), true);
    assert.equal(html.includes(`Outputs · ${String(outputs)}`), true);
    assert.equal(html.includes(">in · "), false, "the row's side prefix is the group head's job now");
    assert.equal(html.includes(">out · "), false);
    // The System column is gone with the table: the system is on the node's chip row.
    assert.equal(html.includes(">System<"), false);
    assert.equal(html.includes(">Recorded<"), false);
  });
});
