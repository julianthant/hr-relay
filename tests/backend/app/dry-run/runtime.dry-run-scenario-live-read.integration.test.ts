import { createDryRunCompositionTestWorld } from "../../../support/helpers/backend/dry-run-composition-world.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { healthyRuntimePreflightRunners } from "../../../support/fixtures/preflight-seams.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readTimelineRecords } from "../../../../src/backend/storage/events/timeline-reader.js";
import {mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { createProductionDryRunScenarioRuntime, LIVE_READ_ADMITTED_NODE_KINDS, liveReadGraphRefusal } from "../../../../src/backend/app/dry-run/runtime.js";
import { DryRunScenarioEvidenceSchema, evaluateDryRunScenarioEvidence } from "../../../../src/backend/runs/start/dry-run-scenario-runner.js";
import { parseDryRunScenarioManifest } from "../../../../src/models/trust/dry-run-scenario.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { GraphNodeKindSchema } from "../../../../src/models/workflow/graph.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { DelegationEdgeIdSchema, ItemIdSchema, WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { flow } from "../../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor, workflowDryRunSupport } from "../../../../src/workflow-kit/workflow.js";
import { PersonLookupCanonicalInput } from "../../../../src/workflows/person-lookup/workflow.js";
import { selectedSettingsFixture } from "../../../support/fixtures/integration/dry-run-admission-fixtures.js";
import { HASH_A, UUID_7 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { fixtureDuoCeremonyGates } from "../../../support/helpers/duo-ceremony-fixtures.js";
import { EXECUTOR_EID, healthyCrmDriver, healthyUcpathDriver, sessionFactoryHarness } from "../../../support/helpers/phase1f-executor-harness.js";
import { personLookupDescriptor, separationsDescriptor } from "../../../support/helpers/registered-workflows.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";
import { evaluateT1bManifest } from "../../../support/helpers/t1b-manifests.js";

const { roots, databases, cleanup } = createDryRunCompositionTestWorld();



const PERSON_LOOKUP_LIVE_READ = evaluateT1bManifest(process.cwd(), "tests/support/fixtures/dry-run/person-lookup-manifest.ts");
const SEPARATIONS_DRY_RUN = evaluateT1bManifest(process.cwd(), "tests/support/fixtures/dry-run/separations-manifest.ts");
afterEach(cleanup);

const CANONICAL_INPUT = PersonLookupCanonicalInput.parse({
  mode: "search", crmCheck: true,
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

describe("live-read arm — person-lookup", () => {
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
    const runtime = createProductionDryRunScenarioRuntime({ admission: RuntimeAdmission.syntheticRoots(join(root, rebuildRuntimeIsolation.stateRoot), join(root, rebuildRuntimeIsolation.artifactRoot)),
      preflightRunnerFactory: healthyRuntimePreflightRunners,
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

  it.each([true, false])("retains screenshot opt-in=%s and collects verified task-point action identities", async (enabled) => {
    const { root, clock } = composedRoot("hrauto-scenario-captures-");
    const settings = selectedSettingsFixture(root, clock, {}, databases);
    settings.activate();
    const sessions = sessionFactoryHarness({ ucpath: () => healthyUcpathDriver(), crm: () => healthyCrmDriver() });
    let captures = 0;
    const runtime = createProductionDryRunScenarioRuntime({
      admission: RuntimeAdmission.syntheticRoots(join(root, rebuildRuntimeIsolation.stateRoot), join(root, rebuildRuntimeIsolation.artifactRoot)),
      preflightRunnerFactory: healthyRuntimePreflightRunners, isolation: rebuildRuntimeIsolation,
      repoRoot: root, env: {}, clock, ids: sequentialIdFactory("e"),
      sessionFactory: { async open(input) {
        const resource = await sessions.factory.open(input);
        return { ...resource, async screenshot() {
          captures += 1;
          return { state: "available" as const, bytes: new Uint8Array([137, 80, 78, 71]), width: 1280, height: 720,
            sessionId: resource.sessionId, pageVersion: 1, observedAt: clock.now().toISOString() };
        } };
      } }, duoCeremony: fixtureDuoCeremonyGates(clock), processId: 4243,
      processIdentityObserver: pid => ({ state: "alive", identity: { platform: "darwin", startToken: `synthetic-${String(pid)}` } }),
      write: () => undefined,
    });
    const base = PERSON_LOOKUP_LIVE_READ.cases[0];
    assert.ok(base);
    const candidateCase = { ...base, checkpoints: base.checkpoints.map(row => ({ ...row, attempt: 1 })),
      ...(enabled ? { screenshots: { nodes: ["searching", "crm-selected-record"] } } : {}) };
    const manifest = parseDryRunScenarioManifest({ ...PERSON_LOOKUP_LIVE_READ, cases: [candidateCase] });
    const scenarioCase = manifest.cases[0];
    assert.ok(scenarioCase);
    const started = await runtime.start({ manifest, scenarioCase, canonicalInput: CANONICAL_INPUT });
    const database = AuthorityDatabase.open({ path: join(root, rebuildRuntimeIsolation.stateRoot, "state.db"),
      busyTimeoutMs: 250, migrationOwner: "scenario-captures-test" }, clock);
    databases.push(database);
    assert.equal(database.authority.runs.get(started.runId)?.envelope.captureBrowserScreenshots, enabled);
    await runtime.drain(manifest.workflow);
    const evidence = DryRunScenarioEvidenceSchema.parse(await runtime.collectEvidence(started.runId));
    assert.equal(captures, enabled ? 2 : 0);
    assert.equal(database.authority.diagnosticBundles.listByRun(started.runId).length, enabled ? 2 : 0);
    const assertions = evaluateDryRunScenarioEvidence(manifest.arm, scenarioCase, started.writeSafetyBefore, evidence);
    assert.deepEqual(assertions.filter(row => row.verdict !== "met"), []);
    assert.equal(assertions.find(row => row.assertionId === "screenshot-actions")?.verdict, enabled ? "met" : undefined);
    if (!enabled) return;
    const rows = readTimelineRecords(database.authority.timelineEvents, 0, started.runId).records;
    const action = rows.find(row => row.payload.kind === "note" && row.payload.note.action?.kind === "screenshot");
    assert.ok(action?.payload.kind === "note" && "runId" in action.payload.note && action.payload.note.action);
    const note = action.payload.note;
    const raw = new DatabaseSync(join(root, rebuildRuntimeIsolation.stateRoot, "state.db"));
    const trigger = z.object({ sql: z.string() }).parse(raw.prepare("SELECT sql FROM sqlite_master WHERE name='timeline_events_immutable'").get());
    const stored = z.object({ payload_json: z.string() }).parse(raw.prepare("SELECT payload_json FROM timeline_events WHERE cursor=?").get(action.cursor));
    try {
      for (const change of [
        { name: "missing", note: { ...note, action: { ...note.action, kind: "read" } }, named: false },
        { name: "wrong-node", note: { ...note, spanPath: note.spanPath.replace(/[^/]+#/u, "crm-identity#") }, named: true },
        { name: "wrong-session", note: { ...note, action: { ...note.action, physicalSessionId: randomUUID() } }, named: true },
        { name: "wrong-reference", note: { ...note, action: { ...note.action, value: `${randomUUID()}:${randomUUID()}` } }, named: true },
      ]) {
        raw.exec("DROP TRIGGER timeline_events_immutable");
        raw.prepare("UPDATE timeline_events SET payload_json=? WHERE cursor=?")
          .run(JSON.stringify({ ...action, payload: { kind: "note", note: change.note } }), action.cursor);
        raw.exec(trigger.sql);
        if (change.named) {
          await assert.rejects(runtime.collectEvidence(started.runId), { name: "LogIdentityRefusedError" }, change.name);
        } else {
          const incomplete = await runtime.collectEvidence(started.runId);
          assert.equal(evaluateDryRunScenarioEvidence(manifest.arm, scenarioCase, started.writeSafetyBefore, incomplete)
            .find(row => row.assertionId === "screenshot-actions")?.verdict, "failed");
        }
        raw.exec("DROP TRIGGER timeline_events_immutable");
        raw.prepare("UPDATE timeline_events SET payload_json=? WHERE cursor=?").run(stored.payload_json, action.cursor);
        raw.exec(trigger.sql);
      }
    } finally {
      raw.exec("DROP TRIGGER IF EXISTS timeline_events_immutable");
      raw.prepare("UPDATE timeline_events SET payload_json=? WHERE cursor=?").run(stored.payload_json, action.cursor);
      raw.exec(trigger.sql);
      raw.close();
    }
    const { cursor: _cursor, ...append } = action;
    for (let index = 0; index < 501; index += 1) {
      database.authority.timelineEvents.append({ ...append, eventId: randomUUID(),
        payload: { kind: "note", note: { ...note, action: { kind: "read", targetId: "ucpath.fixture-page" } } } });
    }
    database.authority.timelineEvents.append({ ...append, eventId: randomUUID() });
    const duplicate = await runtime.collectEvidence(started.runId);
    assert.equal(evaluateDryRunScenarioEvidence(manifest.arm, scenarioCase, started.writeSafetyBefore, duplicate)
      .find(row => row.assertionId === "screenshot-actions")?.verdict, "failed");
    const bundle = database.authority.diagnosticBundles.listByRun(started.runId)[0];
    const attachment = bundle?.attachments[0];
    assert.ok(attachment);
    unlinkSync(join(root, rebuildRuntimeIsolation.artifactRoot, `${attachment.digest}.artifact`));
    await assert.rejects(runtime.collectEvidence(started.runId), { name: "DiagnosticBundleBytesMissingError" });

  });

  it("executes fresh live-read tasks when the subject already has replayable checkpoints", async () => {
    const { root, clock } = composedRoot("hrauto-scenario-fresh-reads-");
    const settings = selectedSettingsFixture(root, clock, {}, databases);
    settings.activate();
    const sessions = sessionFactoryHarness({ ucpath: () => healthyUcpathDriver(), crm: () => healthyCrmDriver() });
    const runtime = createProductionDryRunScenarioRuntime({
      admission: RuntimeAdmission.syntheticRoots(join(root, rebuildRuntimeIsolation.stateRoot), join(root, rebuildRuntimeIsolation.artifactRoot)),
      preflightRunnerFactory: healthyRuntimePreflightRunners, isolation: rebuildRuntimeIsolation,
      repoRoot: root, env: {}, clock, ids: sequentialIdFactory("e"),
      sessionFactory: sessions.factory, duoCeremony: fixtureDuoCeremonyGates(clock), processId: 4243,
      processIdentityObserver: pid => ({ state: "alive", identity: { platform: "darwin", startToken: `synthetic-${String(pid)}` } }),
      write: () => undefined,
    });
    const base = PERSON_LOOKUP_LIVE_READ.cases[0];
    assert.ok(base);
    const manifest = parseDryRunScenarioManifest({ ...PERSON_LOOKUP_LIVE_READ,
      cases: [{ ...base, checkpoints: base.checkpoints.map(row => ({ ...row, attempt: 1 })) }] });
    const scenarioCase = manifest.cases[0];
    assert.ok(scenarioCase);
    const previous = await runtime.start({ manifest, scenarioCase, canonicalInput: CANONICAL_INPUT });
    await runtime.drain(manifest.workflow);
    const firstEvidence = DryRunScenarioEvidenceSchema.parse(await runtime.collectEvidence(previous.runId));
    assert.deepEqual(evaluateDryRunScenarioEvidence(manifest.arm, scenarioCase, previous.writeSafetyBefore, firstEvidence)
      .filter(row => row.verdict !== "met"), []);
    const started = await runtime.start({ manifest, scenarioCase, canonicalInput: CANONICAL_INPUT });
    await runtime.drain(manifest.workflow);
    const evidence = DryRunScenarioEvidenceSchema.parse(await runtime.collectEvidence(started.runId));
    assert.equal(sessions.opens("ucpath"), 2, "a replayable searching checkpoint must not replace the second UCPath read");
    assert.deepEqual(evidence.reachedNodeIds, scenarioCase.nodesReached);
    assert.ok(evidence.checkpoints.every(row => row.attempt === 2));
    assert.deepEqual(evaluateDryRunScenarioEvidence(manifest.arm, scenarioCase, started.writeSafetyBefore, evidence)
      .filter(row => row.verdict !== "met"), []);
  });

  it("refuses a live-read manifest on a transaction-bearing graph, and a preview manifest on a transaction-free graph, before any effect", async () => {
    const { root, clock } = composedRoot("hrauto-live-read-refusals-");
    const database = AuthorityDatabase.open(
      { path: join(root, rebuildRuntimeIsolation.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "live-read-refusal-test" },
      clock,
    );
    database.close();
    const runtime = createProductionDryRunScenarioRuntime({ admission: RuntimeAdmission.syntheticRoots(join(root, rebuildRuntimeIsolation.stateRoot), join(root, rebuildRuntimeIsolation.artifactRoot)),
      preflightRunnerFactory: healthyRuntimePreflightRunners,
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
      /live-read manifest separations\/live-read names workflow separations, whose compiled graph carries transaction node\(s\) clear-pending, file-termination, finalize-kuali; a transaction-bearing graph must declare the dry-run-preview arm/u,
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
      /dry-run-preview manifest person-lookup\/dry-run names workflow person-lookup, whose compiled graph has no transaction node; a transaction-free graph must declare the live-read arm — dryRun is refused for it \(no-transaction-node\)/u,
    );

    assert.deepEqual(workflowDryRunSupport(personLookupDescriptor), { state: "unsupported", reason: "no-transaction-node" });
    assert.equal(workflowDryRunSupport(separationsDescriptor).state, "supported");
  });
  it("refuses a manifest whose arm disagrees with its case shape before any graph or effect check", async () => {
    const { root, clock } = composedRoot("hrauto-live-read-arm-shape-");
    const database = AuthorityDatabase.open(
      { path: join(root, rebuildRuntimeIsolation.stateRoot, "state.db"), busyTimeoutMs: 250, migrationOwner: "live-read-arm-shape-test" },
      clock,
    );
    database.close();
    const runtime = createProductionDryRunScenarioRuntime({ admission: RuntimeAdmission.syntheticRoots(join(root, rebuildRuntimeIsolation.stateRoot), join(root, rebuildRuntimeIsolation.artifactRoot)),
      preflightRunnerFactory: healthyRuntimePreflightRunners,
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

  it("refuses the live-read arm for a delegating graph: a child run's writes live under its own run, outside this run's zero-delta proof", () => {
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
      /live-read manifest fixture\/live-read names workflow live-read-delegating-fixture, whose compiled graph carries child-run node\(s\) delegate; a delegating graph runs its child under its own run and write intents, which this run's zero-delta proof cannot see — no live-read arm admits it/u,
    );
    assert.equal(liveReadGraphRefusal(personLookupDescriptor, "person-lookup/live-read"), undefined);
    assert.match(liveReadGraphRefusal(separationsDescriptor, "separations/live-read") ?? "", /transaction node\(s\)/u);
  });

  it("classifies every graph node kind for the live-read arm: admitted kinds plus the two refused kinds are exactly the vocabulary", () => {

    const refused = ["transaction", "child-run"] as const;
    for (const kind of refused) assert.equal(LIVE_READ_ADMITTED_NODE_KINDS.has(kind), false);
    assert.deepEqual(
      [...GraphNodeKindSchema.options].sort(),
      [...LIVE_READ_ADMITTED_NODE_KINDS, ...refused].sort(),
    );
  });
});
