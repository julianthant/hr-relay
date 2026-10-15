import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { createProductionDryRunScenarioRuntime } from "../../../../src/backend/app/dry-run/runtime.js";
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
import { selectedSettingsFixture as sharedSettingsFixture } from "../../fixtures/integration/dry-run-admission-fixtures.js";
import { sequentialIdFactory } from "../../fixtures/phase1f-run-fixtures.js";
import { healthyRuntimePreflightRunners } from "../../fixtures/preflight-seams.js";
import { FINALIZATION_ACTION_ID, FINALIZATION_DOCUMENT, FINALIZATION_EID, FINALIZATION_RUN_INPUT } from "../kuali-finalization-fixtures.js";
import { sessionFactoryHarness } from "../phase1f-executor-harness.js";
import { protectedSecretSource } from "../protected-secret-source.js";
import { separationsKualiFinalizationDescriptor } from "../registered-workflows.js";
import { AuthorityDatabase } from "../synthetic-storage-admission.js";



export function createDryRunCompositionTestWorld() {
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
      hrStatus: 'Active', startDate: "", effectiveDate: "", terminationDate: "", terminationReason: "",
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
  const cleanup = () => {
    for (const database of databases.splice(0)) database.close();
    for (const root of roots.splice(0))
      rmSync(root, { recursive: true, force: true });
  };
  return { roots, databases, spanTextFromAuthority, selectedSettingsFixture, composedSessions, PREVIEW_RECEIPT_VERIFICATION, NAME_ONLY_FINALIZATION_INPUT, admittedFinalization, TEST_MANIFEST, admissionFixture, CHAIN_READY_MANIFEST, cleanup };
}
