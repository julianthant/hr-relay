/**
 * `workflow-editor-compile-integrity` — ACTIVATED at Phase A (2i-G, D176).
 *
 * Doc 10 §3.10 writes this guard's invariant in two halves, and only the first
 * exists today:
 *
 *   1. **Phase A (doc 12 §5.2, live now).** "Phase-2 read-only explorer
 *      projections round-trip from the real descriptor/contract/UI registries."
 *      Every arm below enforces exactly that, plus D79a's standing "no
 *      DSL/codegen artifact exists" and Phase A's read-only boundary.
 *   2. **Phase B (doc 12 §5.3/§5.4, NOT enforced).** Draft edits confined to the
 *      closed presentation/policy union, stale-base apply, and the code-change
 *      brief. None of that exists — there is no draft, no validate, no apply —
 *      so there is nothing to hold, and this file gains those arms in the same
 *      commit that builds them. The inventory entry says so in as many words;
 *      a guard whose invariant text overstated its coverage would be worse
 *      than a planned one.
 *
 * The load-bearing arm is the first: the explorer's whole claim is "this is the
 * as-built graph", and a projection that could quietly become a hand-maintained
 * copy would make that claim unfalsifiable. So the round-trip is asserted over
 * the REAL registry — not a fixture — in both directions, and the static arms
 * that keep it derivable each run against a violating fixture.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  descriptorRuntimeNodes,
  workflowProjections,
} from "../../../src/base/workflow.js";
import { WORKFLOW_MODULES } from "../../../src/control/workflow-registry.js";
import { buildSafeUiCatalog } from "../../../src/stores/ucpath/driver/catalog.js";
import { explorerQueryDeps } from "../../fixtures/explorer-seams.js";
import { buildWorkflowExplorer } from "../../../src/server/dashboard/queries/explorer.js";
import { manualClock } from "../../../src/domain/clock.js";
import { FingerprintSchema } from "../../../src/domain/ids.js";
import { REPO_ROOT, gitVisibleFiles, repoRelative, walkFiles } from "./helpers/guard-files.js";

const PROJECTION_FILE = "src/server/dashboard/queries/explorer.ts";
const WIRE_FILE = "src/domain/dashboard/explorer.ts";
const SURFACE_FILES = [
  "src/dashboard/surfaces/explorer.tsx",
  "src/dashboard/surfaces/ui-catalog.tsx",
];

function read(path: string): string {
  return readFileSync(join(REPO_ROOT, path), "utf8");
}

function explorerWire() {
  const clock = manualClock(new Date("2026-08-09T12:00:00.000Z"));
  return buildWorkflowExplorer(explorerQueryDeps(clock, FingerprintSchema.parse("b".repeat(64))));
}

/* ── 1. the projection round-trips from the real registries ──────────────── */

