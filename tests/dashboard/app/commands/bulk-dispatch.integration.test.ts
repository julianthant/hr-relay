
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach,describe,it } from "vitest";

import {
bulkResultCounts,
composeBulkRunCommand,
planBulkVerb,
type BulkCandidateRow,
} from "../../../../src/dashboard/app/commands/bulk-dispatch.js";
import {
BulkRunCommandRequestSchema,
BulkRunCommandResponseSchema
} from "../../../../src/rules/commands/commands.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const roots: string[] = [];
const openDatabases: AuthorityDatabase[] = [];

afterEach(() => {
  for (const db of openDatabases.splice(0)) db.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Queue commands: CAS binding, attribution, in-flight, and replay", () => {

  it("plans bulk cancel preserving frozen target order and reporting distinct outcomes", () => {
    const runIdA = "aaaaaaaa-aaaa-4000-8000-aaaaaaaaaaaa";
    const runIdB = "bbbbbbbb-bbbb-4000-8000-bbbbbbbbbbbb";
    const runIdC = "cccccccc-cccc-4000-8000-cccccccccccc";
    const sub1 = "11111111-aaaa-4000-8000-111111111111";
    const sub2 = "22222222-bbbb-4000-8000-222222222222";
    const rows: BulkCandidateRow[] = [
      {
        runId: runIdA,
        title: "Alpha",
        actions: [{ key: "cancel", label: "Cancel", intent: "neutral", placement: ["menu"], kind: "command", command: "cancel", expectedVersion: 2 }],
      },
      {
        runId: runIdB,
        title: "Bravo",
        actions: [{ key: "cancel", label: "Cancel", intent: "neutral", placement: ["menu"], kind: "command", command: "cancel", expectedVersion: 5 }],
      },
      {
        runId: runIdC,
        title: "Charlie",
        actions: [], // Not eligible
      },
    ];

    const plan = planBulkVerb(rows, "cancel", [runIdA, runIdB, runIdC]);
    assert.deepEqual(plan.eligible, [
      { runId: runIdA, title: "Alpha", expectedVersion: 2 },
      { runId: runIdB, title: "Bravo", expectedVersion: 5 },
    ]);
    assert.deepEqual(plan.skipped, [{ runId: runIdC, title: "Charlie" }]);

    const commandId = "44444444-4444-4000-8000-444444444444";
    const requestedAt = "2026-09-22T12:00:00.000Z";
    const composed = composeBulkRunCommand(plan, {
      actorId: "operator-1",
      source: "queue",
      commandId,
      requestedAt,
    });
    assert.equal(composed.state, "ready");
    if (composed.state !== "ready") return;

    const request = BulkRunCommandRequestSchema.parse(composed.request);
    assert.equal(request.commandId, commandId);
    assert.equal(request.requestedAt, requestedAt);
    assert.deepEqual(request.targets, [
      { runId: runIdA, expectedVersion: 2 },
      { runId: runIdB, expectedVersion: 5 },
    ]);

    // Simulated mixed execution: one applied, one conflict
    const simulatedResponse = BulkRunCommandResponseSchema.parse({
      state: "vector",
      bulkCommandId: commandId,
      type: "cancel",
      requestedCount: 2,
      results: [
        { outcome: "applied", runId: runIdA, commandId: sub1, replayed: false, detail: "cancelled" },
        { outcome: "conflict", runId: runIdB, commandId: sub2, currentVersion: 6, detail: "the run moved while this was open." },
      ],
    });

    assert.equal(simulatedResponse.state, "vector");
    const counts = bulkResultCounts(simulatedResponse);
    assert.equal(counts.applied, 1);
    assert.equal(counts.conflict, 1);
    assert.equal(counts.refused, 0);
    // Partial bulk failure never becomes aggregate success
    assert.equal(simulatedResponse.state, "vector");
    if (simulatedResponse.state !== "vector") return;
    assert.notEqual(counts.applied, simulatedResponse.results.length);
  });
});
