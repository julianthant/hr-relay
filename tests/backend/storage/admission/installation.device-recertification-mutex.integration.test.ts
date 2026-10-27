import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { z } from "zod";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { createHistoricalIncompleteProfileFixture } from "../../../support/fixtures/storage/historical-incomplete-profile-fixture.js";
import { composeDashboardApplication } from "../../../../src/backend/app/composition/dashboard/compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { observeProcessIdentity, readRuntimeProcessLock } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { SignUpOperationSchema } from "../../../../src/models/profiles/profile.js";
import { CredentialErasureHeadSchema, CredentialKeyWitnessSchema } from "../../../../src/backend/storage/configuration/credential-store.js";
import { DuoContinuityRowSchema } from "../../../../src/models/config/duo-credential-store.js";

const FileWitness = z.object({ device: z.number(), inode: z.number(), digest: z.string() }).passthrough();
const Continuity = z.object({ schemaVersion: z.literal(2), installationId: z.uuid(), digest: z.string(), device: z.number(), inode: z.number(), generation: z.number(),
  erasures: z.tuple([z.object({ profileId: z.uuid(), originOperationId: z.uuid(), head: CredentialErasureHeadSchema, credentialKey: CredentialKeyWitnessSchema })]),
  operations: z.array(z.unknown()), duo: z.array(DuoContinuityRowSchema) });
const Receipt = z.object({ capture: z.object({ prior: Continuity, current: Continuity, priorControlBytes: z.string(),
  priorControl: FileWitness, sourceEvidence: z.string() }).passthrough(), stage: FileWitness,
  authorization: z.object({ captureDigest: z.string() }).passthrough() }).passthrough();
const Source = z.object({ machineMembership: z.array(z.object({ path: z.string() }).passthrough()), registry: FileWitness,
  locator: FileWitness, roots: z.array(z.object({ path: z.string(), device: z.number() }).passthrough()) }).passthrough();

type Fixture = Awaited<ReturnType<typeof createHistoricalIncompleteProfileFixture>>;
function drift(f: Fixture) {
  const prior = z.object({ device: z.number(), erasures: z.array(z.object({ credentialKey: z.object({ file: z.object({ device: z.number() }).passthrough() }).passthrough() }).passthrough()) }).passthrough().parse(JSON.parse(readFileSync(f.controlPath, "utf8")));
  prior.device += 4;
  const key = prior.erasures[0]?.credentialKey; assert.ok(key); key.file.device += 4;
  writeFileSync(f.controlPath, JSON.stringify(prior));
}
function seedDeadServers(f: Fixture) {
  const claims = join(f.processLockRoot, "server-claims"); mkdirSync(claims, { mode: 0o700 });
  return [2, 3].map(generation => {
    const pid = 2_000_000_000 - generation; assert.equal(observeProcessIdentity(pid).state, "gone");
    const record = { schemaVersion: 2, name: "server", pid, processIdentity: { platform: "darwin", startToken: "1" },
      acquisitionId: randomUUID(), generation, acquiredAt: "2000-01-01T00:00:00.000Z", releasedAt: null };
    const path = join(claims, `${generation}.claim.json`); writeFileSync(path, JSON.stringify(record), { mode: 0o600 });
    return { path, record };
  });
}
async function recertifiedFixture(seedCustody?: (f: Fixture) => void) {
  const f = await createHistoricalIncompleteProfileFixture();
  try {
    drift(f); seedCustody?.(f);
    const held = await RuntimeAdmission.prepareStoppedDeviceContinuityRecertification(f.workspace);
    try { held.recertify({ captureDigest: held.capture.digest, acknowledgement: "recertify-current-files-with-unproved-historical-volume-binding" }); }
    finally { held.release(); }
    return f;
  } catch (error) { await f.close(); throw error; }
}

function abandonedMutex(workspace: string) {
  assert.equal(observeProcessIdentity(2_000_000_000).state, "gone");
  const path = join(workspace, ".tracker/control/admission-mutex"); mkdirSync(path, { mode: 0o700 });
  writeFileSync(join(path, "owner.json"), JSON.stringify({ schemaVersion: 1, acquisitionId: randomUUID(), phase: "admitting",
    pid: 2_000_000_000, processIdentity: { platform: "darwin", startToken: "1" } }), { mode: 0o600 });
  return path;
}