describe("the explorer projection is derived from the composition root", () => {
  it("serves exactly the registered workflows, in the registry's own order", () => {
    const wire = explorerWire();
    assert.deepEqual(
      wire.workflows.map((workflow) => String(workflow.id)),
      WORKFLOW_MODULES.map((module) => String(module.descriptor.id)),
    );
  });

  it("serves exactly each descriptor's own nodes, kinds, dependencies and labels", () => {
    const wire = explorerWire();
    for (const module of WORKFLOW_MODULES) {
      const served = wire.workflows.find((one) => String(one.id) === String(module.descriptor.id));
      assert.ok(served !== undefined, `${String(module.descriptor.id)} is not served`);
      const nodes = descriptorRuntimeNodes(module.descriptor);
      assert.deepEqual(
        served.nodes.map((node) => String(node.id)),
        nodes.map((node) => String(node.id)),
        `${String(module.descriptor.id)}: node identities or order drifted from the descriptor`,
      );
      assert.deepEqual(
        served.nodes.map((node) => node.shape.kind),
        nodes.map((node) => node.kind),
        `${String(module.descriptor.id)}: node kinds drifted from the descriptor`,
      );
      for (const [index, node] of nodes.entries()) {
        assert.deepEqual(
          served.nodes[index]?.dependsOn.map(String),
          node.dependsOn.map(String),
          `${String(module.descriptor.id)}/${String(node.id)}: dependsOn drifted`,
        );
      }
    }
  });

  it("serves exactly the contracts the descriptor's own projection names", () => {
    const wire = explorerWire();
    for (const module of WORKFLOW_MODULES) {
      const served = wire.workflows.find((one) => String(one.id) === String(module.descriptor.id));
      assert.ok(served !== undefined);
      const projected = workflowProjections(module.descriptor).contracts
        .map((contract) => String(contract.id)).sort();
      const rendered = served.nodes
        .flatMap((node) => node.tasks.map((task) => String(task.taskId)))
        .sort();
      // Both directions: an unrendered contract hides work the run does, and a
      // rendered contract the descriptor never names is invented.
      assert.deepEqual(rendered, projected, String(module.descriptor.id));
    }
  });

  it("renders every derived graph coverage point exactly once", () => {
    const wire = explorerWire();
    for (const module of WORKFLOW_MODULES) {
      const served = wire.workflows.find((one) => String(one.id) === String(module.descriptor.id));
      assert.ok(served !== undefined);
      const derived = workflowProjections(module.descriptor).coveragePoints.map((point) => point.id).sort();
      const rendered = served.nodes.flatMap((node) => node.coveragePoints.map((point) => point.id)).sort();
      assert.deepEqual(rendered, derived, String(module.descriptor.id));
    }
  });

  it("names only UI ids the generated catalog itself declares, in both directions", () => {
    const wire = explorerWire();
    const catalog = buildSafeUiCatalog();
    const known = new Set(catalog.entries.map((entry) => String(entry.id)));
    const declared = new Map<string, Set<string>>();
    for (const entry of catalog.entries) {
      for (const taskId of entry.taskUses) {
        const set = declared.get(String(taskId)) ?? new Set<string>();
        set.add(String(entry.id));
        declared.set(String(taskId), set);
      }
    }
    for (const workflow of wire.workflows) {
      for (const node of workflow.nodes) {
        for (const task of node.tasks) {
          for (const link of task.ui) {
            assert.ok(known.has(link.catalogId), `${String(task.taskId)} names unknown UI id ${link.catalogId}`);
          }
          // The reverse: every id the CATALOG says this contract uses must be
          // rendered, or the explorer under-reports what a task touches.
          assert.deepEqual(
            [...task.ui.map((link) => link.catalogId)].sort(),
            [...(declared.get(String(task.taskId)) ?? new Set<string>())].sort(),
            `${String(task.taskId)}: UI links disagree with the catalog's taskUses`,
          );
        }
      }
    }
  });

  it("resolves every source link it prints against a real file", () => {
    const wire = explorerWire();
    const tracked = new Set(gitVisibleFiles(["src", "tests", "generated", "config"]));
    const links = wire.workflows.flatMap((workflow) => [
      workflow.sources.descriptor,
      workflow.sources.module,
      ...workflow.scenarios.map((scenario) => scenario.source),
      ...workflow.nodes.flatMap((node) =>
        node.tasks.flatMap((task) => [task.contractSource, task.implSource])),
    ]);
    // Phase A's registry is fully bound, so every link must RESOLVE — and a
    // resolved link that points at a file git does not track would be a path
    // the reader cannot open.
    for (const link of links) {
      assert.equal(link.state, "resolved", `unresolved source link: ${JSON.stringify(link)}`);
      if (link.state === "resolved") assert.ok(tracked.has(String(link.path)), String(link.path));
    }
  });

  it("carries no node the graph does not declare, and no edge to an unknown node", () => {
    const wire = explorerWire();
    for (const workflow of wire.workflows) {
      const ids = new Set(workflow.nodes.map((node) => String(node.id)));
      for (const edge of workflow.edges) {
        assert.ok(ids.has(String(edge.from)), `${String(workflow.id)}: edge from ${String(edge.from)}`);
        assert.ok(ids.has(String(edge.to)), `${String(workflow.id)}: edge to ${String(edge.to)}`);
      }
    }
  });
});

/* ── 2. it CANNOT become a hand-maintained copy ──────────────────────────── */

