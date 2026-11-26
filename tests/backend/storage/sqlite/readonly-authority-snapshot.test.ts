import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it, vi } from "vitest";
import { startupImageDigest } from "../../../../src/backend/storage/sqlite/authority-inspection.js";
import { createReadonlyAuthoritySnapshot, withReadonlyAuthoritySnapshot, withReusableReadonlyAuthoritySnapshots } from "../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";

for (const fault of ["writable", "hardlink", "foreign-owner"] as const) {
  it(`refuses a ${fault} snapshot source before starting its observer`, () => {
    const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "private-snapshot-")), path = join(root, "source.db");
    fs.writeFileSync(path, "retained source bytes", { mode: 0o600 });
    let launches = 0;
    try {
      if (fault === "writable") fs.chmodSync(path, 0o660);
      if (fault === "hardlink") fs.linkSync(path, join(root, "alias"));
      if (fault === "foreign-owner") {
        const lstat = fs.lstatSync;
        vi.spyOn(fs, "lstatSync").mockImplementation((target, options) => {
          const metadata = lstat(target, options);
          if (metadata !== undefined && target === path) metadata.uid++;
          return metadata;
        });
      }
      vi.spyOn(childProcess, "spawnSync").mockImplementation(() => { launches++; throw new Error("unexpected observer launch"); });
      syncBuiltinESMExports();
      assert.throws(() => createReadonlyAuthoritySnapshot(path), /authority-readonly-source-unsafe/u);
      assert.equal(launches, 0);
      assert.equal(fs.readFileSync(path, "utf8"), "retained source bytes");
    } finally { vi.restoreAllMocks(); syncBuiltinESMExports(); fs.rmSync(root, { recursive: true }); }
  });
}

it("shares an unchanged stopped copy, rechecks replaced sources and closes each copy after its last reader", async () => {
  const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "private-snapshot-reuse-"));
  const path = join(root, "source.db");
  fs.writeFileSync(path, "original", { mode: 0o600 });
  try {
    const freshPath = await withReusableReadonlyAuthoritySnapshots(async () => {
      const first = createReadonlyAuthoritySnapshot(path);
      const peer = await withReusableReadonlyAuthoritySnapshots(async () => createReadonlyAuthoritySnapshot(path));
      try {
        assert.equal(first.path, peer.path);
        peer.dispose();
        assert.throws(peer.assertUnchanged, /snapshot-closed/u);
        assert.equal(fs.readFileSync(first.path, "utf8"), "original");

        const replacement = join(root, "replacement");
        fs.writeFileSync(replacement, "changed", { mode: 0o600 });
        fs.renameSync(replacement, path);
        assert.throws(first.assertUnchanged, /source-changed/u);
        const fresh = createReadonlyAuthoritySnapshot(path);
        try {
          assert.notEqual(fresh.path, first.path);
          assert.equal(fs.readFileSync(fresh.path, "utf8"), "changed");
          assert.equal(fs.existsSync(first.path), true);
          first.dispose();
          assert.equal(fs.existsSync(first.path), false);
          return fresh.path;
        } finally { fresh.dispose(); }
      } finally { peer.dispose(); first.dispose(); }
    });
    assert.equal(fs.existsSync(freshPath), false);
  } finally { fs.rmSync(root, { recursive: true }); }
});

it("shares the startup digest only between readers of the same private copy", async () => {
  const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "private-snapshot-digest-"));
  const path = join(root, "source.db");
  const write = (sql: string) => {
    const database = new DatabaseSync(path);
    try { database.exec(sql); } finally { database.close(); }
  };
  try {
    write("CREATE TABLE sample(value); INSERT INTO sample VALUES(1)");
    fs.chmodSync(path, 0o600);
    const serialize = vi.spyOn(DatabaseSync.prototype, "serialize");
    try {
      await withReusableReadonlyAuthoritySnapshots(async () => {
        const first = withReadonlyAuthoritySnapshot(path, startupImageDigest);
        assert.equal(first.state, "observed");
        assert.deepEqual(withReadonlyAuthoritySnapshot(path, startupImageDigest), first);
        assert.equal(serialize.mock.calls.length, 1);
        write("UPDATE sample SET value=2");
        const changed = withReadonlyAuthoritySnapshot(path, startupImageDigest);
        assert.equal(changed.state, "observed");
        assert.notDeepEqual(changed, first);
        assert.equal(serialize.mock.calls.length, 2);
      });
    } finally { serialize.mockRestore(); }
  } finally { fs.rmSync(root, { recursive: true }); }
});
