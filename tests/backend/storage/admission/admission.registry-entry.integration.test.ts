import assert from "node:assert/strict";
import { chmodSync, readFileSync, readdirSync, writeFileSync, renameSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { LogoutOperationSchema, advanceProfileRegistryDocument } from "../../../../src/models/profiles/profile.js";
import { join } from "node:path";
import { it } from "vitest";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { acquireInstallation } from "../../../../src/backend/storage/admission/installation.js";
import { AuthorityDatabase, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

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

it("reopens byte-identical closed registry replacement through logical authority", async () => {
  const f = await createBoundProfileFixture({ sharedMachine: true });
  try {
    const registryPath = join(f.machine.stateRoot, "machine", "profiles.json"), bytes = readFileSync(registryPath);
    f.admission.release(); f.machine.release();
    const stage = `${registryPath}.${randomUUID()}.test`;
    writeFileSync(stage, bytes, { mode: 0o600, flag: "wx" }); renameSync(stage, registryPath);
    const reopened = RuntimeAdmission.fromInstallationLease(acquireInstallation(f.workspace, "shared", f.lifetime));
    try {
      assert.equal(reopened.readProfileRegistry().profiles.length, 1);
      assert.deepEqual(readFileSync(registryPath), bytes);
      assert.throws(() => f.admission.assertLive(), /released admission/u);
    } finally { reopened.release(); }
  } finally { await f.close(); }
});

it("refuses foreign installation IDs and stale registry revisions without publishing", async () => {
  const f = await createBoundProfileFixture();
  try {
    const before = f.machine.readProfileRegistry(), registryPath = join(f.machine.stateRoot, "machine", "profiles.json"), bytes = readFileSync(registryPath);
    const next = advanceProfileRegistryDocument(before, {});
    assert.throws(() => f.machine.publishProfileRegistry(before, { ...next, installationId: randomUUID() }), /profile-registry-publication-conflict/u);
    assert.throws(() => f.machine.publishProfileRegistry(before, { ...next, revision: before.revision }), /profile-registry-publication-conflict/u);
    assert.deepEqual(readFileSync(registryPath), bytes);
    f.machine.publishProfileRegistry(before, next);
    const published = readFileSync(registryPath);
    assert.throws(() => f.machine.publishProfileRegistry(before, next), /profile-registry-publication-conflict/u);
    assert.deepEqual(readFileSync(registryPath), published);
  } finally { await f.close(); }
});

it("keeps logical operation membership and content fences after closed byte-identical replacement", async () => {
  const f = await createBoundProfileFixture({ sharedMachine: true });
  try {
    const operationId = randomUUID(), root = f.machine.stateRoot;
    const database = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 1000, migrationOwner: "profile-session-test" });
    let source: ReturnType<typeof database.capturePendingLogoutSource>;
    try { source = database.capturePendingLogoutSource(); } finally { database.close(); }
    const operation = LogoutOperationSchema.parse({ schemaVersion: 2, kind: "logout", operationId,
      profileId: f.admission.profileBinding.profileId, sessionGeneration: f.machine.readProfileRegistry().sessionGeneration, source, at: "2026-11-01T00:00:00.000Z", phase: "complete" });
    f.machine.publishProfileOperation(operation);
    const path = join(root, "machine", "operations", `${operationId}.json`), bytes = readFileSync(path);
    f.admission.release(); f.machine.release();
    const stage = `${path}.test`; writeFileSync(stage, bytes, { mode: 0o600, flag: "wx" }); renameSync(stage, path);
    const reopened = RuntimeAdmission.fromInstallationLease(acquireInstallation(f.workspace, "shared", f.lifetime));
    try { assert.equal(reopened.readProfileRegistry().profiles.length, 1); }
    finally { reopened.release(); }
    writeFileSync(path, JSON.stringify({ ...operation, at: "2026-11-01T00:00:01.000Z" }));
    const changed = readFileSync(path);
    assert.throws(() => acquireInstallation(f.workspace, "shared", f.lifetime), /profile-registry-continuity-mismatch/u);
    assert.deepEqual(readFileSync(path), changed);
    writeFileSync(path, bytes);
    const foreignId = randomUUID(), foreign = join(root, "machine", "operations", `${foreignId}.json`);
    writeFileSync(foreign, JSON.stringify({ ...operation, operationId: foreignId }), { mode: 0o600, flag: "wx" });
    const fabricated = readFileSync(foreign);
    assert.throws(() => acquireInstallation(f.workspace, "shared", f.lifetime), /profile-registry-continuity-mismatch/u);
    assert.deepEqual(readFileSync(foreign), fabricated);
  } finally { await f.close(); }
});
