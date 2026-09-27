import { deriveDiagnosticContentDigest } from "../../src/domain/trust/diagnostic-capture.js";
import { DiagnosticBundleSchema } from "../../src/domain/trust/diagnostic.js";
import { foundationFixture, failure, terminalizeFixtureFailure, HASH, NOW } from "./database-foundation/fixtures.js";
import { personLookupDescriptor } from "../helpers/registered-workflows.js";
import { createTimelineEmitter } from "../../src/infra/events/timeline-emitter.js";
import { RunCheckpointRecordSchema } from "../../src/domain/workflow/checkpoint.js";
import { SearchPersonOrgOutputSchema } from "../../src/domain/contracts/ucpath/search-person-org.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it, vi } from "vitest";
import { AuthorityDatabase } from "../helpers/synthetic-storage-admission.js";
import { manualClock } from "../../src/domain/clock.js";
import { runRecordOf } from "./server/helpers/dashboard-harness.js";
import { createCrossDateSearchService } from "../../src/server/dashboard/queries/search.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "search-index-"));
  const path = join(root, "authority.db");
  const clock = manualClock(new Date("2026-09-21T12:00:00Z"));
  let db = AuthorityDatabase.open({ path, busyTimeoutMs: 500, migrationOwner: "search-test" }, clock);
  const service = () => createCrossDateSearchService({ clock, sourceIdentity: db.getSourceDatabaseIdentity(), cursorSigningKey: new Uint8Array(32).fill(9),
    descriptors: { resolve: () => undefined }, authority: { readSnapshot: read => db.withAuthorityReadSnapshot(() => read({
      authorityGeneration: db.getMeta().authorityGeneration, searchRuns: input => db.authority.runs.search(input),
    })) } });
  return { root, path, clock, get db(){return db;}, service, reopen(){db.close();db=AuthorityDatabase.open({path,busyTimeoutMs:500,migrationOwner:"search-reopen"},clock);}, dispose() { db.close(); rmSync(root, { recursive: true, force: true }); } };
}

it("searches registered and historical workflow metadata without exposing raw inputs or inventing actors", () => {
  const f = fixture();
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
  } finally { f.dispose(); }
});

it("refuses tampered metadata even for nonmatching queries; resumes bounded rebuilds across reopen", () => {
  const f = fixture();
  try {
    for (let seed = 1101; seed < 1105; seed++) f.db.authority.runs.enqueue(runRecordOf({ seed, workflow: "person-lookup" }));
    const raw = new DatabaseSync(f.path);
    try { raw.exec("UPDATE run_search_index SET workflow='forged'"); } finally { raw.close(); }
    assert.throws(() => f.service().search({ q: "no-match" }), /run-search-index-rebuild-required/);
    const first = f.db.rebuildRunSearchIndex({ restart: true, limit: 2 });
    assert.equal(first.state, "building"); assert.equal(first.rowCount, 2);
    assert.throws(() => f.service().search({ q: "person" }), /run-search-index-rebuild-required/);
    const peer = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 500, migrationOwner: "search-resume" }, f.clock);
    try { assert.equal(peer.rebuildRunSearchIndex({ limit: 2 }).state, "published"); } finally { peer.close(); }
    assert.equal(f.service().search({ q: "person" }).totalMatches, 4);
    assert.throws(() => f.db.withAuthorityTransaction(() => { f.db.rebuildRunSearchIndex({ restart: true, limit: 1 }); throw new Error("interrupt"); }), /interrupt/);
    assert.equal(f.service().search({ q: "person" }).totalMatches, 4);
  } finally { f.dispose(); }
});

