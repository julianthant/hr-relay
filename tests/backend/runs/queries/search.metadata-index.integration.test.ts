import { afterAll, it, vi } from "vitest";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { deriveWriteBindingProofDigest } from "../../../../src/rules/write-safety/write-safety.js";
import { fenceWriteFixture } from "../../../support/helpers/write-fence-fixture.js";
import { WRITE_INTENT_ATTEMPTING, WRITE_ATTEMPT, CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { deriveWriteAuthorityReason } from "../../../../src/rules/write-safety/write-authority-reason.js";
import { releaseSeededWriteOwners } from "../../../support/helpers/timeline-write-fixture.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { runRecordColumns } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import { testWorkerLifetime, testAdmittedWorker } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createCrossDateSearchService } from "../../../../src/backend/runs/queries/search.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { SearchPersonOrgOutputSchema } from "../../../../src/models/systems/ucpath/search-person-org.js";
import { deriveDiagnosticContentDigest } from "../../../../src/models/trust/diagnostic-capture.js";
import { DiagnosticBundleSchema } from "../../../../src/models/trust/diagnostic.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { runRecordOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { failure,HASH,NOW } from "../../../support/helpers/database-foundation/fixtures.js";
import { createSubjectTitleTestWorld } from "../../../support/helpers/backend/subject-title-world.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const profileFixtures = createProfileFixtureSet();
afterAll(() => profileFixtures.close());

async function fixture() {
  const profile = await profileFixtures.create();
  const root = profile.stateRoot, path = profile.path;
  const clock = manualClock(new Date("2026-09-21T12:00:00Z"));
  let db = AuthorityDatabase.open({ path, busyTimeoutMs: 500, migrationOwner: "search-test" }, clock);
  db.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  const service = () => createCrossDateSearchService({ clock, sourceIdentity: db.getSourceDatabaseIdentity(), cursorSigningKey: new Uint8Array(32).fill(9),
    descriptors: { resolve: () => undefined }, authority: { readSnapshot: read => db.withAuthorityReadSnapshot(() => read({
      authorityGeneration: db.getMeta().authorityGeneration, searchRuns: input => db.authority.runs.search(input),
    })) } });
  return { root, path, clock, get db(){return db;}, service, reopen(){releaseSeededWriteOwners(db, clock.now().toISOString());db.close();db=AuthorityDatabase.open({path,busyTimeoutMs:500,migrationOwner:"search-reopen"},clock);}, async dispose() { releaseSeededWriteOwners(db, clock.now().toISOString()); db.close(); await profile.close(); } };
}

it("searches registered and historical workflow metadata without exposing raw inputs or inventing actors", async () => {
  const f = await fixture();
  try {
    for (const [seed, workflow, shape] of [[1001, "person-lookup", "single"], [1002, "historical-workflow", "preview"], [1003, "separations", "operation"], [1004,"historical-workflow","operation-member"]] as const) {
      f.db.authority.runs.enqueue(runRecordOf({ seed, workflow, shape, dryRun: true, displayName: "PRIVATE SUBJECT MUST NOT MATCH", enqueuedAt: "2026-09-20T17:00:00Z" }));
    }
    const search = f.service();
    const all = search.search({ q: "", facets: { from: "2026-09-20", to: "2026-09-20" } });
    assert.equal(all.totalMatches, 4);
    assert.deepEqual(all.coverage, { matched: 4, subjectUnavailable: 4, actorUnavailable: 4, candidateLimit: 10000 });
    assert.equal(search.search({ q: "PRIVATE SUBJECT" }).totalMatches, 0);
    assert.equal(search.search({ q: "", facets: { workflow: "historical-workflow", shape: "preview", state: "queued", dryRun: true, version: 1, evidence: "none" } }).totalMatches, 1);
    assert.equal(search.search({ q: "historical" }).results[0]?.registration.state, "unregistered");
    assert.ok(all.results.every(row => row.metadata.actor.state === "unavailable"));
  } finally { await f.dispose(); }
});

it("refuses tampered metadata even for nonmatching queries; resumes bounded rebuilds across reopen", async () => {
  const f = await fixture();
  try {
    for (let seed = 1101; seed < 1105; seed++) f.db.authority.runs.enqueue(runRecordOf({ seed, workflow: "person-lookup" }));
    const raw = new DatabaseSync(f.path);
    try { raw.exec("UPDATE run_search SET workflow='forged'"); } finally { raw.close(); }
    assert.throws(() => f.service().search({ q: "no-match" }), /run-search-index-rebuild-required/);
    const first = f.db.rebuildRunSearchIndex({ restart: true, limit: 2 });
    assert.equal(first.state, "building"); assert.equal(first.rowCount, 2);
    assert.throws(() => f.service().search({ q: "person" }), /run-search-index-rebuild-required/);
    const peer = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 500, migrationOwner: "search-resume" }, f.clock);
    try { assert.equal(peer.rebuildRunSearchIndex({ limit: 2 }).state, "published"); } finally { peer.close(); }
    assert.equal(f.service().search({ q: "person" }).totalMatches, 4);
    assert.throws(() => f.db.withAuthorityTransaction(() => { f.db.rebuildRunSearchIndex({ restart: true, limit: 1 }); throw new Error("interrupt"); }), /interrupt/);
    assert.equal(f.service().search({ q: "person" }).totalMatches, 4);
  } finally { await f.dispose(); }
});

