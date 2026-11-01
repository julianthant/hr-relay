import assert from "node:assert/strict";
import { mkdirSync,mkdtempSync,realpathSync,rmSync,symlinkSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it } from "vitest";
import { createNativePathPicker,InvalidNativePickerHintError,type NativePickerExecutor } from "../../../../src/backend/transports/http/native-path-picker.js";
import { NativePathPickerRequestSchema } from "../../../../src/models/dashboard/native-path-picker.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function paths() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "native-path-picker-"));
  roots.push(root);
  const folder = join(root, "Folder with spaces ");
  mkdirSync(folder);
  const file = join(folder, "synthetic file.json");
  writeFileSync(file, "synthetic", { mode: 0o600 });
  return { root, folder, file };
}
const controller = () => new AbortController();

describe("native macOS path picker", () => {
  it("selects only the server-derived file or folder kind and preserves path spaces", async () => {
    const p = paths();
    const seen: Array<{ file: string; args: readonly string[] }> = [];
    const execute: NativePickerExecutor = async (file, args) => {
      seen.push({ file, args });
      return { state: "exited", code: 0, stdout: seen.length === 1 ? `${p.folder}/\n` : `${p.file}\n` };
    };
    const picker = createNativePathPicker({ platform: "darwin", execute });
    assert.deepEqual(await picker.pick({ field: "paths.stateRoot", initialPath: p.folder }, controller().signal),
      { state: "selected", field: "paths.stateRoot", path: p.folder });
    assert.deepEqual(await picker.pick({ field: "paths.i9CheckTrackerPath", initialPath: p.file }, controller().signal),
      { state: "selected", field: "paths.i9CheckTrackerPath", path: p.file });
    assert.equal(seen.length, 2);
    assert.ok(seen.every(call => call.file === "/usr/bin/osascript"));
    assert.match(seen[0]?.args[1] ?? "", /choose folder/u);
    assert.match(seen[1]?.args[1] ?? "", /choose file/u);
    assert.deepEqual(seen[0]?.args.slice(2), [p.folder]);
    assert.deepEqual(seen[1]?.args.slice(2), [p.folder]);
  });

  it("treats cancellation, failure, timeout, unsupported host and malformed output distinctly", async () => {
    const p = paths();
    const responses = [
      { state: "exited", code: 0, stdout: "__HRAUTO_NATIVE_PICKER_CANCELLED__\n" },
      { state: "failed" },
      { state: "timeout" },
      { state: "exited", code: 0, stdout: `relative/${p.file}\n` },
    ] as const;
    let calls = 0;
    const picker = createNativePathPicker({ platform: "darwin", execute: async () => responses[calls++] ?? { state: "failed" } });
    const request = { field: "paths.downloadsDir" } as const;
    assert.deepEqual(await picker.pick(request, controller().signal), { state: "cancelled", field: request.field });
    assert.deepEqual(await picker.pick(request, controller().signal), { state: "unavailable", field: request.field, reason: "dialog-failed" });
    assert.deepEqual(await picker.pick(request, controller().signal), { state: "unavailable", field: request.field, reason: "timeout" });
    assert.deepEqual(await picker.pick(request, controller().signal), { state: "unavailable", field: request.field, reason: "dialog-failed" });
    const unsupported = createNativePathPicker({ platform: "linux", execute: async () => { throw new Error("must not execute"); } });
    assert.deepEqual(await unsupported.pick(request, controller().signal),
      { state: "unavailable", field: request.field, reason: "unsupported-platform" });
    await assert.rejects(unsupported.pick({ ...request, initialPath: "relative/unsafe" }, controller().signal),
      InvalidNativePickerHintError);
  });

  it("rejects unsafe hints, omits missing hints, and refuses concurrent dialogs", async () => {
    const p = paths();
    symlinkSync(p.folder, join(p.root, "linked"));
    let release: ((value: { state: "exited"; code: 0; stdout: string }) => void) | undefined;
    const seen: string[][] = [];
    const picker = createNativePathPicker({ platform: "darwin", execute: async (_file, args) => {
      seen.push([...args]);
      return new Promise(resolve => { release = resolve; });
    } });
    await assert.rejects(picker.pick({ field: "paths.browserProfileRoot", initialPath: "relative/path" }, controller().signal), InvalidNativePickerHintError);
    await assert.rejects(picker.pick({ field: "paths.browserProfileRoot", initialPath: join(p.root, "linked") }, controller().signal), InvalidNativePickerHintError);
    const pending = picker.pick({ field: "paths.browserProfileRoot", initialPath: join(p.folder, "not-created") }, controller().signal);
    assert.deepEqual(await picker.pick({ field: "paths.browserProfileRoot" }, controller().signal),
      { state: "unavailable", field: "paths.browserProfileRoot", reason: "busy" });
    assert.deepEqual(seen[0]?.slice(2), [p.folder]);
    release?.({ state: "exited", code: 0, stdout: `${p.folder}\n` });
    assert.equal((await pending).state, "selected");
  });

  it("derives folder or file selection for all eight fields", async () => {
    const p = paths();
    const calls: string[] = [];
    const picker = createNativePathPicker({ platform: "darwin", execute: async (_file, args) => {
      const script = args[1] ?? "";
      calls.push(script.includes("choose file") ? "file" : "folder");
      return { state: "exited", code: 0, stdout: `${script.includes("choose file") ? p.file : p.folder}\n` };
    } });
    const fields = NativePathPickerRequestSchema.shape.field.options;
    for (const field of fields) {
      assert.equal((await picker.pick({ field }, controller().signal)).state, "selected");
    }
    assert.deepEqual(calls, ["folder", "folder", "folder", "folder", "folder", "folder", "folder", "file"]);
  });

  it("releases the single-dialog gate after a request aborts", async () => {
    let calls = 0;
    const picker = createNativePathPicker({ platform: "darwin", execute: async (_file, _args, signal) => {
      calls += 1;
      if (signal.aborted) return { state: "aborted" };
      return { state: "exited", code: 0, stdout: "__HRAUTO_NATIVE_PICKER_CANCELLED__\n" };
    } });
    const aborted = controller();
    aborted.abort();
    assert.equal((await picker.pick({ field: "paths.stateRoot" }, aborted.signal)).state, "unavailable");
    assert.equal((await picker.pick({ field: "paths.stateRoot" }, controller().signal)).state, "cancelled");
    assert.equal(calls, 1);
  });
});
