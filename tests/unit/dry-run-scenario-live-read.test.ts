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
import { DryRunScenarioEvidenceSchema, evaluateDryRunScenarioEvidence } from "../../src/core/dry-run-scenario-runner.js";
import { manualClock } from "../../src/domain/clock.js";
import { parseDryRunScenarioManifest } from "../../src/domain/trust/dry-run-scenario.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import { PersonLookupCanonicalInput } from "../../src/workflows/person-lookup/workflow.js";
import { selectedSettingsFixture } from "./fixtures/dry-run-admission-fixtures.js";
import { fixtureDuoCeremonyGates } from "../helpers/duo-ceremony-fixtures.js";
import {
  EXECUTOR_EID,
  healthyCrmDriver,
  healthyUcpathDriver,
  sessionFactoryHarness,
} from "../helpers/phase1f-executor-harness.js";
import { sequentialIdFactory } from "../fixtures/phase1f-run-fixtures.js";
import { personLookupDescriptor, separationsDescriptor } from "../helpers/registered-workflows.js";
import { evaluateT1bManifest } from "../helpers/t1b-manifests.js";
import { z } from "zod";
import { flow } from "../../src/base/flow.js";
import { defineWorkflowDescriptor } from "../../src/base/workflow.js";
import { DelegationEdgeIdSchema, ItemIdSchema, WorkflowIdSchema } from "../../src/domain/ids.js";
import { defineCanonicalInput } from "../../src/domain/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../src/domain/workflow/presentation.js";
import { GraphNodeKindSchema } from "../../src/domain/workflow/graph.js";
import {
  createProductionDryRunScenarioRuntime,
  LIVE_READ_ADMITTED_NODE_KINDS,
  liveReadGraphRefusal,
} from "../../src/server/dry-run-scenario/runtime.js";
import { HASH_A, UUID_7 } from "../fixtures/phase1c-contract-fixtures.js";

