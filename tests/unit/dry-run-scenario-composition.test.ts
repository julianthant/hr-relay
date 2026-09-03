import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../src/config/runtime-isolation.js";
import { manualClock, type TestClock } from "../../src/domain/clock.js";
import { selectedSettingsFixture as sharedSettingsFixture, startEffects } from "./fixtures/dry-run-admission-fixtures.js";
import { UcpathJobSummaryReadSchema } from "../../src/domain/ui/ucpath-job-summary.js";
import { parseDryRunScenarioManifest } from "../../src/domain/trust/dry-run-scenario.js";
import { WorkflowIdSchema } from "../../src/domain/ids.js";
import { TEST_TARGET_REGISTRY } from "../../src/control/test-target-registry.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import {
  composeDryRunScenarioCommand,
  resolveDryRunScenarioTarget,
} from "../../src/server/dry-run-scenario/compose.js";
import { loadDryRunScenarioManifest } from "../../src/server/dry-run-scenario/manifests.js";
import { createProductionDryRunScenarioRuntime } from "../../src/server/dry-run-scenario/runtime.js";
import { createDeterministicKualiDriver, createKualiFakeWorld } from "../../src/stores/kuali/driver/fake.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../src/stores/ucpath/driver/fake.js";
import {
  createDeterministicUcpathSmartHrWorldDriver,
  createUcpathSmartHrFakeWorld,
} from "../../src/stores/ucpath/driver/smart-hr-fake.js";
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
import { fixtureDuoCeremonyGates } from "./fixtures/duo-ceremony-fixtures.js";

const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

function selectedSettingsFixture(root: string, clock: TestClock, env: NodeJS.ProcessEnv = {}) {
  return sharedSettingsFixture(root, clock, env, databases);
}

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
  const filingWorld = createUcpathSmartHrFakeWorld({
    emplId: FINALIZATION_EID,
    displayedName: "Deterministic Person",
    nextTransactionId: FINALIZATION_RUN_INPUT.transactionNumber,
    rows: [{
      transactionId: FINALIZATION_RUN_INPUT.transactionNumber,
      emplId: FINALIZATION_EID,
      action: "TER",
      approvalStatus: "Pending",
      startDate: FINALIZATION_RUN_INPUT.terminationEffectiveDate,
      displayedName: "Deterministic Person",
    }],
  });
  const sessions = sessionFactoryHarness({
    ucpath: () => {
      const person = createDeterministicUcpathPersonOrgDriver({
        results: [candidate],
        selection: { status: "resolved", selected: candidate, candidateEids: [FINALIZATION_EID] },
      }, UcpathJobSummaryReadSchema.parse({
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
      }));
      const filing = createDeterministicUcpathSmartHrWorldDriver(filingWorld, () => clock.now());
      return {
        ...person,
        scanTerminationTransactions: filing.scanTerminationTransactions,
        stageTermination: filing.stageTermination,
        stagePendingTerminationSweep: filing.stagePendingTerminationSweep,
        commit: filing.commit,
      };
    },
    kuali: () => createDeterministicKualiDriver(world, clock),
  });
  return { sessions, world, filingWorld };
}

const PREVIEW_RECEIPT_VERIFICATION = [
  { obligation: "node.job-summary", verdict: "verified", mandatory: false },
  { obligation: "node.name-search", verdict: "verified", mandatory: false },
  { obligation: "node.department-option", verdict: "verified", mandatory: true },
  { obligation: "node.comparison", verdict: "verified", mandatory: false },
  { obligation: "node.identity-approval", verdict: "verified", mandatory: false },
  { obligation: "node.approval", verdict: "verified", mandatory: true },
  { obligation: "node.filing-presence", verdict: "verified", mandatory: false },
  { obligation: "node.finalize-kuali", verdict: "unknown", mandatory: true },
  { obligation: "completion.terminal-result", verdict: "unknown", mandatory: true },
  { obligation: "write.timekeeper-matches-request", verdict: "unknown", mandatory: true },
  { obligation: "identity.eid-agrees-across-sources", verdict: "unknown", mandatory: true },
  { obligation: "write.document-matches-request", verdict: "unknown", mandatory: true },
  { obligation: "write.transaction-matches-request", verdict: "unknown", mandatory: true },
  { obligation: "write.proof-is-a-read-back", verdict: "absent", mandatory: true },
] as const;

const NAME_ONLY_FINALIZATION_INPUT = SeparationsKualiFinalizationCanonicalInput.parse({
  ...FINALIZATION_RUN_INPUT,
  emplIdSource: "name-resolved",
  documentEid: { state: "absent", reason: "name-only composition fixture" },
});

