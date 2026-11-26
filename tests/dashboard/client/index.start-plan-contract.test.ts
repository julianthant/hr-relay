import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createDashboardClient, DashboardClientError, type DashboardClient } from "../../../src/dashboard/client/index.js";
import { StartPlanWireSchema } from "../../../src/models/dashboard/start-plan.js";

const HEX64 = "a".repeat(64);
const UUID = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b74";

const REQUEST = {
  workflowId: "person-lookup",
  submissions: [{ eid: "10873698", mode: "read-only" }],
  dryRun: true,
  browserMode: "headless",
  captureBrowserScreenshots: false,
  selectedStepKeys: ["identity", "search"],
  stepOmissions: [{ step: "identity", facts: { emplId: "10873698" } }],
} as const;

const WIRE = {
  wireVersion: 1,
  startPlanId: UUID,
  workflowId: "person-lookup",
  expectedVersion: 1,
  expiresAt: "2026-09-03T10:00:00.000Z",
  dryRun: true,
  priority: "interactive",
  plannedBy: "local-operator",
  configSnapshotId: UUID,
  omittedSteps: ["identity"],
  fingerprints: {
    descriptorFingerprint: HEX64,
    configFingerprint: HEX64,
    ingressSchemaHash: HEX64,
    canonicalInputSchemaHash: HEX64,
    inputFingerprint: HEX64,
  },
  planned: [{ logicalKey: UUID, title: "Person lookup", matchKey: "person-lookup:10873698" }],
  refused: [],
} as const;

describe("start-plan wire contract (one shared owner)", () => {

  it("the client parses the answer with the shared wire, so an impossible refusal code is a schema error, not a rendered string", async () => {
    const answer = (body: unknown): DashboardClient => createDashboardClient({
      baseUrl: "http://127.0.0.1:3938",
      fetchImpl: () => Promise.resolve(new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      })),
    });
    const accepted = await answer(WIRE).submitStartPlan(REQUEST);
    assert.deepEqual(accepted, StartPlanWireSchema.parse(WIRE));
    await assert.rejects(
      answer({ ...WIRE, refused: [{ entry: 1, code: "duplicate-active", message: "x" }] }).submitStartPlan(REQUEST),
      (error: unknown) => error instanceof DashboardClientError && error.kind === "schema",
    );
    // And the request side: the client refuses before any fetch happens.
    let fetches = 0;
    const counting = createDashboardClient({
      baseUrl: "http://127.0.0.1:3938",
      fetchImpl: () => { fetches += 1; return Promise.reject(new Error("unreachable")); },
    });
    await assert.rejects(counting.submitStartPlan({ ...REQUEST, workflowId: "Not A Slug" }));
    assert.equal(fetches, 0);
  });
});
