import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach,it } from "vitest";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { acquireSharedRuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { createServerVerifiedArtifactReader } from "../../../../src/backend/storage/artifacts/server-verified-artifact-reader.js";
import { AppSettingsSchema } from "../../../../src/models/config/app-settings.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { ConfigSnapshotRecordSchema } from "../../../../src/models/config/snapshot.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import {
cleanupFixtureRoots,clock,durableSnapshot,installation,interruptedRelocation,
plan,relocate
} from "../../../support/helpers/storage/storage-relocation-fixture.js";

afterEach(cleanupFixtureRoots);

function assertActivation(before: ReturnType<typeof durableSnapshot>, after: ReturnType<typeof durableSnapshot>,
  destination: Readonly<{ stateRoot: string; artifactRoot: string }>): void {
  assert.equal(before.appSettings.length, 1);
  assert.equal(after.appSettings.length, 1);
  const previous = AppSettingsSchema.parse(JSON.parse(before.appSettings[0] ?? "null") as unknown);
  const current = AppSettingsSchema.parse(JSON.parse(after.appSettings[0] ?? "null") as unknown);
  assert.equal(canonicalJsonStringify(current.saved), canonicalJsonStringify(previous.saved));
  assert.ok(current.saved);
  assert.ok(current.active);
  assert.equal(current.active.generation, (previous.active?.generation ?? 0) + 1);
  assert.equal(current.active.settingsRevision, current.saved.revision);
  assert.equal(current.active.settingsFingerprint, current.saved.settingsFingerprint);
  assert.equal(current.active.activatedAt, clock.now().toISOString());
  assert.equal(after.settingsSnapshots.length, before.settingsSnapshots.length + 1);
  assert.deepEqual(after.settingsSnapshots.slice(0, -1), before.settingsSnapshots);
  const snapshot = ConfigSnapshotRecordSchema.parse(JSON.parse(after.settingsSnapshots.at(-1) ?? "null") as unknown);
  assert.equal(current.active.configSnapshotId, snapshot.configSnapshotId);
  assert.equal(current.active.configFingerprint, snapshot.fingerprint);
  const expected = resolveConfigWithProvenance(current.saved.settings, hostConfigFacts({}), clock, destination);
  assert.equal(snapshot.fingerprint, expected.fingerprint);
  assert.deepEqual(snapshot.config, expected.config);
  assert.deepEqual(snapshot.provenance, expected.provenance);
}

it("moves artifacts first, then state under the prior receipt without changing settings history", async () => {
  const f = await installation();
  const artifactDestination = join(f.root, "artifact-first");
  const first = plan(f.workspace, f.lifetime, { stateRoot: f.source.stateRoot, artifactRoot: artifactDestination });
  const firstOutcome = await relocate(f.workspace, f.lifetime, first.commandId);
  assert.equal(firstOutcome.generation, 1);
  const afterArtifact = acquireSharedRuntimeAdmission(f.workspace, f.lifetime);
  try {
    assert.equal(afterArtifact.stateRoot, f.source.stateRoot);
    assert.equal(afterArtifact.artifactRoot, artifactDestination);
    assert.equal(existsSync(join(artifactDestination, `${f.artifact.sha256}.artifact`)), true);
  } finally { afterArtifact.release(); }

  const stateDestination = join(f.root, "state-second");
  const second = plan(f.workspace, f.lifetime, { stateRoot: stateDestination, artifactRoot: artifactDestination });
  const before = durableSnapshot(f.authorityPath, f.credentialFile,
    join(artifactDestination, `${f.artifact.sha256}.artifact`));
  const secondOutcome = await relocate(f.workspace, f.lifetime, second.commandId);
  assert.equal(secondOutcome.generation, 2);
  const afterState = acquireSharedRuntimeAdmission(f.workspace, f.lifetime);
  try {
    assert.equal(afterState.stateRoot, stateDestination);
    assert.equal(afterState.artifactRoot, artifactDestination);
    const after = durableSnapshot(join(stateDestination, "state.db"),
      join(stateDestination, "credentials", "protected.json"),
      join(artifactDestination, `${f.artifact.sha256}.artifact`));
    assertActivation(before, after, { stateRoot: stateDestination, artifactRoot: artifactDestination });
    assert.deepEqual(after.commands, before.commands);
    assert.deepEqual(after.audits, before.audits);
    assert.equal(after.credentialDigest, before.credentialDigest);
    assert.equal(after.artifactDigest, before.artifactDigest);
    const artifactReader = createServerVerifiedArtifactReader({ admission: afterState });
    await artifactReader.ready;
    await artifactReader.verify(f.artifact);
    assert.equal(existsSync(join(stateDestination, "scratch")), true);
  } finally { afterState.release(); }
});

it.each(["afterNativePublish", "afterActivationIntent", "beforeActivationTransaction", "afterActivationWrite",
  "afterVerifiedStage", "afterFence",
  "afterRetention", "afterSwitch"] as const)("resumes an exact both-root relocation interrupted %s", async fault => {
  const f = await installation();
  const destination = { stateRoot: join(f.root, `resumed-state-${fault}`),
    artifactRoot: join(f.root, `resumed-artifacts-${fault}`) };
  const request = plan(f.workspace, f.lifetime, destination);
  const outcome = await interruptedRelocation(f.workspace, f.lifetime, request.commandId, fault);
  assert.equal(outcome.generation, 1);
  const admission = acquireSharedRuntimeAdmission(f.workspace, f.lifetime);
  try {
    assert.equal(admission.stateRoot, destination.stateRoot);
    assert.equal(admission.artifactRoot, destination.artifactRoot);
    assert.equal(existsSync(join(destination.artifactRoot, `${f.artifact.sha256}.artifact`)), true);
  } finally { admission.release(); }
});

it("resumes artifact-only relocation after verified final backup, preserving one exact plan", async () => {
  const f = await installation();
  const destination = { stateRoot: f.source.stateRoot, artifactRoot: join(f.root, "artifact-resumed") };
  const request = plan(f.workspace, f.lifetime, destination);
  const outcome = await interruptedRelocation(f.workspace, f.lifetime, request.commandId, "afterFinalBackup");
  assert.equal(outcome.generation, 1);
  const admission = acquireSharedRuntimeAdmission(f.workspace, f.lifetime);
  try {
    assert.equal(admission.stateRoot, f.source.stateRoot);
    assert.equal(admission.artifactRoot, destination.artifactRoot);
    assert.equal(existsSync(join(destination.artifactRoot, `${f.artifact.sha256}.artifact`)), true);
  } finally { admission.release(); }
});
