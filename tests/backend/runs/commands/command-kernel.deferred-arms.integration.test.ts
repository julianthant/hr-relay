import { createCommandKernelTestWorld } from "../../../support/helpers/backend/command-kernel-harness.js";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach, describe, it } from "vitest";
import { PHASE1_DEFERRED_COMMAND_ARMS } from "../../../../src/backend/runs/commands/command-kernel.js";
import { type CommandRequest } from "../../../../src/rules/commands/commands.js";

const { roots, openDatabases, createHarness, commandFixture } = createCommandKernelTestWorld();


afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("deferred arms", () => {
  const deferredKeys = new Set(
    Object.entries(
      PHASE1_DEFERRED_COMMAND_ARMS as Readonly<Record<string, readonly string[]>>,
    ).flatMap(([family, actions]) =>
      actions.map((action) => `${family}/${action}`)),
  );

  it("returns typed capability-unavailable for EVERY deferred arm with zero authority side effects", async () => {
    const harness = await createHarness();
    const deferredFixtures = [...deferredKeys].map((key) => {
      const [family, type] = key.split("/");
      assert.ok(family !== undefined && type !== undefined);
      return commandFixture(family as CommandRequest["family"], type);
    });
    assert.equal(deferredFixtures.length, deferredKeys.size);

    for (const request of deferredFixtures) {
      const generationBefore = harness.database.getMeta().authorityGeneration;
      const result = harness.kernel.execute(request);
      assert.equal(result.state, "rejected", `${request.family}/${request.type}`);
      if (result.state !== "rejected") continue;
      assert.equal(result.code, "capability-unavailable", `${request.family}/${request.type}`);
      assert.match(result.message, /no authority state was changed/);
      assert.equal(
        harness.database.getMeta().authorityGeneration,
        generationBefore,
        `${request.family}/${request.type} advanced the authority generation`,
      );
      assert.equal(
        harness.database.authority.commands.get(request.commandId),
        undefined,
        `${request.family}/${request.type} was journaled`,
      );
      assert.equal(
        harness.database.authority.commandAudits.findByCommand(request.commandId),
        undefined,
        `${request.family}/${request.type} was audited`,
      );
    }
  });


});
