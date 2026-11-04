import assert from "node:assert/strict";
import { lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { createWindowsPrivateFixture as fixture, setWindowsFixtureAcl as acl } from "../../support/helpers/windows-private-path-fixture.js";
import { fsyncPath, privatePathRejects, writePrivateStage } from "../../../src/backend/storage/private-path.js";
import { noSymlinkAncestry } from "../../../src/backend/storage/configuration/credential-safe-file.js";

describe.skipIf(process.platform !== "win32")("shared Windows private-path behavior on NTFS", () => {
  it("flushes an owned directory through the shared durability function", () => {
    const f = fixture();
    try {
      writeFileSync(join(f.root, "retained"), "synthetic retained bytes");
      assert.doesNotThrow(() => fsyncPath(f.root));
      assert.equal(readFileSync(join(f.root, "retained"), "utf8"), "synthetic retained bytes");
    } finally { f.close(); }
  });

  it("accepts SID-owned private inherited ACLs despite Windows mode bits", () => {
    const f = fixture(), file = join(f.root, "private");
    try {
      writeFileSync(file, "synthetic bytes");
      for (const [path, rule] of [[f.root, "directory-0700"], [file, "file-0600"]] as const) {
        const numeric = lstatSync(path);
        if (Number.isSafeInteger(numeric.ino)) assert.equal(privatePathRejects(path, numeric, rule), false);
        else assert.throws(() => privatePathRejects(path, numeric, rule), error => {
          assert.equal((error as { reason?: string }).reason, "unsafe-numeric-identity"); return true;
        });
        assert.equal(privatePathRejects(path, lstatSync(path, { bigint: true }), rule), false);
      }
      assert.equal(privatePathRejects(file, lstatSync(file, { bigint: true }), "file-0600"), false);
      const stage = join(f.root, "stage");
      writePrivateStage(stage, Buffer.from("synthetic stage"));
      assert.equal(privatePathRejects(stage, lstatSync(stage, { bigint: true }), "file-0600"), false);
      assert.equal(readFileSync(stage, "utf8"), "synthetic stage");
    } finally { f.close(); }
  });

  it("accepts trusted Windows ancestry and refuses a junction component", () => {
    const f = fixture(), real = join(f.root, "real"), alias = join(f.root, "junction");
    try {
      mkdirSync(real);
      assert.equal(noSymlinkAncestry(real, new Map()), true);
      symlinkSync(real, alias, "junction");
      assert.equal(privatePathRejects(alias, lstatSync(alias), "ancestor"), true);
      assert.throws(() => noSymlinkAncestry(alias, new Map()), /directory-integrity/u);
    } finally { f.close(); }
  });

  it("refuses broad inherited access without modifying existing bytes", () => {
    const f = fixture(), broad = join(f.root, "broad");
    try {
      mkdirSync(broad); acl(broad, true);
      const file = join(broad, "retained");
      writeFileSync(file, "synthetic retained bytes");
      assert.equal(privatePathRejects(broad, lstatSync(broad, { bigint: true }), "directory-0700"), true);
      for (const rule of ["file-0600", "group-write"] as const) {
        assert.throws(() => privatePathRejects(file, lstatSync(file, { bigint: true }), rule), error => {
          assert.equal((error as { reason?: string }).reason, "native-ancestry-unsafe");
          assert.equal((error as { code?: string }).code, "WINDOWS_PRIVATE_PATH_REFUSED");
          return true;
        });
      }
      assert.equal(readFileSync(file, "utf8"), "synthetic retained bytes");
    } finally { f.close(); }
  });
});