const TEST_MANIFEST = parseDryRunScenarioManifest({
  scenarioId: "separations-kuali-finalization/dry-run",
  workflow: "separations-kuali-finalization",
  arm: "dry-run-preview",
  transactionNode: "finalize-kuali",
  recordedBy: "unit composition fixture",
  cases: [{
    caseId: "ordinary",
    subjectLabel: "finalization-canary",
    subjectKind: "ordinary",
    why: "the composition fixture exercises the ordinary declaration",
    nodesReached: [
      "job-summary", "name-search", "department-option", "comparison",
      "identity-approval", "approval", "filing-presence", "finalize-kuali",
    ],
    nodesExcluded: [],
    checkpoints: ["job-summary", "name-search", "department-option", "comparison", "approval", "filing-presence"].map((node) => ({
      node,
      attempt: 1,
      keyedBy: ["workflow", "item", "node", "attempt", "claimGeneration"],
    })),
    gateResults: [{ gate: "identity-approval", decision: "approved", resolvedBy: "local-operator" }],
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
    // The failed-terminal arm. It is the SAME subject — D284 left exactly one —
    // and this fixture never reaches the registry: it drives
    // `createProductionDryRunScenarioRuntime` directly to pin how a failed run
    // is recorded, so what varies here is the terminal, not the subject.
    caseId: "failed-run",
    subjectLabel: "finalization-canary",
    subjectKind: "ordinary",
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

function admissionFixture(env: NodeJS.ProcessEnv = {}) {
  const root = mkdtempSync(join(tmpdir(), "hrauto-dry-run-admission-"));
  roots.push(root);
  mkdirSync(join(root, rebuildRuntimeIsolation.stateRoot), { recursive: true });
  writeFileSync(join(root, "package.json"), readFileSync(join(process.cwd(), "package.json"), "utf8"));
  const clock = manualClock(new Date("2026-08-25T18:00:00.000Z"));
  const settings = selectedSettingsFixture(root, clock, env);
  const scenarioCase = TEST_MANIFEST.cases[0];
  assert.ok(scenarioCase);
  const runtime = createProductionDryRunScenarioRuntime({
    isolation: rebuildRuntimeIsolation, repoRoot: root, env, clock,
    ids: sequentialIdFactory("d"),
    drainWorker: () => Promise.reject(new Error("admission proof must not drain a worker")),
  });
  return {
    root, clock, ...settings, runtime,
    request: {
      manifest: TEST_MANIFEST, scenarioCase,
      canonicalInput: NAME_ONLY_FINALIZATION_INPUT,
    },
  };
}


/**
 * The composed chain's manifest, on the ONE registry subject D284 left: enough
 * to prove `resolveTarget` dispatched to the CHAIN resolver — and reached
 * `createRuntime` with the chain's own canonical input — rather than refusing
 * the workflow or crossing into the finalization arm.
 */
const CHAIN_READY_MANIFEST = parseDryRunScenarioManifest({
  scenarioId: "separations/dry-run",
  workflow: "separations",
  arm: "dry-run-preview",
  transactionNode: "clear-pending",
  recordedBy: "unit composition fixture",
  cases: [{
    caseId: "full-chain-dry-run",
    subjectLabel: "finalization-canary",
    subjectKind: "full-chain-dry-run",
    why: "the composition fixture exercises the chain's ready arm",
    nodesReached: ["resolve-action", "clear-pending"],
    nodesExcluded: ["finalize-kuali"],
    checkpoints: [],
    gateResults: [],
    durableDeltas: { writeIntents: 0, writeAttempts: 0, durableOutbox: 0 },
    receipt: {
      result: "partial",
      confidence: "unknown",
      verification: [{ obligation: "completion.terminal-result", verdict: "unknown", mandatory: true }],
    },
    terminal: {
      lifecycle: "done",
      resultSchema: "RunDryRunPreviewResultSchema",
      kind: "dry-run-preview",
      externalCommit: "none",
      stoppedAtNodeId: "clear-pending",
    },
    preview: { outcome: "already-present", proofSource: "live-probe" },
  }],
});

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
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

  it("starts through the real start-plan service with the activated nondefault Settings snapshot", async () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-dry-run-start-"));
    roots.push(root);
    writeFileSync(
      join(root, "package.json"),
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    );
    const stateRoot = join(root, rebuildRuntimeIsolation.stateRoot);
    mkdirSync(stateRoot, { recursive: true });
    const clock = manualClock(new Date("2026-08-25T18:00:00.000Z"));
    const settings = selectedSettingsFixture(root, clock);
    const record = settings.apply({ browser: { headless: false }, concurrency: { defaultWorkers: 3 } });
    const { active, snapshot } = settings.activate();
    const snapshotsBefore = startEffects(settings.path).find(({ table }) => table === "config_snapshots");
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
      transactionApprovalStatus: "Pending",
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
      assert.equal(run?.envelope.configFingerprint, active.configFingerprint);
      assert.equal(run?.envelope.configSnapshotId, active.configSnapshotId);
      assert.equal(record.revision, 2);
      assert.equal(snapshot?.config.browser.headless, false);
      assert.equal(snapshot?.config.concurrency.defaultWorkers, 3);
      assert.deepEqual(database.authority.configSnapshots.get(active.configSnapshotId), snapshot);
      assert.deepEqual(startEffects(settings.path).find(({ table }) => table === "config_snapshots"), snapshotsBefore);
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
    const spanText = readdirSync(join(stateRoot, "spans"))
      .map((file) => readFileSync(join(stateRoot, "spans", file), "utf8"))
      .join("\n");
    const runEvents = spanText.trim().split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((event) => event.runId === started.runId);
    assert.equal(runEvents.length, 1);
    assert.equal(runEvents[0]?.t, "run.queued");
    assert.equal(runEvents[0]?.kind, "run");
    assert.equal(runEvents[0]?.runId, started.runId);
    assert.equal(runEvents[0]?.traceId, started.traceId);
    assert.equal(runEvents[0]?.spanPath, started.traceId);
    assert.equal(runEvents[0]?.actorId, "local-operator");
    assert.equal(runEvents[0]?.dryRun, true);
    assert.equal(runEvents[0]?.configFingerprint, active.configFingerprint);
    assert.equal(runEvents[0]?.configSnapshotId, active.configSnapshotId);
  });

  it("refuses absent activation before any start effects while allowing virgin Settings initialization", async () => {
    const fixture = admissionFixture();
    const before = startEffects(fixture.path);
    await assert.rejects(fixture.runtime.start(fixture.request), /runtime config has no dashboard-activated generation/);
    assert.deepEqual(startEffects(fixture.path), before);
    assert.equal(fixture.database.authority.runtimeConfig.get(), undefined);
    assert.equal(fixture.file.read().revision, 1);
    const initialization: unknown = JSON.parse(readFileSync(join(fixture.root, "config", "settings.json.authority.json"), "utf8"));
    assert.ok(typeof initialization === "object" && initialization !== null && "state" in initialization);
    assert.equal(initialization.state, "virgin");
    await assert.rejects(fixture.runtime.collectEvidence("11111111-1111-4111-8111-111111111111"),
      /dry-run evidence collection ran before start/);
  });

  it("refuses journaled Settings newer than activation without rewriting an admitted run", async () => {
    const fixture = admissionFixture();
    fixture.apply({ browser: { headless: false } });
    const { active } = fixture.activate();
    const admitted = await fixture.runtime.start(fixture.request);
    const run = fixture.database.authority.runs.get(admitted.runId);
    const changed = fixture.apply({ concurrency: { defaultWorkers: 3 } });
    assert.equal(changed.revision, 3);
    const before = startEffects(fixture.path);
    const bytes = readFileSync(join(fixture.root, "config", "settings.json"));
    const current = fixture.database.authority.settingsCurrent.get();
    await assert.rejects(fixture.runtime.start(fixture.request), /settings revision 3 .*not dashboard-active; restart activation is required/);
    assert.deepEqual(startEffects(fixture.path), before);
    assert.deepEqual(fixture.database.authority.runs.get(admitted.runId), run);
    assert.deepEqual(fixture.database.authority.runtimeConfig.get(), active);
    assert.deepEqual(fixture.database.authority.settingsCurrent.get(), current);
    assert.deepEqual(readFileSync(join(fixture.root, "config", "settings.json")), bytes);
    await assert.rejects(fixture.runtime.collectEvidence(admitted.runId), /dry-run evidence collection ran before start/);
  });

  it("refuses an environment divergent from activation before any start effects", async () => {
    const env: NodeJS.ProcessEnv = {};
    const fixture = admissionFixture(env);
    fixture.apply({ concurrency: { defaultWorkers: 3 } });
    const { active } = fixture.activate();
    env["HRAUTO_DEFAULT_WORKERS"] = "5";
    const before = startEffects(fixture.path);
    const bytes = readFileSync(join(fixture.root, "config", "settings.json"));
    await assert.rejects(fixture.runtime.start(fixture.request), /not dashboard-active; restart activation is required/);
    assert.deepEqual(startEffects(fixture.path), before);
    assert.deepEqual(fixture.database.authority.runtimeConfig.get(), active);
    assert.deepEqual(readFileSync(join(fixture.root, "config", "settings.json")), bytes);
  });

  it("refuses gate resolution with lost config identity after a subsequent start admission failure", async () => {
    const env: NodeJS.ProcessEnv = {};
    const fixture = admissionFixture(env);
    const record = fixture.apply({ concurrency: { defaultWorkers: 3 } });
    const { active, snapshot } = fixture.activate();
    const { sessions } = composedSessions(fixture.clock);
    const runtime = createProductionDryRunScenarioRuntime({
      isolation: rebuildRuntimeIsolation, repoRoot: fixture.root, env, clock: fixture.clock,
      ids: sequentialIdFactory("e"),
      sessionFactory: sessions.factory,
      duoCeremony: fixtureDuoCeremonyGates(fixture.clock),
      processId: 4244,
      processIdentityObserver: (pid) => ({
        state: "alive",
        identity: { platform: "darwin", startToken: `synthetic-${String(pid)}` },
      }),
      write: () => undefined,
    });
    const started = await runtime.start(fixture.request);
    await runtime.drain(TEST_MANIFEST.workflow);
    const parked = fixture.database.authority.runs.get(started.runId);
    assert.ok(parked);
    assert.equal(parked.lifecycle.state, "parked-gate");
    assert.equal(parked.lifecycle.gateId, "identity-approval");
    assert.equal(parked.envelope.configSnapshotId, active.configSnapshotId);
    assert.equal(parked.envelope.configFingerprint, active.configFingerprint);
    const comparison = fixture.database.authority.runCheckpoints.latest(
      parked.envelope.workflow, parked.envelope.itemId, "comparison",
    );
    assert.equal(comparison?.runId, started.runId);
    const gateResults = fixture.database.authority.gateResults.listByRun(started.runId);
    assert.deepEqual(gateResults, []);
    const before = startEffects(fixture.path);
    const settingsBytes = readFileSync(join(fixture.root, "config", "settings.json"));
    const durableCurrent = fixture.database.authority.settingsCurrent.get();

    // Only this process's next resolution changes. The parked run's Settings,
    // active generation and retained snapshot remain valid for its old gate.
    env["HRAUTO_DEFAULT_WORKERS"] = "5";
    await assert.rejects(runtime.start(fixture.request), /not dashboard-active; restart activation is required/);
    assert.deepEqual(startEffects(fixture.path), before);
    assert.deepEqual(fixture.database.authority.settingsCurrent.get(), durableCurrent);
    assert.deepEqual(fixture.database.authority.runtimeConfig.get(), active);
    assert.deepEqual(fixture.database.authority.configSnapshots.get(active.configSnapshotId), snapshot);
    assert.deepEqual(readFileSync(join(fixture.root, "config", "settings.json")), settingsBytes);
    fixture.database.withAuthorityTransaction((repositories) => repositories.runtimeConfig.requireActive({
      settingsRevision: record.revision,
      settingsFingerprint: record.settingsFingerprint,
      configFingerprint: active.configFingerprint,
    }));
    await assert.rejects(runtime.collectEvidence(started.runId), /dry-run evidence collection ran before start/);
    await assert.rejects(runtime.resolveGate({
      manifest: TEST_MANIFEST, scenarioCase: fixture.request.scenarioCase, runId: started.runId,
    }), /dry-run gate resolution lost its start config identity/);

    assert.deepEqual(fixture.database.authority.runs.get(started.runId), parked);
    assert.deepEqual(fixture.database.authority.gateResults.listByRun(started.runId), gateResults);
    assert.deepEqual(fixture.database.authority.runCheckpoints.latest(
      parked.envelope.workflow, parked.envelope.itemId, "comparison",
    ), comparison);
    assert.deepEqual(startEffects(fixture.path), before);
    assert.deepEqual(fixture.database.authority.settingsCurrent.get(), durableCurrent);
    assert.deepEqual(fixture.database.authority.runtimeConfig.get(), active);
    assert.deepEqual(readFileSync(join(fixture.root, "config", "settings.json")), settingsBytes);
  });

  it("retains exact environment precedence in the existing activated snapshot", async () => {
    const fixture = admissionFixture({ HRAUTO_DEFAULT_WORKERS: "5" });
    const record = fixture.apply({ browser: { headless: false }, concurrency: { defaultWorkers: 3 } });
    const { active, snapshot } = fixture.activate();
    assert.equal(record.settings.concurrency?.defaultWorkers, 3);
    assert.equal(snapshot?.config.concurrency.defaultWorkers, 5);
    assert.equal(snapshot?.config.browser.headless, false);
    assert.equal(snapshot?.provenance["concurrency.defaultWorkers"], "env");
    assert.equal(snapshot?.provenance["browser.headless"], "settings");
    const before = startEffects(fixture.path).find(({ table }) => table === "config_snapshots");
    const started = await fixture.runtime.start(fixture.request);
    const run = fixture.database.authority.runs.get(started.runId);
    assert.equal(run?.envelope.configSnapshotId, active.configSnapshotId);
    assert.equal(run?.envelope.configFingerprint, active.configFingerprint);
    assert.deepEqual(fixture.database.authority.configSnapshots.get(active.configSnapshotId), snapshot);
    assert.deepEqual(startEffects(fixture.path).find(({ table }) => table === "config_snapshots"), before);
  });

  it("refuses Settings file replacement after the initial journal read before any start effects", async () => {
    const fixture = admissionFixture();
    const prior = fixture.apply({ browser: { headless: false } });
    const settingsPath = join(fixture.root, "config", "settings.json");
    const priorBytes = readFileSync(settingsPath);
    const current = fixture.apply({ concurrency: { defaultWorkers: 3 } });
    const currentBytes = readFileSync(settingsPath);
    const { active, snapshot } = fixture.activate();
    const durableCurrent = fixture.database.authority.settingsCurrent.get();
    const initialization = readFileSync(`${settingsPath}.authority.json`);
    const evidenceNames = readdirSync(join(fixture.root, "config")).sort();
    const before = startEffects(fixture.path);
    const fiscalYear = fixture.clock.fiscalYear.bind(fixture.clock);
    let replaced = false;
    try {
      fixture.clock.fiscalYear = (at) => {
        // One real resolver boundary, after journal reconciliation but before
        // final admission. Only file bytes move: SQLite still owns revision 3.
        fixture.clock.fiscalYear = fiscalYear;
        assert.deepEqual(readFileSync(settingsPath), currentBytes);
        assert.deepEqual(fixture.file.read(), current);
        assert.deepEqual(fixture.database.authority.settingsCurrent.get(), durableCurrent);
        assert.deepEqual(startEffects(fixture.path), before);
        writeFileSync(settingsPath, priorBytes);
        replaced = true;
        return fiscalYear(at);
      };

      await assert.rejects(fixture.runtime.start(fixture.request),
        /settings changed after worker boot; restart activation is required .*boot revision 3 .*current revision 2/);
      assert.equal(replaced, true);
      assert.equal(prior.revision, 2);
      assert.equal(current.revision, 3);
      assert.deepEqual(readFileSync(settingsPath), priorBytes);
      assert.deepEqual(fixture.file.read(), prior);
      assert.deepEqual(fixture.database.authority.settingsCurrent.get(), durableCurrent);
      assert.deepEqual(fixture.database.authority.runtimeConfig.get(), active);
      assert.deepEqual(fixture.database.authority.configSnapshots.get(active.configSnapshotId), snapshot);
      assert.deepEqual(startEffects(fixture.path), before);
      assert.deepEqual(readFileSync(`${settingsPath}.authority.json`), initialization);
      assert.deepEqual(readdirSync(join(fixture.root, "config")).sort(), evidenceNames);
    } finally {
      fixture.clock.fiscalYear = fiscalYear;
    }
  });

  it("refuses a missing activated snapshot before any start effects", async () => {
    const fixture = admissionFixture();
    fixture.apply({ browser: { headless: false } });
    const { active } = fixture.activate();
    const raw = new DatabaseSync(fixture.path);
    const fiscalYear = fixture.clock.fiscalYear.bind(fixture.clock);
    let before: ReturnType<typeof startEffects> | undefined;
    try {
      // The resolver's existing clock edge runs after open-time FK validation
      // and the first Settings read, before final admission. Model row loss
      // there, rather than weakening the legitimate open-time corruption check.
      raw.exec("PRAGMA foreign_keys = OFF");
      fixture.clock.fiscalYear = (at) => {
        raw.prepare("DELETE FROM config_snapshots WHERE record_key = ?").run(active.configSnapshotId);
        before = startEffects(fixture.path);
        return fiscalYear(at);
      };
      await assert.rejects(fixture.runtime.start(fixture.request), /active runtime config generation 1 does not bind exact snapshot/);
      assert.ok(before !== undefined, "the real resolver reached the row-loss boundary");
      assert.deepEqual(startEffects(fixture.path), before);
      assert.deepEqual(fixture.database.authority.runtimeConfig.get(), active);
    } finally {
      fixture.clock.fiscalYear = fiscalYear;
      raw.close();
    }
  });

  it("refuses a mismatched activated snapshot before any start effects", async () => {
    const fixture = admissionFixture();
    fixture.apply({ browser: { headless: false } });
    const { active } = fixture.activate();
    const raw = new DatabaseSync(fixture.path);
    try {
      raw.prepare("UPDATE config_snapshots SET record_json = json_set(record_json, '$.fingerprint', ?) WHERE record_key = ?")
        .run("f".repeat(64), active.configSnapshotId);
    } finally {
      raw.close();
    }
    const before = startEffects(fixture.path);
    await assert.rejects(fixture.runtime.start(fixture.request), /active runtime config generation 1 does not bind exact snapshot/);
    assert.deepEqual(startEffects(fixture.path), before);
    assert.deepEqual(fixture.database.authority.runtimeConfig.get(), active);
  });

  it("rolls back outer start commit failure without publishing a scenario identity", async () => {
    const fixture = admissionFixture();
    fixture.apply({ browser: { headless: false } });
    const { active } = fixture.activate();
    const before = startEffects(fixture.path);
    const settingsBytes = readFileSync(join(fixture.root, "config", "settings.json"));
    const raw = new DatabaseSync(fixture.path);
    try {
      // A real SQLite failure at the outer commit's metadata write, after the
      // start audit exists. No transaction counts or mocked kernel are involved.
      raw.exec(`CREATE TRIGGER refuse_start_commit BEFORE UPDATE ON authority_meta
        WHEN EXISTS (SELECT 1 FROM command_audits WHERE json_extract(record_json, '$.request.family') = 'start')
        BEGIN SELECT RAISE(ABORT, 'synthetic outer start commit refusal'); END`);
      await assert.rejects(fixture.runtime.start(fixture.request), /synthetic outer start commit refusal/);
      assert.deepEqual(startEffects(fixture.path), before);
      assert.deepEqual(fixture.database.authority.runtimeConfig.get(), active);
      assert.deepEqual(readFileSync(join(fixture.root, "config", "settings.json")), settingsBytes);
      await assert.rejects(fixture.runtime.collectEvidence("11111111-1111-4111-8111-111111111111"),
        /dry-run evidence collection ran before start/);
      raw.exec("DROP TRIGGER refuse_start_commit");
      const started = await fixture.runtime.start(fixture.request);
      const run = fixture.database.authority.runs.get(started.runId);
      assert.equal(run?.envelope.configSnapshotId, active.configSnapshotId);
      assert.equal(run?.envelope.configFingerprint, active.configFingerprint);
    } finally {
      raw.close();
    }
  });

  it("composes both worker drains and the real gate command through terminal receipt evidence", async () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-dry-run-composed-"));
    roots.push(root);
    writeFileSync(join(root, "package.json"), readFileSync(join(process.cwd(), "package.json"), "utf8"));
    mkdirSync(join(root, rebuildRuntimeIsolation.stateRoot), { recursive: true });
    const clock = manualClock(new Date("2026-08-25T18:00:00.000Z"));
    const { sessions } = composedSessions(clock);
    selectedSettingsFixture(root, clock).activate();
    const runtime = createProductionDryRunScenarioRuntime({
      isolation: rebuildRuntimeIsolation,
      repoRoot: root,
      env: {},
      clock,
      ids: sequentialIdFactory("e"),
      sessionFactory: sessions.factory,
      duoCeremony: fixtureDuoCeremonyGates(clock),
      processId: 4242,
      processIdentityObserver: (pid) => ({
        state: "alive",
        identity: { platform: "darwin", startToken: `synthetic-${String(pid)}` },
      }),
      write: () => undefined,
    });
    const scenarioCase = TEST_MANIFEST.cases[0];
    assert.ok(scenarioCase);

    const started = await runtime.start({
      manifest: TEST_MANIFEST,
      scenarioCase,
      canonicalInput: NAME_ONLY_FINALIZATION_INPUT,
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
      "identity-approval", "approval", "filing-presence", "finalize-kuali",
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

  it("refuses a deleted UCPath filing after the real gate and before any Kuali prepare, fence, or click", async () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-dry-run-deleted-filing-"));
    roots.push(root);
    writeFileSync(join(root, "package.json"), readFileSync(join(process.cwd(), "package.json"), "utf8"));
    mkdirSync(join(root, rebuildRuntimeIsolation.stateRoot), { recursive: true });
    const clock = manualClock(new Date("2026-08-25T18:00:00.000Z"));
    const settings = selectedSettingsFixture(root, clock);
    const { sessions, world, filingWorld } = composedSessions(clock);
    settings.activate();
    const runtime = createProductionDryRunScenarioRuntime({
      isolation: rebuildRuntimeIsolation,
      repoRoot: root,
      env: {},
      clock,
      ids: sequentialIdFactory("f"),
      sessionFactory: sessions.factory,
      duoCeremony: fixtureDuoCeremonyGates(clock),
      processId: 4244,
      processIdentityObserver: (pid) => ({
        state: "alive",
        identity: { platform: "darwin", startToken: `synthetic-${String(pid)}` },
      }),
      write: () => undefined,
    });
    const scenarioCase = TEST_MANIFEST.cases[0];
    assert.ok(scenarioCase);

    const started = await runtime.start({
      manifest: TEST_MANIFEST,
      scenarioCase,
      canonicalInput: NAME_ONLY_FINALIZATION_INPUT,
    });
    await runtime.drain(TEST_MANIFEST.workflow);
    // Migration §9.36's diagnostic, reproduced at the supported seam: the
    // durable/asserted receipt survives, but its exact UCPath row disappears
    // between identity settlement and the fresh finalization precondition.
    filingWorld.rows = [];
    await runtime.resolveGate({ manifest: TEST_MANIFEST, scenarioCase, runId: started.runId });
    await runtime.drain(TEST_MANIFEST.workflow);

    const run = settings.database.authority.runs.get(started.runId);
    assert.ok(run?.lifecycle.state === "terminal" && run.lifecycle.failureId !== undefined);
    const failure = settings.database.authority.failures.get(run.lifecycle.failureId);
    assert.equal(failure?.nodeId, "filing-presence");
    assert.equal(failure?.taskId, "ucpath/verify-termination-filing-present");
    assert.equal(failure?.code, "FILING_NOT_CURRENT");
    assert.match(failure?.summary ?? "", /exact durable UCPath filing transaction is absent/iu);
    assert.equal(world.persistedFinalization, undefined);
    assert.equal(world.events.some((event) => event.startsWith("stage-finalization:")), false);

    const raw = new DatabaseSync(settings.path, { readOnly: true });
    try {
      assert.deepEqual({
        intents: raw.prepare("SELECT count(*) AS n FROM write_intents").get()?.n,
        attempts: raw.prepare("SELECT count(*) AS n FROM write_attempts").get()?.n,
        outbox: raw.prepare("SELECT count(*) AS n FROM durable_outbox").get()?.n,
      }, { intents: 0, attempts: 0, outbox: 0 });
    } finally {
      raw.close();
    }
  });

  it("derives transaction reach and EID-safe failure evidence from every durable worker sink", async () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-dry-run-failed-"));
    roots.push(root);
    writeFileSync(join(root, "package.json"), readFileSync(join(process.cwd(), "package.json"), "utf8"));
    const stateRoot = join(root, rebuildRuntimeIsolation.stateRoot);
    mkdirSync(stateRoot, { recursive: true });
    const clock = manualClock(new Date("2026-08-25T18:00:00.000Z"));
    const malformedObservation = `EID ${FINALIZATION_OTHER_EID}`;
    const { sessions } = composedSessions(clock, malformedObservation);
    selectedSettingsFixture(root, clock).activate();
    const lines: string[] = [];
    const runtime = createProductionDryRunScenarioRuntime({
      isolation: rebuildRuntimeIsolation,
      repoRoot: root,
      env: {},
      clock,
      ids: sequentialIdFactory("a"),
      sessionFactory: sessions.factory,
      duoCeremony: fixtureDuoCeremonyGates(clock),
      processId: 4243,
      processIdentityObserver: (pid) => ({
        state: "alive",
        identity: { platform: "darwin", startToken: `synthetic-${String(pid)}` },
      }),
      write: (line) => lines.push(line),
    });
    const scenarioCase = FAILED_TEST_MANIFEST.cases[0];
    assert.ok(scenarioCase);

    const started = await runtime.start({
      manifest: FAILED_TEST_MANIFEST,
      scenarioCase,
      canonicalInput: NAME_ONLY_FINALIZATION_INPUT,
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
      "identity-approval", "approval", "filing-presence", "finalize-kuali",
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
      assert.doesNotMatch(sink, new RegExp(malformedObservation));
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
      /dry-run-preview manifest person-lookup\/dry-run names workflow person-lookup, whose compiled graph has no transaction node; a transaction-free graph must declare the live-read arm \(D318\) — D209 still refuses dryRun for it \(no-transaction-node\)/,
    );
  });
});

describe("dry-run scenario target dispatch", () => {
  it("refuses a workflow no resolver claims by naming the workflow", () => {
    assert.throws(
      () => resolveDryRunScenarioTarget(
        TEST_TARGET_REGISTRY,
        { ...TEST_MANIFEST, workflow: WorkflowIdSchema.parse("i9-lookup") },
        "finalization-canary",
        {},
      ),
      /dry-run target resolution does not support workflow i9-lookup/,
    );
  });

  it("blocks the gone committed chain subject before createRuntime or environment use", async () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-dry-run-chain-gone-"));
    roots.push(root);
    mkdirSync(join(root, "config"), { recursive: true });
    writeFileSync(
      join(root, "config", "test-subjects.json"),
      readFileSync(join(process.cwd(), "config", "test-subjects.json"), "utf8"),
    );
    let runtimeFactories = 0;
    const forbiddenEnvironment = new Proxy(Object.create(null) as NodeJS.ProcessEnv, {
      get: () => {
        throw new Error("gone subject must block before its environment is read");
      },
    });

    const outcome = await composeDryRunScenarioCommand({
      isolation: rebuildRuntimeIsolation,
      args: ["separations", "--subject", "finalization-canary"],
      repoRoot: root,
      env: forbiddenEnvironment,
      clock: manualClock(new Date("2026-09-01T18:00:00.000Z")),
      ids: { uuid: () => "33333333-3333-4333-8333-333333333333" },
      loadManifest: () => Promise.resolve(CHAIN_READY_MANIFEST),
      createRuntime: () => {
        runtimeFactories += 1;
        throw new Error("gone subject must block before runtime composition");
      },
    });

    assert.equal(runtimeFactories, 0);
    assert.equal(outcome.exitCode, 2);
    assert.match(
      outcome.output,
      /^blocked: needs finalization-canary; registry says gone, last observed 2026-09-01\nresult: /,
    );
  });

  it("dispatches an available synthetic chain registry through createRuntime with its typed document number", async () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-dry-run-chain-ready-"));
    roots.push(root);
    mkdirSync(join(root, "config"), { recursive: true });
    // The committed canary is gone. This isolated registry fixture keeps the
    // available D300 path pinned: the closed environment reference still
    // reaches runtime composition as the descriptor's typed canonical input.
    const availableRegistry = {
      ...TEST_TARGET_REGISTRY,
      targets: TEST_TARGET_REGISTRY.targets.map((target) => target.label === "finalization-canary"
        ? {
          ...target,
          availability: {
            state: "available" as const,
            lastObserved: "2026-09-01",
            reason: "Synthetic ready registry fixture.",
          },
        }
        : target),
    };
    writeFileSync(join(root, "config", "test-subjects.json"), `${JSON.stringify(availableRegistry, null, 2)}\n`);
    let capturedCanonicalInput: unknown;

    await assert.rejects(
      composeDryRunScenarioCommand({
        isolation: rebuildRuntimeIsolation,
        args: ["separations", "--subject", "finalization-canary"],
        repoRoot: root,
        env: { HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER: "4537" },
        clock: manualClock(new Date("2026-09-01T18:00:00.000Z")),
        ids: { uuid: () => "33333333-3333-4333-8333-333333333333" },
        loadManifest: () => Promise.resolve(CHAIN_READY_MANIFEST),
        createRuntime: () => ({
          start: (startInput) => {
            capturedCanonicalInput = startInput.canonicalInput;
            return Promise.reject(new Error("stop the fixture runtime after capturing the ready dispatch"));
          },
          drain: () => Promise.reject(new Error("not reached")),
          resolveGate: () => Promise.resolve(),
          collectEvidence: () => Promise.reject(new Error("not reached")),
        }),
      }),
      /dry-run scenario failed before run identity was known/,
    );

    assert.deepEqual(capturedCanonicalInput, {
      documentNumber: "4537",
      timekeeperName: "Julian Zaw",
      searchTimeoutMs: 15_000,
    });
  });

  it("reports the committed chain subject's dated gone reason", async () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-dry-run-chain-unconfigured-"));
    roots.push(root);
    mkdirSync(join(root, "config"), { recursive: true });
    writeFileSync(
      join(root, "config", "test-subjects.json"),
      readFileSync(join(process.cwd(), "config", "test-subjects.json"), "utf8"),
    );
    let runtimeFactories = 0;

    const outcome = await composeDryRunScenarioCommand({
      isolation: rebuildRuntimeIsolation,
      args: ["separations", "--subject", "finalization-canary"],
      repoRoot: root,
      env: {},
      clock: manualClock(new Date("2026-09-01T18:00:00.000Z")),
      ids: { uuid: () => "44444444-4444-4444-8444-444444444444" },
      loadManifest: () => Promise.resolve(CHAIN_READY_MANIFEST),
      createRuntime: () => {
        runtimeFactories += 1;
        throw new Error("a gone subject must precede runtime composition");
      },
    });

    assert.equal(runtimeFactories, 0);
    assert.equal(outcome.exitCode, 2);
    assert.match(
      outcome.output,
      /^blocked: needs finalization-canary; registry says gone, last observed 2026-09-01\nresult: /,
    );
  });
});

describe("dry-run scenario manifest registry", () => {
  it("names exactly the registered workflows for an unknown workflow, even a prototype key", async () => {
    for (const workflow of ["constructor", "nope"]) {
      await assert.rejects(
        async () => loadDryRunScenarioManifest(workflow),
        new RegExp(
          `unknown dry-run scenario workflow ${workflow}; registered: person-lookup, separations, separations-kuali-finalization`,
        ),
      );
    }
  });
});
