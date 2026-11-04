import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { createOperatorProjection } from "../../../../src/backend/app/composition/dashboard/queue.js";
import { childWorkflowModuleOf, ocrModule, workflowModuleOf } from "../../../../src/backend/app/registries/workflow-registry.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import type { AuthorityRepositories } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { readQueueRecordMembers } from "../../../../src/backend/runs/queries/ocr-record-members.js";
import { requireCurrentOcrSnapshot } from "../../../../src/backend/runs/lifecycle/ocr-review-authority.js";
import { createDeterministicContactPersistence } from "../../../../src/backend/systems/ucpath/driver/contact-fake.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../src/backend/systems/ucpath/driver/fake.js";
import { parseBuildManifest } from "../../../../src/models/workflow/build-manifest.js";
import { FingerprintSchema, StableRecordIdSchema } from "../../../../src/rules/identity/ids.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { EmergencyContactMemberInputSchema } from "../../../../src/models/workflows/emergency-contact-member/input.js";
import { UcpathContactPageSnapshotSchema } from "../../../../src/models/ui/ucpath-emergency-contact.js";
import { PersonLookupInput } from "../../../../src/models/workflows/person-lookup/input.js";
import { SearchPersonOrgOutputSchema, UcpathCandidateSchema } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { composeWorkflowModule, compileWorkflow, defineWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import { bindWorkflowDelegationTargets } from "../../../../src/workflow-kit/workflow.js";
import { BUILD_MANIFEST } from "../../../../src/workflow-kit/validation/build-manifest.js";
import { buildEmergencyContactRecords } from "../../../../src/workflows/emergency-contact/steps/read-document/step.js";
import { buildEmergencyContactMembers } from "../../../../src/workflows/emergency-contact/steps/members/step.js";
import { emergencyContactWorkflow } from "../../../../src/workflows/emergency-contact/workflow.js";
import { ocrWorkflow } from "../../../../src/workflows/ocr/workflow.js";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { emergencyContactMemberWorkflow } from "../../../../src/workflows/emergency-contact-member/workflow.js";
import { createRetainedApprovedRecordReader } from "../../../support/fixtures/ocr/retained-approved-records.js";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";
import { healthyCrmDriver, sessionFactoryHarness } from "../../../support/helpers/phase1f-executor-harness.js";
import contactPage from "../../../support/fixtures/ui/ucpath/emergency-contact.fixture.json";

const contactSaveMember = compileWorkflow(emergencyContactMemberWorkflow);

const world = createOcrReviewWorld();
afterEach(world.cleanup);
const historicalIds = new Set(["emergency-contact", "ocr", "emergency-contact-member"]);
const manifest = parseBuildManifest({ ...BUILD_MANIFEST, workflows: BUILD_MANIFEST.workflows.map(entry => historicalIds.has(entry.id)
  ? { ...entry, fingerprint: sha256Hex(`retained-approved-records:${entry.id}`) } : entry) });
const historicalParent = composeWorkflowModule(compileWorkflow(defineWorkflow({ ...emergencyContactWorkflow,
  steps: author => {
    const records = buildEmergencyContactRecords({ ...author, delegate: (identity, references, binds) => {
      const { sourceRecordIds: _sourceRecordIds, ...originalBinds } = binds;
      return author.delegate(identity, references, identity.id === "members" ? originalBinds : binds);
    } });
    const members = buildEmergencyContactMembers(author, records);
    return { steps: [...records.steps, ...members.steps], result: members.result };
  },
}), { manifest }), taskStoreRegistry.stores);
const historicalOcr = composeWorkflowModule(compileWorkflow({ ...ocrWorkflow }, { manifest }), ocrModule.stores);
const historicalMember = composeWorkflowModule(compileWorkflow({ ...contactSaveMember.definition }, { manifest }), taskStoreRegistry.stores);
bindWorkflowDelegationTargets([historicalParent.descriptor, historicalOcr.descriptor, historicalMember.descriptor,
  ...["ocr-page", "person-lookup", "i9-lookup"].map(id => childWorkflowModuleOf("ocr", id).descriptor)]);

for (const dryRun of [false, true]) {
  it(`reads the full day with a retained approved ${dryRun ? "preview" : "ordinary"} tree and original omitted member associations`, async () => {
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
      buildManifest: manifest, approvedReader: createRetainedApprovedRecordReader,
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
    const member = native.group.children[0]; assert.ok(member);
    const input = EmergencyContactMemberInputSchema.parse(member.child.input.parsed.value);
    assert.equal(input.approval.sourceRunId, f.run.envelope.runId);
    assert.equal(input.record.assertedEid, employee.emplId);
    for (const run of [f.parentRun, f.run, member.child]) {
      assert.equal(run.envelope.contractFingerprint, manifest.workflows.find(entry => entry.id === run.envelope.workflow)?.fingerprint);
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
    assert.throws(() => f.database.withAuthorityReadSnapshot(() => requireCurrentOcrSnapshot(f.database.authority, f.canonical.lifecycle, input.approval)), /OCR_REVIEW_REFUSED/u);
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
    const runs = f.database.authority.runs;
    assert.throws(() => readQuery({ ...f.database.authority, runs: { ...runs,
      get: runId => runId === f.run.envelope.runId ? unrelated : runs.get(runId),
    } }), /delegation|OCR_REVIEW_REFUSED/u);
    assert.deepEqual({ generation: f.database.getMeta().authorityGeneration,
      parent: f.database.authority.runs.get(f.parentRun.envelope.runId), ocr: f.database.authority.runs.get(f.run.envelope.runId),
      groups: f.database.authority.dependencies.groups(f.parentRun.envelope.runId),
      snapshots: f.database.authority.ocrReviews.snapshots(f.run.envelope.runId), result: f.database.authority.runResults.get(member.child.envelope.runId) }, authorityBefore);
  });
}
