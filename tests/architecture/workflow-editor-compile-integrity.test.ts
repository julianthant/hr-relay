import { dashboardRouteSource } from "./helpers/dashboard-route-source.js";
/**
 * `workflow-editor-compile-integrity` — Phase A projection + Phase B safe edits.
 *
 * Ref guards-and-tests §3.10 writes this guard's invariant in two halves; D283 activated the
 * strict safe subset of the second without activating new-workflow authoring:
 *
 *   1. **Phase A (ref operator-trust §5.2, live now).** "Phase-2 read-only explorer
 *      projections round-trip from the real descriptor/contract/UI registries."
 *      Every arm below enforces exactly that, plus D79a's standing "no
 *      DSL/codegen artifact exists" and Phase A's read-only boundary.
 *   2. **Phase B safe subset (ref operator-trust §5.3/§5.4, D283).** Strict drafts,
 *      stale-base refusal, command-only apply, exact override replacement and
 *      code-change briefs are enforced. Timeline/notification categories with
 *      no complete owner are named unavailable; §5.5 authoring remains deferred.
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
} from "../../src/base/workflow.js";
import { WORKFLOW_MODULES } from "../../src/backend/app/control/workflow-registry.js";
import { buildSafeUiCatalog } from "../../src/backend/systems/ucpath/driver/catalog.js";
import { explorerQueryDeps } from "../fixtures/explorer-seams.js";
import { buildWorkflowExplorer } from "../../src/backend/runs/dashboard/queries/explorer.js";
import { manualClock } from "../../src/domain/clock.js";
import { FingerprintSchema } from "../../src/domain/ids.js";
import {
  ExplorerCodeChangeBriefSchema,
  ExplorerEditDraftSchema,
} from "../../src/domain/dashboard/explorer.js";
import type { DashboardClient } from "../../src/dashboard/client/index.js";
import { buildExplorerCompileAttestation } from "../../src/backend/runs/dashboard/commands/explorer-edit-service.js";
import { REPO_ROOT, gitVisibleFiles, repoRelative, walkFiles } from "./helpers/guard-files.js";
import { workflowSourcePath } from "../../src/domain/workflow/source-layout.js";

const PROJECTION_FILE = "src/backend/runs/dashboard/queries/explorer.ts";
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

/* ── 3. Phase A reads stay structural; Phase B uses its one safe path ────── */

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

/** The D283 exception is one complete Explorer apply envelope, not a generic command escape hatch. */
export function explorerSafeCommandViolations(source: string): string[] {
  const violations: string[] = [];
  const calls = [...source.matchAll(/\bclient\.executeCommand\(\s*([A-Za-z_$][\w$]*)\s*\)/gu)];
  if (calls.length !== 1) {
    violations.push("must issue exactly one Explorer command");
  } else if (calls[0]?.[1] !== "request") {
    violations.push("must submit the reviewed Explorer request");
  }
  const request = source.match(
    /\bconst request = \{([\s\S]*?)\n\s*\};\n\s*setBusy\("apply"\)/u,
  )?.[1];
  if (request === undefined) {
    violations.push("must bind the command envelope immediately before apply");
    return violations;
  }
  if (!/\bfamily:\s*"explorer"\s+as const/u.test(request)) {
    violations.push("command family is not explorer");
  }
  if (!/\btype:\s*"apply-explorer-edit"\s+as const/u.test(request)) {
    violations.push("command type is not apply-explorer-edit");
  }
  return violations;
}

/**
 * Explorer may use only these typed client doors: review, its D283 command, and
 * exact projection readback. Adding another DashboardClient method is a new
 * dashboard authority and must first be explicitly reviewed here.
 */
const EXPLORER_SAFE_EDIT_CLIENT_METHODS = [
  "validateExplorerEdit",
  "executeCommand",
  "workflowExplorer",
] as const satisfies readonly (keyof DashboardClient)[];

