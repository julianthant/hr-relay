import assert from "node:assert/strict";
import nativeCrypto from "node:crypto";
import { readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { it, vi } from "vitest";
import { issueDuoCredentialPurpose, openDuoCredentialDocument } from "../../../../src/backend/storage/configuration/credential-store.js";
import { createDuoCredentialStore } from "../../../../src/backend/storage/configuration/duo-credential-store.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

it("keeps issued runtime authority fresh across independent reads and release during decrypt", async () => {
  const f = await createBoundProfileFixture();
  try {
    const purpose = issueDuoCredentialPurpose(f.admission, f.machine);
    const current = createDuoCredentialStore(f.admission, f.machine, systemClock).read();
    const bytes = readFileSync(join(f.machine.stateRoot, "machine", "duo-credentials", `${purpose.profileId}.json`));
    for (let read = 0; read < 2; read++) {
      const document = openDuoCredentialDocument(purpose, bytes, current.revision);
      assert.equal(document.revision, current.revision);
      assert.equal(document.credentials[0]?.state, "ready");
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
      assert.throws(() => openDuoCredentialDocument(purpose, bytes, current.revision), /duo-profile-custody-expired|missing or released admission/u);
      assert.equal(fired, true);
    } finally { spy.mockRestore(); syncBuiltinESMExports(); }
    assert.throws(() => openDuoCredentialDocument(purpose, bytes, current.revision), /duo-profile-custody-expired|missing or released admission/u);
  } finally { await f.close(); }
});
