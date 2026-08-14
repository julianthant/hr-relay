/**
 * 2i-G — the two read-only reference routes (D176/D177).
 *
 * The projection's ACCURACY against the descriptors is held by
 * `workflow-editor-compile-integrity`, which asserts it over the real registry
 * in both directions. What is pinned here is everything around that: the routes
 * serve a wire that parses, the honest-miss arms report what they looked for
 * rather than inventing it, and the catalog refuses a stale artifact BY NAME
 * instead of serving bytes that describe selectors this build does not use.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { manualClock } from "../../../src/domain/clock.js";
import { FingerprintSchema } from "../../../src/domain/ids.js";
import {
  UiCatalogWireSchema,
  WorkflowExplorerWireSchema,
} from "../../../src/domain/dashboard/explorer.js";
import {
  EXPLORER_SOURCE_ROOT,
  buildWorkflowExplorer,
  readScenarioSources,
} from "../../../src/server/dashboard/queries/explorer.js";
import {
  buildUiCatalogWire,
  readCommittedUiCatalog,
} from "../../../src/server/dashboard/queries/ui-catalog.js";
import { explorerQueryDeps, uiCatalogQueryDeps } from "../../fixtures/explorer-seams.js";

const CLOCK = manualClock(new Date("2026-08-09T12:00:00.000Z"));
const HASH = FingerprintSchema.parse("c".repeat(64));

describe("the workflow explorer projection", () => {
  it("parses through its own wire schema over the real registry", () => {
    const wire = buildWorkflowExplorer(explorerQueryDeps(CLOCK, HASH));
    // `buildWorkflowExplorer` already parses on the way out; re-parsing proves
    // the returned value is the wire, not a structurally similar object.
    assert.doesNotThrow(() => WorkflowExplorerWireSchema.parse(wire));
    assert.equal(wire.descriptorHash, HASH);
    assert.equal(wire.generatedAt, "2026-08-09T12:00:00.000Z");
  });

  it("is a pure function of registration state — two builds agree byte for byte", () => {
    const first = buildWorkflowExplorer(explorerQueryDeps(CLOCK, HASH));
    const second = buildWorkflowExplorer(explorerQueryDeps(CLOCK, HASH));
    assert.equal(JSON.stringify(first), JSON.stringify(second));
  });

  /**
   * D219 — the explorer is one of the three workflow-listing surfaces, so it
   * carries the same `role` fact the rail and the picker do, and refuses the
   * same nesting no surface could draw.
   */
  it("serves each module's declared role and refuses a harness with no composition beside it", () => {
    const wire = buildWorkflowExplorer(explorerQueryDeps(CLOCK, HASH));
    const roles = new Map(wire.workflows.map((workflow) => [String(workflow.id), workflow.role]));
    assert.deepEqual(roles.get("separations"), { kind: "composition" });
    assert.deepEqual(roles.get("separations-kuali-read"), { kind: "chunk-harness", of: "separations" });
    assert.deepEqual(roles.get("person-lookup"), { kind: "standalone" });

    // Drop the composition and the harnesses point at nothing this document
    // carries — the wire says so rather than serving an unnestable entry.
    const orphaned = WorkflowExplorerWireSchema.safeParse({
      ...wire,
      workflows: wire.workflows.filter((workflow) => String(workflow.id) !== "separations"),
    });
    assert.equal(orphaned.success, false);
    assert.match(
      JSON.stringify(orphaned.error?.issues ?? []),
      /is served as a chunk harness of separations/u,
    );
  });

  it("reports a scenario with no executable file as unresolved, naming the path it tried", () => {
    const deps = explorerQueryDeps(CLOCK, HASH);
    const wire = buildWorkflowExplorer({ ...deps, listScenarioSources: () => [] });
    const scenarios = wire.workflows.flatMap((workflow) => workflow.scenarios);
    assert.ok(scenarios.length > 0, "the registry declares scenarios");
    for (const scenario of scenarios) {
      assert.equal(scenario.source.state, "unresolved");
      if (scenario.source.state === "unresolved") {
        assert.match(String(scenario.source.attemptedPath), /^tests\/scenario\//u);
        assert.match(scenario.source.reason, /no executable scenario file/u);
      }
    }
  });

  it("refuses to place a contract no store binds and no pending entry tracks", () => {
    const deps = explorerQueryDeps(CLOCK, HASH);
    assert.throws(
      () => buildWorkflowExplorer({
        ...deps,
        // Strip every module's stores: the boot audit would refuse this
        // composition, and the explorer must refuse it too rather than
        // rendering a workflow whose contracts resolve to nothing.
        modules: deps.modules.map((module) => ({ ...module, stores: [] })),
      }),
      /no module store implements it/u,
    );
  });

  it("reads the executable scenario corpus from the source tree", () => {
    const sources = readScenarioSources(EXPLORER_SOURCE_ROOT);
    assert.ok(sources.length > 0, "the corpus is non-empty in this tree");
    for (const source of sources) assert.match(source.path, /^tests\/scenario\/.+\.scenario\.test\.ts$/u);
  });

  it("returns an empty corpus — never a throw — when the scenario directory is absent", () => {
    assert.deepEqual(readScenarioSources("/nonexistent-source-root-for-this-test"), []);
  });
});

describe("the committed UI catalog", () => {
  it("serves the tracked artifact, named by its own path", () => {
    const wire = buildUiCatalogWire(uiCatalogQueryDeps());
    assert.doesNotThrow(() => UiCatalogWireSchema.parse(wire));
    assert.equal(String(wire.sourcePath), "generated/ui-catalog.json");
    assert.equal(wire.schemaVersion, 1);
    assert.ok(wire.entries.length > 0);
  });

  it("serves the bytes on disk, not a rebuild of the registries", () => {
    const onDisk: unknown = JSON.parse(readCommittedUiCatalog(EXPLORER_SOURCE_ROOT));
    const wire = buildUiCatalogWire(uiCatalogQueryDeps());
    assert.equal(
      JSON.stringify(wire.entries),
      JSON.stringify((onDisk as { entries: unknown }).entries),
    );
  });

  it("refuses a STALE artifact by name rather than serving it", () => {
    const stale = JSON.parse(readCommittedUiCatalog(EXPLORER_SOURCE_ROOT)) as {
      schemaVersion: number;
      entries: { label: string }[];
    };
    const first = stale.entries[0];
    assert.ok(first !== undefined);
    first.label = "a label the driver registry does not declare";
    assert.throws(
      () => buildUiCatalogWire({ readCatalogJson: () => JSON.stringify(stale) }),
      /generated UI catalog is stale/u,
    );
  });

  it("refuses bytes that are not a catalog at all", () => {
    assert.throws(() => buildUiCatalogWire({ readCatalogJson: () => "{}" }));
  });
});
