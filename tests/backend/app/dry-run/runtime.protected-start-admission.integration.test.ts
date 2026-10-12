import { createDryRunCompositionTestWorld } from "../../../support/helpers/backend/dry-run-composition-world.js";
import assert from "node:assert/strict";

import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { resolveDryRunScenarioTarget } from "../../../../src/backend/app/dry-run/compose.js";
import { createProductionDryRunScenarioRuntime } from "../../../../src/backend/app/dry-run/runtime.js";
import { parseTestTargetRegistry } from "../../../../src/backend/app/registries/test-target-registry.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { parseDryRunScenarioManifest } from "../../../../src/models/trust/dry-run-scenario.js";
import { startEffects } from "../../../support/fixtures/integration/dry-run-admission-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { healthyRuntimePreflightRunners } from "../../../support/fixtures/preflight-seams.js";
import { fixtureDuoCeremonyGates } from "../../../support/helpers/duo-ceremony-fixtures.js";
import { journalProtectedSettings } from "../../../support/helpers/integration/journaled-protected-settings.js";
import { createCredentialStore } from "../../../support/helpers/synthetic-storage-admission.js";
import { testDataInputSource } from "../../../support/helpers/test-data/test-data-source.js";

const {composedSessions, TEST_MANIFEST, admissionFixture, CHAIN_READY_MANIFEST, cleanup } = createDryRunCompositionTestWorld();


afterEach(cleanup);

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
