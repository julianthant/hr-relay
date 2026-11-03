import { readRunCheckpoint } from "../../../src/backend/runtime/checkpoints/run-checkpoint-reader.js";
import { continuationEvidenceDigest, validateRunContinuation } from "../../../src/backend/storage/sqlite/run-continuation.js";
import { RunCheckpointRecordSchema } from "../../../src/models/workflow/checkpoint.js";
import { readDelegationEvidence } from "../../../src/backend/storage/sqlite/delegation-authority.js";
import { createTimelineEmitter } from "../../../src/backend/storage/events/timeline-emitter.js";
import { TimelineEventRecordSchema, type TimelineEventRecord } from "../../../src/models/events/timeline.js";
import { createNoteTimelineWriter } from "../../../src/backend/storage/events/note-timeline-writer.js";
import { runQueuedSpanEvent } from "../../../src/backend/runs/commands/run-queued-span.js";
import { ActorIdSchema } from "../../../src/rules/identity/ids.js";
import { createReceiptService } from "../../../src/backend/runs/trust/receipt-service.js";
import { redactEvidenceLeaf } from "../../../src/models/trust/evidence-classification.js";
import { GateIdSchema, WorkflowIdSchema } from "../../../src/rules/identity/ids.js";
import { taskStoreRegistry } from "../../../src/backend/app/registries/task-registry.js";
import { childWorkflowModuleOf } from "../../../src/backend/app/registries/workflow-registry.js";
import { buildRunEvidenceReceipt } from "../../../src/backend/runs/provenance/evidence-receipt.js";
import { canonicalChildExecution } from "../../support/helpers/backend/canonical-child-execution.js";
import { healthyCrmDriver, healthyUcpathDriver, ManualScheduler, recordingLogger, recordingTimelineEmitter, sessionFactoryHarness, sessionManagerFor } from "../../support/helpers/phase1f-executor-harness.js";
import { duoCeremonyGatesOver } from "../../support/helpers/duo-ceremony-fixtures.js";
import { testRunLifecycle } from "../../support/fixtures/run-lifecycle-fixtures.js";
import { runClaim } from "../../../src/models/run/record.js";
import { OnboardingResultSchema } from "../../../src/models/workflows/onboarding/result.js";
import type { AuthorityRepositories } from "../../../src/backend/storage/sqlite/authority-database.js";
import type { I9LookupInput } from "../../../src/models/systems/i9/read-section2-signer.js";
import { FingerprintSchema } from "../../../src/rules/identity/ids.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { afterAll, afterEach, describe, it } from "vitest";
import { createStartPlanService } from "../../../src/backend/runs/commands/start-plan-service.js";
import { authenticateOnboardingRosterChoice, buildRunWorkbookSection } from "../../../src/backend/runs/workbooks.js";
import { createWorkbookLibraryService } from "../../../src/backend/workbooks/workbook-library-service.js";
import { encodeEditableWorkbook } from "../../../src/models/dashboard/workbooks.js";
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
import { createProfileFixtureSet } from "../../support/helpers/admission-fixture.js";
import { createCommandKernelTestWorld } from "../../support/helpers/backend/command-kernel-harness.js";
import { unexpectedWorkbookSync } from "../../support/helpers/backend/workbook-sync.js";
import { singleAppliedRunId, appliedRunIds } from "../../support/fixtures/operator-command-fixtures.js";
import { testRunService, testWorkerPorts } from "../../support/fixtures/run-lifecycle-fixtures.js";
import type { EditableWorkbook } from "../../../src/models/dashboard/workbooks.js";
import type { RunRecord } from "../../../src/models/run/record.js";

const descriptor = compileWorkflow(onboardingWorkflow).descriptor;
const managers: Awaited<ReturnType<typeof sessionManagerFor>>[] = [];
const fixtureProfiles = createProfileFixtureSet();
const world = createCommandKernelTestWorld(fixtureProfiles.create);
afterAll(() => fixtureProfiles.close());
afterEach(async () => {
  while (managers.length) await managers.pop()!.closeAll("worker-stop");
  while (world.openDatabases.length) world.openDatabases.pop()!.close();
  while (world.profiles.length) await world.profiles.pop()!.close();
  while (world.roots.length) rmSync(world.roots.pop()!, { recursive: true, force: true });
});

