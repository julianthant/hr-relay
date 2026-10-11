import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { resolveDryRunScenarioTarget } from "../../../../src/backend/app/dry-run/compose.js";
import { createProductionDryRunScenarioRuntime } from "../../../../src/backend/app/dry-run/runtime.js";
import { parseTestTargetRegistry } from "../../../../src/backend/app/registries/test-target-registry.js";
import { admitProtectedInput } from "../../../../src/backend/runs/start/protected-input.js";

import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { createDeterministicKualiDriver, createKualiFakeWorld } from "../../../../src/backend/systems/kuali/driver/fake.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../src/backend/systems/ucpath/driver/fake.js";
import { deriveJobRowFromCells } from "../../../../src/backend/systems/ucpath/driver/person-org-operation.js";
import { createDeterministicUcpathSmartHrWorldDriver, createUcpathSmartHrFakeWorld } from "../../../../src/backend/systems/ucpath/driver/smart-hr-fake.js";
import { ProtectedStoreRecordSchema } from "../../../../src/models/config/protected-settings.js";
import { parseDryRunScenarioManifest } from "../../../../src/models/trust/dry-run-scenario.js";
import { UcpathJobSummaryReadSchema } from "../../../../src/models/ui/ucpath-job-summary.js";
import { ProtectedInputBindingSchema } from "../../../../src/models/write-safety/protected-input.js";
import { manualClock, type TestClock } from "../../../../src/rules/time/clock.js";
import { SeparationsKualiFinalizationCanonicalInput } from "../../../../src/workflows/separations/steps/kuali-finalization/step.js";
import { selectedSettingsFixture as sharedSettingsFixture, startEffects } from "../../../support/fixtures/integration/dry-run-admission-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { healthyRuntimePreflightRunners } from "../../../support/fixtures/preflight-seams.js";
import { fixtureDuoCeremonyGates } from "../../../support/helpers/duo-ceremony-fixtures.js";
import { journalProtectedSettings } from "../../../support/helpers/integration/journaled-protected-settings.js";
import { FINALIZATION_ACTION_ID, FINALIZATION_DOCUMENT, FINALIZATION_EID, FINALIZATION_RUN_INPUT } from "../../../support/helpers/kuali-finalization-fixtures.js";
import { sessionFactoryHarness } from "../../../support/helpers/phase1f-executor-harness.js";
import { protectedSecretSource } from "../../../support/helpers/protected-secret-source.js";
import { separationsKualiFinalizationDescriptor } from "../../../support/helpers/registered-workflows.js";
import { AuthorityDatabase, createCredentialStore } from "../../../support/helpers/synthetic-storage-admission.js";
import { testDataInputSource } from "../../../support/helpers/test-data/test-data-source.js";

const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

function selectedSettingsFixture(
  root: string,
  clock: TestClock,
  env: NodeJS.ProcessEnv = {},
) {
  return sharedSettingsFixture(root, clock, env, databases);
}

