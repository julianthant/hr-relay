import { createAdmissionChildFixtures } from "../../../support/helpers/storage/admission-child-fixtures.js";
import assert from "node:assert/strict";
import { type ChildProcess } from "node:child_process";
import { mkdtempSync,realpathSync,rmSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach,it,vi } from "vitest";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import * as processLocks from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";

vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, mkdirSync: vi.fn(actual.mkdirSync), lstatSync: vi.fn(actual.lstatSync) };
});

const roots: string[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
      child.kill("SIGKILL");
      await exited;
    }
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const { launch } = createAdmissionChildFixtures(children);

function initializedRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "runtime-admission-refusal-")));
  roots.push(root);
  acquireEntrypointAdmission(root, "exclusive").release();
  return root;
}

it("admits exactly one of sixteen singleton contenders paused at the same generation and preserves its owner through release", async () => {
  const root = initializedRoot();
  const locksUrl = pathToFileURL(join(process.cwd(), "src/backend/storage/sqlite/runtime-process-locks.ts")).href;
  const processLockRoot = join(root, "singleton-contention");
  const go = join(root, "publish-contenders");
  const code = `
    import { existsSync } from "node:fs";
    import { join } from "node:path";
    const { acquireRuntimeProcessLock } = await import(${JSON.stringify(locksUrl)});
    const root = process.argv[1];
    const wait = new Int32Array(new SharedArrayBuffer(4));
    try {
      const lock = acquireRuntimeProcessLock({ processLockRoot: join(root, "singleton-contention"), name: "server", pid: process.pid }, undefined, {
        afterSingletonGenerationRead() { process.send({ state: "generation-read" });
          while (!existsSync(join(root, "publish-contenders"))) Atomics.wait(wait, 0, 0, 10); }
      });
      process.on("message", () => { lock.release(); process.send({ state: "released" }); process.disconnect(); });
      process.send({ state: "held", detail: String(process.pid) });
    } catch (error) { process.send({ state: "refused", detail: error.message }); process.disconnect(); }
  `;
  const contenders = Array.from({ length: 16 }, () => launch(code, root));
  assert.deepEqual((await Promise.all(contenders.map(value => value.next()))).map(value => value.state), Array.from({ length: 16 }, () => "generation-read"));
  writeFileSync(go, "publish", { mode: 0o600, flag: "wx" });
  const results = await Promise.all(contenders.map(value => value.next()));
  const winnerIndex = results.findIndex(value => value.state === "held");
  const winner = contenders[winnerIndex];
  assert.ok(winner !== undefined);
  assert.equal(results.filter(value => value.state === "held").length, 1);
  assert.equal(results.filter(value => value.state === "refused").length, 15);
  const snapshot = processLocks.observeRuntimeLockSnapshot({ processLockRoot, sourceDatabaseIdentity: "0".repeat(64) });
  assert.equal(snapshot.processLocks.server.state, "active");
  assert.equal(snapshot.processLocks.server.state === "active" && snapshot.processLocks.server.pid, Number(results[winnerIndex]?.detail));
  winner.child.send("release"); assert.equal((await winner.next()).state, "released");
  assert.equal(processLocks.observeRuntimeLockSnapshot({ processLockRoot, sourceDatabaseIdentity: "0".repeat(64) }).processLocks.server.state, "stopped");
}, 30_000);
