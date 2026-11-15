import { default as assert } from "node:assert/strict";
import { describe, it } from "vitest";
import {
  RunDelegationRefreshSchema,
  RunLifecycleSchema,
  RunOutcomeSchema,
  delegationDependencyTransitionViolation,
  runTransitionViolation,
  type RunLifecycle,
} from "../../../src/models/run/record.js";
import { LATER, NOW, UUID_1, UUID_7 } from "../../support/fixtures/phase1c-contract-fixtures.js";

const claim = { workerId: "person-lookup-worker-1", claimedAt: LATER, heartbeatAt: LATER };
const targets: readonly RunLifecycle[] = [
  { state: "queued" },
  { state: "claimed", ...claim },
  { state: "validating", ...claim },
  { state: "running", ...claim },
  { state: "parked-gate", gateId: "approval", parkedAt: LATER, resumeAt: "approval" },
  { state: "parked-write", writeIntentId: UUID_7, intentGeneration: 1, parkedAt: LATER, code: "unknown", message: "Outcome unknown" },
  { state: "terminal", outcome: "cancelled", endedAt: LATER },
].map(target => RunLifecycleSchema.parse(target));

const terminal = (outcome: string) => RunLifecycleSchema.parse({ state: "terminal", outcome, endedAt: NOW,
  ...(outcome === "failed" ? { failureId: UUID_1 } : {}) });
const refresh = (phase: "waiting" | "settled") => ({ delegationRefresh: RunDelegationRefreshSchema.parse({
  commandId: UUID_1, nodeId: "lookup-members", phase, retryCommandIds: [UUID_7] }) });

describe("run transition table: out of a terminal run", () => {
  it("reopens a done or failed parent only through a waiting delegation refresh", () => {
    for (const outcome of ["done", "failed"]) {
      const from = terminal(outcome);
      assert.equal(runTransitionViolation(from, { state: "queued" }, refresh("waiting")), undefined, outcome);
      assert.match(String(runTransitionViolation(from, { state: "queued" })), /only an interrupted run may be requeued/, outcome);
      assert.match(String(runTransitionViolation(from, { state: "queued" }, refresh("settled"))), /waiting delegation refresh/, outcome);
    }
  });

  it("requeues an interrupted run with or without a refresh record", () => {
    assert.equal(runTransitionViolation(terminal("interrupted"), { state: "queued" }), undefined);
    assert.equal(runTransitionViolation(terminal("interrupted"), { state: "queued" }, refresh("waiting")), undefined);
  });

  it("refuses every other edge out of a terminal run, refresh record or not", () => {
    for (const outcome of RunOutcomeSchema.options) {
      for (const to of targets) {
        if (to.state === "queued" && ["done", "failed", "interrupted"].includes(outcome)) continue;
        for (const target of [undefined, refresh("waiting"), refresh("settled")]) {
          assert.notEqual(runTransitionViolation(terminal(outcome), to, target), undefined, `${outcome} -> ${to.state}`);
        }
      }
    }
  });
});

describe("delegation dependency table", () => {
  const legal = new Set(["active>satisfied", "active>failed", "active>cancelled", "failed>active", "cancelled>active"]);
  const states = ["active", "satisfied", "failed", "cancelled"] as const;

  it("settles an active member and reopens only a failed or cancelled one for Retry", () => {
    for (const from of states) {
      for (const to of states) {
        if (from === to) continue;
        const violation = delegationDependencyTransitionViolation(from, to);
        assert.equal(violation === undefined, legal.has(`${from}>${to}`), `${from} -> ${to}: ${violation}`);
      }
    }
  });

  it("names why a satisfied member never reopens", () => {
    assert.match(String(delegationDependencyTransitionViolation("satisfied", "active")), /satisfied/);
  });
});
