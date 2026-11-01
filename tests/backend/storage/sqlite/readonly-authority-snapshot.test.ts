import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, vi } from "vitest";
import { createReadonlyAuthoritySnapshot } from "../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";

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
