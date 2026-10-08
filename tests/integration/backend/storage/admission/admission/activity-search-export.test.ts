import { RuntimeAdmission } from "../../../../../../src/backend/storage/admission/admission.js";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,it } from "vitest";
import { Hono } from "hono";
import readXlsxFile from "read-excel-file/node";
import { parse as parseCsvSync } from "csv-parse/sync";
import { AuthorityDatabase } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { createTransactionHistory } from "../../../../../../src/backend/storage/sqlite/transaction-history.js";
import { createContentAddressedArtifactWriter } from "../../../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import { ActorIdSchema } from "../../../../../../src/rules/identity/ids.js";
import { sha256Hex } from "../../../../../../src/rules/validation/sha256.js";
import { ActivityReportSelectionSchema } from "../../../../../../src/models/dashboard/activity-selection.js";
import type { ActivityReportWire } from "../../../../../../src/models/dashboard/activity.js";
import { createActivitySelectionService } from "../../../../../../src/backend/runs/queries/activity-selection.js";
import { queryActivitySummaries } from "../../../../../../src/backend/runs/queries/activity-summaries.js";
import { composeActivity } from "../../../../../../src/backend/app/composition/dashboard/activity.js";
import { registerActivityRoutes } from "../../../../../../src/backend/transports/http/routes/activity.js";
import { registerShellRoutes } from "../../../../../../src/backend/transports/http/routes/shell.js";
import { RunLogsStreamHub } from "../../../../../../src/backend/transports/http/subscriptions/run-logs-stream.js";
import type { ShellRouteDeps } from "../../../../../../src/backend/transports/http/routes/shell-types.js";
import type { DashboardApp } from "../../../../../../src/backend/transports/http/routes/api-types.js";
import { createCrossDateSearchService } from "../../../../../../src/backend/runs/queries/search.js";
import { collectSearchDocument, createOperatorXlsxExportService } from "../../../../../../src/backend/runs/exports/operator-xlsx-export-service.js";
import { CrossDateSearchResultSchema } from "../../../../../../src/models/dashboard/search.js";
import { composeOperatorXlsxWorkbook } from "../../../../../../src/backend/runs/exports/operator-xlsx-workbook.js";
import { exportSearchMetadata } from "../../../../../../src/backend/runs/exports/search-metadata-export.js";
import { spreadsheetCsvRow } from "../../../../../../src/backend/runs/exports/spreadsheet-csv.js";
import { createActivityQueries } from "../../../../../../src/dashboard/client/queries/activity-queries.js";
import { createDashboardTransport } from "../../../../../../src/dashboard/client/transport.js";
import { verifySelectionDownload } from "../../../../../../src/dashboard/client/queries/selection-download.js";
import { DashboardClientError } from "../../../../../../src/dashboard/client/errors.js";
import { activityPresetRange, type ActivityRangePreset } from "../../../../../../src/dashboard/surfaces/activity/activity-model.js";
import { runRecordOf } from "../../../../../support/helpers/backend/dashboard-harness.js";

const cleanup:(()=>void)[]=[];
afterEach(()=>{for(const dispose of cleanup.splice(0))dispose();});
const PRIVATE_ACTIVITY_LABEL = "Private Ingress Subject 10000000";
const RANGE_AWARE_TODAY = "2026-09-26";
const RANGE_AWARE_ACTIVITY_DAYS = [
  "2025-09-27",
  "2026-03-27",
  "2026-06-27",
  "2026-08-27",
  "2026-09-20",
  "2026-09-22",
  "2026-09-23",
  "2026-09-24",
  "2026-09-26",
] as const;
const RANGE_AWARE_PRESETS: readonly ActivityRangePreset[] = [
  "this-week", "today", "last-month", "last-3-months", "last-6-months", "last-year",
];
const RANGE_AWARE_SELECTIONS = Object.freeze([
  ...RANGE_AWARE_PRESETS.map((preset) => ({ name: preset, ...activityPresetRange(preset, RANGE_AWARE_TODAY) })),
  { name: "custom", from: "2026-09-22", to: "2026-09-24" },
]);

