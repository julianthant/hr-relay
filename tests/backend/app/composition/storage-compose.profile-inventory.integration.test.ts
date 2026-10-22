import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { admitDirectWorker } from "../../../../src/backend/storage/sqlite/worker-slots.js";
import { bindWorkerProcessAdmission } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { workerProfileDirectory } from "../../../../src/backend/runtime/browser/browser-session-factory.js";
import { join } from "node:path";
import { it } from "vitest";
import { composeProfileCredentialInventory, composeSelectedProfileStorage, scanProfileCredentialCopy } from "../../../../src/backend/app/composition/storage-compose.js";
import { appendEmergencyFault } from "../../../../src/backend/logs/emergency-faults.js";
import { createCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { AuthorityBackupService } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { createProfileSession } from "../../../../src/backend/profiles/profile-session.js";
import { createProfileRegistry } from "../../../../src/backend/profiles/registry.js";
import { createWorkbookLibraryService } from "../../../../src/backend/workbooks/workbook-library-service.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

function fixture() {
  const f = createBoundProfileFixture();
  const clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  const credentials = boundProfileCredentials(f.admission);
  const context = composeSelectedProfileStorage({ machineAdmission: f.machine, admission: f.admission, credentials, clock, hostFacts: { primaryDisplay: null } });
  const before = credentials.read();
  const capturedSecrets = [before.entries.ucpathUserId?.value, before.entries.ucpathPassword?.value].filter((value): value is string => value !== undefined);
  assert.equal(capturedSecrets.length, 2);
  const inventory = composeProfileCredentialInventory({ admission: f.admission, database: context.database, clock, hostFacts: { primaryDisplay: null } });
  const session = createProfileSession({ admission: f.machine, machineRoot: f.machine.stateRoot,
    activity: { hasUnquiescedWork: () => false } });
  return { ...f, clock, context, capturedSecrets, inventory,
    erase() {
      const active = session.signIn({ email: "fixture@example.edu", password: "disposable-fixture-password", at: clock.now().toISOString() });
      assert.equal(active.state, "active");
      if (active.state !== "active") throw new Error("synthetic profile sign-in refused");
      const blocked = session.logOut(active.token, { at: clock.now().toISOString() });
      assert.equal(blocked.state, "refused");
      if (blocked.state !== "refused") throw new Error("synthetic logout did not retain exact inventory custody");
      assert.equal(blocked.code, "PROFILE_LOGOUT_INVENTORY_BLOCKED");
      const operation = session.logoutOperations()[0];
      assert.ok(operation);
      const admission = f.machine.admitProfile(createProfileRegistry(f.machine).settlementClaim(operation.operationId));
      const store = createCredentialStore({ admission, stateRoot: f.stateRoot, erasureJournalAdmission: f.machine,
        erasureJournalPath: join(f.machine.stateRoot, "machine", "erasures", `${admission.profileBinding.profileId}.json`) });
      return { admission, credentials: store, operationId: operation.operationId };
    },
    async cleanup() { await context.account.close(); context.database.close(); f.close(); },
  };
}

for (const backup of ["none", "clean", "captured-copy", "incomplete-capture"] as const) it(`assesses genuine canonical inventory after exact erasure with ${backup} backup`, async () => {
  const f = fixture();
  let settlement: ReturnType<typeof f.erase> | undefined;
  try {
    if (backup === "captured-copy") {
      createWorkbookLibraryService({ repository: f.context.database.authority.workbooks, clock: f.clock }).create({
        name: "Synthetic.xlsx", themes: [], hasFormulas: false,
        sheets: [{ id: "sheet", name: "Synthetic", width: 1, hidden: [], rows: [{ id: "row", cells: [{ value: f.capturedSecrets[1] }] }] }],
      });
    }
    if (backup !== "none") await new AuthorityBackupService(f.admission, f.context.database,
      { directory: join(f.stateRoot, "backups", "authority") }, f.clock).request({ trigger: "operator", requiredGeneration: f.context.database.getMeta().authorityGeneration });
    await f.inventory.prepare();
    settlement = f.erase();
    const observed = f.inventory.assess({ ...settlement, capturedSecrets: f.capturedSecrets, capturedSecretsComplete: backup !== "incomplete-capture" });
    assert.equal(observed.entriesAbsent, true);
    assert.equal(observed.inventoryMissing, false);
    assert.equal(observed.logoutComplete, backup === "none" || backup === "clean");
    if (backup === "captured-copy") assert.equal(observed.backupPlaintext.length, 1);
    if (backup === "incomplete-capture") assert.equal(observed.unknownFormats.length, 1);
  } finally { settlement?.admission.release(); await f.cleanup(); }
});

for (const problem of ["extra-file", "contained-symlink", "unreferenced-backup"] as const) it(`refuses canonical inventory with ${problem}`, async () => {
  const f = fixture();
  try {
    await f.inventory.prepare();
    if (problem === "extra-file") writeFileSync(join(f.stateRoot, "unowned.json"), "{}", { mode: 0o600 });
    if (problem === "contained-symlink") symlinkSync(join(f.stateRoot, "credentials", "protected.json"), join(f.stateRoot, "credentials", "copy.json"));
    if (problem === "unreferenced-backup") {
      mkdirSync(join(f.stateRoot, "backups", "authority"), { recursive: true, mode: 0o700 });
      writeFileSync(join(f.stateRoot, "backups", "authority", "unowned.sqlite"), "synthetic", { mode: 0o600 });
    }
    await assert.rejects(f.inventory.prepare());
  } finally { await f.cleanup(); }
});

for (const encoding of ["utf8", "utf16le", "utf16be"] as const) it(`detects ${encoding} synthetic credential bytes crossing the 64 KiB read boundary`, () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "profile-copy-scan-"))), path = join(root, "copy.bin");
  const captured = "synthetic-boundary-capture";
  const bytes = encoding === "utf8" ? Buffer.from(captured, "utf8") : Buffer.from(captured, "utf16le");
  if (encoding === "utf16be") bytes.swap16();
  try {
    writeFileSync(path, Buffer.concat([Buffer.alloc(64 * 1024 - 3, 0x78), bytes, Buffer.alloc(17, 0x79)]), { mode: 0o600 });
    assert.equal(scanProfileCredentialCopy(path, [captured]).containsSecret, true);
    assert.equal(scanProfileCredentialCopy(path, ["different-synthetic-capture"]).containsSecret, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const content of ["clean", "escaped-value", "malformed"] as const) it(`inspects decoded canonical boot JSONL with ${content} content`, async () => {
  const f = fixture();
  let settlement: ReturnType<typeof f.erase> | undefined;
  try {
    const error = new Error("synthetic boot failure"); error.stack = undefined;
    appendEmergencyFault({ stateRoot: f.stateRoot, build: "synthetic", code: "DATABASE_WRITER_UNAVAILABLE", error, now: f.clock.now() });
    const path = join(f.stateRoot, "logs", "boot.jsonl");
    const record = JSON.parse(readFileSync(path, "utf8")) as { payload: { event: { message: string } } };
    const secret = f.capturedSecrets[1]; assert.ok(secret);
    if (content === "escaped-value") {
      record.payload.event.message = secret;
      const encoded = [...secret].map(character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`).join("");
      const text = JSON.stringify(record).replace(JSON.stringify(secret), `"${encoded}"`);
      assert.equal(text.includes(secret), false);
      writeFileSync(path, `${text}\n`, { mode: 0o600 });
    }
    if (content === "malformed") writeFileSync(path, "{invalid}\n", { mode: 0o600 });
    await f.inventory.prepare();
    settlement = f.erase();
    const observed = f.inventory.assess({ ...settlement, capturedSecrets: f.capturedSecrets, capturedSecretsComplete: true });
    assert.equal(observed.logoutComplete, content === "clean");
    assert.equal(observed.backupPlaintext.includes(path), content === "escaped-value");
    assert.equal(observed.unknownFormats.includes(path), content === "malformed");
  } finally { settlement?.admission.release(); await f.cleanup(); }
});

for (const content of ["clean", "escaped-key", "escaped-shadowed", "malformed"] as const) it(`inspects canonical retained browser JSON with ${content} content`, async () => {
  const f = fixture();
  let settlement: ReturnType<typeof f.erase> | undefined;
  let worker: ReturnType<typeof bindWorkerProcessAdmission> | undefined;
  try {
    const processLockRoot = join(f.workspace, "inventory-process-locks");
    worker = bindWorkerProcessAdmission({ processLockRoot, authorityPath: f.path, pid: process.pid, clock: f.clock,
      open: () => f.context.database, close: () => undefined,
      admit: (_database, acquisitionId) => f.context.database.withAuthorityTransaction(repositories => admitDirectWorker(repositories, {
        commandId: randomUUID(), workflow: "person-lookup", poolIndex: 1, expectedPoolVersion: 0, processId: process.pid,
        processAcquisitionId: acquisitionId, authorityPath: f.path, processLockRoot, now: f.clock.now().toISOString(),
      }, randomUUID()).workerId),
    });
    const started = f.context.database.startOwnedWorker({ workerId: worker.workerId, workflow: "person-lookup", browserSystems: ["crm"],
      processId: process.pid, requestedBy: "local-operator", now: f.clock.now().toISOString() }, worker.processLock);
    assert.equal(started.state, "started");
    const custody = f.context.database.readProfileResourceCustody(), slot = custody.slots[0], config = custody.configSnapshots[0], lease = custody.leases[0];
    assert.ok(slot); assert.ok(config); assert.ok(lease);
    const directory = workerProfileDirectory({ profileRoot: config.config.paths.browserProfileRoot, slotOrdinal: slot.ordinal, system: "crm" });
    f.context.database.authority.workerControls.observe({ workerId: worker.workerId, leaseGeneration: lease.leaseGeneration,
      sessionId: randomUUID(), system: "crm", configFingerprint: config.fingerprint, signInFingerprint: config.fingerprint,
      browserMode: "headless", profileDirectory: directory, acceptDownloads: false, exclusive: false, health: "closed",
      observedAt: f.clock.now().toISOString(), openedAt: f.clock.now().toISOString(), profileRevision: 1 });
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, "Preferences"), secret = f.capturedSecrets[1]; assert.ok(secret);
    const escaped = [...secret].map(character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`).join("");
    const text = content === "clean" ? '{"profile":{"name":"Synthetic"}}' : content === "malformed" ? "{invalid}" : content === "escaped-shadowed" ? `{"synthetic":"${escaped}","synthetic":"clean"}` : `{"${escaped}":"synthetic"}`;
    assert.equal(text.includes(secret), false);
    writeFileSync(path, text, { mode: 0o600 });
    await f.inventory.prepare(); settlement = f.erase();
    const observed = f.inventory.assess({ ...settlement, capturedSecrets: f.capturedSecrets, capturedSecretsComplete: true });
    assert.equal(observed.logoutComplete, content === "clean");
    assert.equal(observed.backupPlaintext.includes(path), content === "escaped-key" || content === "escaped-shadowed");
    assert.equal(observed.unknownFormats.includes(path), content === "malformed");
  } finally { worker?.processLock.release(); settlement?.admission.release(); await f.cleanup(); }
});
