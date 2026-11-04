import assert from "node:assert/strict";
import { lstatSync } from "node:fs";
import { it, vi } from "vitest";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { runtimeLifetimeLock } from "../../../support/helpers/backend/runtime-lifetime.js";
import { acquireInstallation } from "../../../../src/backend/storage/admission/installation.js";
import * as privateFiles from "../../../../src/backend/storage/configuration/credential-safe-file.js";
import * as canonicalJson from "../../../../src/rules/validation/canonical-json.js";

it("captures genuine stopped-profile authority with exact bigint reader identities and unchanged POSIX fingerprints", async () => {
  const lifetime = await runtimeLifetimeLock(), f = await createBoundProfileFixture({ lifetime });
  const profileId = f.admission.profileBinding.profileId;
  await f.closeController();
  const lease = acquireInstallation(f.workspace, "exclusive", lifetime);
  const read = privateFiles.readPrivateFile, serialize = canonicalJson.canonicalJsonStringify;
  const observations: string[] = [];
  vi.spyOn(canonicalJson, "canonicalJsonStringify").mockImplementation(value => {
    const result = serialize(value);
    if (typeof value === "object" && value !== null && "directories" in value && "files" in value && "observation" in value) observations.push(result);
    return result;
  });
  try {
    const baseline = lease.captureStoppedProfileUpgrade(profileId, "manual"); baseline.assertHeld();
    assert.equal(observations.length, 2);
    assert.equal(observations[0], observations[1]);
    const original = JSON.parse(observations[0]) as { files: { path: string; identity: ReturnType<typeof privateFiles.fileIdentityObservation> }[] };
    assert.ok(original.files.length > 0);
    for (const file of original.files) {
      const status = process.platform === "win32" ? lstatSync(file.path, { bigint: true }) : lstatSync(file.path);
      const actual = read(file.path, { label: "protected.json", maxBytes: 25 * 1024 * 1024 }); assert.ok(actual);
      assert.deepEqual(actual.identity, { device: status.dev, inode: status.ino });
      assert.deepEqual(file.identity, privateFiles.fileIdentityObservation(actual.identity));
      for (const value of Object.values(actual.identity)) assert.equal(typeof value, process.platform === "win32" ? "bigint" : "number");
      if (process.platform !== "win32") for (const value of Object.values(file.identity)) assert.equal(typeof value, "number");
    }
    const reader = vi.spyOn(privateFiles, "readPrivateFile").mockImplementation((path, options) => {
      const file = read(path, options);
      if (file === undefined) return undefined;
      const exact = (value: number | bigint): bigint => {
        if (typeof value === "bigint") return value;
        assert.equal(Number.isSafeInteger(value), true);
        return BigInt(value);
      };
      return { ...file, identity: { device: exact(file.identity.device), inode: exact(file.identity.inode) } };
    });
    const exact = lease.captureStoppedProfileUpgrade(profileId, "manual"); exact.assertHeld();
    assert.ok(reader.mock.calls.length > 0);
    assert.equal(observations.length, 4); assert.equal(observations[2], observations[3]);
    const projected = JSON.parse(observations[2]) as { files: { path: string; identity: { device: string; inode: string } }[] };
    for (const [index, file] of projected.files.entries()) {
      assert.deepEqual(file.identity, { device: String(original.files[index]?.identity.device), inode: String(original.files[index]?.identity.inode) });
    }
  } finally { vi.restoreAllMocks(); lease.release(); await f.close(); }
});
