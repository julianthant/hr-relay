/**
 * 2i-G — the Explorer half of the ONE typed client, the route state
 * that addresses its surfaces, and the two pure functions the surfaces think
 * with (D176/D177).
 *
 * The surfaces themselves are proved by the parity corpus; what is pinned here
 * is the logic a screenshot cannot check: that the graph panel's dry-run
 * posture, boundary and edge conditions are derived from the descriptor rather
 * than assumed, and that three
 * takeover keys on one link resolve to ONE answer.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createDashboardClient, DashboardClientError } from "../../../../../src/dashboard/client/index.js";
import {
  conditionalEdgesFrom,
  dependsOnEdgeExists,
  dryRunBoundaryNodeId,
  dryRunPosture,
  explorerGraphTotals,
  nodeBindings,
  writeSystems,
} from "../../../../../src/dashboard/surfaces/explorer-model.js";
import {
  activeTakeover,
  parseRoute,
  routeToSearch,
} from "../../../../../src/dashboard/app/url-state.js";
import type { ExplorerWorkflowWire } from "../../../../../src/models/dashboard/explorer.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { FingerprintSchema } from "../../../../../src/rules/identity/ids.js";
import { buildWorkflowExplorer } from "../../../../../src/backend/runs/queries/explorer.js";
import { explorerQueryDeps } from "../../../../support/fixtures/explorer-seams.js";

const CLOCK = manualClock(new Date("2026-08-09T12:00:00.000Z"));
const HASH = FingerprintSchema.parse("d".repeat(64));

function clientOver(respond: (url: string, method: string) => { status: number; body: unknown }) {
  const calls: { url: string; method: string; body?: string }[] = [];
  const client = createDashboardClient({
    baseUrl: "http://bff.test",
    fetchImpl: (url, init) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, ...(typeof init?.body === "string" ? { body: init.body } : {}) });
      const { status, body } = respond(url, method);
      return Promise.resolve(new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }));
    },
  });
  return { client, calls };
}

describe("the Explorer query", () => {
  it("GETs its route and parses the real projection", async () => {
    const explorer = buildWorkflowExplorer(explorerQueryDeps(CLOCK, HASH));
    const { client, calls } = clientOver(() => ({ status: 200, body: explorer }));

    const servedExplorer = await client.workflowExplorer();

    assert.deepEqual(calls.map(({ method }) => method), ["GET"]);
    assert.deepEqual(calls.map(({ url }) => url), ["http://bff.test/api/v1/explorer"]);
    assert.equal(
      servedExplorer.workflows.length,
      explorer.workflows.length,
      "every registered workflow survives the round trip",
    );
  });

  it("fails loud on a body outside the contract rather than rendering half of it", async () => {
    const { client } = clientOver(() => ({ status: 200, body: { wireVersion: 1 } }));
    await assert.rejects(() => client.workflowExplorer(), DashboardClientError);
  });

  it("posts the complete served-base draft to the Explorer validation door", async () => {
    const explorer = buildWorkflowExplorer(explorerQueryDeps(CLOCK, HASH));
    const workflow = explorer.workflows[0];
    assert.ok(workflow !== undefined);
    const { client, calls } = clientOver((url) => {
      if (url.endsWith("/api/v1/explorer/validate")) {
        return {
          status: 409,
          body: {
            state: "conflict",
            conflict: "override-revision",
            message: "the server has a later presentation revision",
            currentDescriptorVersion: workflow.version,
            currentContractFingerprint: workflow.contractFingerprint,
            currentOverrideRevision: workflow.edit.overrideRevision + 1,
          },
        };
      }
      throw new Error(`unexpected client request ${url}`);
    });

    const result = await client.validateExplorerEdit({
      draftVersion: 1,
      workflowId: workflow.id,
      baseDescriptorVersion: workflow.version,
      baseContractFingerprint: workflow.contractFingerprint,
      baseOverrideRevision: workflow.edit.overrideRevision,
      changes: [{ kind: "workflow-label", value: `${workflow.label} reviewed` }],
    });

    assert.equal(result.state, "conflict");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "http://bff.test/api/v1/explorer/validate");
    assert.equal(calls[0]?.method, "POST");
    assert.deepEqual(JSON.parse(calls[0]?.body ?? ""), {
      draftVersion: 1,
      workflowId: workflow.id,
      baseDescriptorVersion: workflow.version,
      baseContractFingerprint: workflow.contractFingerprint,
      baseOverrideRevision: workflow.edit.overrideRevision,
      changes: [{ kind: "workflow-label", value: `${workflow.label} reviewed` }],
    });
  });

  it("sends the reviewed Explorer apply envelope only through the typed command client", async () => {
    const explorer = buildWorkflowExplorer(explorerQueryDeps(CLOCK, HASH));
    const workflow = explorer.workflows[0];
    assert.ok(workflow !== undefined);
    const commandId = "11111111-1111-4111-8111-111111111111";
    const { client, calls } = clientOver(() => ({
      status: 200,
      body: {
        state: "applied",
        commandId,
        affectedTargets: [{ family: "explorer", workflowId: workflow.id, revision: workflow.edit.overrideRevision + 1 }],
      },
    }));
    await client.executeCommand({
      commandId,
      requestedAt: "2026-08-28T17:00:00.000Z",
      requestedBy: "operator-1",
      source: "workflow-explorer",
      reason: "Correct the workflow presentation",
      family: "explorer",
      type: "apply-explorer-edit",
      target: {
        workflowId: workflow.id,
        expectedVersion: workflow.version,
        contractFingerprint: workflow.contractFingerprint,
        expectedOverrideRevision: workflow.edit.overrideRevision,
      },
      payload: { changes: [{ kind: "workflow-label", value: `${workflow.label} reviewed` }] },
    });
    assert.equal(calls[0]?.url, "http://bff.test/api/v1/commands");
    assert.deepEqual(JSON.parse(calls[0]?.body ?? ""), {
      commandId,
      requestedAt: "2026-08-28T17:00:00.000Z",
      requestedBy: "operator-1",
      source: "workflow-explorer",
      reason: "Correct the workflow presentation",
      family: "explorer",
      type: "apply-explorer-edit",
      target: {
        workflowId: workflow.id,
        expectedVersion: workflow.version,
        contractFingerprint: workflow.contractFingerprint,
        expectedOverrideRevision: workflow.edit.overrideRevision,
      },
      payload: { changes: [{ kind: "workflow-label", value: `${workflow.label} reviewed` }] },
    });
  });
});

/* ── the graph panel ─────────────────────────────────────────────────────── */

