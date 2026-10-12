import { createDryRunCompositionTestWorld } from "../../../support/helpers/backend/dry-run-composition-world.js";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { createProductionDryRunScenarioRuntime } from "../../../../src/backend/app/dry-run/runtime.js";
import { readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { SeparationsKualiFinalizationCanonicalInput } from "../../../../src/workflows/separations/steps/kuali-finalization/step.js";
import { startEffects } from "../../../support/fixtures/integration/dry-run-admission-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { healthyRuntimePreflightRunners } from "../../../support/fixtures/preflight-seams.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const { roots, databases, spanTextFromAuthority, selectedSettingsFixture, NAME_ONLY_FINALIZATION_INPUT, admittedFinalization, TEST_MANIFEST, admissionFixture } = createDryRunCompositionTestWorld();


function injectSnapshotFault(raw: DatabaseSync, triggerName: "settings_snapshots_immutable" | "settings_snapshots_retained", fault: () => void) {
  const trigger = raw.prepare("SELECT sql FROM sqlite_schema WHERE name=?").get(triggerName);
  if (typeof trigger?.sql !== "string") throw new Error("fixture snapshot protection missing");
  raw.exec(`DROP TRIGGER ${triggerName}`);
  try { fault(); } finally { raw.exec(trigger.sql); }
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("dry-run scenario production composition boundary", () => {

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
    const record = settings.apply({
      browser: { headless: false },
      concurrency: { defaultWorkers: 3 },
    });
    const { active, snapshot } = settings.activate();
    const snapshotsBefore = startEffects(settings.path).find(
      ({ table }) => table === "settings_snapshots",
    );
    const scenarioCase = TEST_MANIFEST.cases[0];
    if (scenarioCase === undefined)
      throw new Error("the finalization manifest lost its ordinary case");
    const canonicalInput = SeparationsKualiFinalizationCanonicalInput.parse({
      actionId: "6a7a33b2ac106d428b3217e0",
      documentNumber: "4510",
      employeeName: "Fixture, Person",
      emplId: "10873698",
      emplIdSource: "document-eid",
      documentEid: { state: "present", value: "10873698" },
      ucpathDeptId: { state: "present", value: "000412" },
      ucpathDepartment: {
        state: "present",
        value: "HOUSING/DINING/HOSPITALITY",
      },
      observedDepartmentOptions: [
        "- - -",
        "000412 - Housing/Dining/Hospitality",
      ],
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
      admission: RuntimeAdmission.syntheticRoots(
        join(root, rebuildRuntimeIsolation.stateRoot),
        join(root, rebuildRuntimeIsolation.artifactRoot),
      ),
      preflightRunnerFactory: healthyRuntimePreflightRunners,
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
      ...admittedFinalization(canonicalInput),
    });

    const database = AuthorityDatabase.open(
      {
        path: join(stateRoot, "state.db"),
        busyTimeoutMs: 250,
        migrationOwner: "dry-run-start-query",
      },
      clock,
    );
    try {
      const run = database.authority.runs.get(started.runId);
      assert.equal(run?.envelope.configFingerprint, active.configFingerprint);
      assert.equal(run?.envelope.configSnapshotId, active.configSnapshotId);
      assert.equal(record.revision, 2);
      assert.equal(snapshot?.config.browser.headless, false);
      assert.equal(snapshot?.config.concurrency.defaultWorkers, 3);
      assert.deepEqual(
        database.authority.configSnapshots.get(active.configSnapshotId),
        snapshot,
      );
      assert.deepEqual(
        startEffects(settings.path).find(
          ({ table }) => table === "settings_snapshots",
        ),
        snapshotsBefore,
      );
      assert.equal(run?.envelope.dryRun, true);
      assert.equal(run?.envelope.workflow, "separations-kuali-finalization");
      assert.equal(run?.envelope.traceId, started.traceId);
      assert.equal(run?.lifecycle.state, "queued");
      assert.deepEqual(started.writeSafetyBefore, {
        writeIntents: 0,
        writeAttempts: 0,
        confirmedOperations: 0,
      });
    } finally {
      database.close();
    }
    const spanText = spanTextFromAuthority(stateRoot, clock);
    const runEvents = spanText
      .trim()
      .split("\n")
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

  it("refuses absent activation before any start effects and leaves Settings at the absent baseline", async () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-dry-run-virgin-"));
    roots.push(root);
    mkdirSync(join(root, rebuildRuntimeIsolation.stateRoot), { recursive: true });
    writeFileSync(join(root, "package.json"), readFileSync(join(process.cwd(), "package.json")));
    const clock = manualClock(new Date("2026-08-25T18:00:00.000Z"));
    const path = join(root, rebuildRuntimeIsolation.stateRoot, "state.db");
    const database = AuthorityDatabase.open({ path, busyTimeoutMs: 250, migrationOwner: "virgin-activation-proof" }, clock);
    databases.push(database);
    assert.equal(readSettings(database.authority).revision, 1);
    assert.equal(database.authority.runtimeConfig.get(), undefined);
    assert.equal(database.authority.runtimeConfig.hasHistory(), false);
    const scenarioCase = TEST_MANIFEST.cases[0];
    assert.ok(scenarioCase);
    const runtime = createProductionDryRunScenarioRuntime({
      admission: RuntimeAdmission.syntheticRoots(join(root, rebuildRuntimeIsolation.stateRoot), join(root, rebuildRuntimeIsolation.artifactRoot)),
      preflightRunnerFactory: healthyRuntimePreflightRunners, isolation: rebuildRuntimeIsolation, repoRoot: root, env: {}, clock, ids: sequentialIdFactory("d"),
      drainWorker: () => Promise.reject(new Error("absent activation must not drain")),
    });
    const before = startEffects(path);
    await assert.rejects(runtime.start({ manifest: TEST_MANIFEST, scenarioCase, ...admittedFinalization(NAME_ONLY_FINALIZATION_INPUT) }), /runtime config has no dashboard-activated generation/u);
    assert.deepEqual(startEffects(path), before);
    assert.equal(database.authority.runtimeConfig.get(), undefined);
    assert.equal(readSettings(database.authority).revision, 1);
    assert.equal(database.authority.settingsCurrent.get(), undefined);
    assert.equal(existsSync(join(root, ".tracker", "settings")), false);
    await assert.rejects(runtime.collectEvidence("11111111-1111-4111-8111-111111111111"), /dry-run evidence collection ran before start/u);
  });

  it("activates changed Settings while refusing a duplicate start without rewriting the admitted run", async () => {
    const fixture = admissionFixture();
    fixture.apply({ browser: { headless: false } });
    const { active } = fixture.activate();
    const admitted = await fixture.runtime.start(fixture.request);
    const run = fixture.database.authority.runs.get(admitted.runId);
    const changed = fixture.apply({ concurrency: { defaultWorkers: 3 } });
    assert.equal(changed.revision, 3);
    const before = startEffects(fixture.path);
    const bytes = fixture.file.read();
    const current = fixture.database.authority.settingsCurrent.get();
    await assert.rejects(
      fixture.runtime.start(fixture.request),
      /planned 0 and refused 1; exactly one planned run is required/,
    );
    assert.deepEqual(startEffects(fixture.path), before);
    assert.deepEqual(fixture.database.authority.runs.get(admitted.runId), run);
    assert.notDeepEqual(fixture.database.authority.runtimeConfig.get(), active);
    assert.equal(
      fixture.database.authority.runtimeConfig.get()?.settingsRevision,
      fixture.database.authority.settingsCurrent.get()?.revision,
    );
    assert.deepEqual(fixture.database.authority.settingsCurrent.get(), current);
    assert.deepEqual(fixture.file.read(), bytes);
    await assert.rejects(
      fixture.runtime.collectEvidence(admitted.runId),
      /dry-run evidence collection ran before start/,
    );
  });

  it("ignores non-retired hostile noise while retaining the activated Settings snapshot", async () => {
    const env: NodeJS.ProcessEnv = {};
    let reads = 0;
    Object.defineProperty(env, "UNRELATED_HOSTILE_NOISE", {
      enumerable: true,
      get: () => {
        reads += 1;
        throw new Error("environment noise was read");
      },
    });
    const fixture = admissionFixture(env);
    const record = fixture.apply({ concurrency: { defaultWorkers: 3 } });
    const { active, snapshot } = fixture.activate();
    const before = startEffects(fixture.path);
    const bytes = fixture.file.read();
    const started = await fixture.runtime.start(fixture.request);
    const run = fixture.database.authority.runs.get(started.runId);
    assert.equal(reads, 0);
    assert.equal(record.settings.concurrency?.defaultWorkers, 3);
    assert.equal(snapshot?.config.concurrency.defaultWorkers, 3);
    assert.equal(
      snapshot?.provenance["concurrency.defaultWorkers"],
      "settings",
    );
    assert.equal(run?.envelope.configFingerprint, active.configFingerprint);
    assert.notDeepEqual(startEffects(fixture.path), before);
    assert.deepEqual(fixture.database.authority.runtimeConfig.get(), active);
    assert.deepEqual(fixture.file.read(), bytes);
  });

  it("retains exact Settings precedence with unrelated environment noise", async () => {
    const fixture = admissionFixture({ UNRELATED_HOSTILE_NOISE: "5" });
    const record = fixture.apply({
      browser: { headless: false },
      concurrency: { defaultWorkers: 3 },
    });
    const { active, snapshot } = fixture.activate();
    assert.equal(record.settings.concurrency?.defaultWorkers, 3);
    assert.equal(snapshot?.config.concurrency.defaultWorkers, 3);
    assert.equal(snapshot?.config.browser.headless, false);
    assert.equal(
      snapshot?.provenance["concurrency.defaultWorkers"],
      "settings",
    );
    assert.equal(snapshot?.provenance["browser.headless"], "settings");
    const before = startEffects(fixture.path).find(
      ({ table }) => table === "settings_snapshots",
    );
    const started = await fixture.runtime.start(fixture.request);
    const run = fixture.database.authority.runs.get(started.runId);
    assert.equal(run?.envelope.configSnapshotId, active.configSnapshotId);
    assert.equal(run?.envelope.configFingerprint, active.configFingerprint);
    assert.deepEqual(
      fixture.database.authority.configSnapshots.get(active.configSnapshotId),
      snapshot,
    );
    assert.deepEqual(
      startEffects(fixture.path).find(
        ({ table }) => table === "settings_snapshots",
      ),
      before,
    );
  });

  it("refuses a concurrent SQLite Settings change after initial read before any start effects", async () => {
    let afterRead: (() => void) | undefined;
    const fixture = admissionFixture({}, () => {
      const callback = afterRead;
      afterRead = undefined;
      callback?.();
    });
    fixture.apply({ browser: { headless: false } });
    const current = fixture.apply({ concurrency: { defaultWorkers: 3 } });
    const { active, snapshot } = fixture.activate();
    let afterSave: ReturnType<typeof startEffects> | undefined;
    let replacement: ReturnType<typeof fixture.apply> | undefined;
    afterRead = () => {
      replacement = fixture.apply({ concurrency: { defaultWorkers: 4 } });
      afterSave = startEffects(fixture.path);
    };
    await assert.rejects(
      fixture.runtime.start(fixture.request),
      /settings changed after worker boot; restart activation is required/,
    );
    assert.equal(current.revision, 3);
    assert.equal(replacement?.revision, 4);
    assert.deepEqual(fixture.file.read(), replacement);
    assert.notDeepEqual(fixture.database.authority.runtimeConfig.get(), active);
    assert.equal(
      fixture.database.authority.runtimeConfig.get()?.settingsRevision,
      fixture.database.authority.settingsCurrent.get()?.revision,
    );
    assert.deepEqual(
      fixture.database.authority.configSnapshots.get(active.configSnapshotId),
      snapshot,
    );
    assert.ok(afterSave);
    assert.deepEqual(startEffects(fixture.path), afterSave);
    assert.equal(existsSync(join(fixture.root, ".tracker", "settings")), false);
  });

  it("refuses a missing activated snapshot before any start effects", async () => {
    let afterSettingsRead: (() => void) | undefined;
    const fixture = admissionFixture({}, () => afterSettingsRead?.());
    fixture.apply({ browser: { headless: false } });
    const { active } = fixture.activate();
    const raw = new DatabaseSync(fixture.path);
    let before: ReturnType<typeof startEffects> | undefined;
    try {
      raw.exec("PRAGMA foreign_keys = OFF");
      afterSettingsRead = () => {
        injectSnapshotFault(raw, "settings_snapshots_retained", () => { raw.prepare("DELETE FROM settings_snapshots WHERE id = ?").run(active.configSnapshotId); });
      };
      await assert.rejects(
        fixture.runtime.start(fixture.request),
        /settings-snapshot-missing/u,
      );
      before = startEffects(fixture.path);
      assert.ok(
        before !== undefined,
        "the real start admission refused the missing snapshot",
      );
      assert.deepEqual(startEffects(fixture.path), before);
      assert.throws(() => fixture.database.authority.runtimeConfig.get(), /settings-snapshot-missing/u);
    } finally {
      raw.close();
    }
  });

  it("refuses a mismatched activated snapshot before any start effects", async () => {
    const fixture = admissionFixture();
    fixture.apply({ browser: { headless: false } });
    const { active } = fixture.activate();
    const raw = new DatabaseSync(fixture.path);
    try {
      injectSnapshotFault(raw, "settings_snapshots_immutable", () => { raw.prepare("UPDATE settings_snapshots SET fingerprint=?, payload_json=json_set(payload_json, '$.fingerprint', ?) WHERE id=?").run("f".repeat(64), "f".repeat(64), active.configSnapshotId); });
    } finally {
      raw.close();
    }
    const before = startEffects(fixture.path);
    await assert.rejects(
      fixture.runtime.start(fixture.request),
      /config-snapshot-fingerprint-mismatch/u,
    );
    assert.deepEqual(startEffects(fixture.path), before);
    assert.throws(() => fixture.database.authority.runtimeConfig.get(), /config-snapshot-fingerprint-mismatch/u);
  });

  it("rolls back outer start commit failure without publishing a scenario identity", async () => {
    let injectCommitFailure: (() => void) | undefined;
    const fixture = admissionFixture({}, () => injectCommitFailure?.());
    fixture.apply({ browser: { headless: false } });
    const { active } = fixture.activate();
    const before = startEffects(fixture.path);
    const settingsBefore = fixture.file.read();
    const raw = new DatabaseSync(fixture.path);
    try {
      // A real SQLite failure at the outer commit's metadata write, after the
      // start audit exists. No transaction counts or mocked kernel are involved.
      injectCommitFailure = () => raw.exec(`CREATE TRIGGER refuse_start_commit BEFORE UPDATE ON database_states
        WHEN EXISTS (SELECT 1 FROM command_audits WHERE json_extract(payload_json, '$.request.family') = 'start')
        BEGIN SELECT RAISE(ABORT, 'synthetic outer start commit refusal'); END`);
      await assert.rejects(
        fixture.runtime.start(fixture.request),
        /synthetic outer start commit refusal/,
      );
      assert.deepEqual(startEffects(fixture.path), before);
      assert.deepEqual(fixture.database.authority.runtimeConfig.get(), active);
      assert.deepEqual(fixture.file.read(), settingsBefore);
      await assert.rejects(
        fixture.runtime.collectEvidence("11111111-1111-4111-8111-111111111111"),
        /dry-run evidence collection ran before start/,
      );
      raw.exec("DROP TRIGGER refuse_start_commit");
      injectCommitFailure = undefined;
      const started = await fixture.runtime.start(fixture.request);
      const run = fixture.database.authority.runs.get(started.runId);
      assert.equal(run?.envelope.configSnapshotId, active.configSnapshotId);
      assert.equal(run?.envelope.configFingerprint, active.configFingerprint);
    } finally {
      raw.exec("DROP TRIGGER IF EXISTS refuse_start_commit");
      raw.close();
    }
  });
});