it("recovers two distinct preboot servers through recertification, genuine public shell and private-draft withdrawal", async () => {
  const f = await recertifiedFixture(fixture => { seedDeadServers(fixture); });
  let machine: RuntimeAdmission | undefined, runtime: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  try {
    const preserved = () => [f.databasePath, f.keyPath, f.protectedPath, ...["-wal", "-shm", "-journal"].map(suffix => `${f.databasePath}${suffix}`)].map(path => {
      if (!existsSync(path)) return { path, absent: true };
      const info = lstatSync(path);
      return { path, device: info.dev, inode: info.ino, mode: info.mode, owner: info.uid, links: info.nlink,
        digest: createHash("sha256").update(readFileSync(path)).digest("hex") };
    });
    const before = preserved();
    const receipt = join(f.workspace, ".tracker/control/device-recertification-receipt.json"), receiptBytes = readFileSync(receipt);
    const claims = join(f.processLockRoot, "server-claims"), oldClaims = [2, 3].map(generation => {
      const path = join(claims, `${generation}.claim.json`); return { path, bytes: readFileSync(path) };
    });
    assert.throws(() => RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace), /process-custody-unproved/);
    const publicMachine = acquireEntrypointAdmission(f.workspace, "shared"); machine = publicMachine;
    const generation = machine.readProfileRegistry().sessionGeneration;
    assert.throws(() => publicMachine.admitProfile(publicMachine.issueRegisteredProfileClaim(f.profileId)), /profile-storage-claim-unavailable/);
    runtime = await composeDashboardApplication({ admission: machine, isolation: rebuildRuntimeIsolation, repoRoot: process.cwd(),
      backendPortOverride: 0, frontendPortOverride: 0, env: {} });
    const response = await fetch(`http://127.0.0.1:${runtime.port}/api/v1/profile/state`);
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { state: "signed-out" });
    assert.equal(response.headers.get("set-cookie"), null);
    await runtime.stop(); runtime = undefined; machine = undefined;
    const latest = readRuntimeProcessLock(f.processLockRoot, "server"); assert.ok(latest);
    assert.equal(latest.generation, 4); assert.notEqual(latest.releasedAt, null);
    for (const claim of oldClaims) {
      assert.equal(readFileSync(claim.path).equals(claim.bytes), true);
      const record = z.object({ generation: z.number(), acquisitionId: z.uuid() }).parse(JSON.parse(claim.bytes.toString("utf8")));
      assert.equal(existsSync(join(claims, `${record.generation}-${record.acquisitionId}.release.json`)), false);
    }
    machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace);
    await machine.reclassifyIncompleteProfileAsDraft(f.profileId);
    assert.equal(machine.readProfileRegistry().profiles.length, 0);
    assert.equal(machine.readProfileRegistry().activeProfileId, null); assert.equal(machine.readProfileRegistry().sessionGeneration, generation + 1);
    machine.release(); machine = undefined;
    const operation = SignUpOperationSchema.parse(JSON.parse(readFileSync(f.operationPath, "utf8")));
    assert.equal(operation.profileId, f.profileId); assert.equal(operation.operationId, f.operation.operationId);
    assert.equal(operation.commandId, f.operation.commandId); assert.equal(operation.writeId, f.operation.writeId);
    assert.equal(operation.credentialInitialization?.phase, "document-published"); assert.equal(operation.onboarding?.generation, 1);
    assert.equal(operation.onboarding?.duo.state, "never-initialized"); assert.deepEqual(operation.onboarding?.attempts, []);
    assert.equal(operation.onboarding?.finish, undefined); assert.equal(operation.onboarding?.abort, undefined);
    const mutex = abandonedMutex(f.workspace);
    machine = acquireEntrypointAdmission(f.workspace, "exclusive");
    assert.equal(existsSync(mutex), false); assert.equal(machine.readProfileRegistry().profiles.length, 0);
    assert.equal(readFileSync(receipt).equals(receiptBytes), true);
    assert.deepEqual(preserved(), before);
  } finally { await runtime?.stop(); machine?.release(); await f.close(); }
});

for (const member of [0, 1] as const) for (const problem of ["live", "reused", "sameboot"] as const) {
  it(`refuses two preboot servers when member ${member} is ${problem}`, async () => {
    const f = await createHistoricalIncompleteProfileFixture();
    try {
      drift(f); const claims = seedDeadServers(f), claim = claims[member]; assert.ok(claim);
      if (problem === "live" || problem === "reused") claim.record.pid = process.pid;
      if (problem === "live") {
        const self = observeProcessIdentity(process.pid); assert.equal(self.state, "alive");
        if (self.state !== "alive") throw new Error("fixture live identity required");
        claim.record.processIdentity = self.identity;
      }
      if (problem === "sameboot") {
        claim.record.processIdentity.startToken = String(Math.floor(Date.now() / 1000));
        claim.record.acquiredAt = new Date().toISOString();
      }
      writeFileSync(claim.path, JSON.stringify(claim.record));
      const before = readFileSync(f.controlPath), originals = claims.map(entry => readFileSync(entry.path));
      await assert.rejects(RuntimeAdmission.prepareStoppedDeviceContinuityRecertification(f.workspace), /custody-unproved/);
      assert.equal(readFileSync(f.controlPath).equals(before), true);
      assert.deepEqual(claims.map(entry => readFileSync(entry.path)), originals);
      assert.equal(existsSync(join(f.workspace, ".tracker/control/device-recertification.json")), false);
    } finally { await f.close(); }
  });
}

