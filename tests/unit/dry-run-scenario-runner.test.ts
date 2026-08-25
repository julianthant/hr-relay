import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  evaluateDryRunScenarioEvidence,
  parseDryRunScenarioArguments,
  runDryRunScenario,
} from "../../src/core/dry-run-scenario-runner.js";
import { manualClock } from "../../src/domain/clock.js";
import type { DryRunScenarioResult } from "../../src/domain/trust/dry-run-scenario-result.js";
import {
  deriveDryRunScenarioManifestDigest,
  parseDryRunScenarioManifest,
} from "../../src/domain/trust/dry-run-scenario.js";

const MANIFEST = {
  scenarioId: "fixture-workflow/dry-run",
  workflow: "fixture-workflow",
  transactionNode: "write",
  recordedBy: "fixture contract",
  cases: [{
    caseId: "ordinary",
    subjectLabel: "fixture-canary",
    subjectKind: "ordinary",
    why: "the ordinary case",
    nodesReached: ["read", "write"],
    nodesExcluded: ["after-write"],
    checkpoints: [{
      node: "read",
      attempt: 1,
      keyedBy: ["workflow", "item", "node", "attempt", "claimGeneration"],
    }],
    gateResults: [],
    durableDeltas: { writeIntents: 0, writeAttempts: 0, durableOutbox: 0 },
    receipt: {
      result: "partial",
      confidence: "unknown",
      verification: [{ node: "write", verdict: "unknown", mandatory: true }],
      obligations: [{ obligation: "landing", verdict: "unknown", why: "a preview writes nothing" }],
    },
    terminal: {
      lifecycle: "done",
      resultSchema: "RunDryRunPreviewResultSchema",
      kind: "dry-run-preview",
      externalCommit: "none",
      stoppedAtNodeId: "write",
    },
    preview: { outcome: "would-prepare", subject: "match", staged: true },
  }],
} as const;

const GATED_MANIFEST = {
  ...MANIFEST,
  cases: [{
    ...MANIFEST.cases[0],
    nodesReached: ["read", "approval", "write"],
    gateResults: [{
      gate: "approval",
      decision: "approved",
      resolvedBy: "local-operator",
      leaf: "resolve-gate-approved",
    }],
  }],
} as const;

const READY_EVIDENCE = {
  reachedNodeIds: ["read", "approval", "write"],
  checkpoints: [{
    node: "read",
    attempt: 1,
    keyedBy: ["workflow", "item", "node", "attempt", "claimGeneration"],
  }],
  gateResults: [{ gate: "approval", decision: "approved", resolvedBy: "local-operator" }],
  writeSafetyAfter: { writeIntents: 0, writeAttempts: 0, durableOutbox: 0 },
  receipt: {
    result: "partial",
    confidence: "unknown",
    verification: [
      { obligation: "node.write", verdict: "unknown", mandatory: true },
      { obligation: "landing", verdict: "unknown", mandatory: true },
    ],
  },
  terminal: {
    lifecycle: "done",
    resultSchema: "RunDryRunPreviewResultSchema",
    kind: "dry-run-preview",
    externalCommit: "none",
    stoppedAtNodeId: "write",
    preview: { outcome: "would-prepare", subject: "match", staged: true },
  },
} as const;

describe("dry-run scenario CLI arguments", () => {
  it("accepts exactly one workflow and one subject label", () => {
    assert.deepEqual(
      parseDryRunScenarioArguments([
        "separations-kuali-finalization",
        "--subject",
        "finalization-canary",
      ]),
      {
        workflow: "separations-kuali-finalization",
        subjectLabel: "finalization-canary",
      },
    );
  });

  it.each([
    { args: [] },
    { args: ["fixture-workflow"] },
    { args: ["fixture-workflow", "--subject"] },
    { args: ["fixture-workflow", "--subject", "fixture-canary", "duplicate"] },
    { args: ["fixture-workflow", "--label", "fixture-canary"] },
    { args: ["fixture-workflow", "--subject", "Not A Label"] },
  ])("rejects malformed arguments without supplying defaults: $args", ({ args }) => {
    assert.throws(() => parseDryRunScenarioArguments(args));
  });
});

