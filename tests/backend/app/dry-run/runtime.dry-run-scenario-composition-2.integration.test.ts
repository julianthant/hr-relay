import assert from "node:assert/strict";
import {
mkdirSync,
mkdtempSync,
readFileSync,
rmSync,
writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach,describe,it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { createProductionDryRunScenarioRuntime } from "../../../../src/backend/app/dry-run/runtime.js";
import { admitProtectedInput } from "../../../../src/backend/runs/start/protected-input.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import {
createDeterministicKualiDriver,
createKualiFakeWorld,
} from "../../../../src/backend/systems/kuali/driver/fake.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../src/backend/systems/ucpath/driver/fake.js";
import { deriveJobRowFromCells } from "../../../../src/backend/systems/ucpath/driver/person-org-operation.js";
import {
createDeterministicUcpathSmartHrWorldDriver,
createUcpathSmartHrFakeWorld,
} from "../../../../src/backend/systems/ucpath/driver/smart-hr-fake.js";
import { ProtectedStoreRecordSchema } from "../../../../src/models/config/protected-settings.js";
import { parseDryRunScenarioManifest } from "../../../../src/models/trust/dry-run-scenario.js";
import { UcpathJobSummaryReadSchema } from "../../../../src/models/ui/ucpath-job-summary.js";
import { ProtectedInputBindingSchema } from "../../../../src/models/write-safety/protected-input.js";
import {
manualClock,
type TestClock,
} from "../../../../src/rules/time/clock.js";
import { SeparationsKualiFinalizationCanonicalInput } from "../../../../src/workflows/separations/steps/kuali-finalization/step.js";
import {
selectedSettingsFixture as sharedSettingsFixture
} from "../../../support/fixtures/integration/dry-run-admission-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { healthyRuntimePreflightRunners } from "../../../support/fixtures/preflight-seams.js";
import { fixtureDuoCeremonyGates } from "../../../support/helpers/duo-ceremony-fixtures.js";
import {
FINALIZATION_ACTION_ID,
FINALIZATION_DOCUMENT,
FINALIZATION_EID,
FINALIZATION_OTHER_EID,
FINALIZATION_RUN_INPUT,
} from "../../../support/helpers/kuali-finalization-fixtures.js";
import { sessionFactoryHarness } from "../../../support/helpers/phase1f-executor-harness.js";
import { protectedSecretSource } from "../../../support/helpers/protected-secret-source.js";
import { separationsKualiFinalizationDescriptor } from "../../../support/helpers/registered-workflows.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const roots: string[] = [];
const databases: AuthorityDatabase[] = [];
function spanTextFromAuthority(
  stateRoot: string,
  clock: Parameters<typeof AuthorityDatabase.open>[1],
): string {
  const database = AuthorityDatabase.open(
    {
      path: join(stateRoot, "state.db"),
      busyTimeoutMs: 500,
      migrationOwner: "scenario-timeline-read",
    },
    clock,
  );
  try {
    return database.authority.timelineEvents
      .page({})
      .flatMap((record) =>
        record.payload.kind === "span"
          ? [JSON.stringify(record.payload.event)]
          : [],
      )
      .join("\n");
  } finally {
    database.close();
  }
}

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

