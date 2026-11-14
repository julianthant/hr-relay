import { crmDocDownloadModule } from "../../support/helpers/registered-workflows.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { it } from "vitest";
import { buildRunEvidenceReceipt } from "../../../src/backend/runs/provenance/evidence-receipt.js";
import { deriveEvidenceEntryId } from "../../../src/models/trust/evidence-identity.js";
import type { AnyWorkflowDescriptor } from "../../../src/workflow-kit/workflow.js";
import { STEP_PROOF_MODULES } from "../../../src/backend/app/registries/step-proof-modules.js";
import { taskStoreRegistry } from "../../../src/backend/app/registries/task-registry.js";
import { createRunResourcesFactory } from "../../../src/backend/app/composition/worker/run-resources.js";
import { composeWorkerArtifactProjector } from "../../../src/backend/app/composition/worker/artifact-output.js";
import { createContentAddressedArtifactWriter } from "../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { WorkbookLibraryError } from "../../../src/backend/workbooks/workbook-library-error.js";
import { createWorkbookLibraryService } from "../../../src/backend/workbooks/workbook-library-service.js";
import { createDeterministicCrmOnboardingDriver } from "../../../src/backend/systems/crm/driver/fake.js";
import { executeClaimedRun } from "../../../src/backend/runtime/execution/run-executor.js";
import { WorkerSessionManager } from "../../../src/backend/runtime/workers/worker-sessions.js";
import { createStartPlanService } from "../../../src/backend/runs/commands/start-plan-service.js";
import { createRunWorkbookService, buildRunWorkbookSection, authenticateWorkbookReferenceExecution, authenticateWorkbookReferenceChoice } from "../../../src/backend/runs/workbooks.js";
import { createTimelineEmitter } from "../../../src/backend/storage/events/timeline-emitter.js";
import { runQueuedSpanEvent } from "../../../src/backend/runs/commands/run-queued-span.js";
import { RunRecordSchema } from "../../../src/models/run/record.js";
import { CrmReadOnboardingRecord } from "../../../src/models/systems/crm/read-onboarding-record.js";
import { CrmReadOnboardingDates } from "../../../src/models/systems/crm/read-onboarding-dates.js";
import { ReadCrmWorksheetArchives } from "../../../src/models/workflows/crm-doc-download/read-worksheet-archives.js";
import { decodeWorkbookReference } from "../../../src/models/processing/workbooks/read-reference.js";
import { ReadCrmDocumentRows, CrmDocumentRowsSchema, CrmDocumentRowChoiceSchema } from "../../../src/models/workflows/crm-doc-download/read-document-rows.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import { deriveGateResultCheckpointFingerprint } from "../../../src/models/workflow/gates.js";
import { ONBOARDING_ROSTER_TYPE_ID } from "../../../src/models/workflows/onboarding/roster.js";
import { CRM_DOCUMENT_ROSTER_FIELDS } from "../../../src/models/workflows/crm-doc-download/documents.js";
import { WorkerIdSchema, WorkflowIdSchema, ActorIdSchema, FingerprintSchema } from "../../../src/rules/identity/ids.js";
import { CommandRequestSchema } from "../../../src/rules/commands/commands.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { foundationFixture } from "../../support/helpers/database-foundation/fixtures.js";
import { ManualScheduler, sessionFactoryHarness, recordingLogger } from "../../support/helpers/phase1f-executor-harness.js";
import { createCommandKernelTestWorld } from "../../support/helpers/backend/command-kernel-harness.js";
import { singleAppliedRunId } from "../../support/fixtures/operator-command-fixtures.js";
import { testRunLifecycle, testWorkerPorts } from "../../support/fixtures/run-lifecycle-fixtures.js";
import { sequentialIdFactory } from "../../support/fixtures/phase1f-run-fixtures.js";
import { duoCeremonyGatesOver } from "../../support/helpers/duo-ceremony-fixtures.js";
import { unexpectedWorkbookSync } from "../../support/helpers/backend/workbook-sync.js";
import { importWorkbook } from "../../../src/rules/spreadsheets/workbook-io.js";
import { CRM_DOCUMENT_RECORDS_FIXTURE, crmDocumentWorkbookFixture } from "../../support/fixtures/crm-doc-download.js";