describe("dry-run scenario manifest boundary", () => {
  it("canonicalizes and digests the complete manifest facts", () => {
    const parsed = parseDryRunScenarioManifest(MANIFEST);

    assert.equal(
      deriveDryRunScenarioManifestDigest(parsed),
      "054481de2b7a4395ef8261dee1ac2284c81c7a97e644675d11ca6c9dbffe9534",
    );
  });

  it("rejects duplicate subject cases at the strict manifest boundary", () => {
    assert.throws(() => parseDryRunScenarioManifest({
      ...MANIFEST,
      cases: [MANIFEST.cases[0], { ...MANIFEST.cases[0], caseId: "second" }],
    }), /repeats a subjectLabel/);
  });
});

describe("dry-run scenario execution", () => {
  it("fails loud on unknown workflows, manifest mismatch, and missing cases", async () => {
    const base = {
      resolveTarget: () => ({ state: "blocked" as const, label: "fixture-canary", reason: "blocked" }),
      persistResult: () => undefined,
      createRuntime: () => { throw new Error("invalid declarations must not construct runtime"); },
      clock: manualClock(new Date("2026-08-25T18:00:00.000Z")),
      ids: { uuid: () => "11111111-1111-4111-8111-111111111111" },
    };

    await assert.rejects(runDryRunScenario({
      ...base,
      args: { workflow: "unknown-workflow", subjectLabel: "fixture-canary" },
      loadManifest: () => Promise.reject(new Error("unknown dry-run scenario workflow unknown-workflow")),
    }), /unknown dry-run scenario workflow unknown-workflow/);
    await assert.rejects(runDryRunScenario({
      ...base,
      args: { workflow: "fixture-workflow", subjectLabel: "fixture-canary" },
      loadManifest: () => Promise.resolve({ ...MANIFEST, workflow: "other-workflow" }),
    }), /declares workflow other-workflow, not requested fixture-workflow/);
    await assert.rejects(runDryRunScenario({
      ...base,
      args: { workflow: "fixture-workflow", subjectLabel: "missing-canary" },
      loadManifest: () => Promise.resolve(MANIFEST),
    }), /has 0 cases for subject missing-canary; exactly one is required/);
  });

  it("records a blocked result before constructing a runtime", async () => {
    const records: DryRunScenarioResult[] = [];
    let runtimeFactories = 0;

    const outcome = await runDryRunScenario({
      args: { workflow: "fixture-workflow", subjectLabel: "fixture-canary" },
      loadManifest: () => Promise.resolve(MANIFEST),
      resolveTarget: () => ({
        state: "blocked",
        label: "fixture-canary",
        reason: "blocked: needs fixture-canary; registry says gone, last observed 2026-08-25",
      }),
      persistResult: (record) => {
        records.push(record);
      },
      createRuntime: () => {
        runtimeFactories += 1;
        throw new Error("a blocked case must not compose runtime or browser services");
      },
      clock: manualClock(new Date("2026-08-25T18:00:00.000Z")),
      ids: { uuid: () => "11111111-1111-4111-8111-111111111111" },
    });

    assert.equal(runtimeFactories, 0);
    assert.deepEqual(outcome, {
      verdict: "blocked",
      exitCode: 2,
      resultId: "11111111-1111-4111-8111-111111111111",
      output: "blocked: needs fixture-canary\nresult: 11111111-1111-4111-8111-111111111111",
    });
    assert.deepEqual(records, [{
      resultId: "11111111-1111-4111-8111-111111111111",
      scenarioId: "fixture-workflow/dry-run",
      workflow: "fixture-workflow",
      subjectLabel: "fixture-canary",
      manifestDigest: "054481de2b7a4395ef8261dee1ac2284c81c7a97e644675d11ca6c9dbffe9534",
      verdict: "blocked",
      execution: { state: "not-started", reason: "subject-unavailable" },
      assertions: [{
        assertionId: "subject-availability",
        verdict: "blocked",
        reason: "subject-unavailable",
      }],
      wallTimeMs: 0,
      recordedAt: "2026-08-25T18:00:00.000Z",
    }]);
  });

  it("runs ready gated cases as start, drain, gate, drain, assert", async () => {
    const order: string[] = [];
    const records: DryRunScenarioResult[] = [];

    const outcome = await runDryRunScenario({
      args: { workflow: "fixture-workflow", subjectLabel: "fixture-canary" },
      loadManifest: () => Promise.resolve(GATED_MANIFEST),
      resolveTarget: () => ({ state: "ready", label: "fixture-canary", canonicalInput: { id: "safe" } }),
      persistResult: (record) => {
        records.push(record);
      },
      createRuntime: () => ({
        start: () => {
          order.push("start");
          return Promise.resolve({
            runId: "22222222-2222-4222-8222-222222222222",
            traceId: "fx-180000-2222",
            writeSafetyBefore: { writeIntents: 0, writeAttempts: 0, durableOutbox: 0 },
          });
        },
        drain: () => {
          order.push("drain");
          return Promise.resolve();
        },
        resolveGate: () => {
          order.push("gate");
          return Promise.resolve();
        },
        collectEvidence: () => {
          order.push("assert");
          return Promise.resolve(READY_EVIDENCE);
        },
      }),
      clock: manualClock(new Date("2026-08-25T18:00:00.000Z")),
      ids: { uuid: () => "11111111-1111-4111-8111-111111111111" },
    });

    assert.deepEqual(order, ["start", "drain", "gate", "drain", "assert"]);
    assert.equal(outcome.verdict, "met");
    assert.equal(outcome.exitCode, 0);
    assert.equal(records[0]?.verdict, "met");
    assert.equal(records[0]?.execution.state, "started");
  });

  it("treats an expected failed workflow as a met scenario", async () => {
    const expectedFailureManifest = {
      ...MANIFEST,
      cases: [{
        ...MANIFEST.cases[0],
        nodesReached: ["read"],
        nodesExcluded: ["write", "after-write"],
        checkpoints: [],
        receipt: {
          result: "failed",
          confidence: "unknown",
          verification: [{ node: "write", verdict: "absent", mandatory: true }],
          obligations: [],
        },
        terminal: { lifecycle: "failed", reason: "expected", openItem: "expected" },
        preview: { outcome: "not-reached", reason: "expected" },
      }],
    } as const;
    const records: DryRunScenarioResult[] = [];

    const outcome = await runDryRunScenario({
      args: { workflow: "fixture-workflow", subjectLabel: "fixture-canary" },
      loadManifest: () => Promise.resolve(expectedFailureManifest),
      resolveTarget: () => ({ state: "ready", label: "fixture-canary", canonicalInput: {} }),
      persistResult: (result) => records.push(result),
      createRuntime: () => ({
        start: () => Promise.resolve({
          runId: "22222222-2222-4222-8222-222222222222",
          traceId: "fx-180000-2222",
          writeSafetyBefore: { writeIntents: 0, writeAttempts: 0, durableOutbox: 0 },
        }),
        drain: () => Promise.resolve(),
        resolveGate: () => Promise.reject(new Error("no gate expected")),
        collectEvidence: () => Promise.resolve({
          reachedNodeIds: ["read"],
          checkpoints: [],
          gateResults: [],
          writeSafetyAfter: { writeIntents: 0, writeAttempts: 0, durableOutbox: 0 },
          receipt: {
            result: "failed",
            confidence: "unknown",
            verification: [{ obligation: "node.write", verdict: "absent", mandatory: true }],
          },
          terminal: { lifecycle: "failed" },
        }),
      }),
      clock: manualClock(new Date("2026-08-25T18:00:00.000Z")),
      ids: { uuid: () => "11111111-1111-4111-8111-111111111111" },
    });

    assert.equal(outcome.verdict, "met");
    assert.equal(records[0]?.verdict, "met");
  });

  it("persists safe started failure evidence and redacts the thrown cause", async () => {
    const records: DryRunScenarioResult[] = [];
    const secret = "resolved-person-value-123";

    await assert.rejects(
      runDryRunScenario({
        args: { workflow: "fixture-workflow", subjectLabel: "fixture-canary" },
        loadManifest: () => Promise.resolve(MANIFEST),
        resolveTarget: () => ({ state: "ready", label: "fixture-canary", canonicalInput: { secret } }),
        persistResult: (result) => records.push(result),
        createRuntime: () => ({
          start: () => Promise.resolve({
            runId: "22222222-2222-4222-8222-222222222222",
            traceId: "fx-180000-2222",
            writeSafetyBefore: { writeIntents: 0, writeAttempts: 0, durableOutbox: 0 },
          }),
          drain: () => Promise.reject(new Error(`failed for ${secret}`)),
          resolveGate: () => Promise.resolve(),
          collectEvidence: () => Promise.reject(new Error("not reached")),
        }),
        clock: manualClock(new Date("2026-08-25T18:00:00.000Z")),
        ids: { uuid: () => "11111111-1111-4111-8111-111111111111" },
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, new RegExp(secret));
        assert.match(error.message, /failed result 11111111/);
        return true;
      },
    );
    assert.deepEqual(records[0]?.assertions, [{
      assertionId: "runner-execution",
      verdict: "failed",
      reason: "execution-error",
    }]);
    assert.doesNotMatch(JSON.stringify(records), new RegExp(secret));
  });
});

