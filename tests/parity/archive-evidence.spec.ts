/** H keeps generic frozen facts and native files while allowing generic retained-image inspection.
 * Prove exact bytes, decode refusal, focus restoration, stationary facts and desktop access. */
import { expect,test,type Download,type Locator,type Page } from "@playwright/test";
import { resolve } from "node:path";
import { SavedArchiveReportWireSchema } from "../../src/domain/dashboard/archive.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { ensureParityBundle,PARITY_DIST_DIR } from "./helpers/bundle.js";
import { assertThemeApplied,captureParityPair,installTheme } from "./helpers/capture.js";
import {
FIXTURE_ARCHIVE_EVIDENCE_CAPTURE as CAPTURE,
FIXTURE_ARCHIVE_EVIDENCE_BYTES,
FIXTURE_ARCHIVE_EVIDENCE_RUN
} from "./helpers/fixture-archive-evidence.js";
import { FIXTURE_SAVED_REPORT } from "./helpers/fixture-archive.js";
import { startFixtureServer,type FixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_APP_VERSION,FIXTURE_DAY,FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-identity.js";
const REFERENCES=resolve(import.meta.dirname,"references");
const RUN_ID=FIXTURE_ARCHIVE_EVIDENCE_RUN.runId;
const RESOURCE_PATH=`/api/v1/archive/reports/${RUN_ID}/files/${CAPTURE.digest}`;
const BYTE_PATH=`/artifacts/v1/archive/${RUN_ID}/files/${CAPTURE.digest}`;
const FILE_NAME="Synthetic screenshot.png";
const REPORT=SavedArchiveReportWireSchema.parse({...FIXTURE_SAVED_REPORT,runId:RUN_ID,title:"Synthetic retained capture",
  sections:[{kind:"values",title:"Frozen capture facts",values:[
    {label:"Digest",value:CAPTURE.digest},{label:"Artifact",value:CAPTURE.artifactId},{label:"Bundle",value:CAPTURE.bundleId},
    {label:"Media type",value:CAPTURE.mediaType},{label:"Bytes",value:CAPTURE.byteLength},
    {label:"Dimensions",value:"1440 × 900"},{label:"Declared retention",value:"2026-09-02T09:11:00.000Z"}]}],
  files:[{name:FILE_NAME,digest:CAPTURE.digest,byteLength:CAPTURE.byteLength,mediaType:CAPTURE.mediaType,artifactIds:[CAPTURE.artifactId]}]});
let server:FixtureServer;
const fileResponse=()=>new Response(new Uint8Array(FIXTURE_ARCHIVE_EVIDENCE_BYTES).buffer,{headers:{"Content-Type":"image/png","Content-Disposition":`attachment; filename="${FILE_NAME}"`}});
let respondBytes:()=>Response|Promise<Response>=fileResponse;
test.beforeAll(async()=>{ensureParityBundle();server=await startFixtureServer({distDir:PARITY_DIST_DIR,bundle:{proof:"working-tree"},savedArchiveFileResponse:(runId,digest)=>runId===RUN_ID&&digest===CAPTURE.digest?respondBytes():new Response("unknown fixture member",{status:404})});});
test.afterAll(async()=>{await server.close();});
async function routes(page:Page) {
  respondBytes=fileResponse;
  await page.route("**/api/v1/archive/reports?*",route=>route.fulfill({json:{items:[REPORT],next:null}}));
  await page.route(`**/api/v1/archive/reports/${RUN_ID}`,route=>route.fulfill({json:REPORT}));
  await page.route(`**${RESOURCE_PATH}`,route=>route.fulfill({json:{runId:RUN_ID,digest:CAPTURE.digest,resource:{state:"available",downloadUrl:BYTE_PATH}}}));

}
async function openEvidence(page:Page) {
  await gotoAppState(page,server.baseUrl,{day:FIXTURE_DAY,archive:RUN_ID});
  const report=page.getByRole("article",{name:"Saved archive report"});
  await expect(report).toContainText(REPORT.title);
  await expect(report.getByRole("tab")).toHaveCount(0);
  await expect(report.getByRole("img")).toHaveCount(0);
  return report;
}
async function frozenFacts(report:Locator) {
  const facts=report.getByRole("region",{name:"Frozen capture facts"});
  for(const value of [CAPTURE.digest,CAPTURE.artifactId,CAPTURE.bundleId,CAPTURE.mediaType,String(CAPTURE.byteLength),"1440 × 900","Declared retention","2026-09-02T09:11:00.000Z"])await expect(facts).toContainText(value);
  await expect(facts).not.toContainText(/purged/iu);
  return facts;
}
async function downloadedBytes(download:Download) {
  expect(download.suggestedFilename()).toBe(FILE_NAME);
  const stream=await download.createReadStream();if(stream===null)throw new Error("no retained bytes");
  const chunks:Uint8Array[]=[];
  for await(const chunk of stream){if(!(chunk instanceof Uint8Array))throw new Error("non-byte chunk");chunks.push(chunk);}
  const bytes=Buffer.concat(chunks);expect(bytes).toEqual(Buffer.from(FIXTURE_ARCHIVE_EVIDENCE_BYTES));
  expect({width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)}).toEqual({width:1440,height:900});
}
async function download(page:Page,link:Locator){const pending=page.waitForEvent("download");await link.click();await downloadedBytes(await pending);}
function barrier(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};}
for(const view of [
  {viewport:{name:"1280x720",width:1280,height:720},theme:{name:"graphite-warm",attribute:"dark"}},
  {viewport:{name:"narrow-1024x768",width:1024,height:768},theme:{name:"paper-ink",attribute:"light"}},
] as const)test.describe(`${view.theme.name} @ ${view.viewport.name}`,()=>{
  test.use({viewport:{width:view.viewport.width,height:view.viewport.height}});
  test(`verified archived capture evidence ${view.theme.name} @ ${view.viewport.name}`,async({page})=>{
    await routes(page);await installTheme(page,view.theme);const report=await openEvidence(page);
    await assertThemeApplied(page,view.theme);await frozenFacts(report);
    const link=report.getByRole("link",{name:FILE_NAME});await expect(link).toHaveAttribute("href",BYTE_PATH);
    await download(page,link);
    await page.evaluate(()=>window.scrollTo(0,0));
    await captureParityPair(page,REFERENCES,{stateId:"archive-evidence",viewport:view.viewport.name,theme:view.theme.name,
      adapter:"fixture",fixtureId:"archive-evidence-verified",descriptorHash:FIXTURE_DESCRIPTOR_HASH,appVersion:FIXTURE_APP_VERSION,capturedAt:FIXTURE_DAY,variant:"default"});
  });
  test("keeps frozen metadata stationary across resource and native-byte readiness",async({page})=>{
    await routes(page);const resource=barrier(),bytes=barrier();let byteRequests=0;
    await page.route(`**${RESOURCE_PATH}`,async route=>{await resource.promise;await route.fulfill({json:{runId:RUN_ID,digest:CAPTURE.digest,resource:{state:"available",downloadUrl:BYTE_PATH}}});});
    respondBytes=async()=>{byteRequests++;await bytes.promise;return fileResponse();};
    try {
      const report=await openEvidence(page),facts=await frozenFacts(report),before=await facts.innerText();
      await expect(report.getByText(`Checking ${FILE_NAME}…`)).toBeVisible();expect(byteRequests).toBe(0);
      resource.release();const link=report.getByRole("link",{name:FILE_NAME});await expect(link).toBeVisible();
      expect(await facts.innerText()).toBe(before);expect(byteRequests).toBe(0);
      const pending=page.waitForEvent("download");await link.click({noWaitAfter:true});
      await expect.poll(()=>byteRequests).toBe(1);expect(await facts.innerText()).toBe(before);
      bytes.release();await downloadedBytes(await pending);expect(await facts.innerText()).toBe(before);
    }finally{resource.release();bytes.release();}
  });
});
test("desktop keyboard downloads natively and inspects an image with dialog focus restoration",async({page})=>{
  await routes(page);await page.setViewportSize({width:1280,height:720});
  await gotoAppState(page,server.baseUrl,{day:FIXTURE_DAY,archive:""});
  const select=page.getByRole("button",{name:REPORT.title,exact:true});await select.focus();await page.keyboard.press("Enter");
  const report=page.getByRole("article",{name:"Saved archive report"});await frozenFacts(report);
  const link=report.getByRole("link",{name:FILE_NAME});await link.focus();
  const pending=page.waitForEvent("download");await page.keyboard.press("Enter");await downloadedBytes(await pending);
  await expect(link).toBeFocused();await expect(page.getByRole("dialog")).toHaveCount(0);
  const inspect=report.getByRole("button",{name:`Inspect ${FILE_NAME}`,exact:true});
  await inspect.focus();await expect(inspect).toBeFocused();await page.keyboard.press("Enter");
  const dialog=page.getByRole("dialog",{name:FILE_NAME,exact:true});
  await expect(dialog).toBeVisible();await expect(dialog.getByRole("img",{name:FILE_NAME})).toBeVisible();
  await page.keyboard.press("Escape");await expect(dialog).toHaveCount(0);await expect(inspect).toBeFocused();
});
test("narrow desktop keeps frozen facts readable and the native download reachable",async({page})=>{
  await routes(page);await page.setViewportSize({width:1024,height:768});const report=await openEvidence(page);await frozenFacts(report);
  const link=report.getByRole("link",{name:FILE_NAME});await link.focus();await expect(link).toBeInViewport();
  const geometry=await report.evaluate(node=>({width:node.getBoundingClientRect().width,scroll:node.scrollWidth,client:node.clientWidth}));
  expect(geometry.width).toBeGreaterThan(0);expect(geometry.scroll).toBeLessThanOrEqual(geometry.client+1);
  await download(page,link);
});
for(const refusal of ["missing","corrupt","request","foreign-identity","foreign-download"] as const)test(`keeps frozen facts accessible for a visible ${refusal} refusal`,async({page})=>{
  await routes(page);
  await page.route(`**${RESOURCE_PATH}`,route=>refusal==="request" ? route.fulfill({status:503,json:{state:"error",code:"ARCHIVE_FIXTURE_UNAVAILABLE",message:"Synthetic unavailable service",retryable:true}})
    :route.fulfill({json:{runId:refusal==="foreign-identity"?"99999999-9999-4999-8999-999999999999":RUN_ID,digest:CAPTURE.digest,
      resource:refusal==="missing"?{state:"missing",reason:"Synthetic retained bytes missing"}:refusal==="corrupt"?{state:"error",message:"Synthetic retained bytes corrupt"}:{state:"available",downloadUrl:refusal==="foreign-download"?"https://example.invalid/foreign":BYTE_PATH}}}));
  const report=await openEvidence(page);await frozenFacts(report);
  await expect(report.locator('[role="status"], [role="alert"]')).toBeVisible();
  await expect(report.getByRole("link",{name:FILE_NAME})).toHaveCount(0);
  await expect(report.getByRole("img")).toHaveCount(0);
});

test("native byte failure leaves the exact frozen report available",async({page})=>{
  await routes(page);respondBytes=()=>new Response("Synthetic native byte failure",{status:503});
  const report=await openEvidence(page),facts=await frozenFacts(report),before=await facts.innerText();
  const pending=page.waitForEvent("download");await report.getByRole("link",{name:FILE_NAME}).click();
  const result=await pending;expect(await result.failure()).not.toBeNull();
  expect(await facts.innerText()).toBe(before);await expect(report).toBeVisible();
});
test("retained image inspection reports decode failure without losing the native download",async({page})=>{
  await routes(page);respondBytes=()=>new Response(Buffer.from("not an image"),{headers:{"Content-Type":"image/png"}});
  const report=await openEvidence(page);
  await report.getByRole("button",{name:`Inspect ${FILE_NAME}`,exact:true}).click();
  const dialog=page.getByRole("dialog",{name:FILE_NAME,exact:true});
  await expect(dialog.getByRole("alert")).toContainText(`${FILE_NAME}: retained image bytes could not be decoded.`);
  await page.keyboard.press("Escape");
  const link=report.getByRole("link",{name:FILE_NAME});await expect(link).toHaveAttribute("href",BYTE_PATH);
});