async function runCrm(mode: "complete" | "ambiguous" | "missing" | "download-failed" | "cancelled" | "split", descriptor: AnyWorkflowDescriptor = crmDocDownloadModule.descriptor,
  inspect?: (world: { f: Awaited<ReturnType<typeof foundationFixture>>; runId: string; itemId: string }) => void) {
  const f = await foundationFixture(), controller = new AbortController();
  const world = createCommandKernelTestWorld();
  let manager: WorkerSessionManager | undefined, resources: ReturnType<typeof createRunResourcesFactory> | undefined;
  try {
    const h = await world.createHarness(undefined, { profile: f.profile, descriptors: [descriptor], publishQueued: (run, publication) => {
      assert.ok(publication);
      createTimelineEmitter({ repository: h.database.authority.timelineEvents, clock: f.clock }).emit(runQueuedSpanEvent({ run, ...publication, actorId: ActorIdSchema.parse(publication.actorId) }));
    } });
    h.clock.setWall(f.clock.now());
    const library = createWorkbookLibraryService({ repository: h.database.authority.workbooks, clock: f.clock, sync: unexpectedWorkbookSync });
    let libraryId: string, workbookReferences: { entry: number; libraryId: string; versionId: string; sheetId: string; expectedVersion: number }[];
    if (mode === "split") {
      const headers = [...CRM_DOCUMENT_ROSTER_FIELDS];
      const csvLibrary = async (name: string, dataRows: readonly (readonly string[])[]) => {
        const csv = [headers.join(","), ...dataRows.map(row => [...row, "", "", ""].join(","))].join("\n");
        const imported = await importWorkbook(name, new TextEncoder().encode(csv).buffer);
        const sheet = imported.sheets[0]; assert.ok(sheet);
        assert.equal(sheet.id, "csv");
        assert.deepEqual(sheet.rows.map(row => row.id), ["row-0", ...dataRows.map((_, index) => `row-${String(index + 1)}`)]);
        const saved = library.create({ ...imported, sheets: [{ ...sheet, headerRow: 1,
          columnBindings: headers.map((fieldId, index) => ({ id: `column-${index}`, sourceColumn: index, sourceHeader: fieldId, fieldId, basis: "manual" as const })),
          rows: sheet.rows.map((row, rowIndex) => rowIndex === 0 ? row : { ...row, cells: row.cells.map((cell, index) => index >= 4 ? { value: null } : cell) }) }] });
        assert.equal(library.metadata(saved.libraryId).typeId, "general");
        return saved;
      };
      const first = await csvLibrary("First.csv", [["two@example.test", "Second", "Fixture", ""], ["one@example.test", "Legal", "Fixture", ""]]);
      const second = await csvLibrary("Second.csv", [["one@example.test", "Other", "Fixture", ""]]);
      const reference = (id: string) => ({ entry: 1, libraryId: id, versionId: "original", sheetId: "csv", expectedVersion: library.read(id).version });
      libraryId = first.libraryId;
      workbookReferences = [reference(first.libraryId), reference(second.libraryId)];
    } else {
      const workbook = crmDocumentWorkbookFixture(mode === "ambiguous");
      const selectedSheet = workbook.sheets[0], secondSheet = workbook.sheets[1]; assert.ok(selectedSheet && secondSheet);
      selectedSheet.rows.push(...structuredClone(secondSheet.rows.slice(1)));
      if (mode === "ambiguous") { const row = secondSheet.rows[1]; assert.ok(row); selectedSheet.rows.push({ ...structuredClone(row), id: "duplicate-two" }); }
      if (mode === "missing") { const row = workbook.sheets[0]?.rows[1]; assert.ok(row); row.cells[0] = { value: "missing@example.test" }; }
      const saved = library.create(workbook);
      libraryId = saved.libraryId;
      library.putType({ id: ONBOARDING_ROSTER_TYPE_ID, name: "Onboarding roster", keyFieldId: "email", fields: [...CRM_DOCUMENT_ROSTER_FIELDS], defaultWorkbookId: null });
      library.operatorOperation(libraryId, "type", { kind: "metadata", expectedVersion: saved.version, metadata: { typeId: ONBOARDING_ROSTER_TYPE_ID, sharePoint: null } });
      workbookReferences = [{ entry: 1, libraryId, versionId: "original", sheetId: selectedSheet.id, expectedVersion: library.read(libraryId).version }];
    }
    const planner = createStartPlanService({ authority: h.database, authorityRead: h.database, clock: f.clock, ids: h.plannerIds,
      descriptors: { resolve: id => id === descriptor.id ? descriptor : undefined }, planTtlMs: 600000, workbooks: library, plannedBy: "local-operator",
      configFingerprint: f.snapshot.fingerprint, configSnapshotId: f.snapshot.configSnapshotId });
    const planned = planner.plan({ workflowId: descriptor.id, submissions: [{ people: "10000001;two@example.test" }], dryRun: false,
      workbookReferences,
    });
    const plan = h.database.authority.startPlans.get(planned.startPlanId); assert.ok(plan);
    assert.equal(plan.planned.length, 1); assert.deepEqual(plan.refused, []);
    const entry = plan.planned[0]; assert.ok(entry?.workbookReferences);
    if (mode === "split") assert.equal(entry.workbookReferences.length, 2);
    const start = h.kernel.execute({ ...world.startCommand(plan), requestedAt: f.clock.now().toISOString() });
    const runId = singleAppliedRunId(start);
    const current = library.read(libraryId), edited = structuredClone(current.workbook), firstName = edited.sheets[0]?.rows[1]?.cells[1]; assert.ok(firstName);
    firstName.value = "Editable head"; library.save(libraryId, current.version, edited);
    const ports = testWorkerPorts(f.db, f.clock, { path: f.path, descriptor, poolIndex: 1 });
    const slot = f.db.authority.workerSlots.list(descriptor.id).find(slot => slot.poolIndex === 1); assert.ok(slot);
    const claimed = ports.claimNext({ commandId: randomUUID(), workflow: descriptor.id, workerId: slot.workerId });
    assert.equal(claimed.state, "applied"); if (claimed.state !== "applied") throw new Error("CRM fixture claim failed");
    let downloads = 0, capturedDigests: string[] = [];
    const sessions = sessionFactoryHarness({ crm: () => {
      const driver = createDeterministicCrmOnboardingDriver({ record: CrmReadOnboardingRecord.example, dates: CrmReadOnboardingDates.example,
        documents: CRM_DOCUMENT_RECORDS_FIXTURE.records.map((person, index) => ({ identity: person.identity, totalDocuments: 1,
          documents: [{ index: 0, fileName: "Signed Offer Letter.pdf", bytes: Buffer.from(`%PDF-1.7 worksheet person ${String(index + 1)}`) }] })),
      });
      return { ...driver, async findDocumentRecord(request: Parameters<typeof driver.findDocumentRecord>[0]) {
        const captured = f.db.authority.runs.get(runId); assert.ok(captured); assert.equal(captured.lifecycle.state, "running");
        const reader = createRunWorkbookService({ database: f.db, clock: f.clock }), command = { typeId: ONBOARDING_ROSTER_TYPE_ID, keys: ["one@example.test"] };
        const read = reader.read(captured, command);
        if (mode === "split") {
          assert.equal(read.sources.length, 2);
          assert.equal(read.referenceDigest, read.sources[0]?.referenceDigest);
          assert.notEqual(read.sources[0]?.referenceDigest, read.sources[1]?.referenceDigest);
          capturedDigests = read.sources.map(source => source.referenceDigest);
          assert.deepEqual(read.sources.map(source => decodeWorkbookReference(source.reference).snapshot.rows.flatMap(row => row.matches).map(match => match.values.firstName)), [["Legal"], ["Other"]]);
          assert.deepEqual(read.sources.map(source => decodeWorkbookReference(source.reference).snapshot.worksheets), [[{ sheetId: "csv", name: "Sheet 1" }], [{ sheetId: "csv", name: "Sheet 1" }]]);
        } else assert.equal(read.reference.snapshot.versionId, "original");
        for (const changed of [
          { ...captured, claimGeneration: Number(captured.claimGeneration) + 1 },
          { ...captured, envelope: { ...captured.envelope, traceId: "cd-000001-9999" } },
          { ...captured, input: { ...captured.input, workbookReferences: [] } },
        ]) assert.throws(() => reader.read(RunRecordSchema.parse(changed), command), error => error instanceof WorkbookLibraryError && error.code === "WORKBOOK_INVALID");
        return driver.findDocumentRecord(request);
      }, async readIdocs(request: Parameters<typeof driver.readIdocs>[0]) {
        downloads++;
        if (mode === "download-failed") throw new Error("fixture download failed");
        if (mode === "cancelled") { controller.abort(new Error("fixture cancellation")); throw controller.signal.reason; }
        return driver.readIdocs(request);
      } };
    } });
    const artifacts = createContentAddressedArtifactWriter({ admission: f.profile.admission }); await artifacts.ready;
    const scheduler = new ManualScheduler(f.clock, 0);
    resources = createRunResourcesFactory({ admission: f.profile.admission, database: f.db, authority: f.db.authority, artifacts, clock: f.clock,
      ids: { uuid: randomUUID }, isolation: rebuildRuntimeIsolation, scheduler, environment: {}, sessionFactory: sessions.factory,
      protectedSecrets: { read: () => { throw new Error("CRM fixture must not read credentials"); } },
      assertProfileOwner: () => { throw new Error("synthetic session owns no live browser profile"); },
      assertBrowserRoot: root => assert.equal(root, f.snapshot.config.paths.browserProfileRoot),
      duoCeremony: duoCeremonyGatesOver(f.db, f.clock, scheduler),
      ocr: { capability: "ocr.extract", policy: { kind: "chatgpt-subscription-only", timeoutMs: f.snapshot.config.timeouts.taskMs }, async invoke() { throw new Error("CRM must not call OCR"); } },
      nominatim: { capability: "geocode.nominatim", async invoke() { throw new Error("CRM must not geocode"); }, async stop() {} },
    });
    const selected = resources.forRun(claimed.run);
    manager = new WorkerSessionManager({ workerId: WorkerIdSchema.parse(slot.workerId), workflowId: WorkflowIdSchema.parse(descriptor.id), stores: taskStoreRegistry,
      factory: selected.sessionFactory, clock: f.clock, scheduler, acquireDeadlineMs: selected.sessionAcquireMs, duoCeremony: selected.duoCeremony,
      browserScreenshotCapture: { capture: async context => assert.equal(context.screenshot.state, "available") } });
    manager.bindRunConfigFingerprint(claimed.run.envelope.configFingerprint, selected.defaultBrowserMode, { runId, descriptorFingerprint: descriptor.contractFingerprint });
    const execution = { descriptor, lifecycle: testRunLifecycle(f.db, f.clock), stores: taskStoreRegistry, authority: f.db, sessions: manager,
      emitter: createTimelineEmitter({ repository: f.db.authority.timelineEvents, clock: f.clock }), clock: f.clock, ids: sequentialIdFactory("e"), scheduler, taskDeadlineMs: 60000, log: recordingLogger().log,
      providers: selected.providers, artifacts, artifactProjector: composeWorkerArtifactProjector({ admission: f.profile.admission, database: f.db, artifacts, clock: f.clock }) },
      context = { run: claimed.run, claim: { workerId: slot.workerId, claimGeneration: claimed.run.claimGeneration }, signal: controller.signal };
    let result = await executeClaimedRun(execution, context);
    if (mode === "split") {
      assert.equal(result.state, "parked-gate"); assert.equal(downloads, 0);
      const parked = f.db.authority.runs.get(runId); assert.ok(parked);
      const checkpoint = f.db.authority.runCheckpoints.latest(descriptor.id, entry.itemId, "document-rows"); assert.ok(checkpoint);
      const rows = ReadCrmDocumentRows.output.parse(checkpoint.output.value);
      assert.deepEqual(rows.sourceDigests, capturedDigests);
      assert.notEqual(rows.referenceDigest, capturedDigests[0]);
      const [shared, covered] = rows.people; assert.ok(shared && covered);
      assert.equal(shared.resolution.state, "resolve-required"); assert.equal(covered.resolution.state, "resolved");
      if (shared.resolution.state !== "resolve-required" || covered.resolution.state !== "resolved") throw new Error("split resolution changed");
      assert.deepEqual(shared.resolution.candidates.map(candidate => [candidate.referenceDigest, candidate.row.worksheetId, candidate.row.rowId, candidate.row.referenceDigest, candidate.row.names.legalName.firstName]), [
        [capturedDigests[0], "csv", "row-2", capturedDigests[0], "Legal"], [capturedDigests[1], "csv", "row-1", capturedDigests[1], "Other"],
      ]);
      assert.equal(covered.resolution.selected.referenceDigest, capturedDigests[0]);
      assert.equal(covered.resolution.selected.row.referenceDigest, capturedDigests[0]);
      assert.equal(covered.resolution.selected.row.worksheetId, "csv");
      assert.equal(covered.resolution.selected.row.rowId, "row-1");
      assert.equal(covered.resolution.selected.row.names.legalName.firstName, "Second");
      const choices = buildRunWorkbookSection(f.db.authority, parked).referenceChoices; assert.equal(choices?.length, 1); assert.ok(choices);
      const choice = choices[0]; assert.ok(choice?.resolution.state === "available");
      const other = choice.resolution.candidates.find(candidate => candidate.values.some(cell => cell.fieldId === "firstName" && cell.value === "Other"));
      assert.ok(other?.referenceDigest !== undefined && other.workbookVersion !== undefined);
      assert.notEqual(other.referenceDigest, choice.referenceDigest);
      const omitted = CommandRequestSchema.parse({ commandId: world.nextCommandId(), family: "run", type: "resolve-workbook-reference-row",
        source: "run-detail", requestedBy: "local-operator", requestedAt: f.clock.now().toISOString(), target: choice.resolution.target,
        payload: { sheetId: other.sheetId, rowId: other.rowId } });
      assert.equal(h.kernel.execute(omitted).state, "rejected");
      assert.equal(h.kernel.execute({ ...omitted, commandId: world.nextCommandId(), payload: { sheetId: other.sheetId, rowId: other.rowId,
        referenceDigest: other.referenceDigest, workbookVersion: other.workbookVersion } }).state, "applied");
      const queued = f.db.authority.runs.get(runId); assert.ok(queued?.lifecycle.state === "queued");
      const resolved = buildRunWorkbookSection(f.db.authority, queued).referenceChoices?.[0]; assert.ok(resolved?.resolution.state === "resolved");
      const event = f.db.authority.timelineEvents.get(resolved.native.eventId); assert.ok(event?.payload.kind === "workbook-reference-row-selected");
      assert.equal(event.payload.referenceDigest, other.referenceDigest);
      assert.equal(resolved.referenceDigest, capturedDigests[0]);
      assert.equal(resolved.resolution.selected.referenceDigest, other.referenceDigest);
      assert.equal(other.sheetId, "csv"); assert.equal(other.rowId, "row-1");
      manager.releaseRunConfigFingerprint();
      const resumed = ports.claimNext({ commandId: randomUUID(), workflow: descriptor.id, workerId: slot.workerId });
      assert.equal(resumed.state, "applied"); if (resumed.state !== "applied") throw new Error("resolved batch was not claimable");
      const resumedResources = resources.forRun(resumed.run);
      manager.bindRunConfigFingerprint(resumed.run.envelope.configFingerprint, resumedResources.defaultBrowserMode, { runId, descriptorFingerprint: descriptor.contractFingerprint });
      result = await executeClaimedRun({ ...execution, providers: resumedResources.providers }, { ...context, run: resumed.run,
        claim: { workerId: slot.workerId, claimGeneration: resumed.run.claimGeneration } });
      const failures = f.db.authority.failures.listByRun(runId);
      assert.equal(result.state, "done", JSON.stringify(failures.map(failure => failure.summary)));
      const terminal = f.db.authority.runResults.get(runId); assert.ok(terminal);
      const output = ReadCrmWorksheetArchives.output.parse(terminal.result.value);
      assert.deepEqual([output.worksheetCount, output.personCount, output.documentCount], [2, 2, 2]);
      assert.deepEqual(output.worksheets.map(sheet => [sheet.referenceDigest, sheet.worksheetId, sheet.worksheetName, sheet.people.map(person => person.rowId)]), [
        [capturedDigests[1], "csv", "Sheet 1", ["row-1"]],
        [capturedDigests[0], "csv", "Sheet 1", ["row-1"]],
      ]);
      assert.deepEqual(output.collection.files.map(file => file.relativePath), output.worksheets.map(sheet => sheet.relativePath));
      assert.deepEqual(output.worksheets.map(sheet => sheet.relativePath), [
        `${capturedDigests[1]}/Sheet 1/Sheet 1.zip`, `${capturedDigests[0]}/Sheet 1/Sheet 1.zip`,
      ]);
      for (const [index, sheet] of output.worksheets.entries()) {
        const archiveBytes = readFileSync(join(f.snapshot.config.paths.onboardingDocsDir, sheet.relativePath));
        assert.equal(archiveBytes.byteLength, sheet.artifact.bytes);
        const zip = await JSZip.loadAsync(archiveBytes);
        const folder = index === 0 ? "Fixture, Other EID" : "Fixture, Second EID";
        const pdf = `${folder}/Signed Offer Letter.pdf`;
        assert.deepEqual(Object.keys(zip.files), [pdf]);
        const document = zip.file(pdf); assert.ok(document);
        assert.deepEqual(await document.async("nodebuffer"), Buffer.from(`%PDF-1.7 worksheet person ${index === 0 ? "1" : "2"}`));
      }
      assert.equal(f.db.authority.generatedArtifacts.get(`sink:documents-file-${runId}`)?.state, "ready");
      assert.equal(downloads, 2);
      assert.deepEqual(f.db.authority.writeIntents.countDryRunEvidenceByRun(runId), { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 });
      return;
    }
    if (mode === "ambiguous") {
      assert.equal(result.state, "parked-gate"); assert.equal(downloads, 0);
      const parked = f.db.authority.runs.get(runId); assert.ok(parked);
      const choices = buildRunWorkbookSection(f.db.authority, parked).referenceChoices; assert.equal(choices?.length, 2); assert.ok(choices);
      for (const choice of choices) {
        const table = choice.resolution.state === "available" ? choice.resolution.decision?.options[0]?.input : undefined;
        assert.ok(table?.kind === "candidate" && table.table.typed?.label === "Enter row number" && table.table.rows.every(row => row.rowNumber !== undefined), "each ambiguous pick serves a typed row number");
      }
      const checkpoint = f.db.authority.runCheckpoints.latest(descriptor.id, entry.itemId, "document-rows"); assert.ok(checkpoint);
      const rows = ReadCrmDocumentRows.output.parse(checkpoint.output.value);
      const attempted = CrmDocumentRowChoiceSchema.parse({ ...rows, decision: "selected", state: "resolved", people: rows.people.map(person => {
        assert.equal(person.resolution.state, "resolve-required"); if (person.resolution.state !== "resolve-required") throw new Error("fixture must be ambiguous");
        const candidate = person.resolution.candidates[0]; assert.ok(candidate); return { ...person, resolution: { state: "resolved", selected: candidate } };
      }) });
      assert.equal(h.kernel.execute({ commandId: world.nextCommandId(), family: "gate", type: "resolve-gate", source: "dashboard", requestedBy: "local-operator",
        requestedAt: f.clock.now().toISOString(), target: { runId, expectedVersion: parked.version, gateId: "document-row-choice" },
        payload: { result: { schemaHash: deriveSchemaHash(CrmDocumentRowChoiceSchema, "output"), value: attempted } } }).state, "rejected");
      for (const [index, choice] of choices.entries()) {
        assert.equal(choice.resolution.state, "available"); if (choice.resolution.state !== "available") throw new Error("row choice unavailable");
        const candidate = choice.resolution.candidates[0]; assert.ok(candidate);
        const command = CommandRequestSchema.parse({ commandId: world.nextCommandId(), family: "run", type: "resolve-workbook-reference-row",
          source: "run-detail", requestedBy: "local-operator", requestedAt: f.clock.now().toISOString(), target: choice.resolution.target,
          payload: { sheetId: candidate.sheetId, rowId: candidate.rowId } });
        assert.equal(h.kernel.execute({ ...command, commandId: world.nextCommandId(), payload: { sheetId: "foreign", rowId: candidate.rowId } }).state, "rejected");
        assert.equal(h.kernel.execute({ ...command, commandId: world.nextCommandId(), target: { ...choice.resolution.target, expectedVersion: parked.version - 1 } }).state, "rejected");
        assert.equal(h.kernel.execute({ ...command, commandId: world.nextCommandId(), target: { ...choice.resolution.target, referenceDigest: "b".repeat(64) } }).state, "rejected");
        assert.equal(h.kernel.execute(command).state, "applied");
        const current = f.db.authority.runs.get(runId); assert.ok(current);
        if (index === 0) {
          assert.equal(current.lifecycle.state, "parked-gate"); assert.equal(current.version, parked.version);
          assert.equal(f.db.authority.gateResults.get(`${runId}:document-row-choice`), undefined);
          assert.deepEqual(buildRunWorkbookSection(f.db.authority, current).referenceChoices?.map(choice => choice.resolution.state), ["resolved", "available"]);
          const before = f.db.authority.timelineEvents.highWaterMark(); h.kernel.execute(command);
          assert.equal(f.db.authority.timelineEvents.highWaterMark(), before);
        } else {
          assert.equal(current.lifecycle.state, "queued"); assert.ok(authenticateWorkbookReferenceExecution(f.db.authority, current));
          assert.deepEqual(buildRunWorkbookSection(f.db.authority, current).referenceChoices?.map(choice => choice.resolution.state), ["resolved", "resolved"]);
          const gate = f.db.authority.gateResults.get(`${runId}:document-row-choice`); assert.ok(gate);
          const value = CrmDocumentRowChoiceSchema.parse(gate.result.value), altered = structuredClone(value);
          const first = altered.people[0]?.resolution; assert.ok(first?.state === "resolved"); first.selected.row.names.legalName.firstName = "Invented";
          const changed = { ...gate, result: { ...gate.result, value: altered } };
          assert.throws(() => authenticateWorkbookReferenceChoice(f.db.authority, current,
            { ...changed, checkpointFingerprint: FingerprintSchema.parse(deriveGateResultCheckpointFingerprint(changed.result)) }));
          const repositories = f.db.authority;
          assert.throws(() => authenticateWorkbookReferenceExecution({ ...repositories,
            commandAudits: { ...repositories.commandAudits, findByCommand: () => undefined } }, current));
        }
      }
      manager.releaseRunConfigFingerprint();
      const resumed = ports.claimNext({ commandId: randomUUID(), workflow: descriptor.id, workerId: slot.workerId });
      assert.equal(resumed.state, "applied"); if (resumed.state !== "applied") throw new Error("resolved batch was not claimable");
      const resumedResources = resources.forRun(resumed.run);
      manager.bindRunConfigFingerprint(resumed.run.envelope.configFingerprint, resumedResources.defaultBrowserMode, { runId, descriptorFingerprint: descriptor.contractFingerprint });
      result = await executeClaimedRun({ ...execution, providers: resumedResources.providers }, { ...context, run: resumed.run,
        claim: { workerId: slot.workerId, claimGeneration: resumed.run.claimGeneration } });
    }
    const failures = f.db.authority.failures.listByRun(runId);
    if (mode === "complete" || mode === "ambiguous") {
      assert.equal(result.state, "done", JSON.stringify(failures.map(failure => failure.summary)));
      const terminal = f.db.authority.runResults.get(runId); assert.ok(terminal);
      if (descriptor.id === "crm-doc-download-reference") {
        assert.equal(CrmDocumentRowsSchema.parse(terminal.result.value).state, "resolved");
        assert.equal(downloads, 0); assert.equal(f.db.authority.generatedArtifacts.get(`sink:documents-file-${runId}`), undefined);
        assert.deepEqual(f.db.authority.writeIntents.countDryRunEvidenceByRun(runId), { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 });
        return;
      }
      const output = ReadCrmWorksheetArchives.output.parse(terminal.result.value);
      assert.deepEqual([output.worksheetCount, output.personCount, output.documentCount], [1, 2, 2]);
      assert.deepEqual(output.collection.files.map(file => file.relativePath), ["July 6/July 6.zip"]);
      assert.equal(output.worksheets.length, 1);
      const sheet = output.worksheets[0]; assert.ok(sheet);
      assert.equal(sheet.relativePath, "July 6/July 6.zip");
      assert.equal(sheet.worksheetId, "july"); assert.equal(sheet.worksheetName, "July 6");
      assert.deepEqual(sheet.people.map(person => ({ identity: person.identity, folderName: person.folderName, documentCount: person.documentCount })),
        CRM_DOCUMENT_RECORDS_FIXTURE.records.map((person, index) => ({ identity: person.identity,
          folderName: `Fixture, ${index === 0 ? "Legal" : "Second"} EID`, documentCount: 1 })));
      const archiveBytes = readFileSync(join(f.snapshot.config.paths.onboardingDocsDir, sheet.relativePath));
      assert.equal(archiveBytes.byteLength, sheet.artifact.bytes);
      const zip = await JSZip.loadAsync(archiveBytes);
      const names = ["Fixture, Legal EID/Signed Offer Letter.pdf", "Fixture, Second EID/Signed Offer Letter.pdf"];
      assert.deepEqual(Object.keys(zip.files), names);
      for (const [index, name] of names.entries()) {
        const document = zip.file(name); assert.ok(document);
        const bytes = await document.async("nodebuffer");
        assert.deepEqual(bytes, Buffer.from(`%PDF-1.7 worksheet person ${String(index + 1)}`));
      }
      assert.equal(existsSync(join(f.snapshot.config.paths.onboardingDocsDir, "August 2", "August 2.zip")), false);
      for (const nodeId of ["document-records", "workbook-reference", "document-rows", "document-pdfs", "worksheet-archives"]) {
        const checkpoint = f.db.authority.runCheckpoints.latest(descriptor.id, entry.itemId, nodeId); assert.ok(checkpoint);
        assert.equal(checkpoint.runId, runId); assert.ok(checkpoint.provenance.length > 0);
      }
      assert.equal(f.db.authority.generatedArtifacts.get(`sink:documents-file-${runId}`)?.state, "ready");
      assert.equal(f.db.authority.artifactOutbox.listPending().length, 0); assert.equal(downloads, 2);
      inspect?.({ f, runId, itemId: entry.itemId });
    } else {
      assert.notEqual(result.state, "done");
      const retained = f.db.authority.runResults.get(runId);
      if (retained !== undefined) assert.equal(ReadCrmWorksheetArchives.output.safeParse(retained.result.value).success, false);
      assert.equal(f.db.authority.generatedArtifacts.get(`sink:documents-file-${runId}`), undefined);
      assert.equal(existsSync(join(f.snapshot.config.paths.onboardingDocsDir, "July 6", "July 6.zip")), false);
      if (mode === "missing") { assert.equal(result.state, "parked-gate"); assert.equal(downloads, 0); }
      if (mode === "download-failed") assert.equal(failures[0]?.code, "CRM_DOCUMENT_DOWNLOAD_FAILED");
      if (mode === "cancelled") { assert.equal(downloads, 1); assert.equal(result.state, "abandoned"); if (result.state === "abandoned") assert.equal(result.reason, "fixture cancellation"); }
    }
    assert.deepEqual(f.db.authority.writeIntents.countDryRunEvidenceByRun(runId), { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 });
  } finally { await manager?.closeAll("worker-stop"); await resources?.stop(); for (const database of world.openDatabases.splice(0)) database.close(); await f.dispose(); }
}

