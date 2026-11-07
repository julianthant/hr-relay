import { createStorageRestoreTestWorld } from "../../../support/helpers/backend/storage-restore-world.js";
import assert from "node:assert/strict";

import { afterEach, describe, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";

const {CLOCK, composeStorageCommand, drillPaths, cleanup } = createStorageRestoreTestWorld();


afterEach(cleanup);

describe("storage diagnostics command boundary", () => {

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

});
