import { useEffect, useRef, useState } from "react";
import type { CrossDateSearchPage, CrossDateSearchQuery } from "../../models/dashboard/search.js";
import { Button, Refusal, dsText } from "../ds/ui.js";
import { useDashboardClient } from "../state/client-context.js";
import { saveDownload } from "../lib/save-download.js";

export function SearchExportControls({page,query}:{page:CrossDateSearchPage;query:CrossDateSearchQuery}) {
  const client=useDashboardClient(),pending=useRef<AbortController|null>(null);
  const [state,setState]=useState<"idle"|"pending"|"started"|"cancelled"|"failed">("idle");
  useEffect(()=>()=>{pending.current?.abort();pending.current=null;},[page.snapshot.token]);
  const start=async(format:"xlsx"|"csv"|"diagnostic")=>{
    const controller=new AbortController();pending.current?.abort();pending.current=controller;setState("pending");
    const selection={kind:"search" as const,query,snapshot:{...page.snapshot,generatedAt:page.generatedAt}};
    try {
      const download=format==="xlsx"?await client.exportXlsx({requestVersion:3,selection},controller.signal)
        :await client.exportSearchMetadata({format,selection},page.generatedAt,controller.signal);
      if(pending.current!==controller||controller.signal.aborted)return;
      saveDownload(download);setState("started");
    } catch {if(pending.current===controller&&!controller.signal.aborted){setState("failed");}} finally {if(pending.current===controller)pending.current=null;}
  };
  return <div className="flex flex-wrap items-center gap-[var(--ds-space-snug)]" aria-label="Export selected search">
    {(["csv","xlsx","diagnostic"] as const).map(format=><Button key={format} size="sm" variant="secondary" disabled={state==="pending"||page.totalMatches>5000}
      onClick={()=>{void start(format);}}>{format==="diagnostic"?"Diagnostic metadata":format.toUpperCase()}</Button>)}
    <span className={dsText.meta}>All {page.totalMatches} matches · complete collected values; raw evidence not collected</span>
    {page.totalMatches>5000&&<span role="status">Narrow this selection to 5,000 matches before export.</span>}
    {state==="pending"&&<Button size="sm" variant="ghost" onClick={()=>{pending.current?.abort();pending.current=null;setState("cancelled");}}>Cancel download</Button>}
    {state==="started"&&<span role="status">Verified file handed to the browser.</span>}
    {state==="cancelled"&&<span role="status">Download cancelled locally. A registered XLSX export may still finish on the server.</span>}
    {state==="failed"&&<Refusal code="selection-export-refused" title="Export refused" outcome="No file was downloaded. Refresh the search and retry the reviewed selection.">The selection expired, changed, or failed verification.</Refusal>}
  </div>;
}
