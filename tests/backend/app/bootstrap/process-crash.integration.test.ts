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

it("persists an uncaught dashboard exception without HR text for import at the next start and exits non-zero", () => {
  const root = mkdtempSync(join(tmpdir(), "relay-process-crash-"));
  try {
    const hrText = "Synthetic employee River Example";
    const hrFrame = "src/synthetic/River-Example.ts:12:4";
    const child = crash(root, `setImmediate(() => {
      const error = new TypeError(${JSON.stringify(`${hrText} password=${CREDENTIAL}`)});
      error.code = "EID_SYNTHETIC_001";
      error.stack += "\\n    at /synthetic/worktree/${hrFrame}";
      throw error;
    });`);
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
    const spool = readFileSync(join(root, "logs", "boot.jsonl"), "utf8");
    assert.equal(spool.includes(CREDENTIAL), false);
    assert.equal(spool.includes(hrText), false);
    assert.equal(spool.includes(hrFrame), false);
    assert.equal(spool.includes("EID_SYNTHETIC_001"), false);
    assert.equal(payload.event.code, "INTERNAL_FAILURE");
    assert.equal(payload.event.message, undefined);
    assert.equal(payload.event.stack, undefined);
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
    assert.equal(payload.event.code, "INTERNAL_FAILURE");
    assert.equal(readFileSync(join(root, "logs", "boot.jsonl"), "utf8").includes("synthetic primitive rejection"), false);
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

it.each([
  ["uncaught-exception", "cause"], ["uncaught-exception", "stack"],
  ["unhandled-rejection", "cause"], ["unhandled-rejection", "stack"],
])("records a fatal %s and exits when inspecting its %s throws", (reason, property) => {
  const root = mkdtempSync(join(tmpdir(), "relay-crash-error-accessor-"));
  try {
    const child = crash(root, `
      setInterval(() => undefined, 1000);
      const error = new Error("synthetic crash");
      Object.defineProperty(error, ${JSON.stringify(property)}, { get() { throw new Error("synthetic error getter failed"); } });
      ${reason === "unhandled-rejection" ? "void Promise.reject(error);" : "setImmediate(() => { throw error; });"}
    `);
    assert.equal(child.error, undefined);
    assert.equal(child.signal, null);
    assert.equal(child.status, 1);
    const local = readLocalDebugLog(root);
    assert.ok(local.state === "present");
    assert.equal(local.records.length, 1);
    const payload = local.records[0]?.payload;
    assert.ok(payload?.kind === "debug");
    assert.equal(payload.event.code, "INTERNAL_FAILURE");
    assert.equal(payload.event.reason, reason);
    assert.equal(payload.event.message, reason === "unhandled-rejection" ? "rejection-details-unavailable" : undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("persists one unhandled worker rejection and exits non-zero", () => {
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
    assert.equal(payload.event.code, "INTERNAL_FAILURE");
    assert.equal(payload.event.message, "RangeError");
    assert.equal(payload.event.stack, undefined);
    assert.equal(readFileSync(join(root, "logs", "boot.jsonl"), "utf8").includes(CREDENTIAL), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("records a catalogued rejection and its Relay frames without arbitrary error text or foreign paths", () => {
  const root = mkdtempSync(join(tmpdir(), "relay-process-origin-"));
  try {
    const workerPool = new URL("../../../../src/backend/runtime/workers/worker-pool.ts", import.meta.url);
    const child = crash(root, `import { requireStoppedPool } from ${JSON.stringify(workerPool.href)};
      void Promise.resolve().then(() => {
        try { requireStoppedPool([{ state: "running", member: { workerId: "synthetic" } }]); }
        catch (error) {
          error.stack += "\\n    at /synthetic/worktree/src/synthetic/River-Example.ts:12:4";
          error.message = ${JSON.stringify(CREDENTIAL)};
          throw error;
        }
      });`);
    assert.equal(child.error, undefined);
    assert.equal(child.status, 1);
    const local = readLocalDebugLog(root);
    assert.ok(local.state === "present");
    const payload = local.records[0]?.payload;
    assert.ok(payload?.kind === "debug");
    assert.equal(payload.event.reason, "unhandled-rejection");
    assert.equal(payload.event.message, "WORKER_EXIT_UNOBSERVED <- UnknownCause");
    assert.match(payload.event.stack ?? "", /src\/backend\/runtime\/workers\/worker-pool\.ts:\d+:\d+/u);
    const spool = readFileSync(join(root, "logs", "boot.jsonl"), "utf8");
    for (const privateText of [CREDENTIAL, "River-Example", process.cwd()]) assert.ok(!spool.includes(privateText));
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
    assert.equal(payload.event.code, "INTERNAL_FAILURE");
    assert.equal(payload.event.reason, "uncaught-exception");
    assert.equal(payload.event.message, undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Select the unchanged schema-39 sweep case in task CI.
