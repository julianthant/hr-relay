import assert from "node:assert/strict";
import { ChildProcess,spawn } from "node:child_process";
import { PassThrough } from "node:stream";
import { it,vi } from "vitest";
import { createAdmissionChildFixtures } from "./admission-child-fixtures.js";

vi.mock("node:child_process", async importOriginal => ({
  ...await importOriginal<typeof import("node:child_process")>(), spawn: vi.fn(),
}));
vi.mock("../../compiled-process.js", () => ({ testProcessImport: () => "fixture-loader" }));

function fixture() {
  const child = new ChildProcess();
  child.stderr = new PassThrough();
  vi.mocked(spawn).mockReturnValue(child);
  return createAdmissionChildFixtures([]).launch("", "fixture-root");
}

it("reads final IPC after process exit before reporting closed custody", async () => {
  const { child,next } = fixture();
  const result = next();
  child.emit("exit", 0, null);
  child.emit("message", { state: "refused", detail: "RUNTIME_ALREADY_RUNNING" });
  child.emit("close", 0, null);
  assert.deepEqual(await result, { state: "refused", detail: "RUNTIME_ALREADY_RUNNING" });
});

it("retains stderr through closure when the child sends no final IPC", async () => {
  const { child,next } = fixture();
  const result = next();
  child.emit("exit", 1, null);
  child.stderr?.emit("data", Buffer.from("fixture failure"));
  child.emit("close", 1, null);
  assert.deepEqual(await result, { state: "exited", detail: "1 fixture failure" });
});
