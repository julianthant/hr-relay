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

/**
 * kuali-timekeeper-annotation is one transaction node, so it derives exactly
 * the four transaction paths. Unlike the fixture graph, all four are walked by
 * the REAL write sequencer over the real authority database — a pure walk
 * cannot observe "zero rows in write_intents", which is the whole point of the
 * dry-run and subject-mismatch arms.
 */
export const KUALI_TIMEKEEPER_CLAIMS: readonly ScenarioCoverageClaim[] = Object.freeze([
  claim("kuali-timekeeper-annotation/dry-run-preview", [
    "transaction:annotate-timekeeper/dry-run",
  ]),
  claim("kuali-timekeeper-annotation/subject-mismatch", [
    "transaction:annotate-timekeeper/subject-mismatch",
  ]),
  claim("kuali-timekeeper-annotation/committed", [
    "transaction:annotate-timekeeper/committed",
  ]),
  claim("kuali-timekeeper-annotation/already-present", [
    "transaction:annotate-timekeeper/already-present",
  ]),
]);

/**
 * separations-kronos-timecard is two read steps with no branch, no gate, no
 * delegation and no transaction, so the graph derives ZERO coverage points —
 * and an empty claim list is the correct answer, not a missing one. The
 * scenarios still exist and still run: what they falsify is the CONTRACT
 * behaviour (S34/S35/S37/S38/S40), which a coverage point cannot express.
 */
export const SEPARATIONS_KRONOS_TIMECARD_CLAIMS: readonly ScenarioCoverageClaim[] =
  Object.freeze([]);

/**
 * separations-kuali-read is the same shape for the same reason: one browser
 * read plus one pure fold, no branch, no gate, no delegation, no transaction —
 * so the graph derives ZERO coverage points and an empty claim list is the
 * correct answer. Its five scenarios falsify CONTRACT behaviour (S2's form-type
 * refusal, S8's unparseable date, §4a's unmapped type, and the absent arms a
 * live unprocessed document actually produced), which a coverage point cannot
 * express.
 */
export const SEPARATIONS_KUALI_READ_CLAIMS: readonly ScenarioCoverageClaim[] =
  Object.freeze([]);

/**
 * separations-identity-check is the FIRST production descriptor in this tree
 * with a gate node, so it is the first whose graph derives gate coverage points
 * at all. Both are claimed by the single-active-job walk, and the scenario file
 * asserts the claim against what the walk observed — the gate's `opened` and
 * `resolved` points are properties of reaching and resolving the gate, so any
 * path through this graph produces exactly them.
 */
export const SEPARATIONS_IDENTITY_CHECK_CLAIMS: readonly ScenarioCoverageClaim[] = Object.freeze([
  claim("separations-identity-check/single-active-job", [
    "gate:identity-approval/opened",
    "gate:identity-approval/resolved",
  ]),
]);

export const SCENARIO_COVERAGE_CLAIMS: Readonly<Record<string, readonly ScenarioCoverageClaim[]>> =
  Object.freeze({
    "person-lookup": PERSON_LOOKUP_CLAIMS,
    "fixture-graph": FIXTURE_GRAPH_CLAIMS,
    "kuali-timekeeper-annotation": KUALI_TIMEKEEPER_CLAIMS,
    "separations-kronos-timecard": SEPARATIONS_KRONOS_TIMECARD_CLAIMS,
    "separations-kuali-read": SEPARATIONS_KUALI_READ_CLAIMS,
    "separations-identity-check": SEPARATIONS_IDENTITY_CHECK_CLAIMS,
  });
