/**
 * 2i-G — the explorer/catalog half of the ONE typed client, the route state
 * that addresses both surfaces, and the two pure functions the surfaces think
 * with (D176/D177).
 *
 * The surfaces themselves are proved by the parity corpus; what is pinned here
 * is the logic a screenshot cannot check: that the graph panel's dry-run
 * posture, boundary and edge conditions are derived from the descriptor rather
 * than assumed, that a search narrows rather than widens, and that three
 * takeover keys on one link resolve to ONE answer.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createDashboardClient, DashboardClientError } from "../../../src/dashboard/client/index.js";
import {
  conditionalEdgesFrom,
  dependsOnEdgeExists,
  dryRunBoundaryNodeId,
  dryRunPosture,
  explorerGraphTotals,
  nodeBindings,
  writeSystems,
} from "../../../src/dashboard/surfaces/explorer-model.js";
import {
  activeTakeover,
  parseRoute,
  routeToSearch,
} from "../../../src/dashboard/app/url-state.js";
import { matchesUiCatalogQuery } from "../../../src/domain/dashboard/explorer.js";
import type { ExplorerWorkflowWire } from "../../../src/domain/dashboard/explorer.js";
import type { UiCatalogEntry } from "../../../src/domain/ui/contracts.js";
import { manualClock } from "../../../src/domain/clock.js";
import { FingerprintSchema } from "../../../src/domain/ids.js";
import { buildWorkflowExplorer } from "../../../src/server/dashboard/queries/explorer.js";
import { buildUiCatalogWire } from "../../../src/server/dashboard/queries/ui-catalog.js";
import { explorerQueryDeps, uiCatalogQueryDeps } from "../../fixtures/explorer-seams.js";

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

describe("the explorer and catalog queries", () => {
  it("GET both routes and parse the real projections", async () => {
    const explorer = buildWorkflowExplorer(explorerQueryDeps(CLOCK, HASH));
    const catalog = buildUiCatalogWire(uiCatalogQueryDeps());
    const { client, calls } = clientOver((url) => ({
      status: 200,
      body: url.endsWith("/api/v1/explorer") ? explorer : catalog,
    }));

    const servedExplorer = await client.workflowExplorer();
    const servedCatalog = await client.uiCatalog();

    assert.deepEqual(calls.map(({ method }) => method), ["GET", "GET"]);
    assert.deepEqual(calls.map(({ url }) => url), [
      "http://bff.test/api/v1/explorer",
      "http://bff.test/api/v1/ui-catalog",
    ]);
    assert.equal(
      servedExplorer.workflows.length,
      explorer.workflows.length,
      "every registered workflow survives the round trip",
    );
    assert.equal(servedCatalog.entries.length, catalog.entries.length);
  });

  it("fails loud on a body outside the contract rather than rendering half of it", async () => {
    const { client } = clientOver(() => ({ status: 200, body: { wireVersion: 1 } }));
    await assert.rejects(() => client.workflowExplorer(), DashboardClientError);
  });

  it("surfaces the server's own refusal when the catalog is stale", async () => {
    const { client } = clientOver(() => ({
      status: 500,
      body: {
        state: "error",
        code: "INTERNAL_FAILURE",
        message: "generated UI catalog is stale; run npm run ui:catalog",
        retryable: false,
      },
    }));
    await assert.rejects(
      () => client.uiCatalog(),
      (error: unknown) =>
        error instanceof DashboardClientError && /stale/u.test(error.message),
    );
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
    const workflow = wire.workflows.find((one) => String(one.id) === "separations-kuali-finalization");
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

/* ── catalog search ──────────────────────────────────────────────────────── */

describe("the UI catalog search", () => {
  const catalog = buildUiCatalogWire(uiCatalogQueryDeps());
  const entries: readonly UiCatalogEntry[] = catalog.entries;

  it("matches nothing away when the query is empty", () => {
    assert.equal(entries.filter((entry) => matchesUiCatalogQuery(entry, "")).length, entries.length);
    assert.equal(entries.filter((entry) => matchesUiCatalogQuery(entry, "   ")).length, entries.length);
  });

  it("NARROWS on a second term rather than widening", () => {
    const one = entries.filter((entry) => matchesUiCatalogQuery(entry, "kuali"));
    const two = entries.filter((entry) => matchesUiCatalogQuery(entry, "kuali timekeeper"));
    assert.ok(one.length > 0);
    assert.ok(two.length <= one.length, "every term must hit");
    for (const entry of two) assert.ok(one.includes(entry));
  });

  it("finds an entry by its id, its system, and its kind", () => {
    const observation = entries.find((entry) => entry.kind === "observation");
    assert.ok(observation !== undefined);
    assert.ok(matchesUiCatalogQuery(observation, String(observation.id)));
    assert.ok(matchesUiCatalogQuery(observation, observation.system));
    assert.ok(matchesUiCatalogQuery(observation, "observation"));
    assert.ok(!matchesUiCatalogQuery(observation, "a-term-no-entry-carries"));
  });

  it("is case-insensitive, so a pasted id matches however it was capitalised", () => {
    const first = entries[0];
    assert.ok(first !== undefined);
    assert.ok(matchesUiCatalogQuery(first, String(first.id).toUpperCase()));
  });
});

/* ── route state ─────────────────────────────────────────────────────────── */

describe("the explorer and catalog route keys", () => {
  it("round-trips both keys through the query string", () => {
    const route = parseRoute("?day=2026-08-09&explore=person-lookup&catalog=kuali%20save");
    assert.equal(route.explore, "person-lookup");
    assert.equal(route.catalog, "kuali save");
    assert.equal(
      routeToSearch(route),
      "?day=2026-08-09&explore=person-lookup&catalog=kuali+save",
    );
  });

  it("treats an EMPTY catalog value as open-with-no-term, not as absent", () => {
    const route = parseRoute("?catalog=");
    assert.equal(route.catalog, "");
    assert.equal(activeTakeover(route), "catalog");
    assert.equal(routeToSearch(route), "?catalog=");
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

  it("drops an empty explore value, because a workflow id is never blank", () => {
    assert.equal(parseRoute("?explore=").explore, undefined);
    assert.equal(activeTakeover(parseRoute("?explore=")), "none");
  });

  it("resolves ONE takeover when a link carries several", () => {
    assert.equal(activeTakeover(parseRoute("?intake=abc&explore=x&catalog=y")), "intake");
    assert.equal(activeTakeover(parseRoute("?explore=x&catalog=y")), "explore");
    assert.equal(activeTakeover(parseRoute("?catalog=y")), "catalog");
    assert.equal(activeTakeover(parseRoute("?day=2026-08-09")), "none");
  });
});