it("cold and post-mutation pages read only selected run JSON with large unrelated history", async () => {
  const f = await fixture();
  try {
    f.db.withAuthorityTransaction(() => {
      for (let seed = 2001; seed < 2501; seed++) f.db.authority.runs.enqueue(runRecordOf({ seed, workflow: "unrelated-workflow" }));
      for (let seed = 2501; seed < 2505; seed++) f.db.authority.runs.enqueue(runRecordOf({ seed, workflow: "selected-workflow" }));
    });
    // Fresh authority admission occurs before the first interactive query; no search cache is warmed.
    f.reopen();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- observer restores the original database receiver with call().
    const original = DatabaseSync.prototype.prepare;
    const observed: { sql: string; rows: number }[] = [];
    const spy = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (this: DatabaseSync, sql: string) {
      const statement = original.call(this, sql);
      if (/SELECT \* FROM runs/isu.test(sql)) {
        const get = statement.get.bind(statement), all = statement.all.bind(statement);
        statement.get = (...args) => { const result = Reflect.apply(get,statement,args) as ReturnType<typeof get>; observed.push({ sql, rows: result === undefined ? 0 : 1 }); return result; };
        statement.all = (...args) => { const result = Reflect.apply(all,statement,args) as ReturnType<typeof all>; observed.push({ sql, rows: result.length }); return result; };
      }
      return statement;
    });
    try {
      const search = f.service();
      const first = search.search({ q: "selected-workflow", limit: 2 });
      const firstReads=observed.reduce((n,row)=>n+row.rows,0);
      assert.equal(first.totalMatches, 4); assert.equal(firstReads, 3);
      assert.ok(observed.every(row => /WHERE id=\?/u.test(row.sql)));
      assert.equal(first.nextCursor.state, "present");
      if (first.nextCursor.state !== "present") throw new Error("missing cursor");
      observed.length = 0;
      const next = search.search({ q: "selected-workflow", limit: 2, cursor: first.nextCursor.value });
      const nextReads=observed.reduce((n,row)=>n+row.rows,0);
      assert.equal(next.results.length, 2); assert.equal(nextReads, 2);
      // Negative control: the same observer catches a deliberately widened reader.
      const raw = new DatabaseSync(f.path);
      try {
        observed.length = 0; raw.prepare("SELECT * FROM runs").all();
        const widenedReads = observed.reduce((n, row) => n + row.rows, 0);
        assert.equal(widenedReads, 504);
        const plan = raw.prepare("EXPLAIN QUERY PLAN SELECT * FROM runs WHERE id=?").all(runRecordOf({ seed: 2501 }).envelope.runId);
        assert.match(JSON.stringify(plan), /SEARCH.*sqlite_autoindex_runs_1/u);
        process.stdout.write(`P2_QUERY_PROOF ${JSON.stringify({kind:"search-cold-page",historyRows:504,selectedMatches:first.totalMatches,pageLimit:2,firstReads,nextReads,widenedReads,plan})}\n`);
      } finally { raw.close(); }
      f.db.authority.runs.enqueue(runRecordOf({ seed: 2505, workflow: "selected-workflow" }));
      observed.length = 0;
      assert.equal(search.search({ q: "selected-workflow", limit: 2 }).totalMatches, 5);
      assert.equal(observed.reduce((n, row) => n + row.rows, 0), 3);
      process.stdout.write(`P2_QUERY_PROOF ${JSON.stringify({kind:"search-post-mutation",historyRows:505,selectedMatches:5,pageLimit:2,rawReads:observed.reduce((n,row)=>n+row.rows,0)})}\n`);
    } finally { spy.mockRestore(); }
  } finally { await f.dispose(); }
});

