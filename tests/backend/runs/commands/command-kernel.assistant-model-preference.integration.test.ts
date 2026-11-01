import { afterAll, afterEach, describe, it } from "vitest";
import { createClonedProfileFixtures, boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";
import { AuthorityDatabase } from '../../../../src/backend/storage/sqlite/authority-database.js';
import { resolveConfigWithProvenance } from '../../../../src/backend/app/config/resolve.js';
import { readBootSettings } from '../../../../src/backend/runtime/settings/settings-runtime.js';
import { LOCAL_OPERATOR_ACTOR_ID } from '../../../../src/rules/identity/ids.js';
import { manualClock } from '../../../../src/rules/time/clock.js';
import { NOW } from '../../../support/fixtures/phase1c-contract-fixtures.js';
import { retainAuthoritySourceClosure } from "../../../../src/backend/storage/source-closure.js";
import { AssistantStoredCommandSchema } from "../../../../src/models/profiles/assistant-authorization.js";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createCommandKernelTestWorld } from "../../../support/helpers/backend/command-kernel-harness.js";
import { ASSISTANT_DEFAULT_MODEL, ASSISTANT_DEFAULT_EFFORT } from "../../../../src/models/dashboard/assistant.js";
import { AssistantModelPreferenceCommandRequestSchema, CommandIdentityConflictError } from "../../../../src/rules/commands/commands.js";
import type { CommandKernelDependencies } from "../../../../src/backend/runs/commands/command-kernel.js";

const profileFixtures = createClonedProfileFixtures();
afterAll(() => profileFixtures.close());

const world = createCommandKernelTestWorld();
const owners: { profile: Awaited<ReturnType<typeof profileFixtures.create>>; database?: Awaited<ReturnType<typeof world.createHarness>>["database"]; initializer?: Awaited<ReturnType<typeof world.createHarness>>['database']; harnessDatabases: typeof world.openDatabases; setupFailure?: Readonly<{ error: unknown }>; closeAttempted: boolean; closeError?: unknown }[] = [];
afterEach(async () => {
  while (owners.length !== 0) {
    const owner = owners[0];
    assert.ok(owner);
    if (owner.setupFailure !== undefined) throw owner.setupFailure.error;
    if (owner.closeAttempted) throw owner.closeError;
    assert.ok(owner.database);
    owner.closeAttempted = true;
    try { owner.database.close(); await owner.profile.close(); }
    catch (error) { owner.closeError = error; throw error; }
    owners.shift();
  }
});
async function harness(prepare?: CommandKernelDependencies["prepareAssistantModelPreference"]) {
  const profile = await profileFixtures.create();
  const owner: (typeof owners)[number] = { profile, harnessDatabases: world.openDatabases, closeAttempted: false };
  owners.push(owner);
  try {
    const clock = manualClock(new Date(NOW));
    const credentials = boundProfileCredentials(profile.admission);
    const initializer = AuthorityDatabase.open(profile.admission, { path: profile.path, busyTimeoutMs: 250, migrationOwner: "selected-profile-runtime" }, clock,
      undefined, undefined, undefined, credentials);
    owner.initializer = initializer;
    initializer.withAuthorityTransaction(repositories => {
      const initial = readBootSettings(repositories);
      assert.equal(repositories.runtimeConfig.get(), undefined);
      const resolved = resolveConfigWithProvenance(initial.settings, { primaryDisplay: null }, clock,
        { stateRoot: profile.stateRoot, artifactRoot: profile.admission.artifactRoot });
      repositories.runtimeConfig.initialize({ configSnapshotId: randomUUID(), revision: initial.revision,
        fingerprint: resolved.fingerprint, capturedAt: clock.now().toISOString(), capturedBy: LOCAL_OPERATOR_ACTOR_ID,
        config: resolved.config, provenance: resolved.provenance });
    });
    initializer.close();
    const value = await world.createHarness(undefined, { profile, ...(prepare === undefined ? {} : { prepareAssistantModelPreference: prepare }) });
    owner.database = value.database;
    return { ...value, profile };
  } catch (error) { owner.setupFailure = { error }; throw error; }
}
function request(profileId: string, expectedRevision = 0) {
  return AssistantModelPreferenceCommandRequestSchema.parse({ commandId: randomUUID(), requestedAt: new Date().toISOString(),
    requestedBy: "local-operator", source: "dashboard", family: "assistant-model-preference", type: "set-assistant-model-preference",
    target: { profileId, epoch: 0, expectedRevision }, payload: { slug: ASSISTANT_DEFAULT_MODEL, effort: ASSISTANT_DEFAULT_EFFORT } });
}

