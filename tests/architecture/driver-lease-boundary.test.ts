/**
 * Ref execution-and-sessions §§1,4: a driver is exclusive task-length access backed by the
 * worker's browser session — it exists ONLY inside the callback lease
 * `WorkerSessionManager.withDriver` hands out, plus the write sequencer's
 * one-way `withTransactionDriver` fence-retained arm. Nothing else in `src/` may
 * acquire a session resource, hold a driver across a lease, or construct a
 * second ownership path around the manager.
 *
 * Enforced structurally over the whole tree:
 *
 * - `withDriver(` is called only by the manager itself, the one graph
 *   interpreter (`src/backend/runtime/run-executor.ts`), and the ref write-safety write sequencer
 *   (`src/backend/runtime/write-sequencer.ts`), whose probe read lease and transaction
 *   lease are exactly the callback leases ref write-safety §3 assigns it;
 * - `withTransactionDriver(` is called only by the write sequencer, which
 *   crosses its retention boundary only after the durable fence;
 * - the browser-session factory's `.open(` — the raw resource mint — is
 *   invoked only inside `src/backend/runtime/worker-sessions.ts`;
 * - `new WorkerSessionManager(` is constructed only by the worker loop, so a
 *   task, store, or workflow cannot mint a private ownership scope.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "vitest";
import { REPO_ROOT, walkFiles } from "./helpers/guard-files.js";

function sourceFiles(): readonly { path: string; content: string }[] {
  return walkFiles(join(REPO_ROOT, "src"), { extensions: [".ts", ".tsx"] })
    .map((file) => ({
      path: relative(REPO_ROOT, file).replaceAll("\\", "/"),
      content: readFileSync(file, "utf8"),
    }));
}

describe("driver lease boundary", () => {
  it("keeps withDriver callers to the manager and the interpreter alone", () => {
    const allowed = new Set([
      "src/backend/runtime/worker-sessions.ts",
      "src/backend/runtime/run-executor.ts",
      "src/backend/runtime/write-sequencer.ts",
    ]);
    const violations = sourceFiles()
      .filter(({ path, content }) => content.includes(".withDriver(") && !allowed.has(path))
      .map(({ path }) => path);
    assert.deepEqual(violations, [], "withDriver lease acquisition leaked outside the interpreter");
  });

  it("keeps the fence-retained transaction lease exclusive to the write sequencer", () => {
    const allowed = new Set([
      "src/backend/runtime/worker-sessions.ts",
      "src/backend/runtime/write-sequencer.ts",
    ]);
    const violations = sourceFiles()
      .filter(({ path, content }) => content.includes(".withTransactionDriver(") && !allowed.has(path))
      .map(({ path }) => path);
    assert.deepEqual(violations, [], "fence-retained driver lease acquisition leaked outside write safety");
  });

  it("keeps raw browser-resource minting inside the session manager", () => {
    const violations = sourceFiles()
      .filter(({ path, content }) =>
        path !== "src/backend/runtime/worker-sessions.ts"
        && /[Ff]actory\.open\(/.test(content))
      .map(({ path }) => path);
    assert.deepEqual(violations, [], "browser-session factory open() leaked outside worker-sessions");
  });

  it("keeps WorkerSessionManager construction at the worker loop", () => {
    const allowed = new Set(["src/backend/runtime/worker-loop.ts", "src/backend/runtime/worker-sessions.ts"]);
    const violations = sourceFiles()
      .filter(({ path, content }) => content.includes("new WorkerSessionManager(") && !allowed.has(path))
      .map(({ path }) => path);
    assert.deepEqual(violations, [], "a second WorkerSessionManager ownership scope appeared");
  });

  it("proves the lease surface it guards actually exists", () => {
    // A rename would otherwise turn every scan above vacuously green.
    const manager = readFileSync(join(REPO_ROOT, "src/backend/runtime/worker-sessions.ts"), "utf8");
    assert.ok(manager.includes("async withDriver<"), "worker-sessions must own the withDriver lease");
    assert.ok(
      manager.includes("async withTransactionDriver<"),
      "worker-sessions must own the fence-retained transaction lease",
    );
    const interpreter = readFileSync(join(REPO_ROOT, "src/backend/runtime/run-executor.ts"), "utf8");
    assert.ok(interpreter.includes(".withDriver("), "the interpreter must consume the lease");
    const sequencer = readFileSync(join(REPO_ROOT, "src/backend/runtime/write-sequencer.ts"), "utf8");
    assert.ok(
      sequencer.includes(".withTransactionDriver("),
      "the write sequencer must consume the fence-retained transaction lease",
    );
    const loop = readFileSync(join(REPO_ROOT, "src/backend/runtime/worker-loop.ts"), "utf8");
    assert.ok(loop.includes("new WorkerSessionManager("), "the worker loop must own the manager");
  });
});