it("expires snapshots and retains exact pages until authority changes", async () => {
  const f = await fixture();
  try {
    f.db.authority.runs.enqueue(runRecordOf({ seed: 3001 }));
    const search = f.service(), query = { q: "", limit: 1 };
    const first = search.search(query);
    assert.deepEqual(search.searchSelected(query, first.snapshot.token).results, first.results);
    f.clock.setWall(new Date("2026-09-21T12:16:00Z"));
    assert.throws(() => search.searchSelected(query, first.snapshot.token), /expired/);
  } finally { await f.dispose(); }
});

it("publishes declared subject names, authentic recorded actors and typed failure evidence with source writes", async () => {
  const f = await fixture();
  try {
    const { descriptor } = createSubjectTitleTestWorld();
    const queued = runRecordOf({ seed: 4801, descriptor, enqueuedAt: NOW });
    f.db.authority.runs.enqueue(queued);
    const { workerId } = testAdmittedWorker(f.db, f.clock, { path: f.path, workflow: "person-lookup", poolIndex: 1, browserSystems: ["ucpath"] });
    const claimMember1 = f.db.authority.workerSlots.get(workerId);
    if (claimMember1 === undefined) throw new Error("fixture-claim-member-required");
    const claimed = f.db.authority.runs.claimNext({ workerLifetime: testWorkerLifetime(f.db, "person-lookup", claimMember1.poolIndex).workerLifetime, workflow: "person-lookup", workerId, now: NOW });
    assert.ok(claimed.state === "claimed");
    const claim = { workerId, claimGeneration: claimed.run.claimGeneration };
    const validating = f.db.authority.runs.transition({ runId: queued.envelope.runId, expectedVersion: claimed.run.version, claim, now: NOW,
      lifecycle: { state: "validating", workerId, workerLifetime: testWorkerLifetime(f.db, "person-lookup", claimMember1.poolIndex).workerLifetime, claimedAt: NOW, heartbeatAt: NOW } });
    assert.ok(validating.state === "applied");
    const running = f.db.authority.runs.transition({ runId: queued.envelope.runId, expectedVersion: validating.run.version, claim, now: NOW,
      lifecycle: { state: "running", workerId, workerLifetime: testWorkerLifetime(f.db, "person-lookup", claimMember1.poolIndex).workerLifetime, claimedAt: NOW, heartbeatAt: NOW, currentNodeId: "searching" } });
    assert.ok(running.state === "applied");
    const run = running.run, e = run.envelope;
    f.db.registerRunSearchDeclarations([{ workflow: e.workflow, version: e.descriptorVersion, contractFingerprint: e.contractFingerprint, subjectProjection: descriptor.subjectProjection }]);
    createTimelineEmitter({ repository: f.db.authority.timelineEvents, clock: f.clock, pid: 4242 }).emit({
      t: "run.queued", kind: "run", ts: NOW, workflow: e.workflow, runId: e.runId, attempt: e.attempt,
      traceId: e.traceId, spanPath: e.traceId, itemId: e.itemId, shape: e.shape, priority: e.priority, dryRun: e.dryRun,
      actorId: "synthetic-operator", title: "Ingress must not be indexed", descriptorVersion: e.descriptorVersion,
      contractFingerprint: e.contractFingerprint, resolvedInstance: e.resolvedInstance, configFingerprint: e.configFingerprint, configSnapshotId: e.configSnapshotId,
    });
    const selected = { emplId: "10000000", name: "Synthetic Resolved Subject 10800001", department: "Synthetic Department", jobTitle: "Synthetic Role", employeeStatus: "active", hrStatus: 'Active', startDate: "", effectiveDate: "", terminationDate: "", terminationReason: "",
hdh: true };
    const value = SearchPersonOrgOutputSchema.parse({ results: [selected], selection: { status: "resolved", selected, candidateEids: [selected.emplId] } });
    f.db.authority.runCheckpoints.insert(RunCheckpointRecordSchema.parse({ workflowId: e.workflow, itemId: e.itemId, runId: e.runId,
      nodeId: "searching", attempt: e.attempt, claimGeneration: run.claimGeneration,
      output: { schemaHash: deriveSchemaHash(SearchPersonOrgOutputSchema, "output"), value }, descriptorVersion: e.descriptorVersion,
      contractFingerprint: e.contractFingerprint, implFingerprint: HASH, provenance: [], writtenAt: NOW }));
    const search = (q: string, facets = {}) => f.db.authority.runs.search({ q, scope: "all", facets, limit: 5 });
    const names = search("resolved", { actor: "synthetic-operator", subject: "Synthetic", version: e.descriptorVersion, state: "running" });
    assert.equal(names.totalMatches, 1);
    assert.deepEqual(names.rows[0]?.metadata.subject, { state: "available", value: selected.name });
    assert.deepEqual(names.rows[0]?.metadata.actor, { state: "available", value: "synthetic-operator" });
    for (const q of [selected.emplId, "Synthetic Department", "Ingress must not", e.configFingerprint]) assert.equal(search(q).totalMatches, 0);
    const raw = new DatabaseSync(f.path);
    try {
      const frozen = raw.prepare("SELECT declaration_json,actor_source_json FROM run_search WHERE run_id=?").get(e.runId);
      assert.equal(f.db.rebuildRunSearchIndex({restart:true,limit:1}).state,"published");
      assert.deepEqual(raw.prepare("SELECT declaration_json,actor_source_json FROM run_search WHERE run_id=?").get(e.runId),frozen);
      const peer = AuthorityDatabase.open({path:f.path,busyTimeoutMs:500,migrationOwner:"frozen-search-reopen"},f.clock);
      try { assert.deepEqual(peer.authority.runs.search({q:"resolved",scope:"all",facets:{},limit:5}).rows[0]?.metadata,names.rows[0]?.metadata); }
      finally { peer.close(); }
    } finally { raw.close(); }
    const failed = { ...failure(), runId: e.runId, traceId: e.traceId, attempt: e.attempt, workflowId: e.workflow };
    f.db.terminalizeFailure(descriptor, { failure: failed, authorization: { kind: "failed", runId: e.runId,
      workflowId: e.workflow, attempt: e.attempt, descriptorVersion: e.descriptorVersion, contractFingerprint: e.contractFingerprint,
      expectedVersion: run.version, claim, authorizedAt: NOW, failureId: failed.failureId } });
    assert.equal(search("", { failure: "FIXTURE_FAILURE", evidence: "failure", state: "failed" }).totalMatches, 1);
    assert.equal(search("", { evidence: "receipt" }).totalMatches, 0);
    assert.equal(search("", { evidence: "diagnostic" }).totalMatches, 0);
    const diagnostic={runId:e.runId,origin:{kind:"operator-request",requestedBy:"synthetic-operator"},capturedAt:NOW,
      configFingerprint:e.configFingerprint,descriptorFingerprint:e.contractFingerprint,redaction:{fields:[],warnings:[]},attachments:[]};
    f.db.authority.diagnosticBundles.insert(DiagnosticBundleSchema.parse({runId:diagnostic.runId,origin:diagnostic.origin,configFingerprint:diagnostic.configFingerprint,descriptorFingerprint:diagnostic.descriptorFingerprint,redaction:diagnostic.redaction,attachments:diagnostic.attachments,bundleId:"00000000-0000-4000-8000-000000004800",createdAt:NOW,
      contentDigest:deriveDiagnosticContentDigest(diagnostic),retention:{kind:"ordinary",purgeAfter:"2026-12-01T00:00:00.000Z"}}));
    assert.equal(search("", { evidence: "diagnostic",state:"failed" }).totalMatches, 1);
    assert.equal(search("", { evidence: "none" }).totalMatches, 0);
  } finally { await f.dispose(); }
});

