import assert from "node:assert/strict";
import { lstatSync } from "node:fs";
import { it, vi } from "vitest";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { runtimeLifetimeLock } from "../../../support/helpers/backend/runtime-lifetime.js";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { acquireInstallation, inspectFlatOfflineRunMaintenance } from "../../../../src/backend/storage/admission/installation.js";
import * as identities from "../../../../src/backend/storage/file-identity.js";
import { createHistoricalFlatProfileFixture } from "../../../support/fixtures/storage/historical-flat-profile-fixture.js";
import * as privateFiles from "../../../../src/backend/storage/configuration/credential-safe-file.js";
import * as canonicalJson from "../../../../src/rules/validation/canonical-json.js";
import { forceExactFileMetadata } from "../../../support/helpers/exact-file-metadata.js";
import fs from "node:fs";
import { createHistoricalIncompleteProfileFixture, convertHistoricalIncompleteProfileFixture } from "../../../support/fixtures/storage/historical-incomplete-profile-fixture.js";

for (const target of ["control", "credentials", "database"] as const) it.skipIf(process.platform !== "linux")(`converts installation ${target} with exact high-ID source witnesses`, async () => {
  const f = await createHistoricalIncompleteProfileFixture();
  if (target === "credentials") {
    const control = JSON.parse(fs.readFileSync(f.controlPath, "utf8")) as { erasures: { credentialKey: { file: { inode: number | string } } }[] };
    const key = control.erasures[0]?.credentialKey; assert.ok(key);
    key.file.inode = ((1n << 54n) + (fs.lstatSync(f.keyPath, { bigint: true }).ino << 2n)).toString();
    fs.writeFileSync(f.controlPath, JSON.stringify(control), { mode: 0o600 });
  }
  const restore = forceExactFileMetadata(path => target === "database" ? path.startsWith(f.databasePath) : target === "control" ? path === f.registryPath || path.endsWith(".registry.stage") || path === f.verifierPath || path.endsWith("/profile-pepper")
    : path === f.keyPath || path === f.protectedPath || path.endsWith("/chatgpt-account.json"));
  try {
    await convertHistoricalIncompleteProfileFixture(f);
    const marker = JSON.parse(fs.readFileSync(f.markerPath, "utf8")) as { schemaVersion: number };
    assert.equal(marker.schemaVersion, 8);
    const directory = `${f.workspace}/.tracker/control/profile-control-upgrades`, name = fs.readdirSync(directory).find(name => name.endsWith(".receipt.json")); assert.ok(name);
    const receipt = JSON.parse(fs.readFileSync(`${directory}/${name}`, "utf8")) as { priorRegistry: { inode: number | string }; sourceEvidence: string; credentials: { plan: { operation: { priorHead: { inode: number | string } } } }[] };
    const source = JSON.parse(receipt.sourceEvidence) as { profiles: { database: { inode: number | string } }[] };
    const inode = target === "control" ? receipt.priorRegistry.inode : target === "credentials" ? receipt.credentials[0]?.plan.operation.priorHead.inode : source.profiles[0]?.database.inode;
    assert.equal(typeof inode, "string"); assert.ok(inode !== undefined && BigInt(inode) > 2n ** 53n);
    assert.ok(restore.observations.some(observation => observation.source === "descriptor" && observation.inode > 2n ** 53n));
  } finally { restore(); await f.close(); }
});

it.skipIf(process.platform !== "linux")("captures stopped installation credential files with exact high-ID witnesses", async () => {
  const lifetime = await runtimeLifetimeLock(), f = await createBoundProfileFixture({ lifetime });
  const profileId = f.admission.profileBinding.profileId;
  await f.closeController();
  const lease = acquireInstallation(f.workspace, "exclusive", lifetime);
  const restore = forceExactFileMetadata(path => path.includes("/credential-keys/") || path.includes("/credentials/") || path.endsWith("/profile-pepper"));
  try {
    const witness = lease.captureStoppedProfileUpgrade(profileId, "manual"); witness.assertHeld();
    assert.ok(restore.observations.some(observation => observation.source === "descriptor" && observation.inode > 2n ** 53n));
  } finally { restore(); lease.release(); await f.close(); }
});

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

it("witnesses flat offline maintenance files with their exact bytes and an exact high Windows inode", async () => {
  const f = await createHistoricalFlatProfileFixture();
  const target = join(f.workspace, ".tracker", "control", "installation.json");
  const realInode = fs.lstatSync(target, { bigint: true }).ino, status = identities.fileStatus, descriptor = identities.descriptorStatus;
  const inode = 21_110_623_253_370_483n;
  let descriptorDelta = 0n;
  const exact = (info: fs.BigIntStats, delta: bigint) => { info.ino = inode + delta; return info; };
  vi.spyOn(identities, "fileStatus").mockImplementation((path: string, missing?: true) =>
    path === target ? exact(fs.lstatSync(path, { bigint: true }), 0n) : missing ? status(path, true) : status(path));
  vi.spyOn(identities, "descriptorStatus").mockImplementation(fd => {
    const info = fs.fstatSync(fd, { bigint: true });
    return info.ino === realInode ? exact(info, descriptorDelta) : descriptor(fd);
  });
  try {
    const witness = inspectFlatOfflineRunMaintenance(f.workspace).witnesses.find(entry => entry.path === target);
    assert.equal(witness?.inode, "21110623253370483");
    assert.equal(witness.digest, createHash("sha256").update(fs.readFileSync(target)).digest("hex"));
    descriptorDelta = 1n;
    assert.throws(() => inspectFlatOfflineRunMaintenance(f.workspace), /worker-process-recovery-source-changed/u);
  } finally { vi.restoreAllMocks(); await f.close(); }
});
