import { createDryRunScenarioFixtures, evaluateDryRunScenarioEvidence, runDryRunScenario } from "../../support/helpers/dry-run-scenario-fixtures.js";
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { DiagnosticBundleBytesMissingError } from "../../../src/backend/runs/commands/refusals.js";
import type { DryRunScenarioResult } from "../../../src/models/trust/dry-run-scenario-result.js";
import {
parseDryRunScenarioManifest
} from "../../../src/models/trust/dry-run-scenario.js";
import { manualClock } from "../../../src/rules/time/clock.js";

const { MANIFEST } = createDryRunScenarioFixtures();

const GATED_MANIFEST = {
  ...MANIFEST,
  cases: [{
    ...MANIFEST.cases[0],
    nodesReached: ["read", "approval", "write"],
    gateResults: [{ gate: "approval", decision: "approved", resolvedBy: "local-operator" }],
  }],
} as const;

const READY_EVIDENCE = {
  runAttempt: 1,
  reachedNodeIds: ["read", "approval", "write"],
  checkpoints: [{
    node: "read",
    attempt: 1,
    keyedBy: ["workflow", "item", "node", "attempt", "claimGeneration"],
  }],
  gateResults: [{ gate: "approval", decision: "approved", resolvedBy: "local-operator" }],
  writeSafetyAfter: { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 },
  receipt: {
    result: "partial",
    confidence: "unknown",
    verification: [
      { obligation: "node.read", verdict: "verified", mandatory: false },
      { obligation: "node.write", verdict: "unknown", mandatory: true },
      { obligation: "completion.terminal-result", verdict: "unknown", mandatory: true },
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
      output: "blocked: needs fixture-canary; registry says gone, last observed 2026-08-25\nresult: 11111111-1111-4111-8111-111111111111",
    });
    assert.deepEqual(records, [{
      resultId: "11111111-1111-4111-8111-111111111111",
      scenarioId: "fixture-workflow/dry-run",
      workflow: "fixture-workflow",
      subjectLabel: "fixture-canary",
      manifestDigest: "0aaccc8fbfc9c0083a8248104d800f74f073ad6d0736e0913a2685e118c7e297",
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
            writeSafetyBefore: { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 },
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
          verification: [
            { obligation: "node.read", verdict: "verified", mandatory: false },
            { obligation: "node.write", verdict: "absent", mandatory: true },
            { obligation: "completion.terminal-result", verdict: "absent", mandatory: true },
          ],
        },
        terminal: {
          lifecycle: "failed",
          code: "UNHANDLED",
          node: "read",
          fingerprint: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
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
          writeSafetyBefore: { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 },
        }),
        drain: () => Promise.resolve(),
        resolveGate: () => Promise.reject(new Error("no gate expected")),
        collectEvidence: () => Promise.resolve({
          runAttempt: 1,
          reachedNodeIds: ["read"],
          checkpoints: [],
          gateResults: [],
          writeSafetyAfter: { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 },
          receipt: {
            result: "failed",
            confidence: "unknown",
            verification: [
              { obligation: "node.read", verdict: "verified", mandatory: false },
              { obligation: "node.write", verdict: "absent", mandatory: true },
              { obligation: "completion.terminal-result", verdict: "absent", mandatory: true },
            ],
          },
          terminal: {
            lifecycle: "failed",
            code: "UNHANDLED",
            node: "read",
            fingerprint: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          },
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
            writeSafetyBefore: { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 },
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
        assert.ok(error.cause instanceof Error);
        assert.match(error.cause.message, new RegExp(`failed for ${secret}`));
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

  it("surfaces the underlying cause when a scenario fails before run identity is known", async () => {
    await assert.rejects(
      runDryRunScenario({
        args: { workflow: "fixture-workflow", subjectLabel: "fixture-canary" },
        loadManifest: () => Promise.resolve(MANIFEST),
        resolveTarget: () => ({ state: "ready", label: "fixture-canary", canonicalInput: {} }),
        persistResult: () => {
          throw new Error("persistResult must not be called before run identity is known");
        },
        createRuntime: () => ({
          start: () => Promise.reject(new Error("runtime could not start")),
          drain: () => Promise.reject(new Error("not reached")),
          resolveGate: () => Promise.resolve(),
          collectEvidence: () => Promise.reject(new Error("not reached")),
        }),
        clock: manualClock(new Date("2026-08-25T18:00:00.000Z")),
        ids: { uuid: () => "11111111-1111-4111-8111-111111111111" },
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /before run identity was known/);
        assert.ok(error.cause instanceof Error);
        assert.match(error.cause.message, /runtime could not start/);
        return true;
      },
    );
  });
});

describe("dry-run scenario evidence assertions", () => {
  const scenarioCase = parseDryRunScenarioManifest(GATED_MANIFEST).cases[0];
  if (scenarioCase === undefined) throw new Error("fixture manifest has no case");
  const before = { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 } as const;

  it("refuses a confirmation delta against the released zero-write manifest", () => {
    const outcomes = evaluateDryRunScenarioEvidence("dry-run-preview", scenarioCase, before, {
      ...READY_EVIDENCE, writeSafetyAfter: { ...READY_EVIDENCE.writeSafetyAfter, confirmedOperations: 1 },
    });
    assert.deepEqual(outcomes.filter((row) => row.verdict === "failed").map((row) => row.assertionId), ["write-safety-deltas"]);
  });

  it("refuses an evaluation whose declared arm disagrees with the case shape; the manifest arm, not the case, selects the assertion set", () => {
    assert.ok(scenarioCase && "preview" in scenarioCase, "the fixture case is a preview-arm case");
    assert.throws(
      () => evaluateDryRunScenarioEvidence("live-read", scenarioCase, before, READY_EVIDENCE),
      /dry-run case ordinary does not belong to the live-read arm/u,
    );
    const evaluated = evaluateDryRunScenarioEvidence("dry-run-preview", scenarioCase, before, READY_EVIDENCE);
    assert.ok(evaluated.length > 0);
  });

  it("rejects an authority verdict mutation instead of collapsing its meaning", () => {
    const absentCase = parseDryRunScenarioManifest({
      ...GATED_MANIFEST,
      cases: [{
        ...GATED_MANIFEST.cases[0],
        receipt: {
          ...GATED_MANIFEST.cases[0]?.receipt,
          verification: GATED_MANIFEST.cases[0]?.receipt.verification.map((row) =>
            row.obligation === "landing" ? { ...row, verdict: "absent" as const } : row),
        },
      }],
    }).cases[0];
    if (absentCase === undefined) throw new Error("fixture manifest has no case");
    const mutatedEvidence = {
      ...READY_EVIDENCE,
      receipt: {
        ...READY_EVIDENCE.receipt,
        verification: READY_EVIDENCE.receipt.verification.map((row) =>
          row.obligation === "landing" ? { ...row, verdict: "ambiguous" as const } : row),
      },
    };

    const outcomes = evaluateDryRunScenarioEvidence("dry-run-preview", absentCase, before, mutatedEvidence);

    assert.deepEqual(
      outcomes.filter(({ verdict }) => verdict === "failed").map(({ assertionId }) => assertionId),
      ["receipt"],
    );
  });

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
    [["receipt"], {
      ...READY_EVIDENCE,
      receipt: {
        ...READY_EVIDENCE.receipt,
        verification: READY_EVIDENCE.receipt.verification.map((row) =>
          row.obligation === "landing" ? { ...row, verdict: "ambiguous" as const } : row),
      },
    }],
    [["receipt"], {
      ...READY_EVIDENCE,
      receipt: {
        ...READY_EVIDENCE.receipt,
        verification: READY_EVIDENCE.receipt.verification.filter(({ obligation }) =>
          obligation !== "node.read"),
      },
    }],
    [["receipt"], {
      ...READY_EVIDENCE,
      receipt: {
        ...READY_EVIDENCE.receipt,
        verification: [
          ...READY_EVIDENCE.receipt.verification,
          { obligation: "unexpected-obligation", verdict: "unknown", mandatory: true },
        ],
      },
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
    const outcomes = evaluateDryRunScenarioEvidence("dry-run-preview", scenarioCase, before, evidence);

    assert.deepEqual(
      outcomes.filter(({ verdict }) => verdict === "failed").map(({ assertionId: id }) => id),
      assertionIds,
    );
  });

  it("matches a failed terminal only by its safe durable failure identity", () => {
    const failedCase = parseDryRunScenarioManifest({
      ...GATED_MANIFEST,
      cases: [{
        ...GATED_MANIFEST.cases[0],
        terminal: {
          lifecycle: "failed",
          code: "SUBJECT_MISMATCH",
          node: "write",
          fingerprint: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
        preview: { outcome: "not-reached", reason: "binding proof refused before preview settlement" },
      }],
    }).cases[0];
    assert.ok(failedCase);

    const outcomes = evaluateDryRunScenarioEvidence("dry-run-preview", failedCase, before, {
      ...READY_EVIDENCE,
      terminal: {
        lifecycle: "failed",
        code: "SUBJECT_MISMATCH",
        node: "write",
        fingerprint: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    });

    assert.deepEqual(outcomes.filter(({ verdict }) => verdict === "failed"), []);
  });

  it.each([
    { field: "code", terminal: { lifecycle: "failed", code: "OTHER_FAILURE", node: "write", fingerprint: "a".repeat(64) } },
    { field: "node", terminal: { lifecycle: "failed", code: "SUBJECT_MISMATCH", node: "other", fingerprint: "a".repeat(64) } },
    { field: "fingerprint", terminal: { lifecycle: "failed", code: "SUBJECT_MISMATCH", node: "write", fingerprint: "b".repeat(64) } },
  ])("turns terminal red when failed evidence mutates only $field", ({ terminal }) => {
    const failedCase = parseDryRunScenarioManifest({
      ...GATED_MANIFEST,
      cases: [{
        ...GATED_MANIFEST.cases[0],
        terminal: {
          lifecycle: "failed",
          code: "SUBJECT_MISMATCH",
          node: "write",
          fingerprint: "a".repeat(64),
        },
        preview: { outcome: "not-reached", reason: "binding proof refused before preview settlement" },
      }],
    }).cases[0];
    assert.ok(failedCase);

    const outcomes = evaluateDryRunScenarioEvidence("dry-run-preview", failedCase, before, {
      ...READY_EVIDENCE,
      terminal,
    });

    assert.deepEqual(outcomes.filter(({ verdict }) => verdict === "failed").map(({ assertionId }) => assertionId), [
      "terminal",
    ]);
  });
});


describe("scenario task-point screenshots", () => {
  const base = GATED_MANIFEST.cases[0];
  const scenarioCase = parseDryRunScenarioManifest({ ...GATED_MANIFEST,
    cases: [{ ...base, screenshots: { nodes: ["read"] } }] }).cases[0];
  assert.ok(scenarioCase);
  const before = { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 };
  const capture = { node: "read", attempt: 1, sessionId: "11111111-1111-4111-8111-111111111111",
    bundleId: "22222222-2222-4222-8222-222222222222", artifactId: "33333333-3333-4333-8333-333333333333" };

  it("requires a screenshot assertion when the opted case has no action evidence", () => {
    const assertions = evaluateDryRunScenarioEvidence("dry-run-preview", scenarioCase, before, READY_EVIDENCE);
    assert.equal(assertions.find(row => row.assertionId === "screenshot-actions")?.verdict, "failed");
  });

  it.each([
    { name: "exact", captures: [capture], verdict: "met" },
    { name: "missing", captures: [], verdict: "failed" },
    { name: "extra", captures: [capture, { ...capture, node: "write" }], verdict: "failed" },
    { name: "duplicate", captures: [capture, capture], verdict: "failed" },
    { name: "wrong node", captures: [{ ...capture, node: "write" }], verdict: "failed" },
    { name: "wrong attempt", captures: [{ ...capture, attempt: 2 }], verdict: "failed" },
  ])("checks $name persisted task-point actions", ({ captures, verdict }) => {
    const assertions = evaluateDryRunScenarioEvidence("dry-run-preview", scenarioCase, before,
      { ...READY_EVIDENCE, screenshots: captures });
    assert.equal(assertions.find(row => row.assertionId === "screenshot-actions")?.verdict, verdict);
  });

  it("keeps preview checkpoint and screenshot attempts bound to the fixture manifest", () => {
    const assertions = evaluateDryRunScenarioEvidence("dry-run-preview", scenarioCase, before,
      { ...READY_EVIDENCE, runAttempt: 6, screenshots: [capture] });
    assert.equal(assertions.find(row => row.assertionId === "checkpoints")?.verdict, "met");
    assert.equal(assertions.find(row => row.assertionId === "screenshot-actions")?.verdict, "met");
  });

  it("persists a failed scenario result and retains the named capture-evidence failure", async () => {
    const records: DryRunScenarioResult[] = [];
    const failure = new DiagnosticBundleBytesMissingError("fixture capture bytes unavailable");
    await assert.rejects(runDryRunScenario({
      args: { workflow: GATED_MANIFEST.workflow, subjectLabel: scenarioCase.subjectLabel },
      loadManifest: () => Promise.resolve({ ...GATED_MANIFEST, cases: [scenarioCase] }),
      resolveTarget: () => ({ state: "ready", label: scenarioCase.subjectLabel, canonicalInput: {} }),
      persistResult: result => { records.push(result); },
      createRuntime: () => ({
        start: () => Promise.resolve({ runId: "11111111-1111-4111-8111-111111111111", traceId: "fx-180000-1111", writeSafetyBefore: before }),
        drain: () => Promise.resolve(), resolveGate: () => Promise.resolve(),
        collectEvidence: () => Promise.reject(failure),
      }), clock: manualClock(new Date("2026-08-25T18:00:00.000Z")),
      ids: { uuid: () => "22222222-2222-4222-8222-222222222222" },
    }), error => error instanceof Error && error.cause === failure);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.verdict, "failed");
    assert.deepEqual(records[0]?.assertions, [{ assertionId: "runner-execution", verdict: "failed", reason: "execution-error" }]);
  });

  it("refuses repeated expected nodes and binds screenshot expectations into the manifest", () => {
    assert.doesNotThrow(() => parseDryRunScenarioManifest({ ...GATED_MANIFEST, cases: [scenarioCase] }));
    assert.throws(() => parseDryRunScenarioManifest({ ...GATED_MANIFEST,
      cases: [{ ...scenarioCase, screenshots: { nodes: ["read", "read"] } }] }));
  });
});

describe("live-read scenario attempt evidence", () => {
  const scenarioCase = parseDryRunScenarioManifest({
    scenarioId: "fixture-workflow/live-read", workflow: "fixture-workflow", arm: "live-read", recordedBy: "fixture",
    cases: [{ caseId: "fresh", subjectLabel: "fixture-canary", subjectKind: "ordinary", why: "fresh read proof",
      nodesReached: ["read"], nodesExcluded: [],
      checkpoints: [{ node: "read", attempt: 1, keyedBy: ["workflow", "item", "node", "attempt", "claimGeneration"] }],
      screenshots: { nodes: ["read"] }, gateResults: [],
      durableDeltas: { writeIntents: 0, writeAttempts: 0, durableOutbox: 0 },
      receipt: { result: "verified-done", confidence: "verified", verification: [{ obligation: "node.read", verdict: "verified", mandatory: true }] },
      terminal: { lifecycle: "done", resultSchema: "workflow-result", kind: "live-read" } }],
  }).cases[0];
  assert.ok(scenarioCase);
  const before = { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 };
  const evidence = { runAttempt: 6, reachedNodeIds: ["read"],
    checkpoints: [{ node: "read", attempt: 6, keyedBy: ["workflow", "item", "node", "attempt", "claimGeneration"] }],
    screenshots: [{ node: "read", attempt: 6, sessionId: "11111111-1111-4111-8111-111111111111",
      bundleId: "22222222-2222-4222-8222-222222222222", artifactId: "33333333-3333-4333-8333-333333333333" }],
    gateResults: [], writeSafetyAfter: before,
    receipt: { result: "verified-done", confidence: "verified", verification: [{ obligation: "node.read", verdict: "verified", mandatory: true }] },
    terminal: { lifecycle: "done-live-read", resultSchema: "workflow-result", kind: "live-read" } };

  it("accepts fresh checkpoint and screenshot evidence for the run's sixth attempt", () => {
    assert.deepEqual(evaluateDryRunScenarioEvidence("live-read", scenarioCase, before, evidence)
      .filter(row => row.verdict !== "met"), []);
  });

  it.each([1, 5])("rejects a replayed node and screenshot from attempt %s", attempt => {
    const assertions = evaluateDryRunScenarioEvidence("live-read", scenarioCase, before, { ...evidence,
      checkpoints: evidence.checkpoints.map(row => ({ ...row, attempt })),
      screenshots: evidence.screenshots.map(row => ({ ...row, attempt })) });
    assert.equal(assertions.find(row => row.assertionId === "checkpoints")?.verdict, "failed");
    assert.equal(assertions.find(row => row.assertionId === "screenshot-actions")?.verdict, "failed");
  });
});
