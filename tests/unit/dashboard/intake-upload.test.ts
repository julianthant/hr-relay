// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it } from "vitest";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { SpreadsheetIntake } from "../../../src/dashboard/surfaces/intake/intake-upload.js";
import { FIXTURE_INTAKE_MAPPING } from "../../parity/helpers/fixture-intake.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
async function flush(work: () => void) { await act(async () => { work(); await Promise.resolve(); }); }
afterEach(async () => { await flush(() => root?.unmount()); root = undefined; document.body.replaceChildren(); });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function harness(respond: () => Promise<Response>) {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const opened: string[] = []; let uploads = 0;
  const client = createDashboardClient({ baseUrl: "http://intake.test", fetchImpl: () => { uploads++; return respond(); } });
  const render = async (workflowId = "person-lookup") => { await flush(() => root?.render(createElement(DashboardClientProvider, { client, children: createElement(SpreadsheetIntake, { workflowId, workflowLabel: workflowId, onOpened: id => opened.push(id) }) }))); };
  await render();
  const select = async (bytes: Promise<ArrayBuffer>) => {
    const file = new File(["fixture"], "fixture.csv", { type: "text/csv" }); Object.defineProperty(file, "arrayBuffer", { value: () => bytes });
    const input = host.querySelector('input[type="file"]'); assert.ok(input);
    Object.defineProperty(input, "files", { configurable: true, value: { length: 1, item: (index: number) => index === 0 ? file : null } });
    await flush(() => input.dispatchEvent(new Event("change", { bubbles: true })));
  };
  return { host, opened, render, select, uploads: () => uploads };
}
function accepted() { return new Response(JSON.stringify(FIXTURE_INTAKE_MAPPING), { status: 201, headers: { "content-type": "application/json" } }); }
it("opens exactly the accepted session after reading and uploading", async () => {
  const h = await harness(() => Promise.resolve(accepted())); await h.select(Promise.resolve(new ArrayBuffer(2)));
  assert.equal(h.uploads(), 1); assert.deepEqual(h.opened, [FIXTURE_INTAKE_MAPPING.intakeSessionId]);
});
it("does not send bytes whose file read finishes after Cancel unmounts the uploader", async () => {
  const bytes = deferred<ArrayBuffer>(); const h = await harness(() => Promise.resolve(accepted())); await h.select(bytes.promise);
  await flush(() => root?.unmount()); root = undefined; await flush(() => bytes.resolve(new ArrayBuffer(2)));
  assert.equal(h.uploads(), 0); assert.deepEqual(h.opened, []);
});
it.each(["unmount", "workflow"])("does not reopen after accepted upload is superseded by %s", async mode => {
  const response = deferred<Response>(); const h = await harness(() => response.promise); await h.select(Promise.resolve(new ArrayBuffer(2)));
  assert.equal(h.uploads(), 1);
  if (mode === "unmount") { await flush(() => root?.unmount()); root = undefined; } else await h.render("different-workflow");
  await flush(() => response.resolve(accepted())); assert.deepEqual(h.opened, []);
});
it("distinguishes reading from uploading and labels a lost response as uncertain", async () => {
  const bytes = deferred<ArrayBuffer>(); const response = deferred<Response>(); const h = await harness(() => response.promise);
  await h.select(bytes.promise); assert.match(h.host.textContent ?? "", /Reading the file/);
  await flush(() => bytes.resolve(new ArrayBuffer(2))); assert.match(h.host.textContent ?? "", /Uploading the file/);
  await flush(() => response.reject(new Error("synthetic lost reply")));
  assert.match(h.host.textContent ?? "", /Upload status is unknown/); assert.doesNotMatch(h.host.textContent ?? "", /never reached/);
});
it("keeps typed parser refusal and allows the same file to be selected again", async () => {
  let attempt = 0; const h = await harness(() => Promise.resolve(++attempt === 1 ? new Response(JSON.stringify({ state: "error", retryable: false, code: "malformed-workbook", message: "Synthetic malformed bytes" }), { status: 422 }) : accepted()));
  await h.select(Promise.resolve(new ArrayBuffer(2))); assert.match(h.host.textContent ?? "", /malformed-workbook/);
  await h.select(Promise.resolve(new ArrayBuffer(2))); assert.equal(h.uploads(), 2); assert.equal(h.opened.length, 1);
});
it("a failed file read sends nothing and duplicate selection does not start a second request", async () => {
  const bytes = deferred<ArrayBuffer>(); const h = await harness(() => Promise.resolve(accepted()));
  await h.select(bytes.promise); await h.select(Promise.resolve(new ArrayBuffer(2)));
  assert.equal(h.uploads(), 0); await flush(() => bytes.reject(new Error("synthetic file-read failure")));
  assert.match(h.host.textContent ?? "", /No bytes were sent/); assert.equal(h.uploads(), 0);
  await h.select(Promise.resolve(new ArrayBuffer(2))); assert.equal(h.uploads(), 1); assert.equal(h.opened.length, 1);
});
