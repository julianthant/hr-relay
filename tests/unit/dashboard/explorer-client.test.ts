/**
 * 2i-G — the explorer/catalog half of the ONE typed client, the route state
 * that addresses both surfaces, and the two pure functions the surfaces think
 * with (D176/D177).
 *
 * The surfaces themselves are proved by the parity corpus; what is pinned here
 * is the logic a screenshot cannot check: that the rail draws every node
 * exactly once whatever the control structure, that a search narrows rather
 * than widens, and that three takeover keys on one link resolve to ONE answer.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createDashboardClient, DashboardClientError } from "../../../src/dashboard/client/index.js";
import { railRows } from "../../../src/dashboard/surfaces/explorer.js";
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
  const calls: { url: string; method: string }[] = [];
  const client = createDashboardClient({
    baseUrl: "http://bff.test",
    fetchImpl: (url, init) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method });
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
});

/* ── the structure rail ──────────────────────────────────────────────────── */

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
    shape: { kind: "task", replay: "checkpoint", conditional: false },
  };
}

describe("the graph structure rail", () => {
  it("draws every node of the real person-lookup graph exactly once, in declaration order", () => {
    const wire = buildWorkflowExplorer(explorerQueryDeps(CLOCK, HASH));
    const workflow = wire.workflows.find((one) => String(one.id) === "person-lookup");
    assert.ok(workflow !== undefined);
    const rows = railRows(workflow);
    assert.deepEqual(
      rows.map((row) => String(row.node.id)),
      workflow.nodes.map((node) => String(node.id)),
    );
    for (const row of rows) assert.equal(row.depth, 0, "a linear graph has no nesting");
  });

  it("indents a branch's cases under their controller and names the case", () => {
    const controller = taskNode("mode-branch");
    const workflow = workflowWithNodes([
      { ...controller, shape: { kind: "branch", cases: [
        { name: "write", nodes: ["submit"] as never },
        { name: "read-only", nodes: ["peek"] as never },
      ] } },
      taskNode("submit"),
      taskNode("peek"),
    ]);
    const rows = railRows(workflow);
    assert.deepEqual(rows.map((row) => [String(row.node.id), row.depth, row.under?.label]), [
      ["mode-branch", 0, undefined],
      ["submit", 1, "write"],
      ["peek", 1, "read-only"],
    ]);
  });

  it("indents a parallel's branches and never draws a shared node twice", () => {
    const controller = taskNode("fan");
    const workflow = workflowWithNodes([
      { ...controller, shape: { kind: "parallel", join: "all", branches: [
        { id: "left", nodes: ["shared"] as never },
        { id: "right", nodes: ["shared"] as never },
      ] } },
      taskNode("shared"),
    ]);
    const rows = railRows(workflow);
    assert.deepEqual(rows.map((row) => String(row.node.id)), ["fan", "shared"]);
    assert.equal(rows.filter((row) => String(row.node.id) === "shared").length, 1);
  });

  it("still draws a node whose controller is declared AFTER it", () => {
    // A node claimed by a later controller must not vanish: a node missing from
    // the rail is a graph the surface failed to show, which is worse than one
    // drawn flat.
    const controller = taskNode("late");
    const workflow = workflowWithNodes([
      taskNode("early"),
      { ...controller, shape: { kind: "branch", cases: [{ name: "only", nodes: ["early"] as never }] } },
    ]);
    assert.deepEqual(railRows(workflow).map((row) => String(row.node.id)).sort(), ["early", "late"]);
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