it("cold and post-mutation pages read only selected run JSON with large unrelated history", () => {
  const f = fixture();
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
      if (/SELECT.*record_json FROM workflow_runs/isu.test(sql)) {
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
      assert.ok(observed.every(row => /WHERE record_key=\?/u.test(row.sql)));
      assert.equal(first.nextCursor.state, "present");
      if (first.nextCursor.state !== "present") throw new Error("missing cursor");
      observed.length = 0;
      const next = search.search({ q: "selected-workflow", limit: 2, cursor: first.nextCursor.value });
      const nextReads=observed.reduce((n,row)=>n+row.rows,0);
      assert.equal(next.results.length, 2); assert.equal(nextReads, 2);
      // Negative control: the same observer catches a deliberately widened reader.
      const raw = new DatabaseSync(f.path);
      try {
        observed.length = 0; raw.prepare("SELECT record_json FROM workflow_runs").all();
        assert.equal(observed.reduce((n, row) => n + row.rows, 0), 504);
        const plan = raw.prepare("EXPLAIN QUERY PLAN SELECT run_id FROM run_search_grams WHERE token=?").all("sel");
        assert.match(JSON.stringify(plan), /SEARCH.*run_search_gram_token_idx/u);
        process.stdout.write(`P2_QUERY_PROOF ${JSON.stringify({kind:"search-cold-page",historyRows:504,selectedMatches:first.totalMatches,pageLimit:2,firstReads,nextReads,widenedReads:observed.reduce((n,row)=>n+row.rows,0),plan})}\n`);
      } finally { raw.close(); }
      f.db.authority.runs.enqueue(runRecordOf({ seed: 2505, workflow: "selected-workflow" }));
      observed.length = 0;
      assert.equal(search.search({ q: "selected-workflow", limit: 2 }).totalMatches, 5);
      assert.equal(observed.reduce((n, row) => n + row.rows, 0), 3);
      process.stdout.write(`P2_QUERY_PROOF ${JSON.stringify({kind:"search-post-mutation",historyRows:505,selectedMatches:5,pageLimit:2,rawReads:observed.reduce((n,row)=>n+row.rows,0)})}\n`);
    } finally { spy.mockRestore(); }
  } finally { f.dispose(); }
});

it("expires snapshots and retains exact pages until authority changes", () => {
  const f = fixture();
  try {
    f.db.authority.runs.enqueue(runRecordOf({ seed: 3001 }));
    const search = f.service(), query = { q: "", limit: 1 };
    const first = search.search(query);
    assert.deepEqual(search.searchSelected(query, first.snapshot.token).results, first.results);
    f.clock.setWall(new Date("2026-09-21T12:16:00Z"));
    assert.throws(() => search.searchSelected(query, first.snapshot.token), /expired/);
  } finally { f.dispose(); }
});