function parseActivityCsv(bytes: string): readonly (readonly string[])[] {
  const parsed: unknown = parseCsvSync(bytes, {
    bom: true,
    columns: false,
    relax_column_count: true,
    relax_quotes: false,
    skip_empty_lines: false,
  });
  if (!Array.isArray(parsed)) throw new Error("activity-export-csv-did-not-parse-to-rows");
  const rows: string[][] = [];
  for (const row of parsed) {
    if (!Array.isArray(row)) throw new Error("activity-export-csv-row-is-not-an-array");
    const cells: string[] = [];
    for (const cell of row) {
      if (typeof cell !== "string") throw new Error("activity-export-csv-cell-is-not-text");
      cells.push(cell);
    }
    rows.push(cells);
  }
  return rows;
}

it("parses ragged Activity CSV rows but refuses malformed quotes", () => {
  assert.deepEqual(parseActivityCsv("Activity report\nWindow from,2026-09-20\n"), [
    ["Activity report"],
    ["Window from", "2026-09-20"],
  ]);
  assert.throws(() => parseActivityCsv("Activity report\n\"Window from,2026-09-20\n"));
});

function shiftActivityVolumeSeries(report:ActivityReportWire):ActivityReportWire {
  const volume=report.volume;
  if(volume===undefined)throw new Error("activity-selection-proof-volume-unavailable");
  const source=volume.buckets.findIndex(bucket=>bucket.runs>0),destination=volume.buckets.findIndex((_bucket,index)=>index!==source);
  if(source<0||destination<0)throw new Error("activity-selection-proof-volume-series-not-shiftable");
  return {...report,volume:{...volume,buckets:volume.buckets.map((bucket,index)=>({...bucket,
    runs:bucket.runs+(index===source?-1:index===destination?1:0)}))}};
}
function fixture(options:{dynamicVolumeSeries?:boolean;rangeAware?:boolean}={}) {
  const root=mkdtempSync(join(tmpdir(),"activity-selection-proof-")),path=join(root,"state.db");
  const clock=manualClock(new Date("2026-09-21T17:00:00Z"));
  const database=AuthorityDatabase.open({path,busyTimeoutMs:500,migrationOwner:"activity-selection-proof"},clock);
  cleanup.push(()=>{database.close();rmSync(root,{recursive:true,force:true});});
  const activityDays: readonly string[] = options.rangeAware ? RANGE_AWARE_ACTIVITY_DAYS : ["2026-09-20", "2026-09-20", "2026-09-20"];
  for (const [index, day] of activityDays.entries()) {
    const seed = 3701 + index;
    database.authority.runs.enqueue(runRecordOf({
      seed,
      runNumber: index + 1,
      workflow:"historical-workflow",
      dryRun:true,
      enqueuedAt:`${day}T17:00:00Z`,
      displayName:PRIVATE_ACTIVITY_LABEL,
    }));
  }
  const descriptors={resolve:()=>undefined},ledger=createTransactionHistory(database.authority),sourceIdentity=database.getSourceDatabaseIdentity();
  let shiftVolumeSeries=false;
  const readSummary=(from:string,to:string,generatedAt:string)=>{
    const report=queryActivitySummaries(database,{from,to,generatedAt},{descriptors,ledger,timeZone:"UTC"});
    return shiftVolumeSeries?shiftActivityVolumeSeries(report):report;
  };
  const activity=options.dynamicVolumeSeries
    ?createActivitySelectionService({database,clock,read:readSummary})
    :composeActivity({database,clock,descriptors,ledger,timeZone:"UTC"});
  const search=createCrossDateSearchService({clock,descriptors,sourceIdentity,cursorSigningKey:new Uint8Array(32).fill(42),
    authority:{readSnapshot:read=>database.withAuthorityReadSnapshot(()=>read({authorityGeneration:database.getMeta().authorityGeneration,searchRuns:input=>database.authority.runs.search(input)}))}});
  const artifacts=createContentAddressedArtifactWriter({admission: RuntimeAdmission.syntheticRoots(join(root, ".tracker"), join(root, ".tracker/artifacts"))});
  const xlsx=createOperatorXlsxExportService({clock,ids:{uuid:randomUUID},sourceIdentity,artifacts,authority:database.authority.operatorXlsxExports,
    search,activityReport:(from,to,token)=>activity.readSelected(from,to,token)});
  const app:DashboardApp=new Hono();app.onError((_error,c)=>c.json({error:"selection refused"},409));
  app.use("*",(c,next)=>{c.set("requestActorId",ActorIdSchema.parse("synthetic-operator"));return next();});
  registerActivityRoutes(app,{activity});
  const unavailable = (): never => { throw new Error("run-log-subscription-unavailable-in-activity-fixture"); };
  const runLogsHub = new RunLogsStreamHub({
    projection: { onChange: () => () => {}, cursor: unavailable, generation: unavailable,
      buildDashboardDayWire: unavailable },
    readRun: unavailable,
    store: { tail: unavailable, snapshot: unavailable },
  });
  cleanup.push(() => runLogsHub.close());
  registerShellRoutes(app,{bootstrap:{} as ShellRouteDeps["bootstrap"],search,xlsxExports:xlsx,hub:{} as ShellRouteDeps["hub"],runLogsHub});
  return {database,clock,activity,search,xlsx,artifacts,sourceIdentity,app,activityDays,setShiftVolumeSeries:(value:boolean)=>{shiftVolumeSeries=value;}};
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

it("binds every preset and Custom range to one selected report in decoded CSV and XLSX bytes", async () => {
  const f = fixture({ rangeAware: true });
  await f.artifacts.ready;
  for (const selection of RANGE_AWARE_SELECTIONS) {
    const expectedRuns = f.activityDays.filter((day) => day >= selection.from && day <= selection.to).length;
    const response = await f.app.request(`http://localhost/api/v1/reports/activity?${new URLSearchParams({ from: selection.from, to: selection.to })}`);
    assert.equal(response.status, 200, `${selection.name} report request`);
    const report = ActivityReportSelectionSchema.parse(await response.json());
    assert.equal(report.from, selection.from);
    assert.equal(report.to, selection.to);
    assert.equal(report.snapshot.from, selection.from);
    assert.equal(report.snapshot.to, selection.to);
    assert.equal(report.totalRuns, expectedRuns);
    assert.equal(report.workflows.reduce((total, workflow) => total + workflow.runs, 0), expectedRuns);
    assert.equal(report.days.reduce((total, day) => total + day.runs, 0), expectedRuns);
    assert.equal(report.volume.coveredRuns, expectedRuns);
    assert.equal(report.volume.buckets.reduce((total, bucket) => total + bucket.runs, 0), expectedRuns);

    const selected = f.activity.readSelected(report.from, report.to, report.snapshot.token);
    assert.equal(selected.snapshot.token, report.snapshot.token);
    assert.equal(selected.snapshot.reportDigest, report.snapshot.reportDigest);
    assert.deepEqual(selected.volume, report.volume);

    const csvResponse = await f.app.request(`http://localhost/api/v1/reports/activity.csv?${new URLSearchParams({
      from: report.from,
      to: report.to,
      snapshot: report.snapshot.token,
    })}`);
    assert.equal(csvResponse.status, 200, `${selection.name} CSV request`);
    assert.equal(csvResponse.headers.get("x-selection-digest"), sha256Hex(report.snapshot.token));
    const csvRows = parseActivityCsv(await csvResponse.text());
    const csvRow = (label: string): readonly string[] => {
      const row = csvRows.find((candidate) => candidate[0] === label);
      assert.ok(row, `${selection.name} CSV omitted ${label}`);
      return row;
    };
    assert.deepEqual(csvRow("Window from"), ["Window from", report.from]);
    assert.deepEqual(csvRow("Window to"), ["Window to", report.to]);
    assert.deepEqual(csvRow("Runs in range"), ["Runs in range", String(expectedRuns)]);

    const xlsxRequest = {
      requestVersion: 3,
      selection: { kind: "activity", from: report.from, to: report.to, snapshotToken: report.snapshot.token },
    } as const;
    const xlsxResponse = await f.app.request("http://localhost/api/v1/exports/xlsx", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(xlsxRequest),
    });
    assert.equal(xlsxResponse.status, 200, `${selection.name} XLSX request`);
    assert.equal(xlsxResponse.headers.get("x-selection-digest"), sha256Hex(report.snapshot.token));
    const exportId = xlsxResponse.headers.get("x-operator-export-id");
    assert.ok(exportId, `${selection.name} XLSX export id`);
    const evidence = f.database.authority.operatorXlsxExports.get(exportId);
    assert.ok(evidence, `${selection.name} XLSX evidence`);
    assert.equal(evidence.workbookVersion, 3);
    if (evidence.workbookVersion !== 3 || evidence.selection.kind !== "activity") {
      throw new Error("activity-xlsx-selection-evidence-missing");
    }
    assert.equal(evidence.selection.snapshot.from, report.from);
    assert.equal(evidence.selection.snapshot.to, report.to);
    assert.equal(evidence.selection.snapshot.authorityGeneration, report.snapshot.authorityGeneration);
    assert.equal(evidence.selection.snapshot.reportDigest, report.snapshot.reportDigest);
    const xlsxBytes = Buffer.from(await xlsxResponse.arrayBuffer());
    assert.equal(xlsxBytes.byteLength, evidence.download.byteLength);
    assert.equal(createHash("sha256").update(xlsxBytes).digest("hex"), evidence.download.sha256);

    const sheets = await readXlsxFile(xlsxBytes);
    const readMe = sheets.find((sheet) => sheet.sheet === "Read Me");
    const summary = sheets.find((sheet) => sheet.sheet === "Summary");
    const byDay = sheets.find((sheet) => sheet.sheet === "By Day");
    assert.ok(readMe);
    assert.ok(summary);
    assert.ok(byDay);
    assert.deepEqual(readMe.data.find((row) => row[0] === "Selection")?.slice(0, 2), [
      "Selection",
      `${report.from} through ${report.to}, inclusive`,
    ]);
    assert.deepEqual(readMe.data.find((row) => row[0] === "Runs")?.slice(0, 2), ["Runs", expectedRuns]);
    assert.deepEqual(summary.data.find((row) => row[0] === "Total runs")?.slice(0, 2), ["Total runs", expectedRuns]);
    assert.equal(byDay.data.slice(1).reduce((total, row) => total + Number(row[1]), 0), expectedRuns);
    assert.equal(JSON.stringify({ report, csvRows, sheets }).includes(PRIVATE_ACTIVITY_LABEL), false);
  }
});

