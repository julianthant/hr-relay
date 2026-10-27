import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { recoverAbandonedAdmissionMutex } from "../../../../src/backend/storage/admission/installation.js";
import { acquireRuntimeRestoreAdmission, assertRuntimeRestoreAdmission } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

for (const problem of ["none", "missing", "malformed", "foreign", "unknown-entry"] as const) it(`recovers an established profile mutex only with intact canonical registry evidence: ${problem}`, async () => {
  const f = await createBoundProfileFixture();
  f.admission.release(); f.machine.release();
  const control = join(f.workspace, ".tracker", "control"), mutex = join(control, "admission-mutex");
  mkdirSync(mutex, { mode: 0o700 });
  const path = join(control, "profile-registry.json"), before = readFileSync(path);
  const held = acquireRuntimeRestoreAdmission({ processLockRoot: join(f.workspace, rebuildRuntimeIsolation.processLockRoot), pid: process.pid });
  try {
    assertRuntimeRestoreAdmission(held, join(f.workspace, rebuildRuntimeIsolation.processLockRoot));
    assert.throws(() => assertRuntimeRestoreAdmission({ ...held }, join(f.workspace, rebuildRuntimeIsolation.processLockRoot)));
    if (problem === "missing") unlinkSync(path);
    if (problem === "malformed") writeFileSync(path, "{}", { mode: 0o600 });
    if (problem === "foreign") writeFileSync(path, JSON.stringify({ ...JSON.parse(before.toString("utf8")) as object, installationId: randomUUID() }), { mode: 0o600 });
    if (problem === "unknown-entry") writeFileSync(join(control, "unowned.json"), "{}", { mode: 0o600 });
    if (problem === "none") {
      const result = recoverAbandonedAdmissionMutex(f.workspace, held, "empty");
      assert.equal(existsSync(result.receiptPath), true);
      assert.equal(existsSync(mutex), false);
      assert.equal(readFileSync(path).equals(before), true);
    } else {
      assert.throws(() => recoverAbandonedAdmissionMutex(f.workspace, held, "empty"));
      assert.equal(existsSync(mutex), true);
    }
  } finally { held.release(); await f.close(); }
});
