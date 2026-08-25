import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../src/config/runtime-isolation.js";
import { manualClock, type TestClock } from "../../src/domain/clock.js";
import { UcpathJobSummaryReadSchema } from "../../src/domain/ui/ucpath-job-summary.js";
import { parseDryRunScenarioManifest } from "../../src/domain/trust/dry-run-scenario.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import { composeDryRunScenarioCommand } from "../../src/server/dry-run-scenario/compose.js";
import { createProductionDryRunScenarioRuntime } from "../../src/server/dry-run-scenario/runtime.js";
import { createDeterministicKualiDriver, createKualiFakeWorld } from "../../src/stores/kuali/driver/fake.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../src/stores/ucpath/driver/fake.js";
import { deriveJobRowFromCells } from "../../src/stores/ucpath/driver/person-org-operation.js";
import { SeparationsKualiFinalizationCanonicalInput } from "../../src/workflows/separations/kuali-finalization/descriptor.js";
import {
  FINALIZATION_ACTION_ID,
  FINALIZATION_DOCUMENT,
  FINALIZATION_EID,
  FINALIZATION_OTHER_EID,
  FINALIZATION_RUN_INPUT,
} from "./fixtures/kuali-finalization-fixtures.js";
import { sessionFactoryHarness } from "./fixtures/phase1f-executor-harness.js";
import { sequentialIdFactory } from "./fixtures/phase1f-run-fixtures.js";

const roots: string[] = [];

function composedSessions(clock: TestClock, displayedEidAfterStage?: string) {
  const world = createKualiFakeWorld({
    actionId: FINALIZATION_ACTION_ID,
    documentNumber: FINALIZATION_DOCUMENT,
    displayedEid: FINALIZATION_EID,
  });
  if (displayedEidAfterStage !== undefined) world.displayedEidAfterStage = displayedEidAfterStage;
  const candidate = {
    emplId: FINALIZATION_EID,
    name: FINALIZATION_RUN_INPUT.employeeName,
    department: "Housing Dining Hospitality",
    jobTitle: "STDT 2",
    employeeStatus: "active" as const,
    hdh: true,
  };
  const jobRows = [deriveJobRowFromCells([
    "0", "07/01/2025", "Active", "SDCMP", "40012345", "000412",
    "HOUSING/DINING/HOSPITALITY", "004921", "STDT 2", "", "0.500000", "Student",
  ], 0)];
  const sessions = sessionFactoryHarness({
    ucpath: () => createDeterministicUcpathPersonOrgDriver(
      {
        results: [candidate],
        selection: { status: "resolved", selected: candidate, candidateEids: [FINALIZATION_EID] },
      },
      UcpathJobSummaryReadSchema.parse({
        state: "read",
        summary: {
          pageStateId: "ucpath.person-org.detail-ready",
          emplId: FINALIZATION_EID,
          displayedName: "Deterministic Person",
          jobRows,
          rowCount: 1,
          renderContext: {
            entry: "auto-detail",
            searchResultRows: 0,
            employmentInstances: "already-complete",
          },
          observedAt: "2026-08-25T18:00:00.000Z",
        },
      }),
    ),
    kuali: () => createDeterministicKualiDriver(world, clock),
  });
  return { sessions, world };
}

const PREVIEW_RECEIPT_VERIFICATION = [
  { obligation: "node.job-summary", verdict: "verified", mandatory: false },
  { obligation: "node.name-search", verdict: "verified", mandatory: false },
  { obligation: "node.department-option", verdict: "verified", mandatory: true },
  { obligation: "node.comparison", verdict: "verified", mandatory: false },
  { obligation: "node.identity-approval", verdict: "verified", mandatory: false },
  { obligation: "node.approval", verdict: "verified", mandatory: true },
  { obligation: "node.finalize-kuali", verdict: "unknown", mandatory: true },
  { obligation: "completion.terminal-result", verdict: "unknown", mandatory: true },
  { obligation: "write.timekeeper-matches-request", verdict: "unknown", mandatory: true },
  { obligation: "identity.eid-agrees-across-sources", verdict: "unknown", mandatory: true },
  { obligation: "write.document-matches-request", verdict: "unknown", mandatory: true },
  { obligation: "write.transaction-matches-request", verdict: "unknown", mandatory: true },
  { obligation: "write.proof-is-a-read-back", verdict: "absent", mandatory: true },
] as const;

