import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, vi } from "vitest";
import { readPrivateFile } from "../../../../src/backend/storage/configuration/credential-safe-file.js";

for (const label of ["authority database", "managed data"] as const) {
  it(`reads retained 0644 ${label} bytes without changing mode or identity`, () => {
    const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "safe-file-")), path = join(root, "retained");
    try {
      fs.writeFileSync(path, "retained bytes", { mode: 0o600 }); fs.chmodSync(path, 0o644);
      const before = fs.statSync(path), value = readPrivateFile(path, { label, maxBytes: 64 });
      assert.ok(value); assert.equal(value.bytes.toString(), "retained bytes");
      assert.deepEqual(value.identity, { device: before.dev, inode: before.ino });
      assert.equal(value.stat.mode, before.mode);
      assert.equal(fs.statSync(path).mode, before.mode); assert.equal(fs.statSync(path).ino, before.ino);
    } finally { fs.rmSync(root, { recursive: true }); }
  });

  for (const unsafe of ["writable", "symlink", "hardlink", "foreign-owner", "foreign-descriptor-owner"] as const) {
    it(`refuses ${unsafe} ${label} without changing its source bytes`, () => {
      const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "safe-file-")), source = join(root, "retained"), alias = join(root, "alias");
      fs.writeFileSync(source, "retained bytes", { mode: 0o600 }); fs.chmodSync(source, 0o644);
      const before = fs.statSync(source);
      let path = source;
      if (unsafe === "writable") fs.chmodSync(source, 0o664);
      if (unsafe === "symlink") { fs.symlinkSync(source, alias); path = alias; }
      if (unsafe === "hardlink") fs.linkSync(source, alias);
      const lstat = fs.lstatSync, fstat = fs.fstatSync;
      if (unsafe === "foreign-owner") vi.spyOn(fs, "lstatSync").mockImplementation((target, options) => {
        const status = lstat(target, options);
        if (status !== undefined && target === source) status.uid = (process.getuid?.() ?? 1000) + 1;
        return status;
      });
      if (unsafe === "foreign-descriptor-owner") vi.spyOn(fs, "fstatSync").mockImplementation((descriptor, options) => {
        const status = fstat(descriptor, options); status.uid = (process.getuid?.() ?? 1000) + 1; return status;
      });
      syncBuiltinESMExports();
      try {
        assert.throws(() => readPrivateFile(path, { label, maxBytes: 64 }), /permissions or identity/u);
        assert.equal(fs.readFileSync(source, "utf8"), "retained bytes");
        assert.equal(fs.statSync(source).ino, before.ino);
        assert.equal(fs.statSync(source).mode & 0o7777, unsafe === "writable" ? 0o664 : 0o644);
      } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); fs.rmSync(root, { recursive: true }); }
    });
  }
}

for (const label of ["protected.json", "lock", "ChatGPT", "Duo credential", "erasure journal"] as const) {
  it(`keeps ${label} strict 0600 despite ordinary-data support`, () => {
    const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "safe-file-")), path = join(root, "private");
    try {
      fs.writeFileSync(path, "private fixture", { mode: 0o600 });
      assert.equal(readPrivateFile(path, { label, maxBytes: 64 })?.bytes.toString(), "private fixture");
      fs.chmodSync(path, 0o644);
      assert.throws(() => readPrivateFile(path, { label, maxBytes: 64 }), /permissions|private regular file/u);
      assert.equal(fs.statSync(path).mode & 0o7777, 0o644);
    } finally { fs.rmSync(root, { recursive: true }); }
  });
}