function workflowWithNodes(nodes: ExplorerWorkflowWire["nodes"]): ExplorerWorkflowWire {
  const base = buildWorkflowExplorer(explorerQueryDeps(CLOCK, HASH)).workflows[0];
  assert.ok(base !== undefined);
  return { ...base, nodes, edges: [] };
}

function taskNode(id: string, dependsOn: string[] = []): ExplorerWorkflowWire["nodes"][number] {
  const base = buildWorkflowExplorer(explorerQueryDeps(CLOCK, HASH)).workflows[0]?.nodes[0];
  assert.ok(base !== undefined);
  return {
    ...base,
    id: id as ExplorerWorkflowWire["nodes"][number]["id"],
    dependsOn: dependsOn as ExplorerWorkflowWire["nodes"][number]["dependsOn"],
    tasks: [],
    details: [],
    editableFields: [],
    coveragePoints: [],
    shape: { kind: "task", replay: "checkpoint" },
  };
}

function transactionNode(
  id: string,
  dryRun: "stop-after-prepare" | "unsupported",
): ExplorerWorkflowWire["nodes"][number] {
  return {
    ...taskNode(id),
    shape: {
      kind: "transaction",
      dryRun,
      probePolicy: "always",
      probeToFenceMaxMs: 120000,
      leaseScope: "transaction",
      retryBeforeFence: false,
    },
  };
}

