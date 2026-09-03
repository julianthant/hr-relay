/**
 * D318 — the transaction-free `live-read` T1b arm, proved deterministically
 * through the REAL dry-run scenario runtime (real start-plan service, real
 * command kernel, real worker drain, real receipt service) over the REAL
 * person-lookup definition with deterministic UCPath/CRM drivers.
 *
 * What this file pins:
 *
 * 1. a `live-read` manifest on a transaction-free graph starts the ORDINARY
 *    path with `dryRun: false`, reaches the read nodes, checkpoints them,
 *    settles the workflow's OWN result (bound to its declared result schema,
 *    never the preview schema), and shows exact zero deltas in every
 *    write-authority table;
 * 2. the person-lookup T1b manifest's every expectation equals the evidence
 *    the runtime actually collects — the checked-in declaration is the
 *    pinned vocabulary, not a guess;
 * 3. the two graph refusals: a `live-read` manifest on a transaction-bearing
 *    graph, and a `dry-run-preview` manifest on a transaction-free graph, each
 *    refuse before any effect and by name; and D209's own `no-transaction-node`
 *    refusal of `dryRun: true` on that graph is unchanged.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../src/config/runtime-isolation.js";
import { workflowDryRunSupport } from "../../src/base/workflow.js";
import { evaluateDryRunScenarioEvidence } from "../../src/core/dry-run-scenario-runner.js";
import { manualClock } from "../../src/domain/clock.js";
import { parseDryRunScenarioManifest } from "../../src/domain/trust/dry-run-scenario.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import { createProductionDryRunScenarioRuntime } from "../../src/server/dry-run-scenario/runtime.js";
import { PersonLookupCanonicalInput } from "../../src/workflows/person-lookup/workflow.js";
import { PERSON_LOOKUP_LIVE_READ } from "../scenario/workflows/person-lookup/dry-run.scenario.js";
import { SEPARATIONS_DRY_RUN } from "../scenario/workflows/separations/dry-run.scenario.js";
import { selectedSettingsFixture } from "./fixtures/dry-run-admission-fixtures.js";
import { fixtureDuoCeremonyGates } from "./fixtures/duo-ceremony-fixtures.js";
import {
  EXECUTOR_EID,
  healthyCrmDriver,
  healthyUcpathDriver,
  sessionFactoryHarness,
} from "./fixtures/phase1f-executor-harness.js";
import { sequentialIdFactory } from "./fixtures/phase1f-run-fixtures.js";
import { personLookupDescriptor, separationsDescriptor } from "../helpers/registered-workflows.js";

const roots: string[] = [];
const databases: AuthorityDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const CANONICAL_INPUT = PersonLookupCanonicalInput.parse({
  emplId: EXECUTOR_EID,
  keepNonHdh: false,
  includeCrmDates: false,
});

function composedRoot(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  writeFileSync(join(root, "package.json"), readFileSync(join(process.cwd(), "package.json"), "utf8"));
  mkdirSync(join(root, rebuildRuntimeIsolation.stateRoot), { recursive: true });
  const clock = manualClock(new Date("2026-09-02T18:00:00.000Z"));
  return { root, clock };
}

describe("D318 live-read T1b arm — person-lookup", () => {
  it("starts the ordinary path under dryRun=false, settles the workflow's own result and shows exact zero write deltas", async () => {
    const { root, clock } = composedRoot("hrauto-live-read-");
    selectedSettingsFixture(root, clock, {}, databases).activate();
    const sessions = sessionFactoryHarness({
      ucpath: () => healthyUcpathDriver(),
      crm: () => healthyCrmDriver(),
    });
    const runtime = createProductionDryRunScenarioRuntime({
      isolation: rebuildRuntimeIsolation,
      repoRoot: root,
      env: {},
      clock,
      ids: sequentialIdFactory("e"),
      sessionFactory: sessions.factory,
      duoCeremony: fixtureDuoCeremonyGates(clock),
      processId: 4243,
      processIdentityObserver: (pid) => ({
        state: "alive",
        identity: { platform: "darwin", startToken: `synthetic-${String(pid)}` },
      }),
      write: () => undefined,
    });
    const scenarioCase = PERSON_LOOKUP_LIVE_READ.cases[0];
    assert.ok(scenarioCase);
    const started = await runtime.start({ manifest: PERSON_LOOKUP_LIVE_READ, scenarioCase, canonicalInput: CANONICAL_INPUT });
    assert.deepEqual(started.writeSafetyBefore, { writeIntents: 0, writeAttempts: 0, durableOutbox: 0 });

    const database = AuthorityDatabase.open(
      { path: join(root, rebuildRuntimeIsolation.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "live-read-test" },
      clock,
    );
    databases.push(database);
    const queued = database.authority.runs.get(started.runId);
    assert.ok(queued !== undefined);
    assert.equal(queued.envelope.dryRun, false, "a live read is the ordinary path; dryRun is false");

    await runtime.drain(PERSON_LOOKUP_LIVE_READ.workflow);
    const evidence = await runtime.collectEvidence(started.runId);
    const assertions = evaluateDryRunScenarioEvidence(scenarioCase, started.writeSafetyBefore, evidence);
    assert.deepEqual(
      assertions.map(({ assertionId, verdict, reason }) => `${assertionId}:${verdict}:${reason}`),
      [
        "nodes-reached:met:nodes-reached-match",
        "nodes-excluded:met:nodes-excluded-match",
        "checkpoints:met:checkpoints-match",
        "gate-results:met:gate-results-match",
        "write-safety-deltas:met:write-safety-deltas-zero",
        "receipt:met:receipt-match",
        "terminal:met:terminal-match",
      ],
      JSON.stringify(evidence, null, 2),
    );
    // The result row is the workflow's OWN result, never a preview.
    const result = database.authority.runResults.get(started.runId);
    assert.ok(result !== undefined);
    assert.equal(result.result.value !== null && typeof result.result.value === "object" && "activeStatus" in result.result.value, true);
    assert.equal(sessions.opens("ucpath"), 1);
    assert.equal(sessions.opens("crm"), 1);
  });

  it("refuses a live-read manifest on a transaction-bearing graph, and a preview manifest on a transaction-free graph, before any effect", async () => {
    const { root, clock } = composedRoot("hrauto-live-read-refusals-");
    const database = AuthorityDatabase.open(
      { path: join(root, rebuildRuntimeIsolation.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "live-read-refusal-test" },
      clock,
    );
    database.close();
    const runtime = createProductionDryRunScenarioRuntime({
      isolation: rebuildRuntimeIsolation,
      repoRoot: root,
      env: {},
      clock,
      ids: sequentialIdFactory("f"),
      drainWorker: () => Promise.reject(new Error("a refused admission must not drain")),
    });

    const separationsAsLiveRead = parseDryRunScenarioManifest({
      scenarioId: "separations/live-read",
      workflow: "separations",
      arm: "live-read",
      recordedBy: "refusal fixture",
      cases: [{
        ...PERSON_LOOKUP_LIVE_READ.cases[0],
        subjectLabel: "finalization-canary",
        subjectKind: "full-chain-dry-run",
        nodesReached: ["resolve-action"],
        nodesExcluded: [],
        checkpoints: [],
      }],
    });
    const liveReadCase = separationsAsLiveRead.cases[0];
    assert.ok(liveReadCase);
    await assert.rejects(
      runtime.start({ manifest: separationsAsLiveRead, scenarioCase: liveReadCase, canonicalInput: {} }),
      /live-read manifest separations\/live-read names workflow separations, whose compiled graph carries transaction node\(s\) clear-pending, file-termination, finalize-kuali; a transaction-bearing graph must declare the dry-run-preview arm \(D318\)/u,
    );

    const personLookupAsPreview = parseDryRunScenarioManifest({
      ...SEPARATIONS_DRY_RUN,
      scenarioId: "person-lookup/dry-run",
      workflow: "person-lookup",
      transactionNode: "searching",
    });
    const previewCase = personLookupAsPreview.cases[0];
    assert.ok(previewCase);
    await assert.rejects(
      runtime.start({ manifest: personLookupAsPreview, scenarioCase: previewCase, canonicalInput: CANONICAL_INPUT }),
      /dry-run-preview manifest person-lookup\/dry-run names workflow person-lookup, whose compiled graph has no transaction node; a transaction-free graph must declare the live-read arm \(D318\) — D209 still refuses dryRun for it \(no-transaction-node\)/u,
    );
    // D209 is unchanged: the graph itself still refuses a dry run by name.
    assert.deepEqual(workflowDryRunSupport(personLookupDescriptor), { state: "unsupported", reason: "no-transaction-node" });
    assert.equal(workflowDryRunSupport(separationsDescriptor).state, "supported");
  });
});
