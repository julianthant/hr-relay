import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { describe, it } from "vitest";
import { lexicallyWithin } from "../../../../src/backend/app/config/lexical-path.js";

describe("lexical containment", () => {
  const root = resolve("/workspace/state");

  it("admits the root itself and paths beneath it", () => {
    assert.equal(lexicallyWithin(root, root), true);
    assert.equal(lexicallyWithin(root, join(root, "credentials", "a.json")), true);
  });

  it("refuses parents, siblings and prefix look-alikes", () => {
    assert.equal(lexicallyWithin(root, resolve("/workspace")), false);
    assert.equal(lexicallyWithin(root, resolve("/workspace/other")), false);
    assert.equal(lexicallyWithin(root, resolve("/workspace/state-copy")), false);
  });

  it("treats a child whose name starts with two dots as contained", () => {
    assert.equal(lexicallyWithin(root, join(root, "..hidden")), true);
  });

  it.skipIf(process.platform === "win32")("treats a backslash as a file-name character on POSIX", () => {
    assert.equal(lexicallyWithin(root, `${root}/..\\name/file`), true);
    assert.equal(lexicallyWithin(root, `${root}/..\\name/file`, { refuseBackslashParent: true }), false);
  });
});
