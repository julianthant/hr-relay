import assert from "node:assert/strict";
import nativeCrypto from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, vi } from "vitest";
import { composeProfileCredentialInitializationInventory } from "../../../../src/backend/app/composition/profile-credential-inventory.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { createCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { createDraftDuoCredentialStore } from "../../../../src/backend/storage/configuration/duo-credential-store.js";
import { SignUpOperationSchema } from "../../../../src/models/profiles/profile.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { createSyntheticProfileSession } from "../../../support/helpers/admission-fixture.js";

for (const content of ["valid", "changed", "malformed", "foreign", "plaintext"] as const) it(`checks ${content} Duo custody without treating encrypted initials as plaintext`, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "duo-envelope-inventory-"))), machine = acquireEntrypointAdmission(root, "exclusive");
  mkdirSync(join(root, rebuildRuntimeIsolation.processLockRoot), { recursive: true, mode: 0o700 });
  const facts = { hostFacts: { primaryDisplay: null }, clock: systemClock };
  const session = createSyntheticProfileSession({ admission: machine, machineRoot: machine.stateRoot,
    initializationInventory: (admission, operation, writer, copies) => composeProfileCredentialInitializationInventory({ machine, admission, ...facts })(operation, writer, copies) });
  const draft = session.signUp({ firstName: "Fixture", lastName: "Example", email: "fixture@ucsd.edu", password: "disposable-fixture-password", createdAt: systemClock.now().toISOString() });
  assert.equal(draft.state, "onboarding");
  if (draft.state !== "onboarding") throw new Error("genuine draft required");
  const admission = machine.admitProfile(machine.issueRegisteredProfileClaim(draft.profileId));
  try {
    const randomBytes = nativeCrypto.randomBytes;
    const spy = vi.spyOn(nativeCrypto, "randomBytes").mockImplementation((size: number, callback?: (error: Error | null, bytes: Buffer<ArrayBuffer>) => void) => {
      const bytes = size === 12 ? Buffer.from("FEAAAAAAAAAAAAAA", "base64") : randomBytes(size);
      if (callback !== undefined) callback(null, bytes);
      return bytes;
    });
    syncBuiltinESMExports();
    try { createDraftDuoCredentialStore(admission, machine, draft.operationId, 1).erase(); }
    finally { spy.mockRestore(); syncBuiltinESMExports(); }
    const duoPath = join(machine.stateRoot, "machine", "duo-credentials", `${draft.profileId}.json`), bytes = readFileSync(duoPath);
    assert.ok(bytes.includes("FE"));
    const store = createCredentialStore({ admission, stateRoot: admission.stateRoot, erasureJournalAdmission: machine,
      erasureJournalPath: join(machine.stateRoot, "machine", "erasures", `${draft.profileId}.json`),
      initializationInventory: composeProfileCredentialInitializationInventory({ machine, admission, ...facts }) });
    assert.equal(store.read().entries.timekeeperName?.value, "FE");
    const operation = SignUpOperationSchema.parse(JSON.parse(readFileSync(join(machine.stateRoot, "machine", "operations", `${draft.operationId}.json`), "utf8")));
    if (content !== "valid") {
      const envelope = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
      if (content === "changed") envelope.ciphertext = "AAAA";
      if (content === "foreign") envelope.profileId = "10000000-0000-4000-8000-000000000001";
      writeFileSync(duoPath, content === "malformed" ? "{invalid" : content === "plaintext" ? "FE disposable-fixture-password" : JSON.stringify(envelope));
    }
    if (content === "valid") { store.migrateHistory({ operation }); assert.deepEqual(readFileSync(duoPath), bytes); }
    else assert.throws(() => store.migrateHistory({ operation }));
  } finally { admission.release(); await session.close(); machine.release(); rmSync(root, { recursive: true, force: true }); }
});