it("binds Activity volume series into the snapshot digest for CSV and XLSX downloads",async()=>{
  const f=fixture({dynamicVolumeSeries:true});await f.artifacts.ready;
  const report=ActivityReportSelectionSchema.parse(await (await f.app.request("http://localhost/api/v1/reports/activity?from=2026-09-20&to=2026-09-20")).json());
  const generation=f.database.getMeta().authorityGeneration;
  assert.equal(report.volume.coveredRuns,report.totalRuns);

  f.setShiftVolumeSeries(true);
  const changed=ActivityReportSelectionSchema.parse(await (await f.app.request("http://localhost/api/v1/reports/activity?from=2026-09-20&to=2026-09-20")).json());
  assert.equal(f.database.getMeta().authorityGeneration,generation);
  assert.equal(changed.snapshot.authorityGeneration,report.snapshot.authorityGeneration);
  const {volume:originalVolume,snapshot:originalSnapshot,...originalCore}=report;
  const {volume:changedVolume,snapshot:changedSnapshot,...changedCore}=changed;
  assert.deepEqual(changedCore,originalCore);
  assert.deepEqual(changedVolume,shiftActivityVolumeSeries({...originalCore,volume:originalVolume}).volume);
  assert.notEqual(changedSnapshot.reportDigest,originalSnapshot.reportDigest);
  assert.notEqual(changedSnapshot.token,originalSnapshot.token);
  const {reportDigest:changedDigest,token:changedToken,...changedIdentity}=changedSnapshot;
  const {reportDigest:originalDigest,token:originalToken,...originalIdentity}=originalSnapshot;
  assert.notEqual(changedDigest,originalDigest);assert.notEqual(changedToken,originalToken);
  assert.deepEqual(changedIdentity,originalIdentity);
  assert.throws(()=>f.activity.readSelected(report.from,report.to,report.snapshot.token),/content-mismatch/u);

  const csv=await f.app.request(`http://localhost/api/v1/reports/activity.csv?${new URLSearchParams({from:report.from,to:report.to,snapshot:report.snapshot.token})}`);
  assert.equal(csv.status,409);
  const xlsxRequest={requestVersion:3,selection:{kind:"activity" as const,from:report.from,to:report.to,snapshotToken:report.snapshot.token}};
  await assert.rejects(f.xlsx.export(ActorIdSchema.parse("synthetic-operator"),xlsxRequest),/content-mismatch/u);
  const xlsx=await f.app.request("http://localhost/api/v1/exports/xlsx",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(xlsxRequest)});
  assert.equal(xlsx.status,409);
  assert.equal(f.database.getMeta().authorityGeneration,generation);
});

