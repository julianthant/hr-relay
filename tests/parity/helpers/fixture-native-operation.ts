import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { FictionalFormDriver } from "./plan1-browser-operation.js";

const execute = promisify(execFile);

/** Owned fictional page; all effects and readback use native playwright-cli selectors. */
export async function startNativeOperationPage() {
  const directory = await mkdtemp(join(tmpdir(), "plan1-native-form-"));
  const session = `plan1-native-${process.pid}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Fictional employee search</title><style>body{font:14px system-ui;background:#181b20;color:#f0f1f3;margin:0;padding:32px}main{max-width:740px;margin:auto}small{color:#adb5c2}section{background:#272d36;border:1px solid #444d5a;border-radius:8px;padding:24px;margin-top:24px}label{display:block;margin-bottom:8px}input,button{font:inherit;padding:10px;border-radius:5px;border:1px solid #667080}input{background:#1e2530;color:inherit;width:250px}button{background:#eff3f8;color:#17202c;margin-left:12px}#result{border-top:1px solid #444d5a;padding-top:18px;margin-top:24px}h1{font-size:24px}h2{font-size:15px}</style></head><body><main><small>Fictional fixture · no HR system or records</small><h1>Find employee</h1><section><h2>Person Organizational Summary</h2><label for="employee">Employee ID</label><input id="employee" autocomplete="off"><button id="search">Search</button><div id="result" role="status" data-state="not-searched">No search performed</div></section></main><script>document.getElementById('search').onclick=()=>{const value=document.getElementById('employee').value;const result=document.getElementById('result');result.dataset.state=value==='10800000'?'resolved':'not-found';result.textContent=value==='10800000'?'10800000 · Fictional Employee · Demonstration · Active':'No employee found';};</script></body></html>`;
  const http = createServer((_request, response) => { response.writeHead(200, { "content-type": "text/html" }); response.end(html); });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  if (address === null || typeof address === "string") throw new Error("native-form-address-unavailable");
  const command = async (...args: string[]) => (await execute("playwright-cli", [`-s=${session}`, ...args], { timeout: 30_000 })).stdout;
  const read = async (code: string): Promise<string> => {
    const output = await command("run-code", `async page => ${code}`);
    const result = /### Result\s*\n([^\n]+)/u.exec(output)?.[1];
    if (result === undefined) throw new Error(`native-form-result-unavailable: ${output}`);
    const value: unknown = JSON.parse(result);
    if (typeof value !== "string") throw new Error("native-form-result-not-string");
    return value;
  };
  try {
    await command("open", `http://127.0.0.1:${address.port}`);
    await command("resize", "960", "640");
    await command("snapshot");
  } catch (error) {
    await new Promise<void>((resolve) => http.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  const driver: FictionalFormDriver = { system: "ucpath",
    async fillEmployee(value) { await command("run-code", `async page => await page.getByLabel('Employee ID').fill(${JSON.stringify(value)})`); },
    readEmployee: () => read("await page.getByLabel('Employee ID').inputValue()"),
    async search() { await command("run-code", "async page => await page.getByRole('button', { name: 'Search', exact: true }).click()"); },
    readResult: () => read("await page.getByRole('status').getAttribute('data-state')"),
  };
  return { driver, session,
    async screenshot() { const path = join(directory, "confirmed-search.png"); await command("screenshot", `--filename=${path}`); return { bytes: await readFile(path), width: 960, height: 640 }; },
    async close() { try { await command("close"); } finally { await new Promise<void>((resolve) => http.close(() => resolve())); await rm(directory, { recursive: true, force: true }); } },
  };
}