const TEST_MANIFEST = parseDryRunScenarioManifest({
  scenarioId: "separations-kuali-finalization/dry-run",
  workflow: "separations-kuali-finalization",
  transactionNode: "finalize-kuali",
  recordedBy: "unit composition fixture",
  cases: [{
    caseId: "ordinary",
    subjectLabel: "finalization-canary",
    subjectKind: "ordinary",
    why: "the composition fixture exercises the ordinary declaration",
    nodesReached: [
      "job-summary", "name-search", "department-option", "comparison",
      "identity-approval", "approval", "finalize-kuali",
    ],
    nodesExcluded: [],
    checkpoints: ["job-summary", "name-search", "department-option", "comparison", "approval"].map((node) => ({
      node,
      attempt: 1,
      keyedBy: ["workflow", "item", "node", "attempt", "claimGeneration"],
    })),
    gateResults: [{
      gate: "identity-approval",
      decision: "approved",
      resolvedBy: "local-operator",
      leaf: "resolve-gate-approved",
    }],
    durableDeltas: { writeIntents: 0, writeAttempts: 0, durableOutbox: 0 },
    receipt: {
      result: "partial",
      confidence: "unknown",
      verification: PREVIEW_RECEIPT_VERIFICATION,
    },
    terminal: {
      lifecycle: "done",
      resultSchema: "RunDryRunPreviewResultSchema",
      kind: "dry-run-preview",
      externalCommit: "none",
      stoppedAtNodeId: "finalize-kuali",
    },
    preview: { outcome: "would-prepare", subject: "match", staged: true },
  }],
});

