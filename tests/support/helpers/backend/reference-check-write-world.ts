import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { createWorkbookLibraryAdapter } from "../../../../src/backend/processing/providers/workbook-library-adapter.js";
import type { RunDetailQueryDeps } from "../../../../src/backend/runs/queries/run-detail.js";
import { createRunWorkbookService } from "../../../../src/backend/runs/workbooks.js";
import type { RunExecutorDependencies } from "../../../../src/backend/runtime/execution/run-executor.js";
import { readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { createWriteSequencer } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { createWorkbookLibraryService } from "../../../../src/backend/workbooks/workbook-library-service.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { ConfigSnapshotRecordSchema } from "../../../../src/models/config/snapshot.js";
import type { ActionDescriptorWire } from "../../../../src/models/dashboard/actions.js";
import type { WorkbookActiveSelectionSchema } from "../../../../src/models/dashboard/workbook-library.js";
import { REFERENCE_CHECK_REVIEW_GATE, ReferenceCheckReviewSchema } from "../../../../src/models/processing/workbooks/reference-check-stop.js";
import { REFERENCE_CHECK, VerifyWorkbookPerson } from "../../../../src/models/processing/workbooks/verify-person.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import type { AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { PREFERENCES_SNAPSHOT } from "../../fixtures/phase1c-contract-fixtures.js";
import { testRunLifecycle, testRunService } from "../../fixtures/run-lifecycle-fixtures.js";
import type { SessionFactoryHarness } from "../phase1f-executor-harness.js";
import { boundProfileAdmission } from "../synthetic-database-admission.js";
import { canonicalChildExecution } from "./canonical-child-execution.js";
import { createRunExecutorTestWorld } from "./run-executor-world.js";
import { unexpectedWorkbookSync } from "./workbook-sync.js";

const CheckLines = VerifyWorkbookPerson.output.shape.checks;
/** The queue row's own cancel descriptor, as the run's row actions serve it. */
export const CANCEL_ROW_ACTION = { kind: "command", key: "cancel", label: "Cancel run", command: "cancel", expectedVersion: 1,
  intent: "neutral", icon: "cancel", placement: ["row"] } as unknown as ActionDescriptorWire;

/** Runs a writing workflow through the real start plan, start command, write sequencer and executor against real library spreadsheets. */
export function createReferenceCheckWriteWorld() {
  const world = createRunExecutorTestWorld();
  return { cleanup: world.cleanup, async fixture(descriptor: AnyWorkflowDescriptor, sessions: SessionFactoryHarness, resolve: (id: string) => AnyWorkflowDescriptor | undefined = id => id === descriptor.id ? descriptor : undefined) {
    const h = await world.executorHarness({ descriptor, sessions });
    const { database, path, clock } = h.authority, admission = boundProfileAdmission(path);
    const settings = readSettings(database.authority), resolved = resolveConfigWithProvenance(settings.settings, hostConfigFacts({}), clock,
      { stateRoot: admission.stateRoot, artifactRoot: admission.artifactRoot });
    const snapshot = ConfigSnapshotRecordSchema.parse({ ...PREFERENCES_SNAPSHOT, configSnapshotId: randomUUID(), revision: settings.revision,
      fingerprint: resolved.fingerprint, config: resolved.config, provenance: resolved.provenance, capturedAt: clock.now().toISOString(), capturedBy: "local-operator" });
    database.authority.configSnapshots.insert(snapshot);
    database.authority.runtimeConfig.activate({ settingsRevision: settings.revision, settingsFingerprint: settings.settingsFingerprint,
      configSnapshotId: snapshot.configSnapshotId, configFingerprint: snapshot.fingerprint, activatedAt: snapshot.capturedAt });
    const library = createWorkbookLibraryService({ repository: database.authority.workbooks, clock, sync: unexpectedWorkbookSync });
    const runWorkbooks = createRunWorkbookService({ database, clock });
    const writeSequencer = createWriteSequencer({ lifecycle: testRunLifecycle(database, clock), stores: h.deps.stores, authority: database,
      sessions: h.manager, emitter: h.deps.emitter, clock, ids: { uuid: randomUUID }, scheduler: h.scheduler, taskDeadlineMs: 60_000,
      operator: "local-operator", log: h.deps.log });
    const deps: RunExecutorDependencies = { ...h.deps, taskNotes: createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock }), writeSequencer };
    const execution = canonicalChildExecution(deps, database, path, resolve, undefined, { workbooks: library,
      resources: (_reader, run) => ({ providers: { configSnapshots: database.authority.configSnapshots, idFactory: { next: randomUUID },
        adapters: { "workbooks.library": createWorkbookLibraryAdapter({ repository: database.authority.workbooks, runId: run.envelope.runId, clock,
          references: { runId: run.envelope.runId, write: () => { throw new Error("the reference check must not write a reference"); },
            verifyPerson: command => runWorkbooks.verifyPerson(run, command) } }) } } }) });
    /** Saves one library spreadsheet; `rows` follow the header row, so the first data row is sheet row 2. */
    const spreadsheet = (name: string, sheetName: string, fields: readonly string[], rows: readonly (readonly (string | number)[])[]): z.infer<typeof WorkbookActiveSelectionSchema> => {
      const saved = library.create({ name, themes: [], hasFormulas: false, sheets: [{ id: "sheet", name: sheetName, width: fields.length, hidden: [], headerRow: 1,
        columnBindings: fields.map((fieldId, index) => ({ id: `column-${String(index)}`, sourceColumn: index, sourceHeader: fieldId, fieldId, basis: "manual" as const })),
        rows: [{ id: "header", cells: fields.map(value => ({ value })) }, ...rows.map((cells, index) => ({ id: `row-${String(index)}`, cells: cells.map(value => ({ value })) }))] }] });
      return { entry: 1, typeId: REFERENCE_CHECK.id, libraryId: saved.libraryId, versionId: library.libraryVersion(saved.libraryId).version.id,
        sheetId: "sheet", expectedVersion: library.read(saved.libraryId).version };
    };
    const start = (input: unknown, picks: readonly z.infer<typeof WorkbookActiveSelectionSchema>[], dryRun = false) =>
      execution.start(descriptor, input, { dryRun, ...(picks.length === 0 ? {} : { workbookReferences: picks }) });
    const execute = async (run: RunRecord) => {
      const { run: settled } = await execution.execute(run, world.SIGNAL);
      assert.ok(settled);
      return settled;
    };
    const current = (run: RunRecord) => { const stored = database.authority.runs.get(run.envelope.runId); assert.ok(stored); return stored; };
    const command = (run: RunRecord, request: Readonly<Record<string, unknown>>) => execution.kernel.execute(CommandRequestSchema.parse({ commandId: randomUUID(),
      requestedAt: clock.now().toISOString(), requestedBy: "local-operator", ...request }));
    /** Answers the parked reference review with its one gate answer, "Continue anyway". */
    const continueAnyway = (run: RunRecord) => command(run, { source: "dashboard", family: "gate", type: "resolve-gate",
      target: { runId: run.envelope.runId, gateId: REFERENCE_CHECK_REVIEW_GATE, expectedVersion: current(run).version },
      payload: { result: { schemaHash: deriveSchemaHash(ReferenceCheckReviewSchema, "output"), value: { decision: "continue" } } } });
    const cancel = (run: RunRecord) => command(run, { source: "queue-row", family: "run", type: "cancel", target: { runId: run.envelope.runId, expectedVersion: current(run).version } });
    const retry = (run: RunRecord) => command(run, { source: "queue-row", family: "run", type: "retry", target: { runId: run.envelope.runId, expectedVersion: current(run).version } });
    const events = (run: RunRecord) => database.authority.timelineEvents.page({}).filter(event => event.scope.kind === "run" && event.scope.runId === run.envelope.runId);
    /** The check's observed Logs lines, in the order the run recorded them. */
    const checkLines = (run: RunRecord) => events(run).flatMap(event => event.payload.kind === "span" && event.payload.event.t === "data.observed" && event.payload.event.nodeId === "reference-check"
      ? event.payload.event.points.flatMap(point => point.field !== "checks" ? [] : point.values.flatMap(value => value.state === "allowed" ? CheckLines.parse(value.value).map(check => check.line) : [value.state]))
      : []);
    /** The outcome of each reference node's task or gate span, in the order the run ended them. */
    const nodeSpans = (run: RunRecord, nodeId: string) => events(run).flatMap(event => event.payload.kind === "span" && event.payload.event.t === "span.ended"
      && event.payload.event.spanPath.includes(`/${nodeId}#`) ? [[event.payload.event.outcome, event.payload.event.notRunReason]] : []);
    const reader = testRunService(database, clock);
    const gateDeps = { runReader: reader, authority: { listGateResults: (runId: string) => database.authority.gateResults.listByRun(runId) },
      projection: { queueSurface: () => ({ actions: [CANCEL_ROW_ACTION] }) },
      canonical: { reader, database, descriptors: { resolve } } } as unknown as RunDetailQueryDeps;
    return { database, clock, start, execute, current, continueAnyway, cancel, retry, events, checkLines, nodeSpans, spreadsheet, gateDeps };
  } };
}