it("exports the complete ordered collected search values with coverage and exact snapshot ownership",async()=>{
  const f=fixture();await f.artifacts.ready;
  const query={q:"",scope:"all" as const,facets:{from:"2026-09-20",to:"2026-09-20"},limit:1};
  const page=f.search.search(query),selection={kind:"search" as const,query,snapshot:{...page.snapshot,generatedAt:page.generatedAt}};
  assert.equal(page.results.length,1);assert.equal(page.totalMatches,3);
  const response=exportSearchMetadata(f,{format:"diagnostic",selection}),text=await response.text();
  const diagnostic=JSON.parse(text) as {format:number;selection:{kind:string;query:unknown;snapshot:{generatedAt:string;authorityGeneration:number;order:string;totalMatches:number;coverage:unknown;sourceIdentity:string}};totalMatches:number;coverage:unknown;rows:{runId:string;traceId:string;runNumber:{state:string;value?:number;reason?:string}}[]};
  assert.equal(diagnostic.totalMatches,3);assert.deepEqual(diagnostic.coverage,page.coverage);assert.equal(diagnostic.rows.length,3);
  assert.equal(diagnostic.format,2);
  assert.equal(diagnostic.selection.kind,"search");
  assert.deepEqual(diagnostic.selection.query,query);
  const {sourceIdentity,...snapshotValues}=diagnostic.selection.snapshot;
  assert.match(sourceIdentity,/^[a-f0-9]{64}$/u);
  assert.deepEqual(snapshotValues,{generatedAt:page.generatedAt,authorityGeneration:page.snapshot.authorityGeneration,order:page.snapshot.order,totalMatches:page.totalMatches,coverage:page.coverage});
  assert.equal(diagnostic.rows[0]?.runId,page.results[0]?.runId);
  assert.equal(diagnostic.rows[0]?.traceId,page.results[0]?.traceId);
  assert.ok(text.includes("complete-search-diagnostic-metadata"));
  assert.ok(!text.includes("queryText\":\"omitted"));
  const csv=await exportSearchMetadata(f,{format:"csv",selection}).text();assert.match(csv,/Matches,3/u);assert.match(csv,/Run id,Trace id,Retry of,Subject,Actor/u);
  const xlsx=await f.xlsx.export(ActorIdSchema.parse("synthetic-operator"),{requestVersion:3,selection});
  const sheets=await readXlsxFile(xlsx.bytes),runs=sheets.find(sheet=>sheet.sheet==="Runs");assert.ok(runs);
  assert.equal(runs.data.length,4);assert.deepEqual(runs.data.slice(1).map(row=>row[0]),diagnostic.rows.map(row=>row.runNumber.value));
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
  const expiredCsv=await f.app.request(`http://localhost/api/v1/reports/activity.csv?${new URLSearchParams({from:report.from,to:report.to,snapshot:report.snapshot.token})}`);
  assert.equal(expiredCsv.status,409);
  const expiredRequest={requestVersion:3 as const,selection:{kind:"activity" as const,from:report.from,to:report.to,snapshotToken:report.snapshot.token}};
  await assert.rejects(f.xlsx.export(ActorIdSchema.parse("synthetic-operator"),expiredRequest),/expired/u);
  const expiredXlsx=await f.app.request("http://localhost/api/v1/exports/xlsx",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(expiredRequest)});
  assert.equal(expiredXlsx.status,409);
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

it("propagates a locally cancelled Activity request without accepting a replacement response", async () => {
  let observedSignal: AbortSignal | undefined;
  const client = createActivityQueries(createDashboardTransport({
    baseUrl: "http://localhost",
    fetchImpl: (_url, init) => new Promise<Response>((_resolve, reject) => {
      observedSignal = init?.signal ?? undefined;
      observedSignal?.addEventListener("abort", () => reject(new DOMException("request cancelled", "AbortError")), { once: true });
    }),
  }));
  const controller = new AbortController();
  const request = client.activityReport("2026-09-20", "2026-09-20", controller.signal);
  controller.abort();
  await assert.rejects(request, (error: unknown) => error instanceof DashboardClientError
    && error.kind === "network" && error.retryable);
  assert.equal(observedSignal, controller.signal);
  assert.equal(controller.signal.aborted, true);
});


it("retains complete unregistered open results and distinctive absence reasons in decoded JSON, CSV and XLSX", async () => {
  const f = fixture();
  const query = { q: "", scope: "all" as const, facets: { from: "2026-09-20", to: "2026-09-20" }, limit: 50 };
  const page = f.search.search(query);
  const results = page.results.map(result => CrossDateSearchResultSchema.parse({
    ...result,
    workflowId: "synthetic-unregistered-workflow",
    registration: { state: "unregistered", reason: "=distinct registration refusal 10800001" },
    priority: "bulk",
    runNumber: { state: "absent", reason: "distinct missing ordinal 10800002" },
    endedAt: { state: "absent", reason: "distinct open-run ending 10800003" },
    retryOf: { state: "absent", reason: "distinct retry absence 10800004" },
    metadata: { ...result.metadata, version: 23 },
  }));
  const collectedPage = { ...page, results };
  const deps = { sourceIdentity: f.sourceIdentity, search: { ...f.search, searchSelected: () => collectedPage } };
  const selection = { kind: "search" as const, query, snapshot: { ...page.snapshot, generatedAt: page.generatedAt } };
  const diagnostic: unknown = await exportSearchMetadata(deps, { format: "diagnostic", selection }).json();
  assert.ok(typeof diagnostic === "object" && diagnostic !== null && "rows" in diagnostic);
  assert.deepEqual(CrossDateSearchResultSchema.array().parse(diagnostic.rows), results);
  const csv = parseActivityCsv(await exportSearchMetadata(deps, { format: "csv", selection }).text());
  const headerIndex = csv.findIndex(row => row[0] === "Run number");
  const headers = csv[headerIndex];
  assert.ok(headers);
  const row = csv[headerIndex + 1];
  assert.ok(row);
  const csvValue = (column: string) => { const index = headers.indexOf(column); assert.ok(index >= 0, column); return row[index]; };
  assert.equal(csvValue("Workflow id"), "synthetic-unregistered-workflow");
  assert.equal(csvValue("Registration reason"), "'=distinct registration refusal 10800001");
  assert.equal(csvValue("Run number reason"), "distinct missing ordinal 10800002");
  assert.equal(csvValue("Ended at reason"), "distinct open-run ending 10800003");
  assert.equal(csvValue("Retry reason"), "distinct retry absence 10800004");
  assert.equal(csvValue("Priority"), "bulk");
  assert.equal(csvValue("Match field"), results[0]?.match.field);
  assert.equal(csvValue("Match strength"), results[0]?.match.strength);
  assert.equal(csvValue("Version"), "23");
  const bytes = await composeOperatorXlsxWorkbook(collectSearchDocument(deps, selection));
  const sheets = await readXlsxFile(bytes.bytes);
  const runs = sheets.find(sheet => sheet.sheet === "Runs");
  assert.ok(runs);
  const xlsxHeaders = runs.data[0];
  const xlsxRow = runs.data[1];
  assert.ok(xlsxHeaders && xlsxRow);
  const xlsxValue = (column: string) => { const index = xlsxHeaders.indexOf(column); assert.ok(index >= 0, column); return xlsxRow[index]; };
  assert.equal(xlsxValue("Workflow id"), "synthetic-unregistered-workflow");
  assert.equal(xlsxValue("Registration reason"), "=distinct registration refusal 10800001");
  assert.equal(xlsxValue("Registration state"), "unregistered");
  assert.equal(xlsxValue("Run number state"), "absent");
  assert.equal(xlsxValue("Run number"), "distinct missing ordinal 10800002");
  assert.equal(xlsxValue("End note"), "distinct open-run ending 10800003");
  assert.equal(xlsxValue("Retry"), "distinct retry absence 10800004");
  assert.equal(xlsxValue("Priority"), "bulk");
  assert.equal(xlsxValue("Version"), 23);
});