async function fixture(match: "unique" | "missing" | "duplicate" = "duplicate") {
  const h = await world.createHarness(undefined, { descriptors: [descriptor], publishQueued: (run, publication) => {
    assert.ok(publication);
    createTimelineEmitter({ repository: h.database.authority.timelineEvents, clock: h.clock }).emit(runQueuedSpanEvent({ run, ...publication, actorId: ActorIdSchema.parse(publication.actorId) }));
  } });
  const profile = world.profiles.at(-1); assert.ok(profile);
  const profilePath = profile.path;
  const repository = h.database.authority.workbooks;
  const library = createWorkbookLibraryService({ repository, clock: h.clock, sync: unexpectedWorkbookSync });
  const key = "hire@example.test";
  function sheet(id: string, email: string) {
    return { id, name: id, width: ONBOARDING_ROSTER_FIELDS.length, hidden: [], headerRow: 1,
      columnBindings: ONBOARDING_ROSTER_FIELDS.map((fieldId, index) => ({ id: `${id}-${index}`, sourceColumn: index,
        sourceHeader: fieldId, fieldId, basis: "manual" })),
      rows: [{ id: `${id}-header`, cells: ONBOARDING_ROSTER_FIELDS.map(value => ({ value })) },
        { id: `${id}-person`, cells: [email, "Fixture", "Hire", "", null, null, null].map(value => ({ value })) }] };
  }
  const saved = library.create({ name: "Synthetic.xlsx", themes: [], hasFormulas: false,
    sheets: [sheet("people", match === "missing" ? "other@example.test" : key), sheet("archive", match === "duplicate" ? key : "other@example.test")] });
  repository.putType({ id: "onboarding-roster", name: "Onboarding roster", keyFieldId: "email", fields: [...ONBOARDING_ROSTER_FIELDS], defaultWorkbookId: null });
  library.operatorOperation(saved.libraryId, "declare-type", { kind: "metadata", expectedVersion: 1,
    metadata: { typeId: "onboarding-roster", sharePoint: null } });
  const declared = repository.types().find(type => type.id === "onboarding-roster"); assert.ok(declared);
  repository.putType({ ...declared, defaultWorkbookId: saved.libraryId });
  const config = h.database.authority.runtimeConfig.get(); assert.ok(config);
  let snapshots = 0;
  const planner = createStartPlanService({ authority: h.database, authorityRead: h.database, clock: h.clock, ids: h.plannerIds,
    descriptors: { resolve: id => id === descriptor.id ? descriptor : undefined }, planTtlMs: 600_000,
    workbooks: { catalog: () => library.catalog(), libraryVersion: (id, versionId) => library.libraryVersion(id, versionId), snapshot: value => { snapshots++; return library.snapshot(value); } }, configFingerprint: config.configFingerprint,
    configSnapshotId: config.configSnapshotId, plannedBy: "local-operator" });
  const selection = { entry: 1, typeId: "onboarding-roster" };
  const request = { workflowId: descriptor.id, submissions: [{ email: key, mode: "new-hire", configuredJobEndDate: "06/30/2027" }],
    dryRun: false, workbookReferences: [selection] };
  const plan = (value: unknown = request) => {
    const wire = planner.plan(value), record = h.database.authority.startPlans.get(wire.startPlanId); assert.ok(record); return record;
  };
  const start = () => {
    const planned = plan(); assert.equal(planned.refused.length, 0);
    const result = h.kernel.execute(world.startCommand(planned));
    const run = h.database.authority.runs.get(singleAppliedRunId(result)); assert.ok(run); return run;
  };
  function edit(change: (workbook: EditableWorkbook) => void) {
    const record = library.read(saved.libraryId); assert.ok(record);
    const workbook = structuredClone(record.workbook); change(workbook);
    const receipt = library.operatorOperation(saved.libraryId, randomUUID(), { kind: "save", expectedVersion: record.version,
      workbook: encodeEditableWorkbook(workbook) }); assert.equal(receipt.state, "applied");
  }
  function park(run: RunRecord) {
    const ports = testWorkerPorts(h.database, h.clock, { path: profilePath, descriptor, poolIndex: 1 });
    const worker = h.database.authority.workerSlots.list(descriptor.id).find(value => value.poolIndex === 1); assert.ok(worker);
    const claimed = ports.claimNext({ commandId: randomUUID(), workflow: descriptor.id, workerId: worker.workerId });
    assert.equal(claimed.state, "applied"); if (claimed.state !== "applied") throw new Error("claim refused");
    assert.equal(claimed.run.envelope.runId, run.envelope.runId);
    const service = testRunService(h.database, h.clock), now = h.clock.now().toISOString();
    const claim = { workerId: worker.workerId, claimGeneration: claimed.run.claimGeneration };
    for (const state of ["validating", "running"] as const) {
      assert.equal(service.workerTransition({ commandId: randomUUID(), runId: run.envelope.runId, claim,
        lifecycle: { state, workerId: worker.workerId, claimedAt: now, heartbeatAt: now } }).state, "applied");
    }
    const parked = service.workerTransition({ commandId: randomUUID(), runId: run.envelope.runId, claim,
      lifecycle: { state: "parked-gate", gateId: ONBOARDING_ROSTER_GATE_ID, parkedAt: now, resumeAt: ONBOARDING_ROSTER_GATE_ID } });
    assert.equal(parked.state, "applied"); if (parked.state !== "applied") throw new Error("park refused");
    h.database.assertWorkerLifecycleRelease(worker.workerId);
    return parked.run;
  }
  const section = (run: RunRecord) => {
    const current = h.database.authority.runs.get(run.envelope.runId); assert.ok(current);
    return buildRunWorkbookSection(h.database.authority, current);
  };
  const choice = (run: RunRecord) => {
    const resolution = section(run).referenceChoices?.[0]?.resolution;
    assert.ok(resolution?.state === "available");
    return CommandRequestSchema.parse({ commandId: world.nextCommandId(), requestedAt: h.clock.now().toISOString(),
      requestedBy: "local-operator", source: "run-detail", family: "run", type: "resolve-workbook-reference-row",
      target: resolution.target, payload: { sheetId: resolution.candidates[0].sheetId, rowId: resolution.candidates[0].rowId } });
  };
  return { ...h, profilePath, key, library, repository, id: saved.libraryId, selection, request, plan, start, edit, park, section, choice,
    snapshots: () => snapshots };
}

