import { createCommandKernelTestWorld } from "../../../support/helpers/backend/command-kernel-harness.js";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach, describe, it } from "vitest";
import { type SettingsApplicationExecutor } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { SETTINGS_SCHEMA_HASH, SettingsApplyRejectionCodeSchema, derivePersistedSettingsFingerprint, deriveSettingsPatchFingerprint } from "../../../../src/models/config/settings.js";
import { deriveSettingsCommandFingerprint } from "../../../../src/rules/commands/commands.js";
import { HASH_A, NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { createCredentialStore } from "../../../support/helpers/synthetic-storage-admission.js";

const { roots, openDatabases, profiles, createHarness, nextCommandId } = createCommandKernelTestWorld();


afterEach(async () => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const profile of profiles.splice(0)) await profile.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("apply-settings authority", () => {
  it.each(SettingsApplyRejectionCodeSchema.options)(
    "preserves the closed %s rejection code and rolls back the command journal",
    async (code) => {
      const settings: SettingsApplicationExecutor = {
        validateRequest: () => undefined,
        commitPrivate: () => undefined,
        reconcileReplay: () => {
          throw new Error("rejected settings fixture has no replay authority");
        },
        applyOrdinary: () => ({ state: "rejected", code, message: `${code} { document: settings.json }` }),
      };
      const harness = await createHarness(undefined, settings);
      const patch = { "browser.headless": { set: false } } as const;
      const command = {
        commandId: nextCommandId(), requestedAt: NOW, requestedBy: "local-operator", source: "dashboard",
        family: "settings", type: "apply-settings", target: { expectedRevision: 1 },
        payload: {
          settingsSchemaHash: SETTINGS_SCHEMA_HASH,
          patchFingerprint: deriveSettingsPatchFingerprint(patch),
          patch,
        },
      } as const;

      const result = harness.kernel.execute(command);

      assert.equal(result.state, "rejected");
      if (result.state === "rejected") assert.equal(result.code, code);
      assert.equal(harness.database.authority.commands.get(command.commandId), undefined);
      assert.equal(harness.database.authority.commandAudits.findByCommand(command.commandId), undefined);
    },
  );

  it("maps candidate validation failure to a value-free rejection without changing SQLite", async () => {
    const credentialProfile = await createBoundProfileFixture();
    const credentials = createCredentialStore({ stateRoot: credentialProfile.stateRoot });
    const harness = await createHarness(undefined, createSettingsApplicationExecutor(() => {
      throw new Error("private candidate diagnostic must not cross the authority boundary");
    }, credentials));
    const patch = { "browser.headless": { set: false } } as const;
    const command = {
      commandId: nextCommandId(), requestedAt: NOW, requestedBy: "local-operator", source: "dashboard",
      family: "settings", type: "apply-settings", target: { expectedRevision: 1 },
      payload: {
        settingsSchemaHash: SETTINGS_SCHEMA_HASH,
        patchFingerprint: deriveSettingsPatchFingerprint(patch),
        patch,
      },
    } as const;

    const result = harness.kernel.execute(command);

    assert.deepEqual(result, {
      state: "rejected",
      commandId: command.commandId,
      code: "cross-field-invalid",
      message: "cross-field-invalid { keys: browser.headless }",
    });
    assert.equal(JSON.stringify(result).includes("private candidate diagnostic"), false);
    assert.equal(harness.database.authority.commands.get(command.commandId), undefined);
    assert.equal(harness.database.authority.commandAudits.findByCommand(command.commandId), undefined);
    assert.equal(harness.database.authority.settingsCurrent.get(), undefined);
    assert.deepEqual(readSettings(harness.database.authority), {
      revision: 1,
      settingsSchemaHash: SETTINGS_SCHEMA_HASH,
      settingsFingerprint: derivePersistedSettingsFingerprint({}),
      settings: {},
    });
    await credentialProfile.close();
  });

  it("recovers an ambiguous SQLite COMMIT through exact command replay", async () => {
    let reported = false;
    const harness = await createHarness(undefined, {}, (database, work) => {
      const result = database.withAuthorityTransaction(work);
      if (!reported) {
        reported = true;
        throw new Error("injected exception after durable COMMIT");
      }
      return result;
    });
    const patch = { "browser.headless": { set: false } } as const;
    const command = {
      commandId: nextCommandId(), requestedAt: NOW, requestedBy: "local-operator", source: "dashboard",
      family: "settings", type: "apply-settings", target: { expectedRevision: 1 },
      payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch },
    } as const;

    assert.throws(() => harness.kernel.execute(command), /injected exception after durable COMMIT/u);
    const committed = readSettings(harness.database.authority);
    assert.equal(committed.revision, 2);
    assert.deepEqual(committed.settings, { browser: { headless: false } });
    assert.equal(harness.database.authority.settingsCurrent.get()?.commandId, command.commandId);
    assert.equal(harness.database.authority.commandAudits.findByCommand(command.commandId)?.result.state, "applied");

    const replay = harness.kernel.execute(command);
    assert.deepEqual(replay, {
      state: "already-applied",
      commandId: command.commandId,
      affectedTargets: [{ family: "settings", revision: 2 }],
      restartRequired: false,
      settingsRevision: 2,
      settingsFingerprint: committed.settingsFingerprint,
    });
    assert.deepEqual(readSettings(harness.database.authority), committed);
  });

  it("applies one strict multi-leaf patch at the expected settings revision", async () => {
    const harness = await createHarness();
    const patch = {
      "browser.headless": { set: false },
      "display.screenWidth": { set: 1920 },
      "display.screenHeight": { set: 1080 },
    } as const;
    const commandId = nextCommandId();
    const persistedSettings = {
      browser: { headless: false },
      display: { screenHeight: 1080, screenWidth: 1920 },
    };
    const settingsFingerprint = derivePersistedSettingsFingerprint(persistedSettings);

    const result = harness.kernel.execute({
      commandId,
      requestedAt: NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "settings",
      type: "apply-settings",
      target: { expectedRevision: 1 },
      payload: {
        settingsSchemaHash: SETTINGS_SCHEMA_HASH,
        patchFingerprint: deriveSettingsPatchFingerprint(patch),
        patch,
      },
    });

    assert.deepEqual(result, {
      state: "applied",
      commandId,
      affectedTargets: [{ family: "settings", revision: 2 }],
      restartRequired: false,
      settingsRevision: 2,
      settingsFingerprint,
    });
    assert.deepEqual(
      harness.database.authority.commandAudits.findByCommand(commandId)?.versionChanges,
      [{ target: { family: "settings", revision: 2 }, before: 1, after: 2 }],
    );
    const audit = harness.database.authority.commandAudits.findByCommand(commandId);
    assert.ok(audit !== undefined);
    assert.deepEqual(harness.database.authority.settingsCurrent.get(), {
      revision: 2,
      settings: persistedSettings,
      settingsFingerprint,
      commandId,
      commandFingerprint: deriveSettingsCommandFingerprint(audit.request),
      auditId: audit.auditId,
      committedAt: NOW,
    });

    const stalePatch = { "timeouts.taskMs": { set: 240_000 } } as const;
    const staleCommandId = nextCommandId();
    const stale = harness.kernel.execute({
      commandId: staleCommandId,
      requestedAt: NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "settings",
      type: "apply-settings",
      target: { expectedRevision: 1 },
      payload: {
        settingsSchemaHash: SETTINGS_SCHEMA_HASH,
        patchFingerprint: deriveSettingsPatchFingerprint(stalePatch),
        patch: stalePatch,
      },
    });
    assert.equal(stale.state, "conflict");
    if (stale.state === "conflict") assert.equal(stale.currentVersion, 2);
    assert.equal(harness.database.authority.commands.get(staleCommandId), undefined);
    assert.deepEqual(readSettings(harness.database.authority).settings, persistedSettings);
  });

  it("refuses an executor outcome that does not advance exactly one revision", async () => {
    const settings: SettingsApplicationExecutor = {
      validateRequest: () => undefined,
      commitPrivate: () => undefined,
      reconcileReplay: () => {
        throw new Error("wrong-revision fixture has no replay authority");
      },
      applyOrdinary: (command) => ({
        state: "applied",
        revision: command.target.expectedRevision + 2,
        settingsFingerprint: HASH_A,
        settings: {},
      }),
    };
    const harness = await createHarness(undefined, settings);
    const patch = { "timeouts.taskMs": { set: 240_000 } } as const;
    const command = {
      commandId: nextCommandId(),
      requestedAt: NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "settings",
      type: "apply-settings",
      target: { expectedRevision: 1 },
      payload: {
        settingsSchemaHash: SETTINGS_SCHEMA_HASH,
        patchFingerprint: deriveSettingsPatchFingerprint(patch),
        patch,
      },
    } as const;

    assert.throws(
      () => harness.kernel.execute(command),
      /settings executor did not advance exactly one revision/u,
    );

    assert.deepEqual({
      journal: harness.database.authority.commands.get(command.commandId),
      audit: harness.database.authority.commandAudits.findByCommand(command.commandId),
      current: harness.database.authority.settingsCurrent.get(),
    }, {
      journal: undefined,
      audit: undefined,
      current: undefined,
    });
  });

  it("rolls ordinary settings and journal effects back when command audit insertion fails", async () => {
    let failAudit = false;
    const harness = await createHarness((repositories) => ({
      ...repositories,
      commandAudits: {
        ...repositories.commandAudits,
        insert: (input: unknown) => {
          if (failAudit) throw new Error("injected settings audit failure");
          return repositories.commandAudits.insert(input);
        },
      },
    }));
    const patch = { "timeouts.taskMs": { set: 240_000 } } as const;
    const commandId = nextCommandId();
    failAudit = true;

    assert.throws(() => harness.kernel.execute({
      commandId,
      requestedAt: NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "settings",
      type: "apply-settings",
      target: { expectedRevision: 1 },
      payload: {
        settingsSchemaHash: SETTINGS_SCHEMA_HASH,
        patchFingerprint: deriveSettingsPatchFingerprint(patch),
        patch,
      },
    }), /injected settings audit failure/u);
    assert.equal(harness.database.authority.commands.get(commandId), undefined);
    assert.equal(harness.database.authority.commandAudits.findByCommand(commandId), undefined);
    assert.equal(harness.database.authority.settingsCurrent.get(), undefined);
    assert.deepEqual(readSettings(harness.database.authority).settings, {});
  });

  it("rolls ordinary settings, command, and audit back when current-result advance fails", async () => {
    let failCurrent = false;
    const harness = await createHarness((repositories) => ({
      ...repositories,
      settingsCurrent: {
        ...repositories.settingsCurrent,
        advance: (input: unknown) => {
          if (failCurrent) throw new Error("injected settings current-result failure");
          return repositories.settingsCurrent.advance(input);
        },
      },
    }));
    const patch = { "timeouts.taskMs": { set: 240_000 } } as const;
    const commandId = nextCommandId();
    failCurrent = true;

    assert.throws(() => harness.kernel.execute({
      commandId,
      requestedAt: NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "settings",
      type: "apply-settings",
      target: { expectedRevision: 1 },
      payload: {
        settingsSchemaHash: SETTINGS_SCHEMA_HASH,
        patchFingerprint: deriveSettingsPatchFingerprint(patch),
        patch,
      },
    }), /injected settings current-result failure/u);
    assert.equal(harness.database.authority.commands.get(commandId), undefined);
    assert.equal(harness.database.authority.commandAudits.findByCommand(commandId), undefined);
    assert.equal(harness.database.authority.settingsCurrent.get(), undefined);
    assert.deepEqual(readSettings(harness.database.authority).settings, {});
  });
});