/** Node-id-shaped string literals, which is what a hardcoded graph looks like. */
export function literalNodeIdViolations(source: string, allowed: readonly string[]): string[] {
  const allow = new Set(allowed);
  const violations: string[] = [];
  for (const match of source.matchAll(/(?<![\w$])(?:nodes|cases|branches)\s*:\s*\[\s*"([a-z0-9-]+)"/gu)) {
    const literal = match[1] ?? "";
    if (!allow.has(literal)) violations.push(`literal node list entry "${literal}"`);
  }
  return violations;
}

describe("the projection cannot become a parallel graph", () => {
  it("derives its nodes from the descriptor factory, never from a literal list", () => {
    const source = read(PROJECTION_FILE);
    assert.ok(
      source.includes("descriptorRuntimeNodes("),
      `${PROJECTION_FILE} must read nodes through descriptorRuntimeNodes`,
    );
    assert.ok(
      source.includes("workflowProjections("),
      `${PROJECTION_FILE} must read contracts through the descriptor's own projections`,
    );
    assert.deepEqual(literalNodeIdViolations(source, []), []);
  });

  it("the literal-graph arm fails on a violating fixture", () => {
    const violating = 'const graph = { nodes: ["searching", "cross-verify"] };';
    assert.deepEqual(literalNodeIdViolations(violating, []), [
      'literal node list entry "searching"',
    ]);
  });

  it("names no workflow id literal, so a rename cannot leave a stale branch behind", () => {
    const registered = WORKFLOW_MODULES.map((module) => String(module.descriptor.id));
    for (const path of [PROJECTION_FILE, WIRE_FILE, ...SURFACE_FILES]) {
      const source = read(path);
      for (const id of registered) {
        assert.ok(
          !source.includes(`"${id}"`),
          `${path} hardcodes the workflow id "${id}"; the projection must stay registry-driven`,
        );
      }
    }
  });
});

/* ── 3. Phase A is READ-ONLY, structurally ───────────────────────────────── */

export function mutationAffordanceViolations(source: string): string[] {
  const violations: string[] = [];
  // The three ways a dashboard surface reaches the server with an intent: the
  // command endpoint, the command client, and a non-GET fetch.
  for (const [pattern, message] of [
    [/\/api\/v1\/commands/u, "reaches the command endpoint"],
    [/\bexecuteCommand\b|\bcommands\.\w+\(/u, "calls the command client"],
    [/method:\s*"(?:POST|PUT|PATCH|DELETE)"/u, "issues a mutating request"],
  ] as const) {
    if (pattern.test(source)) violations.push(message);
  }
  return violations;
}

describe("the Phase A surfaces offer no mutation", () => {
  it("neither explorer surface can send an intent to the server", () => {
    for (const path of SURFACE_FILES) {
      assert.deepEqual(mutationAffordanceViolations(read(path)), [], path);
    }
  });

  it("the read-only arm fails on a violating fixture", () => {
    assert.deepEqual(
      mutationAffordanceViolations('await transport.requestJson("/api/v1/commands", { method: "POST" });'),
      ["reaches the command endpoint", "issues a mutating request"],
    );
  });

  it("registers both routes as GET only", () => {
    const routes = read("src/server/dashboard/routes/api.ts");
    for (const path of ["/api/v1/explorer", "/api/v1/ui-catalog"]) {
      assert.ok(routes.includes(`app.get("${path}"`), `${path} must be registered with app.get`);
      for (const verb of ["post", "put", "patch", "delete"]) {
        assert.ok(
          !routes.includes(`app.${verb}("${path}"`),
          `${path} must have no ${verb.toUpperCase()} counterpart while Phase A is read-only`,
        );
      }
    }
  });

  it("serves the COMMITTED catalog and never regenerates it", () => {
    const query = read("src/server/dashboard/queries/ui-catalog.ts");
    assert.ok(query.includes("assertSafeUiCatalogFresh"), "the served catalog must be freshness-asserted");
    for (const writer of ["writeFileSync", "writeFile(", "publishArtifact", "uiCatalogProjections"]) {
      assert.ok(
        !query.includes(writer),
        `the catalog query must never write a tracked artifact (found ${writer})`,
      );
    }
  });
});

/* ── 4. D79a: no DSL / codegen authoring artifact exists ─────────────────── */

describe("no DSL or generated-descriptor authoring artifact exists (D79a)", () => {
  it("carries no generated descriptor anywhere in the tree", () => {
    const generated = walkFiles(join(REPO_ROOT, "src"), { extensions: [".ts", ".tsx"] })
      .map(repoRelative)
      .filter((path) => /descriptor\.generated\.tsx?$/u.test(path));
    assert.deepEqual(generated, []);
  });

  it("every registered workflow is source-authored from its own descriptor file", () => {
    const tracked = new Set(gitVisibleFiles(["src/workflows"]));
    for (const module of WORKFLOW_MODULES) {
      const id = String(module.descriptor.id);
      assert.ok(tracked.has(`src/workflows/${id}/descriptor.ts`), `${id} has no source-authored descriptor`);
      assert.ok(tracked.has(`src/workflows/${id}/module.ts`), `${id} has no source composition module`);
    }
  });

  it("ships no workflow-design runtime authority", () => {
    // Doc 12 §5.6: generated `config/workflow-design/*.md` files are not runtime
    // authority. The descriptor is. A directory appearing here would be a second
    // authority for what a workflow IS.
    assert.deepEqual(gitVisibleFiles(["config/workflow-design"]), []);
  });
});