function foreignNative(record: TimelineEventRecord, runId: string) {
  assert.ok(record.payload.kind === "span");
  return TimelineEventRecordSchema.parse({ ...record, scope: { kind: "run", runId },
    payload: { kind: "span", event: { ...record.payload.event, runId } } });
}

type ExecutionFault = "gate-missing" | "legal-name" | "lived-name" | "checkpoint" | "command" | "audit-missing" | "audit-changed" | "native-missing" | "native-changed";

async function executionFixture(corruptAssertedSubject = false) {
  const f = await fixture();
  const calls: { system: string; input: unknown }[] = [];
  const sessions = sessionFactoryHarness({
    crm: () => ({ ...healthyCrmDriver(), readHireData: async (input: { email: string }) => {
      calls.push({ system: "crm", input }); return CrmReadHireData.example;
    } }),
    ucpath: () => ({ ...healthyUcpathDriver(), searchPersonMatch: async (input: unknown) => {
      calls.push({ system: "ucpath", input }); return { hits: [], confirmed: [], dropped: [] };
    } }),
    i9: () => ({ system: "i9" as const, searchEmployees: async () => { throw new Error("unused search"); },
      readRecordSummary: async () => { throw new Error("unused summary"); }, readSection2Signer: async (input: I9LookupInput) => {
        calls.push({ system: "i9", input }); return { i9Status: "not-found" as const, signerName: "" as const };
      } }),
  });
  const manager = await sessionManagerFor(sessions, f.clock, undefined, undefined, duoCeremonyGatesOver(f.database, f.clock));
  managers.push(manager);
  const execution = canonicalChildExecution({ descriptor, stores: taskStoreRegistry, authority: f.database,
    lifecycle: testRunLifecycle(f.database, f.clock), sessions: manager, emitter: recordingTimelineEmitter(f.database, f.clock).emitter,
    ...(corruptAssertedSubject ? { publishCheckpoint: () => {} } : {}),
    taskNotes: createNoteTimelineWriter({ repository: f.database.authority.timelineEvents, clock: f.clock }),
    clock: f.clock, ids: { uuid: randomUUID }, scheduler: new ManualScheduler(f.clock), taskDeadlineMs: 60_000,
    log: recordingLogger().log }, f.database, f.profilePath,
    id => id === descriptor.id ? descriptor : id === "i9-lookup" ? childWorkflowModuleOf("onboarding", "i9-lookup").descriptor : undefined);
  let fault: ExecutionFault | undefined;
  let markSubjectCheckpoint = corruptAssertedSubject;
  let repositoryView: ((repositories: AuthorityRepositories) => AuthorityRepositories) | undefined;
  const transaction = f.database.withAuthorityTransaction.bind(f.database);
  f.database.withAuthorityTransaction = work => transaction(repositories => {
    if (repositoryView !== undefined) return work(repositoryView(repositories));
    if (fault === undefined && !markSubjectCheckpoint) return work(repositories);
    const corruptGate = (gate: ReturnType<AuthorityRepositories["gateResults"]["get"]>) => {
      if (gate === undefined || gate.gateId !== ONBOARDING_ROSTER_GATE_ID) return gate;
      if (fault === "gate-missing") return undefined;
      if (fault === "checkpoint") return { ...gate, checkpointFingerprint: FingerprintSchema.parse("b".repeat(64)) };
      if (fault !== "legal-name" && fault !== "lived-name") return gate;
      const selected = OnboardingRosterChoiceSchema.parse(gate.result.value);
      const row = { ...selected.row, references: { ...selected.row.references,
        ...(fault === "legal-name" ? { legalName: { ...selected.row.references.legalName, firstName: "Injected" } }
          : { livedName: { firstName: "Injected", lastName: "Hire", middleName: "" } }) } };
      const result = { ...gate.result, value: { ...selected, row } };
      return { ...gate, result, checkpointFingerprint: FingerprintSchema.parse(deriveGateResultCheckpointFingerprint(result)) };
    };
    return work({ ...repositories,
      runCheckpoints: { ...repositories.runCheckpoints, insert: input => {
        const row = RunCheckpointRecordSchema.parse(input);
        if (!markSubjectCheckpoint || row.nodeId !== "hire-subject") return repositories.runCheckpoints.insert(row);
        const inserted = repositories.runCheckpoints.insert({ ...row, assertion: { step: "ucpath-search", assertedAt: row.writtenAt } });
        markSubjectCheckpoint = false;
        return inserted;
      } },
      gateResults: { ...repositories.gateResults, get: id => corruptGate(repositories.gateResults.get(id)),
        listByRun: id => repositories.gateResults.listByRun(id).flatMap(gate => {
          const retained = corruptGate(gate); return retained === undefined ? [] : [retained];
        }) },
      commands: { ...repositories.commands, get: id => {
        const command = repositories.commands.get(id);
        return fault === "command" && command?.type === "resolve-workbook-reference-row"
          ? { ...command, payload: { sheetId: "archive", rowId: "archive-person" } } : command;
      } },
      commandAudits: { ...repositories.commandAudits, findByCommand: id => {
        const audit = repositories.commandAudits.findByCommand(id);
        if (fault === "audit-missing") return undefined;
        return fault === "audit-changed" && audit?.request.type === "resolve-workbook-reference-row"
          ? { ...audit, request: { ...audit.request, payload: { sheetId: "archive", rowId: "archive-person" } } } : audit;
      } },
      timelineEvents: { ...repositories.timelineEvents, get: id => {
        const event = repositories.timelineEvents.get(id);
        if (event?.payload.kind !== "span" || event.payload.event.t !== "gate.resolved") return event;
        if (fault === "native-missing") return undefined;
        return fault === "native-changed" ? { ...event, payload: { ...event.payload,
          event: { ...event.payload.event, resultHash: "b".repeat(64) } } } : event;
      } },
    });
  });
  return { ...f, execution, calls, sessions, setFault: (value: ExecutionFault | undefined) => { fault = value; },
    setRepositoryView: (value: typeof repositoryView) => { repositoryView = value; } };
}