export function explorerSafeEditClientMethodViolations(source: string): string[] {
  const allowed = new Set<string>(EXPLORER_SAFE_EDIT_CLIENT_METHODS);
  const invoked = [...source.matchAll(/\bclient\.([A-Za-z_$][\w$]*)\s*\(/gu)]
    .map((match) => match[1])
    .filter((method): method is string => method !== undefined);
  return [...new Set(invoked)]
    .filter((method) => !allowed.has(method))
    .map((method) => `calls DashboardClient.${method} outside the Explorer safe-edit allowlist`);
}

describe("the explorer surface keeps Phase A reads separate from the Phase B safe subset", () => {
  it("keeps the UI catalog structurally read-only", () => {
    assert.deepEqual(mutationAffordanceViolations(read("src/dashboard/surfaces/ui-catalog.tsx")), []);
  });

  it("reaches the server from Explorer only through the typed safe-edit clients", () => {
    const source = read("src/dashboard/surfaces/explorer.tsx");
    assert.deepEqual(mutationAffordanceViolations(source), ["calls the command client"]);
    assert.deepEqual(explorerSafeCommandViolations(source), []);
    assert.deepEqual(explorerSafeEditClientMethodViolations(source), []);
    assert.ok(source.includes("client.validateExplorerEdit(draft)"));
    assert.ok(source.includes("client.executeCommand(request)"));
    assert.ok(!source.includes("/api/v1/commands"));
    assert.ok(!source.includes("/api/v1/explorer/validate"));
  });

  it("the safe-command arm fails when a second command or another family/type is introduced", () => {
    const source = read("src/dashboard/surfaces/explorer.tsx");
    assert.deepEqual(
      explorerSafeCommandViolations(source.replace(
        'family: "explorer" as const',
        'family: "run" as const',
      )),
      ["command family is not explorer"],
    );
    assert.deepEqual(
      explorerSafeCommandViolations(source.replace(
        'type: "apply-explorer-edit" as const',
        'type: "retry" as const',
      )),
      ["command type is not apply-explorer-edit"],
    );
    assert.deepEqual(
      explorerSafeCommandViolations(`${source}\nvoid client.executeCommand(otherRequest);`),
      ["must issue exactly one Explorer command"],
    );
  });

  it("the typed safe-edit client allowlist rejects an unrelated DashboardClient method", () => {
    const source = read("src/dashboard/surfaces/explorer.tsx");
    assert.deepEqual(
      explorerSafeEditClientMethodViolations(`${source}\nvoid client.requestFailureAdvisory(runId);`),
      ["calls DashboardClient.requestFailureAdvisory outside the Explorer safe-edit allowlist"],
    );
  });

  it("the read-only arm fails on a violating fixture", () => {
    assert.deepEqual(
      mutationAffordanceViolations('await transport.requestJson("/api/v1/commands", { method: "POST" });'),
      ["reaches the command endpoint", "issues a mutating request"],
    );
  });

  it("registers both projection routes as GET only", () => {
    const routes = dashboardRouteSource();
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
    const query = read("src/backend/runs/dashboard/queries/ui-catalog.ts");
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

  it("every registered workflow is source-authored from its own workflow.ts definition", () => {
    const tracked = new Set(gitVisibleFiles(["src/workflows"]));
    for (const module of WORKFLOW_MODULES) {
      const id = String(module.descriptor.id);
      // D265 §1.2.2: a workflow's path is derived from its ROLE — a harness
      // lives inside the step it proves — through the same helper
      // `descriptor-coverage` reads, so the two guards hold one rule.
      const workflowPath = workflowSourcePath(id, module.role);
      assert.ok(tracked.has(workflowPath), `${id} has no source-authored workflow definition at ${workflowPath}`);
    }
  });

  it("ships no workflow-design runtime authority", () => {
    // Ref operator-trust §5.6: generated `config/workflow-design/*.md` files are not runtime
    // authority. The descriptor is. A directory appearing here would be a second
    // authority for what a workflow IS.
    assert.deepEqual(gitVisibleFiles(["config/workflow-design"]), []);
  });
});

/* ── 5. Phase B: the safe-edit boundary is closed and durable ───────────── */

describe("the Phase B safe-edit protocol cannot become a code-authoring path", () => {
  it("rejects every forbidden authoring category at the strict draft boundary", () => {
    const base = {
      draftVersion: 1,
      workflowId: "person-lookup",
      baseDescriptorVersion: 1,
      baseContractFingerprint: "a".repeat(64),
      baseOverrideRevision: 0,
    };
    for (const change of [
      { kind: "javascript", source: "return true" },
      { kind: "selector", value: "#submit" },
      { kind: "page-state", value: "ready" },
      { kind: "subject-matcher", value: "suffix" },
      { kind: "mutation-helper", value: "click" },
      { kind: "proof-schema", value: {} },
      { kind: "idempotency-key", value: "guessed" },
      { kind: "secret", value: "credential" },
      { kind: "new-workflow", value: "invented" },
    ]) {
      assert.equal(ExplorerEditDraftSchema.safeParse({ ...base, changes: [change] }).success, false);
    }
  });

  it("keeps override writes inside the command transaction with strict SQL readback and audit binding", () => {
    const repository = read("src/backend/storage/sqlite/explorer-overrides.ts");
    const database = read("src/backend/storage/sqlite/authority-database.ts");
    const kernel = read("src/backend/runs/command-kernel.ts");
    const service = read("src/backend/runs/dashboard/commands/explorer-edit-service.ts");
    const violations = (source: string): string[] => [
      "REFERENCES commands(record_key)", "ExplorerWorkflowOverrideSchema.parse", "assertExplorerOverrideEvidence",
      "explorer-override-command-transaction-required", "Explorer override readback differs",
    ].filter(token => !source.includes(token));
    assert.deepEqual(violations(repository), []);
    for (const token of violations("")) assert.deepEqual(violations(repository.replaceAll(token, "")), [token]);
    assert.match(database, /if \(this\.#explorerOverridesDirty\) validateExplorerOverrides\(this\.#database\)/u);
    assert.match(kernel, /executor\.apply\(request, repositories\)/u);
    assert.match(service, /const overrides = repositories\.explorerOverrides/u);
    assert.match(service, /overrides\.replace\(request, override\)/u);
    for (const source of [kernel, service, repository]) {
      assert.doesNotMatch(source, /finalizeAfterCommit|reconcilePending|writeFileSync|atomicReplace/u);
    }
  });

  it("keeps validation read-only and routes apply only through the command kernel", () => {
    const routes = dashboardRouteSource();
    assert.ok(routes.includes('app.post("/api/v1/explorer/validate"'));
    assert.ok(!routes.includes('/api/v1/explorer/apply'));
    const commands = read("src/domain/commands.ts");
    const explorer = read("src/domain/dashboard/explorer.ts");
    const kernel = read("src/backend/runs/command-kernel.ts");
    assert.ok(explorer.includes('type: z.literal("apply-explorer-edit")'));
    assert.ok(commands.includes("ExplorerCommandRequestSchema = ExplorerEditApplyRequestSchema"));
    assert.ok(kernel.includes('case "explorer"'));
    assert.ok(!routes.includes("/api/v1/explorer/new-workflow"));
  });

  it("binds presentation validation to all five runtime attestations and keeps source checks required", () => {
    const deps = explorerQueryDeps(
      manualClock(new Date("2026-08-28T12:00:00.000Z")),
      FingerprintSchema.parse("c".repeat(64)),
    );
    const wire = buildWorkflowExplorer(deps);
    const workflow = wire.workflows[0];
    assert.ok(workflow !== undefined);
    const attestation = buildExplorerCompileAttestation(deps, workflow);
    assert.deepEqual(Object.keys(attestation.checks), ["builder", "schema", "graph", "guard", "scenario"]);
    assert.deepEqual(
      Object.values(attestation.checks).map(({ state }) => state),
      ["held", "held", "held", "held", "held"],
    );

    const brokenDeps = { ...deps, listScenarioSources: () => [] };
    const brokenWire = buildWorkflowExplorer(brokenDeps);
    const brokenWorkflow = brokenWire.workflows[0];
    assert.ok(brokenWorkflow !== undefined);
    assert.throws(
      () => buildExplorerCompileAttestation(brokenDeps, brokenWorkflow),
      /compile attestation.*scenario.*unresolved/u,
    );
  });

  it("refuses non-canonical or unclosed TypeScript patch expressions", () => {
    const protocolSource = read("src/domain/dashboard/explorer.ts");
    for (const token of [
      "ExplorerCompileAttestationSchema",
      "canonicalDescriptorJson",
      "canonicalExpressionSchema",
      "runtime-registry-round-trip",
      "registered-source-resolution",
      "must-change",
    ]) {
      assert.ok(protocolSource.includes(token), `Explorer source brief protocol omits ${token}`);
    }
    assert.equal(ExplorerCodeChangeBriefSchema.safeParse({}).success, false);
    assert.match(
      protocolSource,
      /TypeScript operations must correspond one-for-one and in order with unique closed patch changes/u,
    );
  });
});
