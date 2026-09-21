import { randomUUID } from "node:crypto";
import { startSeededServer } from "./seeded-bff.js";
import type { ParityBundleProof } from "./bundle.js";
import { personLookupDescriptor } from "../../helpers/registered-workflows.js";
import { runRecordOf } from "../../unit/server/helpers/dashboard-harness.js";
import { createContentAddressedArtifactWriter } from "../../../src/infra/artifacts/content-addressed-artifact-writer.js";
import { createTransactionHistory } from "../../../src/infra/sqlite/transaction-history.js";
import { composeActivity } from "../../../src/server/dashboard/compose/activity.js";
import { createCrossDateSearchService } from "../../../src/server/dashboard/queries/search.js";
import { createOperatorXlsxExportService } from "../../../src/server/dashboard/exports/operator-xlsx-export-service.js";
import { exportSearchMetadata } from "../../../src/server/dashboard/exports/search-metadata-export.js";
import type { AuthorityDatabase } from "../../../src/infra/sqlite/authority-database.js";

/** Disposable SQL authority plus production query/export services and the source-bound bundle. */
export async function startActivitySearchAuthorityServer(input:{distDir:string;bundle:ParityBundleProof}) {
  let authority:AuthorityDatabase|undefined;
  const server=await startSeededServer({...input,dateNavigation:true,prepareSelection:async({database,clock,root})=>{
    authority=database;
    const descriptors={resolve:(id:string)=>id===personLookupDescriptor.id?personLookupDescriptor:undefined};
    database.registerRunSearchDeclarations([{workflow:personLookupDescriptor.id,version:personLookupDescriptor.version,
      contractFingerprint:personLookupDescriptor.contractFingerprint,subjectProjection:personLookupDescriptor.subjectProjection??null}]);
    // Twenty-three selected rows cross the page boundary, alongside unrelated dated history.
    database.withAuthorityTransaction(()=>{
      for(let seed=4000;seed<4023;seed++)database.authority.runs.enqueue(runRecordOf({seed,runNumber:seed-3999,workflow:"historical-search",shape:seed%2===0?"preview":"operation",dryRun:true,enqueuedAt:"2026-08-02T17:00:00.000Z",displayName:"Private Ingress 10000000"}));
    });
    const sourceIdentity=database.getSourceDatabaseIdentity(),activity=composeActivity({database,clock,descriptors,ledger:createTransactionHistory(database.authority)});
    const search=createCrossDateSearchService({clock,descriptors,sourceIdentity,cursorSigningKey:new Uint8Array(32).fill(47),authority:{readSnapshot:read=>database.withAuthorityReadSnapshot(()=>read({authorityGeneration:database.getMeta().authorityGeneration,searchRuns:query=>database.authority.runs.search(query)}))}});
    const artifacts=createContentAddressedArtifactWriter({workspaceRoot:root,artifactRoot:".tracker/artifacts"});await artifacts.ready;
    return {activity,search,xlsxExports:createOperatorXlsxExportService({clock,ids:{uuid:randomUUID},sourceIdentity,artifacts,authority:database.authority.operatorXlsxExports,search,activityReport:(from,to,token)=>activity.readSelected(from,to,token)}),searchMetadataExports:{export:request=>exportSearchMetadata({search,sourceIdentity},request)}};
  }});
  return {...server,authority:()=>{if(authority===undefined)throw new Error("activity-proof-authority-unavailable");return authority;}};
}
