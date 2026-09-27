import { RuntimeAdmission } from "../../../src/infra/runtime-control/admission.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,it } from "vitest";
import { Hono } from "hono";
import readXlsxFile from "read-excel-file/node";
import { AuthorityDatabase } from "../../helpers/synthetic-storage-admission.js";
import { createTransactionHistory } from "../../../src/infra/sqlite/transaction-history.js";
import { createContentAddressedArtifactWriter } from "../../../src/infra/artifacts/content-addressed-artifact-writer.js";
import { manualClock } from "../../../src/domain/clock.js";
import { ActorIdSchema } from "../../../src/domain/ids.js";
import { ActivityReportSelectionSchema } from "../../../src/domain/dashboard/activity-selection.js";
import { composeActivity } from "../../../src/server/dashboard/compose/activity.js";
import { registerActivityRoutes } from "../../../src/server/dashboard/routes/activity.js";
import type { DashboardApp } from "../../../src/server/dashboard/routes/api-types.js";
import { createCrossDateSearchService } from "../../../src/server/dashboard/queries/search.js";
import { createOperatorXlsxExportService } from "../../../src/server/dashboard/exports/operator-xlsx-export-service.js";
import { exportSearchMetadata } from "../../../src/server/dashboard/exports/search-metadata-export.js";
import { spreadsheetCsvRow } from "../../../src/server/dashboard/exports/spreadsheet-csv.js";
import { createActivityQueries } from "../../../src/dashboard/client/activity-queries.js";
import { createDashboardTransport } from "../../../src/dashboard/client/transport.js";
import { verifySelectionDownload } from "../../../src/dashboard/client/selection-download.js";
import { runRecordOf } from "./helpers/dashboard-harness.js";

const cleanup:(()=>void)[]=[];
afterEach(()=>{for(const dispose of cleanup.splice(0))dispose();});
function fixture() {
  const root=mkdtempSync(join(tmpdir(),"activity-selection-proof-")),path=join(root,"state.db");
  const clock=manualClock(new Date("2026-09-21T17:00:00Z"));
  const database=AuthorityDatabase.open({path,busyTimeoutMs:500,migrationOwner:"activity-selection-proof"},clock);
  cleanup.push(()=>{database.close();rmSync(root,{recursive:true,force:true});});
  for(let seed=3701;seed<=3703;seed++)database.authority.runs.enqueue(runRecordOf({seed,runNumber:seed-3700,workflow:"historical-workflow",dryRun:true,enqueuedAt:"2026-09-20T17:00:00Z",displayName:"Private Ingress Subject 10000000"}));
  const descriptors={resolve:()=>undefined},sourceIdentity=database.getSourceDatabaseIdentity();
  const activity=composeActivity({database,clock,descriptors,ledger:createTransactionHistory(database.authority)});
  const search=createCrossDateSearchService({clock,descriptors,sourceIdentity,cursorSigningKey:new Uint8Array(32).fill(42),
    authority:{readSnapshot:read=>database.withAuthorityReadSnapshot(()=>read({authorityGeneration:database.getMeta().authorityGeneration,searchRuns:input=>database.authority.runs.search(input)}))}});
  const artifacts=createContentAddressedArtifactWriter({admission: RuntimeAdmission.syntheticRoots(join(root, ".tracker"), join(root, ".tracker/artifacts"))});
  const xlsx=createOperatorXlsxExportService({clock,ids:{uuid:randomUUID},sourceIdentity,artifacts,authority:database.authority.operatorXlsxExports,
    search,activityReport:(from,to,token)=>activity.readSelected(from,to,token)});
  const app:DashboardApp=new Hono();app.onError((_error,c)=>c.json({error:"selection refused"},409));registerActivityRoutes(app,{activity});
  return {database,clock,activity,search,xlsx,artifacts,sourceIdentity,app};
}

it("serves and exports the same reviewed Activity summary snapshot and refuses substitution after mutation",async()=>{
  const f=fixture();await f.artifacts.ready;
  const report=ActivityReportSelectionSchema.parse(await (await f.app.request("http://localhost/api/v1/reports/activity?from=2026-09-20&to=2026-09-20")).json());
  assert.equal(report.totalRuns,3);assert.equal(report.inFlightRuns,3);
  const csv=await f.app.request(`http://localhost/api/v1/reports/activity.csv?${new URLSearchParams({from:report.from,to:report.to,snapshot:report.snapshot.token})}`);
  assert.equal(csv.status,200);const csvText=await csv.text();assert.match(csvText,/Runs in range,3/u);assert.ok(csvText.includes(report.generatedAt));
  const file=await f.xlsx.export(ActorIdSchema.parse("synthetic-operator"),{requestVersion:3,selection:{kind:"activity",from:report.from,to:report.to,snapshotToken:report.snapshot.token}});
  const sheets=await readXlsxFile(file.bytes),summary=sheets.find(sheet=>sheet.sheet==="Summary");assert.ok(summary);
  assert.deepEqual(summary.data.find(row=>row[0]==="Total runs")?.slice(0,2),["Total runs",3]);
  assert.deepEqual(summary.data.find(row=>row[0]==="Distinct people")?.slice(0,2),["Distinct people",0]);
  assert.equal(file.evidence.workbookVersion,3);assert.equal("requestedBy" in file.evidence&&file.evidence.requestedBy,"synthetic-operator");
  assert.deepEqual(f.database.authority.operatorXlsxExports.get(file.evidence.exportId),file.evidence);
  // Registering this export itself advances authority: old review cannot silently read the new generation.
  assert.throws(()=>f.activity.readSelected(report.from,report.to,report.snapshot.token),/stale/u);
  assert.equal((await f.app.request(`http://localhost/api/v1/reports/activity.csv?from=${report.from}&to=${report.to}`)).status,409);
});

