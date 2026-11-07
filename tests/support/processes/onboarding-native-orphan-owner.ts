import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { z } from "zod";

const directory=z.string().min(1).parse(process.argv[2]);
const browser=spawn(chromium.executablePath(),["--headless=new","--no-sandbox","--disable-extensions","--no-first-run","--no-default-browser-check",
  "--disable-background-networking","--disable-component-update","--password-store=basic","--use-mock-keychain","--disable-breakpad",
  `--user-data-dir=${directory}`,"--remote-debugging-address=127.0.0.1","--remote-debugging-port=0","about:blank"],{stdio:["ignore","ignore","pipe"]});
let text="",ready=false;
browser.stderr.on("data",(chunk:unknown)=>{
  if(!(chunk instanceof Uint8Array))throw new Error("native-orphan-stderr-not-bytes");
  text+=Buffer.from(chunk).toString("utf8");
  const endpoint=/DevTools listening on (ws:\/\/127\.0\.0\.1:[0-9]+\/devtools\/browser\/[^\s]+)/u.exec(text)?.[1];
  if(!ready&&endpoint!==undefined){ready=true;process.send?.({state:"ready",directory,endpoint,browserPid:z.number().int().positive().parse(browser.pid)});text="";}
  if(text.length>65536)text="";
});
browser.once("error",()=>{process.exitCode=1;process.disconnect?.();});
browser.once("exit",()=>{if(!ready)process.exitCode=1;process.disconnect?.();});
process.once("disconnect",()=>{browser.kill("SIGTERM");});
process.on("message",value=>{if(value==="stop")browser.kill("SIGTERM");});