it("keeps ordinary authority writes available while a large declaration requires explicit bounded rebuild",async ()=>{
  const f=await fixture();
  try {
    f.db.withAuthorityTransaction(()=>{for(let seed=3100;seed<3601;seed++)f.db.authority.runs.enqueue(runRecordOf({seed}));});
    const run=runRecordOf({seed:3100});
    f.db.registerRunSearchDeclarations([{workflow:run.envelope.workflow,version:run.envelope.descriptorVersion,contractFingerprint:run.envelope.contractFingerprint,subjectProjection:null}]);
    assert.throws(()=>f.service().search({q:""}),/rebuild-required/u);
    f.db.authority.runs.enqueue(runRecordOf({seed:3601}));
    assert.throws(()=>f.service().search({q:""}),/rebuild-required/u);
    const first=f.db.rebuildRunSearchIndex({restart:true,limit:500});
    assert.equal(first.state,"building");assert.equal(first.rowCount,500);
    const second=f.db.rebuildRunSearchIndex({limit:500});assert.equal(second.state,"published");assert.equal(second.rowCount,502);
    assert.equal(f.service().search({q:""}).totalMatches,502);
  } finally {await f.dispose();}
});

it("selects each reachable lifecycle, shape, retained version and mode without narrowing to one workflow",async ()=>{
  const f=await fixture();
  try {
    const targets=["queued","claimed","validating","running","parked-gate","parked-write","cancelled","discarded","superseded","interrupted"] as const;
    for(const [offset,target] of targets.entries()) {
      const original=runRecordOf({seed:3700+offset,workflow:`metadata-${target}`,shape:offset%2===0?"single":"operation-member",dryRun:offset%2===0});
      const queued={...original,envelope:{...original.envelope,descriptorVersion:7}};
      f.db.authority.runs.enqueue(queued);
      const search=()=>f.service().search({q:"",facets:{workflow:queued.envelope.workflow,state:target,version:7,dryRun:queued.envelope.dryRun,shape:queued.envelope.shape,system:"ucpath"}});
      if(target!=="queued") {
        const {workerId,workerLifetime}=testAdmittedWorker(f.db,f.clock,{path:f.path,workflow:queued.envelope.workflow,poolIndex:1,browserSystems:["ucpath"]});
        const claim=f.db.authority.runs.claimNext({workflow:queued.envelope.workflow,workerId,workerLifetime,now:queued.createdAt});
        assert.equal(claim.state,"claimed");if(claim.state!=="claimed")throw new Error("claim failed");
        let run=claim.run;
        const advance=(lifecycle:unknown)=>{const result=f.db.authority.runs.transition({runId:run.envelope.runId,expectedVersion:run.version,claim:{workerId,claimGeneration:run.claimGeneration},lifecycle,now:queued.createdAt});assert.equal(result.state,"applied");if(result.state!=="applied")throw new Error("transition failed");run=result.run;};
        const ownership={workerId,workerLifetime,claimedAt:queued.createdAt,heartbeatAt:queued.createdAt};
        if(target!=="claimed") {
          advance({state:"validating",...ownership});
          if(target!=="validating") {
            advance({state:"running",...ownership});
            if(target==="parked-gate")advance({state:target,gateId:"synthetic-review",parkedAt:queued.createdAt,resumeAt:"review"});
            else if(target==="parked-write") {
              const bindingProof = { ...WRITE_INTENT_ATTEMPTING.bindingProof, runId: queued.envelope.runId, attempt: queued.envelope.attempt,
                afterPrepareSpanPath: `${queued.envelope.traceId}/termination/prepare` };
              const bindingProofDigest = deriveWriteBindingProofDigest(bindingProof);
              const intent = { ...WRITE_INTENT_ATTEMPTING, bindingProof, bindingProofDigest, writeIntentId: queued.envelope.runId,
                workflowId: queued.envelope.workflow, itemId: queued.envelope.itemId,
                runId: queued.envelope.runId, runAttempt: queued.envelope.attempt };
              fenceWriteFixture(f.db, { intent, attempt: { ...WRITE_ATTEMPT,
                writeIntentId: intent.writeIntentId, runId: intent.runId, runAttempt: intent.runAttempt, bindingProof, bindingProofDigest } });
              f.db.authority.writeIntents.parkAttempt({ writeIntentId: intent.writeIntentId, generation: 1,
                expectedVersion: 1, code: "unknown", message: "Synthetic unknown; do not retry",
                authorityReason: deriveWriteAuthorityReason("recovery-probe-unknown", "probe", "Synthetic unknown"), now: queued.createdAt });
              advance({state:target,writeIntentId:intent.writeIntentId,intentGeneration:1,parkedAt:queued.createdAt,code:"unknown",message:"Synthetic unknown; do not retry"});
            }
            else if(target!=="running")advance({state:"terminal",outcome:target,endedAt:queued.createdAt});
          }
        }
      }
      assert.equal(search().totalMatches,1,target);
      assert.equal(search().results[0]?.metadata.version,7);
    }
  } finally {await f.dispose();}
});

