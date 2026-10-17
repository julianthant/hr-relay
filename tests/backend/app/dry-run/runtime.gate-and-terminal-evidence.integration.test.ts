import { createDryRunCompositionTestWorld } from "../../../support/helpers/backend/dry-run-composition-world.js";
import assert from "node:assert/strict";
import {mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { createProductionDryRunScenarioRuntime } from "../../../../src/backend/app/dry-run/runtime.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { parseDryRunScenarioManifest } from "../../../../src/models/trust/dry-run-scenario.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { healthyRuntimePreflightRunners } from "../../../support/fixtures/preflight-seams.js";
import { fixtureDuoCeremonyGates } from "../../../support/helpers/duo-ceremony-fixtures.js";
import { FINALIZATION_EID, FINALIZATION_OTHER_EID } from "../../../support/helpers/kuali-finalization-fixtures.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const {roots, spanTextFromAuthority, selectedSettingsFixture, composedSessions, PREVIEW_RECEIPT_VERIFICATION, NAME_ONLY_FINALIZATION_INPUT, admittedFinalization, TEST_MANIFEST, cleanup } = createDryRunCompositionTestWorld();


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

afterEach(cleanup);

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
    const previewDatabase = AuthorityDatabase.open({ path: join(root, rebuildRuntimeIsolation.stateRoot, "state.db"),
      busyTimeoutMs: 250, migrationOwner: "preview-recovery-control" }, clock);
    try {
      assert.equal(previewDatabase.authority.runs.get(started.runId)?.envelope.recovery, undefined);
    } finally {
      previewDatabase.close();
    }
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
