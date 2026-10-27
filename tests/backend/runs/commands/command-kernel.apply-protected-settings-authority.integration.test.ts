import { createCommandKernelTestWorld } from "../../../support/helpers/backend/command-kernel-harness.js";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/protected-settings.js";
import { ProtectedSettingsCommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { HASH_A, NOW, UUID_4, UUID_7 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { createCredentialStore } from "../../../support/helpers/synthetic-storage-admission.js";

const { roots, openDatabases, profiles, databasePath, createHarness, nextCommandId } = createCommandKernelTestWorld();


afterEach(async () => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const profile of profiles.splice(0)) await profile.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function protectedSettingsCommand(input: Readonly<{
  commandId?: string;
  expectedRevision?: number;
  protectedSchemaHash?: string;
  value: string;
  writeId?: string;
}>) {
  return ProtectedSettingsCommandRequestSchema.parse({
    commandId: input.commandId ?? nextCommandId(),
    requestedAt: NOW,
    requestedBy: "local-operator",
    source: "settings-surface",
    family: "settings",
    type: "apply-protected-settings",
    target: { expectedRevision: input.expectedRevision ?? 1 },
    payload: {
      protectedSchemaHash: input.protectedSchemaHash ?? PROTECTED_SETTINGS_SCHEMA_HASH,
      writeId: input.writeId ?? UUID_7,
      entries: { ucpathPassword: { set: input.value } },
    },
  });
}

describe("apply-protected-settings authority", () => {
  it("refuses a stale protected schema before reading or materializing credentials", async () => {
    assert.notEqual(HASH_A, PROTECTED_SETTINGS_SCHEMA_HASH);
    const stateRoot = databasePath("invalid-credential-root");
    const credentials = createCredentialStore({ stateRoot });
    const harness = await createHarness(undefined, createSettingsApplicationExecutor(() => { throw new Error("protected fixture reached ordinary settings"); }, credentials));
    const command = protectedSettingsCommand({
      protectedSchemaHash: HASH_A,
      value: "must-not-reach-authority",
    });

    assert.deepEqual(harness.kernel.execute(command), {
      state: "rejected",
      commandId: command.commandId,
      code: "schema-mismatch",
      message: "credential schema does not match the current catalog",
    });
    assert.equal(existsSync(join(stateRoot, "credentials")), false);
    assert.equal(harness.database.authority.commands.get(command.commandId), undefined);
    assert.equal(harness.database.authority.commandAudits.findByCommand(command.commandId), undefined);
    assert.equal(harness.database.authority.settingsCurrent.get(), undefined);
  });

  it("keeps an independently committed credential across audit failure and settles exact retry", async () => {
    let failAudit = true;
    const harness = await createHarness((repositories) => ({
      ...repositories,
      commandAudits: {
        ...repositories.commandAudits,
        insert: (input: unknown) => {
          if (failAudit) throw new Error("injected protected audit failure");
          return repositories.commandAudits.insert(input);
        },
      },
    }));
    const protectedValue = "protected-value-before-audit";
    const command = protectedSettingsCommand({ value: protectedValue });
    const protectedPath = join(harness.stateRoot, "credentials", "protected.json");

    assert.throws(
      () => harness.kernel.execute(command),
      /credential-audit-uncertain: credentials committed; retry the exact command/u,
    );
    assert.equal(harness.credentials.read().revision, 2);
    assert.equal(harness.credentials.read().entries.ucpathPassword?.value, protectedValue);
    const committedBytes = readFileSync(protectedPath);
    assert.equal(harness.database.authority.commands.get(command.commandId), undefined);
    assert.equal(harness.database.authority.commandAudits.findByCommand(command.commandId), undefined);

    const divergent = protectedSettingsCommand({
      commandId: command.commandId,
      value: "divergent-protected-value",
      writeId: command.payload.writeId,
    });
    const divergentResult = harness.kernel.execute(divergent);
    assert.equal(divergentResult.state, "rejected");
    if (divergentResult.state === "rejected") assert.equal(divergentResult.code, "command-divergent");
    assert.deepEqual(readFileSync(protectedPath), committedBytes);
    assert.equal(harness.database.authority.commands.get(command.commandId), undefined);

    failAudit = false;
    const applied = harness.kernel.execute(command);
    assert.equal(applied.state, "applied");
    assert.deepEqual(harness.kernel.execute(command), { ...applied, state: "already-applied" });
    assert.deepEqual(readFileSync(protectedPath), committedBytes);

    const stale = protectedSettingsCommand({
      expectedRevision: 1,
      value: "stale-protected-value",
      writeId: UUID_4,
    });
    const staleResult = harness.kernel.execute(stale);
    assert.equal(staleResult.state, "conflict");
    if (staleResult.state === "conflict") assert.equal(staleResult.currentVersion, 2);
    assert.equal(harness.database.authority.commands.get(stale.commandId), undefined);
    assert.deepEqual(readFileSync(protectedPath), committedBytes);

    const reusedWrite = protectedSettingsCommand({
      expectedRevision: 2,
      value: "reused-write-protected-value",
      writeId: command.payload.writeId,
    });
    const reusedResult = harness.kernel.execute(reusedWrite);
    assert.equal(reusedResult.state, "rejected");
    if (reusedResult.state === "rejected") assert.equal(reusedResult.code, "command-divergent");
    assert.equal(harness.database.authority.commands.get(reusedWrite.commandId), undefined);
    assert.deepEqual(readFileSync(protectedPath), committedBytes);
  });

  it("journals only marked operations while the independent store owns credential values", async () => {
    const harness = await createHarness();
    const protectedValue = "protected-value-that-must-never-reach-sqlite";
    const command = protectedSettingsCommand({ value: protectedValue });
    const result = harness.kernel.execute(command);

    assert.equal(result.state, "applied");
    if (result.state !== "applied") return;
    assert.equal(result.restartRequired, false);
    assert.equal(result.revision, 2);
    assert.deepEqual(result.affectedTargets, [{ family: "protected-settings", revision: 2 }]);
    assert.equal(result.entries?.ucpathPassword.present, true);
    const journal = harness.database.authority.commands.get(command.commandId);
    const audit = harness.database.authority.commandAudits.findByCommand(command.commandId);
    assert.ok(journal !== undefined);
    assert.ok(audit !== undefined);
    const durableBytes = JSON.stringify({ journal, audit, current: harness.database.authority.settingsCurrent.get() });
    assert.equal(durableBytes.includes(protectedValue), false);
    assert.equal(durableBytes.includes(sha256Hex(protectedValue)), false);
    assert.equal(durableBytes.includes('"set":"<set>"'), true);
    assert.equal(harness.database.authority.settingsCurrent.get(), undefined);
    const credentialRecord = harness.credentials.read();
    assert.equal(credentialRecord.revision, 2);
    assert.equal(credentialRecord.entries.ucpathPassword?.value, protectedValue);
    assert.equal(credentialRecord.lastApplied?.commandId, command.commandId);
  });
});