// The checked-in declarations, evaluated without importing them: a collected
// file may never import a T1b manifest (the pair invariant), and the exact
// checked-in bytes are what this proof pins.
const PERSON_LOOKUP_LIVE_READ = evaluateT1bManifest(process.cwd(), "tests/scenario/workflows/person-lookup/dry-run.scenario.ts");
const SEPARATIONS_DRY_RUN = evaluateT1bManifest(process.cwd(), "tests/scenario/workflows/separations/dry-run.scenario.ts");

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
  it.each([true, false])("starts the ordinary path with browser.headless=%s, retains its mode and shows exact zero write deltas", async (headless) => {
    const { root, clock } = composedRoot("hrauto-live-read-");
    const settings = selectedSettingsFixture(root, clock, {}, databases);
    settings.apply({ "browser.headless": headless });
    settings.activate();
    const sessions = sessionFactoryHarness({
      ucpath: () => healthyUcpathDriver(),
      crm: () => healthyCrmDriver(),
    });
    let acquiringFailedAttempt = true;
    const runtime = createProductionDryRunScenarioRuntime({
      isolation: rebuildRuntimeIsolation,
      repoRoot: root,
      env: {},
      clock,
      ids: sequentialIdFactory("e"),
      sessionFactory: {
        open: async (input) => {
          if (acquiringFailedAttempt) throw new Error("fixture session acquisition failed before any checkpoint");
          assert.equal(input.browserMode, headless ? "headless" : "headed", "the actual worker launch must honor the retained scenario mode");
          return sessions.factory.open(input);
        },
      },
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
    // The old test selection remains failed. A replacement private input gets a
    // new opaque identity, so its ordinal cannot collide with the old selection.
    const binding = { kind: "test-data-local", inputPath: "emplId", name: "personLookupCanaryEid" } as const;
    const previous = await runtime.start({ manifest: PERSON_LOOKUP_LIVE_READ, scenarioCase, canonicalInput: CANONICAL_INPUT,
      protectedBindings: [{ ...binding, sourceId: "aaaaaaaa-0001-4000-8000-000000000010" }] });
    await runtime.drain(PERSON_LOOKUP_LIVE_READ.workflow);
    const replacementBindings = [{ ...binding, sourceId: "aaaaaaaa-0001-4000-8000-000000000011" }];
    const failedReplacement = await runtime.start({ manifest: PERSON_LOOKUP_LIVE_READ, scenarioCase,
      canonicalInput: CANONICAL_INPUT, protectedBindings: replacementBindings });
    await runtime.drain(PERSON_LOOKUP_LIVE_READ.workflow);
    const secondFailedReplacement = await runtime.start({ manifest: PERSON_LOOKUP_LIVE_READ, scenarioCase,
      canonicalInput: CANONICAL_INPUT, protectedBindings: replacementBindings });
    await runtime.drain(PERSON_LOOKUP_LIVE_READ.workflow);
    acquiringFailedAttempt = false;
    const started = await runtime.start({ manifest: PERSON_LOOKUP_LIVE_READ, scenarioCase,
      canonicalInput: CANONICAL_INPUT, protectedBindings: replacementBindings });
    assert.notEqual(started.runId, previous.runId);
    assert.deepEqual(started.writeSafetyBefore, { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 });

    const database = AuthorityDatabase.open(
      { path: join(root, rebuildRuntimeIsolation.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "live-read-test" },
      clock,
    );
    databases.push(database);
    const queued = database.authority.runs.get(started.runId);
    assert.ok(queued !== undefined);
    assert.equal(queued.envelope.browserMode, headless ? "headless" : "headed");
    assert.equal(queued.envelope.dryRun, false, "a live read is the ordinary path; dryRun is false");
    assert.equal(queued.envelope.attempt, 3, "both failed replacement attempts remain spent");
    const secondRetained = database.authority.runs.get(secondFailedReplacement.runId);
    assert.equal(secondRetained?.envelope.attempt, 2);
    assert.equal(secondRetained?.envelope.itemId, queued.envelope.itemId);
    assert.equal(secondRetained?.lifecycle.state === "terminal" ? secondRetained.lifecycle.outcome : undefined, "failed");
    const retainedReplacement = database.authority.runs.get(failedReplacement.runId);
    assert.equal(retainedReplacement?.envelope.attempt, 1);
    assert.equal(retainedReplacement?.envelope.itemId, queued.envelope.itemId);
    assert.equal(retainedReplacement?.lifecycle.state, "terminal");
    assert.equal(retainedReplacement?.lifecycle.state === "terminal" ? retainedReplacement.lifecycle.outcome : undefined, "failed");
    const retained = database.authority.runs.get(previous.runId);
    assert.equal(retained?.envelope.attempt, 1);
    assert.notEqual(queued.envelope.itemId, retained?.envelope.itemId, "replacement identity cannot reuse the prior subject's checkpoints");
    assert.equal(retained?.lifecycle.state, "terminal");
    assert.equal(retained?.lifecycle.state === "terminal" ? retained.lifecycle.outcome : undefined, "failed");
    assert.deepEqual(database.authority.runCheckpoints.listByItem(queued.envelope.workflow, queued.envelope.itemId), []);

    await runtime.drain(PERSON_LOOKUP_LIVE_READ.workflow);
    const evidence = await runtime.collectEvidence(started.runId);
    const assertions = evaluateDryRunScenarioEvidence(PERSON_LOOKUP_LIVE_READ.arm, scenarioCase, started.writeSafetyBefore, evidence);
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
    const observed = DryRunScenarioEvidenceSchema.parse(evidence);
    for (const staleAttempt of [1, 2]) {
      const wrongAttempt = evaluateDryRunScenarioEvidence(
        PERSON_LOOKUP_LIVE_READ.arm, scenarioCase, started.writeSafetyBefore,
        { ...observed, checkpoints: observed.checkpoints.map((row) => ({ ...row, attempt: staleAttempt })) },
      );
      assert.equal(wrongAttempt.find((row) => row.assertionId === "checkpoints")?.verdict, "failed",
        "spent-attempt evidence cannot satisfy the replacement's exact attempt-3 rehearsal");
    }
    // The result row is the workflow's OWN result, never a preview.
    const result = database.authority.runResults.get(started.runId);
    assert.ok(result !== undefined);
    assert.equal(result.result.value !== null && typeof result.result.value === "object" && "activeStatus" in result.result.value, true);
    assert.equal(sessions.opens("ucpath"), 1);
    assert.equal(sessions.opens("crm"), 1);

    // A persisted live-read result binds to THIS ordinary run — at insert and
    // again at every database open (the invariant sweep) — while a preview
    // result may never cite a run that was not a dry run.
    const persisted = {
      resultId: "aaaaaaaa-0001-4000-8000-000000000001",
      scenarioId: PERSON_LOOKUP_LIVE_READ.scenarioId,
      workflow: PERSON_LOOKUP_LIVE_READ.workflow,
      subjectLabel: scenarioCase.subjectLabel,
      manifestDigest: "a".repeat(64),
      verdict: "met",
      execution: { state: "started", arm: "live-read", runId: started.runId, traceId: started.traceId },
      assertions,
      wallTimeMs: 1,
      recordedAt: clock.now().toISOString(),
    };
    assert.equal(database.authority.dryRunScenarioResults.insert(persisted).state, "inserted");
    assert.throws(
      () => database.authority.dryRunScenarioResults.insert({
        ...persisted,
        resultId: "aaaaaaaa-0002-4000-8000-000000000002",
        execution: { state: "started", arm: "dry-run-preview", runId: started.runId, traceId: started.traceId },
      }),
      /does not match its dry-run execution/u,
    );
    database.close();
    const reopened = AuthorityDatabase.open(
      { path: join(root, rebuildRuntimeIsolation.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "live-read-reopen" },
      clock,
    );
    reopened.close();
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
  it("refuses a manifest whose arm disagrees with its case shape before any graph or effect check (D318)", async () => {
    const { root, clock } = composedRoot("hrauto-live-read-arm-shape-");
    const database = AuthorityDatabase.open(
      { path: join(root, rebuildRuntimeIsolation.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "live-read-arm-shape-test" },
      clock,
    );
    database.close();
    const runtime = createProductionDryRunScenarioRuntime({
      isolation: rebuildRuntimeIsolation,
      repoRoot: root,
      env: {},
      clock,
      ids: sequentialIdFactory("g"),
      drainWorker: () => Promise.reject(new Error("a refused admission must not drain")),
    });
    const previewCase = SEPARATIONS_DRY_RUN.cases[0];
    const liveReadCase = PERSON_LOOKUP_LIVE_READ.cases[0];
    assert.ok(previewCase && "preview" in previewCase);
    assert.ok(liveReadCase && !("preview" in liveReadCase));
    // A live-read manifest on the transaction-free person-lookup graph would
    // otherwise be admitted; the preview-shaped case refuses first.
    await assert.rejects(
      runtime.start({ manifest: PERSON_LOOKUP_LIVE_READ, scenarioCase: previewCase, canonicalInput: CANONICAL_INPUT }),
      /live-read manifest person-lookup\/live-read carries a preview-arm case; the arms are exclusive/u,
    );
    // A preview manifest on the transaction-bearing separations graph would
    // otherwise pass its support check; the live-read-shaped case refuses first.
    await assert.rejects(
      runtime.start({ manifest: SEPARATIONS_DRY_RUN, scenarioCase: liveReadCase, canonicalInput: {} }),
      /dry-run-preview manifest separations\/dry-run carries a live-read case; the arms are exclusive/u,
    );
  });

  it("refuses the live-read arm for a delegating graph: a child run's writes live under its own run, outside this run's zero-delta proof (D318)", () => {
    const DelegateInput = z.strictObject({ name: z.string().min(1) });
    const delegatingFlow = flow(DelegateInput)
      .childRun("delegate", {
        id: WorkflowIdSchema.parse("person-lookup"),
        input: z.strictObject({ emplId: z.string().min(1) }),
        result: z.strictObject({ ok: z.boolean() }),
      }, {
        dependsOn: [],
        edgeId: DelegationEdgeIdSchema.parse("live-read-delegate"),
        cardinality: "one",
        bind: () => ({ emplId: EXECUTOR_EID }),
        deriveChildItemId: () => ItemIdSchema.parse(UUID_7),
        await: "terminal",
        join: "one",
        policy: {
          onChildFailed: "fail-parent",
          cascadeCancel: "cascade",
          afterChildRetry: "resume-parent",
          visibility: "inline",
        },
      })
      .build({ schema: z.strictObject({ ok: z.boolean() }), dependsOn: [], derive: () => ({ ok: true }) });
    const delegating = defineWorkflowDescriptor({
      id: "live-read-delegating-fixture",
      version: 1,
      contractFingerprint: HASH_A,
      code: "ld",
      label: "Delegating fixture",
      icon: "Search",
      category: "operations",
      canonicalInput: defineCanonicalInput(DelegateInput, DelegateInput, [{ name: "Battistessa, Johnnie" }]),
      inputSubject: "name",
      surface: { shape: "single" },
      enqueue: "reject-active",
      actions: STANDARD_WORKFLOW_ACTIONS,
      surfaces: {},
      details: [],
      identity: { matchKey: (input: z.output<typeof DelegateInput>) => `name:${input.name}` },
      presentation: { title: (input: z.output<typeof DelegateInput>) => input.name },
      scenarios: ["live-read-delegating-fixture/happy"],
      flow: delegatingFlow,
    });
    // No transaction node, so the transaction refusal cannot be what fires.
    assert.deepEqual(workflowDryRunSupport(delegating), { state: "unsupported", reason: "no-transaction-node" });
    assert.match(
      liveReadGraphRefusal(delegating, "fixture/live-read") ?? "",
      /live-read manifest fixture\/live-read names workflow live-read-delegating-fixture, whose compiled graph carries child-run node\(s\) delegate; a delegating graph runs its child under its own run and write intents, which this run's zero-delta proof cannot see — no live-read arm admits it \(D318\)/u,
    );
    assert.equal(liveReadGraphRefusal(personLookupDescriptor, "person-lookup/live-read"), undefined);
    assert.match(liveReadGraphRefusal(separationsDescriptor, "separations/live-read") ?? "", /transaction node\(s\)/u);
  });

  it("classifies every graph node kind for the live-read arm: admitted kinds plus the two refused kinds are exactly the vocabulary", () => {
    // Fail closed: a kind added to the graph vocabulary must be classified here
    // before a dryRun=false live-read may carry it. This pin turns red on the
    // addition, not on the first live run that meets the new kind.
    const refused = ["transaction", "child-run"] as const;
    for (const kind of refused) assert.equal(LIVE_READ_ADMITTED_NODE_KINDS.has(kind), false);
    assert.deepEqual(
      [...GraphNodeKindSchema.options].sort(),
      [...LIVE_READ_ADMITTED_NODE_KINDS, ...refused].sort(),
    );
  });
});
