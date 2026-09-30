import { SearchMetadataExportRequestSchema } from "../../../domain/dashboard/search-export.js";
import { canonicalJsonStringify } from "../../../domain/canonical-json.js";
import { collectSearchDocument } from "./operator-xlsx-export-service.js";
import { spreadsheetCsvRow } from "./spreadsheet-csv.js";
import { selectionDownload } from "./selection-download.js";

/** Export the exact collected search values; snapshot validation owns membership and ordering. */
export function exportSearchMetadata(deps: Parameters<typeof collectSearchDocument>[0], input: unknown): Response {
  const request=SearchMetadataExportRequestSchema.parse(input);
  if(request.selection.kind!=="search")throw new Error("search-export-selection-required");
  const document=collectSearchDocument(deps,request.selection),snapshot=document.selection.snapshot;
  const rows=document.results.map(result=>({
    runId: result.runId, traceId: result.traceId, retryOf: result.retryOf,
    subject: result.metadata.subject, actor: result.metadata.actor,
    runNumber:result.runNumber.state==="present"?result.runNumber.value:null,
    workflow:result.workflowId, registration:result.registration.state, day:result.partitionDay,
    state:result.state,shape:result.shape,dryRun:result.dryRun,version:result.metadata.version,
    enqueuedAt:result.enqueuedAt,endedAt:result.endedAt.state==="present"?result.endedAt.value:null,
    systems:result.systems, failureCode:result.metadata.failureCode,
    subjectCoverage:result.metadata.subject.state==="available"?"available":result.metadata.subject.reason,
    actorCoverage:result.metadata.actor.state==="available"?"available":result.metadata.actor.reason,
    evidence:result.metadata.evidence,
  }));
  const base=`hr-run-search-${snapshot.generatedAt.slice(0,10)}-g${String(snapshot.authorityGeneration)}`;
  if(request.format==="diagnostic")return selectionDownload(canonicalJsonStringify({
    format:2,kind:"complete-search-diagnostic-metadata",generatedAt:snapshot.generatedAt,
    authorityGeneration:snapshot.authorityGeneration,order:snapshot.order,totalMatches:snapshot.totalMatches,
    coverage:snapshot.coverage,
    selection:document.selection,
    exclusions:["inputs and proofs not collected by search","screenshots and artifact bytes not collected by search"],rows,
  }),`${base}-diagnostic.json`,"application/json; charset=utf-8",request.selection.snapshot.token);
  const csv=[
    spreadsheetCsvRow(["Run search snapshot",snapshot.generatedAt]),
    spreadsheetCsvRow(["Matches",snapshot.totalMatches]),
    spreadsheetCsvRow(["Subject unavailable",snapshot.coverage.subjectUnavailable,"Actor unavailable",snapshot.coverage.actorUnavailable]),
    spreadsheetCsvRow(["Search query",document.selection.query.q]),
    spreadsheetCsvRow(["Search filters",canonicalJsonStringify(document.selection.query.facets)]),
    spreadsheetCsvRow(["Coverage","Complete collected values; inputs, proofs and artifact bytes are not collected by search."]),
    spreadsheetCsvRow(["Order",snapshot.order]),"",
    spreadsheetCsvRow(["Run number","Workflow","Registration","Day","State","Shape","Dry run","Version","Enqueued at","Ended at","Systems","Failure code","Subject coverage","Actor coverage","Receipt","Failure","Diagnostic","Run id","Trace id","Retry of","Subject","Actor"]),
    ...rows.map(row=>spreadsheetCsvRow([row.runNumber===null?"Unavailable":row.runNumber,row.workflow,row.registration,row.day,row.state,row.shape,row.dryRun,row.version,
      row.enqueuedAt,row.endedAt===null?"Not terminal":row.endedAt,row.systems.join(", "),row.failureCode===null?"":row.failureCode,row.subjectCoverage,row.actorCoverage,
      row.evidence.receipt,row.evidence.failure,row.evidence.diagnostic,row.runId,row.traceId,
      row.retryOf.state === "present" ? row.retryOf.value : row.retryOf.reason,
      row.subject.state === "available" ? row.subject.value : `Unavailable: ${row.subject.reason}`,
      row.actor.state === "available" ? row.actor.value : `Unavailable: ${row.actor.reason}`])),
  ].join("\r\n")+"\r\n";
  return selectionDownload(csv,`${base}.csv`,"text/csv; charset=utf-8",request.selection.snapshot.token);
}
