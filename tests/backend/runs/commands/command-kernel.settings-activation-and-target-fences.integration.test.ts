import { createCommandKernelTestWorld } from "../../../support/helpers/backend/command-kernel-harness.js";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach, describe, it } from "vitest";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";

const { roots, openDatabases, profiles, createHarness, nextCommandId, commandFixture, applyCurrentSettings } = createCommandKernelTestWorld();


afterEach(async () => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const profile of profiles.splice(0)) await profile.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("settings activation and target fences", () => {
  it("activates settings while refusing an absent intake target", async () => {
    const harness = await createHarness();
    applyCurrentSettings(harness);
    const fixture = commandFixture("intake", "enqueue-intake-manifest");
    const command = CommandRequestSchema.parse({ ...fixture, commandId: nextCommandId() });

    assert.doesNotThrow(() => harness.database.authority.runtimeConfig.requireSettingsCurrent());
    const result = harness.kernel.execute(command);
    assert.equal(result.state, "rejected");
    if (result.state === "rejected") assert.equal(result.code, "target-not-found");
    assert.equal(harness.database.authority.commands.get(command.commandId), undefined);
  });

  it("activates settings while refusing an absent retry target", async () => {
    const harness = await createHarness();
    applyCurrentSettings(harness);
    const fixture = commandFixture("run", "retry");
    const command = CommandRequestSchema.parse({ ...fixture, commandId: nextCommandId() });

    assert.doesNotThrow(() => harness.database.authority.runtimeConfig.requireSettingsCurrent());
    const result = harness.kernel.execute(command);
    assert.equal(result.state, "rejected");
    if (result.state === "rejected") assert.equal(result.code, "target-not-found");
    assert.equal(harness.database.authority.commands.get(command.commandId), undefined);
  });


});
