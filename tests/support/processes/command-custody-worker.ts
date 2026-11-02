import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { createBoundProfileFixture, boundProfileCredentials } from "../helpers/admission-fixture.js";
import { createBrowserSessionFactoryFixtures } from "../helpers/browser/session-factory-fixtures.js";
import { protectedSecretSource } from "../helpers/protected-secret-source.js";
import { composeSelectedProfileStorage } from "../../../src/backend/app/composition/storage-compose.js";
import { createCommandBrowserManager, CommandBrowserClosureError, CommandBrowserError } from "../../../src/backend/runtime/browser/command-browser.js";
import { commandProfileDirectory, profileReservations } from "../../../src/backend/storage/browser-roots.js";
import { BrowserRootsSchema } from "../../../src/backend/storage/browser-root-contract.js";
import { createProfileRegistry } from "../../../src/backend/profiles/registry.js";
import { initialSettingsFileRecord } from "../../../src/models/config/settings.js";
import { resolveConfigWithProvenance } from "../../../src/backend/app/config/resolve.js";
import { manualClock } from "../../../src/rules/time/clock.js";

if (!process.env.NODE_OPTIONS?.includes("credential-keychain-process-preload.mjs")) throw new Error("command-worker-fake-keychain-required");
const [workspace, scenario] = z.tuple([z.string().min(1), z.enum(["native-close", "stale-release"])]).parse(process.argv.slice(2));
if (process.send === undefined || !process.connected) throw new Error("command-worker-ipc-required");
try {
  const f = await createBoundProfileFixture({ workspace });
  const clock = manualClock(new Date("2026-11-01T12:00:01.000Z"));
  const scheduler = { schedule: () => ({ cancel() {} }) };
  const context = composeSelectedProfileStorage({ machineAdmission: f.machine, admission: f.admission,
    credentials: boundProfileCredentials(f.admission), clock, hostFacts: { primaryDisplay: null } });
  const resolved = resolveConfigWithProvenance(initialSettingsFileRecord().settings, { primaryDisplay: null }, clock,
    { stateRoot: f.stateRoot, artifactRoot: f.admission.artifactRoot }).config;
  const config = { ...resolved, features: { ...resolved.features, duoWebAuthn: false } };
  const native = createBrowserSessionFactoryFixtures(clock, randomUUID(), scheduler).fakeLauncher({ emitCloseEvent: scenario !== "native-close" });
  const profileId = f.admission.profileBinding.profileId, commandId = randomUUID();
  const registryPath = join(f.machine.stateRoot, "machine", "browser-roots.json");
  const manager = createCommandBrowserManager({ admission: f.admission, leases: context.database.authority.duoCeremonyLeases,
    clock, scheduler, launcher: native.launcher, recordEvidence: () => {} });
  let credentialKey: string | undefined;
  const input = { commandId, requestDigest: "a".repeat(64), config, signal: new AbortController().signal,
    assertCurrent: context.assertCurrent, protectedSecrets: protectedSecretSource({ ucpathUserId: "fixture-user", ucpathPassword: "fixture-password" }) };
  await assert.rejects(manager.withBrowser(input, async browser => {
    if (scenario === "stale-release") await browser.duoCeremony.withCeremony(async token => {
      credentialKey = token.credentialKey;
      assert.equal(token.holder.commandId, commandId);
      createProfileRegistry(f.machine).advanceSession(profileId);
      throw new Error("fixture external epoch revocation");
    });
  }), CommandBrowserClosureError);
  assert.equal(native.contextClosed(), true);
  assert.equal(manager.hasUnquiescedWork(profileId), true);
  const document = BrowserRootsSchema.parse(JSON.parse(readFileSync(registryPath, "utf8")));
  assert.equal(document.roots[0]?.owner.kind, "command");
  assert.equal(document.roots[0]?.launch.state, scenario === "native-close" ? "unknown" : "closed");
  assert.equal(profileReservations.has(commandProfileDirectory(config.paths.browserProfileRoot)), scenario === "native-close");
  assert.throws(() => f.admission.assertBrowserRegistryCustody());
  if (scenario === "stale-release") {
    const read = new DatabaseSync(f.path, { readOnly: true });
    try {
      const row = z.object({ holder_worker_id: z.null(), payload_json: z.string() }).parse(read.prepare("SELECT holder_worker_id,payload_json FROM auth_leases WHERE credential_key=?").get(credentialKey ?? "missing"));
      const payload = z.object({ state: z.literal("held"), holder: z.strictObject({ commandId: z.literal(commandId), system: z.literal("sharepoint") }) }).parse(JSON.parse(row.payload_json));
      assert.equal(payload.state, "held");
    } finally { read.close(); }
  }
  await assert.rejects(manager.withBrowser(input, async () => {}), CommandBrowserError);
  manager.requestCancellation(profileId); await assert.rejects(manager.awaitCancellation(), CommandBrowserClosureError);
  process.send({ scenario, assertionsComplete: true });
} catch (error) {
  process.send({ scenario, assertionsComplete: false, failure: error instanceof Error ? error.name : "Error" });
}
// The parent proves this process exited before deleting its retained fixture sources.
await new Promise<never>(() => { setInterval(() => {}, 1000); });
