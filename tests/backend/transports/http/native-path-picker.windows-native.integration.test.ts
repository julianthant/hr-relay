import assert from "node:assert/strict";
import { spawn,type ChildProcess,type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it,vi } from "vitest";
import { createNativePathPicker } from "../../../../src/backend/transports/http/native-path-picker.js";
import type { NativePathPickerRequest } from "../../../../src/models/dashboard/native-path-picker.js";

const launched = vi.hoisted(() => [] as Array<{ child: ChildProcess; closed: Promise<void> }>);
vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFile: (...args: unknown[]) => {
    const child = Reflect.apply(actual.execFile, actual, args) as ChildProcess;
    const closed = new Promise<void>(resolve => { child.once("close", () => { resolve(); }); });
    launched.push({ child, closed });
    return child;
  } };
});

const driverScript = readFileSync(new URL("../../../support/fixtures/native-path-picker/drive-dialog.ps1", import.meta.url), "utf8");
const roots: string[] = [];
afterEach(() => {
  launched.length = 0;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function paths() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "native-picker-gui-"));
  roots.push(root);
  const folder = join(root, "Folder O'Brien café $(literal)");
  mkdirSync(folder);
  const file = join(folder, "Tracker O'Brien café.xlsx");
  writeFileSync(file, "synthetic");
  return { folder, file };
}

async function exercise(request: NativePathPickerRequest, action: "select" | "cancel" | "abort", path?: string) {
  const controller = new AbortController();
  let driver: ChildProcessWithoutNullStreams | undefined;
  let driverClosed: Promise<void> | undefined;
  let ready = false;
  let stdout = "";
  let stderr = "";
  let deadlineReached = false;
  const stopOwnedProcesses = () => {
    controller.abort();
    if (driver !== undefined && driver.exitCode === null && driver.signalCode === null) driver.kill("SIGKILL");
    for (const { child } of launched) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  };
  const timer = setTimeout(() => { deadlineReached = true; stopOwnedProcesses(); }, 20_000);
  const pending = createNativePathPicker().pick(request, controller.signal);
  try {
    assert.equal(launched.length, 1, "Windows picker must launch the native helper");
    const owned = launched[0];
    assert.ok(owned);
    const { child } = owned;
    const pid = child.pid;
    assert.ok(pid);
    driver = spawn(child.spawnfile, ["-NoLogo", "-NoProfile", "-NonInteractive", "-MTA", "-EncodedCommand",
      Buffer.from(driverScript, "utf16le").toString("base64")], { windowsHide: true, stdio: "pipe" });
    const driving = driver;
    driving.stdout.setEncoding("utf8");
    driving.stderr.setEncoding("utf8");
    driving.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 8192) { controller.abort(); driving.kill("SIGKILL"); }
      if (!ready && stdout.replace(/\r\n/gu, "\n").startsWith("READY\n")) {
        ready = true;
        if (action === "abort") controller.abort();
      }
    });
    driving.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 8192) { controller.abort(); driving.kill("SIGKILL"); }
    });
    driverClosed = new Promise((resolve, reject) => {
      let driverError: Error | undefined;
      driving.once("error", error => { driverError = error; });
      driving.once("close", code => {
        if (driverError !== undefined) reject(driverError);
        else if (code === 0) resolve();
        else reject(new Error(`Native picker UI driver failed (${String(code)}): ${stderr.slice(0, 8192)}`));
      });
    });
    driving.stdin.on("error", () => { controller.abort(); driving.kill("SIGKILL"); });
    driving.stdin.end(`${JSON.stringify({ pid, executable: child.spawnfile,
      kind: request.field === "paths.i9CheckTrackerPath" ? "file" : "folder", action, path })}\n`);
    const [result] = await Promise.all([pending, driverClosed]);
    assert.equal(deadlineReached, false, "native picker UI proof exceeded its bounded condition wait");
    assert.equal(ready, true, "the exact owned dialog and controls must be ready before acting");
    assert.equal(controller.signal.aborted, action === "abort");
    assert.equal(stdout.replace(/\r\n/gu, "\n"), "READY\nDONE\n");
    assert.ok(child.exitCode !== null || child.signalCode !== null, "helper must exit before picker settles");
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    return result;
  } finally {
    stopOwnedProcesses();
    await Promise.allSettled([pending, driverClosed, ...launched.map(owned => owned.closed)]);
    clearTimeout(timer);
  }
}

describe.runIf(process.platform === "win32")("Windows native picker dialogs", () => {
  it("selects the hinted Unicode and quoted folder through the actual OK control", async () => {
    const p = paths();
    assert.deepEqual(await exercise({ field: "paths.reportsDir", initialPath: p.folder }, "select"),
      { state: "selected", field: "paths.reportsDir", path: p.folder });
  });

  it("selects a Unicode and quoted file by setting the actual filename control", async () => {
    const p = paths();
    assert.deepEqual(await exercise({ field: "paths.i9CheckTrackerPath", initialPath: p.file }, "select", p.file),
      { state: "selected", field: "paths.i9CheckTrackerPath", path: p.file });
  });

  it.each(["paths.reportsDir", "paths.i9CheckTrackerPath"] as const)("returns explicit user Cancel for %s", async field => {
    const p = paths();
    assert.deepEqual(await exercise({ field, initialPath: field === "paths.reportsDir" ? p.folder : p.file }, "cancel"),
      { state: "cancelled", field });
  });

  it("aborts only after the actual owned dialog and controls are ready", async () => {
    const p = paths();
    assert.deepEqual(await exercise({ field: "paths.reportsDir", initialPath: p.folder }, "abort"),
      { state: "unavailable", field: "paths.reportsDir", reason: "dialog-failed" });
  });
});
