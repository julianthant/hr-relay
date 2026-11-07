import { CommandRequestSchema } from "../../../src/rules/commands/commands.js";

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

  it("has no Explorer validation client or writable command envelope", () => {
    const { client } = clientOver(() => { throw new Error("unexpected dispatch"); });
    assert.equal("validateExplorerEdit" in client, false);
    assert.equal(CommandRequestSchema.safeParse({ family: "explorer", type: "apply-explorer-edit" }).success, false);
  });
});
