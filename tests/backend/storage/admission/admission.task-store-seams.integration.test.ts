import assert from "node:assert/strict";
import { mkdir,mkdtemp,rm,symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe,it } from "vitest";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";

describe("task, store, session, provider, and artifact seams", () => {

  it("rejects relative fixture roots and symlinked storage roots", async () => {
    assert.throws(() => RuntimeAdmission.syntheticRoots("relative-workspace", "relative-workspace/artifacts"),
      /fixture path must be absolute/);

    const workspace = await mkdtemp(join(tmpdir(), "hrauto-artifact-symlink-"));
    const aliasRoot = await mkdtemp(join(tmpdir(), "hrauto-artifact-alias-"));
    const outside = await mkdtemp(join(tmpdir(), "hrauto-artifact-outside-"));
    try {
      const workspaceAlias = join(aliasRoot, "workspace");
      await symlink(workspace, workspaceAlias, "dir");
      assert.throws(() => RuntimeAdmission.syntheticRoots(join(workspaceAlias, ".tracker"), join(workspaceAlias, ".tracker/data/artifacts")),
        /unsafe synthetic fixture ancestor/);

      await mkdir(join(workspace, ".tracker"));
      await symlink(outside, join(workspace, ".tracker/data"), "dir");
      assert.throws(() => RuntimeAdmission.syntheticRoots(join(workspace, ".tracker/data"), join(workspace, ".tracker/data/artifacts")),
        /unsafe synthetic fixture ancestor/);
    } finally {
      await rm(workspace, { recursive: true, force: true });
      await rm(aliasRoot, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  })
});
