import { createOnboardingRunWorld } from "../../support/helpers/backend/onboarding-run-world.js";
import { readRunCheckpoint, continuationEvidenceDigest, validateRunContinuation } from "../../../src/backend/storage/sqlite/run-continuation.js";
import { RunCheckpointRecordSchema } from "../../../src/models/workflow/checkpoint.js";
import { readDelegationEvidence } from "../../../src/backend/storage/sqlite/delegation-authority.js";
import { TimelineEventRecordSchema, type TimelineEventRecord } from "../../../src/models/events/timeline.js";
import { createReceiptService } from "../../../src/backend/runs/trust/receipt-service.js";
import { redactEvidenceLeaf } from "../../../src/models/trust/evidence-classification.js";
import { GateIdSchema, WorkflowIdSchema } from "../../../src/rules/identity/ids.js";
import { deriveEvidenceEntryId } from "../../../src/models/trust/evidence-identity.js";
import { buildRunEvidenceReceipt } from "../../../src/backend/runs/provenance/evidence-receipt.js";
import { runClaim } from "../../../src/models/run/record.js";
import { OnboardingResultSchema } from "../../../src/models/workflows/onboarding/result.js";
import { FingerprintSchema } from "../../../src/rules/identity/ids.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, it } from "vitest";
import { authenticateOnboardingRosterChoice, buildRunWorkbookSection, createRunWorkbookService } from "../../../src/backend/runs/workbooks.js";
import { WorkbookReferenceWriteSchema } from "../../../src/models/processing/workbooks/read-result.js";
import { OnboardingCanonicalInput, OnboardingCanonicalValueSchema, ONBOARDING_INPUT_EXAMPLE } from "../../../src/models/workflows/onboarding/input.js";
import { ONBOARDING_ROSTER_FIELDS, ONBOARDING_ROSTER_GATE_ID, OnboardingRosterChoiceSchema } from "../../../src/models/workflows/onboarding/roster.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import { deriveGateResultCheckpointFingerprint } from "../../../src/models/workflow/gates.js";
import { CommandRequestSchema } from "../../../src/rules/commands/commands.js";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";
import { OnboardingReadHirePlan } from "../../../src/models/workflows/onboarding/read-hire-plan.js";
import { CrmReadHireData } from "../../../src/models/systems/crm/read-hire-data.js";
import { compileWorkflow } from "../../../src/workflow-kit/workflow-definition.js";
import { onboardingWorkflow } from "../../../src/workflows/onboarding/workflow.js";
import { appliedRunIds } from "../../support/fixtures/operator-command-fixtures.js";
import { testRunService, testWorkerPorts } from "../../support/fixtures/run-lifecycle-fixtures.js";
import type { RunRecord } from "../../../src/models/run/record.js";

const descriptor = compileWorkflow(onboardingWorkflow).descriptor;
const runWorld = createOnboardingRunWorld();
const { fixture, executionFixture } = runWorld;
afterAll(runWorld.close);
afterEach(runWorld.cleanup);

function foreignNative(record: TimelineEventRecord, runId: string) {
  assert.ok(record.payload.kind === "span");
  return TimelineEventRecordSchema.parse({ ...record, scope: { kind: "run", runId },
    payload: { kind: "span", event: { ...record.payload.event, runId } } });
}