it("exports the complete ordered search selection with coverage while omitting private values and raw evidence",async()=>{
  const f=fixture();await f.artifacts.ready;
  const query={q:"",scope:"all" as const,facets:{from:"2026-09-20",to:"2026-09-20"},limit:1};
  const page=f.search.search(query),selection={kind:"search" as const,query,snapshot:{...page.snapshot,generatedAt:page.generatedAt}};
  assert.equal(page.results.length,1);assert.equal(page.totalMatches,3);
  const response=exportSearchMetadata(f,{format:"diagnostic",selection}),text=await response.text();
  const diagnostic=JSON.parse(text) as {totalMatches:number;coverage:unknown;rows:{runNumber:number|null}[]};
  assert.equal(diagnostic.totalMatches,3);assert.deepEqual(diagnostic.coverage,page.coverage);assert.equal(diagnostic.rows.length,3);
  assert.doesNotMatch(text,/Private Ingress Subject|10000000|configFingerprint|traceId|runId|checkpoint/u);
  const csv=await exportSearchMetadata(f,{format:"csv",selection}).text();assert.match(csv,/Matches,3/u);assert.doesNotMatch(csv,/Private Ingress Subject|10000000/u);
  const xlsx=await f.xlsx.export(ActorIdSchema.parse("synthetic-operator"),{requestVersion:3,selection});
  const sheets=await readXlsxFile(xlsx.bytes),runs=sheets.find(sheet=>sheet.sheet==="Runs");assert.ok(runs);
  assert.equal(runs.data.length,4);assert.deepEqual(runs.data.slice(1).map(row=>row[0]),diagnostic.rows.map(row=>row.runNumber));
  assert.doesNotMatch(JSON.stringify(sheets),/Private Ingress Subject|10000000/u);
  assert.throws(()=>exportSearchMetadata(f,{format:"csv",selection}),/snapshot/u);
});

it("rejects report token tampering, mismatched range, foreign signer and expiry without returning a replacement report",async()=>{
  const f=fixture();await f.artifacts.ready;const report=f.activity.read("2026-09-20","2026-09-20");
  assert.throws(()=>f.activity.readSelected(report.from,"2026-09-21",report.snapshot.token),/mismatch/u);
  assert.throws(()=>f.activity.readSelected(report.from,report.to,`${report.snapshot.token}x`),/invalid/u);
  const restarted=composeActivity({database:f.database,clock:f.clock,descriptors:{resolve:()=>undefined},ledger:createTransactionHistory(f.database.authority)});
  assert.throws(()=>restarted.readSelected(report.from,report.to,report.snapshot.token),/invalid/u);
  f.clock.advanceWall(15*60_000);
  assert.throws(()=>f.activity.readSelected(report.from,report.to,report.snapshot.token),/expired/u);
});

it("escapes formula and control prefixes but preserves numeric cells and RFC 4180 meaning",()=>{
  const values=["=1+1","+cmd","-1+2","@SUM(A1)","  =1","\t=1","\r@cmd","\n+cmd","\u0001=1"];
  for(const value of values)assert.ok(spreadsheetCsvRow([value]).replace(/^"/u,"").startsWith("'"));
  assert.equal(spreadsheetCsvRow([-42,12.5,'a,"b"\nc']),'-42,12.5,"a,""b""\nc"');
});

it("the client checks range and download filename, MIME, length, digest and selected-token identity before delivering bytes",async()=>{
  const f=fixture();await f.artifacts.ready;const report=f.activity.read("2026-09-20","2026-09-20"),controller=new AbortController();
  let observedSignal:AbortSignal|undefined;
  const client=createActivityQueries(createDashboardTransport({baseUrl:"http://localhost",fetchImpl:(url,init)=>{
    observedSignal=init?.signal??undefined;return Promise.resolve(f.app.request(url,init));
  }}));
  const read=await client.activityReport(report.from,report.to,controller.signal);assert.equal(observedSignal,controller.signal);
  const valid=await client.exportActivityCsv(read,controller.signal);assert.ok(valid.bytes.byteLength>0);
  const response=await f.app.request(`http://localhost/api/v1/reports/activity.csv?${new URLSearchParams({from:read.from,to:read.to,snapshot:read.snapshot.token})}`);
  const bytes=await response.arrayBuffer(),expected={path:"CSV",filename:valid.filename,mediaType:valid.mediaType,token:read.snapshot.token};
  for(const header of ["content-type","content-disposition","content-length","etag","x-selection-digest"]) {
    const headers=new Headers(response.headers);headers.set(header,"wrong");
    await assert.rejects(verifySelectionDownload({headers,bytes},expected),/mismatch/u);
  }
  const changed=bytes.slice(0);new Uint8Array(changed)[0]^=1;
  await assert.rejects(verifySelectionDownload({headers:response.headers,bytes:changed},expected),/mismatch/u);
  const wrong=createActivityQueries(createDashboardTransport({baseUrl:"http://localhost",fetchImpl:()=>Promise.resolve(Response.json(read))}));
  await assert.rejects(wrong.activityReport("2026-09-19","2026-09-19"),/identity-mismatch/u);
});
