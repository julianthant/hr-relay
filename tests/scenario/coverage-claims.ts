/**
 * What the executable scenario corpus claims to cover, per workflow.
 *
 * This is the ONE list `scenario-coverage` audits against the graph-derived
 * points. It is not hand-asserted prose: every entry is produced by an
 * executable scenario in this directory that walks the path and reports the
 * points it actually exercised, and each scenario test asserts its own row
 * matches what the walk observed. So a claim here cannot outlive the path it
 * describes, and a path nobody walks cannot be claimed.
 */
import { ScenarioIdSchema } from "../../src/domain/ids.js";
import type { ScenarioCoverageClaim } from "../../src/domain/workflow/scenario-coverage.js";

function claim(scenarioId: string, covers: readonly string[]): ScenarioCoverageClaim {
  return { scenarioId: ScenarioIdSchema.parse(scenarioId), covers: [...covers] };
}

/**
 * person-lookup declares no branch, gate, delegation, or transaction, so its
 * graph derives zero coverage points. Its scenarios still exist — they pin the
 * binds and the terminal result — they simply have no graph paths to claim.
 */
export const PERSON_LOOKUP_CLAIMS: readonly ScenarioCoverageClaim[] = Object.freeze([]);

export const FIXTURE_GRAPH_CLAIMS: readonly ScenarioCoverageClaim[] = Object.freeze([
  claim("fixture-graph/write-arm-committed", [
    "branch-case:mode-branch/write",
    "gate:approval/opened",
    "gate:approval/resolved",
    "delegation:notify/fan-out-many",
    "delegation:notify/on-child-failed-allow-partial",
    "delegation:notify/cascade-cancel-cascade",
    "delegation:notify/after-child-retry-resume-parent",
    "transaction:submit/committed",
  ]),
  claim("fixture-graph/read-only-arm-already-present", [
    "branch-case:mode-branch/read-only",
    "delegation:notify/fan-out-one",
    "transaction:submit/already-present",
  ]),
  claim("fixture-graph/empty-fan-out", ["delegation:notify/fan-out-zero"]),
  claim("fixture-graph/delegation-replay", ["delegation:notify/replay"]),
  claim("fixture-graph/dry-run", ["transaction:submit/dry-run"]),
  claim("fixture-graph/subject-mismatch", ["transaction:submit/subject-mismatch"]),
]);

export const SCENARIO_COVERAGE_CLAIMS: Readonly<Record<string, readonly ScenarioCoverageClaim[]>> =
  Object.freeze({
    "person-lookup": PERSON_LOOKUP_CLAIMS,
    "fixture-graph": FIXTURE_GRAPH_CLAIMS,
  });
