
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { DESCRIPTORS } from "../../../src/backend/app/registries/workflow-registry.js";
import { HISTORICAL_STEP_PROOF_DESCRIPTORS } from "../../../src/backend/app/registries/step-proof-modules.js";
import { workflowProjections } from "../../../src/workflow-kit/workflow.js";
import { ScenarioIdSchema } from "../../../src/rules/identity/ids.js";
import {
  auditGraphScenarioCoverage,
  deriveGraphCoveragePoints,
} from "../../../src/workflow-kit/validation/scenario-coverage.js";
import type { ScenarioCoverageClaim } from "../../../src/workflow-kit/validation/scenario-coverage.js";
import { descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";
import {
  DECLARED_SCENARIO_MANIFEST,
  ExecutableScenarioSpecSchema,
  DASHBOARD_SCENARIO_FILE_PATTERN,
  GRAPH_SCENARIO_FILE_PATTERN,
  INTEGRATION_WALK_FILE_PATTERN,
  auditExecutableScenarioParity,
  auditScenarioCorpusLayout,
  claimedScenarioId,
} from "../../../src/workflow-kit/validation/scenario-execution.js";
import type { ScenarioCorpusFile } from "../../../src/workflow-kit/validation/scenario-execution.js";
import { taskStoreRegistry } from "../../../src/backend/app/registries/task-registry.js";
import { fixtureDescriptor } from "../../support/fixtures/descriptor-fixtures.js";


function fullClaims(pointIds: readonly string[]): readonly ScenarioCoverageClaim[] {
  return pointIds.map((pointId, index) => ({
    scenarioId: ScenarioIdSchema.parse(`fixture-graph/point-${String(index)}`),
    covers: [pointId],
  }));
}


function productionScenarioReferences(): readonly string[] {
  return [...new Set([
    ...[...DESCRIPTORS, ...HISTORICAL_STEP_PROOF_DESCRIPTORS].flatMap((descriptor) => [
      ...descriptor.scenarios.map(String),
      ...workflowProjections(descriptor).contracts.flatMap((contract) =>
        contract.scenarios.map(String)),
    ]),
    ...taskStoreRegistry.stores.flatMap((store) =>
      Object.values(store.tasks).flatMap((task) => task.contract.scenarios.map(String))),
  ])];
}

const SCENARIO_ROOT = "tests/scenario";

function syntheticObservedScenarioIds(): readonly string[] {
  return DECLARED_SCENARIO_MANIFEST.map(({ scenarioId }) => String(scenarioId));
}

function scenarioCorpusFiles(): readonly ScenarioCorpusFile[] {
  const byFile = new Map<string, string[]>();
  for (const { file, scenarioId } of DECLARED_SCENARIO_MANIFEST) {
    const titles = byFile.get(file) ?? [];
    titles.push(`${String(scenarioId)} — synthetic claim`);
    byFile.set(file, titles);
  }
  return [...byFile].map(([file, itTitles]) => ({ file, itTitles }));
}


function nonSyntheticScenarioEidLocations(
  sources: readonly Readonly<{ file: string; source: string }>[],
): readonly string[] {
  const reserved = /^(?:108000\d{2}|19999999)$/u;
  return sources.flatMap(({ file, source }) =>
    source
        .split("\n")
        .flatMap((line, index) => (
          [...line.matchAll(/(?<![0-9A-Za-z-])1\d{7}(?![0-9A-Za-z-])/gu)]
            .some((match) => !reserved.test(match[0]))
            ? [`${file}:${String(index + 1)}`]
            : []
        )),
  );
}

/** The fixture side: paths claimed for descriptors with no production reference. */
function graphClaimedScenarioIds(): readonly string[] {
  return syntheticObservedScenarioIds();
}

/** The synthetic manifest corpus with one deliberate mutation. */
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

  it("finds a non-synthetic EID in scenario support without echoing its value", () => {
    const locations = nonSyntheticScenarioEidLocations([{
      file: "tests/scenario/dashboard/example/world.ts",
      source: 'export const FIXTURE_EID = "10770001";',
    }]);
    assert.deepEqual(locations, ["tests/scenario/dashboard/example/world.ts:1"]);
    assert.doesNotMatch(locations.join("\n"), /10770001/u);
  });

  it("rejects typo references, orphan rows, and registered scenarios that did not execute", () => {
    const referenced = productionScenarioReferences();
    const observed = syntheticObservedScenarioIds();

    assert.match(
      auditExecutableScenarioParity([...referenced, "person-lookup/typo-reference"], observed).join("\n"),
      /referenced scenario person-lookup\/typo-reference is not registered as executable/,
    );

    const orphanedId = String(DECLARED_SCENARIO_MANIFEST[0]?.scenarioId);
    assert.match(
      auditExecutableScenarioParity(
        referenced.filter((scenarioId) => scenarioId !== orphanedId),
        observed,
      ).join("\n"),
      new RegExp(`executable scenario ${orphanedId} is orphaned`),
    );

    const unexecutedId = String(DECLARED_SCENARIO_MANIFEST.at(-1)?.scenarioId);
    assert.match(
      auditExecutableScenarioParity(
        referenced,
        observed.filter((scenarioId) => scenarioId !== unexecutedId),
      ).join("\n"),
      new RegExp(`registered scenario ${unexecutedId} was not executed`),
    );
  });


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
    // The separator distinguishes an unregistered id from prose explaining one.
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
    const row = DECLARED_SCENARIO_MANIFEST[0];
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
    const claimed = String(DECLARED_SCENARIO_MANIFEST[0].scenarioId);
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

    assert.throws(
      () => ExecutableScenarioSpecSchema.parse({ scenarioId: claimed, file }),
      /invalid_format|regex/u,
    );
  });

  it("rejects an integration walk that claims a graph path or carries a manifest row", () => {
    const claimed = String(DECLARED_SCENARIO_MANIFEST[0].scenarioId);
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
    const dropped = fullClaims(points.map((point) => point.id)).slice(1);
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
