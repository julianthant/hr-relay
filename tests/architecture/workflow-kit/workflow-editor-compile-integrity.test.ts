import { dashboardRouteSource } from "../dashboard/helpers/dashboard-route-source.js";

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  descriptorRuntimeNodes,
  workflowProjections,
} from "../../../src/workflow-kit/workflow.js";
import { WORKFLOW_MODULES } from "../../../src/backend/app/registries/workflow-registry.js";
import { buildUiTaskLinks } from "../../../src/backend/systems/ui-task-links.js";
import { explorerQueryDeps } from "../../support/fixtures/explorer-seams.js";
import { buildWorkflowExplorer, EXPLORER_SOURCE_ROOT, readScenarioSources } from "../../../src/backend/runs/queries/explorer.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { FingerprintSchema } from "../../../src/rules/identity/ids.js";
import {
  ExplorerCodeChangeBriefSchema,
  ExplorerEditDraftSchema,
} from "../../../src/models/dashboard/explorer.js";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { buildExplorerCompileAttestation } from "../../../src/backend/runs/commands/explorer-edit-service.js";
import { REPO_ROOT, gitVisibleFiles, repoRelative, walkFiles } from "../support/helpers/guard-files.js";
import { workflowSourcePath } from "../../../src/workflow-kit/validation/source-layout.js";

const PROJECTION_FILE = "src/backend/runs/queries/explorer.ts";
const WIRE_FILE = "src/models/dashboard/explorer.ts";
const SURFACE_FILES: string[] = [];

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

  it("names only semantic UI ids attributed to each task, in both directions", () => {
    const wire = explorerWire();
    const links = buildUiTaskLinks();
    const known = new Map(links.map((entry) => [entry.id, entry]));
    for (const workflow of wire.workflows) {
      for (const node of workflow.nodes) {
        for (const task of node.tasks) {
          for (const link of task.ui) {
            const declared = known.get(link.catalogId);
            assert.ok(declared !== undefined, `${String(task.taskId)} names unknown UI id ${link.catalogId}`);
            assert.ok(declared.taskUses.includes(task.taskId), `${String(task.taskId)} is not attributed to ${link.catalogId}`);
          }
          assert.deepEqual(
            [...task.ui.map((link) => link.catalogId)].sort(),
            links.filter((link) => link.taskUses.includes(task.taskId)).map(({ id }) => id).sort(),
            `${String(task.taskId)}: semantic task links disagree with registry attribution`,
          );
        }
      }
    }
  });

  it("resolves every source link it prints against a real file", () => {
    const clock = manualClock(new Date("2026-08-09T12:00:00.000Z"));
    const wire = buildWorkflowExplorer({
      ...explorerQueryDeps(clock, FingerprintSchema.parse("b".repeat(64))),
      listScenarioSources: () => readScenarioSources(EXPLORER_SOURCE_ROOT),
    });
    const scenarioSources = readScenarioSources(EXPLORER_SOURCE_ROOT);
    const tracked = new Set(gitVisibleFiles(["src", "tests", "generated", "config"]));
    const links = wire.workflows.flatMap((workflow) => [
      workflow.sources.descriptor,
      workflow.sources.module,
      ...workflow.nodes.flatMap((node) =>
        node.tasks.flatMap((task) => [task.contractSource, task.implSource])),
    ]);
    for (const link of links) {
      assert.equal(link.state, "resolved", `unresolved source link: ${JSON.stringify(link)}`);
      if (link.state === "resolved") {
        assert.ok(tracked.has(String(link.path)), String(link.path));
        assert.ok(existsSync(join(REPO_ROOT, String(link.path))), String(link.path));
      }
    }
    const scenarioPaths = new Set(scenarioSources.map(({ path }) => path));
    const scenarios = wire.workflows.flatMap((workflow) => workflow.scenarios);
    assert.ok(scenarios.length > 0, "registered scenario declarations must remain visible");
    for (const scenario of scenarios) {
      const link = scenario.source;
      if (link.state === "resolved") {
        assert.ok(scenarioPaths.has(String(link.path)), String(link.path));
        assert.ok(tracked.has(String(link.path)), String(link.path));
        assert.ok(existsSync(join(REPO_ROOT, String(link.path))), String(link.path));
      } else {
        assert.ok(link.reason.includes("no executable scenario file"), JSON.stringify(link));
        assert.ok(!scenarioPaths.has(String(link.attemptedPath)), String(link.attemptedPath));
      }
    }
    if (scenarioSources.length === 0) assert.ok(scenarios.every(({ source }) => source.state === "unresolved"));
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

  it("the read-only arm fails on a violating fixture", () => {
    assert.deepEqual(
      mutationAffordanceViolations('await transport.requestJson("/api/v1/commands", { method: "POST" });'),
      ["reaches the command endpoint", "issues a mutating request"],
    );
  });

  it("registers the Explorer projection route as GET only", () => {
    const routes = dashboardRouteSource();
    for (const path of ["/api/v1/explorer"]) {
      assert.ok(routes.includes(`app.get("${path}"`), `${path} must be registered with app.get`);
      for (const verb of ["post", "put", "patch", "delete"]) {
        assert.ok(
          !routes.includes(`app.${verb}("${path}"`),
          `${path} must have no ${verb.toUpperCase()} counterpart while Phase A is read-only`,
        );
      }
    }
  });


});



describe("no DSL or generated-descriptor authoring artifact exists", () => {
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

      const workflowPath = workflowSourcePath(id, module.role);
      assert.ok(tracked.has(workflowPath), `${id} has no source-authored workflow definition at ${workflowPath}`);
    }
  });

  it("ships no workflow-design runtime authority", () => {

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
    const kernel = read("src/backend/runs/commands/command-kernel.ts");
    const service = read("src/backend/runs/commands/explorer-edit-service.ts");
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
    const commands = read("src/rules/commands/commands.ts");
    const explorer = read("src/models/dashboard/explorer.ts");
    const kernel = read("src/backend/runs/commands/command-kernel.ts");
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

    const absentCorpusDeps = { ...deps, listScenarioSources: () => [] };
    const absentCorpusWire = buildWorkflowExplorer(absentCorpusDeps);
    const absentCorpusWorkflow = absentCorpusWire.workflows[0];
    assert.ok(absentCorpusWorkflow !== undefined);
    assert.ok(absentCorpusWorkflow.scenarios.every(({ source }) => source.state === "unresolved"));
    const absentCorpusAttestation = buildExplorerCompileAttestation(absentCorpusDeps, absentCorpusWorkflow);
    assert.deepEqual(absentCorpusAttestation.checks.scenario, {
      state: "held",
      scope: "registered-declaration-equivalence",
      registrations: absentCorpusWorkflow.scenarios.map(({ scenarioId }) => ({ scenarioId })),
    });

    assert.throws(
      () => buildExplorerCompileAttestation(absentCorpusDeps, { ...absentCorpusWorkflow, scenarios: [] }),
      /served scenario registrations differ from the descriptor\/task union/u,
    );
  });

  it("refuses non-canonical or unclosed TypeScript patch expressions", () => {
    const protocolSource = read("src/models/dashboard/explorer.ts");
    for (const token of [
      "ExplorerCompileAttestationSchema",
      "canonicalDescriptorJson",
      "canonicalExpressionSchema",
      "runtime-registry-round-trip",
      "registered-declaration-equivalence",
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
