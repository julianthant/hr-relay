import type { SpanEmitter } from "../../../../src/backend/logs/span-emitter.js";
import { BUILD_MANIFEST } from "../../../../src/workflow-kit/validation/build-manifest.js";
import type { BuildManifest } from "../../../../src/models/workflow/build-manifest.js";
import type { createRetainedApprovedRecordReader } from "../../fixtures/ocr/retained-approved-records.js";
import { descriptorRuntimeNodes } from "../../../../src/workflow-kit/workflow.js";
import { runClaim } from "../../../../src/models/run/record.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { createConfirmedActionPublisher } from "../../../../src/backend/logs/confirmed-action-publisher.js";
import { createApprovedOcrRecordReader } from "../../../../src/backend/runs/lifecycle/approved-ocr-records.js";
import { EmergencyContactInputSchema } from "../../../../src/models/workflows/emergency-contact/input.js";
import { createOcrApprovedSnapshotAdapter } from "../../../../src/backend/processing/providers/ocr-approved-snapshot-adapter.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { ocrModule, CHILD_ONLY_WORKFLOW_MODULES, SERVER_REGISTRY, workflowModuleOf, childWorkflowModuleOf } from "../../../../src/backend/app/registries/workflow-registry.js";
import { createOcrCheckpointPublication } from "../../../../src/backend/runs/lifecycle/ocr-checkpoint-publication.js";
import { createOcrSourceService } from "../../../../src/backend/runs/commands/ocr-source-service.js";
import { createContentAddressedArtifactWriter } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { createServerVerifiedArtifactReader } from "../../../../src/backend/storage/artifacts/server-verified-artifact-reader.js";
import { OcrInputSchema } from "../../../../src/models/workflows/ocr/input.js";
import { OcrApprovalReferenceSchema, OcrResultSchema } from "../../../../src/models/workflows/ocr/result.js";
import { OcrApprovedSnapshotSchema, ocrReviewDigest, ocrSnapshotDigest } from "../../../../src/models/ocr/review.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { bindManualOcrPageReading } from "../../../../src/models/workflows/ocr/page-accounting.js";
import { buildOcrSourceManifest, ocrPageInputs } from "../../../../src/models/workflows/ocr/source-manifest.js";
import { ExtractPdfPages, type ExtractPdfPagesOutputSchema } from "../../../../src/models/processing/extraction/extract-pdf-pages.js";
import { defineTask } from "../../../../src/workflow-kit/task.js";
import { defineServiceStore, defineTaskStoreRegistry, defineWorkflowStore, type RegisteredTaskStore } from "../../../../src/workflow-kit/task-registry.js";
import { submittedPage, READING_ID, READ_AT } from "../../fixtures/ocr/source-pages.js";
import { canonicalChildExecution } from "./canonical-child-execution.js";
import { createRunExecutorTestWorld } from "./run-executor-world.js";
import { boundProfileAdmission } from "../synthetic-database-admission.js";
import type { z } from "zod";
import { createWorkbookLibraryService } from "../../../../src/backend/workbooks/workbook-library-service.js";
import { unexpectedWorkbookSync } from "./workbook-sync.js";
import { retainedOcrModule, retainedOcrStore, retainedOcrCheckpointPublication } from "../../fixtures/ocr/retained-review-producer.js";
import { ocrWorkflowStore } from "../../../../src/workflows/ocr/task-registry.js";
import { ocrForm, type OcrFormType } from "../../../../src/models/ocr/form-registry.js";
import { createWriteSequencer } from "../../../../src/backend/runtime/writes/write-sequencer.js";
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

interface ReviewedPageFacts {
  readonly employeeName: string;
  readonly contactName: string;
  readonly correctedContactName: string;
}

