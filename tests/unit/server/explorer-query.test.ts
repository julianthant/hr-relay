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
  ExplorerWorkflowOverrideSchema,
  type ExplorerProvenanceWire,
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

/** Every task arm of every registered workflow, flattened. */
function allTasks() {
  return buildWorkflowExplorer(explorerQueryDeps(CLOCK, HASH))
    .workflows.flatMap((workflow) => workflow.nodes.flatMap((node) => node.tasks));
}

describe("the contract field census (D227)", () => {
  it("gives every arm a field for every leaf of both its schemas", () => {
    for (const task of allTasks()) {
      assert.ok(
        task.fields.length > 0,
        `${String(task.taskId)} serves no field census`,
      );
      assert.ok(task.fields.some((field) => field.side === "input"));
      assert.ok(task.fields.some((field) => field.side === "output"));
    }
  });

  it("never records an INPUT leaf as an observation — the graph binds it", () => {
    for (const task of allTasks()) {
      for (const field of task.fields.filter((one) => one.side === "input")) {
        assert.equal(
          field.recorded.state,
          "bound",
          `${String(task.taskId)} input ${String(field.path)} claims to be observed`,
        );
      }
    }
  });

  it("resolves a read output's provenance by the LONGEST declared prefix, as the kernel does", () => {
    const search = allTasks().find((task) => String(task.taskId) === "ucpath/search-person-org");
    assert.ok(search !== undefined);
    assert.ok(search.provenance !== undefined);
    for (const field of search.fields.filter((one) => one.side === "output")) {
      assert.equal(field.recorded.state, "observed");
      if (field.recorded.state !== "observed") continue;
      const rules: readonly ExplorerProvenanceWire["byField"][number][] = search.provenance.byField;
      const matching = rules
        .filter((entry) => String(field.path) === String(entry.path)
          || String(field.path).startsWith(`${String(entry.path)}.`))
        .toSorted((left, right) => String(right.path).length - String(left.path).length)[0];
      assert.equal(field.recorded.source, matching?.source ?? search.provenance.default);
    }
  });

  it("states what holds a WRITE arm's fields rather than calling them observations", () => {
    const prepare = allTasks().find((task) => task.effect === "prepare");
    const commit = allTasks().find((task) => task.effect === "commit");
    assert.ok(prepare !== undefined && commit !== undefined);
    for (const field of prepare.fields.filter((one) => one.side === "output")) {
      // A prepare's product is browser state, and its checkpoint is
      // in-memory-only — so nothing durable holds the field, and the column
      // says that rather than leaving a blank a reader would read as "none".
      assert.equal(field.recorded.state, "not-recorded");
    }
    for (const field of commit.fields.filter((one) => one.side === "output")) {
      assert.equal(field.recorded.state, "checkpointed");
    }
  });

  it("serves a field census whose paths every policy rule can name", () => {
    for (const task of allTasks()) {
      const outputs = new Set(
        task.fields.filter((field) => field.side === "output").map((field) => String(field.path)),
      );
      for (const rule of task.provenance?.byField ?? []) {
        assert.ok(
          outputs.has(String(rule.path))
            || [...outputs].some((path) => path.startsWith(`${String(rule.path)}.`)),
          `${String(task.taskId)} provenance rule ${String(rule.path)} names no censused field`,
        );
      }
      for (const rule of task.freshness?.byField ?? []) {
        assert.ok(
          outputs.has(String(rule.path))
            || [...outputs].some((path) => path.startsWith(`${String(rule.path)}.`)),
          `${String(task.taskId)} freshness rule ${String(rule.path)} names no censused field`,
        );
      }
    }
  });
});

describe("Explorer presentation override readback", () => {
  it("hot-applies only an exact descriptor-bound override and serves its revision", () => {
    const deps = explorerQueryDeps(CLOCK, HASH);
    const descriptor = deps.modules.find(({ descriptor }) => String(descriptor.id) === "person-lookup")?.descriptor;
    assert.ok(descriptor !== undefined);
    const wire = buildWorkflowExplorer({
      ...deps,
      overrides: {
        readAll: () => [ExplorerWorkflowOverrideSchema.parse({
          overrideVersion: 1,
          workflowId: descriptor.id,
          descriptorVersion: descriptor.version,
          contractFingerprint: descriptor.contractFingerprint,
          revision: 3,
          appliedCommandId: "11111111-1111-4111-8111-111111111111",
          commandFingerprint: "a".repeat(64),
          presentation: {
            label: "People search",
            icon: "Users",
            category: "operations",
          },
        })],
      },
    });
    const workflow = wire.workflows.find(({ id }) => String(id) === "person-lookup");
    assert.ok(workflow !== undefined);

    assert.equal(workflow.label, "People search");
    assert.equal(workflow.icon, "Users");
    assert.equal(workflow.category, "operations");
    assert.equal(workflow.edit.overrideRevision, 3);
    assert.deepEqual(workflow.edit.presentation.timeline, {
      state: "unavailable",
      reason: "timeline presentation has no complete hot-apply reader; it remains descriptor-owned",
    });
  });
});

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
    assert.deepEqual(
      roles.get("separations-kuali-read"),
      { kind: "chunk-harness", of: "separations", step: "kuali-extraction" },
    );
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
