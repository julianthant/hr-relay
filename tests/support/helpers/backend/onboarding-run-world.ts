import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { runQueuedSpanEvent } from "../../../../src/backend/runs/commands/run-queued-span.js";
import { ActorIdSchema } from "../../../../src/rules/identity/ids.js";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { childWorkflowModuleOf } from "../../../../src/backend/app/registries/workflow-registry.js";
import { canonicalChildExecution } from "./canonical-child-execution.js";
import { healthyCrmDriver, healthyUcpathDriver, ManualScheduler, recordingLogger, recordingTimelineEmitter, sessionFactoryHarness, sessionManagerFor } from "../phase1f-executor-harness.js";
import { duoCeremonyGatesOver } from "../duo-ceremony-fixtures.js";
import { testRunLifecycle } from "../../fixtures/run-lifecycle-fixtures.js";
import type { AuthorityRepositories } from "../../../../src/backend/storage/sqlite/authority-database.js";
import type { I9LookupInput } from "../../../../src/models/systems/i9/read-section2-signer.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { createStartPlanService } from "../../../../src/backend/runs/commands/start-plan-service.js";
import { buildRunWorkbookSection } from "../../../../src/backend/runs/workbooks.js";
import { createWorkbookLibraryService } from "../../../../src/backend/workbooks/workbook-library-service.js";
import { encodeEditableWorkbook } from "../../../../src/models/dashboard/workbooks.js";
import { ONBOARDING_ROSTER_FIELDS, ONBOARDING_ROSTER_GATE_ID, OnboardingRosterChoiceSchema } from "../../../../src/models/workflows/onboarding/roster.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { deriveGateResultCheckpointFingerprint } from "../../../../src/models/workflow/gates.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { CrmReadHireData } from "../../../../src/models/systems/crm/read-hire-data.js";
import { compileWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import { onboardingWorkflow } from "../../../../src/workflows/onboarding/workflow.js";
import { createProfileFixtureSet } from "../admission-fixture.js";
import { createCommandKernelTestWorld } from "./command-kernel-harness.js";
import { unexpectedWorkbookSync } from "./workbook-sync.js";
import { singleAppliedRunId } from "../../fixtures/operator-command-fixtures.js";
import { testRunService, testWorkerPorts } from "../../fixtures/run-lifecycle-fixtures.js";
import type { EditableWorkbook } from "../../../../src/models/dashboard/workbooks.js";
import type { RunRecord } from "../../../../src/models/run/record.js";

import { createWriteSequencer } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { createRunWorkbookService } from "../../../../src/backend/runs/workbooks.js";
import { createWorkbookLibraryAdapter } from "../../../../src/backend/processing/providers/workbook-library-adapter.js";
import type { ProviderAdapter } from "../../../../src/workflow-kit/providers.js";
import { createDeterministicI9Driver } from "../../../../src/backend/systems/i9/driver/fake.js";
import { deterministicHireOperations } from "../../../../src/backend/systems/ucpath/driver/hire-fake.js";
import { UCPATH_HIRE_SUBJECT } from "../../../../src/models/ui/ucpath-hire.js";
import type { z } from "zod";
import { SearchPersonMatchOutputSchema } from "../../../../src/models/systems/ucpath/search-person-match.js";
import { ONBOARDING_WRITE_REVIEW_GATE, OnboardingWriteApprovalSchema } from "../../../../src/models/workflows/onboarding/read-write-plan.js";

export function createOnboardingRunWorld() {
  const descriptor = compileWorkflow(onboardingWorkflow).descriptor;
  const managers: Awaited<ReturnType<typeof sessionManagerFor>>[] = [];
  const fixtureProfiles = createProfileFixtureSet();
  const world = createCommandKernelTestWorld(fixtureProfiles.create);
  async function fixture(match: "unique" | "missing" | "duplicate" = "duplicate", options: { dryRun?: boolean; mode?: "new-hire" | "rehire"; selectedRow?: boolean; second?: "same" | "other"; general?: boolean; legalName?: string; livedName?: string } = {}) {
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
          { id: `${id}-person`, cells: [email, options.legalName ?? "Fixture Hire", options.livedName ?? null, null, null].map(value => ({ value })) },
          ...(match === "duplicate" && id === "people" ? [{ id: "people-second",
            cells: [email, "Second Hire", null, null, null].map(value => ({ value })) }] : [])] };
    }
    const saved = library.create({ name: "Synthetic.xlsx", themes: [], hasFormulas: false,
      sheets: [sheet("people", match === "missing" ? "other@example.test" : key), sheet("archive", "other@example.test")] });
    repository.putType({ id: "onboarding-roster", name: "Onboarding roster", keyFieldId: "email", fields: [...ONBOARDING_ROSTER_FIELDS], defaultWorkbookId: null });
    if (options.general !== true) library.operatorOperation(saved.libraryId, "declare-type", { kind: "metadata", expectedVersion: 1,
      metadata: { typeId: "onboarding-roster", sharePoint: null } });
    const second = options.second === undefined ? undefined : library.create({ name: "Other roster.xlsx", themes: [], hasFormulas: false,
      sheets: [sheet("people", options.second === "same" ? (match === "missing" ? "other@example.test" : key) : "elsewhere@example.test"), sheet("archive", "other@example.test")] });
    if (second !== undefined && options.general !== true) library.operatorOperation(second.libraryId, "declare-type", { kind: "metadata", expectedVersion: 1,
      metadata: { typeId: "onboarding-roster", sharePoint: null } });
    const config = h.database.authority.runtimeConfig.get(); assert.ok(config);
    let snapshots = 0;
    const planner = createStartPlanService({ authority: h.database, authorityRead: h.database, clock: h.clock, ids: h.plannerIds,
      descriptors: { resolve: id => id === descriptor.id ? descriptor : undefined }, planTtlMs: 600_000,
      workbooks: { createReferenceCapture: () => { const capture = library.createReferenceCapture(); return value => { snapshots++; return capture(value); }; } }, configFingerprint: config.configFingerprint,
      configSnapshotId: config.configSnapshotId, plannedBy: "local-operator" });
    const version = library.read(saved.libraryId).version;
    const selection = { entry: 1, libraryId: saved.libraryId,
      versionId: library.libraryVersion(saved.libraryId).version.id, sheetId: "people", expectedVersion: version,
      ...(options.selectedRow ? { selectedRow: { sheetId: "people", rowId: "people-person" } } : {}) };
    const request = { workflowId: descriptor.id, submissions: [{ email: key, mode: options.mode ?? "new-hire", configuredJobEndDate: "06/30/2027" }],
      dryRun: options.dryRun ?? false, workbookReferences: second === undefined ? [selection]
        : [selection, { entry: 1, libraryId: second.libraryId, versionId: library.libraryVersion(second.libraryId).version.id, sheetId: "people",
          expectedVersion: library.read(second.libraryId).version }] };
    const plan = (value: unknown = request) => {
      const wire = planner.plan(value), record = h.database.authority.startPlans.get(wire.startPlanId); assert.ok(record); return record;
    };
    const start = (value: unknown = request) => {
      const planned = plan(value); assert.equal(planned.refused.length, 0);
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
      return parked.run;
    }
    const section = (run: RunRecord) => {
      const current = h.database.authority.runs.get(run.envelope.runId); assert.ok(current);
      return buildRunWorkbookSection(h.database.authority, current);
    };
    const choice = (run: RunRecord, index = 0) => {
      const resolution = section(run).referenceChoices?.[0]?.resolution;
      assert.ok(resolution?.state === "available");
      const candidate = resolution.candidates[index]; assert.ok(candidate);
      return CommandRequestSchema.parse({ commandId: world.nextCommandId(), requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator", source: "run-detail", family: "run", type: "resolve-workbook-reference-row",
        target: resolution.target, payload: { sheetId: candidate.sheetId, rowId: candidate.rowId,
          ...(candidate.referenceDigest === undefined || candidate.workbookVersion === undefined ? {}
            : { referenceDigest: candidate.referenceDigest, workbookVersion: candidate.workbookVersion }) } });
    };
    return { ...h, profilePath, key, library, repository, id: saved.libraryId, secondId: second?.libraryId, selection, request, plan, start, edit, park, section, choice,
      snapshots: () => snapshots };
  }

  type ExecutionFault = "gate-missing" | "legal-name" | "lived-name" | "checkpoint" | "command" | "audit-missing" | "audit-changed" | "native-missing" | "native-changed";

  async function executionFixture(corruptAssertedSubject = false, options: {
    match?: "unique" | "missing" | "duplicate"; dryRun?: boolean; mode?: "new-hire" | "rehire"; selectedRow?: boolean; second?: "same" | "other"; legalName?: string; livedName?: string; crmReadFails?: boolean;
    personMatch?: z.output<typeof SearchPersonMatchOutputSchema>;
    hire?: Omit<Parameters<typeof deterministicHireOperations>[0], "now">;
    i9?: Partial<Omit<Parameters<typeof createDeterministicI9Driver>[0], "now">>;
  } = {}) {
    const f = await fixture(options.match, options);
    const i9 = createDeterministicI9Driver({ lookup: { i9Status: "not-found", signerName: "" }, ...options.i9, now: f.clock.now().toISOString() });
    const hire = deterministicHireOperations({ ...options.hire, now: f.clock.now().toISOString() });
    const calls: { system: string; input: unknown }[] = [];
    const sessions = sessionFactoryHarness({
      crm: () => ({ ...healthyCrmDriver(), readHireData: async (input: { email: string }) => {
        calls.push({ system: "crm", input });
        if (options.crmReadFails === true) throw new Error("synthetic CRM read failure");
        return CrmReadHireData.example;
      } }),
      ucpath: () => {
        const base = healthyUcpathDriver();
        return { ...base, ...hire, read: async (id: Parameters<typeof base.read>[0]) => id === UCPATH_HIRE_SUBJECT ? hire.readHireSubject() : base.read(id),
          searchPersonMatch: async (input: unknown) => {
            calls.push({ system: "ucpath", input }); return options.personMatch ?? { hits: [], confirmed: [], dropped: [] };
          } };
      },
      i9: () => ({ ...i9, readSection2Signer: async (input: I9LookupInput) => {
        calls.push({ system: "i9", input }); return i9.readSection2Signer(input);
      } }),
    });
    const manager = await sessionManagerFor(sessions, f.clock, undefined, undefined, duoCeremonyGatesOver(f.database, f.clock));
    managers.push(manager);
    const lifecycle = testRunLifecycle(f.database, f.clock), emitter = recordingTimelineEmitter(f.database, f.clock).emitter;
    const scheduler = new ManualScheduler(f.clock), ids = { uuid: randomUUID }, log = recordingLogger().log;
    const writeSequencer = createWriteSequencer({ lifecycle, stores: taskStoreRegistry, authority: f.database,
      sessions: manager, emitter, clock: f.clock, ids, scheduler, taskDeadlineMs: 60_000, operator: "local-operator", log });
    const workbooks = createRunWorkbookService({ database: f.database, clock: f.clock,
      resolveDescriptor: id => id === descriptor.id ? descriptor : undefined });
    const adapter: ProviderAdapter<"workbooks.library"> = { capability: "workbooks.library", invoke(request, invocation) {
      const running = f.database.authority.runs.listByWorkflow(descriptor.id).filter(run => run.lifecycle.state === "running");
      assert.equal(running.length, 1); const run = running[0]; assert.ok(run);
      return createWorkbookLibraryAdapter({ runId: run.envelope.runId, repository: f.repository, clock: f.clock,
        references: { runId: run.envelope.runId, write: command => workbooks.write(run, command) } }).invoke(request, invocation);
    } };
    const rawExecution = canonicalChildExecution({ descriptor, stores: taskStoreRegistry, authority: f.database,
      lifecycle, sessions: manager, emitter, writeSequencer,
      providers: { adapters: { "workbooks.library": adapter }, configSnapshots: f.database.authority.configSnapshots, idFactory: { next: randomUUID } },
      ...(corruptAssertedSubject ? { publishCheckpoint: () => {} } : {}),
      taskNotes: createNoteTimelineWriter({ repository: f.database.authority.timelineEvents, clock: f.clock }),
      clock: f.clock, ids: { uuid: randomUUID }, scheduler: new ManualScheduler(f.clock), taskDeadlineMs: 60_000,
      log: recordingLogger().log }, f.database, f.profilePath,
      id => id === descriptor.id ? descriptor : id === "i9-lookup" ? childWorkflowModuleOf("onboarding", "i9-lookup").descriptor : undefined);
    function approve(run: RunRecord, decision: z.input<typeof OnboardingWriteApprovalSchema>) {
      const current = f.database.authority.runs.get(run.envelope.runId); assert.ok(current?.lifecycle.state === "parked-gate" && current.lifecycle.gateId === ONBOARDING_WRITE_REVIEW_GATE);
      return rawExecution.kernel.execute(CommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: f.clock.now().toISOString(),
        requestedBy: "local-operator", source: "dashboard", family: "gate", type: "resolve-gate",
        target: { runId: run.envelope.runId, gateId: ONBOARDING_WRITE_REVIEW_GATE, expectedVersion: current.version },
        payload: { result: { schemaHash: deriveSchemaHash(OnboardingWriteApprovalSchema, "output"), value: decision } } }));
    }
    const execution = { ...rawExecution,
      async execute(root: RunRecord, signal: AbortSignal) {
        const first = await rawExecution.execute(root, signal);
        if (first.run?.lifecycle.state !== "parked-gate" || first.run.lifecycle.gateId !== ONBOARDING_WRITE_REVIEW_GATE) return first;
        assert.deepEqual(f.database.authority.writeIntents.listByRun(root.envelope.runId), []);
        assert.deepEqual(f.repository.runOperations(root.envelope.runId), []);
        assert.equal(approve(root, { decision: "new-hire", ruledOut: [] }).state, "applied");
        const next = await rawExecution.execute(root, signal);
        return { ...next, outcomes: [...first.outcomes, ...next.outcomes] };
      },
    };
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
          ...(fault === "legal-name" ? { legalName: "Injected Hire" } : { livedName: "Injected Hire" }) } };
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
    return { ...f, execution, rawExecution, approve, calls, sessions, hire, i9, setFault: (value: ExecutionFault | undefined) => { fault = value; },
      setRepositoryView: (value: typeof repositoryView) => { repositoryView = value; } };
  }

    return { fixture, executionFixture, nextCommandId: world.nextCommandId, close: () => fixtureProfiles.close(), cleanup: async () => {
      while (managers.length) await managers.pop()!.closeAll("worker-stop");
      while (world.openDatabases.length) world.openDatabases.pop()!.close();
      while (world.profiles.length) await world.profiles.pop()!.close();
      while (world.roots.length) { const root = world.roots.pop(); assert.ok(root); rmSync(root, { recursive: true, force: true }); }
    } };
}