const FAILED_TEST_MANIFEST = parseDryRunScenarioManifest({
  ...TEST_MANIFEST,
  cases: [{
    ...TEST_MANIFEST.cases[0],
    caseId: "subject-mismatch",
    subjectLabel: "finalization-subject-mismatch",
    subjectKind: "subject-mismatch",
    receipt: {
      ...TEST_MANIFEST.cases[0]?.receipt,
      result: "failed",
      verification: PREVIEW_RECEIPT_VERIFICATION.map((row) =>
        row.obligation === "completion.terminal-result"
          ? { ...row, verdict: "absent" as const }
          : row),
    },
    terminal: {
      lifecycle: "failed",
      code: "UNHANDLED",
      node: "finalize-kuali",
      fingerprint: "2459ee6496de1582e97ff1e4a5c647ec91358201f9960b2f602968efd7d29625",
    },
    preview: { outcome: "not-reached", reason: "binding proof refused before preview settlement" },
  }],
});

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("dry-run scenario production composition boundary", () => {
  it("persists a blocked v16 row without constructing browser/runtime services", async () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-dry-run-cli-"));
    roots.push(root);
    mkdirSync(join(root, "config"), { recursive: true });
    writeFileSync(
      join(root, "config", "test-subjects.json"),
      readFileSync(join(process.cwd(), "config", "test-subjects.json"), "utf8"),
    );
    let runtimeFactories = 0;

    const outcome = await composeDryRunScenarioCommand({
      isolation: rebuildRuntimeIsolation,
      args: ["separations-kuali-finalization", "--subject", "finalization-canary"],
      repoRoot: root,
      env: {},
      clock: manualClock(new Date("2026-08-25T18:00:00.000Z")),
      ids: { uuid: () => "11111111-1111-4111-8111-111111111111" },
      loadManifest: () => Promise.resolve(TEST_MANIFEST),
      createRuntime: () => {
        runtimeFactories += 1;
        throw new Error("blocked resolution must precede runtime composition");
      },
    });

    assert.equal(runtimeFactories, 0);
    assert.equal(outcome.exitCode, 2);
    assert.match(outcome.output, /blocked: needs finalization-canary/);

    const database = AuthorityDatabase.open(
      {
        path: join(root, rebuildRuntimeIsolation.stateRoot, "state.db"),
        busyTimeoutMs: 250,
        migrationOwner: "dry-run-cli-query-test",
      },
      manualClock(new Date("2026-08-25T18:00:00.000Z")),
    );
    try {
      assert.deepEqual(database.authority.dryRunScenarioResults.list().map((row) => ({
        resultId: row.resultId,
        subjectLabel: row.subjectLabel,
        verdict: row.verdict,
        execution: row.execution,
      })), [{
        resultId: "11111111-1111-4111-8111-111111111111",
        subjectLabel: "finalization-canary",
        verdict: "blocked",
        execution: { state: "not-started", reason: "subject-unavailable" },
      }]);
    } finally {
      database.close();
    }
  });

  it("starts through the real start-plan service and start-run command kernel", async () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-dry-run-start-"));
    roots.push(root);
    writeFileSync(
      join(root, "package.json"),
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    );
    const stateRoot = join(root, rebuildRuntimeIsolation.stateRoot);
    mkdirSync(stateRoot, { recursive: true });
    const clock = manualClock(new Date("2026-08-25T18:00:00.000Z"));
    const bootstrap = AuthorityDatabase.open(
      { path: join(stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "dry-run-start-test" },
      clock,
    );
    bootstrap.close();
    const scenarioCase = TEST_MANIFEST.cases[0];
    if (scenarioCase === undefined) throw new Error("the finalization manifest lost its ordinary case");
    const canonicalInput = SeparationsKualiFinalizationCanonicalInput.parse({
      actionId: "6a7a33b2ac106d428b3217e0",
      documentNumber: "4510",
      employeeName: "Fixture, Person",
      emplId: "10873698",
      emplIdSource: "document-eid",
      documentEid: { state: "present", value: "10873698" },
      ucpathDeptId: { state: "present", value: "000412" },
      ucpathDepartment: { state: "present", value: "HOUSING/DINING/HOSPITALITY" },
      observedDepartmentOptions: ["- - -", "000412 - Housing/Dining/Hospitality"],
      payrollTitleCode: "004921",
      payrollTitle: "STDT 2",
      timekeeperName: "Fixture Timekeeper",
      lastDayWorked: "06/09/2026",
      separationDate: "06/10/2026",
      terminationEffectiveDate: "06/11/2026",
      transactionNumber: "T002209631",
      timekeeperComments: "Fixture finalization comments.",
      observedExistingComments: "",
    });
    const runtime = createProductionDryRunScenarioRuntime({
      isolation: rebuildRuntimeIsolation,
      repoRoot: root,
      env: {},
      clock,
      ids: sequentialIdFactory("d"),
      drainWorker: () => Promise.reject(new Error("start test must not drain")),
    });

    const started = await runtime.start({
      manifest: TEST_MANIFEST,
      scenarioCase,
      canonicalInput,
    });

    const database = AuthorityDatabase.open(
      { path: join(stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "dry-run-start-query" },
      clock,
    );
    try {
      const run = database.authority.runs.get(started.runId);
      assert.equal(run?.envelope.dryRun, true);
      assert.equal(run?.envelope.workflow, "separations-kuali-finalization");
      assert.equal(run?.envelope.traceId, started.traceId);
      assert.equal(run?.lifecycle.state, "queued");
      assert.deepEqual(started.writeSafetyBefore, {
        writeIntents: 0,
        writeAttempts: 0,
        durableOutbox: 0,
      });
    } finally {
      database.close();
    }
  });

  it("composes both worker drains and the real gate command through terminal receipt evidence", async () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-dry-run-composed-"));
    roots.push(root);
    writeFileSync(join(root, "package.json"), readFileSync(join(process.cwd(), "package.json"), "utf8"));
    mkdirSync(join(root, rebuildRuntimeIsolation.stateRoot), { recursive: true });
    const clock = manualClock(new Date("2026-08-25T18:00:00.000Z"));
    const { sessions } = composedSessions(clock);
    const runtime = createProductionDryRunScenarioRuntime({
      isolation: rebuildRuntimeIsolation,
      repoRoot: root,
      env: {},
      clock,
      ids: sequentialIdFactory("e"),
      sessionFactory: sessions.factory,
      processId: 4242,
      write: () => undefined,
    });
    const scenarioCase = TEST_MANIFEST.cases[0];
    assert.ok(scenarioCase);

    const started = await runtime.start({
      manifest: TEST_MANIFEST,
      scenarioCase,
      canonicalInput: SeparationsKualiFinalizationCanonicalInput.parse(FINALIZATION_RUN_INPUT),
    });
    await runtime.drain(TEST_MANIFEST.workflow);
    await runtime.resolveGate({ manifest: TEST_MANIFEST, scenarioCase, runId: started.runId });
    await runtime.drain(TEST_MANIFEST.workflow);
    const evidence = await runtime.collectEvidence(started.runId) as {
      reachedNodeIds: readonly string[];
      checkpoints: readonly unknown[];
      gateResults: readonly unknown[];
      writeSafetyAfter: unknown;
      receipt: {
        result: string;
        confidence: string;
        verification: readonly { obligation: string; verdict: string; mandatory: boolean }[];
      };
      terminal: unknown;
    };

    assert.deepEqual(evidence.reachedNodeIds, [
      "job-summary", "name-search", "department-option", "comparison",
      "identity-approval", "approval", "finalize-kuali",
    ]);
    assert.deepEqual(evidence.checkpoints, scenarioCase.checkpoints);
    assert.deepEqual(evidence.gateResults, [
      { gate: "identity-approval", decision: "approved", resolvedBy: "local-operator" },
    ]);
    assert.deepEqual(evidence.writeSafetyAfter, { writeIntents: 0, writeAttempts: 0, durableOutbox: 0 });
    assert.deepEqual({ result: evidence.receipt.result, confidence: evidence.receipt.confidence }, {
      result: "partial",
      confidence: "unknown",
    });
    assert.deepEqual(evidence.receipt.verification.map(({ obligation, verdict, mandatory }) => ({
      obligation, verdict, mandatory,
    })), PREVIEW_RECEIPT_VERIFICATION);
    assert.deepEqual(evidence.terminal, {
      lifecycle: "done",
      resultSchema: "RunDryRunPreviewResultSchema",
      kind: "dry-run-preview",
      externalCommit: "none",
      stoppedAtNodeId: "finalize-kuali",
      preview: { outcome: "would-prepare", subject: "match", staged: true },
    });
  });

  it("derives transaction reach and EID-safe failure evidence from every durable worker sink", async () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-dry-run-failed-"));
    roots.push(root);
    writeFileSync(join(root, "package.json"), readFileSync(join(process.cwd(), "package.json"), "utf8"));
    const stateRoot = join(root, rebuildRuntimeIsolation.stateRoot);
    mkdirSync(stateRoot, { recursive: true });
    const clock = manualClock(new Date("2026-08-25T18:00:00.000Z"));
    const { sessions } = composedSessions(clock, FINALIZATION_OTHER_EID);
    const lines: string[] = [];
    const runtime = createProductionDryRunScenarioRuntime({
      isolation: rebuildRuntimeIsolation,
      repoRoot: root,
      env: {},
      clock,
      ids: sequentialIdFactory("a"),
      sessionFactory: sessions.factory,
      processId: 4243,
      write: (line) => lines.push(line),
    });
    const scenarioCase = FAILED_TEST_MANIFEST.cases[0];
    assert.ok(scenarioCase);

    const started = await runtime.start({
      manifest: FAILED_TEST_MANIFEST,
      scenarioCase,
      canonicalInput: SeparationsKualiFinalizationCanonicalInput.parse(FINALIZATION_RUN_INPUT),
    });
    await runtime.drain(FAILED_TEST_MANIFEST.workflow);
    await runtime.resolveGate({
      manifest: FAILED_TEST_MANIFEST,
      scenarioCase,
      runId: started.runId,
    });
    await runtime.drain(FAILED_TEST_MANIFEST.workflow);
    const evidence = await runtime.collectEvidence(started.runId) as {
      reachedNodeIds: readonly string[];
      terminal: unknown;
    };

    assert.deepEqual(evidence.reachedNodeIds, [
      "job-summary", "name-search", "department-option", "comparison",
      "identity-approval", "approval", "finalize-kuali",
    ]);
    assert.deepEqual(evidence.terminal, {
      lifecycle: "failed",
      code: "UNHANDLED",
      node: "finalize-kuali",
      fingerprint: "2459ee6496de1582e97ff1e4a5c647ec91358201f9960b2f602968efd7d29625",
    });

    const database = AuthorityDatabase.open(
      { path: join(stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "dry-run-failed-query" },
      clock,
    );
    const run = database.authority.runs.get(started.runId);
    assert.ok(run?.lifecycle.state === "terminal" && run.lifecycle.failureId !== undefined);
    const failure = database.authority.failures.get(run.lifecycle.failureId);
    const receipt = database.authority.evidenceReceipts.findByRun(started.runId);
    database.close();
    assert.ok(failure);
    assert.ok(receipt);
    assert.match(failure.summary, /subject observation.*real write would refuse to fence/iu);

    const spanText = readdirSync(join(stateRoot, "spans"))
      .map((file) => readFileSync(join(stateRoot, "spans", file), "utf8"))
      .join("\n");
    for (const sink of [JSON.stringify(failure), JSON.stringify(receipt), spanText, lines.join("\n")]) {
      assert.doesNotMatch(sink, new RegExp(FINALIZATION_EID));
      assert.doesNotMatch(sink, new RegExp(FINALIZATION_OTHER_EID));
      assert.doesNotMatch(sink, new RegExp(`…${FINALIZATION_EID.slice(-4)}`));
      assert.doesNotMatch(sink, new RegExp(`…${FINALIZATION_OTHER_EID.slice(-4)}`));
    }
  });

  it("refuses a descriptor whose graph has no dry-run transaction arm", async () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-dry-run-unsupported-"));
    roots.push(root);
    writeFileSync(join(root, "package.json"), readFileSync(join(process.cwd(), "package.json"), "utf8"));
    const stateRoot = join(root, rebuildRuntimeIsolation.stateRoot);
    mkdirSync(stateRoot, { recursive: true });
    const clock = manualClock(new Date("2026-08-25T18:00:00.000Z"));
    const database = AuthorityDatabase.open(
      { path: join(stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "dry-run-unsupported-test" },
      clock,
    );
    database.close();
    const unsupported = parseDryRunScenarioManifest({
      ...TEST_MANIFEST,
      scenarioId: "person-lookup/dry-run",
      workflow: "person-lookup",
      transactionNode: "not-a-transaction",
    });
    const scenarioCase = unsupported.cases[0];
    if (scenarioCase === undefined) throw new Error("unsupported fixture has no case");
    const runtime = createProductionDryRunScenarioRuntime({
      isolation: rebuildRuntimeIsolation,
      repoRoot: root,
      env: {},
      clock,
      ids: sequentialIdFactory("u"),
      drainWorker: () => Promise.reject(new Error("unsupported workflow must not drain")),
    });

    await assert.rejects(
      runtime.start({ manifest: unsupported, scenarioCase, canonicalInput: {} }),
      /dry-run workflow person-lookup is unsupported: no-transaction-node/,
    );
  });
});