export function createOcrReviewWorld() {
  const world = createRunExecutorTestWorld();
  return {
    cleanup: world.cleanup,
    async fixture(options: Readonly<{ actorId?: string; record?: boolean; release?: boolean; pageCount?: number;
      retainedProducer?: boolean; coordinator?: boolean; dryRun?: boolean; parent?: WorkflowModule; ocr?: WorkflowModule;
      lookupNames?: readonly string[]; recordPages?: readonly number[]; pauseAtLookup?: boolean; formType?: OcrFormType; sessions?: SessionFactoryHarness;
      failManualPageOnce?: number; stopAfterPageFailure?: boolean;
      signerLookup?: Readonly<{ firstNames: readonly string[]; failOnce?: string }>;
      reviewedPages?: readonly ReviewedPageFacts[]; operatorEvidence?: boolean;
      screenshotCapture?: NonNullable<Parameters<typeof world.executorHarness>[0]>["screenshotCapture"];
      member?: WorkflowModule;
      buildManifest?: BuildManifest;
      approvedReader?: typeof createRetainedApprovedRecordReader;
      approvedStore?: RegisteredTaskStore;
      manualPageFailure?: (sourcePage: number) => boolean;
      onSpan?: (event: Parameters<SpanEmitter["emit"]>[0]) => void;
      onTransactionSettled?: () => void;
      onHarness?: (harness: Awaited<ReturnType<typeof world.executorHarness>>) => void }> = {}) {
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
      const ocrRoot = options.retainedProducer === true ? retainedOcrModule : options.ocr ?? ocrModule;
      const coordinator = options.coordinator === true ? workflowModuleOf("emergency-contact") : undefined;
      const member = options.member ?? (options.coordinator === true ? childWorkflowModuleOf("emergency-contact", "emergency-contact-member") : undefined);
      const root = options.parent ?? coordinator ?? ocrRoot;
      let failedPage = false;
      let failedSigner = false;
      const signerReads: string[] = [];
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
      const manualReading = options.failManualPageOnce === undefined && options.manualPageFailure === undefined ? readManualOcrReadingTask : defineTask(readManualOcrReadingTask.contract, {
        sessions: [], async run(args) {
          if (options.manualPageFailure?.(args.input.page.sourcePage) === true) return args.ctx.fail("INCONSISTENT_INPUTS", "Synthetic manual page reading refused.");
          if (!failedPage && args.input.page.sourcePage === options.failManualPageOnce) {
            failedPage = true;
            return args.ctx.fail("INCONSISTENT_INPUTS", "Synthetic first page-read failure.");
          }
          return readManualOcrReadingTask.impl.run(args);
        },
      });
      const pages = defineWorkflowStore("ocr-page", { ...ocrPageStore.tasks, readManualReading: manualReading });
      const entries: readonly RegisteredTaskStore[] = [...taskStoreRegistry.stores.filter(store => !["extraction", "workflow:ocr", "workflow:ocr-page"].includes(store.namespace)
        && store.namespace !== options.approvedStore?.namespace), ...(options.approvedStore === undefined ? [] : [options.approvedStore]), pages,
        defineServiceStore("extraction", { render }), options.retainedProducer === true ? retainedOcrStore : ocrWorkflowStore];
      const tasks = entries.flatMap(store => Object.values(store.tasks));
      const stores = defineTaskStoreRegistry(entries, { scenarioIds: [...new Set(tasks.flatMap(task => task.contract.scenarios))],
        tasks: tasks.map(task => ({ id: task.contract.id, effect: task.contract.effect })) });
      const harness = await world.executorHarness({ descriptor: root.descriptor, stores,
        ...(sessions === undefined ? {} : { sessions }),
        ...(options.screenshotCapture === undefined ? {} : { screenshotCapture: options.screenshotCapture }),
      });
      options.onHarness?.(harness);
      const { database, path, clock } = harness.authority;
      const workbooks = createWorkbookLibraryService({ repository: database.authority.workbooks, clock, sync: unexpectedWorkbookSync });
      const roster = workbooks.create({ name: "OCR roster", themes: [], hasFormulas: false, sheets: [{
        id: "people", name: "People", width: 2, hidden: [], headerRow: 1,
        columnBindings: ["eid", "fullName"].map((fieldId, index) => ({ id: fieldId, sourceColumn: index, sourceHeader: fieldId, fieldId, basis: "manual" })),
        rows: [{ id: "header", cells: [{ value: "EID" }, { value: "Name" }] }],
      }] });
      database.authority.workbooks.putType({ id: "ocr-roster", name: "OCR roster", keyFieldId: "eid", fields: ["eid", "fullName"], defaultWorkbookId: null });
      workbooks.operatorOperation(roster.libraryId, "set-roster-type", { kind: "metadata", expectedVersion: 1, metadata: { typeId: "ocr-roster", sharePoint: null } });
      const admission = boundProfileAdmission(path);
      const artifacts = createContentAddressedArtifactWriter({ admission }); await artifacts.ready;
      const artifactReader = createServerVerifiedArtifactReader({ admission }); await artifactReader.ready;
      const resolve = (id: string) => id === root.descriptor.id ? root.descriptor : id === "ocr" ? ocrRoot.descriptor : id === coordinator?.descriptor.id ? coordinator.descriptor : id === member?.descriptor.id ? member.descriptor
        : (CHILD_ONLY_WORKFLOW_MODULES.find(module => module.descriptor.id === id) ?? SERVER_REGISTRY[id])?.descriptor;
      const sequencer = options.dryRun === true || options.member !== undefined ? createWriteSequencer({ lifecycle: testRunLifecycle(database, clock), stores, authority: database,
        sessions: harness.manager, emitter: harness.deps.emitter, clock, ids: { uuid: randomUUID }, scheduler: harness.scheduler,
        taskDeadlineMs: 60_000, operator: "local-operator", log: harness.deps.log }) : undefined;
      const writeSequencer = sequencer === undefined ? undefined : { ...sequencer, async executeTransaction(...args: Parameters<typeof sequencer.executeTransaction>) {
        const settled = await sequencer.executeTransaction(...args);
        options.onTransactionSettled?.();
        return settled;
      } };
      const notes = options.operatorEvidence === true ? createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock }) : undefined;
      const canonical = canonicalChildExecution({ ...harness.deps, emitter: { emit: event => { harness.deps.emitter.emit(event); options.onSpan?.(event); } }, ...(options.buildManifest === undefined ? {} : { buildManifest: options.buildManifest }), artifacts, ...(writeSequencer === undefined ? {} : { writeSequencer }) }, database, path, resolve,
        options.retainedProducer === true ? retainedOcrCheckpointPublication : createOcrCheckpointPublication,
        { workbooks, resources: (reader, run) => { const claim = runClaim(run); assert.ok(claim); const descriptor = resolve(run.envelope.workflow); assert.ok(descriptor);
          const needsPlanEvidence = notes !== undefined && descriptorRuntimeNodes(descriptor).some(node => node.kind === "transaction");
          return { ...(!needsPlanEvidence ? {} : { taskNotes: notes,
          confirmedActionPublisher: createConfirmedActionPublisher({ workerId: claim.workerId, streamId: randomUUID(), clock, capacity: 256,
            append: event => { const current = database.authority.runs.get(event.action.runId); assert.ok(current); notes.emitConfirmedAction(event, current); } }) }), providers: { configSnapshots: database.authority.configSnapshots,
          idFactory: { next: () => randomUUID() }, adapters: { "ocr.approved-snapshot": createOcrApprovedSnapshotAdapter({clock,
            reader: options.approvedReader === undefined
              ? createApprovedOcrRecordReader({database,run,reader,resolveDescriptor:resolve,assertCurrent:()=>admission.assertProfileRuntime()})
              : options.approvedReader({database,run,reader,resolveDescriptor:resolve,assertCurrent:()=>admission.assertProfileRuntime(), manifest: options.buildManifest ?? BUILD_MANIFEST}),
          }) } } }; } });
      const sources = createOcrSourceService({ database, reader: canonical.lifecycle, clock, artifacts, artifactReader,
        assertCurrent: () => admission.assertProfileRuntime() });
      const upload = await sources.upload({ actorId: "local-operator", fileName: "source.pdf", mediaType: "application/pdf",
        bytes: new TextEncoder().encode("%PDF-1.7\nSynthetic renderer fixture\n%%EOF") });
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
            ...(facts === undefined ? {} : { "contact.name": { state: "read" as const, raw: facts.contactName, confidence: 0.9 } }) } } };
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
        reading: { kind: "manual", actorId, assertions: readings.map(({ reading }) => ({ sourcePage: reading.input.sourcePage, extraction: reading.extraction })) } });
      const parentRun = canonical.start(root.descriptor, coordinator === undefined ? request : EmergencyContactInputSchema.parse({ document: request.document, readingId: request.readingId, roster: request.roster, reading: request.reading }), { dryRun: options.dryRun ?? false,
          ...(options.retainedProducer === true || !root.descriptor.requiredWorkbookTypeIds.includes("ocr-roster") ? {} : { workbookReferences: [{ entry: 1, typeId: "ocr-roster", libraryId: roster.libraryId }] }) });
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
      let result = options.pauseAtLookup === true ? await executeToLookup() : await canonical.execute(parentRun, signal);
      if ((failedPage || failedSigner) && options.stopAfterPageFailure !== true && result.run?.lifecycle.state === "queued") {
        const continued = await canonical.execute(parentRun, new AbortController().signal);
        result = { ...continued, outcomes: [...result.outcomes, ...continued.outcomes] };
      }
      const run = root === ocrRoot ? parentRun
        : database.authority.runs.listChildren(parentRun.envelope.runId).find(child => child.envelope.workflow === "ocr");
      assert.ok(run);
      if (actorId === "local-operator") {
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
      return { harness, database, path, clock, admission, artifacts, artifactReader, sources, canonical, run, parentRun, result, approval,
        reading, corrected, pageBytes, command, root, resolve, stores, signerReads, readResult: () => {
          const checkpoint = database.authority.runCheckpoints.listByAttempt(run.envelope.workflow, run.envelope.itemId,
            "read-result", run.envelope.attempt).at(-1); assert.ok(checkpoint);
          return OcrResultSchema.parse(checkpoint.output.value);
        } };
    },
  };
}