it("refuses a selection beyond the 10000 metadata bound before reading run JSON",async ()=>{
  const f=await fixture();
  try {
    const prototype = runRecordOf({seed:1,workflow:"history"});
    const raw = new DatabaseSync(f.path);
    try {
      raw.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
      const columns = Object.keys(runRecordColumns(prototype));
      const insert = raw.prepare(`INSERT INTO runs(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`);
      for (let seed = 1; seed <= 10001; seed++) {
        const runId = `00000000-0000-4000-8000-${String(seed).padStart(12,"0")}`;
        const record = RunRecordSchema.parse({...prototype,envelope:{...prototype.envelope,runId,itemId:runId,workflow:seed === 10001 ? "needle" : "history"}});
        insert.run(...Object.values(runRecordColumns(record)));
      }
      raw.exec("COMMIT");
      assert.equal(raw.prepare("SELECT count(*) AS count FROM runs").get()?.count, 10001);
    } finally { raw.close(); }
    for(let publication=f.db.rebuildRunSearchIndex({restart:true,limit:500});publication.state!=="published";publication=f.db.rebuildRunSearchIndex({limit:500}))assert.equal(publication.state,"building");
    f.reopen();
    // A too-broad selection must stop before any raw source JSON is materialized.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- preserve the database receiver in this observer.
    const prepare=DatabaseSync.prototype.prepare;
    const spy=vi.spyOn(DatabaseSync.prototype,"prepare").mockImplementation(function(this:DatabaseSync,sql:string){
      if(/SELECT \* FROM runs/isu.test(sql))throw new Error("raw-source-read-before-selection-bound");
      return prepare.call(this,sql);
    });
    try {assert.throws(()=>f.service().search({q:""}),/run-search-query-too-broad/u);} finally {spy.mockRestore();}
    assert.equal(f.service().search({q:"needle"}).totalMatches,1);
  } finally {await f.dispose();}
});

