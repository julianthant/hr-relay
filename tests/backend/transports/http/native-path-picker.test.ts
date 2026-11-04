import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach,beforeEach,describe,it,vi } from "vitest";
import { createNativePathPicker } from "../../../../src/backend/transports/http/native-path-picker.js";

const exec = vi.hoisted(() => vi.fn<(file: string, args: readonly string[], options: object,
  callback: (error: unknown, stdout: string, stderr: string) => void) => unknown>());
vi.mock("node:child_process", () => ({ execFile: exec }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
beforeEach(() => { vi.stubEnv("SystemRoot", "C:\\Windows"); });

function processFixture() {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), kill: vi.fn(() => true) });
  exec.mockReturnValue(child);
  function callback(error: unknown, stdout = "") {
    const complete = exec.mock.calls.at(-1)?.[3];
    assert.ok(complete, "execFile callback missing");
    complete(error, stdout, "");
  }
  return { child, callback };
}

describe("native picker process boundary (mocked child)", () => {
  it("bounds execution and sends UTF-8 JSON on stdin without a shell", async () => {
    const { child, callback } = processFixture();
    const controller = new AbortController();
    const pending = createNativePathPicker({ platform: "win32" }).pick({ field: "paths.reportsDir" }, controller.signal);
    const input: unknown = child.stdin.read();
    assert.ok(Buffer.isBuffer(input));
    assert.equal(input.toString("utf8"), '{"kind":"folder"}');
    assert.equal(child.stdin.writableEnded, true);
    assert.deepEqual(exec.mock.calls[0]?.[2], { encoding: "utf8", timeout: 120_000, killSignal: "SIGKILL",
      maxBuffer: 8192, windowsHide: true, signal: controller.signal });
    callback(null, "__HRAUTO_NATIVE_PICKER_CANCELLED__\r\n");
    child.emit("close", 0, null);
    assert.deepEqual(await pending, { state: "cancelled", field: "paths.reportsDir" });
  });

  it("retains the busy gate until an aborted helper has actually closed", async () => {
    const { child, callback } = processFixture();
    const controller = new AbortController();
    const picker = createNativePathPicker({ platform: "win32" });
    let settled = false;
    const pending = picker.pick({ field: "paths.reportsDir" }, controller.signal).then(result => { settled = true; return result; });
    controller.abort();
    assert.deepEqual(child.kill.mock.calls, [["SIGKILL"]]);
    callback({ name: "AbortError" });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(settled, false);
    assert.deepEqual(await picker.pick({ field: "paths.reportsDir" }, new AbortController().signal),
      { state: "unavailable", field: "paths.reportsDir", reason: "busy" });
    child.emit("close", null, "SIGKILL");
    assert.deepEqual(await pending, { state: "unavailable", field: "paths.reportsDir", reason: "dialog-failed" });
    assert.equal(settled, true);
  });

  it.each([
    [{ killed: true }, "timeout"],
    [{ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", killed: true }, "dialog-failed"],
    [{ code: 1 }, "dialog-failed"],
  ])("distinguishes process timeout from failure %j", async (error, reason) => {
    const { child, callback } = processFixture();
    const pending = createNativePathPicker({ platform: "win32" }).pick({ field: "paths.reportsDir" }, new AbortController().signal);
    callback(error, "__HRAUTO_NATIVE_PICKER_CANCELLED__\r\n");
    child.emit("close", 1, null);
    assert.deepEqual(await pending, { state: "unavailable", field: "paths.reportsDir", reason });
  });

  it("refuses a failed stdin write even if the helper exits successfully", async () => {
    const { child, callback } = processFixture();
    const pending = createNativePathPicker({ platform: "win32" }).pick({ field: "paths.reportsDir" }, new AbortController().signal);
    child.stdin.emit("error", new Error("synthetic pipe failure"));
    callback(null, "__HRAUTO_NATIVE_PICKER_CANCELLED__\r\n");
    child.emit("close", 0, null);
    assert.deepEqual(await pending, { state: "unavailable", field: "paths.reportsDir", reason: "dialog-failed" });
  });
});
