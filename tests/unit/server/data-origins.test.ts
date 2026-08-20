/**
 * D252 — the Data rail's origin view, against the REAL registered modules.
 *
 * The point of running it over `WORKFLOW_MODULES` rather than a fixture is the
 * separations-6c lesson: a wire arm is only as pinned as the VALUES a producer
 * can actually emit. `dir: "write"` and a served `system` are the two arms most
 * easily left unreachable, so both are asserted against a real descriptor.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { WORKFLOW_MODULES } from "../../../src/control/workflow-registry.js";
import { dataOriginViewsOf } from "../../../src/server/dashboard/compose.js";

function moduleFor(workflowId: string) {
  const found = WORKFLOW_MODULES.find((candidate) => String(candidate.descriptor.id) === workflowId);
  assert.ok(found, `no registered module ${workflowId}`);
  return found;
}

describe("dataOriginViewsOf (D252)", () => {
  it("reads a task node's declared effect as `read`, with the store's own system", () => {
    const origins = dataOriginViewsOf(moduleFor("person-lookup"));
    const searching = origins.find((origin) => origin.nodeId === "searching");
    assert.ok(searching);
    assert.equal(searching.dir, "read");
    assert.equal(searching.system, "ucpath");
    assert.ok(searching.step.length > 0);
  });

  it("reads a TRANSACTION node's commit contract as `write` — the arm a read-only tree would leave unreachable", () => {
    const origins = dataOriginViewsOf(moduleFor("kuali-timekeeper-annotation"));
    const write = origins.find((origin) => origin.dir === "write");
    assert.ok(write, "kuali-timekeeper-annotation declares a transaction node and must produce a write origin");
    assert.equal(write.system, "kuali");
    // A commit contract declares no freshness policy — a write is not a fact
    // anyone reuses, so there is no bound to state.
    assert.equal(write.freshness, undefined);
  });

  it("resolves the bound only for the field paths a Data entry can carry, through the executor's own precedence", () => {
    const origins = dataOriginViewsOf(moduleFor("person-lookup"));
    for (const origin of origins) {
      for (const bound of origin.freshness ?? []) {
        assert.ok(bound.maxAge === "unbounded" || Number.isFinite(bound.maxAge));
        assert.ok(bound.override === "forbidden" || bound.override === "audited");
      }
    }
    // Every declared path belongs to a node this view covers: a bound served
    // for a node with no origin could never reach a row.
    const covered = new Set(origins.map((origin) => origin.nodeId));
    for (const detail of moduleFor("person-lookup").descriptor.details) {
      assert.ok(covered.has(String(detail.source.nodeId)), String(detail.source.nodeId));
    }
  });

  it("names the commit nodes a read can statically reach, and NONE for a graph with no write", () => {
    // person-lookup is read-only: nothing it records feeds a commit, which is
    // exactly why its freshness bounds never refuse anything.
    for (const origin of dataOriginViewsOf(moduleFor("person-lookup"))) {
      assert.deepEqual(origin.feeds, []);
    }
    const separations = dataOriginViewsOf(moduleFor("separations"));
    assert.ok(
      separations.some((origin) => origin.dir === "read" && origin.feeds.length > 0),
      "a composed separations read must feed at least one commit",
    );
  });
});
