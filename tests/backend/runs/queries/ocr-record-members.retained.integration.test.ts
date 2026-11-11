import { ocrModule } from "../../../support/helpers/registered-workflows.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { createOperatorProjection } from "../../../../src/backend/app/composition/dashboard/queue.js";
import { childWorkflowModuleOf, workflowModuleOf } from "../../../../src/backend/app/registries/workflow-registry.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import { AuthorityDatabase, type AuthorityRepositories } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";
import { readQueueRecordMembers } from "../../../../src/backend/runs/queries/ocr-record-members.js";
import { requireCurrentOcrSnapshot } from "../../../../src/backend/runs/lifecycle/ocr-review-authority.js";
import { createDeterministicContactPersistence } from "../../../../src/backend/systems/ucpath/driver/contact-fake.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../src/backend/systems/ucpath/driver/fake.js";
import { FingerprintSchema, IsoInstantSchema, PositiveIntSchema, StableRecordIdSchema } from "../../../../src/rules/identity/ids.js";
import { EmergencyContactMemberInputSchema } from "../../../../src/models/workflows/emergency-contact-member/input.js";
import { UcpathContactPageSnapshotSchema } from "../../../../src/models/ui/ucpath-emergency-contact.js";
import { PersonLookupInput } from "../../../../src/models/workflows/person-lookup/input.js";
import { SearchPersonOrgOutputSchema, UcpathCandidateSchema } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { composeWorkflowModule, compileWorkflow, defineWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import { bindWorkflowDelegationTargets } from "../../../../src/workflow-kit/workflow.js";
import { buildEmergencyContactRecords } from "../../../../src/workflows/emergency-contact/steps/read-document/step.js";
import { buildEmergencyContactMembers } from "../../../../src/workflows/emergency-contact/steps/members/step.js";
import { emergencyContactWorkflow } from "../../../../src/workflows/emergency-contact/workflow.js";
import { ocrWorkflow } from "../../../../src/workflows/ocr/workflow.js";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { emergencyContactMemberWorkflow } from "../../../../src/workflows/emergency-contact-member/workflow.js";
import { createRetainedApprovedRecordReader, retainedSnapshotContract, retainedSnapshotStore } from "../../../support/fixtures/ocr/retained-approved-records.js";
import { ReadApprovedOcrSnapshot } from "../../../../src/models/processing/ocr/read-approved-snapshot.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";
import { healthyCrmDriver, sessionFactoryHarness } from "../../../support/helpers/phase1f-executor-harness.js";
import contactPage from "../../../support/fixtures/ui/ucpath/emergency-contact.fixture.json";

const contactSaveMember = compileWorkflow(emergencyContactMemberWorkflow);

const world = createOcrReviewWorld();
afterEach(world.cleanup);
// Both the historical and the current OCR definitions are compiled here; only the registered current one authorizes.
const currentRegistry = (id: string) => id === "ocr" ? ocrModule.descriptor : undefined;
const historicalParent = composeWorkflowModule(compileWorkflow(defineWorkflow({ ...emergencyContactWorkflow,
  steps: author => {
    const records = buildEmergencyContactRecords({ ...author,
      task: (identity, references, bind) => author.task({ ...identity,
        contract: identity.contract.id === retainedSnapshotContract.id ? retainedSnapshotContract : identity.contract }, references, bind),
      delegate: (identity, references, binds) => {
      const { sourceRecordIds: _sourceRecordIds, ...originalBinds } = binds;
      return author.delegate(identity, references, identity.id === "members" ? originalBinds : binds);
    } });
    const members = buildEmergencyContactMembers(author, records);
    return { steps: [...records.steps, ...members.steps], result: members.result };
  },
})), taskStoreRegistry.stores.map(store => store.namespace === "ocr" ? retainedSnapshotStore : store));
const historicalOcr = composeWorkflowModule(compileWorkflow({ ...ocrWorkflow, version: ocrWorkflow.version + 1 }), ocrModule.stores);
const historicalMember = composeWorkflowModule(compileWorkflow({ ...contactSaveMember.definition, version: contactSaveMember.definition.version + 1 }), taskStoreRegistry.stores);
bindWorkflowDelegationTargets([historicalParent.descriptor, historicalOcr.descriptor, historicalMember.descriptor,
  ...["ocr-page", "person-lookup", "i9-lookup"].map(id => childWorkflowModuleOf("ocr", id).descriptor), childWorkflowModuleOf("emergency-contact-member", "onbase").descriptor]);

for (const dryRun of [false, true]) {
  it(`reads the full day and restarts a retained approved ${dryRun ? "preview" : "ordinary"} tree with its original record schema and omitted member associations`, async () => {
    const employee = UcpathCandidateSchema.parse({ emplId: "10800000", name: "Example, Avery", department: "Housing Dining Hospitality",
      jobTitle: "Fixture employee", employeeStatus: "active", hdh: true, hrStatus: "Active",
      startDate: "", effectiveDate: "", terminationDate: "", terminationReason: "" });
    const lookup = SearchPersonOrgOutputSchema.parse({ results: [employee],
      selection: { status: "resolved", selected: employee, candidateEids: [employee.emplId] } });
    let ticks = Date.parse(contactPage.page.observedAt);
    const persistence = createDeterministicContactPersistence(UcpathContactPageSnapshotSchema.parse({ ...contactPage.page,
      displayedEid: employee.emplId, displayedName: employee.name }), () => new Date(++ticks).toISOString());
    const sessions = sessionFactoryHarness({ ucpath: () => {
      const session = persistence.session();
      return createDeterministicUcpathPersonOrgDriver(lookup, undefined, session.port, session.save);
    }, crm: () => ({ ...healthyCrmDriver(), async searchOnboardingRecords() { return []; } }) });
    const f = await world.fixture({ coordinator: true, parent: historicalParent, ocr: historicalOcr, member: historicalMember,
      approvedStore: retainedSnapshotStore,
      approvedReader: deps => createRetainedApprovedRecordReader({ ...deps, snapshotContract: retainedSnapshotContract }),
      record: true, pageCount: 1, dryRun, operatorEvidence: true, sessions,
      reviewedPages: [{ employeeName: employee.name, contactName: "Original Contact", correctedContactName: "Released Contact" }],
      screenshotCapture: { capture: async context => { assert.equal(context.screenshot.state, "available"); } } });
    assert.equal(f.canonical.kernel.execute(f.command("correct-ocr-record", 1)).state, "applied");
    assert.equal(f.canonical.kernel.execute(f.approval()).state, "applied");
    const currentResolve = (id: string) => id === "ocr" ? ocrModule.descriptor : id === "emergency-contact" ? workflowModuleOf(id).descriptor
      : id === "emergency-contact-member" ? childWorkflowModuleOf("emergency-contact", id).descriptor : f.resolve(id);
    const unrelatedDescriptor = f.resolve("person-lookup"); assert.ok(unrelatedDescriptor);
    const unrelated = f.canonical.start(unrelatedDescriptor, PersonLookupInput.parse({ emplId: "10800001" }), { dryRun: false });
    const execution = await f.canonical.execute(f.parentRun, new AbortController().signal);
    const settledParent = execution.run;
    assert.ok(settledParent?.lifecycle.state === "terminal" && settledParent.lifecycle.outcome === "done");
    const native = f.database.authority.dependencies.groups(f.parentRun.envelope.runId).find(({ group }) => group.invocation.nodeId === "members");
    assert.ok(native); assert.equal(native.group.children.length, 1);
    assert.deepEqual(native.group.invocation.children.map(child => child.sourceRecordIds), [undefined]);
    const originalCheckpoint = f.database.authority.runCheckpoints.listByAttempt(settledParent.envelope.workflow,
      settledParent.envelope.itemId, "approved-records", settledParent.envelope.attempt).at(-1); assert.ok(originalCheckpoint);
    assert.equal(originalCheckpoint.output.schemaHash, "3f30e5be6d79b02b1627bc914aa9bd76021abf4d82e069058a98c1cbcb3704b1");
    assert.equal(originalCheckpoint.output.schemaHash, deriveSchemaHash(retainedSnapshotContract.output, "output"));
    assert.notEqual(originalCheckpoint.output.schemaHash, deriveSchemaHash(ReadApprovedOcrSnapshot.output, "output"));
    const member = native.group.children[0]; assert.ok(member);
    const input = EmergencyContactMemberInputSchema.parse(member.child.input.parsed.value);
    assert.equal(input.approval.sourceRunId, f.run.envelope.runId);
    assert.equal(input.record.assertedEid, employee.emplId);
    for (const run of [f.parentRun, f.run, member.child]) {
      assert.notEqual(run.envelope.contractFingerprint, currentResolve(run.envelope.workflow)?.contractFingerprint);
    }
    const authorityBefore = { generation: f.database.getMeta().authorityGeneration,
      parent: f.database.authority.runs.get(f.parentRun.envelope.runId), ocr: f.database.authority.runs.get(f.run.envelope.runId),
      groups: f.database.authority.dependencies.groups(f.parentRun.envelope.runId),
      snapshots: f.database.authority.ocrReviews.snapshots(f.run.envelope.runId), result: f.database.authority.runResults.get(member.child.envelope.runId) };
    const projection = createOperatorProjection({ database: f.database, stateRoot: f.harness.authority.stateRoot, clock: f.clock,
      reader: f.canonical.lifecycle, appVersion: "0.1.0", descriptorSetHash: FingerprintSchema.parse("a".repeat(64)),
      ledger: createTransactionHistory(f.database.authority), descriptors: { resolve: currentResolve } });
    projection.ingestFromTimeline();
    const wire = projection.buildDashboardDayWire(f.clock.todayLocal());
    assert.ok(wire.queueSurfaces.some(row => row.runId === unrelated.envelope.runId));
    const row = wire.queueSurfaces.find(row => row.runId === f.parentRun.envelope.runId); assert.ok(row);
    assert.equal(row.surfaceKind, "operation"); if (row.surfaceKind !== "operation") assert.fail("Missing retained parent");
    const records = row.recordMembers; assert.ok(records); assert.equal(records.members.length, 1);
    const record = records.members[0]; assert.ok(record?.kind === "record");
    assert.equal(record.record.recordId, input.record.recordId);
    assert.equal(record.statusLabel, dryRun ? "Previewed" : "Done");
    assert.equal(record.target.runId, member.child.envelope.runId);
    assert.deepEqual(record.childRunIds.filter(id => member.history.includes(id)), member.history);
    assert.ok(record.childRunIds.some(id => f.database.authority.runs.get(id)?.envelope.workflow === "ocr-page"));
    assert.ok(!["Verified", "Saved"].includes(record.statusLabel));
    const exactRows = f.database.withAuthorityReadSnapshot(() => readQueueRecordMembers(f.database.authority, f.canonical.lifecycle,
      settledParent, f.database.authority.runs.listChildren(f.parentRun.envelope.runId), f.resolve));
    assert.deepEqual(exactRows?.members.map(member => member.statusLabel), [dryRun ? "Previewed" : "Saved"]);
    assert.deepEqual(exactRows?.members.map(member => member.childRunIds), records.members.map(member => member.childRunIds));
    assert.deepEqual(projection.buildDashboardDayWire(f.clock.todayLocal()), wire);
    assert.throws(() => f.database.withAuthorityReadSnapshot(() => requireCurrentOcrSnapshot(f.database.authority, f.canonical.lifecycle, input.approval, currentRegistry)), /OCR_REVIEW_REFUSED/u);
    const readQuery = (repositories: AuthorityRepositories) => f.database.withAuthorityReadSnapshot(() => readQueueRecordMembers(repositories,
      f.canonical.lifecycle, settledParent, f.database.authority.runs.listChildren(f.parentRun.envelope.runId), currentResolve));
    const readWith = (groups: typeof authorityBefore.groups) => readQuery({ ...f.database.authority,
      dependencies: { ...f.database.authority.dependencies, groups: (...args) => args[0] === f.parentRun.envelope.runId ? groups : f.database.authority.dependencies.groups(...args) } });
    const foreignRecordId = StableRecordIdSchema.parse(`${"f".repeat(64)}#emergency-contact#1`);
    for (const wrong of [[foreignRecordId], [input.record.recordId, input.record.recordId], []]) {
      assert.throws(() => readWith(authorityBefore.groups.map(entry => entry.group.invocation.nodeId !== "members" ? entry : { ...entry,
        group: { ...entry.group, invocation: { ...entry.group.invocation, children: entry.group.invocation.children.map(child => ({ ...child, sourceRecordIds: wrong })) } } })), /OCR_REVIEW_REFUSED/u);
    }
    for (const replacement of [{ ...input, approval: { ...input.approval, snapshotId: unrelated.envelope.runId } },
      { ...input, approval: { ...input.approval, sourceRunId: unrelated.envelope.runId } },
      { ...input, record: { ...input.record, recordId: foreignRecordId } }]) {
      assert.throws(() => readWith(authorityBefore.groups.map(entry => entry.group.invocation.nodeId !== "members" ? entry : { ...entry,
        group: { ...entry.group, children: entry.group.children.map(child => ({ ...child, child: { ...child.child,
          input: { ...child.child.input, parsed: { ...child.child.input.parsed, value: replacement } } } })) } })), /OCR_REVIEW_REFUSED/u);
    }
    const checkpoints = f.database.authority.runCheckpoints;
    assert.throws(() => readQuery({ ...f.database.authority, runCheckpoints: { ...checkpoints,
      listByAttempt: (...args) => checkpoints.listByAttempt(...args).map(checkpoint => checkpoint.nodeId !== "approved-records" ? checkpoint : {
        ...checkpoint, output: { ...checkpoint.output, value: { snapshot: { ...authorityBefore.snapshots[0], sourceRunId: unrelated.envelope.runId } } },
      }),
    } }), /OCR_REVIEW_REFUSED/u);
    for (const altered of [
      { ...originalCheckpoint, output: { ...originalCheckpoint.output, schemaHash: deriveSchemaHash(ReadApprovedOcrSnapshot.output, "output") } },
      { ...originalCheckpoint, output: { ...originalCheckpoint.output, schemaHash: FingerprintSchema.parse("e".repeat(64)) } },
      { ...originalCheckpoint, runId: unrelated.envelope.runId },
      { ...originalCheckpoint, contractFingerprint: FingerprintSchema.parse("e".repeat(64)) },
    ]) {
      assert.throws(() => readQuery({ ...f.database.authority, runCheckpoints: { ...checkpoints,
        listByAttempt: (...args) => checkpoints.listByAttempt(...args).map(checkpoint => checkpoint.nodeId === "approved-records" ? altered : checkpoint),
      } }), /delegation|OCR_REVIEW_REFUSED/u);
    }
    assert.throws(() => readQuery({ ...f.database.authority, runCheckpoints: { ...checkpoints,
      listByAttempt: (...args) => checkpoints.listByAttempt(...args).filter(checkpoint => checkpoint.nodeId !== "approved-records"),
    } }), /delegation|OCR_REVIEW_REFUSED/u);
    assert.throws(() => readWith(authorityBefore.groups.map(entry => entry.group.invocation.nodeId !== "members" ? entry : { ...entry,
      group: { ...entry.group, invocation: { ...entry.group.invocation, approvalDigest: FingerprintSchema.parse("e".repeat(64)) } },
    })), /OCR_REVIEW_REFUSED/u);
    const timeline = f.database.authority.timelineEvents;
    for (const mutation of ["missing", "digest", "foreign-run", "workflow", "clock", "claim", "kind"] as const) {
      assert.throws(() => readQuery({ ...f.database.authority, timelineEvents: { ...timeline, get: id => {
        const event = timeline.get(id);
        if (event?.payload.kind !== "checkpoint-recorded" || event.payload.checkpoint.nodeId !== "approved-records") return event;
        if (mutation === "missing") return undefined;
        if (mutation === "digest") return { ...event, payload: { ...event.payload, checkpoint: { ...event.payload.checkpoint,
          outputDigest: FingerprintSchema.parse("e".repeat(64)) } } };
        if (mutation === "foreign-run") return { ...event, scope: { kind: "run", runId: unrelated.envelope.runId },
          payload: { ...event.payload, runId: unrelated.envelope.runId } };
        if (mutation === "workflow") return { ...event, workflow: unrelated.envelope.workflow };
        if (mutation === "clock") return { ...event, occurredAt: IsoInstantSchema.parse("2026-01-01T00:00:00.000Z") };
        if (mutation === "claim") return { ...event, payload: { ...event.payload, claimGeneration: PositiveIntSchema.parse(event.payload.claimGeneration + 1) } };
        return { ...event, payload: { ...event.payload, kind: "checkpoint-replayed" } };
      } } }), /OCR_REVIEW_REFUSED/u);
    }
    const runs = f.database.authority.runs;
    assert.throws(() => readQuery({ ...f.database.authority, runs: { ...runs,
      get: runId => runId === f.run.envelope.runId ? unrelated : runs.get(runId),
    } }), /delegation|OCR_REVIEW_REFUSED/u);
    assert.deepEqual({ generation: f.database.getMeta().authorityGeneration,
      parent: f.database.authority.runs.get(f.parentRun.envelope.runId), ocr: f.database.authority.runs.get(f.run.envelope.runId),
      groups: f.database.authority.dependencies.groups(f.parentRun.envelope.runId),
      snapshots: f.database.authority.ocrReviews.snapshots(f.run.envelope.runId), result: f.database.authority.runResults.get(member.child.envelope.runId) }, authorityBefore);
    await f.harness.manager.closeAll("worker-stop"); f.database.close();
    const reopened = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 500, migrationOwner: "retained-approved-parent-read" }, f.clock,
      undefined, undefined, undefined, boundProfileCredentials(f.admission));
    f.harness.authority.replaceClosedDatabase(reopened);
    const currentReader = new RunRecordService({ database: reopened, clock: f.clock, ids: { uuid: randomUUID }, resolveDescriptor: currentResolve,
      publishQueued: () => { throw new Error("retained-parent-read-is-readonly"); } });
    const generation = reopened.getMeta().authorityGeneration;
    const resumedProjection = createOperatorProjection({ database: reopened, stateRoot: f.harness.authority.stateRoot, clock: f.clock,
      reader: currentReader, appVersion: "0.1.0", descriptorSetHash: FingerprintSchema.parse("a".repeat(64)),
      ledger: createTransactionHistory(reopened.authority), descriptors: { resolve: currentResolve } });
    resumedProjection.ingestFromTimeline();
    assert.deepEqual(resumedProjection.buildDashboardDayWire(f.clock.todayLocal()).queueSurfaces, wire.queueSurfaces);
    assert.deepEqual(reopened.authority.runCheckpoints.listByAttempt(settledParent.envelope.workflow,
      settledParent.envelope.itemId, "approved-records", settledParent.envelope.attempt).at(-1), originalCheckpoint);
    assert.deepEqual(reopened.authority.ocrReviews.snapshots(f.run.envelope.runId), authorityBefore.snapshots);
    assert.deepEqual(reopened.authority.dependencies.groups(f.parentRun.envelope.runId), authorityBefore.groups);
    assert.deepEqual(reopened.authority.runResults.get(member.child.envelope.runId), authorityBefore.result);
    assert.equal(reopened.getMeta().authorityGeneration, generation);
    assert.throws(() => reopened.withAuthorityReadSnapshot(() => requireCurrentOcrSnapshot(reopened.authority,
      currentReader, input.approval, currentRegistry)), /OCR_REVIEW_REFUSED/u);
  });
}
