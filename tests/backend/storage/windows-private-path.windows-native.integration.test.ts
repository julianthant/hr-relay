import assert from "node:assert/strict";
import { lstatSync, linkSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, it, vi } from "vitest";
import { createWindowsPrivateFixture, setWindowsFixtureAcl } from "../../support/helpers/windows-private-path-fixture.js";
import type { DirectoryIdentity } from "../../../src/backend/storage/configuration/credential-safe-file.js";

function intercept(actions: Readonly<Record<string, (args: readonly unknown[], invoke: () => unknown) => unknown>>): void {
  const koffi = createRequire(import.meta.url)("koffi") as typeof import("koffi");
  const load = koffi.load;
  vi.spyOn(koffi, "load").mockImplementation((path, options) => new Proxy(options === undefined ? load(path) : load(path, options), {
    get(library, property) {
      const value: unknown = Reflect.get(library, property);
      if (property !== "func" || typeof value !== "function") return value;
      return new Proxy(value, {
        apply(func, _receiver, definitions) {
          const native: unknown = Reflect.apply(func, library, definitions);
          assert.equal(typeof native, "function");
          const declaration: unknown = definitions[0];
          if (typeof declaration !== "string") return native;
          const action = Object.entries(actions).find(([name]) => declaration.includes(name))?.[1];
          if (action === undefined) return native;
          assert.ok(typeof native === "function");
          return new Proxy(native, { apply(target, receiver, args) {
            return action(args, () => Reflect.apply(target, receiver, args));
          } });
        },
      });
    },
  }));
}