describe("Onboarding captured roster admission and row choice", () => {
  it("anchors pending, parked and selected states to their own retained native producers", async () => {
    const f = await fixture("missing"), queued = f.start();
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
    f.edit(workbook => { workbook.sheets[0].rows[1].cells[0].value = f.key; });
    assert.deepEqual(f.section(parked).referenceChoices?.[0]?.native, held.native);
    assert.equal(f.kernel.execute(f.choice(parked)).state, "applied");
    const selected = f.section(parked).referenceChoices?.[0]; assert.ok(selected);
    const resolved = f.database.authority.timelineEvents.get(selected.native.eventId); assert.ok(resolved);
    assert.equal(resolved.payload.kind === "span" && resolved.payload.event.t, "gate.resolved");
    for (const changed of [undefined, foreignNative(resolved, randomUUID())]) {
      assert.throws(() => buildRunWorkbookSection({ ...repositories, timelineEvents: { ...repositories.timelineEvents,
        get: id => id === resolved.eventId ? changed : repositories.timelineEvents.get(id) } },
      repositories.runs.get(queued.envelope.runId)!));
    }
  });

  it("uses the native terminal event for an unresolved cancelled run and permits a later recording clock", async () => {
    const f = await fixture("missing"), run = f.start();
    assert.equal(f.kernel.execute({ commandId: world.nextCommandId(), requestedAt: f.clock.now().toISOString(),
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
  it("binds the default or selected workbook exactly once and retains the immutable typed legal/lived row", async () => {
    const f = await fixture("unique"), run = f.start();
    assert.deepEqual(run.input.parsed.protectedBindings, []);
    const input = OnboardingCanonicalValueSchema.parse(run.input.parsed.value);
    assert.equal(input.roster.state, "resolved"); if (input.roster.state !== "resolved") throw new Error("missing row");
    assert.deepEqual(input.roster.row.references, { legalName: { firstName: "Fixture", lastName: "Hire", middleName: "" }, livedName: null });
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
    assert.equal(selected.planned.length, 1); assert.equal(selected.refused.length, 0);
    assert.equal(OnboardingCanonicalInput.safeParse(f.request.submissions[0]).success, false);
  });

  it("refuses caller roster authority, wrong key/field/type declarations and malformed legal/lived cells", async () => {
    const f = await fixture("unique");
    for (const request of [
      { ...f.request, submissions: [{ ...f.request.submissions[0], roster: ONBOARDING_INPUT_EXAMPLE.roster }] },
      { ...f.request, workbookReferences: [] },
      { ...f.request, workbookReferences: [{ ...f.selection, typeId: "general" }] },
      { ...f.request, workbookReferences: [{ ...f.selection, versionId: "missing" }] },
    ]) assert.equal(f.plan(request).planned.length, 0);
    for (const reference of [{ ...f.selection, keys: ["other@example.test"] }, { ...f.selection, fields: ["email", "livedName"] }]) {
      assert.throws(() => f.plan({ ...f.request, workbookReferences: [reference] }));
    }
    for (const values of [["", "Hire", "", null, null, null], ["Fixture", 4, "", null, null, null],
      ["Fixture", "Hire", "", "Lived", null, null], ["Fixture", "Hire", "", "", "", ""]]) {
      f.edit(workbook => { workbook.sheets[0].rows[1].cells = [f.key, ...values].map(value => ({ value })); });
      assert.equal(f.plan().planned.length, 0);
    }
  });

  it("holds a missing row until its exact key appears in an original worksheet", async () => {
    const f = await fixture("missing"), run = f.park(f.start());
    assert.deepEqual(f.section(run).referenceChoices?.[0]?.resolution,
      { state: "unavailable", code: "WORKBOOK_ROW_CHOICE_UNAVAILABLE", candidates: [] });
    f.edit(workbook => { workbook.sheets[0].rows[1].cells[0].value = f.key.toUpperCase(); });
    assert.equal(f.section(run).referenceChoices?.[0]?.resolution.state, "unavailable");
    f.edit(workbook => { workbook.sheets[0].rows[1].cells[0].value = f.key; });
    const command = f.choice(run);
    assert.equal(f.kernel.execute(command).state, "applied");
    assert.equal(f.database.authority.runs.get(run.envelope.runId)?.lifecycle.state, "queued");
    assert.equal(f.section(run).referenceChoices?.[0]?.resolution.state, "resolved");
    assert.deepEqual(f.repository.runOperations(run.envelope.runId), []);
  });

  it("rebuilds the chosen cross-sheet values, resumes once and leaves the original start snapshot unchanged", async () => {
    const f = await fixture(), run = f.park(f.start()), original = canonicalJsonStringify(run.input);
    const available = f.section(run).referenceChoices?.[0]?.resolution;
    assert.ok(available?.state === "available"); assert.deepEqual(available.candidates.map(row => row.sheetId), ["people", "archive"]);
    f.edit(workbook => { workbook.sheets[1].rows[1].cells[1].value = "Chosen";
      for (const [index, value] of ["Lived", "Hire", ""].entries()) workbook.sheets[1].rows[1].cells[index + 4].value = value; });
    const request = f.choice(run); assert.ok(request.type === "resolve-workbook-reference-row");
    const command = { ...request, payload: { sheetId: "archive", rowId: "archive-person" } };
    assert.equal(f.kernel.execute(command).state, "applied");
    assert.equal(f.kernel.execute(command).state, "already-applied");
    const current = f.database.authority.runs.get(run.envelope.runId); assert.ok(current);
    assert.equal(current.lifecycle.state, "queued"); assert.equal(current.version, run.version + 1);
    assert.equal(canonicalJsonStringify(current.input), original);
    const gate = f.database.authority.gateResults.get(`${run.envelope.runId}:${ONBOARDING_ROSTER_GATE_ID}`); assert.ok(gate);
    const { row: chosen } = authenticateOnboardingRosterChoice(f.database.authority, current, gate);
    assert.equal(chosen.references.legalName.firstName, "Chosen"); assert.equal(chosen.references.livedName?.firstName, "Lived");
    assert.equal(chosen.binding.sheetId, "archive"); assert.equal(chosen.binding.workbookVersion, command.target.workbookVersion);
    const hirePlan = descriptorRuntimeNodes(descriptor).find(node => node.id === "hire-plan"); assert.ok(hirePlan?.kind === "task");
    const bound = OnboardingReadHirePlan.input.parse(hirePlan.bind({ input: current.input.parsed.value,
      outputs: { "crm-source": CrmReadHireData.example, "roster-choice": { decision: "selected", row: chosen } } }));
    assert.deepEqual(bound.roster, chosen);
    f.edit(workbook => { workbook.sheets[1].rows[1].cells[1].value = "Later"; });
    assert.deepEqual(authenticateOnboardingRosterChoice(f.database.authority, current, gate).row, chosen);
    assert.equal(f.section(current).referenceChoices?.[0]?.resolution.state, "resolved");
    assert.equal(f.kernel.execute({ ...command, commandId: world.nextCommandId() }).state, "rejected");
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
    ]) assert.equal(f.kernel.execute({ ...command, commandId: world.nextCommandId(), target }).state, "rejected");
    const tampered = structuredClone(run); tampered.input.parsed.value = { ...OnboardingCanonicalValueSchema.parse(run.input.parsed.value),
      roster: { ...OnboardingCanonicalValueSchema.parse(run.input.parsed.value).roster, reason: "row-missing" } };
    assert.throws(() => buildRunWorkbookSection(f.database.authority, tampered));
    assert.equal(f.database.authority.gateResults.listByRun(run.envelope.runId).length, 0);
    assert.equal(f.database.authority.runs.get(run.envelope.runId)?.lifecycle.state, "parked-gate");
  });

  it.each(["revision", "key", "sheet", "type", "fields", "names"] as const)("refuses stale %s authority without resuming or writing", async change => {
    const f = await fixture(), run = f.park(f.start()), command = f.choice(run);
    if (change === "type") {
      f.repository.putType({ id: "other-roster", name: "Other roster", keyFieldId: "email",
        fields: [...ONBOARDING_ROSTER_FIELDS], defaultWorkbookId: null });
      const record = f.library.read(f.id); assert.ok(record);
      const receipt = f.library.operatorOperation(f.id, randomUUID(), { kind: "metadata", expectedVersion: record.version,
        metadata: { typeId: "other-roster", sharePoint: null } });
      assert.equal(receipt.state, "applied"); assert.equal(f.repository.metadata(f.id).typeId, "other-roster");
    } else f.edit(workbook => {
      if (change === "revision") workbook.name = "Changed.xlsx";
      if (change === "key") workbook.sheets[0].rows[1].cells[0].value = "other@example.test";
      if (change === "sheet") workbook.sheets[0].id = "replacement-sheet";
      if (change === "fields") {
        const binding = workbook.sheets[0].columnBindings?.find(value => value.fieldId === "firstName"); assert.ok(binding);
        binding.fieldId = null;
      }
      if (change === "names") workbook.sheets[0].rows[1].cells[1].value = null;
    });
    const changed = f.library.read(f.id); assert.ok(changed);
    if (change === "fields") assert.equal(changed.workbook.sheets[0].columnBindings?.some(value => value.fieldId === "firstName"), false);
    const candidate = change !== "revision" && command.type === "resolve-workbook-reference-row"
      ? { ...command, target: { ...command.target, workbookVersion: changed.version } } : command;
    assert.equal(f.kernel.execute(candidate).state, "rejected");
    assert.equal(f.database.authority.gateResults.listByRun(run.envelope.runId).length, 0);
    assert.equal(f.database.authority.runs.get(run.envelope.runId)?.lifecycle.state, "parked-gate");
    assert.deepEqual(f.repository.runOperations(run.envelope.runId), []);
  });

  it("never offers newly added worksheets and authenticates retained choice command/audit evidence", async () => {
    const f = await fixture(), run = f.park(f.start());
    f.edit(workbook => { const added = structuredClone(workbook.sheets[0]); added.id = "new-sheet"; added.name = "New"; workbook.sheets.push(added); });
    const command = f.choice(run); assert.ok(command.type === "resolve-workbook-reference-row");
    assert.equal(f.kernel.execute({ ...command, payload: { sheetId: "new-sheet", rowId: "people-person" } }).state, "rejected");
    const actual = CommandRequestSchema.parse({ ...command, commandId: world.nextCommandId() });
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
      references: { ...parsed.references, legalName: { ...parsed.references.legalName, firstName: "Injected" } } } } } };
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
    f.edit(workbook => { workbook.sheets[0].rows[1].cells[1].value = "Chosen";
      for (const [index, value] of ["Lived", "Hire", ""].entries()) workbook.sheets[0].rows[1].cells[index + 4].value = value; });
    assert.equal(f.kernel.execute(f.choice(root)).state, "applied");
    f.edit(workbook => { workbook.sheets[0].rows[1].cells[1].value = "Later"; });
    const executed = await f.execution.execute(root, new AbortController().signal);
    assert.ok(executed.run?.lifecycle.state === "terminal" && executed.run.lifecycle.outcome === "done",
      JSON.stringify({ lifecycle: executed.run?.lifecycle.state, outcomes: executed.outcomes.map(value => value.state),
        failures: [root, ...f.database.authority.runs.listChildren(root.envelope.runId)].flatMap(run =>
          f.database.authority.failures.listByRun(run.envelope.runId).map(({ code, nodeId, summary, debug }) => ({ code, nodeId,
            authority: summary.match(/\b(?:delegation|run-continuation|checkpoint|worker)[a-z0-9-]+\b/g),
            frames: debug?.stack.match(/src\/[a-zA-Z0-9/_.-]+:\d+:\d+/g) }))) }));
    const result = f.database.authority.runResults.get(root.envelope.runId); assert.ok(result);
    const output = OnboardingResultSchema.parse(result.result.value);
    assert.equal(output.plan.employee.firstName, "Chosen"); assert.equal(output.plan.employee.preferredFirstName, "Lived");
    assert.equal(output.hireWrite.state, "unimplemented");
    assert.deepEqual(f.calls.map(call => call.system), ["crm", "ucpath", "i9", "crm", "ucpath"]);
    const childCall = f.calls.find(call => call.system === "i9"); assert.ok(childCall);
    assert.equal(Reflect.get(Object(childCall.input), "firstName"), "Chosen");
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
    assert.deepEqual(f.repository.runOperations(root.envelope.runId), []);
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
    const recoveredResult = f.kernel.execute({ commandId: world.nextCommandId(), requestedAt: f.clock.now().toISOString(),
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
      assert.deepEqual(f.database.authority.gateResults.listByRun(recoveredId), []);
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
        { path: "row.references.legalName.firstName", field: "firstName", value: "Fixture" });
      const chosen = receipt.observations.find(fact => fact.state === "satisfied" && fact.source.kind === "continued-gate-result"
        && fact.value.key === "row.references.legalName.firstName" && canonicalJsonStringify(fact.value) === canonicalJsonStringify(expected));
      assert.ok(chosen?.source.kind === "continued-gate-result");
      assert.equal(chosen.source.sourceRunId, root.envelope.runId); assert.equal(chosen.source.commandId, original.commandId);
      assert.equal(chosen.source.resolvedBy, original.resolvedBy); assert.equal(chosen.source.resolvedAt, original.resolvedAt);
      assert.ok(receipt.decisions.some(decision => decision.kind === "gate" && decision.outcome === "taken"
        && decision.reason.includes(root.envelope.runId) && decision.reason.includes(original.commandId)));
      const input = { descriptor, run: completed.run, result,
        checkpoints: f.database.authority.runCheckpoints.listByItem(descriptor.id, root.envelope.itemId),
        gateResults: [], continuedGateResults: [original],
        delegations: f.database.withAuthorityTransaction(repositories => [readDelegationEvidence(repositories, recoveredId, "i9-lookup-child")]) };
      assert.deepEqual(buildRunEvidenceReceipt(input), receipt);
      assert.throws(() => buildRunEvidenceReceipt({ ...input, gateResults: [original], continuedGateResults: [] }), /belongs to run/u);
      assert.throws(() => buildRunEvidenceReceipt({ ...input, continuedGateResults: [original, original] }), /duplicate/u);
      assert.throws(() => buildRunEvidenceReceipt({ ...input, gateResults: [{ ...original, runId: recoveredId }] }), /duplicate/u);
      assert.throws(() => buildRunEvidenceReceipt({ ...input, continuedGateResults: [{ ...original, runId: randomUUID() }] }), /continued-gate-membership/u);
      const altered = structuredClone(completed.run); assert.ok(altered.envelope.continuation);
      altered.envelope.continuation.gates[0].digest = FingerprintSchema.parse("b".repeat(64));
      assert.throws(() => buildRunEvidenceReceipt({ ...input, run: altered }), /continued-gate-membership/u);
      assert.deepEqual(f.database.authority.gateResults.listByRun(recoveredId), []);
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
      const result = f.kernel.execute({ commandId: world.nextCommandId(), requestedAt: f.clock.now().toISOString(),
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

});
