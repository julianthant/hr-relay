import { SearchMetadataExportRequestSchema } from "../../../domain/dashboard/search-export.js";
import { canonicalJsonStringify } from "../../../domain/canonical-json.js";
import { collectSearchDocument } from "./operator-xlsx-export-service.js";
import { spreadsheetCsvRow } from "./spreadsheet-csv.js";
import { selectionDownload } from "./selection-download.js";

/** Explicit allowlist: identifiers, subject/actor values, query text, proofs and raw artifacts never enter bytes. */
export function exportSearchMetadata(deps: Parameters<typeof collectSearchDocument>[0], input: unknown): Response {
  const request=SearchMetadataExportRequestSchema.parse(input);
  if(request.selection.kind!=="search")throw new Error("search-export-selection-required");
  const document=collectSearchDocument(deps,request.selection),snapshot=document.selection.snapshot;
  const rows=document.results.map(result=>({
    runNumber:result.runNumber.state==="present"?result.runNumber.value:null,
    workflow:result.workflowId, registration:result.registration.state, day:result.partitionDay,
    state:result.state,shape:result.shape,dryRun:result.dryRun,version:result.metadata.version,
    enqueuedAt:result.enqueuedAt,endedAt:result.endedAt.state==="present"?result.endedAt.value:null,
    systems:result.systems, failureCode:result.metadata.failureCode,
    subjectCoverage:result.metadata.subject.state==="available"?"available":result.metadata.subject.reason,
    actorCoverage:result.metadata.actor.state==="available"?"available":result.metadata.actor.reason,
    evidence:result.metadata.evidence,
  }));
  const {subject,actor,...publicFilters}=document.selection.query.facets;
  const base=`hr-run-search-${snapshot.generatedAt.slice(0,10)}-g${String(snapshot.authorityGeneration)}`;
  if(request.format==="diagnostic")return selectionDownload(canonicalJsonStringify({
    format:1,kind:"redacted-search-diagnostic-metadata",generatedAt:snapshot.generatedAt,
    authorityGeneration:snapshot.authorityGeneration,order:snapshot.order,totalMatches:snapshot.totalMatches,
    coverage:snapshot.coverage,
    selection:{scope:document.selection.query.scope,queryText:"omitted",filters:publicFilters,subjectFilter:subject===undefined?"absent":"value omitted",actorFilter:actor===undefined?"absent":"value omitted"},
    exclusions:["subject and actor values","run, trace and retry identifiers","search text","inputs and proofs","screenshots and artifact bytes"],rows,
  }),`${base}-diagnostic.json`,"application/json; charset=utf-8",request.selection.snapshot.token);
  const csv=[
    spreadsheetCsvRow(["Run search snapshot",snapshot.generatedAt]),
    spreadsheetCsvRow(["Matches",snapshot.totalMatches]),
    spreadsheetCsvRow(["Subject unavailable",snapshot.coverage.subjectUnavailable,"Actor unavailable",snapshot.coverage.actorUnavailable]),
    spreadsheetCsvRow(["Privacy","Subject and actor values, run/trace/retry identifiers, query text and raw evidence omitted."]),
    spreadsheetCsvRow(["Order",snapshot.order]),"",
    spreadsheetCsvRow(["Run number","Workflow","Registration","Day","State","Shape","Dry run","Version","Enqueued at","Ended at","Systems","Failure code","Subject coverage","Actor coverage","Receipt","Failure","Diagnostic"]),
    ...rows.map(row=>spreadsheetCsvRow([row.runNumber===null?"Unavailable":row.runNumber,row.workflow,row.registration,row.day,row.state,row.shape,row.dryRun,row.version,
      row.enqueuedAt,row.endedAt===null?"Not terminal":row.endedAt,row.systems.join(", "),row.failureCode===null?"":row.failureCode,row.subjectCoverage,row.actorCoverage,
      row.evidence.receipt,row.evidence.failure,row.evidence.diagnostic])),
  ].join("\r\n")+"\r\n";
  return selectionDownload(csv,`${base}.csv`,"text/csv; charset=utf-8",request.selection.snapshot.token);
}