it("publishes declared subject names, authentic recorded actors and typed failure evidence with source writes", () => {
  const f = foundationFixture();
  try {
    const e = f.run.envelope;
    f.db.registerRunSearchDeclarations([{ workflow: e.workflow, version: e.descriptorVersion, contractFingerprint: e.contractFingerprint, subjectProjection: personLookupDescriptor.subjectProjection }]);
    createTimelineEmitter({ repository: f.db.authority.timelineEvents, clock: f.clock, pid: 4242 }).emit({
      t: "run.queued", kind: "run", ts: NOW, workflow: e.workflow, runId: e.runId, attempt: e.attempt,
      traceId: e.traceId, spanPath: e.traceId, itemId: e.itemId, shape: e.shape, priority: e.priority, dryRun: e.dryRun,
      actorId: "synthetic-operator", title: "Ingress must not be indexed", descriptorVersion: e.descriptorVersion,
      contractFingerprint: e.contractFingerprint, resolvedInstance: e.resolvedInstance, configFingerprint: e.configFingerprint, configSnapshotId: e.configSnapshotId,
    });
    const selected = { emplId: "10000000", name: "Synthetic Resolved Subject", department: "Synthetic Department", jobTitle: "Synthetic Role", employeeStatus: "active", hdh: true };
    const value = SearchPersonOrgOutputSchema.parse({ results: [selected], selection: { status: "resolved", selected, candidateEids: [selected.emplId] } });
    f.db.authority.runCheckpoints.insert(RunCheckpointRecordSchema.parse({ workflowId: e.workflow, itemId: e.itemId, runId: e.runId,
      nodeId: "searching", attempt: e.attempt, claimGeneration: f.run.claimGeneration,
      output: { schemaHash: deriveSchemaHash(SearchPersonOrgOutputSchema, "output"), value }, descriptorVersion: e.descriptorVersion,
      contractFingerprint: e.contractFingerprint, implFingerprint: HASH, provenance: [], writtenAt: NOW }));
    const search = (q: string, facets = {}) => f.db.authority.runs.search({ q, scope: "all", facets, limit: 5 });
    const names = search("resolved", { actor: "synthetic-operator", subject: "Synthetic", version: e.descriptorVersion, state: "running" });
    assert.equal(names.totalMatches, 1);
    assert.deepEqual(names.rows[0]?.metadata.subject, { state: "available", value: selected.name });
    assert.deepEqual(names.rows[0]?.metadata.actor, { state: "available", value: "synthetic-operator" });
    for (const q of [selected.emplId, "Synthetic Department", "Ingress must not", e.configFingerprint]) assert.equal(search(q).totalMatches, 0);
    terminalizeFixtureFailure(f, f.run, failure());
    assert.equal(search("", { failure: "FIXTURE_FAILURE", evidence: "failure", state: "failed" }).totalMatches, 1);
    assert.equal(search("", { evidence: "receipt" }).totalMatches, 0);
    assert.equal(search("", { evidence: "diagnostic" }).totalMatches, 0);
    const diagnostic={runId:e.runId,origin:{kind:"operator-request",requestedBy:"synthetic-operator"},capturedAt:NOW,
      configFingerprint:e.configFingerprint,descriptorFingerprint:e.contractFingerprint,redaction:{fields:[],warnings:[]},attachments:[]};
    f.db.authority.diagnosticBundles.insert(DiagnosticBundleSchema.parse({runId:diagnostic.runId,origin:diagnostic.origin,configFingerprint:diagnostic.configFingerprint,descriptorFingerprint:diagnostic.descriptorFingerprint,redaction:diagnostic.redaction,attachments:diagnostic.attachments,bundleId:"00000000-0000-4000-8000-000000004800",createdAt:NOW,
      contentDigest:deriveDiagnosticContentDigest(diagnostic),retention:{kind:"ordinary",purgeAfter:"2026-12-01T00:00:00.000Z"}}));
    assert.equal(search("", { evidence: "diagnostic",state:"failed" }).totalMatches, 1);
    assert.equal(search("", { evidence: "none" }).totalMatches, 0);
  } finally { f.dispose(); }
});

it("keeps ordinary authority writes available while a large declaration requires explicit bounded rebuild",()=>{
  const f=fixture();
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
  } finally {f.dispose();}
});

