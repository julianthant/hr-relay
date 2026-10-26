import assert from "node:assert/strict";
import { chmodSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { acquireInstallation } from "../../../../src/backend/storage/admission/installation.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

it("keeps registry entry lease freshness and scope refusal precedence", () => {
  const profile = createBoundProfileFixture({ sharedMachine: true });
  try {
    const directory = join(profile.workspace, ".tracker", "control", "leases");
    const before = new Set(readdirSync(directory));
    const lease = acquireInstallation(profile.workspace, "shared");
    const admission = RuntimeAdmission.fromInstallationLease(lease);
    try {
      assert.equal(admission.readProfileRegistry().profiles[0]?.profileId, profile.admission.profileBinding.profileId);
      const added = readdirSync(directory).filter(name => !before.has(name));
      assert.equal(added.length, 1);
      const name = added[0];
      assert.ok(name !== undefined);
      const leasePath = join(directory, name);
      const leaseBytes = readFileSync(leasePath);
      try {
        chmodSync(leasePath, 0o644);
        assert.throws(() => admission.readProfileRegistry(), /runtime-control: unsafe file/u);
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
  } finally { profile.close(); }
});
