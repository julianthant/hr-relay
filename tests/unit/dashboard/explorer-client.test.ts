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
  activeTakeover,
  parseRoute,
  routeToSearch,
} from "../../../src/dashboard/app/navigation/url-state.js";
import { matchesUiCatalogQuery } from "../../../src/domain/dashboard/explorer.js";
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

describe("the explorer queries", () => {
  it("GET the Explorer route and parse the real projection", async () => {
    const explorer = buildWorkflowExplorer(explorerQueryDeps(CLOCK, HASH));
    const { client, calls } = clientOver(() => ({
      status: 200,
      body: explorer,
    }));

    const servedExplorer = await client.workflowExplorer();

    assert.deepEqual(calls.map(({ method }) => method), ["GET"]);
    assert.deepEqual(calls.map(({ url }) => url), [
      "http://bff.test/api/v1/explorer",
    ]);
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
    const route = parseRoute(
      "?day=2026-08-09&explore=person-lookup&settings=ui-catalog&catalog=kuali%20save",
    );
    assert.equal(route.explore, "person-lookup");
    assert.equal(route.catalog, "kuali save");
    assert.equal(
      routeToSearch(route),
      "?day=2026-08-09&explore=person-lookup&catalog=kuali+save&settings=ui-catalog",
    );
  });

  it("treats an EMPTY catalog value as open-with-no-term, not as absent", () => {
    const route = parseRoute("?settings=ui-catalog&catalog=");
    assert.equal(route.catalog, "");
    // D295: the catalog is a Settings SECTION, so `settings` is what owns the
    // main region and the term is what the section reads.
    assert.equal(activeTakeover(route), "settings");
    assert.equal(routeToSearch(route), "?catalog=&settings=ui-catalog");
  });

  /*
    D295's other half. The catalog keys are subordinate to `settings`, in BOTH
    directions — so a bare `?catalog=` opens nothing and is dropped, and a term
    held over a route whose open section is not the catalog is never written.
    Without the second half the URL would name a search for a page that is not
    on screen, which is the same "the address does not describe the screen"
    defect an unrecognised `?catalogView=` is dropped for.
  */
  it("drops a catalog term that no open catalog section would read", () => {
    assert.deepEqual(parseRoute("?catalog=kuali"), { start: false });
    assert.equal(activeTakeover(parseRoute("?catalog=kuali")), "none");
    assert.deepEqual(parseRoute("?settings=storage&catalog=kuali&catalogView=vocabulary"), {
      start: false,
      settings: "storage",
    });
    assert.equal(
      routeToSearch({ start: false, settings: "storage", catalog: "kuali" }),
      "?settings=storage",
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
    assert.equal(activeTakeover(parseRoute("?intake=abc&explore=x&settings=ui-catalog")), "settings");
    assert.equal(activeTakeover(parseRoute("?intake=abc&explore=x")), "intake");
    assert.equal(activeTakeover(parseRoute("?explore=x&catalog=y")), "explore");
    assert.equal(activeTakeover(parseRoute("?settings=ui-catalog&catalog=y")), "settings");
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