it("crm-doc-download/worksheet-archives — executes registered CRM sessions, run-bound references and both PDFs in the selected worksheet ZIP", () => runCrm("complete"));
it("retains multiple operator row choices and resumes the same batch to publish both exact PDFs in one worksheet archive", () => runCrm("ambiguous"));
it("reads two General CSVs that share csv/row-1, records the chosen source, and publishes both archives", () => runCrm("split"));
it.each(["missing", "download-failed", "cancelled"] as const)("publishes no collection for %s", mode => runCrm(mode));

it("authenticates batch choices in the retained reference step proof", () => {
  const proof = STEP_PROOF_MODULES.find(module => module.descriptor.id === "crm-doc-download-reference"); assert.ok(proof);
  return runCrm("ambiguous", proof.descriptor);
});

it("cites the document-rows verification, not an input fact, for the not-taken row-choice gate", () => runCrm("complete", crmDocDownloadModule.descriptor, ({ f, runId, itemId }) => {
  const descriptor = crmDocDownloadModule.descriptor;
  const run = f.db.authority.runs.get(runId); assert.ok(run?.lifecycle.state === "terminal");
  const result = f.db.authority.runResults.get(runId); assert.ok(result);
  const receipt = buildRunEvidenceReceipt({ descriptor, run, result, checkpoints: f.db.authority.runCheckpoints.listByItem(descriptor.id, itemId),
    writes: [], gateResults: f.db.authority.gateResults.listByRun(runId) });
  const decision = receipt.decisions.find(value => value.id === deriveEvidenceEntryId(receipt.receiptId, "decision", "not-run.document-row-choice"));
  assert.ok(decision?.kind === "branch" && decision.outcome === "not-taken");
  const verification = deriveEvidenceEntryId(receipt.receiptId, "verification", "node.document-rows");
  assert.deepEqual(decision.evidence, [`observation:${verification}`]);
  assert.ok(receipt.verification.some(entry => entry.id === verification));
  assert.ok(!decision.evidence.some(reference => receipt.input.some(fact => reference === `observation:${fact.id}`)));
}));