describe("the graph panel's derivations", () => {
  it("draws the real person-lookup graph in declaration order and counts its FIELDS", () => {
    const wire = buildWorkflowExplorer(explorerQueryDeps(CLOCK, HASH));
    const workflow = wire.workflows.find((one) => String(one.id) === "person-lookup");
    assert.ok(workflow !== undefined);
    const totals = explorerGraphTotals(workflow);
    assert.equal(totals.nodes, workflow.nodes.length);
    // D227 — a read is one OUTPUT field of a read arm, never an arm. The count
    // is strictly larger than the arm count it replaced, which is the whole
    // point: an arm is a contract, and an operator asks about a field.
    const armCount = workflow.nodes
      .flatMap((node) => node.tasks)
      .filter((task) => task.effect === "read").length;
    assert.equal(
      totals.reads,
      workflow.nodes
        .flatMap((node) => node.tasks)
        .filter((task) => task.effect === "read")
        .flatMap((task) => task.fields)
        .filter((field) => field.side === "output").length,
    );
    assert.ok(totals.reads > armCount);
    // A read-only workflow has no write arm at all, which is what makes the
    // `no system of record` posture below a FACT rather than a missing line.
    assert.equal(totals.writes, 0);
  });

  it("counts a commit arm's INPUT fields as writes, and never its prepare twin's", () => {
    const wire = buildWorkflowExplorer(explorerQueryDeps(CLOCK, HASH));
    const workflow = wire.workflows.find((one) => String(one.id) === "separations");
    assert.ok(workflow !== undefined);
    const totals = explorerGraphTotals(workflow);
    const commit = workflow.nodes
      .flatMap((node) => node.tasks)
      .filter((task) => task.effect === "commit");
    assert.ok(commit.length > 0);
    assert.equal(
      totals.writes,
      commit.flatMap((task) => task.fields).filter((field) => field.side === "input").length,
    );
  });

  it("reports a graph with no transaction node as changing no system of record", () => {
    const workflow = workflowWithNodes([taskNode("one"), taskNode("two")]);
    assert.equal(dryRunPosture(workflow), "no-system-write");
    assert.equal(dryRunBoundaryNodeId(workflow), undefined);
    assert.deepEqual(writeSystems(workflow), []);
  });

  it("puts the boundary on the FIRST transaction node, never on the last", () => {
    const workflow = workflowWithNodes([
      taskNode("read-first"),
      transactionNode("clear-pending", "stop-after-prepare"),
      transactionNode("file-termination", "stop-after-prepare"),
    ]);
    assert.equal(dryRunPosture(workflow), "boundary");
    assert.equal(dryRunBoundaryNodeId(workflow), "clear-pending");
  });

  it("draws NO boundary when a transaction honours no dry run — there is no rehearsal to bound", () => {
    const workflow = workflowWithNodes([
      taskNode("read-first"),
      transactionNode("stop-here", "stop-after-prepare"),
      transactionNode("no-rehearsal", "unsupported"),
    ]);
    assert.equal(dryRunPosture(workflow), "no-rehearsal");
    assert.equal(
      dryRunBoundaryNodeId(workflow),
      undefined,
      "a line here would claim a safety boundary this graph does not have",
    );
  });

  it("names a control edge by its case and leaves a plain dependency to read `always`", () => {
    const workflow = {
      ...workflowWithNodes([taskNode("mode"), taskNode("submit"), taskNode("peek")]),
      edges: [
        { from: "mode" as never, to: "submit" as never, kind: "branch-case" as const, label: "write" },
        { from: "mode" as never, to: "peek" as never, kind: "branch-case" as const, label: "read-only" },
        { from: "submit" as never, to: "peek" as never, kind: "depends-on" as const },
      ],
    };
    assert.deepEqual(conditionalEdgesFrom(workflow, "mode"), [
      { to: "submit", condition: "case write" },
      { to: "peek", condition: "case read-only" },
    ]);
    assert.deepEqual(
      conditionalEdgesFrom(workflow, "submit"),
      [],
      "a depends-on edge is the unconditional one, and the connector prints `always` for it",
    );
  });

  it("never prints `always` between two nodes the descriptor did not connect", () => {
    // Three of the real `separations` graph's consecutive pairs have no edge:
    // they are declaration neighbours, not dependencies, and a connector that
    // said `always` there would be the surface inventing an edge.
    const wire = buildWorkflowExplorer(explorerQueryDeps(CLOCK, HASH));
    const workflow = wire.workflows.find((one) => String(one.id) === "person-lookup");
    assert.ok(workflow !== undefined);
    const [first, second] = workflow.nodes;
    assert.ok(first !== undefined && second !== undefined);
    assert.equal(
      dependsOnEdgeExists(workflow, String(first.id), String(second.id)),
      workflow.edges.some(
        (edge) =>
          edge.kind === "depends-on"
          && String(edge.from) === String(first.id)
          && String(edge.to) === String(second.id),
      ),
    );
    assert.equal(
      dependsOnEdgeExists(workflow, String(first.id), "no-such-node"),
      false,
      "an edge to a node that is not there is not an edge",
    );
  });

  it("reads a node's system off its own bindings, and never calls a mini-store a system", () => {
    const wire = buildWorkflowExplorer(explorerQueryDeps(CLOCK, HASH));
    const workflow = wire.workflows.find((one) => String(one.id) === "person-lookup");
    assert.ok(workflow !== undefined);
    for (const node of workflow.nodes) {
      const bindings = nodeBindings(node);
      assert.equal(bindings.length, node.tasks.length === 0 ? 0 : 1);
      for (const binding of bindings) {
        // A browser driver's system is one the workflow declares; a headless
        // mini-store is labelled `store`, precisely so it is never read as one.
        if (binding.label === "system") assert.ok(workflow.systems.includes(binding.value));
        else assert.equal(binding.value.startsWith("workflow:"), true);
      }
    }
    assert.deepEqual(nodeBindings(taskNode("bare")), [], "a node binding no contract names no system");
  });
});