it("requires an explicit restart when native source changes during a persisted rebuild", async () => {
  const f = await fixture();
  try {
    for (let seed = 4101; seed <= 4104; seed++) f.db.authority.runs.enqueue(runRecordOf({seed}));
    assert.equal(f.db.rebuildRunSearchIndex({restart:true,limit:1}).state,"building");
    f.reopen();
    f.db.authority.runs.enqueue(runRecordOf({seed:4105}));
    assert.throws(() => f.db.rebuildRunSearchIndex({limit:2}),/run-search-rebuild-restart-required/u);
    for (let progress = f.db.rebuildRunSearchIndex({restart:true,limit:2}); progress.state !== "published"; progress = f.db.rebuildRunSearchIndex({limit:2})) assert.equal(progress.state,"building");
    assert.equal(f.service().search({q:""}).totalMatches,5);
  } finally { await f.dispose(); }
});

it("does not cache derived admission when a corruption rebuild rolls back", async () => {
  const f = await fixture();
  try {
    const run = runRecordOf({seed:4201});
    f.db.authority.runs.enqueue(run);
    const raw = new DatabaseSync(f.path);
    try { raw.prepare("UPDATE run_search SET declaration_json=? WHERE run_id=?").run('{"workflow":"forged"}',run.envelope.runId); }
    finally { raw.close(); }
    assert.throws(() => f.db.rebuildRunSearchIndex({restart:true,limit:1}));
    assert.throws(() => f.service().search({q:"no-match"}),/run-search-index-rebuild-required/u);
  } finally { await f.dispose(); }
});

for (const fault of ["corrupt-completed-row", "hole"] as const) it(`refuses ${fault} in durable rebuild progress and permits explicit repair`, async () => {
  const f = await fixture();
  try {
    for (let seed = 4301; seed <= 4304; seed++) f.db.authority.runs.enqueue(runRecordOf({seed}));
    const progress = f.db.rebuildRunSearchIndex({restart:true,limit:1});
    assert.equal(progress.state,"building");
    const raw = new DatabaseSync(f.path);
    try {
      if (fault === "corrupt-completed-row") raw.prepare("UPDATE run_search SET workflow='forged' WHERE run_id=?").run(progress.afterRun);
      else raw.prepare("UPDATE run_search SET metadata_json=json_set(metadata_json,'$.buildGeneration',?) WHERE run_id=?").run(progress.sourceGeneration,runRecordOf({seed:4304}).envelope.runId);
    } finally { raw.close(); }
    const expected = fault === "hole" ? /run-search-build-prefix-invalid/u : /run-search-index-corrupt/u;
    assert.throws(() => f.db.rebuildRunSearchIndex({limit:2}),expected);
    assert.throws(() => AuthorityDatabase.open({path:f.path,busyTimeoutMs:500,migrationOwner:"corrupt-build-reopen"},f.clock),expected);
    for (let repaired = f.db.rebuildRunSearchIndex({restart:true,limit:2}); repaired.state !== "published"; repaired = f.db.rebuildRunSearchIndex({limit:2})) assert.equal(repaired.state,"building");
    assert.equal(f.service().search({q:""}).totalMatches,4);
  } finally { await f.dispose(); }
});
