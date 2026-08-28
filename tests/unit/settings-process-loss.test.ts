import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import {
  CURRENT_SETTINGS_SCHEMA_HASH,
  deriveSettingsPatchFingerprint,
} from "../../src/domain/config/settings.js";
import { createSettingsFileService } from "../../src/server/settings/settings-file-service.js";

const roots: string[] = [];

function settingsPath(): string {
  const root = mkdtempSync(join(tmpdir(), "hrauto-settings-process-loss-"));
  roots.push(root);
  return join(root, "config", "settings.json");
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("settings process-loss reconciliation", () => {
  it("removes a durable prepare and preserves revision 1 when replacement never begins", () => {
    const path = settingsPath();
    const recoveryPath = `${path}.prepare`;
    const patch = { browser: { headless: false } };
    const journal = { observe: () => ({ state: "absent" as const }) };
    const firstProcess = createSettingsFileService({
      path,
      journal,
      operations: {
        atomicReplace: (source, destination) => {
          if (destination === path) throw new Error("injected exit before settings replacement");
          renameSync(source, destination);
        },
      },
    });

    assert.throws(() => firstProcess.apply({
      commandId: "76767676-7676-4676-8676-767676767676",
      commandFingerprint: "6".repeat(64),
      expectedRevision: 1,
      settingsSchemaHash: CURRENT_SETTINGS_SCHEMA_HASH,
      patchFingerprint: deriveSettingsPatchFingerprint(patch),
      patch,
    }), /before changing/);
    assert.equal(existsSync(path), false);
    assert.equal(existsSync(recoveryPath), true);

    const restartedProcess = createSettingsFileService({
      path,
      journal,
      absentJournalRecovery: "exclusive-owner",
    });
    assert.equal(restartedProcess.read().revision, 1);
    assert.equal(existsSync(recoveryPath), false);
  });

  it("restores revision 1 when the process exits after replacement but before the command journal commits", () => {
    const path = settingsPath();
    const recoveryPath = `${path}.prepare`;
    const patch = { browser: { headless: false } };
    const journal = { observe: () => ({ state: "absent" as const }) };
    const firstProcess = createSettingsFileService({ path, journal });
    const applied = firstProcess.apply({
      commandId: "77777777-7777-4777-8777-777777777777",
      commandFingerprint: "7".repeat(64),
      expectedRevision: 1,
      settingsSchemaHash: CURRENT_SETTINGS_SCHEMA_HASH,
      patchFingerprint: deriveSettingsPatchFingerprint(patch),
      patch,
    });
    assert.equal(applied.state, "applied");
    assert.equal(existsSync(path), true);
    assert.equal(existsSync(recoveryPath), true);

    const restartedProcess = createSettingsFileService({
      path,
      journal,
      absentJournalRecovery: "exclusive-owner",
    });

    assert.equal(restartedProcess.read().revision, 1);
    assert.deepEqual(restartedProcess.read().settings, {});
    assert.equal(existsSync(recoveryPath), false);
  });

  it("does not let a concurrent worker mistake an in-flight transaction for process loss", () => {
    const path = settingsPath();
    const commandId = "71717171-7171-4171-8171-717171717171";
    const commandFingerprint = "1".repeat(64);
    const patch = { browser: { headless: false } };
    let observation: unknown = { state: "absent" };
    const journal = { observe: () => observation };
    const applyingDashboard = createSettingsFileService({
      path,
      journal,
      absentJournalRecovery: "exclusive-owner",
    });
    assert.equal(applyingDashboard.apply({
      commandId,
      commandFingerprint,
      expectedRevision: 1,
      settingsSchemaHash: CURRENT_SETTINGS_SCHEMA_HASH,
      patchFingerprint: deriveSettingsPatchFingerprint(patch),
      patch,
    }).state, "applied");
    const nextBytes = readFileSync(path);

    const concurrentWorker = createSettingsFileService({ path, journal });
    assert.throws(
      () => concurrentWorker.read(),
      /no visible journal outcome; it may still be in flight/,
    );
    assert.deepEqual(readFileSync(path), nextBytes);

    observation = { state: "committed", commandFingerprint, revision: 2 };
    assert.equal(concurrentWorker.read().revision, 2);
    assert.deepEqual(concurrentWorker.read().settings, patch);
  });

  it("keeps exact next bytes only when the committed journal identity matches the prepare", () => {
    const path = settingsPath();
    const recoveryPath = `${path}.prepare`;
    const commandId = "75757575-7575-4575-8575-757575757575";
    const commandFingerprint = "5".repeat(64);
    const patch = { browser: { headless: false } };
    let observation: unknown = { state: "absent" };
    const journal = { observe: () => observation };
    const firstProcess = createSettingsFileService({ path, journal });
    assert.equal(firstProcess.apply({
      commandId,
      commandFingerprint,
      expectedRevision: 1,
      settingsSchemaHash: CURRENT_SETTINGS_SCHEMA_HASH,
      patchFingerprint: deriveSettingsPatchFingerprint(patch),
      patch,
    }).state, "applied");
    const committedBytes = readFileSync(path);
    observation = { state: "committed", commandFingerprint, revision: 2 };

    const restartedProcess = createSettingsFileService({ path, journal });
    assert.equal(restartedProcess.read().revision, 2);
    assert.deepEqual(restartedProcess.read().settings, patch);
    assert.deepEqual(readFileSync(path), committedBytes);
    assert.equal(existsSync(recoveryPath), false);
  });

  it("fails loud without changing evidence when journal and prepared identities differ", () => {
    const path = settingsPath();
    const recoveryPath = `${path}.prepare`;
    const commandId = "74747474-7474-4474-8474-747474747474";
    const patch = { browser: { headless: false } };
    let observation: unknown = { state: "absent" };
    const journal = { observe: () => observation };
    const firstProcess = createSettingsFileService({ path, journal });
    assert.equal(firstProcess.apply({
      commandId,
      commandFingerprint: "4".repeat(64),
      expectedRevision: 1,
      settingsSchemaHash: CURRENT_SETTINGS_SCHEMA_HASH,
      patchFingerprint: deriveSettingsPatchFingerprint(patch),
      patch,
    }).state, "applied");
    const liveBytes = readFileSync(path);
    const prepareBytes = readFileSync(recoveryPath);
    observation = { state: "committed", commandFingerprint: "3".repeat(64), revision: 2 };

    const restartedProcess = createSettingsFileService({ path, journal });
    assert.throws(() => restartedProcess.read(), /does not match its committed journal identity/);
    assert.deepEqual(readFileSync(path), liveBytes);
    assert.deepEqual(readFileSync(recoveryPath), prepareBytes);
  });

  it("preserves prepared bytes when the command audit observation is inconsistent", () => {
    const path = settingsPath();
    const recoveryPath = `${path}.prepare`;
    const commandId = "73737373-7373-4373-8373-737373737373";
    const commandFingerprint = "3".repeat(64);
    const patch = { browser: { headless: false } };
    let observation: unknown = { state: "absent" };
    const journal = { observe: () => observation };
    const firstProcess = createSettingsFileService({ path, journal });
    assert.equal(firstProcess.apply({
      commandId,
      commandFingerprint,
      expectedRevision: 1,
      settingsSchemaHash: CURRENT_SETTINGS_SCHEMA_HASH,
      patchFingerprint: deriveSettingsPatchFingerprint(patch),
      patch,
    }).state, "applied");
    const liveBytes = readFileSync(path);
    const prepareBytes = readFileSync(recoveryPath);
    observation = {
      state: "inconsistent",
      reason: "the settings command audit does not carry the exact expected revision transition",
    };

    const restartedProcess = createSettingsFileService({ path, journal });
    assert.throws(
      () => restartedProcess.read(),
      /cannot reconcile against an inconsistent journal.*exact expected revision transition/,
    );
    assert.deepEqual(readFileSync(path), liveBytes);
    assert.deepEqual(readFileSync(recoveryPath), prepareBytes);
  });
});
