/**
 * Graph-level scenario coverage across the registered descriptor set (doc 07
 * item 1e; doc 12 §3.2).
 *
 * Task-level coverage is `defineTaskContract`'s job. What no contract can see
 * is the GRAPH: a branch arm nobody exercises, a gate nobody resolves, a
 * delegation whose declared failure policy never fires. Those paths are derived
 * from the node tuple and checked in BOTH directions — an uncovered path fails,
 * and so does a claim on a path that no longer exists, because a renamed branch
 * arm would otherwise keep a deleted path looking covered.
 *
 * `person-lookup` is four read steps and therefore derives zero graph paths;
 * that is the correct answer for it, not a pass by absence. The rule is proven
 * against `fixtureDescriptor`, whose fifteen points span every path-bearing node
 * kind.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { DESCRIPTORS } from "../../../src/control/workflow-registry.js";
import { workflowProjections } from "../../../src/base/workflow.js";
import { ScenarioIdSchema } from "../../../src/domain/ids.js";
import {
  auditGraphScenarioCoverage,
  deriveGraphCoveragePoints,
} from "../../../src/domain/workflow/scenario-coverage.js";
import type { ScenarioCoverageClaim } from "../../../src/domain/workflow/scenario-coverage.js";
import { descriptorRuntimeNodes } from "../../../src/base/workflow.js";
import { fixtureDescriptor } from "./helpers/descriptor-fixtures.js";

/**
 * The claim corpus for the fixture graph. In 1f these come off the registered
 * `ScenarioManifest` set; here they are declared beside the graph they cover so
 * the both-directions audit has something real to disagree with.
 */
function fullClaims(pointIds: readonly string[]): readonly ScenarioCoverageClaim[] {
  return pointIds.map((pointId, index) => ({
    scenarioId: ScenarioIdSchema.parse(`fixture-graph/point-${String(index)}`),
    covers: [pointId],
  }));
}

describe("scenario coverage", () => {
  it("derives coverage points from the node tuple, not from a hand-maintained list", () => {
    const projections = workflowProjections(fixtureDescriptor);
    const derived = deriveGraphCoveragePoints(descriptorRuntimeNodes(fixtureDescriptor));
    assert.deepEqual(
      projections.coveragePoints.map((point) => point.id),
      derived.map((point) => point.id),
    );
    const ids = derived.map((point) => point.id);
    for (const expected of [
      "branch-case:mode-branch/read-only",
      "branch-case:mode-branch/write",
      "gate:approval/opened",
      "gate:approval/resolved",
      "delegation:notify/fan-out-zero",
      "delegation:notify/fan-out-many",
      "delegation:notify/replay",
      "delegation:notify/on-child-failed-allow-partial",
      "transaction:submit/dry-run",
      "transaction:submit/subject-mismatch",
      "transaction:submit/committed",
      "transaction:submit/already-present",
    ]) {
      assert.ok(ids.includes(expected), `missing derived point ${expected}`);
    }
    assert.equal(new Set(ids).size, ids.length, "coverage point ids must be unique");
  });

  it("reports an uncovered path and a claim on a path that no longer exists", () => {
    const points = deriveGraphCoveragePoints(descriptorRuntimeNodes(fixtureDescriptor));
    const ids = points.map((point) => point.id);
    assert.deepEqual(auditGraphScenarioCoverage(points, fullClaims(ids)), []);

    const missingOne = auditGraphScenarioCoverage(points, fullClaims(ids.slice(1)));
    assert.equal(missingOne.length, 1);
    assert.match(missingOne[0], /^uncovered graph path /);

    const renamed = auditGraphScenarioCoverage(points, [
      ...fullClaims(ids),
      {
        scenarioId: ScenarioIdSchema.parse("fixture-graph/stale"),
        covers: ["branch-case:mode-branch/renamed-arm"],
      },
    ]);
    assert.match(renamed.join("\n"), /claims unknown coverage point branch-case:mode-branch\/renamed-arm/);
  });

  it("holds every registered descriptor to its own derived paths", () => {
    for (const descriptor of DESCRIPTORS) {
      const points = workflowProjections(descriptor).coveragePoints;
      // Whatever the graph derives, a full claim set must satisfy it exactly —
      // including the empty set for a workflow with no control flow.
      assert.deepEqual(auditGraphScenarioCoverage(points, fullClaims(points.map((p) => p.id))), []);
      assert.ok(descriptor.scenarios.length > 0, `${String(descriptor.id)} registers no scenario`);
    }
  });

  it("counts an un-awaited fan-out's join policies as no path at all", () => {
    // A `join:"none"` edge has no join to exercise, so claiming a policy point
    // for it would be coverage theatre. The derivation omits them.
    const points = deriveGraphCoveragePoints(descriptorRuntimeNodes(fixtureDescriptor));
    const awaited = points.filter((point) => point.id.startsWith("delegation:notify/on-child-failed"));
    assert.equal(awaited.length, 1, "an awaited edge contributes exactly its declared failure policy");
  });
});
