/**
 * D299 — the Scenarios section is one CARD per id's first path segment, and
 * the rows inside carry only what follows it.
 *
 * The fold is where the whole claim lives: the surface maps groups to cards
 * and rows to `<tr>`, so a grouping that split on the LAST slash, or dropped a
 * middle segment, or re-ordered the served list would render a table that
 * looks entirely reasonable and names the wrong scenarios. Each case here is
 * about a property the eye cannot check — which segment is the title, what is
 * left for the row, and what order the cards come in.
 *
 * The wire comes from the REAL projection for the ordering case, because the
 * served list is sorted and "grouping re-orders nothing" is only a claim about
 * a list that was already in an order worth keeping.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { manualClock } from "../../../../src/domain/clock.js";
import { FingerprintSchema } from "../../../../src/domain/ids.js";
import { ExplorerScenarioWireSchema, type ExplorerScenarioWire } from "../../../../src/domain/dashboard/explorer.js";
import { buildWorkflowExplorer } from "../../../../src/backend/runs/dashboard/queries/explorer.js";
import { explorerQueryDeps } from "../../../fixtures/explorer-seams.js";
import { groupScenariosByPrefix } from "../../../../src/dashboard/surfaces/explorer-model.js";

const CLOCK = manualClock(new Date("2026-08-09T12:00:00.000Z"));

function scenario(scenarioId: string, path = "tests/scenario/one.scenario.test.ts"): ExplorerScenarioWire {
  return ExplorerScenarioWireSchema.parse({ scenarioId, source: { state: "resolved", path } });
}

/** The served workflow that actually registers more than one prefix. */
function multiPrefixWorkflow() {
  const wire = buildWorkflowExplorer(explorerQueryDeps(CLOCK, FingerprintSchema.parse("b".repeat(64))));
  const workflow = wire.workflows.find((one) => {
    const prefixes = new Set(one.scenarios.map((each) => String(each.scenarioId).split("/")[0]));
    return prefixes.size > 1;
  });
  if (workflow === undefined) throw new Error("the explorer projection serves no multi-prefix workflow");
  return workflow;
}

describe("D299 — scenarios group by their first path segment", () => {
  it("titles each group with the leading segment and leaves the rest to the row", () => {
    const groups = groupScenariosByPrefix([
      scenario("person-lookup/ambiguous-name"),
      scenario("person-lookup/not-found"),
      scenario("separations-identity-check/gate-approved"),
    ]);

    assert.deepEqual(groups.map((group) => group.prefix), ["person-lookup", "separations-identity-check"]);
    assert.deepEqual(groups[0]?.rows.map((row) => row.leaf), ["ambiguous-name", "not-found"]);
    assert.deepEqual(groups[1]?.rows.map((row) => row.leaf), ["gate-approved"]);
  });

  it("splits on the FIRST slash, so a deeper id keeps every segment after it", () => {
    const groups = groupScenariosByPrefix([scenario("separations/kuali/retro-effective-date")]);

    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.prefix, "separations");
    // Splitting on the last slash would title this `separations/kuali` and
    // leave a row that no longer states which stage it belongs to.
    assert.equal(groups[0]?.rows[0]?.leaf, "kuali/retro-effective-date");
  });

  it("keeps the WHOLE id on the row, because that is what a failure resolves to", () => {
    const groups = groupScenariosByPrefix([scenario("person-lookup/not-found")]);

    assert.equal(groups[0]?.rows[0]?.scenarioId, "person-lookup/not-found");
  });

  it("carries each row's own source rather than the group's first", () => {
    const groups = groupScenariosByPrefix([
      scenario(
        "person-lookup/happy-by-eid",
        "tests/scenario/workflows/person-lookup/structural.scenario.test.ts",
      ),
      scenario(
        "person-lookup/crm-subject-mismatch",
        "tests/scenario/workflows/person-lookup/structural.scenario.test.ts",
      ),
    ]);
    const paths = groups[0]?.rows.map((row) => (row.source.state === "resolved" ? String(row.source.path) : "unresolved"));

    assert.deepEqual(paths, [
      "tests/scenario/workflows/person-lookup/structural.scenario.test.ts",
      "tests/scenario/workflows/person-lookup/structural.scenario.test.ts",
    ]);
  });

  it("re-orders nothing: a group sits where its first member sat", () => {
    const workflow = multiPrefixWorkflow();
    const groups = groupScenariosByPrefix(workflow.scenarios);
    const regrouped = groups.flatMap((group) => group.rows.map((row) => row.scenarioId));

    assert.deepEqual(regrouped, workflow.scenarios.map((one) => String(one.scenarioId)));
    assert.ok(groups.length > 1, "the chosen workflow must serve more than one group");
  });

  it("throws on an id with no segment rather than titling a card with the whole thing", () => {
    // `ScenarioIdSchema` cannot mint this, so it is a wire that broke its own
    // contract — and the quiet arm would be a card titled `orphan` over a row
    // with nothing in it.
    assert.throws(
      () => groupScenariosByPrefix([{ scenarioId: "orphan", source: { state: "resolved", path: "a.ts" } } as never]),
      /scenario id orphan carries no group segment/u,
    );
  });
});
