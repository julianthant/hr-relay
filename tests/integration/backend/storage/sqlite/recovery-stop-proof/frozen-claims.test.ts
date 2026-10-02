import assert from "node:assert/strict";
import { it } from "vitest";
import { join } from "node:path";
import { renameSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { archiveFixture, attachFile } from "../../../../../support/helpers/archive-transfer/fixtures.js";
import { ArchiveReportSchema } from "../../../../../../src/models/archive/report.js";
import { ArchiveDatabase } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { AuthorityDatabase } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { backupStoppedAuthority } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { restoreLifecyclePair, verifyLifecyclePair } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { RecoveryStopProofStore } from "../../../../../../src/backend/storage/sqlite/recovery-stop-proof.js";
import { observeRuntimeLockSnapshot } from "../../../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { admission } from "../../../../../support/helpers/storage/provider-accounting-fixtures.js";
import { createGenericProviderAccounting } from "../../../../../../src/backend/storage/sqlite/provider-accounting.js";
import { GenericProviderUsageSchema } from "../../../../../../src/rules/providers/provider-accounting.js";

it("freezes source and display before any report publication, survives shared updates, and releases temporary captures", () => {
  const f = archiveFixture();
  try {
    const accounting = createGenericProviderAccounting(f.database.authority.providerAccounting);
    assert.equal(accounting.reserve(admission(f.base)).state, "reserved");
    const usage = f.database.authority.providerAccounting.listUsage()[0]; assert.ok(usage);
    f.terminal(); const row = f.plan(), request = f.applyRequest(row);
    f.failAfter("readPendingReport");
    assert.throws(() => f.kernel.execute(request), /injected-readPendingReport/u);
    const capture = f.database.readVersionChange(row.changeId)?.pendingCaptures?.[0]; assert.ok(capture);
    const frozen = ArchiveReportSchema.parse(JSON.parse(capture.reportJson));
    const archive = new ArchiveDatabase(join(f.base.root, "archive.sqlite"), {readOnly:true});
    try { assert.equal(archive.read(capture.runId), undefined); } finally { archive.close(); }
    f.database.authority.providerAccounting.transaction(store => store.writeUsage(GenericProviderUsageSchema.parse({ ...usage, version:2, cumulative:{kind:"measured",value:1} }), 1));
    f.reopen();
    assert.equal(f.kernel.execute(request).state, "applied");
    assert.deepEqual(f.database.lifecycleArchive(true).readPublished(capture.runId), frozen);
    assert.equal(f.database.readVersionChange(row.changeId)?.pendingCaptures, undefined);
    assert.equal(f.kernel.execute(request).state, "already-applied");
  } finally { f.dispose(); }
});

it("backs up and restores claim-owned attachment bytes before archive row publication", async () => {
  const f = archiveFixture();
  try {
    const {file, bytes} = attachFile(f.database, f.base.root, f.base.run.envelope.runId, 89100);
    f.terminal(); const row = f.plan(), request = f.applyRequest(row);
    f.failAfter("readPendingReport");
    assert.throws(() => f.kernel.execute(request), /injected-readPendingReport/u);
    const capture = f.database.readVersionChange(row.changeId)?.pendingCaptures?.[0]; assert.ok(capture);
    f.database.close();
    const backup = await backupStoppedAuthority(f.base.root, f.base.clock);
    assert.ok("pairedManifestPath" in backup);
    const verified = await verifyLifecyclePair(backup.pairedManifestPath);
    assert.equal(verified.pair.files.some(value => value.digest === file.digest), true);
    const manifestBytes = readFileSync(backup.pairedManifestPath);
    writeFileSync(backup.pairedManifestPath, JSON.stringify({...verified.pair, files:[]}));
    await assert.rejects(verifyLifecyclePair(backup.pairedManifestPath), /lifecycle-backup-file-membership-mismatch/u);
    writeFileSync(backup.pairedManifestPath, manifestBytes);
    renameSync(join(f.base.root,"archive-files"), join(f.base.root,"quarantined-files"));
    const processLockRoot = join(f.base.root,"locks"), sourceDatabaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(f.base.path);
    const proofs = new RecoveryStopProofStore({processLockRoot,maxProofAgeMs:60000},f.base.clock);
    proofs.recordRuntimeState(observeRuntimeLockSnapshot({processLockRoot,sourceDatabaseIdentity}, f.base.clock));
    await restoreLifecyclePair({authorityPath:f.base.path,suspectDirectory:join(f.base.root,"suspects"),busyTimeoutMs:500,processLockRoot,stoppedProofMaxAgeMs:60000},
      {manifestPath:backup.pairedManifestPath,stoppedSystemProof:proofs.issue({observedBy:"local-operator",sourceDatabaseIdentity})},async()=>{},f.base.clock);
    assert.deepEqual(readFileSync(join(f.base.root,"archive-files",file.digest)),bytes);
    f.reopen();
    assert.equal(f.kernel.execute(request).state,"applied");
    assert.deepEqual(f.database.lifecycleArchive(true).readPublished(capture.runId),ArchiveReportSchema.parse(JSON.parse(capture.reportJson)));
  } finally { f.dispose(); }
});

for (const published of [false,true]) it(`supports an admitted older claim with exact source or captured proof; published=${String(published)}`, () => {
  const f=archiveFixture();
  try {
    f.terminal(); const row=f.plan(),request=f.applyRequest(row);
    f.failAfter(published ? "saveReport" : "readPendingReport");
    assert.throws(()=>f.kernel.execute(request),/injected-/u);
    f.database.close();
    const raw=new DatabaseSync(f.base.path);
    try { raw.prepare("UPDATE version_changes SET record_json=json_remove(record_json,'$.pendingCaptures') WHERE record_key=?").run(row.changeId); } finally {raw.close();}
    f.reopen();
    assert.equal(f.kernel.execute(request).state,"applied");
  } finally { f.dispose(); }
});

import { foundationFixture, id, NOW, HASH } from "../../../../../support/helpers/database-foundation/fixtures.js";
import { captureArchiveReport } from "../../../../../../src/backend/storage/archive/report-capture.js";
import { transferArchiveReport } from "../../../../../../src/backend/storage/archive/archive-transfer.js";
import { createRunLifecycleStorage } from "../../../../../support/helpers/integration/lifecycle-storage.js";
import { RunRecordSchema } from "../../../../../../src/models/run/record.js";
import { VersionChangeSchema, archiveVersionChange, versionChangeReviewFingerprint } from "../../../../../../src/models/archive/change-record.js";
import { canonicalJsonStringify } from "../../../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../../../src/rules/validation/sha256.js";
import { lifecycleSourceDigest } from "../../../../../../src/models/archive/lifecycle-source.js";
import { deriveStableUuid } from "../../../../../../src/rules/identity/identifiers.js";
import { currentAtomicWriteFixture, atomicWriteCheckpoint, seedAtomicWriteOwner } from "../../../../../support/helpers/timeline-write-fixture.js";
import { ATOMIC_WRITE_COMMIT, WRITE_INTENT_ATTEMPTING, WRITE_ATTEMPT } from "../../../../../support/fixtures/phase1c-contract-fixtures.js";

it("allows a prepared shared-item operation to settle while a frozen prior run awaits transfer", () => {
  const base=foundationFixture();
  const database=AuthorityDatabase.open({path:join(base.root,"settlement.db"),busyTimeoutMs:500,migrationOwner:"synthetic-settlement"},base.clock);
  const f={database,dispose(){database.close();base.dispose();}};
  try {
    const commit=currentAtomicWriteFixture(ATOMIC_WRITE_COMMIT);
    seedAtomicWriteOwner(f.database,commit);
    f.database.authority.writeIntents.fenceAttempt({intent:WRITE_INTENT_ATTEMPTING,attempt:WRITE_ATTEMPT});
    const owner=f.database.authority.runs.get(commit.transaction.runId); assert.ok(owner);
    const prior=RunRecordSchema.parse({...owner,envelope:{...owner.envelope,runId:id(89200),attempt:2},lifecycle:{state:"queued"},claimGeneration:0,version:1});
    f.database.authority.runs.enqueue(prior);
    f.database.authority.runs.transition({runId:prior.envelope.runId,expectedVersion:1,lifecycle:{state:"terminal",outcome:"cancelled",endedAt:NOW},now:NOW});
    const storage=createRunLifecycleStorage(f.database),snapshot=storage.capture(prior.envelope.runId);
    assert.equal(snapshot.records.find(group=>group.table==="run_operations")?.rows.length,1);
    const members=[{runId:prior.envelope.runId,version:snapshot.run.version,sourceDigest:lifecycleSourceDigest(snapshot)}];
    const review={changeId:id(89201),actorId:"local-operator",reviewedAt:NOW,
      change:{kind:"major" as const,what:"Synthetic prior run",why:"Independent operation settlement",commit:{state:"absent" as const,reason:"test"}},
      scope:{kind:"workflows" as const,workflowIds:[prior.envelope.workflow]},observedAppVersion:"0.1.0",targetVersion:"2.0.0",
      targets:[{workflow:prior.envelope.workflow,version:2,fingerprint:HASH}],members,blockers:[],membershipDigest:sha256Hex(canonicalJsonStringify(members))};
    const row=VersionChangeSchema.parse({...review,schemaVersion:2,reviewFingerprint:versionChangeReviewFingerprint(review),state:"planned",completedRunIds:[]});
    storage.writeVersionChange(row);
    const claimed=VersionChangeSchema.parse({...row,state:"applying",application:{commandId:id(89202),actorId:"local-operator",startedAt:NOW,appVersion:"0.1.0",targets:row.targets}});
    const report=captureArchiveReport({snapshot,transferId:deriveStableUuid("archive-transfer",`${row.changeId}:${prior.envelope.runId}`),capturedAt:NOW,versionChange:archiveVersionChange(claimed),sections:[],files:[]});
    storage.claimVersionChange({changeId:row.changeId,reviewFingerprint:row.reviewFingerprint,application:claimed.application!,pendingCaptures:[{runId:prior.envelope.runId,reportJson:canonicalJsonStringify(report)}]});
    f.database.commitWriteAttempt(commit,atomicWriteCheckpoint(commit));
    assert.equal(f.database.authority.writeIntents.get(commit.writeIntentId)?.status,"committed");
    assert.deepEqual(transferArchiveReport(storage,report,snapshot.run.version),report);
    assert.equal(f.database.authority.writeIntents.get(commit.writeIntentId)?.status,"committed");
    assert.ok(f.database.authority.runs.get(owner.envelope.runId));
  } finally { f.dispose(); }
});

it("retains shared attachment custody when another report is deleted before pending capture publication", () => {
  const f=archiveFixture();
  try {
    const first=attachFile(f.database,f.base.root,f.base.run.envelope.runId,89300);
    f.terminal(); assert.equal(f.kernel.execute(f.applyRequest(f.plan())).state,"applied");
    const other=f.base.createRun(id(89302));
    attachFile(f.database,f.base.root,other.envelope.runId,89310,first.bytes);
    f.database.authority.runs.transition({runId:other.envelope.runId,expectedVersion:other.version,lifecycle:{state:"terminal",outcome:"cancelled",endedAt:NOW},now:NOW});
    const row=f.plan(),request=f.applyRequest(row);
    f.failAfter("readPendingReport");assert.throws(()=>f.kernel.execute(request),/injected-readPendingReport/u);
    f.database.authority.runs.delete({runId:f.base.run.envelope.runId,origin:"archive",commandId:id(89320),now:NOW});
    f.database.settleArchivedDeletion(f.base.run.envelope.runId);
    assert.deepEqual(readFileSync(join(f.base.root,"archive-files",first.file.digest)),first.bytes);
    f.reopen();assert.equal(f.kernel.execute(request).state,"applied");
    assert.ok(f.database.lifecycleArchive(true).readPublished(other.envelope.runId));
  } finally { f.dispose(); }
});

it("refuses unprovable older capture history by name while preserving its live recovery assets", () => {
  const f=archiveFixture();
  try {
    const accounting=createGenericProviderAccounting(f.database.authority.providerAccounting);
    assert.equal(accounting.reserve(admission(f.base)).state,"reserved");
    const usage=f.database.authority.providerAccounting.listUsage()[0];assert.ok(usage);
    f.terminal(); const row=f.plan(),request=f.applyRequest(row);
    f.failAfter("readPendingReport");assert.throws(()=>f.kernel.execute(request),/injected-readPendingReport/u);
    f.database.close();
    const raw=new DatabaseSync(f.base.path);
    try {raw.prepare("UPDATE version_changes SET record_json=json_remove(record_json,'$.pendingCaptures') WHERE record_key=?").run(row.changeId);} finally {raw.close();}
    f.reopen();
    assert.throws(()=>attachFile(f.database,f.base.root,f.base.run.envelope.runId,89400),/archive-source-applying/u);
    f.database.authority.providerAccounting.transaction(store=>store.writeUsage(GenericProviderUsageSchema.parse({...usage,version:2,cumulative:{kind:"measured",value:1}}),1));
    assert.throws(()=>f.kernel.execute(request),/archive-claim-source-unprovable/u);
    assert.ok(f.database.authority.runs.get(f.base.run.envelope.runId));
    assert.equal(f.database.readVersionChange(row.changeId)?.state,"applying");
    assert.equal(f.database.lifecycleArchive(true).read(f.base.run.envelope.runId),undefined);
  } finally {f.dispose();}
});

import { sealArchiveReport } from "../../../../../../src/models/archive/report.js";
for (const step of ["retainFile","claimVersionChange"]) it(`rolls back an interrupted ${step} before durable claim publication`, () => {
  const f=archiveFixture();
  try {
    attachFile(f.database,f.base.root,f.base.run.envelope.runId,89500);
    f.terminal();const row=f.plan(),request=f.applyRequest(row);
    f.failAfter(step);assert.throws(()=>f.kernel.execute(request),/injected-/u);
    assert.equal(f.database.readVersionChange(row.changeId)?.state,"planned");
    assert.equal(f.database.readVersionChange(row.changeId)?.pendingCaptures,undefined);
    assert.equal(f.database.lifecycleArchive(true).read(f.base.run.envelope.runId),undefined);
    f.reopen();assert.equal(f.kernel.execute(request).state,"applied");
  } finally {f.dispose();}
});

it("refuses replacement or premature removal of an authenticated pending capture without changing authority", () => {
  const f=archiveFixture();
  try {
    f.terminal();const row=f.plan(),request=f.applyRequest(row);
    f.failAfter("readPendingReport");assert.throws(()=>f.kernel.execute(request),/injected-/u);
    const claimed=f.database.readVersionChange(row.changeId);assert.ok(claimed?.pendingCaptures?.[0]);
    const capture=claimed.pendingCaptures[0],report=ArchiveReportSchema.parse(JSON.parse(capture.reportJson));
    const changed=sealArchiveReport({...report.content,sections:[{kind:"text",title:"Divergent",text:"Not the claim-time display"}]});
    const generation=f.database.getMeta().authorityGeneration;
    assert.throws(()=>f.database.writeVersionChange({...claimed,pendingCaptures:[{...capture,reportJson:canonicalJsonStringify(changed)}]}),/version-change-capture-conflict/u);
    assert.throws(()=>f.database.writeVersionChange({...claimed,pendingCaptures:[]}),/version-change-contract-invalid/u);
    const {pendingCaptures,...withoutCapture}=claimed;void pendingCaptures;
    assert.throws(()=>f.database.writeVersionChange(withoutCapture),/version-change-capture-conflict/u);
    assert.equal(f.database.getMeta().authorityGeneration,generation);
    assert.deepEqual(f.database.readVersionChange(row.changeId),claimed);
    assert.equal(f.kernel.execute(request).state,"applied");
    assert.deepEqual(f.database.lifecycleArchive(true).readPublished(capture.runId),report);
  } finally {f.dispose();}
});