/* ── route state ─────────────────────────────────────────────────────────── */

describe("the Explorer route key", () => {
  it("round-trips alongside Settings", () => {
    const route = parseRoute("?day=2026-08-09&explore=person-lookup&settings=keyboard");
    assert.equal(route.explore, "person-lookup");
    assert.equal(
      routeToSearch(route),
      "?day=2026-08-09&explore=person-lookup&settings=keyboard",
    );
  });

  it("addresses Archive's real version registry as the Explorer's destination", () => {
    const route = parseRoute("?archive=&archiveView=versions");
    assert.equal(route.archive, "");
    assert.equal(route.archiveView, "versions");
    assert.equal(activeTakeover(route), "archive");
    assert.equal(routeToSearch(route), "?archive=&archiveView=versions");

    // A view alone is not a second route. The Archive owns the actual
    // takeover, and the view only selects a real panel inside that takeover.
    assert.deepEqual(parseRoute("?archiveView=versions"), { start: false });
  });

  it("round-trips a complete Archive folder context and drops a half-folder", () => {
    const route = parseRoute("?archive=&archiveView=runs&archiveDashboard=2.0&archiveWorkflow=person-lookup");

    assert.deepEqual(route, {
      start: false,
      archive: "",
      archiveView: "runs",
      archiveDashboard: "2.0",
      archiveWorkflow: "person-lookup",
    });
    assert.equal(
      routeToSearch(route),
      "?archive=&archiveView=runs&archiveDashboard=2.0&archiveWorkflow=person-lookup",
    );
    assert.deepEqual(parseRoute("?archive=&archiveDashboard=2.0"), { start: false, archive: "" });
    assert.equal(
      routeToSearch({ start: false, archive: "", archiveDashboard: "2.0" }),
      "?archive=",
    );
  });

  it("drops an empty explore value, because a workflow id is never blank", () => {
    assert.equal(parseRoute("?explore=").explore, undefined);
    assert.equal(activeTakeover(parseRoute("?explore=")), "none");
  });

  it("resolves ONE takeover when a link carries several", () => {
    assert.equal(activeTakeover(parseRoute("?intake=abc&explore=x&settings=keyboard")), "settings");
    assert.equal(activeTakeover(parseRoute("?intake=abc&explore=x")), "intake");
    assert.equal(activeTakeover(parseRoute("?explore=x&archive=")), "archive");
    assert.equal(activeTakeover(parseRoute("?settings=keyboard&archive=")), "settings");
    assert.equal(activeTakeover(parseRoute("?day=2026-08-09")), "none");
  });
});