function composedSessions(clock: TestClock, displayedEidAfterStage?: string) {
  const world = createKualiFakeWorld({
    actionId: FINALIZATION_ACTION_ID,
    documentNumber: FINALIZATION_DOCUMENT,
    displayedEid: FINALIZATION_EID,
  });
  if (displayedEidAfterStage !== undefined)
    world.displayedEidAfterStage = displayedEidAfterStage;
  const candidate = {
    emplId: FINALIZATION_EID,
    name: FINALIZATION_RUN_INPUT.employeeName,
    department: "Housing Dining Hospitality",
    jobTitle: "STDT 2",
    employeeStatus: "active" as const,
    hdh: true,
  };
  const jobRows = [
    deriveJobRowFromCells(
      [
        "0",
        "07/01/2025",
        "Active",
        "SDCMP",
        "40012345",
        "000412",
        "HOUSING/DINING/HOSPITALITY",
        "004921",
        "STDT 2",
        "",
        "0.500000",
        "Student",
      ],
      0,
    ),
  ];
  const filingWorld = createUcpathSmartHrFakeWorld({
    emplId: FINALIZATION_EID,
    displayedName: "Deterministic Person",
    nextTransactionId: FINALIZATION_RUN_INPUT.transactionNumber,
    rows: [
      {
        transactionId: FINALIZATION_RUN_INPUT.transactionNumber,
        emplId: FINALIZATION_EID,
        action: "TER",
        approvalStatus: "Pending",
        startDate: FINALIZATION_RUN_INPUT.terminationEffectiveDate,
        displayedName: "Deterministic Person",
      },
    ],
  });
  const sessions = sessionFactoryHarness({
    ucpath: () => {
      const person = createDeterministicUcpathPersonOrgDriver(
        {
          results: [candidate],
          selection: {
            status: "resolved",
            selected: candidate,
            candidateEids: [FINALIZATION_EID],
          },
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
      );
      const filing = createDeterministicUcpathSmartHrWorldDriver(
        filingWorld,
        () => clock.now(),
      );
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
  const factory = sessions.factory;
  return { sessions: { ...sessions, factory: { async open(input: Parameters<typeof factory.open>[0]) {
    const resource = await factory.open(input);
    return { ...resource, screenshot: () => Promise.resolve({ state: "unavailable" as const, reason: "verification-failed" as const, sessionId: resource.sessionId, pageVersion: 0, observedAt: clock.now().toISOString() }) };
  } } }, world, filingWorld };
}

const PREVIEW_RECEIPT_VERIFICATION = [
  { obligation: "node.job-summary", verdict: "verified", mandatory: false },
  { obligation: "node.name-search", verdict: "verified", mandatory: false },
  {
    obligation: "node.department-option",
    verdict: "verified",
    mandatory: true,
  },
  { obligation: "node.comparison", verdict: "verified", mandatory: false },
  {
    obligation: "node.identity-approval",
    verdict: "verified",
    mandatory: false,
  },
  { obligation: "node.approval", verdict: "verified", mandatory: true },
  { obligation: "node.filing-presence", verdict: "verified", mandatory: false },
  { obligation: "node.finalize-kuali", verdict: "unknown", mandatory: true },
  {
    obligation: "completion.terminal-result",
    verdict: "unknown",
    mandatory: true,
  },
  {
    obligation: "write.timekeeper-matches-request",
    verdict: "unknown",
    mandatory: true,
  },
  {
    obligation: "identity.eid-agrees-across-sources",
    verdict: "unknown",
    mandatory: true,
  },
  {
    obligation: "write.document-matches-request",
    verdict: "unknown",
    mandatory: true,
  },
  {
    obligation: "write.transaction-matches-request",
    verdict: "unknown",
    mandatory: true,
  },
  {
    obligation: "write.proof-is-a-read-back",
    verdict: "absent",
    mandatory: true,
  },
] as const;

const NAME_ONLY_FINALIZATION_INPUT =
  SeparationsKualiFinalizationCanonicalInput.parse({
    ...FINALIZATION_RUN_INPUT,
    emplIdSource: "name-resolved",
    documentEid: { state: "absent", reason: "name-only composition fixture" },
  });

function admittedFinalization(input: typeof NAME_ONLY_FINALIZATION_INPUT) {
  const source = protectedSecretSource({ timekeeperName: input.timekeeperName });
  const signer = ProtectedStoreRecordSchema.parse(source.read()).entries.timekeeperName;
  if (signer === undefined) throw new Error("fixture protected signer missing");
  const binding = ProtectedInputBindingSchema.parse({ kind: "protected-store", inputPath: "timekeeperName", name: "timekeeperName", valueId: signer.valueId });
  const admitted = admitProtectedInput(separationsKualiFinalizationDescriptor, [input], source, undefined, [binding])[0];
  if (admitted === undefined) throw new Error("fixture protected admission missing");
  return { canonicalInput: admitted.admitted, protectedBindings: admitted.bindings };
}

const TEST_MANIFEST = parseDryRunScenarioManifest({
  scenarioId: "separations-kuali-finalization/dry-run",
  workflow: "separations-kuali-finalization",
  arm: "dry-run-preview",
  transactionNode: "finalize-kuali",
  recordedBy: "unit composition fixture",
  cases: [
    {
      caseId: "ordinary",
      subjectLabel: "finalization-canary",
      subjectKind: "ordinary",
      why: "the composition fixture exercises the ordinary declaration",
      nodesReached: [
        "job-summary",
        "name-search",
        "department-option",
        "comparison",
        "identity-approval",
        "approval",
        "filing-presence",
        "finalize-kuali",
      ],
      nodesExcluded: [],
      checkpoints: [
        "job-summary",
        "name-search",
        "department-option",
        "comparison",
        "approval",
        "filing-presence",
      ].map((node) => ({
        node,
        attempt: 1,
        keyedBy: ["workflow", "item", "node", "attempt", "claimGeneration"],
      })),
      gateResults: [
        {
          gate: "identity-approval",
          decision: "approved",
          resolvedBy: "local-operator",
        },
      ],
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
    },
  ],
});

function admissionFixture(
  env: NodeJS.ProcessEnv = {},
  afterSettingsRead?: () => void,
) {
  const root = mkdtempSync(join(tmpdir(), "hrauto-dry-run-admission-"));
  roots.push(root);
  mkdirSync(join(root, rebuildRuntimeIsolation.stateRoot), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    readFileSync(join(process.cwd(), "package.json"), "utf8"),
  );
  const clock = manualClock(new Date("2026-08-25T18:00:00.000Z"));
  const settings = selectedSettingsFixture(root, clock, env);
  const scenarioCase = TEST_MANIFEST.cases[0];
  assert.ok(scenarioCase);
  const runtime = createProductionDryRunScenarioRuntime({
    admission: RuntimeAdmission.syntheticRoots(
      join(root, rebuildRuntimeIsolation.stateRoot),
      join(root, rebuildRuntimeIsolation.artifactRoot),
    ),
    preflightRunnerFactory: healthyRuntimePreflightRunners,
    ...(afterSettingsRead === undefined ? {} : { afterSettingsRead }),
    isolation: rebuildRuntimeIsolation,
    repoRoot: root,
    env,
    clock,
    ids: sequentialIdFactory("d"),
    drainWorker: () =>
      Promise.reject(new Error("admission proof must not drain a worker")),
  });
  return {
    root,
    clock,
    ...settings,
    runtime,
    request: {
      manifest: TEST_MANIFEST,
      scenarioCase,
      ...admittedFinalization(NAME_ONLY_FINALIZATION_INPUT),
    },
  };
}

const CHAIN_READY_MANIFEST = parseDryRunScenarioManifest({
  scenarioId: "separations/dry-run",
  workflow: "separations",
  arm: "dry-run-preview",
  transactionNode: "clear-pending",
  recordedBy: "unit composition fixture",
  cases: [
    {
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
        verification: [
          {
            obligation: "completion.terminal-result",
            verdict: "unknown",
            mandatory: true,
          },
        ],
      },
      terminal: {
        lifecycle: "done",
        resultSchema: "RunDryRunPreviewResultSchema",
        kind: "dry-run-preview",
        externalCommit: "none",
        stoppedAtNodeId: "clear-pending",
      },
      preview: { outcome: "already-present", proofSource: "live-probe" },
    },
  ],
});

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("dry-run scenario production composition boundary", () => {

  it("admits the real Separations protected input from the independent credential store", async () => {
    const fixture = admissionFixture();
    fixture.activate();
    const file = createCredentialStore({
      stateRoot: join(fixture.root, rebuildRuntimeIsolation.stateRoot),
    });
    journalProtectedSettings(fixture.database, file, {
      timekeeperName: { set: "Synthetic Admission Operator" },
    });
    const scenarioCase = CHAIN_READY_MANIFEST.cases[0];
    assert.ok(scenarioCase);
    const started = await fixture.runtime.start({
      manifest: CHAIN_READY_MANIFEST,
      scenarioCase,
      canonicalInput: { documentNumber: "4999" },
    });
    const retained = fixture.database.authority.runs.get(started.runId)?.input
      .parsed;
    assert.ok(retained);
    assert.equal(
      Reflect.get(retained.value as object, "timekeeperName"),
      "Synthetic Admission Operator",
    );
    assert.equal(retained.protectedBindings?.[0]?.kind, "protected-store");
    journalProtectedSettings(fixture.database, file, {
      timekeeperName: { clear: true },
    });
    assert.deepEqual(
      fixture.database.authority.runs.get(started.runId)?.input.parsed,
      retained,
    );
    const before = startEffects(fixture.path);
    await assert.rejects(
      fixture.runtime.start({
        manifest: CHAIN_READY_MANIFEST,
        scenarioCase,
        canonicalInput: { documentNumber: "4998" },
      }),
      /protected input timekeeperName is absent/,
    );
    assert.deepEqual(startEffects(fixture.path), before);
  });

  it("carries a protected reread from target resolution through the real start command into a fresh item", async () => {
    const fixture = admissionFixture();
    fixture.activate();
    const file = createCredentialStore({
      stateRoot: join(fixture.root, rebuildRuntimeIsolation.stateRoot),
    });
    journalProtectedSettings(fixture.database, file, {
      timekeeperName: { set: "Synthetic Admission Operator" },
    });
    const source = testDataInputSource({
      separationsKualiFinalizationCanaryDocumentNumber: "4999",
    });
    const manifest = parseDryRunScenarioManifest({
      ...CHAIN_READY_MANIFEST,
      cases: CHAIN_READY_MANIFEST.cases.map((entry) => ({
        ...entry,
        subjectLabel: "synthetic-reread",
      })),
    });
    const resolve = (reRead?: { ordinal: number; reason: string }) => {
      const registry = parseTestTargetRegistry({
        schemaVersion: 2,
        targets: [
          {
            label: "synthetic-reread",
            availability: {
              state: "available",
              lastObserved: "2026-08-25",
              reason: "Synthetic fixture",
            },
            provenance: {
              document: "docs/rebuild/reference/guards-and-tests.md",
              section: "§10.5",
            },
            usagePolicy: "read-only",
            cleanupObligation: "Synthetic fixture only",
            owner: "unit test",
            purpose: "Synthetic reread admission",
            workflows: {
              separations: {
                kind: "full-chain-dry-run",
                publicInput: {
                  document: {
                    state: "configured",
                    reference: {
                      name: "separationsKualiFinalizationCanaryDocumentNumber",
                    },
                  },
                  ...(reRead === undefined ? {} : { reRead }),
                },
              },
            },
          },
        ],
      });
      const result = resolveDryRunScenarioTarget(
        registry,
        manifest,
        "synthetic-reread",
        source,
      );
      assert.equal(result.state, "ready");
      if (result.state !== "ready")
        throw new Error("synthetic target not ready");
      return result;
    };
    const scenarioCase = manifest.cases[0];
    assert.ok(scenarioCase);
    const original = resolve();
    const reread = {
      ordinal: 1,
      reason: "Synthetic full rehearsal after repair",
    };
    const fresh = resolve(reread);
    const start = (target: ReturnType<typeof resolve>) =>
      fixture.runtime.start({
        manifest,
        scenarioCase,
        canonicalInput: target.canonicalInput,
        protectedBindings: target.protectedBindings,
      });
    const first = await start(original);
    const second = await start(fresh);
    const firstRun = fixture.database.authority.runs.get(first.runId);
    const secondRun = fixture.database.authority.runs.get(second.runId);
    assert.ok(firstRun);
    assert.ok(secondRun);
    assert.notEqual(firstRun.envelope.itemId, secondRun.envelope.itemId);
    assert.equal(firstRun.envelope.attempt, 1);
    assert.equal(secondRun.envelope.attempt, 1);
    assert.deepEqual(
      secondRun.input.parsed.protectedBindings,
      firstRun.input.parsed.protectedBindings,
    );
    assert.deepEqual(
      Reflect.get(secondRun.input.parsed.value as object, "reRead"),
      reread,
    );
    assert.deepEqual(first.writeSafetyBefore, {
      writeIntents: 0,
      writeAttempts: 0,
      confirmedOperations: 0,
    });
    assert.deepEqual(second.writeSafetyBefore, first.writeSafetyBefore);
    const before = startEffects(fixture.path);
    await assert.rejects(
      start(resolve({ ...reread, reason: "Synthetic revised explanation" })),
      /active run|refused|already has/,
    );
    assert.equal(
      fixture.database.authority.runs.get(first.runId)?.envelope.itemId,
      firstRun.envelope.itemId,
    );
    assert.equal(
      fixture.database.authority.runs.get(second.runId)?.envelope.itemId,
      secondRun.envelope.itemId,
    );
    assert.deepEqual(startEffects(fixture.path), before);
  });

  it("refuses gate resolution with lost config identity after a subsequent start admission failure", async () => {
    const env: NodeJS.ProcessEnv = {};
    const fixture = admissionFixture(env);
    fixture.apply({ concurrency: { defaultWorkers: 3 } });
    const { active, snapshot } = fixture.activate();
    const { sessions } = composedSessions(fixture.clock);
    const runtime = createProductionDryRunScenarioRuntime({
      admission: RuntimeAdmission.syntheticRoots(
        join(fixture.root, rebuildRuntimeIsolation.stateRoot),
        join(fixture.root, rebuildRuntimeIsolation.artifactRoot),
      ),
      preflightRunnerFactory: healthyRuntimePreflightRunners,
      isolation: rebuildRuntimeIsolation,
      repoRoot: fixture.root,
      env,
      clock: fixture.clock,
      ids: sequentialIdFactory("e"),
      sessionFactory: sessions.factory,
      duoCeremony: fixtureDuoCeremonyGates(fixture.clock),
      processId: 4244,
      processIdentityObserver: (pid) => ({
        state: "alive",
        identity: {
          platform: "darwin",
          startToken: `synthetic-${String(pid)}`,
        },
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
      parked.envelope.workflow,
      parked.envelope.itemId,
      "comparison",
    );
    assert.equal(comparison?.runId, started.runId);
    const gateResults = fixture.database.authority.gateResults.listByRun(
      started.runId,
    );
    assert.deepEqual(gateResults, []);
    const settingsBefore = fixture.file.read();
    const durableCurrent = fixture.database.authority.settingsCurrent.get();

    // Saving Settings immediately activates a new generation. The duplicate start
    // refuses, while the parked run retains its original snapshot.
    fixture.apply({ concurrency: { defaultWorkers: 4 } });
    const before = startEffects(fixture.path);
    await assert.rejects(
      runtime.start(fixture.request),
      /planned 0 and refused 1; exactly one planned run is required/,
    );
    const afterFailedStart = startEffects(fixture.path);
    assert.deepEqual(
      afterFailedStart.filter(
        ({ table }) => table !== "commands" && table !== "command_audits",
      ),
      before.filter(
        ({ table }) => table !== "commands" && table !== "command_audits",
      ),
    );
    assert.notDeepEqual(
      fixture.database.authority.settingsCurrent.get(),
      durableCurrent,
    );
    assert.notDeepEqual(fixture.database.authority.runtimeConfig.get(), active);
    assert.equal(
      fixture.database.authority.runtimeConfig.get()?.settingsRevision,
      fixture.database.authority.settingsCurrent.get()?.revision,
    );
    assert.deepEqual(
      fixture.database.authority.configSnapshots.get(active.configSnapshotId),
      snapshot,
    );
    assert.notDeepEqual(fixture.file.read(), settingsBefore);
    await assert.rejects(
      runtime.collectEvidence(started.runId),
      /dry-run evidence collection ran before start/,
    );
    await assert.rejects(
      runtime.resolveGate({
        manifest: TEST_MANIFEST,
        scenarioCase: fixture.request.scenarioCase,
        runId: started.runId,
      }),
      /dry-run gate resolution lost its start config identity/,
    );

    assert.deepEqual(
      fixture.database.authority.runs.get(started.runId),
      parked,
    );
    assert.deepEqual(
      fixture.database.authority.gateResults.listByRun(started.runId),
      gateResults,
    );
    assert.deepEqual(
      fixture.database.authority.runCheckpoints.latest(
        parked.envelope.workflow,
        parked.envelope.itemId,
        "comparison",
      ),
      comparison,
    );
    assert.deepEqual(startEffects(fixture.path), afterFailedStart);
    assert.notDeepEqual(
      fixture.database.authority.settingsCurrent.get(),
      durableCurrent,
    );
    assert.notDeepEqual(fixture.database.authority.runtimeConfig.get(), active);
    assert.equal(
      fixture.database.authority.runtimeConfig.get()?.settingsRevision,
      fixture.database.authority.settingsCurrent.get()?.revision,
    );
    assert.notDeepEqual(fixture.file.read(), settingsBefore);
  });
});