for (const problem of ["malformed", "foreign", "prior-bytes", "transition", "key-binding", "authorization", "stage-digest", "private-mode", "pending-intent", "unowned-stage", "inventory-json", "inventory-missing", "inventory-extra", "inventory-identity", "stable-digest", "stable-inode", "stable-roots"] as const) {
  it(`retains abandoned mutex custody for a ${problem} recertification receipt`, async () => {
    const f = await recertifiedFixture();
    try {
      const control = join(f.workspace, ".tracker/control"), path = join(control, "device-recertification-receipt.json");
      const receipt = Receipt.parse(JSON.parse(readFileSync(path, "utf8")));
      if (problem === "malformed") writeFileSync(path, "{}");
      else {
        if (problem === "foreign") {
          const installationId = randomUUID();
          receipt.capture.prior.installationId = installationId; receipt.capture.current.installationId = installationId;
          receipt.capture.prior.erasures[0].credentialKey.binding.installationId = installationId;
          receipt.capture.current.erasures[0].credentialKey.binding.installationId = installationId;
        }
        if (problem === "prior-bytes") receipt.capture.priorControlBytes = Buffer.from("{}").toString("base64");
        if (problem === "inventory-json") receipt.capture.sourceEvidence = "not-json";
        if (problem === "inventory-missing" || problem === "inventory-extra" || problem === "inventory-identity"
          || problem === "stable-digest" || problem === "stable-inode" || problem === "stable-roots") {
          const source = Source.parse(JSON.parse(receipt.capture.sourceEvidence));
          if (problem === "inventory-missing") source.machineMembership = source.machineMembership.filter((entry: { path: string }) => entry.path !== "profiles.json");
          if (problem === "inventory-extra") source.machineMembership.push({ ...source.machineMembership[1], path: "unowned.json" });
          if (problem === "inventory-identity") source.registry.inode += 1;
          if (problem === "stable-digest") source.locator.digest = "0".repeat(64);
          if (problem === "stable-inode") source.locator.inode += 1;
          if (problem === "stable-roots") {
            const state = source.roots[2], profiles = source.roots[4]; assert.ok(state); assert.ok(profiles);
            state.path += "-foreign"; profiles.path = join(state.path, "profiles");
          }
          receipt.capture.sourceEvidence = canonicalJsonStringify(source);
        }
        if (problem === "transition") receipt.capture.current.generation += 1;
        if (problem === "key-binding") {
          const profileId = randomUUID();
          receipt.capture.prior.erasures[0].credentialKey.binding.profileId = profileId;
          receipt.capture.current.erasures[0].credentialKey.binding.profileId = profileId;
        }
        if (problem === "foreign" || problem === "key-binding") {
          const bytes = Buffer.from(JSON.stringify(receipt.capture.prior));
          receipt.capture.priorControlBytes = bytes.toString("base64");
          receipt.capture.priorControl.digest = createHash("sha256").update(bytes).digest("hex");
        }
        receipt.stage.digest = problem === "stage-digest" ? "0".repeat(64) : createHash("sha256").update(`${JSON.stringify(receipt.capture.current)}\n`).digest("hex");
        const { operationId: _operationId, ...capture } = receipt.capture;
        receipt.authorization.captureDigest = problem === "authorization" ? "0".repeat(64) : createHash("sha256").update(canonicalJsonStringify(capture)).digest("hex");
        writeFileSync(path, JSON.stringify(receipt));
      }
      if (problem === "private-mode") chmodSync(path, 0o644);
      if (problem === "pending-intent") writeFileSync(join(control, "device-recertification.json"), "{}", { mode: 0o600 });
      if (problem === "unowned-stage") writeFileSync(join(control, `.device-recertification.${randomUUID()}.stage`), "{}", { mode: 0o600 });
      const before = readFileSync(f.controlPath), mutex = abandonedMutex(f.workspace);
      let unexpected: RuntimeAdmission | undefined;
      try { assert.throws(() => { unexpected = acquireEntrypointAdmission(f.workspace, "exclusive"); },
        (error: unknown) => !problem.startsWith("stable-") || error instanceof Error && /device-recertification-source-invalid/u.test(error.message)); }
      finally { unexpected?.release(); }
      assert.equal(existsSync(join(mutex, "owner.json")), true);
      assert.equal(readFileSync(f.controlPath).equals(before), true);
    } finally { await f.close(); }
  });
}
