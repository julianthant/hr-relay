import assert from "node:assert/strict";
import { spawn,type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { afterEach,describe,it } from "vitest";
import { authorizeNativePickerDriver } from "./native-path-picker-driver.js";

const processes: Array<{ child: ChildProcessWithoutNullStreams; closed: Promise<void> }> = [];
function launch(code: string) {
  const child = spawn(process.execPath, ["-e", code], { stdio: "pipe" });
  const closed = new Promise<void>((resolve, reject) => {
    let failure: Error | undefined;
    child.once("error", error => { failure = error; });
    child.once("close", () => { if (failure === undefined) resolve(); else reject(failure); });
  });
  processes.push({ child, closed });
  return { child, closed };
}
afterEach(async () => {
  for (const { child } of processes) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  await Promise.allSettled(processes.splice(0).map(owned => owned.closed));
});
async function bindDriver() {
  const owned = launch(`
    const input = require('node:readline').createInterface({input: process.stdin});
    input.once('line', line => {
      process.stdout.write(line === 'AUTHORIZE' ? 'ACTION\\n' : 'DENIED\\n');
      input.close();
    });
    process.stdout.write('BOUND\\n');
  `);
  let output = "";
  owned.child.stdout.setEncoding("utf8");
  owned.child.stdout.on("data", (chunk: string) => { output += chunk; });
  await once(owned.child.stdout, "data");
  assert.equal(output, "BOUND\n");
  return { ...owned, output: () => output };
}

describe("native picker driver ownership authorization", () => {
  it("authorizes the bound driver while the original captured child is live", async () => {
    const original = launch("setInterval(() => {}, 1000)");
    await once(original.child, "spawn");
    const driver = await bindDriver();
    assert.equal(authorizeNativePickerDriver(original.child, driver.child.stdin, new AbortController().signal, true), true);
    await driver.closed;
    assert.equal(driver.output(), "BOUND\nACTION\n");
    assert.equal(original.child.exitCode, null);
  });

  it("never authorizes a same-executable replacement after the original captured child exits", async () => {
    const original = launch("process.exit(0)");
    await original.closed;
    const replacement = launch("setInterval(() => {}, 1000)");
    await once(replacement.child, "spawn");
    assert.equal(original.child.spawnfile, replacement.child.spawnfile);
    const driver = await bindDriver();
    const authorized = authorizeNativePickerDriver(original.child, driver.child.stdin, new AbortController().signal, true);
    await driver.closed;
    assert.equal(driver.output(), "BOUND\nDENIED\n");
    assert.equal(authorized, false);
    assert.equal(replacement.child.exitCode, null);
  });

  it.each(["aborted", "settled"] as const)("refuses binding after the request is %s", async state => {
    const original = launch("setInterval(() => {}, 1000)");
    await once(original.child, "spawn");
    const controller = new AbortController();
    if (state === "aborted") controller.abort();
    const driver = await bindDriver();
    const authorized = authorizeNativePickerDriver(original.child, driver.child.stdin, controller.signal, state !== "settled");
    await driver.closed;
    assert.equal(driver.output(), "BOUND\nDENIED\n");
    assert.equal(authorized, false);
  });
});
