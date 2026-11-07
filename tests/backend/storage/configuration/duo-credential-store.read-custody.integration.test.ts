import assert from "node:assert/strict";
import nativeCrypto from "node:crypto";
import { readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { it, vi } from "vitest";
import { createDuoCredentialStore } from "../../../../src/backend/storage/configuration/duo-credential-store.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

it("keeps issued runtime authority fresh across independent reads and release during decrypt", async () => {
  const f = await createBoundProfileFixture();
  const released = (error: unknown): boolean => {
    const seen = new Set<unknown>(); let value = error;
    while (value instanceof Error && !seen.has(value)) {
      seen.add(value);
      if (value.message === "runtime-admission: missing or released admission") return true;
      value = value.cause;
    }
    return false;
  };
  try {
    const current = createDuoCredentialStore(f.admission, systemClock).read();
    const bytes = readFileSync(join(f.machine.stateRoot, "machine", "duo-credentials", `${f.admission.profileBinding.profileId}.json`));
    for (let read = 0; read < 2; read++) {
      const document = createDuoCredentialStore(f.admission, systemClock).read();
      assert.equal(document.revision, current.revision);
      assert.equal(document.credentials[0]?.state, "ready");
      assert.deepEqual(readFileSync(join(f.machine.stateRoot, "machine", "duo-credentials", `${f.admission.profileBinding.profileId}.json`)), bytes);
    }
    let fired = false;
    const decipher = nativeCrypto.createDecipheriv;
    const spy = vi.spyOn(nativeCrypto, "createDecipheriv").mockImplementation((...args: Parameters<typeof decipher>) => {
      const result = decipher(...args);
      if (!fired) { fired = true; f.admission.release(); }
      return result;
    });
    syncBuiltinESMExports();
    try {
      assert.throws(() => createDuoCredentialStore(f.admission, systemClock).read(), released);
      assert.equal(fired, true);
    } finally { spy.mockRestore(); syncBuiltinESMExports(); }
    assert.throws(() => createDuoCredentialStore(f.admission, systemClock).read(), released);
  } finally { await f.close(); }
});