describe("operator assistant model preference", () => {
  it("refuses both ordinary and unprepared async paths before journaling", async () => {
    const h = await harness(), command = request(h.profile.admission.profileBinding.profileId);
    assert.equal(h.database.authority.assistantModelPreference.get(), undefined);
    assert.equal(AssistantStoredCommandSchema.safeParse(command).success, false);
    const generation = h.database.getMeta().authorityGeneration;
    assert.equal(h.kernel.execute(command).state, "rejected");
    assert.equal((await h.kernel.executeAssistantModelPreference(command)).state, "rejected");
    assert.equal(h.database.authority.commands.get(command.commandId), undefined);
    assert.equal(h.database.authority.commandAudits.findByCommand(command.commandId), undefined);
    assert.equal(h.database.getMeta().authorityGeneration, generation);
    assert.ok(h.kernel.assistantAvailability().filter(entry => entry.family === command.family).every(entry => entry.availability === "unavailable"));
    assert.ok(h.kernel.assistantManifest().entries.every(entry => entry.family !== command.family));
  });
  it("authenticates CAS, audit and exact historical replay without rewinding a newer preference", async () => {
    const h = await harness(async () => () => true as const);
    const first = request(h.profile.admission.profileBinding.profileId);
    assert.equal((await h.kernel.executeAssistantModelPreference(first)).state, "applied");
    assert.equal(AssistantStoredCommandSchema.safeParse(first).success, false);
    assert.equal(h.kernel.assistantAvailability().filter(entry => entry.family === first.family).length, 1);
    assert.ok(h.kernel.assistantAvailability().filter(entry => entry.family === first.family).every(entry => entry.availability === 'unavailable'));
    assert.ok(h.kernel.assistantManifest().entries.every(entry => entry.family !== first.family));
    const original = h.database.authority.assistantModelPreference.get();
    assert.ok(original);
    assert.equal(original.revision, 1);
    assert.deepEqual(original.preference, first.payload);
    assert.equal(original.commandId, first.commandId);
    assert.equal(h.database.authority.commandAudits.findByCommand(first.commandId)?.auditId, original.auditId);
    const second = { ...request(first.target.profileId, 1), payload: { ...first.payload, effort: "high" as const } };
    assert.equal((await h.kernel.executeAssistantModelPreference(second)).state, "applied");
    const latest = h.database.authority.assistantModelPreference.get();
    const generation = h.database.getMeta().authorityGeneration;
    assert.equal((await h.kernel.executeAssistantModelPreference(structuredClone(first))).state, "already-applied");
    assert.deepEqual(h.database.authority.assistantModelPreference.get(), latest);
    assert.equal(h.database.getMeta().authorityGeneration, generation);
    assert.equal((await h.kernel.executeAssistantModelPreference({ ...first, payload: second.payload })).state, "rejected");
    assert.deepEqual(h.database.authority.assistantModelPreference.get(), latest);
  });
  it("refuses stale CAS and foreign profile without any command or preference effects", async () => {
    const h = await harness(async () => () => true as const), profileId = h.profile.admission.profileBinding.profileId;
    for (const command of [request(profileId, 1), request(randomUUID())]) {
      const generation = h.database.getMeta().authorityGeneration;
      assert.notEqual((await h.kernel.executeAssistantModelPreference(command)).state, "applied");
      assert.equal(h.database.authority.commands.get(command.commandId), undefined);
      assert.equal(h.database.authority.commandAudits.findByCommand(command.commandId), undefined);
      assert.equal(h.database.authority.assistantModelPreference.get(), undefined);
      assert.equal(h.database.getMeta().authorityGeneration, generation);
    }
  });
  it("preserves preparation and in-transaction currentness failures without effects", async () => {
    const failure = new Error("synthetic currentness failure");
    const h = await harness(async () => { throw failure; }), command = request(h.profile.admission.profileBinding.profileId);
    await assert.rejects(h.kernel.executeAssistantModelPreference(command), error => error === failure);
    assert.equal(h.database.authority.commands.get(command.commandId), undefined);
    const second = await harness(async () => { let checks = 0; return () => { if (++checks === 3) throw failure; return true as const; }; });
    const guarded = request(second.profile.admission.profileBinding.profileId), generation = second.database.getMeta().authorityGeneration;
    await assert.rejects(second.kernel.executeAssistantModelPreference(guarded), error => error === failure);
    assert.equal(second.database.authority.commands.get(guarded.commandId), undefined);
    assert.equal(second.database.authority.commandAudits.findByCommand(guarded.commandId), undefined);
    assert.equal(second.database.authority.assistantModelPreference.get(), undefined);
    assert.equal(second.database.getMeta().authorityGeneration, generation);
  });
  it("does not admit a preference record without the exact already-inserted command audit", async () => {
    const h = await harness(), profileId = h.profile.admission.profileBinding.profileId, generation = h.database.getMeta().authorityGeneration;
    assert.throws(() => h.database.withAuthorityTransaction(repositories => repositories.assistantModelPreference.setByCommand({
      format: 1, id: "current", profileId, revision: 1, preference: { slug: ASSISTANT_DEFAULT_MODEL, effort: ASSISTANT_DEFAULT_EFFORT },
      commandId: randomUUID(), auditId: randomUUID(), updatedAt: new Date().toISOString(),
    })));
    assert.equal(h.database.authority.assistantModelPreference.get(), undefined);
    assert.equal(h.database.getMeta().authorityGeneration, generation);
  });
  it.each(["delete", "rollback"] as const)("refuses %s current preference with authenticated successful history", async mutation => {
    const h = await harness(async () => () => true as const), first = request(h.profile.admission.profileBinding.profileId);
    assert.equal((await h.kernel.executeAssistantModelPreference(first)).state, "applied");
    const original = h.database.authority.assistantModelPreference.get();
    assert.ok(original);
    assert.equal((await h.kernel.executeAssistantModelPreference(request(first.target.profileId, 1))).state, "applied");
    const raw = new DatabaseSync(h.profile.path);
    try {
      raw.exec("DROP TRIGGER assistant_model_preference_no_delete; DROP TRIGGER assistant_model_preference_monotonic");
      if (mutation === "delete") raw.exec("DELETE FROM assistant_model_preference");
      else raw.prepare("UPDATE assistant_model_preference SET revision=?,command_id=?,audit_id=?,payload_json=?,updated_at=? WHERE id='current'")
        .run(original.revision, original.commandId, original.auditId, JSON.stringify(original), original.updatedAt);
    } finally { raw.close(); }
    assert.throws(() => h.database.authority.assistantModelPreference.get());
    await assert.rejects(h.kernel.executeAssistantModelPreference(first));
  });

  it("independently refuses assistant-origin commands even with a prepared trusted dependency", async () => {
    let preparations = 0;
    const h = await harness(async () => { preparations += 1; return () => true as const; });
    const command = { ...request(h.profile.admission.profileBinding.profileId), source: "assistant" };
    const generation = h.database.getMeta().authorityGeneration;
    assert.equal((await h.kernel.executeAssistantModelPreference(command)).state, "rejected");
    assert.equal(preparations, 0);
    assert.equal(h.database.authority.commands.get(command.commandId), undefined);
    assert.equal(h.database.authority.commandAudits.findByCommand(command.commandId), undefined);
    assert.equal(h.database.authority.assistantModelPreference.get(), undefined);
    assert.equal(h.database.getMeta().authorityGeneration, generation);
  });

  it.each([
    { name: "false", produce: (): unknown => false },
    { name: "undefined", produce: (): unknown => undefined },
    { name: "null", produce: (): unknown => null },
    { name: "zero", produce: (): unknown => 0 },
    { name: "object", produce: (): unknown => ({ current: true }) },
    { name: "resolved promise", produce: (): unknown => Promise.resolve(true) },
    { name: "rejected promise", produce: (): unknown => Promise.reject(new Error("synthetic rejected currentness")) },
  ])("refuses malformed synchronous authority $name before dispatch", async ({ produce }) => {
    const h = await harness(async () => new Proxy((): true => true, { apply: () => produce() }));
    const command = request(h.profile.admission.profileBinding.profileId), generation = h.database.getMeta().authorityGeneration;
    await assert.rejects(h.kernel.executeAssistantModelPreference(command));
    assert.equal(h.database.authority.commands.get(command.commandId), undefined);
    assert.equal(h.database.authority.commandAudits.findByCommand(command.commandId), undefined);
    assert.equal(h.database.authority.assistantModelPreference.get(), undefined);
    assert.equal(h.database.getMeta().authorityGeneration, generation);
  });
  it.each([2, 3])("rechecks exact true at in-transaction invocation %s and rolls back all effects", async invalidAt => {
    let calls = 0;
    const h = await harness(async () => new Proxy((): true => true, { apply: () => ++calls === invalidAt ? false : true }));
    const command = request(h.profile.admission.profileBinding.profileId), generation = h.database.getMeta().authorityGeneration;
    await assert.rejects(h.kernel.executeAssistantModelPreference(command));
    assert.equal(calls, invalidAt);
    assert.equal(h.database.authority.commands.get(command.commandId), undefined);
    assert.equal(h.database.authority.commandAudits.findByCommand(command.commandId), undefined);
    assert.equal(h.database.authority.assistantModelPreference.get(), undefined);
    assert.equal(h.database.getMeta().authorityGeneration, generation);
  });
  it("preserves committed outcome and primary cause as an unknown error after post-commit refusal", async () => {
    const failure = new CommandIdentityConflictError();
    let calls = 0;
    const h = await harness(async () => () => { if (++calls === 4) throw failure; return true as const; });
    const command = request(h.profile.admission.profileBinding.profileId);
    await assert.rejects(h.kernel.executeAssistantModelPreference(command), error => error instanceof Error
      && !(error instanceof CommandIdentityConflictError) && error.cause === failure);
    const committed = h.database.authority.assistantModelPreference.get();
    assert.ok(committed);
    assert.equal(committed.commandId, command.commandId);
    assert.equal(committed.revision, 1);
    assert.equal(h.database.authority.commandAudits.findByCommand(command.commandId)?.result.state, "applied");
    const generation = h.database.getMeta().authorityGeneration;
    assert.equal((await h.kernel.executeAssistantModelPreference(command)).state, "already-applied");
    assert.deepEqual(h.database.authority.assistantModelPreference.get(), committed);
    assert.equal(h.database.getMeta().authorityGeneration, generation);
  });

  it.each(["deleted-current", "corrupt-current"] as const)("authenticates current authority before duplicate preference replay: %s", async mutation => {
    let preparations = 0;
    const h = await harness(async () => { preparations += 1; return () => true as const; });
    const command = request(h.profile.admission.profileBinding.profileId);
    assert.equal((await h.kernel.executeAssistantModelPreference(command)).state, "applied");
    const record = h.database.authority.assistantModelPreference.get();
    assert.ok(record);
    const storedCommand = h.database.authority.commands.get(command.commandId);
    const storedAudit = h.database.authority.commandAudits.findByCommand(command.commandId);
    assert.ok(storedCommand && storedAudit);
    const generation = h.database.getMeta().authorityGeneration;
    const owner = owners.find(value => value.database === h.database);
    assert.ok(owner);
    const raw = new DatabaseSync(h.profile.path);
    let mutationFailure: { error: unknown } | undefined;
    try {
      raw.exec("DROP TRIGGER assistant_model_preference_no_delete; DROP TRIGGER assistant_model_preference_monotonic");
      if (mutation === "deleted-current") raw.exec("DELETE FROM assistant_model_preference");
      else raw.prepare("UPDATE assistant_model_preference SET payload_json=? WHERE id=?").run(JSON.stringify({ ...record,
        preference: { ...record.preference, effort: record.preference.effort === "high" ? "low" : "high" } }), record.id);
    } catch (error) { mutationFailure = { error }; }
    try { raw.close(); }
    catch (error) {
      const failure = retainAuthoritySourceClosure(mutationFailure === undefined ? [error] : [mutationFailure.error, error],
        { database: raw, admission: h.profile.admission });
      owner.setupFailure = { error: failure };
      throw failure;
    }
    if (mutationFailure !== undefined) throw mutationFailure.error;
    const expected = mutation === "deleted-current" ? "assistant-preference-current-missing-with-history" : "assistant-preference-current-divergent";
    assert.throws(() => h.database.authority.assistantModelPreference.get(), error => error instanceof Error && error.message === expected);
    await assert.rejects(h.kernel.executeAssistantModelPreference(command), error => error instanceof Error && error.message === expected);
    assert.equal(preparations, 2);
    assert.equal(h.database.getMeta().authorityGeneration, generation);
    assert.deepEqual(h.database.authority.commands.get(command.commandId), storedCommand);
    assert.deepEqual(h.database.authority.commandAudits.findByCommand(command.commandId), storedAudit);
    assert.throws(() => h.database.authority.assistantModelPreference.get(), error => error instanceof Error && error.message === expected);
  });

});
