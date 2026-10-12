
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { buildWorkflowExplorer } from "../../../src/backend/runs/queries/explorer.js";
import { createDashboardClient,DashboardClientError } from "../../../src/dashboard/client/index.js";
import { FingerprintSchema } from "../../../src/rules/identity/ids.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { explorerQueryDeps } from "../../support/fixtures/explorer-seams.js";

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
