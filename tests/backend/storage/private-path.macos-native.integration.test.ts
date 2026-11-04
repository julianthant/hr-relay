import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import { movePrivateDirectoryExclusive } from "../../../src/backend/storage/private-path.js";

describe.skipIf(process.platform !== "darwin")("exclusive native directory moves", () => {
  for (const occupied of [false, true]) it(`refuses an existing ${occupied ? "occupied" : "empty"} target`, () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "exclusive-move-"));
    try {
      const source = join(root, "source"), target = join(root, "target");
      mkdirSync(source, { mode: 0o700 }); mkdirSync(target, { mode: 0o700 });
      writeFileSync(join(source, "owned"), "source bytes", { mode: 0o600 });
      if (occupied) writeFileSync(join(target, "retained"), "target bytes", { mode: 0o600 });
      const identity = lstatSync(target, { bigint: true });
      assert.throws(() => movePrivateDirectoryExclusive(source, target), /private-directory-exclusive-move-refused/u);
      assert.equal(readFileSync(join(source, "owned"), "utf8"), "source bytes");
      assert.equal(lstatSync(target, { bigint: true }).ino, identity.ino);
      if (occupied) assert.equal(readFileSync(join(target, "retained"), "utf8"), "target bytes");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("moves to an absent target while preserving the directory identity and contents", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "exclusive-move-"));
    try {
      const source = join(root, "source"), target = join(root, "target"); mkdirSync(source, { mode: 0o700 });
      writeFileSync(join(source, "owned"), "source bytes", { mode: 0o600 });
      const identity = lstatSync(source, { bigint: true });
      movePrivateDirectoryExclusive(source, target);
      assert.equal(existsSync(source), false); assert.equal(lstatSync(target, { bigint: true }).ino, identity.ino);
      assert.equal(readFileSync(join(target, "owned"), "utf8"), "source bytes");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