describe("Onboarding captured roster admission and row choice", () => {
  it("chooses one of two complete sources with the same row identity and never repeats that choice as a write", async () => {
    const f = await fixture("unique", { second: "same" });
    assert.equal(f.repository.lastUsed("onboarding"), undefined);
    const started = f.start();
    assert.deepEqual(f.repository.lastUsed("onboarding")?.sources, [
      { libraryId: f.id, sheetId: "people" }, { libraryId: f.secondId, sheetId: "people" },
    ]);
    const roster = OnboardingCanonicalValueSchema.parse(started.input.parsed.value).roster;
    assert.equal(roster.state, "resolve-required");
    const parked = f.park(started);
    const available = f.section(parked).referenceChoices?.[0]?.resolution;
    assert.equal(available?.state, "available");
    if (available?.state !== "available") throw new Error("expected a source choice");
    assert.equal(available.candidates.length, 2);
    assert.deepEqual(available.candidates.map(candidate => [candidate.sheetId, candidate.rowId]), [["people", "people-person"], ["people", "people-person"]]);
    assert.equal(new Set(available.candidates.map(candidate => candidate.referenceDigest)).size, 2);
    assert.deepEqual(f.repository.runOperations(parked.envelope.runId), []);
    const choice = f.choice(parked, 1);
    const chosen = f.kernel.execute(choice);
    assert.equal(chosen.state, "applied", JSON.stringify(chosen));
    assert.equal(f.kernel.execute(choice).state, "already-applied");
    assert.deepEqual(f.repository.runOperations(parked.envelope.runId), []);
    const queued = f.database.authority.runs.get(parked.envelope.runId); assert.ok(queued?.lifecycle.state === "queued");
    const ports = testWorkerPorts(f.database, f.clock, { path: f.profilePath, descriptor, poolIndex: 1 });
    const worker = f.database.authority.workerSlots.list(descriptor.id).find(slot => slot.poolIndex === 1); assert.ok(worker);
    const claimed = ports.claimNext({ commandId: randomUUID(), workflow: descriptor.id, workerId: worker.workerId });
    assert.equal(claimed.state, "applied"); if (claimed.state !== "applied") throw new Error("claim refused");
    const lifecycle = testRunService(f.database, f.clock), claim = { workerId: worker.workerId,
      claimGeneration: claimed.run.claimGeneration }, now = f.clock.now().toISOString();
    for (const state of ["validating", "running"] as const) {
      assert.equal(lifecycle.workerTransition({ commandId: randomUUID(), runId: queued.envelope.runId, claim,
        lifecycle: { state, workerId: worker.workerId, claimedAt: now, heartbeatAt: now } }).state, "applied");
    }
    const running = f.database.authority.runs.get(queued.envelope.runId); assert.ok(running?.lifecycle.state === "running");
    const gate = f.database.authority.gateResults.get(`${running.envelope.runId}:${ONBOARDING_ROSTER_GATE_ID}`); assert.ok(gate);
    const binding = authenticateOnboardingRosterChoice(f.database.authority, running, gate).row.binding;
    assert.equal(binding.workbookId, f.secondId);
    assert.equal(binding.sheetId, "people"); assert.equal(binding.rowId, "people-person");
    const workbooks = createRunWorkbookService({ database: f.database, clock: f.clock,
      resolveDescriptor: id => id === descriptor.id ? descriptor : undefined });
    const command = WorkbookReferenceWriteSchema.parse({ kind: "patch-reference", writeId: "result", typeId: "onboarding-roster",
      referenceDigest: binding.referenceDigest, key: f.key, values: [{ fieldId: "eid", value: "10800000" }] });
    assert.equal(workbooks.write(running, command).state, "applied");
    assert.equal(workbooks.write(running, command).state, "applied");
    assert.equal(f.repository.runOperations(running.envelope.runId).length, 1);
    const secondRows = f.library.read(f.secondId ?? "").workbook.sheets[0].rows;
    const firstRows = f.library.read(f.id).workbook.sheets[0].rows;
    assert.equal(secondRows[1].cells[3].value, "10800000");
    assert.equal(firstRows[1].cells[3].value, null);
    const latest = f.database.authority.runs.get(running.envelope.runId); assert.ok(latest);
    assert.equal(lifecycle.requeue({ commandId: randomUUID(), runId: latest.envelope.runId,
      expectedVersion: latest.version, claim, cause: "recovery" }).state, "applied");
  });
  it("resolves a person found in one of several sources and keeps a dry run from writing", async () => {
    const unique = await fixture("unique", { second: "other" });
    const resolved = OnboardingCanonicalValueSchema.parse(unique.start().input.parsed.value).roster;
    assert.equal(resolved.state, "resolved");
    if (resolved.state !== "resolved") throw new Error("expected one source match");
    assert.equal(resolved.row.binding.workbookId, unique.id);
    const missing = await fixture("missing", { second: "same" });
    const absent = OnboardingCanonicalValueSchema.parse(missing.start().input.parsed.value).roster;
    assert.equal(absent.state, "resolve-required");
    if (absent.state !== "resolve-required") throw new Error("expected a missing person");
    assert.equal(absent.reason, "row-missing");
    const dry = await fixture("unique", { second: "same", dryRun: true });
    const parked = dry.park(dry.start());
    assert.equal(dry.kernel.execute(dry.choice(parked, 0)).state, "applied");
    const queued = dry.database.authority.runs.get(parked.envelope.runId); assert.ok(queued);
    const ports = testWorkerPorts(dry.database, dry.clock, { path: dry.profilePath, descriptor, poolIndex: 1 });
    const worker = dry.database.authority.workerSlots.list(descriptor.id).find(slot => slot.poolIndex === 1); assert.ok(worker);
    const claimed = ports.claimNext({ commandId: randomUUID(), workflow: descriptor.id, workerId: worker.workerId });
    assert.equal(claimed.state, "applied"); if (claimed.state !== "applied") throw new Error("claim refused");
    const lifecycle = testRunService(dry.database, dry.clock), claim = { workerId: worker.workerId, claimGeneration: claimed.run.claimGeneration };
    const now = dry.clock.now().toISOString();
    for (const state of ["validating", "running"] as const) {
      assert.equal(lifecycle.workerTransition({ commandId: randomUUID(), runId: queued.envelope.runId, claim,
        lifecycle: { state, workerId: worker.workerId, claimedAt: now, heartbeatAt: now } }).state, "applied");
    }
    const running = dry.database.authority.runs.get(queued.envelope.runId); assert.ok(running?.envelope.dryRun === true);
    const gate = dry.database.authority.gateResults.get(`${running.envelope.runId}:${ONBOARDING_ROSTER_GATE_ID}`); assert.ok(gate);
    const binding = authenticateOnboardingRosterChoice(dry.database.authority, running, gate).row.binding;
    const workbooks = createRunWorkbookService({ database: dry.database, clock: dry.clock,
      resolveDescriptor: id => id === descriptor.id ? descriptor : undefined });
    assert.throws(() => workbooks.write(running, WorkbookReferenceWriteSchema.parse({ kind: "patch-reference", writeId: "result",
      typeId: "onboarding-roster", referenceDigest: binding.referenceDigest, key: dry.key, values: [{ fieldId: "eid", value: "10800000" }] })),
      { code: "WORKBOOK_INVALID" });
    assert.deepEqual(dry.repository.runOperations(running.envelope.runId), []);
    assert.equal(dry.library.read(binding.workbookId).workbook.sheets[0].rows[1].cells[3].value, null);
    const latest = dry.database.authority.runs.get(running.envelope.runId); assert.ok(latest);
    assert.equal(lifecycle.requeue({ commandId: randomUUID(), runId: latest.envelope.runId,
      expectedVersion: latest.version, claim, cause: "recovery" }).state, "applied");
  });
  it("fills only the authenticated gate-chosen row when the selected worksheet has duplicate emails", async () => {
    const f = await fixture("duplicate"), parked = f.park(f.start());
    const choice = f.choice(parked);
    assert.equal(choice.type, "resolve-workbook-reference-row");
    if (choice.type !== "resolve-workbook-reference-row") throw new Error("unexpected row command");
    assert.equal(choice.payload.sheetId, "people"); assert.equal(choice.payload.rowId, "people-person");
    assert.equal(f.kernel.execute(choice).state, "applied");
    const queued = f.database.authority.runs.get(parked.envelope.runId); assert.ok(queued?.lifecycle.state === "queued");
    const ports = testWorkerPorts(f.database, f.clock, { path: f.profilePath, descriptor, poolIndex: 1 });
    const worker = f.database.authority.workerSlots.list(descriptor.id).find(slot => slot.poolIndex === 1); assert.ok(worker);
    const claimed = ports.claimNext({ commandId: randomUUID(), workflow: descriptor.id, workerId: worker.workerId });
    assert.equal(claimed.state, "applied"); if (claimed.state !== "applied") throw new Error("claim refused");
    const lifecycle = testRunService(f.database, f.clock), claim = { workerId: worker.workerId,
      claimGeneration: claimed.run.claimGeneration }, now = f.clock.now().toISOString();
    for (const state of ["validating", "running"] as const) {
      assert.equal(lifecycle.workerTransition({ commandId: randomUUID(), runId: queued.envelope.runId, claim,
        lifecycle: { state, workerId: worker.workerId, claimedAt: now, heartbeatAt: now } }).state, "applied");
    }
    const running = f.database.authority.runs.get(queued.envelope.runId); assert.ok(running?.lifecycle.state === "running");
    const gate = f.database.authority.gateResults.get(`${running.envelope.runId}:${ONBOARDING_ROSTER_GATE_ID}`); assert.ok(gate);
    const binding = authenticateOnboardingRosterChoice(f.database.authority, running, gate).row.binding;
    const command = WorkbookReferenceWriteSchema.parse({ kind: "patch-reference", writeId: "result", typeId: "onboarding-roster",
      referenceDigest: binding.referenceDigest, key: f.key, values: [{ fieldId: "eid", value: "10800000" }] });
    const workbooks = createRunWorkbookService({ database: f.database, clock: f.clock,
      resolveDescriptor: id => id === descriptor.id ? descriptor : undefined });
    assert.equal(workbooks.write(running, command).state, "applied");
    const rows = f.library.read(f.id).workbook.sheets[0].rows;
    assert.equal(rows[1].cells[3].value, "10800000"); assert.equal(rows[2].cells[3].value, null);
    assert.throws(() => workbooks.write(running, { ...command, referenceDigest: FingerprintSchema.parse("b".repeat(64)) }), { code: "WORKBOOK_INVALID" });
    const latest = f.database.authority.runs.get(running.envelope.runId); assert.ok(latest);
    assert.equal(lifecycle.requeue({ commandId: randomUUID(), runId: latest.envelope.runId,
      expectedVersion: latest.version, claim, cause: "recovery" }).state, "applied");
  });
  it("selects a General spreadsheet row from its captured key, fields and worksheet", async () => {
    const f = await fixture("duplicate", { general: true });
    assert.equal(f.library.metadata(f.id).typeId, "general");
    const parked = f.park(f.start());
    const choice = f.choice(parked);
    assert.equal(choice.type, "resolve-workbook-reference-row");
    if (choice.type !== "resolve-workbook-reference-row") throw new Error("unexpected row command");
    assert.equal(choice.payload.sheetId, "people"); assert.equal(choice.payload.rowId, "people-person");
    assert.equal(f.kernel.execute(choice).state, "applied");
    const queued = f.database.authority.runs.get(parked.envelope.runId); assert.ok(queued);
    assert.equal(queued.lifecycle.state, "queued");
    const gate = f.database.authority.gateResults.get(`${queued.envelope.runId}:${ONBOARDING_ROSTER_GATE_ID}`); assert.ok(gate);
    assert.equal(OnboardingRosterChoiceSchema.parse(gate.result.value).decision, "selected");
  });
  it("shows an unavailable row choice after the selected source changes and refuses the stale command", async () => {
    const f = await fixture("duplicate"), parked = f.park(f.start());
    const command = f.choice(parked);
    f.edit(workbook => { workbook.name = "Changed.xlsx"; });
    assert.deepEqual(f.section(parked).referenceChoices?.[0]?.resolution,
      { state: "unavailable", code: "WORKBOOK_ROW_CHOICE_UNAVAILABLE", candidates: [] });
    assert.equal(f.kernel.execute(command).state, "rejected");
  });
  it("refuses an ambiguous Onboarding result before an authenticated roster gate choice", async () => {
    const f = await fixture("duplicate"), queued = f.start();
    const ports = testWorkerPorts(f.database, f.clock, { path: f.profilePath, descriptor, poolIndex: 1 });
    const worker = f.database.authority.workerSlots.list(descriptor.id).find(slot => slot.poolIndex === 1); assert.ok(worker);
    const claimed = ports.claimNext({ commandId: randomUUID(), workflow: descriptor.id, workerId: worker.workerId });
    assert.equal(claimed.state, "applied"); if (claimed.state !== "applied") throw new Error("claim refused");
    const lifecycle = testRunService(f.database, f.clock), claim = { workerId: worker.workerId,
      claimGeneration: claimed.run.claimGeneration }, now = f.clock.now().toISOString();
    for (const state of ["validating", "running"] as const) {
      assert.equal(lifecycle.workerTransition({ commandId: randomUUID(), runId: queued.envelope.runId, claim,
        lifecycle: { state, workerId: worker.workerId, claimedAt: now, heartbeatAt: now } }).state, "applied");
    }
    const running = f.database.authority.runs.get(queued.envelope.runId); assert.ok(running?.lifecycle.state === "running");
    const roster = OnboardingCanonicalValueSchema.parse(running.input.parsed.value).roster;
    assert.equal(roster.state, "resolve-required"); if (roster.state !== "resolve-required") throw new Error("expected unresolved roster");
    const workbooks = createRunWorkbookService({ database: f.database, clock: f.clock,
      resolveDescriptor: id => id === descriptor.id ? descriptor : undefined });
    const command = WorkbookReferenceWriteSchema.parse({ kind: "patch-reference", writeId: "result", typeId: "onboarding-roster",
      referenceDigest: roster.binding.referenceDigest, key: f.key, values: [{ fieldId: "eid", value: "10800000" }] });
    assert.throws(() => workbooks.write(running, command), { code: "WORKBOOK_INVALID" });
    assert.deepEqual(f.repository.runOperations(running.envelope.runId), []);
    const latest = f.database.authority.runs.get(running.envelope.runId); assert.ok(latest);
    assert.equal(lifecycle.requeue({ commandId: randomUUID(), runId: latest.envelope.runId,
      expectedVersion: latest.version, claim, cause: "recovery" }).state, "applied");
  });
  it("anchors pending, parked and selected states to their own retained native producers", async () => {
    const f = await fixture(), queued = f.start();
    const pending = f.section(queued).referenceChoices?.[0]; assert.ok(pending);
    const birth = f.database.authority.timelineEvents.get(pending.native.eventId); assert.ok(birth);
    assert.equal(birth.payload.kind === "span" && birth.payload.event.t, "run.queued");
    const repositories = f.database.authority;
    const laterRecord = TimelineEventRecordSchema.parse({ ...birth, eventId: randomUUID(), cursor: birth.cursor + 1 });
    assert.throws(() => buildRunWorkbookSection({ ...repositories, timelineEvents: { ...repositories.timelineEvents,
      page: input => [...repositories.timelineEvents.page(input), laterRecord] } }, queued));
    const recordedLater = TimelineEventRecordSchema.parse({ ...birth, recordedAt: "2027-01-01T00:00:00.000Z" });
    assert.deepEqual(buildRunWorkbookSection({ ...repositories, timelineEvents: { ...repositories.timelineEvents,
      page: input => repositories.timelineEvents.page(input).map(record => record.eventId === birth.eventId ? recordedLater : record) } }, queued)
      .referenceChoices?.[0]?.native, pending.native);
    const parked = f.park(queued);
    const held = f.section(parked).referenceChoices?.[0]; assert.ok(held);
    const opened = f.database.authority.timelineEvents.get(held.native.eventId); assert.ok(opened);
    assert.equal(opened.payload.kind === "span" && opened.payload.event.t, "gate.opened");
    const openedLater = TimelineEventRecordSchema.parse({ ...opened, recordedAt: "2027-01-01T00:00:00.000Z" });
    assert.deepEqual(buildRunWorkbookSection({ ...repositories, timelineEvents: { ...repositories.timelineEvents,
      get: id => id === opened.eventId ? openedLater : repositories.timelineEvents.get(id) } }, parked)
      .referenceChoices?.[0]?.native, held.native);
    for (const [run, anchor] of [[queued, birth], [parked, opened]] as const) {
      for (const changed of [undefined, foreignNative(anchor, randomUUID())]) {
        const repositories = f.database.authority;
        const timelineEvents = { ...repositories.timelineEvents,
          get: (id: string) => id === anchor.eventId ? changed : repositories.timelineEvents.get(id),
          page: (input: Parameters<typeof repositories.timelineEvents.page>[0]) => repositories.timelineEvents.page(input)
            .flatMap(record => record.eventId === anchor.eventId ? changed === undefined ? [] : [changed] : [record]) };
        assert.throws(() => buildRunWorkbookSection({ ...repositories, gateResults: { ...repositories.gateResults,
          get: () => undefined }, timelineEvents }, run));
      }
    }
    assert.deepEqual(f.section(parked).referenceChoices?.[0]?.native, held.native);
    assert.equal(f.kernel.execute(f.choice(parked)).state, "applied");
    const selected = f.section(parked).referenceChoices?.[0]; assert.ok(selected);
    const resolved = f.database.authority.timelineEvents.get(selected.native.eventId); assert.ok(resolved);
    assert.equal(resolved.payload.kind === "span" && resolved.payload.event.t, "gate.resolved");
    for (const changed of [undefined, foreignNative(resolved, randomUUID())]) {
      assert.throws(() => buildRunWorkbookSection({ ...repositories, timelineEvents: { ...repositories.timelineEvents,
        get: id => id === resolved.eventId ? changed : repositories.timelineEvents.get(id) } },
      queued));
    }
  });

  it("uses the native terminal event for an unresolved cancelled run and permits a later recording clock", async () => {
    const f = await fixture("missing"), run = f.start();
    assert.equal(f.kernel.execute({ commandId: runWorld.nextCommandId(), requestedAt: f.clock.now().toISOString(),
      requestedBy: "local-operator", source: "dashboard", family: "run", type: "cancel",
      target: { runId: run.envelope.runId, expectedVersion: run.version } }).state, "applied");
    const terminal = f.database.authority.runs.get(run.envelope.runId); assert.ok(terminal && terminal.lifecycle.state === "terminal");
    const choice = f.section(terminal).referenceChoices?.[0]; assert.ok(choice);
    const repositories = f.database.authority, event = repositories.timelineEvents.get(choice.native.eventId); assert.ok(event);
    assert.equal(event.payload.kind === "span" && event.payload.event.t, "span.ended");
    const recordedLater = TimelineEventRecordSchema.parse({ ...event, recordedAt: "2027-01-01T00:00:00.000Z" });
    assert.deepEqual(buildRunWorkbookSection({ ...repositories, timelineEvents: { ...repositories.timelineEvents,
      page: input => repositories.timelineEvents.page(input).map(record => record.eventId === event.eventId ? recordedLater : record) } }, terminal)
      .referenceChoices?.[0]?.native, choice.native);
    for (const changed of [undefined, foreignNative(event, randomUUID())]) {
      assert.throws(() => buildRunWorkbookSection({ ...repositories, timelineEvents: { ...repositories.timelineEvents,
        page: input => repositories.timelineEvents.page(input).flatMap(record => record.eventId === event.eventId
          ? changed === undefined ? [] : [changed] : [record]) } }, terminal));
    }
    const repeated = TimelineEventRecordSchema.parse({ ...event, eventId: randomUUID(), cursor: event.cursor + 1 });
    assert.throws(() => buildRunWorkbookSection({ ...repositories, timelineEvents: { ...repositories.timelineEvents,
      page: input => [...repositories.timelineEvents.page(input), repeated] } }, terminal));
  });
  it("binds the selected workbook exactly once and retains the immutable typed legal/lived row", async () => {
    const f = await fixture("unique"), run = f.start();
    assert.deepEqual(run.input.parsed.protectedBindings, []);
    const input = OnboardingCanonicalValueSchema.parse(run.input.parsed.value);
    assert.equal(input.roster.state, "resolved"); if (input.roster.state !== "resolved") throw new Error("missing row");
    assert.deepEqual(input.roster.row.references, { legalName: "Fixture Hire", livedName: null });
    assert.equal(input.roster.row.binding.sheetId, "people"); assert.equal(input.roster.row.binding.rowId, "people-person");
    assert.equal(input.roster.row.binding.workbookId, f.id); assert.equal(f.snapshots(), 1);
    const before = canonicalJsonStringify(run.input);
    const type = f.repository.types().find(type => type.id === "onboarding-roster"); assert.ok(type);
    f.repository.putType({ ...type, defaultWorkbookId: null });
    f.edit(workbook => { workbook.sheets[0].rows[1].cells[1].value = "Later"; });
    const stored = f.database.authority.runs.get(run.envelope.runId); assert.ok(stored);
    assert.equal(canonicalJsonStringify(stored.input), before);
    assert.equal(f.section(stored).referenceChoices?.length, 0);
    assert.equal(f.snapshots(), 1);
    const selected = f.plan({ ...f.request, submissions: [{ ...f.request.submissions[0], email: "other@example.test" }],
      workbookReferences: [{ ...f.selection, libraryId: f.id }] });
    assert.equal(selected.planned.length, 0); assert.equal(selected.refused.length, 1);
    assert.equal(OnboardingCanonicalInput.safeParse(f.request.submissions[0]).success, false);
  });

  it("refuses caller roster authority, wrong key/field/type declarations and malformed legal/lived cells", async () => {
    const f = await fixture("unique");
    for (const request of [
      { ...f.request, submissions: [{ ...f.request.submissions[0], roster: ONBOARDING_INPUT_EXAMPLE.roster }] },
      { ...f.request, workbookReferences: [] },
      { ...f.request, workbookReferences: [{ ...f.selection, versionId: "missing" }] },
    ]) assert.equal(f.plan(request).planned.length, 0);
    for (const reference of [{ ...f.selection, typeId: "general" }, { ...f.selection, keys: ["other@example.test"] }, { ...f.selection, fields: ["email", "livedName"] }]) {
      assert.throws(() => f.plan({ ...f.request, workbookReferences: [reference] }));
    }
    for (const values of [["", null], [4, null], [null, "Lived Name"], ["   ", "Lived Name"]]) {
      f.edit(workbook => { workbook.sheets[0].rows[1].cells = [f.key, ...values, null, null].map(value => ({ value })); });
      assert.equal(f.plan({ ...f.request, workbookReferences: [{ ...f.selection, expectedVersion: f.library.read(f.id).version,
        versionId: f.library.libraryVersion(f.id).version.id }] }).planned.length, 0);
    }
  });

  it("holds a missing row and requires a new Start after its source changes", async () => {
    const f = await fixture("missing"), run = f.park(f.start());
    assert.deepEqual(f.section(run).referenceChoices?.[0]?.resolution,
      { state: "unavailable", code: "WORKBOOK_ROW_CHOICE_UNAVAILABLE", candidates: [] });
    f.edit(workbook => { workbook.sheets[0].rows[1].cells[0].value = f.key.toUpperCase(); });
    assert.equal(f.section(run).referenceChoices?.[0]?.resolution.state, "unavailable");
    f.edit(workbook => { workbook.sheets[0].rows[1].cells[0].value = f.key; });
    assert.equal(f.section(run).referenceChoices?.[0]?.resolution.state, "unavailable");
    assert.equal(f.database.authority.runs.get(run.envelope.runId)?.lifecycle.state, "parked-gate");
    assert.deepEqual(f.repository.runOperations(run.envelope.runId), []);
  });

  it("rebuilds the chosen row in the selected worksheet, resumes once and leaves the original start snapshot unchanged", async () => {
    const f = await fixture(), run = f.park(f.start()), original = canonicalJsonStringify(run.input);
    const available = f.section(run).referenceChoices?.[0]?.resolution;
    assert.ok(available?.state === "available"); assert.deepEqual(available.candidates.map(row => row.sheetId), ["people", "people"]);
    const pick = available.decision?.options[0];
    assert.equal(available.decision?.type, "pick-row");
    assert.deepEqual([pick?.id, pick?.send, pick?.confirm], ["confirm", { via: "action", actionKey: available.action.key },
      available.action.kind === "command" ? available.action.confirm : undefined]);
    const table = pick?.input?.kind === "candidate" ? pick.input.table : undefined;
    assert.deepEqual(table?.rows.map(({ sheetId, rowId, rowNumber }) => [sheetId, rowId, rowNumber]),
      available.candidates.map(({ sheetId, rowId }, index) => [sheetId, rowId, index + 2]));
    const request = f.choice(run); assert.ok(request.type === "resolve-workbook-reference-row");
    const command = { ...request, payload: { sheetId: "people", rowId: "people-second" } };
    assert.equal(f.kernel.execute(command).state, "applied");
    assert.equal(f.kernel.execute(command).state, "already-applied");
    const current = f.database.authority.runs.get(run.envelope.runId); assert.ok(current);
    assert.equal(current.lifecycle.state, "queued"); assert.equal(current.version, run.version + 1);
    assert.equal(canonicalJsonStringify(current.input), original);
    const gate = f.database.authority.gateResults.get(`${run.envelope.runId}:${ONBOARDING_ROSTER_GATE_ID}`); assert.ok(gate);
    const { row: chosen } = authenticateOnboardingRosterChoice(f.database.authority, current, gate);
    assert.equal(chosen.references.legalName, "Second Hire"); assert.equal(chosen.references.livedName, null);
    assert.equal(chosen.binding.sheetId, "people"); assert.equal(chosen.binding.workbookVersion, command.target.workbookVersion);
    const hirePlan = descriptorRuntimeNodes(descriptor).find(node => node.id === "hire-plan"); assert.ok(hirePlan?.kind === "task");
    const bound = OnboardingReadHirePlan.input.parse(hirePlan.bind({ input: current.input.parsed.value,
      outputs: { "crm-source": CrmReadHireData.example, "roster-choice": { decision: "selected", row: chosen } } }));
    assert.deepEqual(bound.roster, chosen);
    f.edit(workbook => { workbook.sheets[1].rows[1].cells[1].value = "Later"; });
    assert.deepEqual(authenticateOnboardingRosterChoice(f.database.authority, current, gate).row, chosen);
    assert.equal(f.section(current).referenceChoices?.[0]?.resolution.state, "resolved");
    assert.equal(f.kernel.execute({ ...command, commandId: runWorld.nextCommandId() }).state, "rejected");
    assert.deepEqual(f.repository.runOperations(run.envelope.runId), []);
    assert.equal(f.snapshots(), 1);
  });

  it("refuses generic gate bypass and binds resolution to exact retained input and native membership", async () => {
    const f = await fixture(), run = f.park(f.start());
    const command = f.choice(run); assert.ok(command.type === "resolve-workbook-reference-row");
    const forged = { ...ONBOARDING_INPUT_EXAMPLE.roster.row, binding: { ...ONBOARDING_INPUT_EXAMPLE.roster.row.binding,
      workbookId: f.id, sheetId: "people", rowId: "people-person" } };
    assert.equal(f.kernel.execute({ ...command, family: "gate", type: "resolve-gate",
      target: { runId: run.envelope.runId, expectedVersion: run.version, gateId: ONBOARDING_ROSTER_GATE_ID },
      payload: { result: { schemaHash: deriveSchemaHash(OnboardingRosterChoiceSchema, "output"), value: { decision: "selected", row: forged } } } }).state, "rejected");
    for (const target of [
      { ...command.target, referenceDigest: "b".repeat(64) }, { ...command.target, libraryId: "foreign" },
      { ...command.target, key: "other@example.test" }, { ...command.target, typeId: "general" },
      { ...command.target, gateId: "other-gate" }, { ...command.target, runId: randomUUID() }, { ...command.target, expectedVersion: run.version + 1 },
    ]) assert.equal(f.kernel.execute({ ...command, commandId: runWorld.nextCommandId(), target }).state, "rejected");
    const tampered = structuredClone(run); tampered.input.parsed.value = { ...OnboardingCanonicalValueSchema.parse(run.input.parsed.value),
      roster: { ...OnboardingCanonicalValueSchema.parse(run.input.parsed.value).roster, reason: "row-missing" } };
    assert.throws(() => buildRunWorkbookSection(f.database.authority, tampered));
    assert.equal(f.database.authority.gateResults.listByRun(run.envelope.runId).length, 0);
    assert.equal(f.database.authority.runs.get(run.envelope.runId)?.lifecycle.state, "parked-gate");
  });

  it("keeps the captured row when only the library type label changes", async () => {
    const f = await fixture(), run = f.park(f.start()), command = f.choice(run);
    f.repository.putType({ id: "other-roster", name: "Other roster", keyFieldId: "email",
      fields: [...ONBOARDING_ROSTER_FIELDS], defaultWorkbookId: null });
    const record = f.library.read(f.id); assert.ok(record);
    const receipt = f.library.operatorOperation(f.id, randomUUID(), { kind: "metadata", expectedVersion: record.version,
      metadata: { typeId: "other-roster", sharePoint: null } });
    assert.equal(receipt.state, "applied"); assert.equal(f.repository.metadata(f.id).typeId, "other-roster");
    const changed = f.library.read(f.id); assert.ok(changed);
    assert.ok(command.type === "resolve-workbook-reference-row");
    assert.equal(f.kernel.execute({ ...command, target: { ...command.target, workbookVersion: changed.version } }).state, "applied");
    assert.equal(f.database.authority.runs.get(run.envelope.runId)?.lifecycle.state, "queued");
  });
  it.each(["revision", "key", "sheet", "fields", "names"] as const)("refuses stale %s authority without resuming or writing", async change => {
    const f = await fixture(), run = f.park(f.start()), command = f.choice(run);
    f.edit(workbook => {
      if (change === "revision") workbook.name = "Changed.xlsx";
      if (change === "key") workbook.sheets[0].rows[1].cells[0].value = "other@example.test";
      if (change === "sheet") workbook.sheets[0].id = "replacement-sheet";
      if (change === "fields") {
        const binding = workbook.sheets[0].columnBindings?.find(value => value.fieldId === "fullName"); assert.ok(binding);
        binding.fieldId = null;
      }
      if (change === "names") workbook.sheets[0].rows[1].cells[1].value = null;
    });
    const changed = f.library.read(f.id); assert.ok(changed);
    if (change === "fields") assert.equal(changed.workbook.sheets[0].columnBindings?.some(value => value.fieldId === "fullName"), false);
    const candidate = change !== "revision" && command.type === "resolve-workbook-reference-row"
      ? { ...command, target: { ...command.target, workbookVersion: changed.version } } : command;
    assert.equal(f.kernel.execute(candidate).state, "rejected");
    assert.equal(f.database.authority.gateResults.listByRun(run.envelope.runId).length, 0);
    assert.equal(f.database.authority.runs.get(run.envelope.runId)?.lifecycle.state, "parked-gate");
    assert.deepEqual(f.repository.runOperations(run.envelope.runId), []);
  });

  it("never offers another worksheet and authenticates retained choice command/audit evidence", async () => {
    const f = await fixture(), run = f.park(f.start());
    const command = f.choice(run); assert.ok(command.type === "resolve-workbook-reference-row");
    assert.equal(f.kernel.execute({ ...command, payload: { sheetId: "archive", rowId: "archive-person" } }).state, "rejected");
    const actual = CommandRequestSchema.parse({ ...command, commandId: runWorld.nextCommandId() });
    assert.ok(actual.type === "resolve-workbook-reference-row");
    assert.equal(f.kernel.execute(actual).state, "applied");
    const gate = f.database.authority.gateResults.get(`${run.envelope.runId}:${ONBOARDING_ROSTER_GATE_ID}`); assert.ok(gate);
    const current = f.database.authority.runs.get(run.envelope.runId); assert.ok(current);
    assert.equal(authenticateOnboardingRosterChoice(f.database.authority, current, gate).row.binding.rowId, "people-person");
    const choice = OnboardingRosterChoiceSchema.parse(gate.result.value);
    const parsed = choice.row;
    const tampered = { ...gate, result: { ...gate.result, value: { ...choice, row: { ...parsed, binding: { ...parsed.binding, rowId: "archive-person" } } } } };
    assert.throws(() => authenticateOnboardingRosterChoice(f.database.authority, current,
      { ...tampered, checkpointFingerprint: FingerprintSchema.parse(deriveGateResultCheckpointFingerprint(tampered.result)) }));
    const changedNames = { ...gate, result: { ...gate.result, value: { ...choice, row: { ...parsed,
      references: { ...parsed.references, legalName: "Injected Hire" } } } } };
    assert.throws(() => authenticateOnboardingRosterChoice(f.database.authority, current,
      { ...changedNames, checkpointFingerprint: FingerprintSchema.parse(deriveGateResultCheckpointFingerprint(changedNames.result)) }));
    const repositories = f.database.authority;
    assert.throws(() => authenticateOnboardingRosterChoice({ ...repositories,
      timelineEvents: { ...repositories.timelineEvents, get: () => undefined } }, current, gate));
    const native = (id: string) => repositories.timelineEvents.get(id);
    assert.throws(() => authenticateOnboardingRosterChoice({ ...repositories,
      timelineEvents: { ...repositories.timelineEvents, get: id => {
        const event = native(id);
        return event?.payload.kind === "span" && event.payload.event.t === "gate.resolved"
          ? { ...event, payload: { ...event.payload, event: { ...event.payload.event, resultHash: "b".repeat(64) } } } : event;
      } } }, current, gate));
    const changedCommand = { ...actual, payload: { sheetId: "archive", rowId: "archive-person" } };
    assert.throws(() => authenticateOnboardingRosterChoice({ ...repositories,
      commands: { ...repositories.commands, get: () => changedCommand } }, current, gate));
    const audit = repositories.commandAudits.findByCommand(actual.commandId); assert.ok(audit);
    assert.throws(() => authenticateOnboardingRosterChoice({ ...repositories, commandAudits: {
      ...repositories.commandAudits, findByCommand: () => ({ ...audit, request: changedCommand }),
    } }, current, gate));
  });
  it.each(["legal-name", "lived-name", "checkpoint", "command", "audit-missing", "audit-changed", "native-missing", "native-changed"] as const)(
    "authenticates resumed %s evidence at real executor admission before task/browser hooks", async fault => {
      const f = await executionFixture(), root = f.start();
      assert.equal((await f.execution.step(root, new AbortController().signal)).outcome.state, "parked-gate");
      assert.deepEqual(f.calls, []); assert.equal(f.sessions.opens(), 0);
      assert.equal(f.kernel.execute(f.choice(root)).state, "applied");
      f.setFault(fault);
      try {
        await assert.rejects(f.execution.step(root, new AbortController().signal));
        assert.deepEqual(f.calls, []); assert.equal(f.sessions.opens(), 0);
        assert.deepEqual(f.database.authority.runs.listChildren(root.envelope.runId), []);
      } finally {
        f.setFault(undefined);
        const held = f.database.authority.runs.get(root.envelope.runId); assert.ok(held);
        const heldClaim = runClaim(held); assert.ok(heldClaim);
        const claim = { workerId: heldClaim.workerId, claimGeneration: heldClaim.claimGeneration };
        assert.equal(testRunService(f.database, f.clock).requeue({ commandId: randomUUID(), runId: root.envelope.runId,
          expectedVersion: held.version, claim, cause: "recovery" }).state, "applied");
      }
    });

  it("executes the actual resumed hire review and I-9 child with retained chosen values and emits a selected terminal receipt", async () => {
    const f = await executionFixture(), root = f.start();
    assert.equal((await f.execution.step(root, new AbortController().signal)).outcome.state, "parked-gate");
    assert.equal(f.kernel.execute(f.choice(root)).state, "applied");
    const executed = await f.execution.execute(root, new AbortController().signal);
    assert.ok(executed.run?.lifecycle.state === "terminal" && executed.run.lifecycle.outcome === "done",
      JSON.stringify({ lifecycle: executed.run?.lifecycle.state, outcomes: executed.outcomes.map(value => value.state),
        failures: [root, ...f.database.authority.runs.listChildren(root.envelope.runId)].flatMap(run =>
          f.database.authority.failures.listByRun(run.envelope.runId).map(({ code, nodeId, summary, debug }) => ({ code, nodeId,
            authority: summary.match(/\b(?:delegation|run-continuation|checkpoint|worker)[a-z0-9-]+\b/g),
            frames: debug?.stack.match(/src\/[a-zA-Z0-9/_.-]+:\d+:\d+/g) }))) }));
    const result = f.database.authority.runResults.get(root.envelope.runId); assert.ok(result);
    const output = OnboardingResultSchema.parse(result.result.value);
    assert.equal(output.plan.employee.firstName, "Fixture"); assert.equal(output.plan.employee.preferredFirstName, "Fixture");
    assert.equal(output.hireWrite.state, "verified");
    assert.equal(output.state, "filed");
    assert.deepEqual(f.calls.map(call => call.system), ["crm", "ucpath", "i9", "crm", "ucpath", "crm", "ucpath"]);
    const childCall = f.calls.find(call => call.system === "i9"); assert.ok(childCall);
    assert.equal(Reflect.get(Object(childCall.input), "firstName"), "Fixture");
    const children = f.database.authority.runs.listChildren(root.envelope.runId);
    assert.equal(children.length, 1); assert.equal(children[0].envelope.workflow, "i9-lookup");
    assert.ok(children[0].lifecycle.state === "terminal" && children[0].lifecycle.outcome === "done");
    const receipts = createReceiptService({ database: f.database, runReader: testRunService(f.database, f.clock), descriptors: [descriptor] });
    assert.equal(f.database.authority.evidenceReceipts.findByRun(root.envelope.runId), undefined);
    for (const fault of ["gate-missing", "legal-name", "lived-name", "checkpoint", "command", "audit-missing", "audit-changed", "native-missing", "native-changed"] as const) {
      f.setFault(fault);
      try {
        assert.throws(() => receipts.ensureReceipt(root.envelope.runId), fault);
        assert.equal(f.database.authority.evidenceReceipts.findByRun(root.envelope.runId), undefined, fault);
      } finally { f.setFault(undefined); }
    }
    const ensured = receipts.ensure(root.envelope.runId); assert.equal(ensured.state, "derived");
    const receipt = ensured.receipt;
    assert.deepEqual(receipts.ensureReceipt(root.envelope.runId), receipt);
    f.setFault("native-missing");
    try { assert.throws(() => receipts.ensureReceipt(root.envelope.runId)); } finally { f.setFault(undefined); }
    assert.ok(receipt.decisions.some(decision => decision.kind === "gate" && decision.outcome === "taken"
      && decision.reason.includes("selected") && decision.reason.includes("row.binding.referenceDigest")));
    const operations = f.repository.runOperations(root.envelope.runId);
    assert.equal(operations.length, 1); assert.equal(operations[0]?.receipt.state, "applied");
  });

  it.each([false, true])("authenticates the actual transitive I-9 boundary and recovered source choice (tampered source: %s)", async tamper => {
    const f = await executionFixture(), root = f.start();
    assert.equal((await f.execution.step(root, new AbortController().signal)).outcome.state, "parked-gate");
    assert.equal(f.kernel.execute(f.choice(root)).state, "applied");
    const admit = f.execution.lifecycle.admitDelegation.bind(f.execution.lifecycle);
    let admitted = 0;
    f.execution.lifecycle.admitDelegation = (context, plan) => {
      admitted++;
      f.setFault("legal-name");
      try { return admit(context, plan); } finally { f.setFault(undefined); }
    };
    const blocked = await f.execution.step(root, new AbortController().signal);
    assert.equal(blocked.outcome.state, "failed"); assert.equal(admitted, 1);
    assert.deepEqual(f.calls.map(call => call.system), ["crm", "ucpath"]);
    assert.deepEqual(f.database.authority.runs.listChildren(root.envelope.runId), []);
    assert.deepEqual(f.database.authority.delegationManifests.listByParentRun(root.envelope.runId), []);
    f.execution.lifecycle.admitDelegation = admit;
    const failed = f.database.authority.runs.get(root.envelope.runId); assert.ok(failed);
    const recoveredResult = f.kernel.execute({ commandId: runWorld.nextCommandId(), requestedAt: f.clock.now().toISOString(),
      requestedBy: "local-operator", source: "run-detail", family: "run", type: "recover-run",
      target: { runId: root.envelope.runId, expectedVersion: failed.version } });
    assert.equal(recoveredResult.state, "applied");
    const recoveredId = appliedRunIds(recoveredResult).find(id => id !== root.envelope.runId); assert.ok(recoveredId);
    const recovered = f.database.authority.runs.get(recoveredId); assert.ok(recovered?.envelope.continuation);
    assert.ok(recovered.envelope.continuation.gates.some(gate => gate.runId === root.envelope.runId && gate.nodeId === ONBOARDING_ROSTER_GATE_ID));
    const subject = descriptorRuntimeNodes(descriptor).find(node => node.id === "hire-subject"); assert.ok(subject?.kind === "task");
    assert.equal(subject.replay, "always-rerun");
    const retainedSubject = readRunCheckpoint(f.database.authority, recovered.envelope, "hire-subject", true); assert.ok(retainedSubject);
    assert.equal(retainedSubject.assertion, undefined); assert.equal(retainedSubject.runId, root.envelope.runId);
    assert.notEqual(retainedSubject.runId, recoveredId);
    const capturedSubject = recovered.envelope.continuation.checkpoints.find(row => row.nodeId === subject.id); assert.ok(capturedSubject);
    assert.deepEqual(capturedSubject, { nodeId: retainedSubject.nodeId, runId: retainedSubject.runId,
      attempt: retainedSubject.attempt, claimGeneration: retainedSubject.claimGeneration, digest: continuationEvidenceDigest(retainedSubject) });
    validateRunContinuation(f.database.authority, recovered.envelope);
    const carried = f.section(recovered).referenceChoices?.[0]; assert.ok(carried);
    assert.equal(carried.resolution.state, "resolved"); assert.equal(carried.native.runId, recoveredId);
    const issuance = f.database.authority.timelineEvents.get(carried.native.eventId); assert.ok(issuance);
    assert.equal(issuance.payload.kind === "span" && issuance.payload.event.t, "run.queued");
    for (const changed of [undefined, foreignNative(issuance, root.envelope.runId)]) {
      const repositories = f.database.authority;
      assert.throws(() => buildRunWorkbookSection({ ...repositories, timelineEvents: { ...repositories.timelineEvents,
        page: input => repositories.timelineEvents.page(input).flatMap(record => record.eventId === issuance.eventId
          ? changed === undefined ? [] : [changed] : [record]) } }, recovered));
    }
    f.edit(workbook => { workbook.sheets[0].rows[1].cells[1].value = "Later"; });
    if (tamper) {
      const hooks = f.calls.length, browsers = f.sessions.opens();
      f.setFault("native-missing");
      try {
        await assert.rejects(f.execution.step(recovered, new AbortController().signal));
        assert.equal(f.calls.length, hooks); assert.equal(f.sessions.opens(), browsers);
      } finally {
        f.setFault(undefined);
        const held = f.database.authority.runs.get(recoveredId); assert.ok(held);
        const heldClaim = runClaim(held); assert.ok(heldClaim);
        const claim = { workerId: heldClaim.workerId, claimGeneration: heldClaim.claimGeneration };
        assert.equal(testRunService(f.database, f.clock).requeue({ commandId: randomUUID(), runId: recoveredId,
          expectedVersion: held.version, claim, cause: "recovery" }).state, "applied");
      }
    } else {
      let checkedContinuation = 0;
      f.execution.lifecycle.admitDelegation = (context, plan) => {
        if (checkedContinuation > 0) return admit(context, plan);
        checkedContinuation++;
        const variants = [undefined,
          RunCheckpointRecordSchema.parse({ ...retainedSubject, nodeId: "hire-plan" }),
          RunCheckpointRecordSchema.parse({ ...retainedSubject, runId: randomUUID() }),
          RunCheckpointRecordSchema.parse({ ...retainedSubject, attempt: retainedSubject.attempt + 1 }),
          RunCheckpointRecordSchema.parse({ ...retainedSubject, claimGeneration: retainedSubject.claimGeneration + 1 }),
          RunCheckpointRecordSchema.parse({ ...retainedSubject, writtenAt: "2027-01-01T00:00:00.000Z" }),
        ];
        for (const changed of variants) {
          const hooks = f.calls.length, generation = f.database.getMeta().authorityGeneration;
          f.setRepositoryView(repositories => ({ ...repositories, runCheckpoints: { ...repositories.runCheckpoints,
            get: (workflow, itemId, nodeId, attempt, claimGeneration) => nodeId === "hire-subject" ? changed
              : repositories.runCheckpoints.get(workflow, itemId, nodeId, attempt, claimGeneration) } }));
          try { assert.throws(() => admit(context, plan), /run-continuation-checkpoint-unavailable/u); }
          finally { f.setRepositoryView(undefined); }
          assert.equal(f.calls.length, hooks); assert.equal(f.database.getMeta().authorityGeneration, generation);
          assert.deepEqual(f.database.authority.runs.listChildren(recoveredId), []);
          assert.deepEqual(f.database.authority.delegationManifests.listByParentRun(recoveredId), []);
        }
        for (const missing of [false, true]) {
          f.setRepositoryView(repositories => ({ ...repositories, lifecycleJournal: { ...repositories.lifecycleJournal,
            findContinuationIssue: (runId, appliedVersion) => {
              const issue = repositories.lifecycleJournal.findContinuationIssue(runId, appliedVersion);
              if (issue === undefined || issue.result.kind !== "run" || issue.result.continuation === undefined) return issue;
              return { ...issue, result: { ...issue.result, continuation: { ...issue.result.continuation,
                checkpoints: issue.result.continuation.checkpoints.flatMap(row => row.nodeId !== "hire-subject" ? [row]
                  : missing ? [] : [{ ...row, digest: FingerprintSchema.parse("b".repeat(64)) }]) } } };
            } } }));
          try { assert.throws(() => admit(context, plan), /run-continuation-issuance-unavailable/u); }
          finally { f.setRepositoryView(undefined); }
          assert.deepEqual(f.database.authority.runs.listChildren(recoveredId), []);
        }
        return admit(context, plan);
      };
      const completed = await f.execution.execute(recovered, new AbortController().signal);
      assert.equal(checkedContinuation, 1);
      assert.ok(completed.run?.lifecycle.state === "terminal" && completed.run.lifecycle.outcome === "done",
        JSON.stringify({ lifecycle: completed.run?.lifecycle.state, outcomes: completed.outcomes.map(value => value.state),
          failures: [recovered, ...f.database.authority.runs.listChildren(recoveredId)].flatMap(run =>
            f.database.authority.failures.listByRun(run.envelope.runId).map(({ code, nodeId, summary, debug }) => ({ code, nodeId,
            authority: summary.match(/\b(?:delegation|run-continuation|checkpoint|worker)[a-z0-9-]+\b/g),
            frames: debug?.stack.match(/src\/[a-zA-Z0-9/_.-]+:\d+:\d+/g) }))) }));
      const result = f.database.authority.runResults.get(recoveredId); assert.ok(result);
      assert.equal(OnboardingResultSchema.parse(result.result.value).plan.employee.firstName, "Fixture");
      assert.equal(f.calls.filter(call => call.system === "i9").length, 1);
      assert.deepEqual(f.database.authority.gateResults.listByRun(recoveredId).map(gate => gate.gateId), ["hire-review"]);
      const original = f.database.authority.gateResults.get(`${root.envelope.runId}:${ONBOARDING_ROSTER_GATE_ID}`); assert.ok(original && "commandId" in original);
      const receipts = createReceiptService({ database: f.database, runReader: testRunService(f.database, f.clock), descriptors: [descriptor] });
      assert.equal(f.database.authority.evidenceReceipts.findByRun(recoveredId), undefined);
      for (const fault of ["gate-missing", "legal-name", "checkpoint", "command", "audit-missing", "audit-changed", "native-missing", "native-changed"] as const) {
        f.setFault(fault);
        try {
          assert.throws(() => receipts.ensureReceipt(recoveredId), fault);
          assert.equal(f.database.authority.evidenceReceipts.findByRun(recoveredId), undefined, fault);
        } finally { f.setFault(undefined); }
      }
      const receipt = receipts.ensureReceipt(recoveredId);
      const expected = redactEvidenceLeaf({ kind: "gate-result", workflowId: WorkflowIdSchema.parse(descriptor.id), gateId: GateIdSchema.parse(ONBOARDING_ROSTER_GATE_ID) },
        { path: "row.references.legalName", field: "legalName", value: "Fixture Hire" });
      const chosen = receipt.observations.find(fact => fact.state === "satisfied" && fact.source.kind === "continued-gate-result"
        && fact.value.key === "row.references.legalName" && canonicalJsonStringify(fact.value) === canonicalJsonStringify(expected));
      assert.ok(chosen?.source.kind === "continued-gate-result");
      assert.equal(chosen.source.sourceRunId, root.envelope.runId); assert.equal(chosen.source.commandId, original.commandId);
      assert.equal(chosen.source.resolvedBy, original.resolvedBy); assert.equal(chosen.source.resolvedAt, original.resolvedAt);
      assert.ok(receipt.decisions.some(decision => decision.kind === "gate" && decision.outcome === "taken"
        && decision.reason.includes(root.envelope.runId) && decision.reason.includes(original.commandId)));
      const input = { descriptor, run: completed.run, result,
        checkpoints: f.database.authority.runCheckpoints.listByItem(descriptor.id, root.envelope.itemId),
        writes: f.database.authority.writeIntents.listByRun(recoveredId).map(intent => ({ intent, attempts: f.database.authority.writeAttempts.listByIntent(intent.writeIntentId) })),
        gateResults: f.database.authority.gateResults.listByRun(recoveredId), continuedGateResults: [original],
        delegations: f.database.withAuthorityTransaction(repositories => [readDelegationEvidence(repositories, recoveredId, "i9-lookup-child")]) };
      assert.deepEqual(buildRunEvidenceReceipt(input), receipt);
      assert.throws(() => buildRunEvidenceReceipt({ ...input, gateResults: [original], continuedGateResults: [] }), /belongs to run/u);
      assert.throws(() => buildRunEvidenceReceipt({ ...input, continuedGateResults: [original, original] }), /duplicate/u);
      assert.throws(() => buildRunEvidenceReceipt({ ...input, gateResults: [{ ...original, runId: recoveredId }] }), /duplicate/u);
      assert.throws(() => buildRunEvidenceReceipt({ ...input, continuedGateResults: [{ ...original, runId: randomUUID() }] }), /continued-gate-membership/u);
      const altered = structuredClone(completed.run); assert.ok(altered.envelope.continuation);
      altered.envelope.continuation.gates[0].digest = FingerprintSchema.parse("b".repeat(64));
      assert.throws(() => buildRunEvidenceReceipt({ ...input, run: altered }), /continued-gate-membership/u);
      assert.deepEqual(f.database.authority.gateResults.listByRun(recoveredId).map(gate => gate.gateId), ["hire-review"]);
    }
  });

  it.each([false, true])("refuses a foreign always-rerun row without continuation, and an asserted row even when captured (%s)", async capturedAssertion => {
    const f = await executionFixture(capturedAssertion), source = f.start();
    assert.equal((await f.execution.step(source, new AbortController().signal)).outcome.state, "parked-gate");
    assert.equal(f.kernel.execute(f.choice(source)).state, "applied");
    const admit = f.execution.lifecycle.admitDelegation.bind(f.execution.lifecycle);
    f.execution.lifecycle.admitDelegation = (context, plan) => {
      f.setFault("legal-name");
      try { return admit(context, plan); } finally { f.setFault(undefined); }
    };
    assert.equal((await f.execution.step(source, new AbortController().signal)).outcome.state, "failed");
    f.execution.lifecycle.admitDelegation = admit;
    const failed = f.database.authority.runs.get(source.envelope.runId); assert.ok(failed);
    const row = f.database.authority.runCheckpoints.listByAttempt(descriptor.id, source.envelope.itemId, "hire-subject", source.envelope.attempt)
      .find(row => row.runId === source.envelope.runId); assert.ok(row);
    let candidate: RunRecord;
    if (capturedAssertion) {
      assert.deepEqual(row.assertion, { step: "ucpath-search", assertedAt: row.writtenAt });
      const result = f.kernel.execute({ commandId: runWorld.nextCommandId(), requestedAt: f.clock.now().toISOString(),
        requestedBy: "local-operator", source: "run-detail", family: "run", type: "recover-run",
        target: { runId: failed.envelope.runId, expectedVersion: failed.version } });
      assert.equal(result.state, "applied", JSON.stringify({ state: result.state,
        code: result.state === "rejected" ? result.code : undefined }));
      const id = appliedRunIds(result).find(id => id !== source.envelope.runId); assert.ok(id);
      const recovered = f.database.authority.runs.get(id); assert.ok(recovered?.envelope.continuation);
      candidate = recovered;
      validateRunContinuation(f.database.authority, candidate.envelope);
      assert.deepEqual(readRunCheckpoint(f.database.authority, candidate.envelope, "hire-subject", true), row);
      assert.ok(recovered.envelope.continuation.checkpoints.some(reference => reference.nodeId === row.nodeId
        && reference.runId === row.runId && reference.attempt === row.attempt && reference.claimGeneration === row.claimGeneration
        && reference.digest === continuationEvidenceDigest(row)));
    } else {
      assert.equal(row.assertion, undefined);
      candidate = f.start();
      assert.equal(candidate.envelope.continuation, undefined);
      assert.equal((await f.execution.step(candidate, new AbortController().signal)).outcome.state, "parked-gate");
      assert.equal(f.kernel.execute(f.choice(candidate)).state, "applied");
    }
    let refused = 0;
    f.execution.lifecycle.admitDelegation = (context, plan) => {
      refused++;
      assert.notEqual(row.runId, context.run.envelope.runId);
      f.setRepositoryView(repositories => ({ ...repositories, runCheckpoints: { ...repositories.runCheckpoints,
        latest: (workflow, itemId, nodeId) => nodeId === "hire-subject" ? row : repositories.runCheckpoints.latest(workflow, itemId, nodeId),
        listByAttempt: (workflow, itemId, nodeId, attempt) => repositories.runCheckpoints.listByAttempt(workflow, itemId, nodeId, attempt)
          .filter(checkpoint => nodeId !== "hire-subject" || checkpoint.runId !== context.run.envelope.runId) } }));
      try { return admit(context, plan); } finally { f.setRepositoryView(undefined); }
    };
    const outcome = await f.execution.step(candidate, new AbortController().signal);
    assert.equal(outcome.outcome.state, "failed"); assert.equal(refused, 1);
    assert.ok(f.database.authority.failures.listByRun(candidate.envelope.runId)
      .some(failure => failure.summary.includes("delegation-scope-checkpoint-mismatch")));
    assert.equal(f.calls.filter(call => call.system === "i9").length, 0);
    assert.deepEqual(f.database.authority.runs.listChildren(candidate.envelope.runId), []);
    assert.deepEqual(f.database.authority.delegationManifests.listByParentRun(candidate.envelope.runId), []);
  });

  describe("explain run on a failed run whose roster resolved", () => {
    async function failedAtCrmSource() {
      const f = await executionFixture(false, { match: "unique", dryRun: true, crmReadFails: true });
      const root = f.start();
      assert.equal((await f.execution.step(root, new AbortController().signal)).outcome.state, "failed");
      assert.deepEqual(f.calls.map(call => call.system), ["crm"]);
      const run = f.database.authority.runs.get(root.envelope.runId); assert.ok(run?.lifecycle.state === "terminal");
      const failure = f.database.authority.failures.listByRun(run.envelope.runId).find(value => value.code === "ONBOARDING_CRM_READ_FAILED");
      assert.ok(failure);
      const result = f.database.authority.runResults.get(run.envelope.runId); assert.ok(result);
      const input = { descriptor, run, result, failure, checkpoints: f.database.authority.runCheckpoints.listByItem(descriptor.id, run.envelope.itemId),
        writes: [], gateResults: f.database.authority.gateResults.listByRun(run.envelope.runId) };
      return { f, run, failure, result, input };
    }

    it("derives a failed unknown receipt whose not-run roster-choice cites the roster.state input fact", async () => {
      const { f, run, input } = await failedAtCrmSource();
      assert.equal(OnboardingCanonicalValueSchema.parse(run.input.parsed.value).roster.state, "resolved");
      const receipt = buildRunEvidenceReceipt(input);
      assert.equal(receipt.result, "failed"); assert.equal(receipt.confidence, "unknown");
      const inputFact = receipt.input.find(fact => fact.id === deriveEvidenceEntryId(receipt.receiptId, "input", "roster.state"));
      assert.ok(inputFact);
      const decision = receipt.decisions.find(value => value.id === deriveEvidenceEntryId(receipt.receiptId, "decision", `not-run.${ONBOARDING_ROSTER_GATE_ID}`));
      assert.ok(decision?.outcome === "not-taken" && decision.kind === "branch");
      assert.deepEqual(decision.evidence, [`observation:${inputFact.id}`]);
      const known = new Set([...receipt.input, ...receipt.observations, ...receipt.output, ...receipt.decisions, ...receipt.actions,
        ...receipt.verification, ...receipt.reuse, ...receipt.warnings].map(entry => String(entry.id)));
      const references = [...receipt.decisions.flatMap(entry => entry.evidence), ...receipt.verification.flatMap(entry => entry.evidence),
        ...receipt.warnings.flatMap(entry => entry.evidence), ...receipt.reuse.map(entry => entry.source)];
      for (const reference of references) {
        assert.ok(reference.startsWith("observation:") && known.has(reference.slice("observation:".length)), reference);
      }
      assert.ok(receipt.verification.every(entry => entry.verdict !== "verified"), "no unexecuted work is verified");
      assert.ok(receipt.actions.every(action => action.kind !== "commit" && action.writeState === "not-attempted"));
      assert.ok(!receipt.actions.some(action => action.taskId !== "read-hire-data" && action.kind === "external-read"));
      assert.deepEqual(f.database.authority.writeIntents.listByRun(run.envelope.runId), []);
    });

    it("reports a missing required roster gate on a failed run as unknown, never verified or not-taken, and cites the taken gate otherwise", async () => {
      const f = await executionFixture(false, { match: "duplicate", dryRun: true, crmReadFails: true });
      const root = f.start(), runId = root.envelope.runId;
      assert.equal((await f.execution.step(root, new AbortController().signal)).outcome.state, "parked-gate");
      assert.equal(f.kernel.execute(f.choice(root)).state, "applied");
      assert.equal((await f.execution.step(root, new AbortController().signal)).outcome.state, "failed");
      const run = f.database.authority.runs.get(runId); assert.ok(run?.lifecycle.state === "terminal");
      assert.equal(OnboardingCanonicalValueSchema.parse(run.input.parsed.value).roster.state, "resolve-required");
      assert.deepEqual(f.database.authority.gateResults.listByRun(runId).map(gate => gate.gateId), [ONBOARDING_ROSTER_GATE_ID]);
      const result = f.database.authority.runResults.get(runId); assert.ok(result);
      const failure = run.lifecycle.failureId === undefined ? undefined : f.database.authority.failures.get(run.lifecycle.failureId); assert.ok(failure);
      const taken = buildRunEvidenceReceipt({ descriptor, run, result, failure, writes: [],
        checkpoints: f.database.authority.runCheckpoints.listByItem(descriptor.id, run.envelope.itemId), gateResults: f.database.authority.gateResults.listByRun(runId) });
      assert.ok(!taken.decisions.some(value => value.id === deriveEvidenceEntryId(taken.receiptId, "decision", `not-run.${ONBOARDING_ROSTER_GATE_ID}`)));
      assert.ok(taken.decisions.some(value => value.kind === "gate" && value.outcome === "taken"));
      // A failed-evidence record binds no gates, so a missing gate result is reported unknown rather than refused (done runs refuse above).
      const receipts = createReceiptService({ database: f.database, runReader: testRunService(f.database, f.clock), descriptors: [descriptor] });
      f.setFault("gate-missing");
      try {
        const ensured = receipts.ensure(runId); assert.equal(ensured.state, "derived");
        const receipt = ensured.receipt;
        const gate = receipt.verification.find(value => value.id === deriveEvidenceEntryId(receipt.receiptId, "verification", `node.${ONBOARDING_ROSTER_GATE_ID}`));
        assert.equal(gate?.verdict, "unknown");
        assert.ok(!receipt.decisions.some(value => value.kind === "gate"));
        assert.ok(!receipt.decisions.some(value => value.id === deriveEvidenceEntryId(receipt.receiptId, "decision", `not-run.${ONBOARDING_ROSTER_GATE_ID}`)));
      } finally { f.setFault(undefined); }
    });

    it("refuses a corrupt failure digest and a result of another run or attempt", async () => {
      const { failure, result, input } = await failedAtCrmSource();
      assert.throws(() => buildRunEvidenceReceipt({ ...input, failure: { ...failure, summary: `${failure.summary} altered` } }), /terminal-failure-result-mismatch/u);
      assert.throws(() => buildRunEvidenceReceipt({ ...input, result: { ...result, attempt: result.attempt + 1 } }), /identity[ -]mismatch/u);
      assert.throws(() => buildRunEvidenceReceipt({ ...input, result: { ...result, runId: randomUUID() } }), /identity[ -]mismatch/u);
    });
  });

});
