import { createRunWorkbookService } from "../../../../src/backend/runs/workbooks.js";
import { createWorkbookLibraryAdapter } from "../../../../src/backend/processing/providers/workbook-library-adapter.js";
import { REFERENCE_CHECK_ID } from "../../../../src/models/processing/workbooks/reference-fields.js";
import { ocrModule } from "../registered-workflows.js";
import type { SpanEmitter } from "../../../../src/backend/logs/span-emitter.js";
import type { createRetainedApprovedRecordReader } from "../../fixtures/ocr/retained-approved-records.js";
import { descriptorRuntimeNodes } from "../../../../src/workflow-kit/workflow.js";
import { runClaim } from "../../../../src/models/run/record.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { createApprovedOcrRecordReader } from "../../../../src/backend/runs/lifecycle/approved-ocr-records.js";
import { EmergencyContactInputSchema } from "../../../../src/models/workflows/emergency-contact/input.js";
import { createOcrApprovedSnapshotAdapter } from "../../../../src/backend/processing/providers/ocr-approved-snapshot-adapter.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { CHILD_ONLY_WORKFLOW_MODULES, SERVER_REGISTRY, workflowModuleOf, childWorkflowModuleOf } from "../../../../src/backend/app/registries/workflow-registry.js";
import { createOcrCheckpointPublication } from "../../../../src/backend/runs/lifecycle/ocr-checkpoint-publication.js";
import { createOcrSourceService } from "../../../../src/backend/runs/commands/ocr-source-service.js";
import { createContentAddressedArtifactWriter } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { createServerVerifiedArtifactReader } from "../../../../src/backend/storage/artifacts/server-verified-artifact-reader.js";
import { OcrInputSchema } from "../../../../src/models/workflows/ocr/input.js";
import { OcrApprovalReferenceSchema } from "../../../../src/models/workflows/ocr/result.js";
import { ReadOcrResult } from "../../../../src/models/workflows/ocr/read-result.js";
import { OcrApprovedSnapshotSchema, ocrReviewDigest, ocrSnapshotDigest } from "../../../../src/models/ocr/review.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { bindCanonicalManualOcrReading, bindManualOcrPageReading } from "../../../../src/models/workflows/ocr/page-accounting.js";
import { buildOcrSourceManifest, ocrPageInputs } from "../../../../src/models/workflows/ocr/source-manifest.js";
import { ExtractPdfPages, type ExtractPdfPagesOutputSchema } from "../../../../src/models/processing/extraction/extract-pdf-pages.js";
import { defineTask } from "../../../../src/workflow-kit/task.js";
import { defineServiceStore, defineTaskStoreRegistry, defineWorkflowStore, type RegisteredTaskStore } from "../../../../src/workflow-kit/task-registry.js";
import { submittedPage, READING_ID, READ_AT } from "../../fixtures/ocr/source-pages.js";
import { canonicalChildExecution } from "./canonical-child-execution.js";
import type { BoundProfileStorageFixture } from "../admission-fixture.js";
import { createRunExecutorTestWorld } from "./run-executor-world.js";
import { boundProfileAdmission } from "../synthetic-database-admission.js";
import type { z } from "zod";
import { createWorkbookLibraryService } from "../../../../src/backend/workbooks/workbook-library-service.js";
import { unexpectedWorkbookSync } from "./workbook-sync.js";
import { retainedOcrModule, retainedOcrStore, retainedOcrCheckpointPublication } from "../../fixtures/ocr/retained-review-producer.js";
import { ocrWorkflowStore } from "../../../../src/workflows/ocr/task-registry.js";
import { ocrForm, type OcrFormType } from "../../../../src/models/ocr/form-registry.js";
import { createWriteSequencer } from "../../../../src/backend/runtime/writes/write-sequencer.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { testRunLifecycle } from "../../fixtures/run-lifecycle-fixtures.js";
import type { SessionFactoryHarness } from "../phase1f-executor-harness.js";
import type { WorkflowModule } from "../../../../src/workflow-kit/workflow-definition.js";
import { ocrPageStore } from "../../../../src/workflows/ocr-page/task-registry.js";
import { ReadManualOcrReading } from "../../../../src/models/workflows/ocr-page/read-manual-reading.js";
import { readManualOcrReadingTask } from "../../../../src/workflows/ocr-page/tasks/read-manual-reading.js";
import { OcrPageWorkflowInputSchema } from "../../../../src/models/workflows/ocr-page/input.js";
import { createDeterministicI9Driver } from "../../../../src/backend/systems/i9/driver/fake.js";
import { I9LookupError, type I9LookupInput } from "../../../../src/models/systems/i9/read-section2-signer.js";
import { sessionFactoryHarness } from "../phase1f-executor-harness.js";
import { i9PageSubmission } from "../../fixtures/i9-check-start.js";
import type { ChatGptOcrAdapter } from "../../../../src/backend/processing/providers/provider-client.js";
import { OCR_EXTRACTION_RESPONSE_HASH, OcrExtractionRequestSchema } from "../../../../src/models/processing/ocr/extract-form-page.js";
import { ProviderAdapterOutcomeSchema } from "../../../../src/models/providers/providers.js";

