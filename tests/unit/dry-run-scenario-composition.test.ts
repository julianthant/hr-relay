import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../src/config/runtime-isolation.js";
import { manualClock } from "../../src/domain/clock.js";
import { parseDryRunScenarioManifest } from "../../src/domain/trust/dry-run-scenario.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import { composeDryRunScenarioCommand } from "../../src/server/dry-run-scenario/compose.js";
import { createProductionDryRunScenarioRuntime } from "../../src/server/dry-run-scenario/runtime.js";
import { SeparationsKualiFinalizationCanonicalInput } from "../../src/workflows/separations/kuali-finalization/descriptor.js";
import { sequentialIdFactory } from "./fixtures/phase1f-run-fixtures.js";

const roots: string[] = [];
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
    checkpoints: ["job-summary", "name-search", "department-option", "comparison"].map((node) => ({
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
      confidence: "partial",
      verification: [{ node: "finalize-kuali", verdict: "absent", mandatory: true }],
      obligations: [{
        obligation: "kuali-finalization-reload-read-back",
        verdict: "unknown",
        why: "the unit declaration keeps the live obligation unresolved",
      }],
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
