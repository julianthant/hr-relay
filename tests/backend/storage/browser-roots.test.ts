import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { assertPrivateProfilePath } from "../../../src/backend/storage/browser-roots.js";

it("rejects a private path through a symlink, a writable directory or a lexical sibling", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "browser-root-private-")));
  try {
    const owned = join(root, "owned"), directory = join(owned, "w1", "crm");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    assert.doesNotThrow(() => assertPrivateProfilePath(owned, directory));
    assert.throws(() => assertPrivateProfilePath(owned, join(root, "owned-other", "crm")));
    chmodSync(join(owned, "w1"), 0o770);
    try { assert.throws(() => assertPrivateProfilePath(owned, directory)); }
    finally { chmodSync(join(owned, "w1"), 0o700); }
    const alias = join(owned, "alias"); symlinkSync(join(owned, "w1"), alias, "dir");
    assert.throws(() => assertPrivateProfilePath(owned, join(alias, "crm")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("identifies synthetic fixture custody as having no current installation browser registry", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "browser-registry-synthetic-")));
  const admission = RuntimeAdmission.syntheticRoots(root, join(root, "artifacts"));
  try { assert.equal(admission.hasCurrentBrowserRegistry(), false); }
  finally { admission.release(); rmSync(root, { recursive: true }); }
});
