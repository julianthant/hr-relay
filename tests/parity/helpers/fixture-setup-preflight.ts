import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { Hono } from "hono";
import { createSoloRequestIdentityCheckpoint } from "../../../src/backend/transports/http/request-identity.js";
import { failureStatus } from "../../../src/backend/transports/http/routes/failure-status.js";
import type { DashboardApp } from "../../../src/backend/transports/http/routes/api-types.js";
import { registerSettingsPreflightRoutes } from "../../../src/backend/transports/http/routes/settings-preflight.js";
import { createFixtureBff, startFixtureServer } from "../../support/helpers/dashboard/fixture-bff.js";
import { DEFAULT_DASHBOARD_PROFILE } from "./fixture-profile.js";
import { PARITY_DIST_DIR, assertParityBundleIsCurrent, readBundleStamp } from "./bundle.js";
import { servedPreflightRuntime, type SetupScene } from "../../support/fixtures/preflight/served-runtime.js";

/** Only shell/day/static transport is synthetic; readiness HTTP is the shipped route/service/detectors. */
export async function startSetupPreflightServer(scene: SetupScene, configureRoutes?: (app: DashboardApp, runtime: Awaited<ReturnType<typeof servedPreflightRuntime>>) => void) {
  assertParityBundleIsCurrent();
  const runtime=await servedPreflightRuntime(scene);
  const shell=await startFixtureServer({distDir:PARITY_DIST_DIR,bundle:{proof:"working-tree"}});
  const app:DashboardApp=new Hono();
  const identity=createSoloRequestIdentityCheckpoint({id:"local-operator",label:"Local operator"});
  app.use("*",async(c,next)=>{c.set("requestActorId",identity.identify(c.req.raw));return next();});
  app.onError((error,c)=>{const {status,body}=failureStatus(error);return c.json(body,status);});
  registerSettingsPreflightRoutes(app,{clock:runtime.clock,preflight:runtime.service});
  app.get("/api/v1/settings/editable",c=>c.json(runtime.document()));
  configureRoutes?.(app, runtime);
  app.route("/",createFixtureBff({ profile: { ...DEFAULT_DASHBOARD_PROFILE, bootstrap: { ...DEFAULT_DASHBOARD_PROFILE.bootstrap,
    serverClock: { ...DEFAULT_DASHBOARD_PROFILE.bootstrap.serverClock, now: runtime.clock.now().toISOString() } } } }).app);
  const requests:{method:string;path:string;status:number}[]=[];
  const server=createServer((req,res)=>{
    const method=req.method??"GET",path=req.url??"/";
    if(path.startsWith("/api/")) {
      void (async()=>{
        const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(String(chunk)));
        const headers=new Headers();for(const [name,value] of Object.entries(req.headers))if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(","):value);
        const response=await app.request(`http://127.0.0.1${path}`,{method,headers,...(chunks.length===0?{}:{body:Buffer.concat(chunks)})});
        requests.push({method,path,status:response.status});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
      })().catch(()=>{res.writeHead(500).end("Setup proof request failed");});return;
    }
    const upstream=httpRequest(new URL(path,shell.baseUrl),{method},response=>{res.writeHead(response.statusCode??502,response.headers);response.pipe(res);});
    upstream.on("error",()=>{if(!res.headersSent)res.writeHead(502);res.end();});res.on("close",()=>upstream.destroy());req.pipe(upstream);
  });
  await new Promise<void>(resolve=>{server.listen(0,"127.0.0.1",resolve);});const address=server.address();assert.ok(address&&typeof address!=="string");
  return {baseUrl:`http://127.0.0.1:${String(address.port)}`,scope:runtime.scope,now:runtime.clock.now().toISOString(),requests,
    provenance:()=>({...runtime.provenance,bundle:readBundleStamp(PARITY_DIST_DIR),scene}),
    async close(){server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await shell.close();runtime.close();}};
}
