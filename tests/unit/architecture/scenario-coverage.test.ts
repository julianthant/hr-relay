/**
 * Graph-level scenario coverage across the registered descriptor set (doc 01 §1c · 1d · 1e
 * item 1e; ref operator-trust §3.2).
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
 *
 * D185 adds the third direction, over the corpus DIRECTORY. The manifest audit
 * above is keyed on the REGISTERED set, so a `tests/scenario/*.scenario.test.ts`
 * that nothing registers — or an `it` inside a registered file naming an id
 * nobody registered — is invisible to every one of its three checks. (That was
 * not hypothetical: `person-lookup/ucpath-drill-subject-mismatch` had been
 * executing unregistered since it landed.) `auditScenarioCorpusLayout` closes
 * both directions and, with it, names the corpus's second deliberate kind: an
 * INTEGRATION WALK (`*.walk.test.ts`), which crosses slices instead of walking
 * one graph and therefore claims no coverage point and carries no manifest row.
 *
 * R10 §10.9's T2 tier is the THIRD kind — a DASHBOARD scenario at
 * `dashboard/<feature>/<name>.scenario.test.ts`, driving a feature through the
 * real projection and the real command service. It carries the walk's
 * obligations for the same reason the walk does: it walks no graph, so a
 * coverage claim or a manifest row on one would be a path nobody executed
 * counted as executed.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
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
import {
  EXECUTABLE_SCENARIO_MANIFEST,
  ExecutableScenarioSpecSchema,
  DASHBOARD_SCENARIO_FILE_PATTERN,
  GRAPH_SCENARIO_FILE_PATTERN,
  INTEGRATION_WALK_FILE_PATTERN,
  auditExecutableScenarioParity,
  auditScenarioCorpusLayout,
  claimedScenarioId,
} from "../../../src/domain/workflow/scenario-execution.js";
import type { ScenarioCorpusFile } from "../../../src/domain/workflow/scenario-execution.js";
import { taskStoreRegistry } from "../../../src/stores/index.js";
import { fixtureDescriptor } from "./helpers/descriptor-fixtures.js";
import { REPO_ROOT, walkFiles } from "./helpers/guard-files.js";
import { SCENARIO_COVERAGE_CLAIMS } from "../../scenario/coverage-claims.js";

/**
 * A synthetic full-coverage corpus, used only to exercise the audit's own
 * failure modes. The REAL corpus is `SCENARIO_COVERAGE_CLAIMS`, whose rows each
 * executable scenario in `tests/scenario/` observes as it walks its path.
 */
function fullClaims(pointIds: readonly string[]): readonly ScenarioCoverageClaim[] {
  return pointIds.map((pointId, index) => ({
    scenarioId: ScenarioIdSchema.parse(`fixture-graph/point-${String(index)}`),
    covers: [pointId],
  }));
}

/**
 * Every scenario production code references.
 *
 * Descriptors are one source; the composition root's TASK STORE REGISTRY is the
 * other, and it has to be, because a store contract can legitimately land
 * before the descriptor that will consume it — the extraction store is exactly
 * that case, and D107's `pending-impl-bindings.json` is the mirror image of it
 * (a descriptor contract with no impl yet).
 *
 * A registered store contract is production surface either way: it is in the
 * one `TASK_STORES` tuple the runtime resolves against. The orphan rule keeps
 * its teeth — a scenario referenced by NEITHER source is still dead weight.
 */
function productionScenarioReferences(): readonly string[] {
  return [...new Set([
    ...DESCRIPTORS.flatMap((descriptor) => [
      ...descriptor.scenarios.map(String),
      ...workflowProjections(descriptor).contracts.flatMap((contract) =>
        contract.scenarios.map(String)),
    ]),
    ...taskStoreRegistry.stores.flatMap((store) =>
      Object.values(store.tasks).flatMap((task) => task.contract.scenarios.map(String))),
  ])];
}

/**
 * The observed side is intentionally derived from the executable test files,
 * not from the manifest or contract arrays. A manifest row whose test was
 * renamed or deleted therefore becomes an unexecuted scenario.
 */
