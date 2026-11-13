import * as profileCredentials from "../../../../src/backend/storage/configuration/credential-store.js";
import { createProfileFixtureSet, createSyntheticProfileSession, finishProfileOnboarding, installationAdmission, profileFixtureStorageAdmission, releaseAdmissionFixture, type BoundProfileStorageFixture } from "../../../support/helpers/admission-fixture.js";
import { afterAll } from "vitest";
import { TargetNotFoundError } from "../../../../src/backend/runs/commands/refusals.js";
import { testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { CHILD_ONLY_WORKFLOW_MODULES, READABLE_WORKFLOW_MODULES } from "../../../../src/backend/app/registries/workflow-registry.js";
import { runRecordColumns } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import { runSettlementColumns } from "../../../../src/backend/storage/sqlite/run-settlement-row.js";
import { completionFromAuthorization } from "../../../../src/models/run/completion.js";
import { FailureTerminalAuthorizationRecordSchema } from "../../../../src/models/run/terminal-authorization.js";
import { createRunTerminalEvidenceResult, deriveTerminalFailureDigest } from "../../../../src/models/run/result.js";
import { canonicalInputSamples } from "../../../../src/models/workflow/canonical-input.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

import assert from "node:assert/strict";
import { z } from "zod";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { DatabaseSync } from "node:sqlite";
import { FailureRecordSchema } from "../../../../src/models/trust/failure.js";
import { failureDebugDetails } from "../../../../src/backend/runtime/execution/run-failure.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { randomUUID } from "node:crypto";
import { createTrustRunReader } from "../../../../src/backend/runs/trust/canonical-reader.js";
import { requireTrustRun } from "../../../../src/backend/runs/trust/run-reader.js";
import { mkdtempSync,lstatSync,readFileSync,readdirSync,realpathSync,rmSync,symlinkSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it,vi } from "vitest";
import { composeExplainRuntime,explainRunFrom,parseDiagnosticArgs } from "../../../../src/backend/app/composition/explain-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { createDebugEventWriter } from "../../../../src/backend/logs/debug-events.js";
import { appendEmergencyFault } from "../../../../src/backend/logs/emergency-faults.js";
import { readLocalDebugLog } from "../../../../src/backend/storage/events/local-debug-log.js";
import { buildExplainRunView, renderExplainRun } from "../../../../src/backend/runs/explain/explain-run.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { timelineCheckpointReference, type TimelineAppend } from "../../../../src/models/events/timeline.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { RunIdSchema,WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import {
EXIT_RUN_ID,
EXIT_TRACE_ID,
seedPersonLookupExitRun,
} from "../../../support/fixtures/receipt-run-fixtures.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";
import { AuthorityDatabase as ProductionAuthorityDatabase } from "../../../../src/backend/storage/sqlite/index.js";
import { createProfileRegistry } from "../../../../src/backend/profiles/registry.js";

const profiles = createProfileFixtureSet();
const heldProfiles: BoundProfileStorageFixture[] = [];
afterAll(() => profiles.close());
const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const database of databases.splice(0)) database.close();
  for (const profile of heldProfiles.splice(0)) await profile.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// Registers a second ready profile on the fixture's machine and leaves the first selected.
async function addSecondProfile(profile: BoundProfileStorageFixture): Promise<string> {
  const registry = createProfileRegistry(profile.machine);
  const first = registry.read().activeProfileId; assert.ok(first);
  const session = createSyntheticProfileSession({ admission: profile.machine, machineRoot: profile.machine.stateRoot, activity: { hasUnquiescedWork: () => false } });
  try {
    registry.advanceSession(null);
    const draft = session.signUp({ firstName: "Second", lastName: "Example", email: "second@ucsd.edu", password: "disposable-fixture-password", createdAt: "2026-10-02T12:00:00.000Z" });
    assert.equal(draft.state, "onboarding");
    const active = await finishProfileOnboarding(session, draft);
    assert.equal(active.state, "active");
    assert.notEqual(registry.read().activeProfileId, first);
    return first;
  } finally { await session.close(); }
}

// Seeds a run-scoped debug event and closes the writer so the test may change the profile selection.
async function seededWithRunEvent(): Promise<void> {
  const database = await seeded();
  createDebugEventWriter({ repository: database.authority.timelineEvents, clock: manualClock(new Date("2026-08-04T00:11:13.500Z")), build: "fixture" })
    .emit({ category: "http", phase: "failed", correlationId: "run-scoped" }, { kind: "run", runId: RunIdSchema.parse(EXIT_RUN_ID) }, WorkflowIdSchema.parse("person-lookup"));
  databases.splice(databases.indexOf(database), 1); database.close();
}

async function seeded(seedRun = true): Promise<AuthorityDatabase> {
  const profile = await profiles.create(); heldProfiles.push(profile);
  const root = profile.stateRoot;
  const database = AuthorityDatabase.open(
    { path: join(root, "state.db"), busyTimeoutMs: 250, migrationOwner: "explain-test" },
    manualClock(new Date("2026-08-04T00:11:13.500Z")),
  );
  testWorkerPorts(database, manualClock(new Date("2026-08-04T00:11:13.500Z")), { path: join(root, "state.db"), descriptor: personLookupDescriptor, poolIndex: 1 });
  databases.push(database);
  if (seedRun) seedPersonLookupExitRun(database);
  return database;
}

function failedFollowup(database: AuthorityDatabase, attempt: number, retryOf?: string) {
  const source = requireTrustRun(createTrustRunReader(database), EXIT_RUN_ID);
  const runId = randomUUID();
  const now = source.updatedAt;
  database.authority.runs.enqueue({
    envelope: { ...source.envelope, runId, traceId: `pl-001113-${runId.slice(0, 4)}`, attempt,
      enqueuedAt: now, ...(retryOf === undefined ? {} : { retryOf }) },
    input: source.input, lifecycle: { state: "queued" }, claimGeneration: 0, version: 1,
    createdAt: now, updatedAt: now,
  });
  const slot = database.authority.workerSlots.list(personLookupDescriptor.id).find(entry => entry.poolIndex === 1);
  assert.ok(slot);
  const claimed = database.authority.runs.claimNext({ workflow: personLookupDescriptor.id, workerId: slot.workerId, now });
  assert.equal(claimed.state, "claimed");
  if (claimed.state !== "claimed") throw new Error("followup run was not claimed");
  let run = claimed.run;
  const claim = { workerId: slot.workerId, claimGeneration: run.claimGeneration };
  for (const state of ["validating", "running"] as const) {
    const changed = database.authority.runs.transition({ runId, expectedVersion: run.version, claim, now,
      lifecycle: { state, workerId: slot.workerId, claimedAt: now, heartbeatAt: now } });
    assert.equal(changed.state, "applied");
    if (changed.state !== "applied") throw new Error("followup run did not advance");
    run = changed.run;
  }
  const sourceCheckpoint = database.authority.runCheckpoints.listByItem(source.envelope.workflow, source.envelope.itemId)
    .find(entry => entry.runId === (retryOf ?? EXIT_RUN_ID) && entry.nodeId === "searching");
  assert.ok(sourceCheckpoint);
  if (retryOf === undefined) {
    database.authority.runCheckpoints.insert(RunCheckpointRecordSchema.parse({ ...sourceCheckpoint,
      runId, attempt, claimGeneration: run.claimGeneration, writtenAt: now }));
  } else {
    const writer = createDebugEventWriter({ repository: database.authority.timelineEvents,
      clock: manualClock(new Date(now)), build: "fixture" });
    for (let index = 0; index < 1001; index += 1) {
      writer.emit({ category: "worker", phase: "started", correlationId: `padding-${String(index)}` },
        { kind: "run", runId: run.envelope.runId }, run.envelope.workflow);
    }
    database.authority.timelineEvents.append({ schemaVersion: 1, eventId: randomUUID(), workflow: run.envelope.workflow,
      scope: { kind: "run", runId }, occurredAt: now, recordedAt: now, retentionDate: "2026-08-03", source: { kind: "native" },
      payload: { kind: "checkpoint-replayed", runId, workflow: run.envelope.workflow, attempt,
        claimGeneration: run.claimGeneration, checkpoint: timelineCheckpointReference(sourceCheckpoint) } });
  }
  const failure = FailureRecordSchema.parse({ failureId: randomUUID(), fingerprint: "f".repeat(64),
    runId, traceId: run.envelope.traceId, attempt, workflowId: run.envelope.workflow,
    code: "RUN_INTERRUPTED_BY_CRASH", summary: "fixture", transient: false, writeState: "not-attempted",
    causeChain: [{ code: "RUN_INTERRUPTED_BY_CRASH", summary: "fixture", role: "primary", transient: false }],
    remediation: [{ kind: "operator-action", message: "fixture" }], occurredAt: now });
  return database.terminalizeFailure(personLookupDescriptor, { failure,
    authorization: { kind: "failed", runId, workflowId: run.envelope.workflow, attempt,
      descriptorVersion: run.envelope.descriptorVersion, contractFingerprint: run.envelope.contractFingerprint,
      expectedVersion: run.version, claim, authorizedAt: now, failureId: failure.failureId } }).run;
}

async function failedChild(descriptor: AnyWorkflowDescriptor) {
  const database = await seeded();
  const source = requireTrustRun(createTrustRunReader(database), EXIT_RUN_ID);
  const profile = heldProfiles.at(-1); assert.ok(profile);
  const now = source.updatedAt;
  const runId = randomUUID();
  const traceId = `${descriptor.code}-001113-${runId.slice(0, 4)}`;
  const canonical = descriptor.canonicalInput.parse(canonicalInputSamples(descriptor.canonicalInput)[0]);
  const failure = FailureRecordSchema.parse({ failureId: randomUUID(), fingerprint: "f".repeat(64),
    runId, traceId, attempt: 1, workflowId: descriptor.id,
    code: "RUN_INTERRUPTED_BY_CRASH", summary: "Synthetic child failure", transient: false, writeState: "not-attempted",
    causeChain: [{ code: "RUN_INTERRUPTED_BY_CRASH", summary: "Synthetic child failure", role: "primary", transient: false }],
    remediation: [{ kind: "operator-action", message: "Inspect child failure" }], occurredAt: now });
  const authorization = FailureTerminalAuthorizationRecordSchema.parse({ kind: "failed", runId, workflowId: descriptor.id, attempt: 1,
    descriptorVersion: descriptor.version, contractFingerprint: descriptor.contractFingerprint,
    expectedVersion: 4, claim: { workerId: "fixture-child-worker", claimGeneration: 1 }, authorizedAt: now, failureId: failure.failureId });
  const terminal = RunRecordSchema.parse({ ...source,
    envelope: { ...source.envelope, runId, workflow: descriptor.id, itemId: randomUUID(), traceId,
      descriptorVersion: descriptor.version, contractFingerprint: descriptor.contractFingerprint, dryRun: true, enqueuedAt: now,
      parent: { runId: EXIT_RUN_ID, tracePrefix: EXIT_TRACE_ID, edgeId: "fixture-child" } },
    input: { ...source.input, raw: canonical, parsed: { protectedBindings: [],
      schemaHash: deriveSchemaHash(descriptor.canonicalInput, "output"), value: canonical } },
    lifecycle: { state: "terminal", outcome: "failed", endedAt: now, failureId: failure.failureId, errorSummary: failure.summary },
    completion: completionFromAuthorization(authorization), claimGeneration: 1, version: 5, createdAt: now, updatedAt: now,
  });
  const result = createRunTerminalEvidenceResult(terminal, { kind: "failed-evidence", authorization,
    failureDigest: deriveTerminalFailureDigest(failure) });
  // Insert a retained child snapshot without executing a workflow or changing immutable evidence.
  const raw = new DatabaseSync(join(profile.stateRoot, "state.db"));
  try {
    const runColumns = runRecordColumns(terminal);
    raw.prepare(`INSERT INTO runs (${Object.keys(runColumns).join(",")}) VALUES (${Object.keys(runColumns).map(() => "?").join(",")})`)
      .run(...Object.values(runColumns));
    raw.prepare("INSERT INTO run_failures (id, run_id, fingerprint, code, resolution_json, resolution_version, payload_json, created_at) VALUES (?, ?, ?, ?, '{\"status\":\"unresolved\",\"version\":1}', 1, ?, ?)")
      .run(failure.failureId, runId, failure.fingerprint, failure.code, canonicalJsonStringify(failure), now);
    const resultColumns = runSettlementColumns(terminal, result);
    raw.prepare(`INSERT INTO run_results (${Object.keys(resultColumns).join(",")}) VALUES (${Object.keys(resultColumns).map(() => "?").join(",")})`)
      .run(...Object.values(resultColumns));
  } finally { raw.close(); }
  assert.equal(requireTrustRun(createTrustRunReader(database), runId).envelope.parent?.runId, EXIT_RUN_ID);
  return { database, runId, failure };
}

describe("explain run", () => {
  it("explains a failed I-9 Lookup child with its own timeline, failure and receipt", async () => {
    const module = CHILD_ONLY_WORKFLOW_MODULES.find(entry => entry.descriptor.id === "i9-lookup");
    assert.ok(module);
    const { database, runId, failure } = await failedChild(module.descriptor);
    const view = explainRunFrom(database, runId);
    assert.equal(view.workflowId, "i9-lookup");
    assert.deepEqual(view.timeline.map(entry => entry.nodeId), ["lookup-source", "lookup"]);
    assert.ok(view.timeline.every(entry => entry.disposition === "no-record"));
    assert.deepEqual(view.outcome, { state: "present", value: "failed" });
    assert.equal(view.failure.state, "present");
    if (view.failure.state !== "present") throw new Error("child failure missing");
    assert.equal(view.failure.value.failureId, failure.failureId);
    assert.equal(view.failure.value.code, "RUN_INTERRUPTED_BY_CRASH");
    assert.equal(view.receipt.state, "present");
    if (view.receipt.state !== "present") throw new Error("child receipt missing");
    assert.equal(view.receipt.value.result, "failed");
    assert.deepEqual(explainRunFrom(database, view.traceId), view);
  });

  it.each(READABLE_WORKFLOW_MODULES.map(module => [String(module.descriptor.id), module.descriptor] as const))(
    "resolves the timeline of registered %s before settlement", async (workflowId, descriptor) => {
      const database = await seeded();
      const source = requireTrustRun(createTrustRunReader(database), EXIT_RUN_ID);
      const runId = randomUUID();
      const now = source.updatedAt;
      const canonical = descriptor.canonicalInput.parse(canonicalInputSamples(descriptor.canonicalInput)[0]);
      database.authority.runs.enqueue({
        envelope: { ...source.envelope, runId, workflow: descriptor.id, itemId: randomUUID(),
          traceId: `${descriptor.code}-001113-${runId.slice(0, 4)}`, descriptorVersion: descriptor.version,
          contractFingerprint: descriptor.contractFingerprint, dryRun: true, enqueuedAt: now,
          parent: { runId: EXIT_RUN_ID, tracePrefix: EXIT_TRACE_ID, edgeId: "fixture-child" } },
        input: { ...source.input, raw: canonical, parsed: {
          protectedBindings: (descriptor.protectedInputs ?? []).map(binding => ({ ...binding, kind: "protected-store", valueId: randomUUID() })),
          schemaHash: deriveSchemaHash(descriptor.canonicalInput, "output"), value: canonical } },
        lifecycle: { state: "queued" }, claimGeneration: 0, version: 1, createdAt: now, updatedAt: now,
      });
      const view = explainRunFrom(database, runId);
      assert.equal(view.workflowId, workflowId);
      assert.equal(view.state, "queued");
      assert.ok(view.timeline.length > 0);
      assert.deepEqual(view.timeline.map(entry => entry.nodeId), descriptorRuntimeNodes(descriptor).map(node => String(node.id)));
      assert.ok(view.timeline.every(entry => entry.disposition === "no-record"));
      assert.equal(view.failure.state, "absent");
      assert.equal(view.receipt.state, "absent");
      assert.deepEqual(explainRunFrom(database, view.traceId), view);
    },
  );

  it.each(CHILD_ONLY_WORKFLOW_MODULES.map(module => [String(module.descriptor.id), module.descriptor] as const))(
    "explains a failed child snapshot for registered %s", async (workflowId, descriptor) => {
      const { database, runId, failure } = await failedChild(descriptor);
      const view = explainRunFrom(database, runId);
      assert.equal(view.workflowId, workflowId);
      assert.deepEqual(view.outcome, { state: "present", value: "failed" });
      assert.ok(view.timeline.length > 0);
      assert.deepEqual(view.timeline.map(entry => entry.nodeId), descriptorRuntimeNodes(descriptor).map(node => String(node.id)));
      assert.ok(view.timeline.every(entry => entry.disposition === "no-record"));
      assert.equal(view.failure.state, "present");
      if (view.failure.state !== "present") throw new Error("child failure missing");
      assert.equal(view.failure.value.failureId, failure.failureId);
      assert.equal(view.failure.value.code, "RUN_INTERRUPTED_BY_CRASH");
      assert.equal(view.receipt.state, "present");
      if (view.receipt.state !== "present") throw new Error("child receipt missing");
      assert.equal(view.receipt.value.result, "failed");
      assert.deepEqual(explainRunFrom(database, view.traceId), view);
    },
  );

  it("still refuses a stored run whose workflow is not registered in this build", async () => {
    const database = await seeded();
    const source = requireTrustRun(createTrustRunReader(database), EXIT_RUN_ID);
    const runId = randomUUID();
    const now = source.updatedAt;
    database.authority.runs.enqueue({
      envelope: { ...source.envelope, runId, workflow: "unknown-workflow", itemId: randomUUID(),
        traceId: `unk-001113-${runId.slice(0, 4)}`, enqueuedAt: now },
      input: source.input, lifecycle: { state: "queued" }, claimGeneration: 0, version: 1, createdAt: now, updatedAt: now,
    });
    assert.throws(() => explainRunFrom(database, runId), {
      message: `run ${runId} is workflow unknown-workflow, which this build does not register`,
    });
  });

  it("shows only this failed run's observed steps when an earlier run reached further", async () => {
    const database = await seeded();
    const run = failedFollowup(database, 2);
    const view = explainRunFrom(database, run.envelope.runId);
    const timeline = new Map(view.timeline.map(entry => [entry.nodeId, entry]));

    assert.deepEqual(view.outcome, { state: "present", value: "failed" });
    assert.equal(timeline.get("searching")?.disposition, "observed-this-attempt");
    assert.equal(timeline.get("cross-verify")?.disposition, "no-record");
    assert.equal(timeline.get("active-status")?.disposition, "no-record");
  });

  it("attributes a Retry's replay beyond the first event page without borrowing the source's other steps", async () => {
    const database = await seeded();
    const source = failedFollowup(database, 2);
    const retry = failedFollowup(database, 3, source.envelope.runId);
    const timeline = new Map(explainRunFrom(database, retry.envelope.runId).timeline.map(entry => [entry.nodeId, entry]));

    assert.equal(timeline.get("searching")?.disposition, "replayed-from-checkpoint");
    assert.match(timeline.get("searching")?.detail ?? "", new RegExp(`run ${source.envelope.runId} attempt 2`, "u"));
    assert.equal(timeline.get("cross-verify")?.disposition, "no-record");
  });

  it("reads bounded persisted debug categories without attributing global events to a run or changing source inventory", async () => {
    const database = await seeded();
    const profile = heldProfiles.at(-1); assert.ok(profile);
    const root = profile.stateRoot;
    const writer = createDebugEventWriter({ repository: database.authority.timelineEvents, clock: manualClock(new Date("2026-08-04T00:11:13.500Z")), build: "fixture" });
    for (const category of ["session", "duo", "worker", "http", "sse", "client", "boot"] as const) {
      writer.emit({ category, phase: "failed", correlationId: category, code: "FIXTURE" }, { kind: "transport", connectionId: "fixture" });
    }
    const linked = { category: "http", phase: "failed", correlationId: "linked" };
    const runScope: TimelineAppend["scope"] = { kind: "run", runId: RunIdSchema.parse(EXIT_RUN_ID) };
    assert.throws(() => writer.emit(linked, runScope), /debug-run-workflow-required/u);
    assert.throws(() => writer.emit(linked, runScope, WorkflowIdSchema.parse("separations")), /timeline-event-owner-mismatch/u);
    writer.emit(linked, runScope, WorkflowIdSchema.parse("person-lookup"));
    const runView = explainRunFrom(database, EXIT_RUN_ID);
    assert.equal(runView.debugEvents?.records.length, 1);
    assert.equal(runView.debugEvents?.records[0]?.scope.kind, "run");
    const path = join(root, "state.db");
    const admission = profileFixtureStorageAdmission(path);
    const before = readFileSync(path); const inventory = readdirSync(root, { recursive: true, encoding: "utf8" }).sort();
    // Profile admission's live-binding observer opens state.db read-only, which moves SQLite's WAL read marks in -shm.
    const sourceBytes = inventory.filter(name => !name.endsWith("-shm") && lstatSync(join(root, name)).isFile()).map(name => [name, readFileSync(join(root, name))] as const);
    const output = composeExplainRuntime({ admission: profile.machine, isolation: rebuildRuntimeIsolation, args: ["diagnostics", "--limit", "2", "--json"] });
    assert.match(output, /nextCursor/u);
    let after = 0; const categories = new Set<string>();
    for (;;) {
      const page = AuthorityDatabase.inspectTimelinePageReadOnly(admission, path, { after, limit: 2 });
      assert.ok(page.records.length <= 2);
      const rendered = composeExplainRuntime({ admission: profile.machine, isolation: rebuildRuntimeIsolation,
        args: ["diagnostics", "--after", String(after), "--limit", "2", "--json"] });
      const view = z.object({ records: z.array(z.object({ eventId: z.string(),
        payload: z.object({ kind: z.literal("debug"), event: z.object({ level: z.literal("error") }) }) })) }).parse(JSON.parse(rendered));
      assert.deepEqual(view.records.map(record => record.eventId), page.records.map(record => record.eventId));
      for (const record of page.records) if (record.payload.kind === "debug") {
        categories.add(record.payload.event.category);
        assert.equal("level" in record.payload.event, false);
      }
      after = page.nextCursor;
      if (!page.hasMore) break;
    }
    assert.equal(categories.size, 7);
    assert.deepEqual(readFileSync(path), before, "state.db"); assert.deepEqual(readdirSync(root, { recursive: true, encoding: "utf8" }).sort(), inventory);
    for (const [name, bytes] of sourceBytes) assert.deepEqual(readFileSync(join(root, name)), bytes, name);
    assert.throws(() => parseDiagnosticArgs(["--limit", "1001"]));
    assert.throws(() => parseDiagnosticArgs(["--after", "-1"]));
    assert.throws(() => parseDiagnosticArgs(["--boot", "--run", EXIT_RUN_ID]));
  });

  it("keeps a cause's code and class name and drops its stack, path and free text", async () => {
    const database = await seeded();
    const profile = heldProfiles.at(-1); assert.ok(profile);
    const writer = createDebugEventWriter({ repository: database.authority.timelineEvents, clock: manualClock(new Date("2026-08-04T00:11:13.500Z")), build: "fixture" });
    const runScope: TimelineAppend["scope"] = { kind: "run", runId: RunIdSchema.parse(EXIT_RUN_ID) };
    writer.emit({ category: "worker", phase: "failed", correlationId: "cause", area: "worker-loop", reason: "step-failed", code: "ECONNRESET",
      message: "TypeError", stack: "TypeError: boom\n    at run (/Users/someone/Projects/hr-relay/src/x.ts:1:1)" }, runScope, WorkflowIdSchema.parse("person-lookup"));
    writer.emit({ category: "worker", phase: "failed", correlationId: "free", message: "open https://example.test/p?eid=123" }, runScope, WorkflowIdSchema.parse("person-lookup"));
    const explained = JSON.stringify(explainRunFrom(database, EXIT_RUN_ID).debugEvents);
    const diagnostics = composeExplainRuntime({ admission: profile.machine, isolation: rebuildRuntimeIsolation, args: ["diagnostics", "--run", EXIT_RUN_ID, "--json"] });
    for (const text of [explained, diagnostics]) {
      assert.match(text, /ECONNRESET/u); assert.match(text, /TypeError/u);
      for (const leaked of ["/Users/", "someone", "boom", "example.test", "eid=123", "stack"]) assert.equal(text.includes(leaked), false, leaked);
    }
  });

  it("shows a stored failure's nested causes as codes and class names in explain run and diagnostics", async () => {
    const database = await seeded();
    const profile = heldProfiles.at(-1); assert.ok(profile);
    class BrowserLoginError extends Error { constructor(message: string) { super(message); this.name = "BrowserLoginError"; } }
    const error = new Error("outer https://example.test/p?eid=123", { cause: new BrowserLoginError("at /Users/someone/Projects/x.ts eid 123") });
    const run = requireTrustRun(createTrustRunReader(database), EXIT_RUN_ID);
    const failure = FailureRecordSchema.parse({ diagnosticSafetyVersion: 1, failureId: randomUUID(), fingerprint: "f".repeat(64),
      runId: run.envelope.runId, traceId: run.envelope.traceId, attempt: run.envelope.attempt, workflowId: run.envelope.workflow,
      code: "RUN_INTERRUPTED_BY_CRASH", summary: "fixture", transient: false, writeState: "not-attempted",
      causeChain: [{ code: "RUN_INTERRUPTED_BY_CRASH", summary: "fixture", role: "primary", transient: false }],
      debug: failureDebugDetails(error), remediation: [{ kind: "operator-action", message: "fixture" }], occurredAt: run.createdAt });
    const protectedRun = RunRecordSchema.parse({ ...run, input: { ...run.input, parsed: { ...run.input.parsed, protectedBindings: [{ kind: "test-data-local", inputPath: "emplId", name: "personLookupCanaryEid", sourceId: "10000000-0000-4000-8000-000000000099" }] } } });
    const view = buildExplainRunView({ run: { ...protectedRun, lifecycle: { state: "terminal", outcome: "failed", endedAt: run.createdAt, errorSummary: "fixture", failureId: failure.failureId } },
      checkpoints: [], writes: [], nodeIds: [], dependencies: [], failure });
    const raw = new DatabaseSync(join(profile.stateRoot, "state.db"));
    raw.prepare("INSERT INTO run_failures (id, run_id, fingerprint, code, resolution_json, resolution_version, payload_json, created_at) VALUES (?, ?, ?, ?, '{\"status\":\"unresolved\",\"version\":1}', 1, ?, ?)")
      .run(failure.failureId, failure.runId, failure.fingerprint, failure.code, canonicalJsonStringify(failure), failure.occurredAt);
    raw.close();
    const diagnostics = composeExplainRuntime({ admission: profile.machine, isolation: rebuildRuntimeIsolation, args: ["diagnostics", "--run", EXIT_RUN_ID] });
    for (const text of [renderExplainRun(view), diagnostics]) {
      assert.match(text, /BrowserLoginError/u); assert.match(text, /RUN_INTERRUPTED_BY_CRASH/u);
      for (const leaked of ["/Users/", "someone", "example.test", "eid", "at run"]) assert.equal(text.includes(leaked), false, leaked);
    }
  });

  it("reads stopped boot faults without a database and refuses unsafe or incomplete spool bytes", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-explain-boot-")); roots.push(root);
    appendEmergencyFault({ stateRoot: root, build: "fixture", code: "DATABASE_UNAVAILABLE", error: new Error("Bearer SECRET"), now: new Date("2026-08-04T00:11:13.500Z"),
      area: "worker-startup", reason: "database-unavailable" });
    const path = join(root, "logs", "boot.jsonl"); const before = readFileSync(path);
    const output = composeExplainRuntime({ admission: RuntimeAdmission.syntheticFixture(join(root, "state.db")), isolation: rebuildRuntimeIsolation,
      args: ["diagnostics", "--boot", "--json"] });
    assert.match(output, /DATABASE_UNAVAILABLE/u); assert.equal(output.includes("SECRET"), false);
    assert.match(output, /"level": "error"/u);
    assert.deepEqual(readFileSync(path), before); assert.equal(readdirSync(root).includes("state.db"), false);
    writeFileSync(path, "{", { mode: 0o600 }); assert.throws(() => readLocalDebugLog(root), /boot-log-incomplete/u);
    writeFileSync(path, "{\n", { mode: 0o600 }); assert.throws(() => readLocalDebugLog(root), /boot-log-invalid/u);
    writeFileSync(path, Buffer.alloc(5 * 1024 * 1024 + 1)); assert.throws(() => readLocalDebugLog(root), /boot-log-cap-exceeded/u);
    rmSync(path); symlinkSync(join(root, "missing"), path); assert.throws(() => readLocalDebugLog(root), /boot-log-path-unsafe/u);
  });
  it("composes CLI explanations from the selected person's authority without creating machine authority", async () => {
    const database = await seeded();
    const profile = heldProfiles.at(-1); assert.ok(profile);
    explainRunFrom(database, EXIT_RUN_ID);
    const generation = database.getMeta().authorityGeneration;
    const byRun = composeExplainRuntime({ admission: profile.machine, isolation: rebuildRuntimeIsolation, args: ["run", EXIT_RUN_ID, "--json"] });
    const byTrace = composeExplainRuntime({ admission: profile.machine, isolation: rebuildRuntimeIsolation, args: ["run", EXIT_TRACE_ID, "--json"] });
    assert.equal(byRun, byTrace);
    assert.equal(z.object({ runId: z.string() }).parse(JSON.parse(byRun)).runId, EXIT_RUN_ID);
    assert.equal(database.getMeta().authorityGeneration, generation);
    assert.equal(readdirSync(profile.machine.stateRoot).includes("state.db"), false);
    profile.machine.assertLive(); profile.admission.assertLive();
  });

  it("refuses a missing profile selection before reading credentials or opening authority", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "hrauto-explain-unselected-"))); roots.push(root);
    const lifetime = await RuntimeLifetimeLock.acquire(0);
    try {
      const machine = installationAdmission(root, lifetime);
      assert.equal(machine.readProfileRegistry().activeProfileId, null);
      const credentials = vi.spyOn(profileCredentials, "createCredentialStore");
      assert.throws(() => composeExplainRuntime({ admission: machine, isolation: rebuildRuntimeIsolation, args: ["run", EXIT_RUN_ID] }), /profile-session-stale/u);
      assert.equal(credentials.mock.calls.length, 0);
      assert.equal(readdirSync(machine.stateRoot).includes("profiles"), false);
    } finally { releaseAdmissionFixture(root); await lifetime.close(); }
  });

  it("routes diagnostics --run to the selected profile's authority without machine authority or credential reads", async () => {
    const database = await seeded();
    const profile = heldProfiles.at(-1); assert.ok(profile);
    const writer = createDebugEventWriter({ repository: database.authority.timelineEvents, clock: manualClock(new Date("2026-08-04T00:11:13.500Z")), build: "fixture" });
    writer.emit({ category: "http", phase: "failed", correlationId: "run-scoped" }, { kind: "run", runId: RunIdSchema.parse(EXIT_RUN_ID) }, WorkflowIdSchema.parse("person-lookup"));
    const expected = AuthorityDatabase.inspectTimelinePageReadOnly(profile.admission, profile.path, { runId: RunIdSchema.parse(EXIT_RUN_ID), after: 0, limit: 100 });
    assert.ok(expected.records.length > 0);
    const generation = database.getMeta().authorityGeneration;
    const before = readFileSync(profile.path);
    const inventory = readdirSync(profile.stateRoot, { recursive: true, encoding: "utf8" }).sort();
    const machineInventory = readdirSync(profile.machine.stateRoot).sort();
    const credentials = vi.spyOn(profileCredentials, "createCredentialStore");
    const output = composeExplainRuntime({ admission: profile.machine, isolation: rebuildRuntimeIsolation, args: ["diagnostics", "--run", EXIT_RUN_ID, "--json"] });
    const view = z.object({ records: z.array(z.object({ eventId: z.string(), cursor: z.number() })), nextCursor: z.number() }).parse(JSON.parse(output));
    assert.deepEqual(view.records.map(record => [record.eventId, record.cursor]), expected.records.map(record => [record.eventId, record.cursor]));
    assert.equal(view.nextCursor, expected.nextCursor);
    assert.equal(credentials.mock.calls.length, 0);
    assert.deepEqual(readFileSync(profile.path), before);
    assert.equal(database.getMeta().authorityGeneration, generation);
    assert.deepEqual(readdirSync(profile.stateRoot, { recursive: true, encoding: "utf8" }).sort(), inventory);
    assert.deepEqual(readdirSync(profile.machine.stateRoot).sort(), machineInventory);
    assert.equal(machineInventory.includes("state.db"), false);
    profile.machine.assertLive(); profile.admission.assertLive();
  });

  it("refuses a diagnostics run that belongs to another profile's authority", async () => {
    await seeded();
    await seeded(false);
    const profile = heldProfiles.at(-1); assert.ok(profile);
    assert.notEqual(profile.machine, heldProfiles[0]?.machine);
    assert.throws(() => composeExplainRuntime({ admission: profile.machine, isolation: rebuildRuntimeIsolation, args: ["diagnostics", "--run", EXIT_RUN_ID, "--json"] }), /timeline-event-owner-missing/u);
    profile.machine.assertLive(); profile.admission.assertLive();
  });

  it("serves diagnostics --run only from the selected profile when two profiles share one machine", async () => {
    await seededWithRunEvent();
    const profile = heldProfiles.at(-1); assert.ok(profile);
    const first = await addSecondProfile(profile);
    const registry = createProfileRegistry(profile.machine);
    const second = registry.read().activeProfileId; assert.ok(second);
    assert.equal(registry.read().profiles.length, 2);
    const secondPath = join(profile.machine.stateRoot, "profiles", second, "state.db");
    const run = () => composeExplainRuntime({ admission: profile.machine, isolation: rebuildRuntimeIsolation, args: ["diagnostics", "--run", EXIT_RUN_ID, "--json"] });
    const firstBefore = readFileSync(profile.path);

    assert.throws(run, /timeline-event-owner-missing/u);

    registry.advanceSession(first);
    const records = z.object({ records: z.array(z.object({ eventId: z.string() })) }).parse(JSON.parse(run())).records;
    assert.ok(records.length > 0);
    assert.notEqual(secondPath, profile.path);

    registry.advanceSession(second);
    assert.throws(run, /timeline-event-owner-missing/u);
    assert.deepEqual(readFileSync(profile.path), firstBefore);
    profile.machine.assertLive();
  });

  it("refuses the page and releases the person admission when the selection changes during the read", async () => {
    await seededWithRunEvent();
    const profile = heldProfiles.at(-1); assert.ok(profile);
    const registry = createProfileRegistry(profile.machine);
    const selected = registry.read().activeProfileId; assert.ok(selected);
    const admitted: RuntimeAdmission[] = [];
    const real = ProductionAuthorityDatabase.inspectTimelinePageReadOnly.bind(ProductionAuthorityDatabase);
    vi.spyOn(ProductionAuthorityDatabase, "inspectTimelinePageReadOnly").mockImplementation((...args) => {
      admitted.push(args[0]); const page = real(...args); registry.advanceSession(selected); return page;
    });
    const run = () => composeExplainRuntime({ admission: profile.machine, isolation: rebuildRuntimeIsolation, args: ["diagnostics", "--run", EXIT_RUN_ID, "--json"] });

    assert.throws(run, /profile-session-stale/u);
    assert.equal(admitted.length, 1);
    assert.throws(() => admitted[0]?.assertLive());
    profile.machine.assertLive();

    vi.restoreAllMocks();
    assert.ok(z.object({ records: z.array(z.unknown()) }).parse(JSON.parse(run())).records.length > 0);
  });

  it("refuses diagnostics --run with a missing profile selection before reading credentials", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "hrauto-explain-diag-unselected-"))); roots.push(root);
    const lifetime = await RuntimeLifetimeLock.acquire(0);
    try {
      const machine = installationAdmission(root, lifetime);
      assert.equal(machine.readProfileRegistry().activeProfileId, null);
      const credentials = vi.spyOn(profileCredentials, "createCredentialStore");
      assert.throws(() => composeExplainRuntime({ admission: machine, isolation: rebuildRuntimeIsolation, args: ["diagnostics", "--run", EXIT_RUN_ID, "--json"] }), /profile-session-stale/u);
      assert.equal(credentials.mock.calls.length, 0);
      assert.equal(readdirSync(machine.stateRoot).includes("profiles"), false);
    } finally { releaseAdmissionFixture(root); await lifetime.close(); }
  });

  it("resolves either identity form to the same explanation", async () => {
    const database = await seeded();
    const byRun = explainRunFrom(database, EXIT_RUN_ID);
    const byTrace = explainRunFrom(database, EXIT_TRACE_ID);
    assert.deepEqual(byTrace, byRun);
    assert.equal(byRun.runId, EXIT_RUN_ID);
    assert.equal(byRun.traceId, EXIT_TRACE_ID);
  });

  it("refuses an identity that is neither form rather than guessing", async () => {
    const database = await seeded();
    assert.throws(() => explainRunFrom(database, "the-run-i-mean"), /neither a run id .* nor a trace id/s);
    assert.throws(
      () => explainRunFrom(database, "00000000-0000-4000-8000-000000000000"),
      (error: unknown) => error instanceof TargetNotFoundError && /absent from canonical authority/.test(error.message),
    );
  });

  it("resolves the node timeline, checkpoint reuse, and terminal outcome", async () => {
    const view = explainRunFrom(await seeded(), EXIT_TRACE_ID);

    assert.equal(view.state, "terminal");
    assert.deepEqual(view.outcome, { state: "present", value: "done" });
    assert.equal(view.attempt, 1);

    const timeline = new Map(view.timeline.map((entry) => [entry.nodeId, entry]));
    assert.equal(timeline.get("searching")?.disposition, "replayed-from-checkpoint");
    assert.match(String(timeline.get("searching")?.detail), /attempt 1/);
    assert.equal(timeline.get("cross-verify")?.disposition, "observed-this-attempt");
    assert.equal(timeline.get("active-status")?.disposition, "observed-this-attempt");
    assert.equal(timeline.get("crm-dates")?.disposition, "not-run");
    assert.match(String(timeline.get("crm-dates")?.detail), /condition-false/);

    const reuse = new Map(view.reuse.map((entry) => [entry.nodeId, entry]));
    assert.equal(reuse.get("searching")?.kind, "checkpoint");
    assert.equal(reuse.get("cross-verify")?.kind, "fresh-live");
    assert.ok((reuse.get("searching")?.ageMs ?? 0) > 0);
  });

  it("says a paused run needs Resume or Cancel, for a parent and a child alike", async () => {
    const run = requireTrustRun(createTrustRunReader(await seeded()), EXIT_RUN_ID);
    for (const shape of ["operation", "operation-member"] as const) {
      const paused = { ...run, envelope: { ...run.envelope, shape }, lifecycle: { state: "queued" as const },
        pause: { state: "paused" as const, commandId: randomUUID(), requestedAt: run.createdAt, pausedAt: run.createdAt } };
      const view = buildExplainRunView({ run: paused, checkpoints: [], writes: [], nodeIds: [], dependencies: [] });
      assert.equal(view.pause, "paused");
      assert.match(view.nextSafeAction, /does not resume by itself.*Resume or Cancel it from Logs/u);
      assert.doesNotMatch(view.nextSafeAction, /A worker will claim/u);
      assert.match(renderExplainRun(view), /queued \(paused\)/u);
    }
    const unpaused = buildExplainRunView({ run: { ...run, lifecycle: { state: "queued" } }, checkpoints: [], writes: [], nodeIds: [], dependencies: [] });
    assert.match(unpaused.nextSafeAction, /A worker will claim/u);
  });

  it("names every absence instead of rendering an empty section", async () => {
    const view = explainRunFrom(await seeded(), EXIT_RUN_ID);
    assert.equal(view.failure.state, "absent");
    assert.equal(view.openGate.state, "absent");
    assert.equal(view.openDependency.state, "absent");
    assert.match(view.notifications.reason, /2g slice/);
    assert.equal(view.commandHistory.state, "absent");
    assert.match(view.commandHistory.reason, /indexes commands by id, not by run/);
    assert.deepEqual(view.writes, [], "a read-only workflow fenced no external write");
  });

  it("carries the receipt's verdicts and a concrete next safe action", async () => {
    const view = explainRunFrom(await seeded(), EXIT_RUN_ID);
    assert.equal(view.receipt.state, "present");
    if (view.receipt.state !== "present") throw new Error("unreachable");
    assert.equal(view.receipt.value.result, "verified-done");
    assert.equal(view.receipt.value.confidence, "verified");
    const mandatory = view.receipt.value.verification.filter((row) => row.mandatory);
    assert.ok(mandatory.length > 0);
    assert.ok(mandatory.every((row) => row.verdict === "verified"), "every mandatory obligation is verified");
    assert.deepEqual(view.receipt.value.warnings, []);
    assert.match(view.nextSafeAction, /Nothing\. This run is settled/);
  });

  it("renders an operator-readable report carrying every ref operator-trust §2.5 section", async () => {
    const text = renderExplainRun(explainRunFrom(await seeded(), EXIT_TRACE_ID));
    for (const heading of [
      "state", "node timeline", "checkpoint reuse", "subject bindings", "failure",
      "last successful action", "open gate", "open dependency", "command history",
      "notifications", "write intent / proof", "evidence receipt", "next safe action",
    ]) {
      assert.ok(text.includes(`  ${heading}\n`), `report is missing the "${heading}" section`);
    }
    assert.match(text, /run 4ebf7275-.* trace pl-000619-4ebf/);
    assert.match(text, /terminal → done/);
    assert.match(text, /identity\.eid-agrees-across-sources\s+verified/);
    // No credential, cookie, or storage-state canary may reach a terminal.
    for (const canary of ["password", "Cookie", "storageState", "PRIVATE KEY"]) {
      assert.ok(!text.includes(canary), `explain output leaked ${canary}`);
    }
  });
});