const FAILED_TEST_MANIFEST = parseDryRunScenarioManifest({
  ...TEST_MANIFEST,
  cases: [
    {
      ...TEST_MANIFEST.cases[0],

      caseId: "failed-run",
      subjectLabel: "finalization-canary",
      subjectKind: "ordinary",
      receipt: {
        ...TEST_MANIFEST.cases[0]?.receipt,
        result: "failed",
        verification: PREVIEW_RECEIPT_VERIFICATION.map((row) =>
          row.obligation === "completion.terminal-result"
            ? { ...row, verdict: "absent" as const }
            : row,
        ),
      },
      terminal: {
        lifecycle: "failed",
        code: "UNHANDLED",
        node: "finalize-kuali",
        fingerprint:
          "2459ee6496de1582e97ff1e4a5c647ec91358201f9960b2f602968efd7d29625",
      },
      preview: {
        outcome: "not-reached",
        reason: "binding proof refused before preview settlement",
      },
    },
  ],
});

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("dry-run scenario production composition boundary", () => {

  it("composes both worker drains and the real gate command through terminal receipt evidence", async () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-dry-run-composed-"));
    roots.push(root);
    writeFileSync(
      join(root, "package.json"),
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    );
    mkdirSync(join(root, rebuildRuntimeIsolation.stateRoot), {
      recursive: true,
    });
    const clock = manualClock(new Date("2026-08-25T18:00:00.000Z"));
    const { sessions } = composedSessions(clock);
    selectedSettingsFixture(root, clock).activate();
    const runtime = createProductionDryRunScenarioRuntime({
      admission: RuntimeAdmission.syntheticRoots(
        join(root, rebuildRuntimeIsolation.stateRoot),
        join(root, rebuildRuntimeIsolation.artifactRoot),
      ),
      preflightRunnerFactory: healthyRuntimePreflightRunners,
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
        identity: {
          platform: "darwin",
          startToken: `synthetic-${String(pid)}`,
        },
      }),
      write: () => undefined,
    });
    const scenarioCase = TEST_MANIFEST.cases[0];
    assert.ok(scenarioCase);

    const started = await runtime.start({
      manifest: TEST_MANIFEST,
      scenarioCase,
      ...admittedFinalization(NAME_ONLY_FINALIZATION_INPUT),
    });
    await runtime.drain(TEST_MANIFEST.workflow);
    await runtime.resolveGate({
      manifest: TEST_MANIFEST,
      scenarioCase,
      runId: started.runId,
    });
    await runtime.drain(TEST_MANIFEST.workflow);
    const evidence = (await runtime.collectEvidence(started.runId)) as {
      reachedNodeIds: readonly string[];
      checkpoints: readonly unknown[];
      gateResults: readonly unknown[];
      writeSafetyAfter: unknown;
      receipt: {
        result: string;
        confidence: string;
        verification: readonly {
          obligation: string;
          verdict: string;
          mandatory: boolean;
        }[];
      };
      terminal: unknown;
    };
    assert.deepEqual(evidence.reachedNodeIds, [
      "job-summary",
      "name-search",
      "department-option",
      "comparison",
      "identity-approval",
      "approval",
      "filing-presence",
      "finalize-kuali",
    ]);
    assert.deepEqual(evidence.checkpoints, scenarioCase.checkpoints);
    assert.deepEqual(evidence.gateResults, [
      {
        gate: "identity-approval",
        decision: "approved",
        resolvedBy: "local-operator",
      },
    ]);
    assert.deepEqual(evidence.writeSafetyAfter, {
      writeIntents: 0,
      writeAttempts: 0,
      confirmedOperations: 0,
    });
    assert.deepEqual(
      {
        result: evidence.receipt.result,
        confidence: evidence.receipt.confidence,
      },
      {
        result: "partial",
        confidence: "unknown",
      },
    );
    assert.deepEqual(
      evidence.receipt.verification.map(
        ({ obligation, verdict, mandatory }) => ({
          obligation,
          verdict,
          mandatory,
        }),
      ),
      PREVIEW_RECEIPT_VERIFICATION,
    );
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
    writeFileSync(
      join(root, "package.json"),
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    );
    mkdirSync(join(root, rebuildRuntimeIsolation.stateRoot), {
      recursive: true,
    });
    const clock = manualClock(new Date("2026-08-25T18:00:00.000Z"));
    const settings = selectedSettingsFixture(root, clock);
    const { sessions, world, filingWorld } = composedSessions(clock);
    settings.activate();
    const runtime = createProductionDryRunScenarioRuntime({
      admission: RuntimeAdmission.syntheticRoots(
        join(root, rebuildRuntimeIsolation.stateRoot),
        join(root, rebuildRuntimeIsolation.artifactRoot),
      ),
      preflightRunnerFactory: healthyRuntimePreflightRunners,
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
        identity: {
          platform: "darwin",
          startToken: `synthetic-${String(pid)}`,
        },
      }),
      write: () => undefined,
    });
    const scenarioCase = TEST_MANIFEST.cases[0];
    assert.ok(scenarioCase);

    const started = await runtime.start({
      manifest: TEST_MANIFEST,
      scenarioCase,
      ...admittedFinalization(NAME_ONLY_FINALIZATION_INPUT),
    });
    await runtime.drain(TEST_MANIFEST.workflow);

    filingWorld.rows = [];
    await runtime.resolveGate({
      manifest: TEST_MANIFEST,
      scenarioCase,
      runId: started.runId,
    });
    await runtime.drain(TEST_MANIFEST.workflow);

    const run = settings.database.authority.runs.get(started.runId);
    assert.ok(
      run?.lifecycle.state === "terminal" &&
        run.lifecycle.failureId !== undefined,
    );
    const failure = settings.database.authority.failures.get(
      run.lifecycle.failureId,
    );
    assert.equal(failure?.nodeId, "filing-presence");
    assert.equal(failure?.taskId, "ucpath/verify-termination-filing-present");
    assert.equal(failure?.code, "FILING_NOT_CURRENT");
    assert.match(
      failure?.summary ?? "",
      /exact durable UCPath filing transaction is absent/iu,
    );
    assert.equal(world.persistedFinalization, undefined);
    assert.equal(
      world.events.some((event) => event.startsWith("stage-finalization:")),
      false,
    );

    const raw = new DatabaseSync(settings.path, { readOnly: true });
    try {
      assert.deepEqual(
        {
          intents: raw.prepare("SELECT count(*) AS n FROM write_intents").get()
            ?.n,
          attempts: raw
            .prepare("SELECT count(*) AS n FROM write_attempts")
            .get()?.n,
          confirmations: raw
            .prepare(
              "SELECT count(*) AS n FROM timeline_events WHERE retention_class = 'confirmed-operation'",
            )
            .get()?.n,
        },
        { intents: 0, attempts: 0, confirmations: 0 },
      );
    } finally {
      raw.close();
    }
  });

  it("derives transaction reach and EID-safe failure evidence from every durable worker sink", async () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-dry-run-failed-"));
    roots.push(root);
    writeFileSync(
      join(root, "package.json"),
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    );
    const stateRoot = join(root, rebuildRuntimeIsolation.stateRoot);
    mkdirSync(stateRoot, { recursive: true });
    const clock = manualClock(new Date("2026-08-25T18:00:00.000Z"));
    const malformedObservation = `EID ${FINALIZATION_OTHER_EID}`;
    const { sessions } = composedSessions(clock, malformedObservation);
    selectedSettingsFixture(root, clock).activate();
    const lines: string[] = [];
    const runtime = createProductionDryRunScenarioRuntime({
      admission: RuntimeAdmission.syntheticRoots(
        join(root, rebuildRuntimeIsolation.stateRoot),
        join(root, rebuildRuntimeIsolation.artifactRoot),
      ),
      preflightRunnerFactory: healthyRuntimePreflightRunners,
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
        identity: {
          platform: "darwin",
          startToken: `synthetic-${String(pid)}`,
        },
      }),
      write: (line) => lines.push(line),
    });
    const scenarioCase = FAILED_TEST_MANIFEST.cases[0];
    assert.ok(scenarioCase);

    const started = await runtime.start({
      manifest: FAILED_TEST_MANIFEST,
      scenarioCase,
      ...admittedFinalization(NAME_ONLY_FINALIZATION_INPUT),
    });
    await runtime.drain(FAILED_TEST_MANIFEST.workflow);
    await runtime.resolveGate({
      manifest: FAILED_TEST_MANIFEST,
      scenarioCase,
      runId: started.runId,
    });
    await runtime.drain(FAILED_TEST_MANIFEST.workflow);
    const evidence = (await runtime.collectEvidence(started.runId)) as {
      reachedNodeIds: readonly string[];
      terminal: unknown;
    };

    assert.deepEqual(evidence.reachedNodeIds, [
      "job-summary",
      "name-search",
      "department-option",
      "comparison",
      "identity-approval",
      "approval",
      "filing-presence",
      "finalize-kuali",
    ]);
    assert.deepEqual(evidence.terminal, {
      lifecycle: "failed",
      code: "UNHANDLED",
      node: "finalize-kuali",
      fingerprint:
        "2459ee6496de1582e97ff1e4a5c647ec91358201f9960b2f602968efd7d29625",
    });

    const database = AuthorityDatabase.open(
      {
        path: join(stateRoot, "state.db"),
        busyTimeoutMs: 250,
        migrationOwner: "dry-run-failed-query",
      },
      clock,
    );
    const run = database.authority.runs.get(started.runId);
    assert.ok(
      run?.lifecycle.state === "terminal" &&
        run.lifecycle.failureId !== undefined,
    );
    const failure = database.authority.failures.get(run.lifecycle.failureId);
    const receipt = database.authority.evidenceReceipts.findByRun(
      started.runId,
    );
    database.close();
    assert.ok(failure);
    assert.ok(receipt);
    assert.match(
      failure.summary,
      /subject observation.*real write would refuse to fence/iu,
    );

    assert.equal(receipt.composition, 5);
    assert.ok(
      [...receipt.input, ...receipt.observations, ...receipt.output].some(
        (row) =>
          row.state === "satisfied" &&
          row.value.state === "allowed" &&
          row.value.value === FINALIZATION_EID &&
          row.value.classification === "direct-identifier" &&
          row.value.transform === "allow",
      ),
    );
    const spanText = spanTextFromAuthority(stateRoot, clock);
    assert.match(spanText, new RegExp(FINALIZATION_EID));
    assert.doesNotMatch(spanText, new RegExp(malformedObservation));
    for (const sink of [JSON.stringify(failure), lines.join("\n")]) {
      assert.doesNotMatch(sink, new RegExp(malformedObservation));
      assert.doesNotMatch(sink, new RegExp(FINALIZATION_EID));
      assert.doesNotMatch(sink, new RegExp(FINALIZATION_OTHER_EID));
      assert.doesNotMatch(sink, new RegExp(`…${FINALIZATION_EID.slice(-4)}`));
      assert.doesNotMatch(
        sink,
        new RegExp(`…${FINALIZATION_OTHER_EID.slice(-4)}`),
      );
    }
  });

  it("refuses a descriptor whose graph has no dry-run transaction arm", async () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-dry-run-unsupported-"));
    roots.push(root);
    writeFileSync(
      join(root, "package.json"),
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    );
    const stateRoot = join(root, rebuildRuntimeIsolation.stateRoot);
    mkdirSync(stateRoot, { recursive: true });
    const clock = manualClock(new Date("2026-08-25T18:00:00.000Z"));
    const database = AuthorityDatabase.open(
      {
        path: join(stateRoot, "state.db"),
        busyTimeoutMs: 250,
        migrationOwner: "dry-run-unsupported-test",
      },
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
    if (scenarioCase === undefined)
      throw new Error("unsupported fixture has no case");
    const runtime = createProductionDryRunScenarioRuntime({
      admission: RuntimeAdmission.syntheticRoots(
        join(root, rebuildRuntimeIsolation.stateRoot),
        join(root, rebuildRuntimeIsolation.artifactRoot),
      ),
      preflightRunnerFactory: healthyRuntimePreflightRunners,
      isolation: rebuildRuntimeIsolation,
      repoRoot: root,
      env: {},
      clock,
      ids: sequentialIdFactory("u"),
      drainWorker: () =>
        Promise.reject(new Error("unsupported workflow must not drain")),
    });

    await assert.rejects(
      runtime.start({
        manifest: unsupported,
        scenarioCase,
        canonicalInput: {},
      }),
      /dry-run-preview manifest person-lookup\/dry-run names workflow person-lookup, whose compiled graph has no transaction node; a transaction-free graph must declare the live-read arm — dryRun is refused for it \(no-transaction-node\)/,
    );
  });
});