it("selects each reachable lifecycle, shape, retained version and mode without narrowing to one workflow",()=>{
  const f=fixture();
  try {
    const targets=["queued","claimed","validating","running","parked-gate","parked-write","cancelled","discarded","superseded","interrupted"] as const;
    for(const [offset,target] of targets.entries()) {
      const original=runRecordOf({seed:3700+offset,workflow:`metadata-${target}`,shape:offset%2===0?"single":"operation-member",dryRun:offset%2===0});
      const queued={...original,envelope:{...original.envelope,descriptorVersion:7}};
      f.db.authority.runs.enqueue(queued);
      const search=()=>f.service().search({q:"",facets:{workflow:queued.envelope.workflow,state:target,version:7,dryRun:queued.envelope.dryRun,shape:queued.envelope.shape,system:"ucpath"}});
      if(target!=="queued") {
        const claim=f.db.authority.runs.claimNext({workflow:queued.envelope.workflow,workerId:`worker-${target}`,now:queued.createdAt});
        assert.equal(claim.state,"claimed");if(claim.state!=="claimed")throw new Error("claim failed");
        let run=claim.run;
        const advance=(lifecycle:unknown)=>{const result=f.db.authority.runs.transition({runId:run.envelope.runId,expectedVersion:run.version,claim:{workerId:`worker-${target}`,claimGeneration:run.claimGeneration},lifecycle,now:queued.createdAt});assert.equal(result.state,"applied");if(result.state!=="applied")throw new Error("transition failed");run=result.run;};
        const ownership={workerId:`worker-${target}`,claimedAt:queued.createdAt,heartbeatAt:queued.createdAt};
        if(target!=="claimed") {
          advance({state:"validating",...ownership});
          if(target!=="validating") {
            advance({state:"running",...ownership});
            if(target==="parked-gate")advance({state:target,gateId:"synthetic-review",parkedAt:queued.createdAt,resumeAt:"review"});
            else if(target==="parked-write")advance({state:target,writeIntentId:queued.envelope.runId,intentGeneration:1,parkedAt:queued.createdAt,code:"unknown",message:"Synthetic unknown; do not retry"});
            else if(target!=="running")advance({state:"terminal",outcome:target,endedAt:queued.createdAt});
          }
        }
      }
      assert.equal(search().totalMatches,1,target);
      assert.equal(search().results[0]?.metadata.version,7);
    }
  } finally {f.dispose();}
});

it("refuses a selection beyond the 10000 metadata bound before reading run JSON",()=>{
  const f=fixture();
  try {
    // Bulk-load valid queued source rows under real SQLite constraints. This cap proof
    // measures the reader, not 10001 repeated enqueue admission scans.
    const original=runRecordOf({seed:1,workflow:"history"});f.db.authority.runs.enqueue(original);
    const raw=new DatabaseSync(f.path);
    try {
      raw.exec("PRAGMA foreign_keys=ON; BEGIN EXCLUSIVE");
      const columns=raw.prepare("PRAGMA table_info(workflow_runs)").all().map(row=>String(row.name));
      const values=columns.map(name=>name==="record_key"||name==="item_id"||name==="record_json"||name==="workflow"?"?":name);
      const insert=raw.prepare(`INSERT INTO workflow_runs(${columns.join(",")}) SELECT ${values.join(",")} FROM workflow_runs WHERE record_key=?`);
      for(let seed=1;seed<=10000;seed++){
        const runId=`00000000-0000-4000-8000-${String(seed).padStart(12,"0")}`;
        const run={...original,envelope:{...original.envelope,runId,itemId:runId,workflow:seed===10000?"needle":"history"}};
        const bound=columns.flatMap(name=>name==="record_key"||name==="item_id"?[runId]:name==="record_json"?[JSON.stringify(run)]:name==="workflow"?[run.envelope.workflow]:[]);
        insert.run(...bound,original.envelope.runId);
      }
      raw.exec("COMMIT");
    } finally {if(raw.isTransaction)raw.exec("ROLLBACK");raw.close();}
    for(let publication=f.db.rebuildRunSearchIndex({restart:true,limit:500});publication.state!=="published";publication=f.db.rebuildRunSearchIndex({limit:500}))assert.equal(publication.state,"building");
    // A too-broad selection must stop before any raw source JSON is materialized.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- preserve the database receiver in this observer.
    const prepare=DatabaseSync.prototype.prepare;
    const spy=vi.spyOn(DatabaseSync.prototype,"prepare").mockImplementation(function(this:DatabaseSync,sql:string){
      if(/SELECT.*record_json FROM workflow_runs/isu.test(sql))throw new Error("raw-source-read-before-selection-bound");
      return prepare.call(this,sql);
    });
    try {assert.throws(()=>f.service().search({q:""}),/run-search-query-too-broad/u);} finally {spy.mockRestore();}
    assert.equal(f.service().search({q:"needle"}).totalMatches,1);
  } finally {f.dispose();}
});