interface ReviewedPageFacts {
  readonly employeeName: string;
  readonly contactName: string;
  readonly correctedContactName: string;
}

export function createOcrReviewWorld(profileFixture?: () => Promise<BoundProfileStorageFixture>) {
  const world = profileFixture === undefined ? createRunExecutorTestWorld() : createRunExecutorTestWorld(profileFixture);
  return {
    cleanup: world.cleanup,
    async fixture(options: Readonly<{ actorId?: string; onbaseFiling?: "file" | "skip"; record?: boolean; release?: boolean; pageCount?: number;
      retainedProducer?: boolean; coordinator?: boolean; fileName?: string; dryRun?: boolean; extractWithOcr?: boolean;
      parent?: WorkflowModule; ocr?: Pick<WorkflowModule, "descriptor"> & Partial<Pick<WorkflowModule, "stores">>; ocrPage?: WorkflowModule;
      lookupNames?: readonly string[]; employeeIds?: readonly (string | null)[]; recordPages?: readonly number[]; pauseAtLookup?: boolean; holdPages?: boolean; formType?: OcrFormType; sessions?: SessionFactoryHarness;
      failManualPageOnce?: number; stopAfterPageFailure?: boolean; ocrProviderAvailable?: () => boolean;
      signerLookup?: Readonly<{ firstNames: readonly string[]; failOnce?: string }>;
      reviewedPages?: readonly ReviewedPageFacts[]; operatorEvidence?: boolean;
      screenshotCapture?: NonNullable<Parameters<typeof world.executorHarness>[0]>["screenshotCapture"];
      member?: WorkflowModule;
      approvedReader?: typeof createRetainedApprovedRecordReader;
      approvedStore?: RegisteredTaskStore;
      manualPageFailure?: (sourcePage: number) => boolean;
      onSpan?: (event: Parameters<SpanEmitter["emit"]>[0]) => void;
      onTransactionSettled?: (run: RunRecord) => void;
      adoptExisting?: boolean; ids?: { readonly uuid: () => string }; documentBytes?: Uint8Array;
      onHarness?: (harness: Awaited<ReturnType<typeof world.executorHarness>>) => void;
      /** Extra library spreadsheets the Emergency Contact parent picks as the second check; `rows` follow the header row, so the first data row is sheet row 2. */
      checks?: readonly Readonly<{ name: string; sheet: string; fields: readonly string[]; rows: readonly (readonly string[])[] }>[] }> = {}) {
      const actorId = options.actorId ?? "local-operator";
      if (options.reviewedPages !== undefined) assert.equal(options.reviewedPages.length, options.pageCount);
      const rendered: { value?: z.output<typeof ExtractPdfPagesOutputSchema> } = {};
      const render = defineTask(ExtractPdfPages, { sessions: [], async run({ ctx }) {
        assert.ok(rendered.value);
        ctx.recordData([
          { direction: "read", field: "pageCount", value: rendered.value.pageCount },
          { direction: "read", field: "pages", value: rendered.value.pages },
        ]);
        return rendered.value;
      } });
      const ocrRoot = options.ocr ?? (options.retainedProducer === true ? retainedOcrModule : ocrModule);
      const coordinator = options.coordinator === true ? workflowModuleOf("emergency-contact") : undefined;
      const member = options.member ?? (options.coordinator === true ? childWorkflowModuleOf("emergency-contact", "emergency-contact-member") : undefined);
      const root = options.parent ?? coordinator ?? ocrRoot;
      let failedPage = false;
      let failedSigner = false;
      const signerReads: string[] = [];
      const pageReads: number[] = [];
      let ocrCalls = 0;
      const provider: ChatGptOcrAdapter = { capability: "ocr.extract", policy: { kind: "chatgpt-subscription-only", timeoutMs: 120_000 }, async invoke(request) {
        ocrCalls++;
        assert.equal(options.ocrProviderAvailable?.(), true, "Unexpected OCR provider call while unavailable");
        const { formType, page, sourcePage } = OcrExtractionRequestSchema.parse(request.payload.value);
        const value = { formType, sourcePage, sourceSha256: page.sha256, pageKind: "blank", record: null,
          source: { kind: "provider", providerId: "chatgpt-subscription", modelId: "synthetic-test-model" }, readAt: clock.now().toISOString() };
        return ProviderAdapterOutcomeSchema.parse({ response: { state: "produced", value: { schemaHash: OCR_EXTRACTION_RESPONSE_HASH, value } },
          evidence: { summary: "Synthetic blank page", capturedAt: value.readAt } });
      } };
      const sessions = options.signerLookup === undefined ? options.sessions : sessionFactoryHarness({ i9: () => ({
        ...createDeterministicI9Driver({ lookup: { i9Status: "not-found", signerName: "" }, now: READ_AT }),
        async readSection2Signer(input: I9LookupInput) {
          signerReads.push(input.firstName);
          if (!failedSigner && input.firstName === options.signerLookup?.failOnce) {
            failedSigner = true;
            throw new I9LookupError();
          }
          return { i9Status: "not-found" as const, signerName: "" as const };
        },
      }) });
      const manualReading = defineTask(readManualOcrReadingTask.contract, {
        sessions: [], async run(args) {
          pageReads.push(args.input.page.sourcePage);
          if (options.manualPageFailure?.(args.input.page.sourcePage) === true) return args.ctx.fail("INCONSISTENT_INPUTS", "Synthetic manual page reading refused.");
          if (!failedPage && args.input.page.sourcePage === options.failManualPageOnce) {
            failedPage = true;
            return args.ctx.fail("INCONSISTENT_INPUTS", "Synthetic first page-read failure.");
          }
          return readManualOcrReadingTask.impl.run(args);
        },
      });
      const pages = defineWorkflowStore("ocr-page", { ...ocrPageStore.tasks, readManualReading: manualReading });
      const ocrTasks = options.ocr?.stores?.find(store => store.namespace === ocrWorkflowStore.namespace)
        ?? (options.retainedProducer === true ? retainedOcrStore : ocrWorkflowStore);
      const entries: readonly RegisteredTaskStore[] = [...taskStoreRegistry.stores.filter(store => !["extraction", "workflow:ocr", "workflow:ocr-page"].includes(store.namespace)
        && store.namespace !== options.approvedStore?.namespace), ...(options.approvedStore === undefined ? [] : [options.approvedStore]), pages,
        defineServiceStore("extraction", { render }), ocrTasks];
      const tasks = entries.flatMap(store => Object.values(store.tasks));
      const stores = defineTaskStoreRegistry(entries, { scenarioIds: [...new Set(tasks.flatMap(task => task.contract.scenarios))],
        tasks: tasks.map(task => ({ id: task.contract.id, effect: task.contract.effect })) });
      const harness = await world.executorHarness({ descriptor: root.descriptor, stores,
        ...(sessions === undefined ? {} : { sessions }),
        ...(options.screenshotCapture === undefined ? {} : { screenshotCapture: options.screenshotCapture }),
        ...(options.adoptExisting === true ? { existingProfile: true } : {}),
        ...(options.ids === undefined ? {} : { ids: options.ids }),
      });
      options.onHarness?.(harness);
      const { database, path, clock } = harness.authority;
      const workbooks = createWorkbookLibraryService({ repository: database.authority.workbooks, clock, sync: unexpectedWorkbookSync });
      const runWorkbooks = createRunWorkbookService({ database, clock });
      const roster = options.adoptExisting === true ? undefined : workbooks.create({ name: "OCR roster", themes: [], hasFormulas: false, sheets: [{
        id: "people", name: "People", width: 2, hidden: [], headerRow: 1,
        columnBindings: ["eid", "fullName"].map((fieldId, index) => ({ id: fieldId, sourceColumn: index, sourceHeader: fieldId, fieldId, basis: "manual" })),
        rows: [{ id: "header", cells: [{ value: "EID" }, { value: "Name" }] }],
      }] });
      if (roster !== undefined) {
        database.authority.workbooks.putType({ id: "ocr-roster", name: "OCR roster", keyFieldId: "eid", fields: ["eid", "fullName"], defaultWorkbookId: null });
        workbooks.operatorOperation(roster.libraryId, "set-roster-type", { kind: "metadata", expectedVersion: 1, metadata: { typeId: "ocr-roster", sharePoint: null } });
      }
      const admission = boundProfileAdmission(path);
      const artifacts = createContentAddressedArtifactWriter({ admission }); await artifacts.ready;
      const artifactReader = createServerVerifiedArtifactReader({ admission }); await artifactReader.ready;
      const resolve = (id: string) => id === root.descriptor.id ? root.descriptor : id === "ocr" ? ocrRoot.descriptor
        : id === options.ocrPage?.descriptor.id ? options.ocrPage.descriptor
        : id === coordinator?.descriptor.id ? coordinator.descriptor : id === member?.descriptor.id ? member.descriptor
        : (CHILD_ONLY_WORKFLOW_MODULES.find(module => module.descriptor.id === id) ?? SERVER_REGISTRY[id])?.descriptor;
      const sequencer = options.dryRun === true || options.member !== undefined ? createWriteSequencer({ lifecycle: testRunLifecycle(database, clock), stores, authority: database,
        sessions: harness.manager, emitter: harness.deps.emitter, clock, ids: { uuid: randomUUID }, scheduler: harness.scheduler,
        taskDeadlineMs: 60_000, operator: "local-operator", log: harness.deps.log }) : undefined;
      const writeSequencer = sequencer === undefined ? undefined : { ...sequencer, async executeTransaction(...args: Parameters<typeof sequencer.executeTransaction>) {
        const settled = await sequencer.executeTransaction(...args);
        options.onTransactionSettled?.(args[0].run);
        return settled;
      } };
      const notes = options.operatorEvidence === true ? createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock }) : undefined;
      const canonical = canonicalChildExecution({ ...harness.deps, emitter: { emit: event => { harness.deps.emitter.emit(event); options.onSpan?.(event); } }, artifacts, ...(writeSequencer === undefined ? {} : { writeSequencer }) }, database, path, resolve,
        options.retainedProducer === true ? retainedOcrCheckpointPublication : createOcrCheckpointPublication,
        { workbooks, ...(options.ocrProviderAvailable === undefined ? {} : { ocrProviderAvailable: options.ocrProviderAvailable }),
          resources: (reader, run) => { const claim = runClaim(run); assert.ok(claim); const descriptor = resolve(run.envelope.workflow); assert.ok(descriptor);
          const needsPlanEvidence = notes !== undefined && descriptorRuntimeNodes(descriptor).some(node => node.kind === "transaction");
          return { ...(!needsPlanEvidence ? {} : { taskNotes: notes }), providers: { configSnapshots: database.authority.configSnapshots,
          idFactory: { next: () => randomUUID() }, adapters: { "ocr.extract": provider, ...(options.checks === undefined ? {} : { "workbooks.library": createWorkbookLibraryAdapter({ repository: database.authority.workbooks, runId: run.envelope.runId, clock,
            references: { runId: run.envelope.runId, write: () => { throw new Error("the reference check must not write a reference"); }, readFields: command => runWorkbooks.readReferenceFields(run, command) } }) }),
            "ocr.approved-snapshot": createOcrApprovedSnapshotAdapter({clock,
            reader: options.approvedReader === undefined
              ? createApprovedOcrRecordReader({database,run,reader,resolveDescriptor:resolve,assertCurrent:()=>admission.assertProfileRuntime()})
              : options.approvedReader({database,run,reader,resolveDescriptor:resolve,assertCurrent:()=>admission.assertProfileRuntime()}),
          }) } } }; } });
      const sources = createOcrSourceService({ database, reader: canonical.lifecycle, clock, artifacts, artifactReader,
        assertCurrent: () => admission.assertProfileRuntime() });
      if (options.adoptExisting === true) {
        const parentRun = database.authority.runs.listByWorkflow(root.descriptor.id)[0];
        assert.ok(parentRun);
        const run = root === ocrRoot ? parentRun : database.authority.runs.listChildren(parentRun.envelope.runId).find(child => child.envelope.workflow === "ocr");
        assert.ok(run);
        const pageRuns: typeof parentRun[] = [];
        const walkPages = (runId: string) => {
          for (const child of database.authority.runs.listChildren(runId)) {
            if (child.envelope.workflow === "ocr-page") pageRuns.push(child);
            walkPages(child.envelope.runId);
          }
        };
        walkPages(run.envelope.runId);
        const readings = pageRuns.flatMap(pageRun => {
          const parsed = OcrPageWorkflowInputSchema.parse(pageRun.input.parsed.value);
          if (parsed.reading.kind !== "manual") return [];
          const reading = bindCanonicalManualOcrReading(parsed.page, parsed.reading.actorId, parsed.reading.extraction);
          const corrected = reading.extraction.record; assert.ok(corrected);
          return [{ reading, corrected }];
        }).sort((left, right) => left.reading.input.sourcePage - right.reading.input.sourcePage);
        const first = readings[0]; assert.ok(first);
        const { reading, corrected } = first;
        rendered.value = { pageCount: readings.length, pages: readings.map(({ reading }) => ({ sourcePage: reading.input.sourcePage, image: reading.input.image })) };
        const pageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGvwAAAAASUVORK5CYII=", "base64");
        const command = (type: "correct-ocr-record" | "discard-ocr-record" | "restore-ocr-record", expectedRevision: number, recordIndex = 0) => {
          const review = database.authority.ocrReviews.latest(run.envelope.runId); assert.ok(review);
          const record = review.records[recordIndex], correctedRecord = readings[recordIndex]?.corrected; assert.ok(record && correctedRecord);
          return { commandId: randomUUID(), requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard",
            family: "ocr-review" as const, type, target: { runId: run.envelope.runId, expectedRevision },
            payload: type === "correct-ocr-record" ? { recordId: record.recordId, fields: correctedRecord, assertedEid: "10800000" } : { recordId: record.recordId } };
        };
        const approval = (selectedRecordIds?: readonly string[]) => {
          const review = database.authority.ocrReviews.latest(run.envelope.runId); assert.ok(review);
          const current = database.authority.runs.get(run.envelope.runId); assert.ok(current);
          const commandId = randomUUID();
          const snapshot = OcrApprovedSnapshotSchema.parse({ snapshotId: commandId, sourceRunId: current.envelope.runId,
            revision: review.revision, reviewDigest: ocrReviewDigest(review), selectedRecordIds: selectedRecordIds ?? review.records.map(record => record.recordId),
            records: selectedRecordIds === undefined ? review.records : selectedRecordIds.map(id => review.records.find(record => record.recordId === id)),
            approvedBy: "local-operator", approvedAt: clock.now().toISOString() });
          return { commandId, requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard",
            family: "gate" as const, type: "resolve-gate" as const, target: { runId: current.envelope.runId, gateId: "approve-records", expectedVersion: current.version },
            payload: { result: { schemaHash: deriveSchemaHash(OcrApprovalReferenceSchema, "output"), value: {
              snapshotId: commandId, sourceRunId: current.envelope.runId, revision: review.revision, digest: ocrSnapshotDigest(snapshot),
            } }, ocrApproval: { expectedRevision: review.revision, reviewDigest: ocrReviewDigest(review), selectedRecordIds: snapshot.selectedRecordIds } } };
        };
        const result: Awaited<ReturnType<typeof canonical.execute>> = { run: database.authority.runs.get(parentRun.envelope.runId), outcomes: [] };
        return { harness, database, path, clock, admission, artifacts, artifactReader, sources, canonical, run, parentRun, result, approval,
          reading, corrected, pageBytes, command, root, resolve, stores, signerReads, pageReads, ocrCalls: () => ocrCalls, readResult: () => {
            const checkpoint = database.authority.runCheckpoints.listByAttempt(run.envelope.workflow, run.envelope.itemId,
              "read-result", run.envelope.attempt).at(-1); assert.ok(checkpoint);
            return ReadOcrResult.output.parse(checkpoint.output.value);
          } };
      }
      const upload = await sources.upload({ actorId: "local-operator", fileName: "source.pdf", mediaType: "application/pdf",
        bytes: options.documentBytes ?? new TextEncoder().encode("%PDF-1.7\nSynthetic renderer fixture\n%%EOF") });
      const pageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGvwAAAAASUVORK5CYII=", "base64");
      const image = await artifacts.put(pageBytes, { mediaType: "image/png" });
      rendered.value = { pageCount: options.pageCount ?? 1, pages: Array.from({ length: options.pageCount ?? 1 }, (_, index) => ({ sourcePage: index + 1, image })) };
      const manifest = buildOcrSourceManifest(upload.artifact, rendered.value);
      if (options.lookupNames !== undefined) { assert.equal(options.lookupNames.length, manifest.pageCount); assert.equal(options.record, true); }
      const formType = options.signerLookup === undefined ? options.formType ?? "emergency-contact" : "i9";
      if (options.signerLookup !== undefined) {
        assert.equal(options.record, true);
        assert.equal(options.signerLookup.firstNames.length, manifest.pages.length);
        if (options.signerLookup.failOnce !== undefined) assert.ok(options.signerLookup.firstNames.includes(options.signerLookup.failOnce));
      }
      const readings = ocrPageInputs(manifest, READING_ID, formType).map((page, index) => {
        const facts = options.reviewedPages?.[index];
        const original = options.signerLookup === undefined ? submittedPage(page, facts?.employeeName ?? options.lookupNames?.[index] ?? "Example, Avery", options.record === true && (options.recordPages === undefined || options.recordPages.includes(page.sourcePage)) ? ocrForm(formType).pageKinds[0] : "blank")
          : i9PageSubmission(page, { eid: "10800000", firstName: options.signerLookup.firstNames[index], kind: "i9-section1" });
        const valid = { ...original, source: { kind: "operator" as const, actorId },
          record: original.record === null ? null : { answers: { ...original.record.answers,
            ...(facts === undefined ? {} : { "contact.name": { state: "read" as const, raw: facts.contactName, confidence: 0.9 } }),
            ...(options.employeeIds?.[index] == null ? {} : { "employee.employeeId": { state: "read" as const, raw: options.employeeIds[index], confidence: 0.9 } }) } } };
        const corrected = { ...valid, record: valid.record === null ? null : { answers: { ...valid.record.answers,
          ...(facts === undefined ? {} : { "contact.name": { state: "read" as const, raw: facts.correctedContactName, confidence: 1 } }) } } };
        return { reading: bindManualOcrPageReading(page, actorId, { ...valid,
          record: valid.record === null ? null : { answers: { ...valid.record.answers,
            ...(facts === undefined && options.lookupNames === undefined && options.signerLookup === undefined ? { "employee.name": { state: "absent" as const, reason: "blank" as const } } : {}) } } }),
          corrected: bindManualOcrPageReading(page, actorId, corrected).extraction.record };

      });
      const first = readings[0]; assert.ok(first);
      const { reading, corrected } = first;
      const request = OcrInputSchema.parse({ document: upload.artifact, readingId: READING_ID,
        formType, roster: null, approval: options.release === true ? "release" : "review-only",
        ...(options.extractWithOcr === undefined ? {} : { extractWithOcr: options.extractWithOcr }),
        reading: options.extractWithOcr === false || options.ocrProviderAvailable !== undefined ? { kind: "subscription" }
          : { kind: "manual", actorId, assertions: readings.map(({ reading }) => ({ sourcePage: reading.input.sourcePage, extraction: reading.extraction })) } });
      assert.ok(roster);
      const workbookReferences = options.retainedProducer === true || root.descriptor.workbookReference?.id !== "ocr-roster" ? undefined : [{ entry: 1, libraryId: roster.libraryId,
              versionId: database.authority.workbooks.libraryState(roster.libraryId).selectedVersionId,
              sheetId: "people", expectedVersion: workbooks.read(roster.libraryId).version }, ...(options.checks ?? []).map(check => {
                const extra = workbooks.create({ name: check.name, themes: [], hasFormulas: false, sheets: [{ id: "sheet", name: check.sheet, width: check.fields.length, hidden: [], headerRow: 1,
                  columnBindings: check.fields.map((fieldId, index) => ({ id: `check-${String(index)}`, sourceColumn: index, sourceHeader: fieldId, fieldId, basis: "manual" as const })),
                  rows: [{ id: "header", cells: check.fields.map(value => ({ value })) }, ...check.rows.map((cells, index) => ({ id: `row-${String(index)}`, cells: cells.map(value => ({ value })) }))] }] });
                return { entry: 1, typeId: REFERENCE_CHECK_ID, libraryId: extra.libraryId, versionId: workbooks.libraryVersion(extra.libraryId).version.id,
                  sheetId: "sheet", expectedVersion: workbooks.read(extra.libraryId).version };
              })];
      const submission = coordinator === undefined ? request : EmergencyContactInputSchema.parse({ document: request.document, ...(options.fileName === undefined ? {} : { fileName: options.fileName }), readingId: request.readingId, roster: request.roster, reading: request.reading,
        ...(options.extractWithOcr === undefined ? {} : { extractWithOcr: options.extractWithOcr }), onbaseFiling: options.onbaseFiling ?? "file" });
      const parentRun = canonical.start(root.descriptor, submission, { dryRun: options.dryRun ?? false,
        ...(workbookReferences === undefined ? {} : { workbookReferences }) });
      const signal = new AbortController().signal;
      const lookupAdmitted = () => database.authority.dependencies.groups(parentRun.envelope.runId)
        .some(({ group }) => group.invocation.nodeId === "lookup-identities");
      const executeToLookup = async () => {
        assert.equal(options.parent, undefined);
        const outcomes: Awaited<ReturnType<typeof canonical.execute>>["outcomes"] = [];
        while (!lookupAdmitted()) {
          const next = await canonical.step(parentRun, signal);
          outcomes.push(next.outcome);
          if (!lookupAdmitted()) {
            const failure = next.outcome.state === "failed" ? database.authority.failures.get(next.outcome.failureId) : undefined;
            const expectedPageFailure = next.run.envelope.workflow === "ocr-page" && failure?.nodeId === "manual-reading"
              && failure.taskId === ReadManualOcrReading.id && failure.code === "INCONSISTENT_INPUTS"
              && options.manualPageFailure?.(OcrPageWorkflowInputSchema.parse(next.run.input.parsed.value).page.sourcePage) === true;
            assert.ok(next.outcome.state === "done" || next.outcome.state === "yielded-delegation" || expectedPageFailure,
              `OCR stopped before native lookup admission: ${JSON.stringify({ state: next.outcome.state, workflow: next.run.envelope.workflow, code: failure?.code, summary: failure?.summary })}`);
          }
        }
        return { run: database.authority.runs.get(parentRun.envelope.runId), outcomes };
      };
      // holdPages: stop once the OCR run has queued its page runs, before any page is claimed.
      const executeToPages = async () => {
        const outcomes: Awaited<ReturnType<typeof canonical.execute>>["outcomes"] = [];
        const pagesQueued = () => {
          const ocrRun = root === ocrRoot ? parentRun : database.authority.runs.listChildren(parentRun.envelope.runId)
            .find(child => child.envelope.workflow === "ocr");
          return ocrRun !== undefined && database.authority.runs.listChildren(ocrRun.envelope.runId)
            .some(child => child.envelope.workflow === "ocr-page" && child.lifecycle.state === "queued");
        };
        while (!pagesQueued()) outcomes.push((await canonical.step(parentRun, signal)).outcome);
        return { run: database.authority.runs.get(parentRun.envelope.runId), outcomes };
      };
      let result = options.holdPages === true ? await executeToPages() : options.pauseAtLookup === true ? await executeToLookup() : await canonical.execute(parentRun, signal);
      if ((failedPage || failedSigner) && options.stopAfterPageFailure !== true && result.run?.lifecycle.state === "queued") {
        const continued = await canonical.execute(parentRun, new AbortController().signal);
        result = { ...continued, outcomes: [...result.outcomes, ...continued.outcomes] };
      }
      const run = root === ocrRoot ? parentRun
        : database.authority.runs.listChildren(parentRun.envelope.runId).find(child => child.envelope.workflow === "ocr");
      assert.ok(run);
      if (actorId === "local-operator" && options.holdPages !== true) {
        const failures = result.outcomes.filter(outcome => outcome.state === "failed").map(outcome => {
          const failure = database.authority.failures.get(outcome.failureId); assert.ok(failure);
          return { nodeId: failure.nodeId, taskId: failure.taskId, code: failure.code,
            causes: failure.causeChain.map(cause => cause.code),
            frames: [...(failure.debug?.stack ?? "").matchAll(/(?:src|tests)\/[A-Za-z0-9_./-]+\.ts:\d+:\d+/gu)]
              .map(match => match[0]).slice(0, 8) };
        });
        if (options.manualPageFailure !== undefined) {
          assert.deepEqual(failures.map(({ nodeId,taskId,code }) => ({ nodeId,taskId,code })),
            manifest.pages.filter(page => options.manualPageFailure?.(page.sourcePage) === true)
              .map(() => ({ nodeId: "manual-reading", taskId: ReadManualOcrReading.id, code: "INCONSISTENT_INPUTS" })));
        } else {
          assert.deepEqual(failures.filter(failure => !((failedPage && failure.nodeId === "manual-reading" && failure.code === "INCONSISTENT_INPUTS")
            || (failedSigner && failure.nodeId === "lookup-source" && failure.code === "I9_LOOKUP_FAILED"))), [],
            `OCR fixture execution failed: ${JSON.stringify(failures)}`);
          assert.equal(failures.length, Number(failedPage) + Number(failedSigner));
        }
        const lifecycle = root === ocrRoot ? result.run?.lifecycle : database.authority.runs.get(run.envelope.runId)?.lifecycle;
        assert.ok(options.pauseAtLookup === true ? lookupAdmitted() && (lifecycle?.state === "queued" || lifecycle?.state === "parked-gate")
          : failedPage && options.stopAfterPageFailure === true ? lifecycle?.state === "queued"
          : (options.release === true || coordinator !== undefined) ? lifecycle?.state === "parked-gate"
          : lifecycle?.state === "terminal" && lifecycle.outcome === "done",
        `OCR fixture stopped before review: ${JSON.stringify(result.outcomes.map(outcome => ({ state: outcome.state })))}`);
      }
      const command = (type: "correct-ocr-record" | "discard-ocr-record" | "restore-ocr-record", expectedRevision: number, recordIndex = 0) => {
        const review = database.authority.ocrReviews.latest(run.envelope.runId); assert.ok(review);
        const record = review.records[recordIndex], correctedRecord = readings[recordIndex]?.corrected; assert.ok(record && correctedRecord);
        return { commandId: randomUUID(), requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard",
          family: "ocr-review" as const, type, target: { runId: run.envelope.runId, expectedRevision },
          payload: type === "correct-ocr-record" ? { recordId: record.recordId, fields: correctedRecord, assertedEid: "10800000" } : { recordId: record.recordId } };
      };
      const approval = (selectedRecordIds?: readonly string[]) => {
        const review = database.authority.ocrReviews.latest(run.envelope.runId); assert.ok(review);
        const current = database.authority.runs.get(run.envelope.runId); assert.ok(current);
        const commandId = randomUUID();
        const snapshot = OcrApprovedSnapshotSchema.parse({ snapshotId: commandId, sourceRunId: current.envelope.runId,
          revision: review.revision, reviewDigest: ocrReviewDigest(review), selectedRecordIds: selectedRecordIds ?? review.records.map(record => record.recordId),
          records: selectedRecordIds === undefined ? review.records : selectedRecordIds.map(id => review.records.find(record => record.recordId === id)),
          approvedBy: "local-operator", approvedAt: clock.now().toISOString() });
        return { commandId, requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard",
          family: "gate", type: "resolve-gate", target: { runId: current.envelope.runId, gateId: "approve-records", expectedVersion: current.version },
          payload: { result: { schemaHash: deriveSchemaHash(OcrApprovalReferenceSchema, "output"), value: {
            snapshotId: commandId, sourceRunId: current.envelope.runId, revision: review.revision, digest: ocrSnapshotDigest(snapshot),
          } }, ocrApproval: { expectedRevision: review.revision, reviewDigest: ocrReviewDigest(review), selectedRecordIds: snapshot.selectedRecordIds } } };
      };
      return { harness, database, path, clock, admission, workbookReferences, artifacts, artifactReader, sources, canonical, run, parentRun, result, approval,
        reading, corrected, pageBytes, command, root, resolve, stores, signerReads, pageReads, ocrCalls: () => ocrCalls, readResult: () => {
          const checkpoint = database.authority.runCheckpoints.listByAttempt(run.envelope.workflow, run.envelope.itemId,
            "read-result", run.envelope.attempt).at(-1); assert.ok(checkpoint);
          return ReadOcrResult.output.parse(checkpoint.output.value);
        } };
    },
  };
}
