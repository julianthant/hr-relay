import { createStorageRestoreTestWorld } from "../../../support/helpers/backend/storage-restore-world.js";
import assert from "node:assert/strict";

import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";

const {CLOCK, composeStorageCommand, drillPaths, cleanup } = createStorageRestoreTestWorld();


afterEach(cleanup);

describe("corruption → degraded → restore → rebuild, through the CLI", () => {

  it("names every storage-doctor exit-zero condition in command help", async () => {
    const paths = await drillPaths();
    const usage = await composeStorageCommand(
      rebuildRuntimeIsolation,
      [],
      CLOCK,
      paths.repoRoot,
    );
    assert.equal(usage.exitCode, 1);
    assert.match(
      usage.output,
      /authority, recovery inspection, credentials and span reconciliation are healthy; backup is reported, not gated/u,
    );
  });

  it("refuses restore without an exact named manifest", async () => {
    const paths = await drillPaths();
    const usage = await composeStorageCommand(
      rebuildRuntimeIsolation,
      ["restore"],
      CLOCK,
      paths.repoRoot,
    );
    assert.equal(usage.exitCode, 2);
    assert.match(usage.output, /requires the exact backup manifest/u);
    // A missing manifest is a refusal that names the file, never a fall-back
    // to whatever backup happens to be newest.
    const missing = await composeStorageCommand(
      rebuildRuntimeIsolation,
      ["restore", "--from", join(paths.backupDirectory, "no-such.manifest.json")],
      CLOCK,
      paths.repoRoot,
    );
    assert.equal(missing.exitCode, 1);
    assert.match(missing.output, /no-such\.manifest\.json does not exist/u);
  });
});
