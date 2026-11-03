import assert from "node:assert/strict";
import { chromium } from "playwright";

const started = performance.now();
const server = await chromium.launchServer({ channel: "chromium", headless: true });
const exited = new Promise<[number | null, NodeJS.Signals | null]>(resolve => {
  server.process().once("close", (code, signal) => resolve([code, signal]));
});
let startupMs: number | undefined;
try {
  const browser = await chromium.connect(server.wsEndpoint());
  const context = await browser.newContext();
  await context.newPage();
  startupMs = Math.round(performance.now() - started);
  await context.close();
  await browser.close();
} finally {
  await server.close();
  const [code, signal] = await exited;
  assert.equal(code, 0);
  assert.equal(signal, null);
}
console.log(JSON.stringify({ event: "chromium-installation-verified", startupMs }));
