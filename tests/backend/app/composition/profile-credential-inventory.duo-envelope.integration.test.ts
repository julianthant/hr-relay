import { runtimeLifetimeLock } from "../../../support/helpers/backend/runtime-lifetime.js";
import assert from "node:assert/strict";
import nativeCrypto from "node:crypto";
import nativeFs from "node:fs";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, vi } from "vitest";
import { composeProfileCredentialInitializationInventory } from "../../../../src/backend/app/composition/profile-credential-inventory.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { createCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { readProfilePublicationRegistry, type ProfilePublicationRead } from "../../../../src/backend/storage/admission/installation.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { createDraftDuoCredentialStore } from "../../../../src/backend/storage/configuration/duo-credential-store.js";
import { SignUpOperationSchema } from "../../../../src/models/profiles/profile.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { createBoundProfileFixture, createSyntheticProfileSession } from "../../../support/helpers/admission-fixture.js";
import { FakeKeyringEntry } from "../../../support/helpers/credential-keychain-fake.js";

for (const content of ["valid", "changed", "malformed", "foreign", "plaintext"] as const) it(`checks ${content} Duo custody without treating encrypted initials as plaintext`, async () => {
  const lifetime = await runtimeLifetimeLock();
  const root = realpathSync(mkdtempSync(join(tmpdir(), "duo-envelope-inventory-"))), machine = acquireEntrypointAdmission(root, "exclusive", lifetime);
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

it("validates the same key-stage publication before and after intent under one held control operation", async () => {
  const f = await createBoundProfileFixture({ pending: "storage" });
  const scopes: ProfilePublicationRead[] = [];
  const controlPath = join(f.workspace, ".tracker", "control", ".installation-mutation.lock");
  const intentPath = join(f.workspace, ".tracker", "control", "profile-publication.json");
  const operationDirectory = join(f.machine.stateRoot, "machine", "operations");
  const operationName = nativeFs.readdirSync(operationDirectory)[0]; assert.ok(operationName);
  const operation = SignUpOperationSchema.parse(JSON.parse(readFileSync(join(operationDirectory, operationName), "utf8")));
  const opens = vi.spyOn(nativeFs, "openSync");
  syncBuiltinESMExports();
  let intentObserved = false;
  try {
    AuthorityDatabase.initializeProfile(f.admission);
    const registry = f.machine.readProfileRegistry();
    const store = createCredentialStore({ admission: f.admission, stateRoot: f.stateRoot, erasureJournalAdmission: f.machine,
      erasureJournalPath: join(f.machine.stateRoot, "machine", "erasures", `${operation.profileId}.json`),
      initializationInventory: (current, writer, copies) => {
        const inventory = composeProfileCredentialInitializationInventory({ machine: f.machine, admission: f.admission,
          clock: systemClock, hostFacts: { primaryDisplay: null } })(current, writer, copies);
        return { ...inventory, revalidateBeforeKeyIntent(scope) {
          inventory.revalidateBeforeKeyIntent(scope);
          if (scope === undefined) return;
          scope.assertOperation(f.machine.stateRoot, operation.operationId);
          assert.throws(() => scope.assertOperation(f.stateRoot, operation.operationId), /scope-mismatch/u);
          assert.throws(() => scope.assertOperation(f.machine.stateRoot, nativeCrypto.randomUUID()), /scope-mismatch/u);
          assert.deepEqual(readProfilePublicationRegistry(scope), registry);
          scopes.push(scope);
        } };
      },
      hooks: {
        afterKeyStageBeforeIntent: () => opens.mockClear(),
        afterKeyStageJournal: () => { intentObserved = true; assert.equal(nativeFs.existsSync(intentPath), true); },
        afterKeyStageIntent: () => {
          assert.equal(intentObserved, true);
          assert.equal(scopes.length, 2);
          assert.equal(scopes[0], scopes[1]);
          assert.equal(opens.mock.calls.filter(([path, flags]) => String(path) === controlPath
            && typeof flags === "number" && (flags & nativeFs.constants.O_EXCL) !== 0).length, 1);
          assert.equal(nativeFs.existsSync(intentPath), false);
          const scope = scopes[0]; assert.ok(scope);
          assert.throws(() => readProfilePublicationRegistry(scope), /profile-publication-read-expired/u);
        },
      } });
    store.migrateHistory({ operation });
    assert.equal(intentObserved, true);
    assert.equal(store.read().revision, 0);
    assert.equal(nativeFs.existsSync(join(f.machine.stateRoot, "machine", "credential-keys", `${operation.profileId}.json`)), true);
    assert.equal(nativeFs.existsSync(intentPath), false);
  } finally { opens.mockRestore(); syncBuiltinESMExports(); await f.close(); }
});

it("refuses an unbound physical Duo document before creating a key stage or publication intent", async () => {
  const f = await createBoundProfileFixture({ pending: "storage" });
  try {
    AuthorityDatabase.initializeProfile(f.admission);
    const operationDirectory = join(f.machine.stateRoot, "machine", "operations");
    const name = nativeFs.readdirSync(operationDirectory)[0]; assert.ok(name);
    const operationPath = join(operationDirectory, name), operationBytes = readFileSync(operationPath);
    const operation = SignUpOperationSchema.parse(JSON.parse(operationBytes.toString("utf8")));
    const controlPath = join(f.workspace, ".tracker", "control", "profile-registry.json"), controlBytes = readFileSync(controlPath);
    const duoDirectory = join(f.machine.stateRoot, "machine", "duo-credentials");
    mkdirSync(duoDirectory, { recursive: true, mode: 0o700 });
    const duoPath = join(duoDirectory, `${operation.profileId}.json`), duoBytes = Buffer.from("{unbound-duo");
    writeFileSync(duoPath, duoBytes, { mode: 0o600, flag: "wx" });
    const keyDirectory = join(f.machine.stateRoot, "machine", "credential-keys");
    assert.equal(nativeFs.existsSync(keyDirectory), false);
    const keys = FakeKeyringEntry.snapshot();
    let keyStageEffects = 0;
    const store = createCredentialStore({ admission: f.admission, stateRoot: f.stateRoot, erasureJournalAdmission: f.machine,
      erasureJournalPath: join(f.machine.stateRoot, "machine", "erasures", `${operation.profileId}.json`),
      initializationInventory: composeProfileCredentialInitializationInventory({ machine: f.machine, admission: f.admission,
        clock: systemClock, hostFacts: { primaryDisplay: null } }),
      hooks: { beforeInitialKey: () => { keyStageEffects++; } } });

    assert.throws(() => store.migrateHistory({ operation }));

    assert.equal(keyStageEffects, 0);
    assert.equal(nativeFs.existsSync(keyDirectory), false);
    assert.equal(nativeFs.existsSync(join(f.workspace, ".tracker", "control", "profile-publication.json")), false);
    assert.deepEqual(readFileSync(duoPath), duoBytes);
    assert.deepEqual(readFileSync(operationPath), operationBytes);
    assert.deepEqual(readFileSync(controlPath), controlBytes);
    assert.deepEqual(FakeKeyringEntry.snapshot(), keys);
  } finally { await f.close(); }
});
