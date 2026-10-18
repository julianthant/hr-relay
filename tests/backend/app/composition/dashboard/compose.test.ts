
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { dataOriginViewsOf } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import { WORKFLOW_MODULES } from "../../../../../src/backend/app/registries/workflow-registry.js";

function moduleFor(workflowId: string) {
  const found = WORKFLOW_MODULES.find((candidate) => String(candidate.descriptor.id) === workflowId);
  assert.ok(found, `no registered module ${workflowId}`);
  return found;
}

describe("dataOriginViewsOf", () => {
  it("reads a task node's declared effect as `read`, with the store's own system", () => {
    const origins = dataOriginViewsOf(moduleFor("person-lookup"));
    const searching = origins.find((origin) => origin.nodeId === "searching");
    assert.ok(searching);
    assert.equal(searching.dir, "read");
    assert.equal(searching.system, "ucpath");
    assert.ok(searching.step.length > 0);
  });

  it("reads a TRANSACTION node's commit contract as `write` — the arm a read-only tree would leave unreachable", () => {
    const origins = dataOriginViewsOf(moduleFor("separations"));
    const write = origins.find((origin) => origin.nodeId === "finalize-kuali" && origin.dir === "write");
    assert.ok(write, "separations declares a Kuali transaction node and must produce a write origin");
    assert.equal(write.system, "kuali");
    // A commit contract declares no freshness policy — a write is not a fact
    // anyone reuses, so there is no bound to state.
    assert.equal(write.freshness, undefined);
  });

  it("resolves every real transaction beat from the registered module's task declarations", () => {
    const origins = dataOriginViewsOf(moduleFor("separations"))
      .filter((origin) => origin.nodeId === "finalize-kuali")
      .map(({ role, taskId, dir, system }) => ({ role, taskId, dir, system }));

    assert.deepEqual(origins, [
      { role: "probe", taskId: "kuali/match-separation-finalization", dir: "read", system: "kuali" },
      { role: "prepare", taskId: "kuali/stage-separation-finalization", dir: "write", system: "kuali" },
      { role: "commit", taskId: "kuali/save-separation-finalization", dir: "write", system: "kuali" },
      { role: "verify", taskId: "kuali/verify-separation-finalization", dir: "read", system: "kuali" },
    ]);
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
      if ("nodeId" in detail.source) assert.ok(covered.has(String(detail.source.nodeId)), String(detail.source.nodeId));
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
