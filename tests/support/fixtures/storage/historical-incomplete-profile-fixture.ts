import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { composeProfileRuntime } from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { createCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { createSyntheticVerifier } from "../../../../src/backend/storage/configuration/synthetic-verifier.js";
import { deriveProfileNames, advanceProfileRegistryDocument, ProfileRegistryDocumentSchema, SignUpOperationSchema } from "../../../../src/models/profiles/profile.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { systemClock } from "../../../../src/rules/time/clock.js";

export const historicalIncompleteProfileFields = Object.freeze({ firstName: "Historical", lastName: "Fixture",
  email: "historical-fixture@ucsd.edu", password: "disposable-historical-fixture" });

function assertClosedWorkspace(workspace: string): void {
  const result = spawnSync("lsof", ["-nP", "+D", workspace, "-Fn"], { encoding: "utf8" });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1, "historical fixture source closure unproved");
  assert.equal(result.stdout, ""); assert.equal(result.stderr, "");
}

function fixtureJson(path: string, value: unknown): void {
  const stage = join(dirname(path), `.${basename(path)}.${randomUUID()}.fixture`);
  writeFileSync(stage, JSON.stringify(value), { mode: 0o600, flag: "wx" }); renameSync(stage, path);
}

export async function createHistoricalIncompleteProfileFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "incomplete-publication-")));
  for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(root, name));
  const lifetime = await RuntimeLifetimeLock.acquire(0);
  const machine = acquireEntrypointAdmission(root, "exclusive", lifetime), processLockRoot = join(root, rebuildRuntimeIsolation.processLockRoot);
  mkdirSync(processLockRoot, { recursive: true, mode: 0o700 });
  const profile = composeProfileRuntime({ admission: machine,  hostFacts: { primaryDisplay: null }, clock: systemClock });
  const fields = { ...historicalIncompleteProfileFields, createdAt: new Date().toISOString() };
  const draft = profile.session.signUp(fields); if (draft.state !== "onboarding") throw new Error("fixture genuine Details required");
  const stateRoot = machine.stateRoot, profileRoot = join(stateRoot, "profiles", draft.profileId), machineRoot = join(stateRoot, "machine");
  const operationPath = join(machineRoot, "operations", `${draft.operationId}.json`), registryPath = join(machineRoot, "profiles.json"), verifierPath = join(machineRoot, "profile-verifiers.json");
  const operation = SignUpOperationSchema.parse(JSON.parse(readFileSync(operationPath, "utf8")));
  const admission = machine.admitProfile(draft.profileId);
  const store = createCredentialStore({ admission, stateRoot: profileRoot, erasureJournalAdmission: machine,
    erasureJournalPath: join(machineRoot, "erasures", `${draft.profileId}.json`) });
  const original = store.read(); assert.equal(original.entries.ucpathUserId?.value, fields.email); assert.equal(original.entries.ucpathPassword?.value, fields.password);
  const installationId = machine.locator.installationId;
  admission.release(); await profile.close(); machine.release();
  assertClosedWorkspace(root);

  const priorRegistry = ProfileRegistryDocumentSchema.parse(JSON.parse(readFileSync(registryPath, "utf8")));
  const registry = advanceProfileRegistryDocument(priorRegistry, { sessionGeneration: priorRegistry.sessionGeneration + 1, activeProfileId: draft.profileId,
    profiles: [{ profileId: draft.profileId, ...deriveProfileNames(fields.firstName, fields.lastName),
      registration: { operationId: operation.operationId, commandId: operation.commandId, writeId: operation.writeId, credentialRevision: original.revision },
      createdAt: operation.createdAt, lastSignedInAt: operation.createdAt, credentialState: "saved", duoState: "not-set-up", lifecycle: "ready" }] });
  const verifier = createSyntheticVerifier(readFileSync(join(machineRoot, "profile-pepper")), fields.email, fields.password);
  fixtureJson(verifierPath, { schemaVersion: 1, profiles: [{ profileId: draft.profileId, ...verifier, consecutiveFailures: 0 }] });
  fixtureJson(registryPath, registry);
  assert.equal(SignUpOperationSchema.parse(JSON.parse(readFileSync(operationPath, "utf8"))).operationId, operation.operationId);
  unlinkSync(operationPath);
  const keyPath = join(machineRoot, "credential-keys", `${draft.profileId}.json`), keyBytes = readFileSync(keyPath), key = JSON.parse(keyBytes.toString("utf8")) as { keyId: string };
  const keyStat = statSync(keyPath), controlPath = join(root, ".tracker", "control", "profile-registry.json");
  const control = JSON.parse(readFileSync(controlPath, "utf8")) as Record<string, unknown>;
  fixtureJson(controlPath, { ...control, digest: createHash("sha256").update(canonicalJsonStringify(registry)).digest("hex"),
    revision: registry.revision, generation: registry.sessionGeneration, operations: [],
    erasures: [{ profileId: draft.profileId, originOperationId: operation.operationId, head: { state: "never-erased", epoch: 0 },
      credentialKey: { keyId: key.keyId, binding: { installationId, profileId: draft.profileId },
        file: { device: keyStat.dev, inode: keyStat.ino, digest: createHash("sha256").update(keyBytes).digest("hex") } } }],
    duo: [{ profileId: draft.profileId, state: "never-initialized", revision: 0 }] });
  const protectedPath = join(profileRoot, "credentials", "protected.json"), databasePath = join(profileRoot, "state.db");
  return { workspace: root, lifetime, stateRoot, machineRoot, profileRoot, profileId: draft.profileId, processLockRoot,
    operation: { operationId: operation.operationId, commandId: operation.commandId, writeId: operation.writeId },
    operationPath, registryPath, verifierPath, controlPath, markerPath: join(machineRoot, "profile-registry-version.json"),
    keyPath, protectedPath, databasePath, schema: { control: 4, marker: 5 } as const,
    async close(): Promise<void> { assertClosedWorkspace(root); await lifetime.close(); rmSync(root, { recursive: true }); } };
}
