import { i9CheckStartModule } from "../registered-workflows.js";
import { createDeterministicI9Driver } from "../../../../src/backend/systems/i9/driver/fake.js";
import { WorkbookNamedReferenceSnapshotSchema } from "../../../../src/models/dashboard/workbooks.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CHILD_ONLY_WORKFLOW_MODULES, SERVER_REGISTRY } from "../../../../src/backend/app/registries/workflow-registry.js";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { composeWorkerArtifactProjector } from "../../../../src/backend/app/composition/worker/artifact-output.js";
import { createOcrReviewAdapter } from "../../../../src/backend/processing/providers/ocr-review-adapter.js";
import { createApprovedOcrRecordReader } from "../../../../src/backend/runs/lifecycle/approved-ocr-records.js";
import { createWorkbookLibraryAdapter } from "../../../../src/backend/processing/providers/workbook-library-adapter.js";
import { createOcrCheckpointPublication } from "../../../../src/backend/runs/lifecycle/ocr-checkpoint-publication.js";
import { createOcrSourceService } from "../../../../src/backend/runs/commands/ocr-source-service.js";
import { createWorkbookLibraryService } from "../../../../src/backend/workbooks/workbook-library-service.js";
import { createContentAddressedArtifactWriter } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { createServerVerifiedArtifactReader } from "../../../../src/backend/storage/artifacts/server-verified-artifact-reader.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../src/backend/systems/ucpath/driver/fake.js";
import { ExtractPdfPages, type ExtractPdfPagesOutputSchema } from "../../../../src/models/processing/extraction/extract-pdf-pages.js";
import { createRunWorkbookService } from "../../../../src/backend/runs/workbooks.js";
import { WorkbookReferenceReadRequestSchema } from "../../../../src/models/processing/workbooks/read-reference.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { searchPartitionDay } from "../../../../src/models/dashboard/search-calendar.js";
import type { WorkbookLibraryChangeSchema } from "../../../../src/models/dashboard/workbook-library.js";
import { I9CheckStartInput, I9_CHECK_REFERENCE } from "../../../../src/models/workflows/i9-check/start.js";
import { OcrApprovedSnapshotSchema, ocrReviewDigest, ocrSnapshotDigest } from "../../../../src/models/ocr/review.js";
import { answersFingerprint } from "../../../../src/models/ocr/extraction.js";
import { OcrApprovalReferenceSchema } from "../../../../src/models/workflows/ocr/result.js";
import { buildOcrSourceManifest, ocrPageInputs } from "../../../../src/models/workflows/ocr/source-manifest.js";
import { bindManualOcrPageReading } from "../../../../src/models/workflows/ocr/page-accounting.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { defineTask } from "../../../../src/workflow-kit/task.js";
import { defineServiceStore, defineTaskStoreRegistry, type RegisteredTaskStore } from "../../../../src/workflow-kit/task-registry.js";
import { canonicalChildExecution } from "./canonical-child-execution.js";
import { createRunExecutorTestWorld } from "./run-executor-world.js";
import { boundProfileAdmission } from "../synthetic-database-admission.js";
import { sessionFactoryHarness, healthyCrmDriver } from "../phase1f-executor-harness.js";
import type { UcpathPersonOrgDriver } from "../../../../src/models/ui/ucpath-person-org.js";
import type { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { EidSchema } from "../../../../src/rules/identity/ids.js";
import { i9Candidate, i9Search } from "../../fixtures/i9-check.js";
import { i9PageSubmission, type I9FixturePage } from "../../fixtures/i9-check-start.js";
import { unexpectedWorkbookSync } from "./workbook-sync.js";
import { readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { ConfigSnapshotRecordSchema } from "../../../../src/models/config/snapshot.js";
import { PREFERENCES_SNAPSHOT } from "../../fixtures/phase1c-contract-fixtures.js";
import type { z } from "zod";

export function createI9CheckStartWorld() {
  const world = createRunExecutorTestWorld();
  return { cleanup: world.cleanup, async fixture(options: Readonly<{ dryRun?: boolean }> = {}) {
    const publishCalls: string[] = [], projections: (readonly string[])[] = [];
    const pages = new Map<string, z.output<typeof ExtractPdfPagesOutputSchema>>();
    const renderer = defineTask(ExtractPdfPages, { sessions: [], async run({ input, ctx }) {
      const output = pages.get(input.document.id); assert.ok(output);
      ctx.recordData(Object.entries(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
      return output;
    } });
    const stores: readonly RegisteredTaskStore[] = [...taskStoreRegistry.stores.filter(store => store.namespace !== "extraction"), defineServiceStore("extraction", { renderer })];
    const tasks = stores.flatMap(store => Object.values(store.tasks));
    const registry = defineTaskStoreRegistry(stores, { scenarioIds: [...new Set(tasks.flatMap(task => task.contract.scenarios))], tasks: tasks.map(task => ({ id: task.contract.id, effect: task.contract.effect })) });
    const candidates = [
      { ...i9Candidate, emplId: EidSchema.parse("10000001"), name: "Example, Avery", startDate: "06/01/2020" },
      { ...i9Candidate, emplId: EidSchema.parse("10000002"), name: "Example, Blair", startDate: "06/01/2020" },
    ];
    const sessions = sessionFactoryHarness({ crm: () => healthyCrmDriver(), i9: () => createDeterministicI9Driver({ lookup: { i9Status: "not-found", signerName: "" }, now: clock.now().toISOString() }), ucpath: (): UcpathPersonOrgDriver => ({ ...createDeterministicUcpathPersonOrgDriver(),
      async searchPersonOrg(input) { return i9Search(candidates.filter(candidate => input.kind === "by-name" ? candidate.name === input.name : candidate.emplId === input.emplId)); },
      async searchPersonMatch(input) {
        const confirmed = candidates.filter(candidate => candidate.name === `${input.lastName}, ${input.firstName}`).map(candidate => ({ emplId: candidate.emplId, name: candidate.name }));
        return { hits: confirmed, confirmed, dropped: [] };
      },
    }) });
    const root = i9CheckStartModule, harness = await world.executorHarness({ descriptor: root.descriptor, stores: registry, sessions });
    const { database, path, clock } = harness.authority, admission = boundProfileAdmission(path);
    const settings = readSettings(database.authority), resolved = resolveConfigWithProvenance(settings.settings, hostConfigFacts({}), clock,
      { stateRoot: admission.stateRoot, artifactRoot: admission.artifactRoot });
    const snapshot = ConfigSnapshotRecordSchema.parse({ ...PREFERENCES_SNAPSHOT, configSnapshotId: randomUUID(), revision: settings.revision,
      fingerprint: resolved.fingerprint, config: resolved.config, provenance: resolved.provenance, capturedAt: clock.now().toISOString(), capturedBy: "local-operator" });
    database.authority.configSnapshots.insert(snapshot);
    database.authority.runtimeConfig.activate({ settingsRevision: settings.revision, settingsFingerprint: settings.settingsFingerprint,
      configSnapshotId: snapshot.configSnapshotId, configFingerprint: snapshot.fingerprint, activatedAt: snapshot.capturedAt });
    const artifacts = createContentAddressedArtifactWriter({ admission }); await artifacts.ready;
    const artifactReader = createServerVerifiedArtifactReader({ admission }); await artifactReader.ready;
    const library = createWorkbookLibraryService({ repository: database.authority.workbooks, clock, sync: unexpectedWorkbookSync });
    const columns = [...I9_CHECK_REFERENCE.fields];
    const saved = library.create({ name: "Action History", themes: [], hasFormulas: false, sheets: [{ id: "history", name: "Action History", width: 4, hidden: [], headerRow: 1,
      columnBindings: columns.map((fieldId, index) => ({ id: `column-${index}`, sourceColumn: index, sourceHeader: fieldId, fieldId, basis: "manual" })),
      rows: [{ id: "header", cells: columns.map(value => ({ value })) }, ...candidates.map((candidate, index) => ({ id: `person-${index}`,
        cells: [candidate.emplId, "000012345", "2024-01-01", "TER"].map(value => ({ value })) }))] }] });
    database.authority.workbooks.putType({ id: I9_CHECK_REFERENCE.typeId, name: "Action History", keyFieldId: "eid", fields: columns, defaultWorkbookId: null });
    library.operatorOperation(saved.libraryId, "reference-type", { kind: "metadata", expectedVersion: 1, metadata: { typeId: I9_CHECK_REFERENCE.typeId, sharePoint: null } });
    const referenceChange = async (change: z.infer<typeof WorkbookLibraryChangeSchema>) => {
      const entry = library.catalog().find(entry => entry.libraryId === saved.libraryId); assert.ok(entry);
      return library.libraryAction(saved.libraryId, { operationId: randomUUID(), expectedRevision: entry.state.revision,
        expectedVersion: entry.version, change }, new AbortController().signal);
    };
    const named = await referenceChange({ kind: "create-version", name: "Fall review", from: { kind: "version", versionId: "original" }, useNow: true });
    const referenceDeclaration = root.descriptor.workbookReference;
    assert.ok(referenceDeclaration);
    const sourceSheet = saved.workbook.sheets[0]; assert.ok(sourceSheet);
    const selectedSource = (sourceLibraryId: string, versionId: string, keys: readonly string[]) => library.snapshot({
      kind: "selected-source", typeId: referenceDeclaration.id, keyFieldId: referenceDeclaration.keyFieldId,
      fields: [...root.descriptor.requiredWorkbookFields], writableFields: [...referenceDeclaration.writableFields],
      mode: referenceDeclaration.mode, keys: [...keys], libraryId: sourceLibraryId, versionId, sheetId: sourceSheet.id,
      expectedVersion: library.read(sourceLibraryId).version,
    });
    const selectedReference = WorkbookNamedReferenceSnapshotSchema.parse(selectedSource(saved.libraryId, named.action.operationId, []));
    const runWorkbooks = createRunWorkbookService({ database, clock }), readRefusals = new Set<string>();
    const projector = composeWorkerArtifactProjector({ admission, database, artifacts, clock });
    const resolve = (id: string) => (CHILD_ONLY_WORKFLOW_MODULES.find(module => module.descriptor.id === id) ?? SERVER_REGISTRY[id])?.descriptor;
    const canonical = canonicalChildExecution({ ...harness.deps, artifacts }, database, path, resolve, createOcrCheckpointPublication, { workbooks: library,
      resources: (reader, run) => ({ artifactProjector: { projectOutbox: ids => { projections.push(ids); return projector.projectOutbox(ids); } }, providers: { configSnapshots: database.authority.configSnapshots, idFactory: { next: randomUUID },
        adapters: { "ocr.review": createOcrReviewAdapter({ reader: createApprovedOcrRecordReader({ database, reader, run, resolveDescriptor: resolve, assertCurrent: () => admission.assertProfileRuntime() }), clock }),
          "workbooks.library": countPublishes(createWorkbookLibraryAdapter({ repository: database.authority.workbooks, runId: run.envelope.runId, clock,
            publicationSource: () => { const descriptor = resolve(run.envelope.workflow); assert.ok(descriptor);
              return { workflowId: descriptor.id, workflowLabel: descriptor.label, partitionDay: searchPartitionDay(new Date(run.envelope.enqueuedAt)) }; },
            references: { runId: run.envelope.runId, write: () => { throw new Error("I-9 fixture must not patch a reference"); }, read: request => {
              assert.equal(request.typeId, I9_CHECK_REFERENCE.typeId); assert.deepEqual(request.keys, [...expected.values()]);
              for (const [name, captured] of [
                ["missing run", { ...run, envelope: { ...run.envelope, runId: randomUUID() } }],
                ["foreign claim", { ...run, claimGeneration: Number(run.claimGeneration) + 1 }],
                ["altered input", { ...run, input: { ...run.input, parsed: { ...run.input.parsed, value: {} } } }],
              ] as const) {
                assert.throws(() => runWorkbooks.read(RunRecordSchema.parse(captured), request), { code: "WORKBOOK_INVALID" }); readRefusals.add(name);
              }
              assert.throws(() => runWorkbooks.read(run, { ...request, typeId: "foreign" }), { code: "WORKBOOK_INVALID" }); readRefusals.add("foreign type");
              assert.equal(WorkbookReferenceReadRequestSchema.safeParse({ ...request, fields: [...I9_CHECK_REFERENCE.fields].toReversed() }).success, false);
              readRefusals.add("altered fields");
              return runWorkbooks.read(run, request);
            } } })),
        } } }),
    });
    function countPublishes(adapter: ReturnType<typeof createWorkbookLibraryAdapter>) {
      return { ...adapter, invoke: (...args: Parameters<typeof adapter.invoke>) => {
        if (args[0].payload.schemaHash !== deriveSchemaHash(WorkbookReferenceReadRequestSchema, "output")) publishCalls.push(args[0].capability);
        return adapter.invoke(...args);
      } };
    }
    const sources = createOcrSourceService({ database, reader: canonical.lifecycle, clock, artifacts, artifactReader, assertCurrent: () => admission.assertProfileRuntime() });
    const image = await artifacts.put(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGvwAAAAASUVORK5CYII=", "base64"), { mediaType: "image/png" });
    const documents = [], expected = new Map<string, string>();
    for (const [index, candidate] of candidates.entries()) {
      const upload = await sources.upload({ actorId: "local-operator", fileName: `source-${index}.pdf`, mediaType: "application/pdf",
        bytes: new TextEncoder().encode(`%PDF-1.7\nSynthetic I-9 ${index}\n%%EOF`) });
      const rendered = { pageCount: 2, pages: [{ sourcePage: 1, image }, { sourcePage: 2, image }] }; pages.set(upload.artifact.id, rendered);
      const manifest = buildOcrSourceManifest(upload.artifact, rendered), readingId = randomUUID();
      const facts: I9FixturePage[] = [{ eid: candidate.emplId, firstName: index === 0 ? "Avery" : "Blair", kind: "i9-section1", dob: "01/15/2000" },
        { eid: candidate.emplId, firstName: index === 0 ? "Avery" : "Blair", kind: "i9-section2", hireDate: "06/01/2020" }];
      const assertions = ocrPageInputs(manifest, readingId, "i9").map((page, pageIndex) => ({ sourcePage: page.sourcePage,
        extraction: bindManualOcrPageReading(page, "local-operator", { ...i9PageSubmission(page, facts[pageIndex]), source: { kind: "operator", actorId: "local-operator" } }).extraction }));
      documents.push({ document: upload.artifact, fileName: upload.fileName, readingId, reading: { kind: "manual" as const, actorId: "local-operator", assertions } });
      expected.set(upload.artifact.sha256, candidate.emplId);
    }
    const input = I9CheckStartInput.parse({ documents, asOf: "2026-11-01", reviewerName: "Example Reviewer" });
    const run = canonical.start(root.descriptor, input, { dryRun: options.dryRun ?? false, workbookReferences: [{ entry: 1,
      libraryId: saved.libraryId, versionId: selectedReference.versionId, sheetId: "history",
      expectedVersion: library.read(saved.libraryId).version }] });
    const changeReference = async () => {
      const current = library.read(saved.libraryId), workbook = structuredClone(current.workbook);
      for (const row of workbook.sheets[0].rows.slice(1)) row.cells[1].value = "999999999";
      library.save(saved.libraryId, current.version, workbook);
      await referenceChange({ kind: "rename-version", versionId: named.action.operationId, name: "Renamed later" });
      const other = library.create({ name: "New default", themes: [], hasFormulas: false, sheets: workbook.sheets });
      library.operatorOperation(other.libraryId, "new-default-type", { kind: "metadata", expectedVersion: 1,
        metadata: { typeId: I9_CHECK_REFERENCE.typeId, sharePoint: null } });
      const type = library.types().find(type => type.id === I9_CHECK_REFERENCE.typeId); assert.ok(type);
      database.authority.workbooks.putType({ ...type, defaultWorkbookId: other.libraryId });
      const keys = candidates.map(candidate => candidate.emplId);
      const currentSource = library.catalog().find(entry => entry.libraryId === saved.libraryId); assert.ok(currentSource);
      const otherSource = library.catalog().find(entry => entry.libraryId === other.libraryId); assert.ok(otherSource);
      return { master: selectedSource(saved.libraryId, currentSource.state.selectedVersionId, keys),
        otherSource: selectedSource(other.libraryId, otherSource.state.selectedVersionId, keys),
        renamed: WorkbookNamedReferenceSnapshotSchema.parse(selectedSource(saved.libraryId, named.action.operationId, keys)) };
    };
    const approveNext = () => {
      const child = database.authority.runs.listChildren(run.envelope.runId).find(child => child.envelope.workflow === "ocr" && child.lifecycle.state === "parked-gate"); assert.ok(child);
      let review = database.authority.ocrReviews.latest(child.envelope.runId); assert.ok(review);
      const eid = expected.get(review.seed.review.accounting.manifest.document.sha256); assert.ok(eid);
      for (const record of review.records) {
        const answers = record.fields.answers.map(answer => answer.path === "dateOfBirth" && answer.state === "read"
          ? { ...answer, raw: "02/03/2001", value: "2001-02-03" } : answer);
        const fields = { ...record.fields, answers, answersFingerprint: answersFingerprint(answers) };
        const command: z.input<typeof CommandRequestSchema> = { commandId: randomUUID(), requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard", family: "ocr-review",
          type: "correct-ocr-record", target: { runId: child.envelope.runId, expectedRevision: review.revision }, payload: { recordId: record.recordId, fields, assertedEid: eid } };
        assert.equal(canonical.kernel.execute(command).state, "applied");
        const next = database.authority.ocrReviews.latest(child.envelope.runId); assert.ok(next); review = next;
      }
      const current = database.authority.runs.get(child.envelope.runId); assert.ok(current);
      const commandId = randomUUID(), snapshot = OcrApprovedSnapshotSchema.parse({ snapshotId: commandId, sourceRunId: child.envelope.runId, revision: review.revision,
        reviewDigest: ocrReviewDigest(review), selectedRecordIds: review.records.map(record => record.recordId), records: review.records, approvedBy: "local-operator", approvedAt: clock.now().toISOString() });
      assert.equal(canonical.kernel.execute({ commandId, requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard", family: "gate", type: "resolve-gate",
        target: { runId: child.envelope.runId, gateId: "approve-records", expectedVersion: current.version }, payload: {
          result: { schemaHash: deriveSchemaHash(OcrApprovalReferenceSchema, "output"), value: { snapshotId: commandId, sourceRunId: child.envelope.runId,
            revision: review.revision, digest: ocrSnapshotDigest(snapshot) } },
          ocrApproval: { expectedRevision: review.revision, reviewDigest: ocrReviewDigest(review), selectedRecordIds: snapshot.selectedRecordIds },
        } }).state, "applied");
      return child.envelope.runId;
    };
    return { harness, database, clock, admission, artifacts, canonical, run, input, root, library, referenceId: saved.libraryId,
      selectedReference, changeReference, readRefusals, approveNext, publishCalls, projections, plan: canonical.plans.at(-1) };
  } };
}
