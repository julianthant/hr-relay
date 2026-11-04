import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it, vi } from "vitest";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/profile-browser-closure.js";
import { createNativeBrowserProbe } from "../../../../src/backend/runtime/browser/native-browser.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import type { AuthorityRestoreInput } from "../../../../src/backend/storage/admission/installation.js";
import { StoppedBrowserRootsV1Schema } from "../../../../src/backend/storage/browser-root-contract.js";
import { createAutomaticRestoreBrowserRoots, createBrowserRoots } from "../../../../src/backend/storage/browser-roots.js";
import { restoreBrowserMembershipDigest } from "../../../../src/backend/storage/maintenance/profile-inventory.js";
import { withReadonlyAuthoritySnapshot } from "../../../../src/backend/storage/sqlite/readonly-authority-snapshot.js";
import { readRestoreWriteFences } from "../../../../src/backend/storage/sqlite/restore-write-fences.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { capturePredecessorRestoreFixture } from "../../../support/helpers/backend/predecessor-restore-candidate.js";
import { storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";

const hash = (value: unknown) => createHash("sha256").update(canonicalJsonStringify(value)).digest("hex");

for (const replaced of [false, true]) it(`cold-resumes a captured V1 restore ${replaced ? "after" : "before"} authority replacement before conversion`, async () => {
  const f = await capturePredecessorRestoreFixture(replaced);
  try {
    const { admission } = f.acquire(), inventory = createAutomaticRestoreBrowserRoots(admission);
    assert.throws(() => createBrowserRoots(admission).inventory());
    assert.equal(inventory.inventory().schemaVersion, 1);
    assert.equal(restoreBrowserMembershipDigest(admission), f.originalDigest);
    assert.deepEqual(readFileSync(f.journalPath), f.originalJournal);
    assert.equal((await f.resume()).state, "settled");
    assert.equal(existsSync(f.journalPath), false);
    const settled = StoppedBrowserRootsV1Schema.parse(JSON.parse(readFileSync(f.browserPath, "utf8")));
    assert.equal(hash(settled.roots.filter(row => row.profileId === f.input.profile.binding.profileId)
      .map(({ launch: _launch, native: _native, ...row }) => row)), f.originalDigest);
    assert.deepEqual(withReadonlyAuthoritySnapshot(f.f.path, readRestoreWriteFences), f.fences);
    assert.throws(() => inventory.inventory(), /profile-restore-context-expired/u);
    f.release();
    const stopped = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.f.workspace, f.lifetime);
    try {
      assert.equal(await stopped.upgradeBrowserRoots(createNativeBrowserProbe, systemClock), "upgraded");
      const current = createBrowserRoots(stopped).inventory();
      assert.equal(current.schemaVersion, 2); assert.equal(current.roots.length, settled.roots.length);
      assert.deepEqual(current.roots.map(row => row.directory), settled.roots.map(row => row.directory));
    } finally { stopped.release(); }
  } finally { await f.close(); }
});

for (const mutation of ["membership", "source", "stage", "suspect", "credential", "write-witness", "native"] as const) it(`refuses ${mutation} substitution in a cold V1 restore without replacing authority or rebinding proof`, async () => {
  const f = await capturePredecessorRestoreFixture(false);
  try {
    if (mutation === "membership") {
      writeFileSync(f.browserPath, canonicalJsonStringify({ ...f.prior, roots: f.prior.roots.map(row => ({ ...row, credentialFingerprint: "b".repeat(64) })) }));
    } else if (mutation === "write-witness") {
      const journal = JSON.parse(f.originalJournal.toString("utf8")) as { restore: AuthorityRestoreInput };
      writeFileSync(f.journalPath, canonicalJsonStringify({ ...journal, restore: { ...journal.restore, unresolvedWriteDigest: "b".repeat(64) } }));
    } else if (mutation !== "native") {
      const path = mutation === "source" ? f.f.path : mutation === "stage" ? f.input.stagedPath : mutation === "suspect" ? f.input.suspectPath
        : join(f.f.stateRoot, "credentials", "protected.json");
      const bytes = readFileSync(path); bytes[bytes.length - 1] = (bytes.at(-1) ?? 0) ^ 1; writeFileSync(path, bytes);
    }
    const before = storageTree(f.f.workspace), journal = readFileSync(f.journalPath), authority = readFileSync(f.f.path), stage = readFileSync(f.input.stagedPath), suspect = readFileSync(f.input.suspectPath);
    const native = vi.spyOn(profileBrowserClosure, "probeClosed");
    if (mutation === "native") native.mockRejectedValue(new Error("fixture-native-closure-refused"));
    try {
      await assert.rejects(async () => { f.acquire(); await f.resume(); }, error => {
        assert.ok(error instanceof Error);
        if (mutation === "membership") assert.match(error.message, /restore-browser-membership-changed/u);
        if (mutation === "native") assert.match(error.message, /fixture-native-closure-refused/u);
        if (mutation === "write-witness") assert.match(error.message, /restore-recovery-write-fences-changed/u);
        return true;
      });
      if (mutation === "membership" || mutation === "credential") assert.equal(native.mock.calls.length, 0);
      if (mutation === "membership" || mutation === "credential" || mutation === "native") assert.deepEqual(storageTree(f.f.workspace), before);
      assert.deepEqual(readFileSync(f.journalPath), journal);
      assert.deepEqual(readFileSync(f.f.path), authority); assert.deepEqual(readFileSync(f.input.stagedPath), stage); assert.deepEqual(readFileSync(f.input.suspectPath), suspect);
    } finally { native.mockRestore(); }
  } finally { await f.close(); }
});
