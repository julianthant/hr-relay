import { chooseSelect } from "./helpers/select-choice.js";
import { expect,test,type Download,type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import readXlsxFile from "read-excel-file/node";
import { startActivitySearchAuthorityServer } from "./helpers/activity-search-authority-server.js";
import { PARITY_DIST_DIR,ensureParityBundle } from "./helpers/bundle.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { PARITY_THEMES,PARITY_VIEWPORTS,installTheme,assertThemeApplied } from "./helpers/capture.js";
import { CrossDateSearchPageSchema } from "../../src/domain/dashboard/search.js";
import { ActivityReportSelectionSchema } from "../../src/domain/dashboard/activity-selection.js";

async function bytes(download:Download) {
  const path=await download.path();if(path===null)throw new Error("download-file-unavailable");
  return readFile(path);
}
async function download(page:Page,name:string) {
  const pending=page.waitForEvent("download");await page.getByRole("button",{name,exact:true}).click();return pending;
}
for(const viewport of PARITY_VIEWPORTS)for(const theme of PARITY_THEMES) {
  const a11yName=`activity-search-${theme.name}-${viewport.name}.a11y.yml`;
  test(`production Activity/search/export ${theme.name} ${viewport.name}`,{annotation:[{type:"required-a11y-evidence",description:a11yName}]},async({page},info)=>{
    ensureParityBundle();const server=await startActivitySearchAuthorityServer({distDir:PARITY_DIST_DIR,bundle:{proof:"working-tree"}});
    const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
    try {
      const receiptQuery=new URLSearchParams({q:"",state:"done",evidence:"receipt"});
      const receiptResponse=await page.request.get(`${server.baseUrl}/api/v1/search?${receiptQuery}`);
      expect(receiptResponse.ok()).toBe(true);
      const receiptPage=CrossDateSearchPageSchema.parse(await receiptResponse.json());
      expect(receiptPage.results.some(row=>row.runId===server.runIds.doneRun&&row.state==="done"&&row.metadata.evidence.receipt)).toBe(true);
      await page.setViewportSize(viewport);await installTheme(page,theme);
      await gotoAppState(page,server.baseUrl,{day:server.day});await assertThemeApplied(page,theme);
      await page.getByRole("button",{name:"Search runs across dates"}).click();
      const search=page.getByRole("searchbox",{name:"Search run history"});
      const firstResponse=page.waitForResponse(response=>response.url().includes("/api/v1/search?")&&new URL(response.url()).searchParams.get("q")==="historical-search");
      await search.fill("historical-search");
      const first=CrossDateSearchPageSchema.parse(await (await firstResponse).json());expect(first.totalMatches).toBe(23);
      await expect(page.locator("[data-corpus-search-result]")).toHaveCount(20);
      await search.press("ArrowDown");await expect(page.locator("[data-corpus-search-result]").first()).toBeFocused();
      await page.getByRole("button",{name:"Load next 20"}).click();await expect(page.locator("[data-corpus-search-result]")).toHaveCount(23);
      const csv=await bytes(await download(page,"CSV"));expect(csv.toString()).toContain("Matches,23");expect(csv.toString()).not.toMatch(/Private Ingress|10000000/);
      const diagnostic=await bytes(await download(page,"Diagnostic metadata"));
      const exported=JSON.parse(diagnostic.toString()) as {rows:{runNumber:number}[];coverage:unknown;totalMatches:number};
      expect(exported.totalMatches).toBe(first.totalMatches);expect(exported.coverage).toEqual(first.coverage);expect(exported.rows).toHaveLength(23);
      const xlsxResponse=page.waitForResponse(response=>response.url().endsWith("/api/v1/exports/xlsx"));
      const xlsx=await bytes(await download(page,"XLSX")),response=await xlsxResponse;
      const exportId=response.headers()["x-operator-export-id"];expect(exportId).toBeTruthy();
      const evidence=server.authority().authority.operatorXlsxExports.get(exportId??"");expect(evidence).toBeDefined();
      expect(evidence?.artifact.sha256).toBe(createHash("sha256").update(xlsx).digest("hex"));
      const sheets=await readXlsxFile(xlsx),runs=sheets.find(sheet=>sheet.sheet==="Runs");expect(runs?.data.slice(1).map(row=>row[0])).toEqual(exported.rows.map(row=>row.runNumber));
      // The issued export advances authority. A later click cannot silently substitute a fresh snapshot.
      await page.getByRole("button",{name:"CSV",exact:true}).click();await expect(page.getByText("Export refused",{exact:true})).toBeVisible();
      const refreshed=page.waitForResponse(value=>value.url().includes("/api/v1/search?"));await page.getByRole("button",{name:"Refresh search"}).click();await refreshed;
      await expect(page.locator("[data-corpus-search-result]")).toHaveCount(20);
      await page.getByText("Filters · 0 selected",{exact:true}).click();
      await chooseSelect(page.getByLabel("Run shape",{exact:true}), "preview");await expect(page.locator("[data-corpus-search-result]")).toHaveCount(12);
      await page.getByRole("button",{name:"Clear filters",exact:true}).click();await expect(page.locator("[data-corpus-search-result]")).toHaveCount(20);
      await page.keyboard.press("Escape");await expect(search).toHaveValue("");await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);await expect(page.getByRole("button",{name:"Search runs across dates"})).toBeFocused();
      const reportResponse=page.waitForResponse(value=>value.url().includes("/api/v1/reports/activity?"));
      await gotoAppState(page,server.baseUrl,{day:server.day,activity:"2026-08-02..2026-08-02"});
      const report=ActivityReportSelectionSchema.parse(await (await reportResponse).json());expect(report.totalRuns).toBe(23);
      await expect(page.getByRole("button",{name:"Export CSV",exact:true})).toBeVisible();
      const activityCsv=await bytes(await download(page,"Export CSV"));expect(activityCsv.toString()).toContain("Runs in range,23");
      const activityXlsx=await bytes(await download(page,"Export XLSX")),activitySheets=await readXlsxFile(activityXlsx);
      expect(activitySheets.find(sheet=>sheet.sheet==="Summary")?.data.find(row=>row[0]==="Total runs")?.[1]).toBe(report.totalRuns);
      for(const size of [{width:1024,height:720},{width:viewport.width,height:viewport.height}]) {
        await page.setViewportSize(size);await page.getByRole("button",{name:"Refresh report"}).focus();await expect(page.getByRole("button",{name:"Refresh report"})).toBeFocused();
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
      }
      await info.attach("authority-output-correlation",{body:JSON.stringify({source:server.authority().getSourceDatabaseIdentity(),queryGeneration:first.snapshot.authorityGeneration,searchRows:exported.rows,coverage:exported.coverage,report:{range:[report.from,report.to],totalRuns:report.totalRuns,digest:report.snapshot.reportDigest},xlsxDigest:evidence?.artifact.sha256}),contentType:"application/json"});
      const tree=await page.locator("body").ariaSnapshot();
      info.annotations.push({type:`a11y-attachment-sha256:${a11yName}`,description:createHash("sha256").update(tree).digest("hex")});
      await info.attach(a11yName,{body:tree,contentType:"text/yaml"});
      await page.screenshot({path:info.outputPath("activity.png")});expect(errors).toEqual([]);
    } finally {await server.close();}
  });
}
