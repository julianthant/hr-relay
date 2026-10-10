
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createDashboardClient, DashboardClientError } from "../../../../../src/dashboard/client/index.js";
import {
  activeTakeover,
  parseRoute,
  routeToSearch,
} from "../../../../../src/dashboard/app/navigation/url-state.js";
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

/* ── route state ─────────────────────────────────────────────────────────── */

describe("the explorer and catalog route keys", () => {
  it("round-trips both keys through the query string", () => {
    const route = parseRoute(
      "?day=2026-08-09&explore=person-lookup&settings=ui-catalog&catalog=kuali%20save",
    );
    assert.equal(route.explore, "person-lookup");
    assert.equal(
      routeToSearch(route),
      "?day=2026-08-09&explore=person-lookup&catalog=kuali+save&settings=ui-catalog",
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
