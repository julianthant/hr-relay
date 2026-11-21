import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "vitest";
import { fixedLockRoot } from "../../../../src/backend/storage/admission/process-root.js";

describe("process lock root", () => {
  it("resolves the fixed lock root beneath the workspace", () => {
    assert.equal(fixedLockRoot(resolve("/workspace")), resolve("/workspace/.tracker/data/locks"));
  });
});
