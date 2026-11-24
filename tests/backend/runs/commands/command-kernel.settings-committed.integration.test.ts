import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { executeSettingsCommand, type CommandAuthority, type SettingsCommitted } from "../../../../src/backend/runs/commands/command-kernel.js";
import { readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/protected-settings.js";
import { settingsFixture } from "../../../support/helpers/backend/settings-activation-fixture.js";

const fixtures: Awaited<ReturnType<typeof settingsFixture>>[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });

/** The production settings route with a recorder on the commit signal, and what the store held when each signal ran. */
async function setup() {
  const f = await settingsFixture(); fixtures.push(f);
  const emitted: { revision: number; settingsFingerprint: string; storedRevision: number }[] = [];
  const settingsCommitted: SettingsCommitted = committed => emitted.push({ ...committed, storedRevision: readSettings(f.database.authority).revision });
  const committing: CommandAuthority = { withAuthorityTransaction: work => f.database.withAuthorityTransaction(work), afterAuthorityCommit: publish => f.database.afterAuthorityCommit(publish) };
  const execute = (request: unknown, authority: CommandAuthority = committing) =>
    executeSettingsCommand({ authority, settings: f.settings, clock: f.clock, ids: { uuid: randomUUID }, settingsCommitted }, request);
  return { f, emitted, committing, execute };
}

const HEADED = { "browser.headless": { set: false } } as const;

it("emits one signal after an ordinary commit, with the reply's revision and fingerprint", async () => {
  const { f, emitted, execute } = await setup();
  const result = execute(f.command(HEADED));
  assert.equal(result.state, "applied");
  if (result.state !== "applied") return;
  assert.ok(result.settingsRevision !== undefined && result.settingsFingerprint !== undefined);
  assert.deepEqual(emitted, [{ revision: result.settingsRevision, settingsFingerprint: result.settingsFingerprint, storedRevision: result.settingsRevision }],
    "the signal runs once, after the store holds the committed revision");
});

it("emits nothing for a refusal, a stale revision, a replay or a transaction that throws after the advance", async () => {
  const { f, emitted, committing, execute } = await setup();
  const before = readSettings(f.database.authority).revision;

  const refused = execute({ ...f.command(HEADED), payload: { ...f.command(HEADED).payload, patchFingerprint: "0".repeat(64) } });
  assert.notEqual(refused.state, "applied");
  assert.equal(execute(f.command(HEADED, before + 5)).state, "conflict");

  const rolledBack: CommandAuthority = { ...committing, withAuthorityTransaction: work => f.database.withAuthorityTransaction(repositories => {
    work(repositories);
    assert.equal(readSettings(repositories).revision, before + 1, "the advance ran before the injected failure");
    throw new Error("injected failure after the settings advance");
  }) };
  assert.throws(() => execute(f.command(HEADED), rolledBack), /injected failure/u);
  assert.equal(readSettings(f.database.authority).revision, before);
  assert.deepEqual(emitted, []);

  const command = f.command(HEADED);
  assert.equal(execute(command).state, "applied");
  assert.equal(emitted.length, 1);
  assert.equal(execute(command).state, "already-applied");
  assert.equal(emitted.length, 1, "a replay of the journaled command emits nothing");
});

it("emits nothing for a protected settings save", async () => {
  const { f, emitted, execute } = await setup();
  const result = execute({ family: "settings", type: "apply-protected-settings", commandId: randomUUID(), requestedAt: f.clock.now().toISOString(),
    requestedBy: "local-operator", source: "settings-surface", target: { expectedRevision: f.credentials.read().revision },
    payload: { protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: randomUUID(), entries: { sharepointOnboardingRosterUrl: { set: "https://roster.example.test/synthetic-committed" } } } });
  assert.equal(result.state, "applied");
  assert.deepEqual(emitted, []);
});

it("refuses to commit a signalled settings change through an authority that cannot publish after commit", async () => {
  const { f, emitted, execute } = await setup();
  const before = readSettings(f.database.authority).revision;
  assert.throws(() => execute(f.command(HEADED), { withAuthorityTransaction: work => f.database.withAuthorityTransaction(work) }),
    /settings-commit-publication-unavailable/u);
  assert.equal(readSettings(f.database.authority).revision, before, "the change rolled back");
  assert.deepEqual(emitted, []);
});