it("round-trips bounded public Archive browsing state and refuses malformed/private extras", () => {
  const browse = { filters: { search: "Snow 雪", capturedFrom: "2026-08-01T00:00:00.000Z", outcome: "failed" },
    after: { completedAt: "2026-08-02T00:00:00.000Z", runId: "00000000-0000-4000-8000-000000000081" },
    columns: ["kept-column", "duplicate-label-context"], section: 3 };
  const route = parseRoute(`?archive=&archiveDashboard=2.0&archiveWorkflow=person-lookup&archiveBrowse=${encodeURIComponent(JSON.stringify(browse))}`);
  assert.deepEqual(route.archiveBrowse, browse);
  assert.deepEqual(parseRoute(routeToSearch(route)), route);
  for (const invalid of ["{", JSON.stringify({ ...browse, filters: { from: "2026-08-02T00:00:00.000Z", to: "2026-08-01T00:00:00.000Z" } }), JSON.stringify({ ...browse, filters: { outcome: "invented" } }), JSON.stringify({ ...browse, privatePayload: "secret" }),
    JSON.stringify({ ...browse, filters: { search: "x".repeat(121) } }),
    JSON.stringify({ ...browse, columns: ["same", "same"] }), JSON.stringify({ ...browse, section: -1 }),
    JSON.stringify({ ...browse, after: { completedAt: "bad-date", runId: "bad-id" } }), "x".repeat(24001)]) {
    const rejected = parseRoute(`?archive=&archiveBrowse=${encodeURIComponent(invalid)}`);
    assert.equal(rejected.archiveBrowse, undefined);
    assert.equal(rejected.archiveBrowseInvalid, true);
  }
  assert.deepEqual(parseRoute(`?archiveBrowse=${encodeURIComponent(JSON.stringify(browse))}`), { start: false });
});

it("rejects oversized or malformed paired Archive folder route identities with a reset notice", () => {
  for (const dashboard of ["not-version", "1".repeat(41)]) {
    const parsed = parseRoute(`?archive=&archiveDashboard=${dashboard}&archiveWorkflow=person-lookup`);
    assert.equal(parsed.archiveDashboard, undefined);
    assert.equal(parsed.archiveBrowseInvalid, true);
  }
  const parsed = parseRoute(`?archive=&archiveDashboard=1.0&archiveWorkflow=${"x".repeat(161)}`);
  assert.equal(parsed.archiveWorkflow, undefined);
  assert.equal(parsed.archiveBrowseInvalid, true);
});

it("omits cleared optional Archive filters and cursor instead of serializing undefined", async () => {
  const { client, calls } = clientOver(url => ({ status: 200, body: url.includes("/groups") ? { groups: [] } : { items: [], next: null } }));
  await client.savedArchiveGroups({ search: undefined, workflow: undefined, dashboardVersion: undefined, from: undefined });
  await client.savedArchiveIndex({ limit: 50, search: undefined, workflow: undefined, after: undefined, workflowVersion: undefined });
  assert.equal(calls[0]?.url, "http://bff.test/api/v1/archive/groups");
  assert.equal(calls[1]?.url, "http://bff.test/api/v1/archive/reports?limit=50");
});

it("marks malformed Archive JSON as invalid rather than a valid empty scope", () => {
  const route = parseRoute(`?archive=&archiveBrowse=${encodeURIComponent("{")}`);
  assert.equal(route.archiveBrowseInvalid, true); assert.equal(route.archiveBrowse, undefined);
});
