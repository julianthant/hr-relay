import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { testProcessImport } from "../../../support/compiled-process.js";
import { importLocalDebugLog, readLocalDebugLog } from "../../../../src/backend/storage/events/local-debug-log.js";
import { debugTimelineFixture } from "../../../support/helpers/backend/debug-timeline-fixture.js";

const CRASH_MODULE = new URL("../../../../src/backend/app/bootstrap/process-crash.ts", import.meta.url).href;
const BOOTSTRAP_MODULE = new URL("../../../../src/backend/app/bootstrap/secure-env-bootstrap.ts", import.meta.url).href;
const CREDENTIAL = "synthetic-crash-credential";

function crash(root: string, body: string, processKind = "dashboard", args: string[] = []) {
  return spawnSync(process.execPath, [...args, "--import", testProcessImport(), "--input-type=module", "--eval", `
    import { installProcessCrashHandlers } from ${JSON.stringify(CRASH_MODULE)};
    installProcessCrashHandlers({ stateRoot: ${JSON.stringify(root)}, processKind: ${JSON.stringify(processKind)}, build: "crash-test" });
    ${body}
  `], { encoding: "utf8", timeout: 10_000 });
}

it("persists one sanitized uncaught dashboard exception for import at the next start and exits non-zero", () => {
  const root = mkdtempSync(join(tmpdir(), "relay-process-crash-"));
  try {
    const child = crash(root, `setImmediate(() => { throw new TypeError("synthetic crash password=${CREDENTIAL}"); });`);
    assert.equal(child.error, undefined);
    assert.equal(child.signal, null);
    assert.equal(child.status, 1);
    const local = readLocalDebugLog(root);
    assert.equal(local.state, "present");
    if (local.state !== "present") throw new Error("crash spool required");
    assert.equal(local.records.length, 1);
    const payload = local.records[0]?.payload;
    assert.ok(payload?.kind === "debug");
    assert.equal(payload.event.area, "dashboard-process");
    assert.equal(payload.event.reason, "uncaught-exception");
    assert.equal(payload.event.phase, "failed");
    assert.equal(payload.event.build, "crash-test");
    assert.equal(payload.event.pid, child.pid);
    assert.match(payload.event.message ?? "", /^TypeError: synthetic crash password=\[removed\]$/u);
    assert.match(payload.event.stack ?? "", /TypeError: synthetic crash password=\[removed\][\s\S]+at /u);
    assert.equal(readFileSync(join(root, "logs", "boot.jsonl"), "utf8").includes(CREDENTIAL), false);
    const { repository, records } = debugTimelineFixture();
    assert.equal(importLocalDebugLog(root, repository), 1);
    assert.deepEqual(records.map(record => record.payload), [payload]);
    assert.equal(existsSync(join(root, "logs", "boot.jsonl")), false);
    assert.equal(importLocalDebugLog(root, repository), 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it.each(["strict", "warn"])("records a rejection once under Node's %s rejection policy", policy => {
  const root = mkdtempSync(join(tmpdir(), "relay-rejection-policy-"));
  try {
    const child = crash(root, 'void Promise.reject("synthetic primitive rejection");', "worker", [`--unhandled-rejections=${policy}`]);
    assert.equal(child.error, undefined);
    assert.equal(child.signal, null);
    assert.equal(child.status, 1);
    const local = readLocalDebugLog(root);
    assert.equal(local.state, "present");
    if (local.state !== "present") throw new Error("rejection policy spool required");
    assert.equal(local.records.length, 1);
    const payload = local.records[0]?.payload;
    assert.ok(payload?.kind === "debug");
    assert.equal(payload.event.reason, "unhandled-rejection");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("still exits when appending the crash event fails while the process has active work", () => {
  const root = mkdtempSync(join(tmpdir(), "relay-crash-log-failed-"));
  try {
    writeFileSync(join(root, "logs"), "not a directory");
    const child = crash(root, `setInterval(() => undefined, 1000); setImmediate(() => { throw new Error("password=${CREDENTIAL}"); });`);
    assert.equal(child.error, undefined);
    assert.equal(child.signal, null);
    assert.equal(child.status, 1);
    assert.equal(child.stderr.includes(CREDENTIAL), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("still exits when reading the error's stack throws inside the handler", () => {
  const root = mkdtempSync(join(tmpdir(), "relay-crash-stack-failed-"));
  try {
    const child = crash(root, `
      setInterval(() => undefined, 1000);
      const error = new Error("synthetic stack failure");
      Object.defineProperty(error, "stack", { get() { throw new Error("synthetic stack getter failed"); } });
      setImmediate(() => { throw error; });
    `);
    assert.equal(child.error, undefined);
    assert.equal(child.signal, null);
    assert.equal(child.status, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("persists one unhandled worker rejection with its error name and sanitized stack and exits non-zero", () => {
  const root = mkdtempSync(join(tmpdir(), "relay-process-rejection-"));
  try {
    const child = crash(root, `void Promise.reject(new RangeError("synthetic rejection token=${CREDENTIAL}"));`, "worker");
    assert.equal(child.error, undefined);
    assert.equal(child.signal, null);
    assert.equal(child.status, 1);
    const local = readLocalDebugLog(root);
    assert.equal(local.state, "present");
    if (local.state !== "present") throw new Error("rejection spool required");
    assert.equal(local.records.length, 1);
    const payload = local.records[0]?.payload;
    assert.ok(payload?.kind === "debug");
    assert.equal(payload.event.area, "worker-process");
    assert.equal(payload.event.reason, "unhandled-rejection");
    assert.equal(payload.event.pid, child.pid);
    assert.equal(payload.event.message, "RangeError: synthetic rejection token=[removed]");
    assert.match(payload.event.stack ?? "", /RangeError: synthetic rejection token=\[removed\][\s\S]+at /u);
    assert.equal(readFileSync(join(root, "logs", "boot.jsonl"), "utf8").includes(CREDENTIAL), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it.each(["dashboard", "worker"])("installs crash capture through the %s process entry", processKind => {
  const root = mkdtempSync(join(tmpdir(), "relay-bootstrap-crash-"));
  try {
    const child = spawnSync(process.execPath, ["--import", testProcessImport(), "--input-type=module", "--eval", `
      import { runSecureEnvironmentBootstrap } from ${JSON.stringify(BOOTSTRAP_MODULE)};
      await runSecureEnvironmentBootstrap(["cli", ${JSON.stringify(processKind)}], {
        acquireLifetimeLock: async () => ({ close: async () => undefined }),
        receiveLifetimeLock: async () => ({}),
        acquireAdmission: () => ({ stateRoot: ${JSON.stringify(root)}, release: () => undefined }),
        assertEnvironment: () => undefined,
        runCli: async () => {
          setImmediate(() => { throw new SyntaxError("synthetic bootstrap crash"); });
          await new Promise(() => undefined);
        },
      });
    `], { encoding: "utf8", timeout: 10_000 });
    assert.equal(child.error, undefined);
    assert.equal(child.signal, null);
    assert.equal(child.status, 1);
    const local = readLocalDebugLog(root);
    assert.equal(local.state, "present");
    if (local.state !== "present") throw new Error("bootstrap crash spool required");
    assert.equal(local.records.length, 1);
    const payload = local.records[0]?.payload;
    assert.ok(payload?.kind === "debug");
    assert.equal(payload.event.area, `${processKind}-process`);
    assert.equal(payload.event.message, "SyntaxError: synthetic bootstrap crash");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