function observedExecutableScenarios(): readonly string[] {
  const observed: string[] = [];
  for (const row of EXECUTABLE_SCENARIO_MANIFEST) {
    const source = readFileSync(join(REPO_ROOT, row.file), "utf8");
    const marker = `it("${row.scenarioId} —`;
    const declarations = source.split(marker).length - 1;
    assert.equal(declarations, 1, `${row.scenarioId} must have exactly one executable test in ${row.file}`);
    observed.push(row.scenarioId);
  }
  return observed;
}

/* ── the corpus directory, as D185's audit consumes it ───────────────────── */

const SCENARIO_ROOT = "tests/scenario";

/**
 * Every top-level `it(...)` title, in declaration order.
 *
 * `\bit\(` cannot match the tail of another identifier (`omit(`, `wait(`), and
 * the corpus writes every title as a plain double-quoted literal — a template
 * literal would be a title nothing could read back, which is itself the reason
 * the convention exists.
 */
function itTitles(source: string): readonly string[] {
  return [...source.matchAll(/\bit\(\s*"((?:[^"\\]|\\.)*)"/gu)].map((match) => match[1]);
}

function scenarioCorpusFiles(): readonly ScenarioCorpusFile[] {
  return walkFiles(join(REPO_ROOT, SCENARIO_ROOT), { extensions: [".ts"] })
    .filter((file) => file.endsWith(".test.ts"))
    .map((file) => relative(REPO_ROOT, file).replaceAll("\\", "/"))
    .sort()
    .map((file) => ({ file, itTitles: itTitles(readFileSync(join(REPO_ROOT, file), "utf8")) }));
}

/** The fixture side: paths claimed for descriptors with no production reference. */
function graphClaimedScenarioIds(): readonly string[] {
  return [...new Set(
    Object.values(SCENARIO_COVERAGE_CLAIMS).flatMap((claims) => claims.map(({ scenarioId }) => String(scenarioId))),
  )];
}

/** The REAL corpus with exactly one thing moved — the ratchet-fixture shape. */
function corpusWith(
  mutate: (files: ScenarioCorpusFile[]) => ScenarioCorpusFile[],
): readonly ScenarioCorpusFile[] {
  return mutate(scenarioCorpusFiles().map((entry) => ({ file: entry.file, itTitles: [...entry.itTitles] })));
}

