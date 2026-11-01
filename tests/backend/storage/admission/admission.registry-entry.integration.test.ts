import assert from "node:assert/strict";
import { chmodSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { acquireInstallation } from "../../../../src/backend/storage/admission/installation.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

it("keeps registry entry admission freshness and scope refusal precedence", async () => {
  const profile = await createBoundProfileFixture({ sharedMachine: true });
  try {
    const directory = join(profile.workspace, ".tracker", "control");
    const before = readdirSync(directory);
    const lease = acquireInstallation(profile.workspace, "shared", profile.lifetime);
    const admission = RuntimeAdmission.fromInstallationLease(lease);
    try {
      assert.equal(admission.readProfileRegistry().profiles[0]?.profileId, profile.admission.profileBinding.profileId);
      assert.deepEqual(readdirSync(directory), before, "admission does not publish per-process lease files");
      const leasePath = join(directory, "profile-registry.json");
      const leaseBytes = readFileSync(leasePath);
      try {
        chmodSync(leasePath, 0o644);
        assert.throws(() => admission.readProfileRegistry(), { message: "directory-integrity: credential lock permissions or identity are invalid" });
      } finally { chmodSync(leasePath, 0o600); }
      try {
        writeFileSync(leasePath, "{");
        assert.throws(() => admission.readProfileRegistry(), SyntaxError);
      } finally { writeFileSync(leasePath, leaseBytes); }
      assert.equal(admission.readProfileRegistry().profiles.length, 1);
      assert.throws(() => profile.admission.readProfileRegistry(), /profile-machine-authority-required/u);
      lease.release();
      assert.throws(() => admission.readProfileRegistry(), /installation lease released/u);
      admission.release();
      const registryPath = join(profile.machine.stateRoot, "machine", "profiles.json");
      const registryBytes = readFileSync(registryPath);
      try {
        writeFileSync(registryPath, "{");
        assert.throws(() => admission.readProfileRegistry(), /missing or released admission/u);
        assert.throws(() => profile.admission.readProfileRegistry(), SyntaxError);
      } finally { writeFileSync(registryPath, registryBytes); }
      assert.throws(() => profile.admission.readProfileRegistry(), /profile-machine-authority-required/u);
      profile.admission.release();
      assert.throws(() => profile.admission.readProfileRegistry(), /missing or released admission/u);
    } finally { admission.release(); }
  } finally { await profile.close(); }
});
