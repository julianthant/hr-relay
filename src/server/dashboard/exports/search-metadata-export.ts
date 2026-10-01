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
  const rows=document.results;
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
    spreadsheetCsvRow(["Selection",canonicalJsonStringify(document.selection)]),
    spreadsheetCsvRow(["Coverage","Complete collected values; inputs, proofs and artifact bytes are not collected by search."]),
    spreadsheetCsvRow(["Order",snapshot.order]),"",
    spreadsheetCsvRow(["Run number","Workflow id","Registration state","Workflow label","Workflow code","Category","Registration reason","Day","State","Shape","Dry run","Priority","Version","Enqueued at","Ended at","Systems","Failure code","Run number state","Run number reason","Ended at state","Ended at reason","Retry state","Retry reason","Match field","Match strength","Subject state","Subject reason","Actor state","Actor reason","Receipt","Failure","Diagnostic","Run id","Trace id","Retry of","Subject","Actor"]),
    ...rows.map(row=>spreadsheetCsvRow([
      row.runNumber.state === "present" ? row.runNumber.value : "",
      row.workflowId,row.registration.state,
      row.registration.state === "registered" ? row.registration.label : "",
      row.registration.state === "registered" ? row.registration.code : "",
      row.registration.state === "registered" ? row.registration.categoryId : "",
      row.registration.state === "unregistered" ? row.registration.reason : "",
      row.partitionDay,row.state,row.shape,row.dryRun,row.priority,row.metadata.version,
      row.enqueuedAt,row.endedAt.state === "present" ? row.endedAt.value : "",row.systems.join(", "),row.metadata.failureCode === null ? "" : row.metadata.failureCode,
      row.runNumber.state,row.runNumber.state === "absent" ? row.runNumber.reason : "",
      row.endedAt.state,row.endedAt.state === "absent" ? row.endedAt.reason : "",
      row.retryOf.state,row.retryOf.state === "absent" ? row.retryOf.reason : "",
      row.match.field,row.match.strength,
      row.metadata.subject.state,row.metadata.subject.state === "unavailable" ? row.metadata.subject.reason : "",
      row.metadata.actor.state,row.metadata.actor.state === "unavailable" ? row.metadata.actor.reason : "",
      row.metadata.evidence.receipt,row.metadata.evidence.failure,row.metadata.evidence.diagnostic,row.runId,row.traceId,
      row.retryOf.state === "present" ? row.retryOf.value : "",
      row.metadata.subject.state === "available" ? row.metadata.subject.value : "",
      row.metadata.actor.state === "available" ? row.metadata.actor.value : "",
    ])),
  ].join("\r\n")+"\r\n";
  return selectionDownload(csv,`${base}.csv`,"text/csv; charset=utf-8",request.selection.snapshot.token);
}