function corpusViolations(files: readonly ScenarioCorpusFile[]): string {
  return auditScenarioCorpusLayout(files, graphClaimedScenarioIds()).join("\n");
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

  it("holds every registered descriptor to the executable scenario corpus", () => {
    for (const descriptor of [...DESCRIPTORS, fixtureDescriptor]) {
      const id = String(descriptor.id);
      const points = workflowProjections(descriptor).coveragePoints;
      const claims = SCENARIO_COVERAGE_CLAIMS[id];
      assert.ok(claims !== undefined, `${id} has no scenario claim corpus`);
      // Both directions, against the corpus the scenarios actually walk —
      // including the empty corpus for a workflow with no control flow.
      assert.deepEqual(auditGraphScenarioCoverage(points, claims), [], id);
      assert.ok(descriptor.scenarios.length > 0, `${id} registers no scenario`);
    }
  });

  it("keeps each workflow's executable scenarios in its one structural T1a file", () => {
    const corpus = scenarioCorpusFiles();
    for (const descriptor of DESCRIPTORS) {
      const workflow = String(descriptor.id);
      const expectedFile = `${SCENARIO_ROOT}/workflows/${workflow}/structural.scenario.test.ts`;
      const manifestedFiles = new Set(
        EXECUTABLE_SCENARIO_MANIFEST
          .filter(({ scenarioId }) => String(scenarioId).startsWith(`${workflow}/`))
          .map(({ file }) => file),
      );
      const corpusFiles = new Set(
        corpus
          .filter(({ file, itTitles }) =>
            GRAPH_SCENARIO_FILE_PATTERN.test(file)
            && itTitles.some((title) => title.startsWith(`${workflow}/`)))
          .map(({ file }) => file),
      );

      assert.deepEqual(
        [...manifestedFiles],
        [expectedFile],
        `${workflow} must manifest one structural T1a file`,
      );
      assert.deepEqual(
        [...corpusFiles],
        [expectedFile],
        `${workflow} must execute every T1a scenario in its one structural file`,
      );
    }
  });

  it("holds descriptor and task references to an independently observed executable manifest", () => {
    assert.deepEqual(
      auditExecutableScenarioParity(
        productionScenarioReferences(),
        observedExecutableScenarios(),
      ),
      [],
    );
  });

  it("rejects typo references, orphan rows, and registered scenarios that did not execute", () => {
    const referenced = productionScenarioReferences();
    const observed = observedExecutableScenarios();

    assert.match(
      auditExecutableScenarioParity([...referenced, "person-lookup/typo-reference"], observed).join("\n"),
      /referenced scenario person-lookup\/typo-reference is not registered as executable/,
    );

    const orphanedId = String(EXECUTABLE_SCENARIO_MANIFEST[0]?.scenarioId);
    assert.match(
      auditExecutableScenarioParity(
        referenced.filter((scenarioId) => scenarioId !== orphanedId),
        observed,
      ).join("\n"),
      new RegExp(`executable scenario ${orphanedId} is orphaned`),
    );

    const unexecutedId = String(EXECUTABLE_SCENARIO_MANIFEST.at(-1)?.scenarioId);
    assert.match(
      auditExecutableScenarioParity(
        referenced,
        observed.filter((scenarioId) => scenarioId !== unexecutedId),
      ).join("\n"),
      new RegExp(`registered scenario ${unexecutedId} was not executed`),
    );
  });

  it("holds the corpus DIRECTORY to its three declared kinds, in both directions", () => {
    const files = scenarioCorpusFiles();
    assert.ok(files.length > 0, "the scenario corpus is empty");
    assert.deepEqual(auditScenarioCorpusLayout(files, graphClaimedScenarioIds()), []);
    // Every file on disk is one of the three kinds, and each kind is used.
    for (const { file } of files) {
      assert.ok(
        GRAPH_SCENARIO_FILE_PATTERN.test(file)
        || INTEGRATION_WALK_FILE_PATTERN.test(file)
        || DASHBOARD_SCENARIO_FILE_PATTERN.test(file),
        `${file} is no corpus kind`,
      );
    }
    // All three kinds are in use, so no arm is enforcing an empty set.
    assert.ok(files.some(({ file }) => GRAPH_SCENARIO_FILE_PATTERN.test(file)));
    assert.ok(files.some(({ file }) => INTEGRATION_WALK_FILE_PATTERN.test(file)));
    assert.ok(files.some(({ file }) => DASHBOARD_SCENARIO_FILE_PATTERN.test(file)));
    // The kinds are disjoint: a dashboard scenario is never read as a graph one,
    // which is what keeps their opposite claim obligations enforceable.
    for (const { file } of files) {
      assert.equal(
        GRAPH_SCENARIO_FILE_PATTERN.test(file) && DASHBOARD_SCENARIO_FILE_PATTERN.test(file),
        false,
        `${file} matches two corpus kinds`,
      );
    }
  });

  /**
   * The disjointness check above walks the LIVE corpus, so it can only ever
   * prove "the files that happen to exist today don't collide" — a real
   * near-miss shape (a dashboard-nested walk file, a workflow-folder graph
   * file whose suffix drifted) would stay invisible until someone happened to
   * create one. This table is synthetic on purpose: it exercises the three
   * patterns' full pairwise matrix (GRAPH∧DASHBOARD, WALK∧DASHBOARD,
   * GRAPH∧WALK) against shapes chosen to be plausible near-misses, independent
   * of whatever the corpus directory currently contains.
   */
  it("keeps the three corpus file patterns pairwise disjoint over a synthetic path table", () => {
    const SYNTHETIC_PATHS: readonly string[] = [
      `${SCENARIO_ROOT}/dashboard/separations/x.scenario.test.ts`, // dashboard
      `${SCENARIO_ROOT}/dashboard/a/b.walk.test.ts`, // dashboard-shaped, walk-suffixed
      `${SCENARIO_ROOT}/workflows/w/structural.scenario.test.ts`, // graph (workflow-folder arm)
      `${SCENARIO_ROOT}/foo.walk.test.ts`, // walk
      `${SCENARIO_ROOT}/foo.scenario.test.ts`, // graph (flat arm)
    ];
    for (const file of SYNTHETIC_PATHS) {
      assert.equal(
        GRAPH_SCENARIO_FILE_PATTERN.test(file) && DASHBOARD_SCENARIO_FILE_PATTERN.test(file),
        false,
        `${file} matches both GRAPH and DASHBOARD`,
      );
      assert.equal(
        INTEGRATION_WALK_FILE_PATTERN.test(file) && DASHBOARD_SCENARIO_FILE_PATTERN.test(file),
        false,
        `${file} matches both WALK and DASHBOARD`,
      );
      assert.equal(
        GRAPH_SCENARIO_FILE_PATTERN.test(file) && INTEGRATION_WALK_FILE_PATTERN.test(file),
        false,
        `${file} matches both GRAPH and WALK`,
      );
    }
  });

  it("reads an `it` title as a scenario CLAIM only when its head is a scenario id", () => {
    // The separator is what makes "unregistered id" and "sentence" different
    // facts. A typo stays a claim on purpose — it must fail, not be silently
    // reclassified as prose.
    assert.equal(claimedScenarioId("person-lookup/not-found — the other arm"), "person-lookup/not-found");
    assert.equal(claimedScenarioId("person-lookup/typo — x"), "person-lookup/typo");
    assert.equal(claimedScenarioId("covers every point the graph derives"), undefined);
    assert.equal(claimedScenarioId("reads a real .xlsx — and a date arrives as ISO"), undefined);
  });

  it("rejects an unregistered corpus file, a stray kind, and an empty one", () => {
    assert.match(
      corpusViolations(corpusWith((files) => [
        ...files,
        { file: `${SCENARIO_ROOT}/helpers.test.ts`, itTitles: ["does a thing"] },
      ])),
      /helpers\.test\.ts is neither a graph scenario .* nor an integration walk/,
    );
    // A dashboard scenario one folder too shallow is a stray kind, not a T2
    // file: §10.9's path is `dashboard/<feature>/<name>.scenario.test.ts`, and
    // a `<feature>` that is really the file name owns no feature.
    assert.match(
      corpusViolations(corpusWith((files) => [
        ...files,
        { file: `${SCENARIO_ROOT}/dashboard/loose.scenario.test.ts`, itTitles: ["does a thing"] },
      ])),
      /dashboard\/loose\.scenario\.test\.ts is neither a graph scenario .* nor an integration walk/,
    );
    assert.match(
      corpusViolations(corpusWith((files) => [
        ...files,
        { file: `${SCENARIO_ROOT}/new-thing.scenario.test.ts`, itTitles: ["does a thing"] },
      ])),
      /new-thing\.scenario\.test\.ts is named a graph scenario but declares no scenario id/,
    );
    assert.match(
      corpusViolations(corpusWith((files) => [
        ...files,
        { file: `${SCENARIO_ROOT}/new-thing.scenario.test.ts`, itTitles: [] },
      ])),
      /new-thing\.scenario\.test\.ts declares no test/,
    );
    assert.match(
      corpusViolations(corpusWith((files) => [...files, files[0]])),
      /is listed twice in the corpus/,
    );
  });

  it("rejects an unregistered id, an id declared in the wrong file, and a row nothing executes", () => {
    const row = EXECUTABLE_SCENARIO_MANIFEST[0];
    const owner = String(row.file);
    const ownedId = String(row.scenarioId);

    assert.match(
      corpusViolations(corpusWith((files) => [
        ...files,
        {
          file: `${SCENARIO_ROOT}/new-thing.scenario.test.ts`,
          itTitles: ["person-lookup/never-registered — an id nobody registered"],
        },
      ])),
      /declares scenario person-lookup\/never-registered, which is in no manifest row and claims no graph path/,
    );

    assert.match(
      corpusViolations(corpusWith((files) => [
        ...files,
        {
          file: `${SCENARIO_ROOT}/new-thing.scenario.test.ts`,
          itTitles: [`${ownedId} — the same id, in a file its row does not name`],
        },
      ])),
      new RegExp(`declares scenario ${ownedId}, whose manifest row names ${owner.replaceAll("/", "\\/")}`),
    );

    assert.match(
      corpusViolations(corpusWith((files) => files.map((entry) => (entry.file === owner
        ? { file: entry.file, itTitles: entry.itTitles.filter((title) => claimedScenarioId(title) !== ownedId) }
        : entry)))),
      new RegExp(`carries a manifest row for ${ownedId} but declares no such test`),
    );

    assert.match(
      corpusViolations(corpusWith((files) => files.filter((entry) => entry.file !== owner))),
      new RegExp(`manifest rows name ${owner.replaceAll("/", "\\/")}, which is not in the scenario corpus`),
    );
  });

  it("rejects a dashboard scenario that claims a graph path or declares no test", () => {
    const claimed = String(EXECUTABLE_SCENARIO_MANIFEST[0].scenarioId);
    const file = `${SCENARIO_ROOT}/dashboard/separations/pretend.scenario.test.ts`;
    assert.match(
      corpusViolations(corpusWith((files) => [
        ...files,
        { file, itTitles: [`${claimed} — a T2 file pretending to walk the graph`] },
      ])),
      new RegExp(`pretend\\.scenario\\.test\\.ts is a dashboard scenario and may not claim scenario ${claimed}`),
    );
    assert.match(
      corpusViolations(corpusWith((files) => [...files, { file, itTitles: [] }])),
      /pretend\.scenario\.test\.ts declares no test/,
    );
    // The manifest schema refuses a T2 path outright — the same rule from the
    // other side, so a row can never point at a file that walks no graph.
    assert.throws(
      () => ExecutableScenarioSpecSchema.parse({ scenarioId: claimed, file }),
      /invalid_format|regex/u,
    );
  });

  it("rejects an integration walk that claims a graph path or carries a manifest row", () => {
    const claimed = String(EXECUTABLE_SCENARIO_MANIFEST[0].scenarioId);
    assert.match(
      corpusViolations(corpusWith((files) => [
        ...files,
        {
          file: `${SCENARIO_ROOT}/operator-lifecycle.walk.test.ts`,
          itTitles: [`${claimed} — a walk pretending to be a graph scenario`],
        },
      ])),
      new RegExp(`operator-lifecycle\\.walk\\.test\\.ts is an integration walk and may not claim scenario ${claimed}`),
    );
    // A manifest row can only name a `.scenario.test.ts` — the schema regex
    // refuses a walk path outright, which is the same rule from the other side.
    assert.throws(
      () => ExecutableScenarioSpecSchema.parse({
        scenarioId: claimed,
        file: `${SCENARIO_ROOT}/operator-lifecycle.walk.test.ts`,
      }),
    );
  });

  it("catches a claim corpus that drifted from the graph it covers", () => {
    const points = workflowProjections(fixtureDescriptor).coveragePoints;
    const dropped = SCENARIO_COVERAGE_CLAIMS["fixture-graph"].slice(1);
    assert.ok(auditGraphScenarioCoverage(points, dropped).length > 0);
  });

  it("counts an un-awaited fan-out's join policies as no path at all", () => {
    // A `join:"none"` edge has no join to exercise, so claiming a policy point
    // for it would be coverage theatre. The derivation omits them.
    const points = deriveGraphCoveragePoints(descriptorRuntimeNodes(fixtureDescriptor));
    const awaited = points.filter((point) => point.id.startsWith("delegation:notify/on-child-failed"));
    assert.equal(awaited.length, 1, "an awaited edge contributes exactly its declared failure policy");
  });
});