describe.skipIf(process.platform !== "win32")("Windows shared native privacy failure boundaries", () => {
  it("refuses SYSTEM-owned ordinary paths while accepting their trusted ancestry", async () => {
    const { privatePathRejects } = await import("../../../src/backend/storage/private-path.js");
    const path = "C:\\Users", stats = lstatSync(path, { bigint: true });
    assert.equal(privatePathRejects(path, stats, "ancestor"), false);
    assert.equal(privatePathRejects(path, stats, "owner"), true);
  });

  it("refuses a mismatched exact witness and an unsafe numeric witness", async () => {
    const f = createWindowsPrivateFixture();
    try {
      const { privatePathRejects } = await import("../../../src/backend/storage/private-path.js");
      const exact = lstatSync(f.root, { bigint: true });
      const changed = Object.create(exact) as typeof exact;
      changed.ino = exact.ino + 1n;
      assert.throws(() => privatePathRejects(f.root, changed, "directory-0700"), error => {
        assert.equal((error as { reason?: string }).reason, "native-path-identity-changed"); return true;
      });
      const rounded = lstatSync(f.root);
      rounded.ino = Number.MAX_SAFE_INTEGER + 1;
      assert.throws(() => privatePathRejects(f.root, rounded, "directory-0700"), error => {
        assert.equal((error as { reason?: string }).reason, "unsafe-numeric-identity"); return true;
      });
    } finally { f.close(); }
  });

  it("creates protected inheritable directories before publishing stage bytes", async () => {
    const f = createWindowsPrivateFixture(), child = join(f.root, "private");
    vi.resetModules();
    let protectedAtCreation = false;
    intercept({ CreateDirectoryW: (args, invoke) => {
      assert.equal(args[0], child); assert.ok(Buffer.isBuffer(args[1]));
      const pointer = args[1].readBigUInt64LE(8);
      const koffi = createRequire(import.meta.url)("koffi") as typeof import("koffi");
      const library = koffi.load("C:\\Windows\\System32\\advapi32.dll"), flags = [0], revision = [0];
      assert.notEqual(library.func("int __stdcall GetSecurityDescriptorControl(void *, _Out_ uint16 *, _Out_ uint32 *)")(pointer, flags, revision), 0);
      assert.equal(flags[0] & 0x1004, 0x1004); protectedAtCreation = true;
      return invoke();
    } });
    try {
      const { createPrivateDirectory, privatePathRejects, writePrivateStage } = await import("../../../src/backend/storage/private-path.js");
      createPrivateDirectory(child, { mode: 0o700 });
      assert.equal(protectedAtCreation, true);
      assert.equal(privatePathRejects(child, lstatSync(child, { bigint: true }), "directory-0700"), false);
      const path = join(child, "stage");
      writePrivateStage(path, Buffer.from("synthetic private bytes"));
      assert.equal(privatePathRejects(path, lstatSync(path, { bigint: true }), "file-0600"), false);
      assert.throws(() => writePrivateStage(path, Buffer.from("replacement")), (error: NodeJS.ErrnoException) => error.code === "EEXIST");
      assert.equal(readFileSync(path, "utf8"), "synthetic private bytes");
    } finally { vi.restoreAllMocks(); vi.resetModules(); f.close(); }
  });

  it("rechecks ACLs on repeated ancestry reads and refuses stage creation in a broad parent", async () => {
    const f = createWindowsPrivateFixture(), stage = join(f.root, "stage");
    try {
      const { noSymlinkAncestry } = await import("../../../src/backend/storage/configuration/credential-safe-file.js");
      const { writePrivateStage } = await import("../../../src/backend/storage/private-path.js");
      const identities = new Map<string, DirectoryIdentity>();
      assert.equal(noSymlinkAncestry(f.root, identities), true);
      setWindowsFixtureAcl(f.root, true);
      assert.throws(() => noSymlinkAncestry(f.root, identities), /directory-integrity|Windows storage/u);
      assert.throws(() => writePrivateStage(stage, Buffer.from("must remain unpublished")), /Windows storage/u);
      assert.equal(lstatSync(stage, { throwIfNoEntry: false }), undefined);
    } finally { f.close(); }
  });

  it("rejects a hard-linked file at the existing private file read boundary", async () => {
    const f = createWindowsPrivateFixture(), path = join(f.root, "source"), alias = join(f.root, "alias");
    try {
      const { readPrivateFile } = await import("../../../src/backend/storage/configuration/credential-safe-file.js");
      const { privatePathRejects } = await import("../../../src/backend/storage/private-path.js");
      writeFileSync(path, "synthetic retained bytes"); linkSync(path, alias);
      assert.equal(privatePathRejects(path, lstatSync(path, { bigint: true }), "file-0600"), true);
      assert.throws(() => readPrivateFile(path, { label: "lock", maxBytes: 100 }), /permissions or identity/u);
      assert.equal(readFileSync(path, "utf8"), "synthetic retained bytes");
      assert.equal(lstatSync(path).nlink, 2);
    } finally { f.close(); }
  });

  it("rejects an unrecognized native reparse tag even when lstat reports a directory", async () => {
    const f = createWindowsPrivateFixture(), target = join(f.root, "target");
    mkdirSync(target);
    vi.resetModules();
    let targetHandle: unknown, changed = false;
    intercept({
      CreateFileW: (args, invoke) => {
        const result = invoke(); if (args[0] === target) targetHandle = result; return result;
      },
      GetFileInformationByHandleEx: (args, invoke) => {
        const result = invoke();
        if (args[0] === targetHandle && args[1] === 9) {
          assert.ok(Buffer.isBuffer(args[2]));
          args[2].writeUInt32LE(0x410); args[2].writeUInt32LE(0x80000042, 4); changed = true;
        }
        return result;
      },
    });
    try {
      const { privatePathRejects } = await import("../../../src/backend/storage/private-path.js");
      assert.throws(() => privatePathRejects(target, lstatSync(target, { bigint: true }), "directory-0700"), error => {
        assert.equal((error as { reason?: string }).reason, "native-reparse-refused"); return true;
      });
      assert.equal(changed, true);
    } finally { vi.restoreAllMocks(); vi.resetModules(); f.close(); }
  });

  it("retains the actual flush handle and both failures when close cannot be proved", async () => {
    const f = createWindowsPrivateFixture();
    vi.resetModules();
    let handle: unknown;
    intercept({
      FlushFileBuffers: args => { handle = args[0]; return 0; },
      CloseHandle: (args, invoke) => args[0] === handle ? 0 : invoke(),
    });
    try {
      const { fsyncPath } = await import("../../../src/backend/storage/private-path.js");
      const { AuthoritySourceClosureUnprovedError } = await import("../../../src/backend/storage/source-closure.js");
      assert.throws(() => fsyncPath(f.root), error => {
        assert.ok(error instanceof AuthoritySourceClosureUnprovedError);
        assert.deepEqual(error.errors.map((failure: { reason: string }) => failure.reason), ["native-flush-failed", "native-close-failed"]);
        return true;
      });
      assert.equal(typeof handle, "bigint");
    } finally {
      vi.restoreAllMocks(); vi.resetModules();
      if (handle !== undefined) {
        const koffi = createRequire(import.meta.url)("koffi") as typeof import("koffi");
        const library = koffi.load("C:\\Windows\\System32\\kernel32.dll");
        const flags = [0];
        assert.notEqual(library.func("int __stdcall GetHandleInformation(void *, _Out_ uint32 *)")(handle, flags), 0);
        assert.notEqual(library.func("int __stdcall CloseHandle(void *)")(handle), 0);
      }
      f.close();
    }
  });

  it("refuses a native null DACL and still closes its metadata handles", async () => {
    const f = createWindowsPrivateFixture();
    vi.resetModules();
    let changed = false;
    const opened: unknown[] = [], closed: unknown[] = [];
    intercept({
      CreateFileW: (_args, invoke) => { const handle = invoke(); opened.push(handle); return handle; },
      CloseHandle: (args, invoke) => { const result = invoke(); assert.notEqual(result, 0); closed.push(args[0]); return result; },
      GetSecurityInfo: (args, invoke) => {
        const result = invoke();
        assert.ok(Array.isArray(args[5])); args[5][0] = null; changed = true;
        return result;
      },
    });
    try {
      const { privatePathRejects } = await import("../../../src/backend/storage/private-path.js");
      assert.throws(() => privatePathRejects(f.root, lstatSync(f.root, { bigint: true }), "directory-0700"), error => {
        assert.equal((error as { reason?: string }).reason, "native-null-dacl"); return true;
      });
      assert.equal(changed, true);
      assert.ok(opened.length > 0);
      for (const handle of opened) assert.ok(closed.includes(handle));
    } finally { vi.restoreAllMocks(); vi.resetModules(); f.close(); }
  });
});
