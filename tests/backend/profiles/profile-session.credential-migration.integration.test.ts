import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { z } from "zod";
import { FakeKeyringEntry } from "../../support/helpers/credential-keychain-fake.js";
import { createBoundProfileFixture } from "../../support/helpers/admission-fixture.js";
import { createHistoricalIncompleteProfileFixture, historicalPlaintextProtectedDocument } from "../../support/fixtures/storage/historical-incomplete-profile-fixture.js";
import { storageTree } from "../../support/helpers/integration/storage-recovery-fixture.js";
import { authenticateDocument, createCredentialStore } from "../../../src/backend/storage/configuration/credential-store.js";
import { createCanonicalCredentials } from "../../../src/backend/storage/configuration/canonical-credential-store.js";
import { RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { upgradeStoppedMachineControl } from "../../../src/backend/storage/maintenance/upgrade.js";
import { composeStoppedControlCredentialInventory } from "../../../src/backend/app/composition/profile-credential-inventory.js";
import { systemClock } from "../../../src/rules/time/clock.js";

const keySnapshot = () => createHash("sha256").update(JSON.stringify(FakeKeyringEntry.snapshot())).digest("hex");
function containsCode(error: unknown, code: string, seen = new Set<unknown>()): boolean {
  if (seen.has(error)) return false;
  seen.add(error);
  if (!(error instanceof Error)) return false;
  return "code" in error && error.code === code || containsCode(error.cause, code, seen)
    || error instanceof AggregateError && error.errors.some(cause => containsCode(cause, code, seen));
}

for (const format of [2, 3] as const) {
  it(`refuses actual historical protected schema${format} bytes through the current ordinary reader without rewriting any authority`, async () => {
    const f = await createBoundProfileFixture();
    try {
      const owner = createCanonicalCredentials(f.admission), frame = owner.readRecord("protected"); assert.ok(frame);
      const document = authenticateDocument(frame.value), path = join(f.stateRoot, "credentials", "protected.json");
      writeFileSync(path, JSON.stringify(historicalPlaintextProtectedDocument(document, format)), { mode: 0o600 });
      const before = storageTree(f.workspace), keys = keySnapshot();
      const store = createCredentialStore({ admission: f.admission, stateRoot: f.stateRoot });
      assert.throws(() => store.read(), error => containsCode(error, "CREDENTIAL_UNAVAILABLE"));
      const first = document.history[0]; assert.ok(first);
      assert.throws(() => store.ownsCommandId(first.receipt.commandId), error => containsCode(error, "CREDENTIAL_UNAVAILABLE"));
      assert.deepEqual(storageTree(f.workspace), before); assert.equal(keySnapshot(), keys);
      assert.equal(z.looseObject({ schemaVersion: z.number().int() }).parse(JSON.parse(readFileSync(path, "utf8"))).schemaVersion, format);
    } finally { await f.close(); }
  });

  it(`holds a genuine stopped protected schema${format} predecessor before native key, frame, database or control publication`, async () => {
    const f = await createHistoricalIncompleteProfileFixture({ protectedFormat: format });
    let maintenance: RuntimeAdmission | undefined;
    try {
      maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
      const before = storageTree(f.workspace), keys = keySnapshot();
      await assert.rejects(upgradeStoppedMachineControl(maintenance, { plan: false, hostFacts: { primaryDisplay: null } }, systemClock,
        composeStoppedControlCredentialInventory), error => containsCode(error, "CREDENTIAL_CONVERSION_UNSUPPORTED"));
      assert.deepEqual(storageTree(f.workspace), before); assert.equal(keySnapshot(), keys);
      assert.equal(z.looseObject({ schemaVersion: z.number().int() }).parse(JSON.parse(readFileSync(f.protectedPath, "utf8"))).schemaVersion, format);
    } finally { maintenance?.release(); await f.close(); }
  });
}

it("holds an explicitly unsupported historical wiped row before publishing a canonical head or changing source", async () => {
  const f = await createHistoricalIncompleteProfileFixture({ wiped: true });
  let maintenance: RuntimeAdmission | undefined;
  try {
    const before = storageTree(f.workspace), keys = keySnapshot();
    maintenance = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
    await assert.rejects(upgradeStoppedMachineControl(maintenance, { plan: false, hostFacts: { primaryDisplay: null } }, systemClock,
      composeStoppedControlCredentialInventory), error => containsCode(error, "CREDENTIAL_CONVERSION_UNSUPPORTED"));
    assert.deepEqual(storageTree(f.workspace), before); assert.equal(keySnapshot(), keys);
  } finally { maintenance?.release(); await f.close(); }
});