describe("dry-run scenario evidence assertions", () => {
  const scenarioCase = parseDryRunScenarioManifest(GATED_MANIFEST).cases[0];
  if (scenarioCase === undefined) throw new Error("fixture manifest has no case");
  const before = { writeIntents: 0, writeAttempts: 0, durableOutbox: 0 } as const;

  const mutations = [
    [["nodes-reached"], { ...READY_EVIDENCE, reachedNodeIds: ["read", "approval"] }],
    [["nodes-reached", "nodes-excluded"], {
      ...READY_EVIDENCE,
      reachedNodeIds: [...READY_EVIDENCE.reachedNodeIds, "after-write"],
    }],
    [["checkpoints"], {
      ...READY_EVIDENCE,
      checkpoints: [{ ...READY_EVIDENCE.checkpoints[0], attempt: 2 }],
    }],
    [["gate-results"], {
      ...READY_EVIDENCE,
      gateResults: [{ ...READY_EVIDENCE.gateResults[0], decision: "rejected" }],
    }],
    [["write-safety-deltas"], {
      ...READY_EVIDENCE,
      writeSafetyAfter: { ...READY_EVIDENCE.writeSafetyAfter, writeIntents: 1 },
    }],
    [["receipt"], {
      ...READY_EVIDENCE,
      receipt: { ...READY_EVIDENCE.receipt, confidence: "partial" },
    }],
    [["terminal"], {
      ...READY_EVIDENCE,
      terminal: { ...READY_EVIDENCE.terminal, stoppedAtNodeId: "after-write" },
    }],
    [["preview"], {
      ...READY_EVIDENCE,
      terminal: {
        ...READY_EVIDENCE.terminal,
        preview: { ...READY_EVIDENCE.terminal.preview, subject: "not-observed" },
      },
    }],
  ] as const;

  it.each(mutations)("turns $0 red when only its evidence is mutated", (assertionIds, evidence) => {
    const outcomes = evaluateDryRunScenarioEvidence(scenarioCase, before, evidence);

    assert.deepEqual(
      outcomes.filter(({ verdict }) => verdict === "failed").map(({ assertionId: id }) => id),
      assertionIds,
    );
  });
});
