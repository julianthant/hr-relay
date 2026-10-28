import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { z } from "zod";
import { onboardingProfileDirectory } from "../../../src/backend/runtime/browser/native-profile-probe.js";

const root=z.string().min(1).parse(process.argv[2]);
const owner=z.strictObject({operationId:z.uuid(),profileId:z.uuid(),accountId:z.uuid(),generation:z.number().int().positive()}).parse(JSON.parse(z.string().parse(process.argv[3])));
const directory=onboardingProfileDirectory(root,owner);
const browser=spawn(chromium.executablePath(),["--headless=new","--no-sandbox","--disable-extensions","--no-first-run","--no-default-browser-check",
  `--user-data-dir=${directory}`,"--remote-debugging-address=127.0.0.1","--remote-debugging-port=0","about:blank"],{stdio:["ignore","ignore","pipe"]});
let text="",ready=false;
browser.stderr.on("data",chunk=>{
  text+=chunk.toString();
  const endpoint=/DevTools listening on (ws:\/\/127\.0\.0\.1:[0-9]+\/devtools\/browser\/[^\s]+)/u.exec(text)?.[1];
  if(!ready&&endpoint!==undefined){ready=true;process.send?.({state:"ready",directory,endpoint});text="";}
  if(text.length>65536)text="";
});
browser.once("error",()=>{process.exitCode=1;process.disconnect?.();});
browser.once("exit",()=>{if(!ready)process.exitCode=1;process.disconnect?.();});
process.once("disconnect",()=>{browser.kill("SIGTERM");});
process.on("message",value=>{if(value==="stop")browser.kill("SIGTERM");});
