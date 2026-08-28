/**
 * `workflow-editor-compile-integrity` — Phase A projection + Phase B safe edits.
 *
 * Ref guards-and-tests §3.10 writes this guard's invariant in two halves:
 *
 *   1. **Phase A (ref operator-trust §5.2, live now).** "Phase-2 read-only explorer
 *      projections round-trip from the real descriptor/contract/UI registries."
 *      Every arm below enforces exactly that, plus D79a's standing "no
 *      DSL/codegen artifact exists" and Phase A's read-only boundary.
 *   2. **Phase B (ref operator-trust §5.3/§5.4).** Draft edits are confined to
 *      the closed presentation/policy/Edit Data union, bind exact descriptor
 *      version+fingerprint and override revision, validate field ownership at
 *      ingress and apply, and reach one atomic versioned authority.
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
import { descriptorSourcePath, moduleSourcePath } from "../../../src/domain/workflow/source-layout.js";
import {
  ExplorerEditApplyRequestSchema,
  ExplorerEditChangeSchema,
  ExplorerEditDraftSchema,
} from "../../../src/domain/dashboard/explorer-edit.js";

const PROJECTION_FILE = "src/server/dashboard/queries/explorer.ts";
const WIRE_FILE = "src/domain/dashboard/explorer.ts";
const EDIT_SERVICE_FILE = "src/server/dashboard/commands/explorer-edit-service.ts";
const EDIT_AUTHORITY_FILE = "src/infra/explorer-edit-authority.ts";
const API_FILE = "src/server/dashboard/routes/api.ts";
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

/* ── 3. Phase A reference surfaces remain read-only ─────────────────────── */

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

  it("keeps both Phase-A reference documents on their GET routes", () => {
    const routes = read("src/server/dashboard/routes/api.ts");
    for (const path of ["/api/v1/explorer", "/api/v1/ui-catalog"]) {
      assert.ok(routes.includes(`app.get("${path}"`), `${path} must be registered with app.get`);
      for (const verb of ["post", "put", "patch", "delete"]) {
        assert.ok(
          !routes.includes(`app.${verb}("${path}"`),
          `${path} must have no ${verb.toUpperCase()} counterpart; edits use the separate apply route`,
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

/* ── 4. Phase B is one closed, stale-base-refusing authority ─────────────── */

const CLOSED_EDIT_KINDS = [
  "workflow-label",
  "workflow-icon",
  "workflow-category",
  "timeline-category-label",
  "timeline-category-order",
  "notification-preference",
  "enqueue-policy",
  "edit-data-fields",
] as const;

export function atomicOverrideViolations(source: string): string[] {
  const boundary = source.indexOf("#atomicReplace(");
  const body = boundary === -1 ? source : source.slice(boundary);
  const required = ["openSync(temporary, \"wx\"", "fsyncSync(handle)", "renameSync(temporary, this.#path)", "syncPath(dirname(this.#path))"];
  const positions = required.map((needle) => body.indexOf(needle));
  const violations: string[] = [];
  required.forEach((needle, index) => {
    if (positions[index] === -1) violations.push(`missing ${needle}`);
  });
  if (positions.every((position) => position >= 0)
    && positions.some((position, index) => index > 0 && position <= (positions[index - 1] ?? -1))) {
    violations.push("atomic override operations are out of order");
  }
  return violations;
}

describe("the Phase B edit protocol is closed and authority-backed", () => {
  it("pins the closed change union in both directions", () => {
    const kinds = ExplorerEditChangeSchema.options.map((option) => option.shape.kind.value);
    assert.deepEqual(kinds, CLOSED_EDIT_KINDS);

    for (const kind of ["javascript", "graph", "selector", "secret", "checkpoint-value"]) {
      const parsed = ExplorerEditDraftSchema.safeParse({
        draftVersion: 1,
        workflowId: "person-lookup",
        baseDescriptorVersion: 1,
        baseContractFingerprint: "a".repeat(64),
        baseOverrideRevision: 0,
        changes: [{ kind, value: "invented" }],
      });
      assert.equal(parsed.success, false, `${kind} entered the closed draft union`);
    }
  });

  it("requires descriptor version, fingerprint and override revision on every apply", () => {
    const draft = {
      draftVersion: 1,
      workflowId: "person-lookup",
      baseDescriptorVersion: 1,
      baseContractFingerprint: "a".repeat(64),
      baseOverrideRevision: 0,
      changes: [{ kind: "workflow-label", value: "People" }],
    };
    const envelope = {
      commandVersion: 1,
      commandId: "11111111-1111-4111-8111-111111111111",
      draft,
    };
    assert.equal(ExplorerEditApplyRequestSchema.safeParse(envelope).success, true);
    for (const field of ["baseDescriptorVersion", "baseContractFingerprint", "baseOverrideRevision"] as const) {
      const { [field]: _removed, ...without } = draft;
      assert.equal(ExplorerEditApplyRequestSchema.safeParse({ ...envelope, draft: without }).success, false);
    }
  });

  it("validates ownership at ingress and again inside the authority CAS window", () => {
    const service = read(EDIT_SERVICE_FILE);
    assert.ok(service.includes("validateChangeOwnership(descriptor, change)"));
    assert.ok(
      (service.match(/this\.compile\(request\)/gu) ?? []).length >= 2,
      "the service must compile once at ingress and again from the authority callback",
    );
    assert.ok(service.includes("baseContractFingerprint"));
    assert.ok(service.includes("baseDescriptorVersion"));
  });

  it("writes through temp, fsync, atomic replace and directory fsync in order", () => {
    assert.deepEqual(atomicOverrideViolations(read(EDIT_AUTHORITY_FILE)), []);
  });

  it("the atomic-write arm fails against a violating fixture", () => {
    assert.deepEqual(atomicOverrideViolations("writeFileSync(path, JSON.stringify(value));"), [
      'missing openSync(temporary, "wx"',
      "missing fsyncSync(handle)",
      "missing renameSync(temporary, this.#path)",
      "missing syncPath(dirname(this.#path))",
    ]);
  });

  it("serves exactly one dedicated apply route and keeps graph GET separate", () => {
    const routes = read(API_FILE);
    assert.ok(routes.includes('app.get("/api/v1/explorer"'));
    assert.equal((routes.match(/app\.post\("\/api\/v1\/explorer\/apply"/gu) ?? []).length, 1);
    assert.ok(routes.includes("ExplorerEditApplyRequestSchema.parse"));
    assert.ok(!routes.includes('app.post("/api/v1/explorer"'));
  });
});

/* ── 5. D79a: no DSL / codegen authoring artifact exists ─────────────────── */

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
      // D265 §1.2.2: a descriptor's path is derived from its ROLE — a harness
      // lives inside the step it proves — through the same helper
      // `descriptor-coverage` reads, so the two guards hold one rule.
      const descriptorPath = descriptorSourcePath(id, module.role);
      const modulePath = moduleSourcePath(id, module.role);
      assert.ok(tracked.has(descriptorPath), `${id} has no source-authored descriptor at ${descriptorPath}`);
      assert.ok(tracked.has(modulePath), `${id} has no source composition module at ${modulePath}`);
    }
  });

  it("ships no workflow-design runtime authority", () => {
    // Ref operator-trust §5.6: generated `config/workflow-design/*.md` files are not runtime
    // authority. The descriptor is. A directory appearing here would be a second
    // authority for what a workflow IS.
    assert.deepEqual(gitVisibleFiles(["config/workflow-design"]), []);
  });
});
