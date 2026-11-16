import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import type { WriteResolutionContext } from "../../../../src/backend/runs/commands/command-kernel.js";
import { UUID_6 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { writeFixtureDescriptor } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { createWriteRecoveryTestWorld } from "../../../support/helpers/backend/write-recovery-world.js";

const {SIGNAL, resolutionHarness, commandFor, parkedAttemptingWrite, cleanup } = createWriteRecoveryTestWorld();

afterEach(cleanup);

describe("ref write-safety §4.1 typed operator resolutions (the kernel seam)", () => {
  it("refuses to resolve a committed intent — there is no reopen of committed history", async () => {
    const { h, executor } = await resolutionHarness();
    const { run, writeIntentId } = parkedAttemptingWrite(h);
    h.world.probeResults.push({ state: "present", proof: { transactionId: "T654321" } });
    return h.recovery.recover({ descriptor: writeFixtureDescriptor, writeIntentId, signal: SIGNAL })
      .then((decision) => {
        assert.equal(decision.state, "backfilled");
        const committed = h.database.authority.writeIntents.get(writeIntentId);
        assert.ok(committed);
        const command = commandFor("resolve-write-absent", run, {});
        if (command.family !== "run" || command.type !== "resolve-write-absent") throw new Error("unreachable");
        const context: WriteResolutionContext = Object.freeze({
          auditId:UUID_6, command, run, intent: committed, now: h.clock.now().toISOString(),
        });
        assert.throws(
          () => h.database.withAuthorityTransaction((repositories) => executor.resolveAbsent(repositories, context)),
          /has no operator resolution/,
        );
        assert.equal(h.database.authority.writeIntents.get(writeIntentId)?.status, "committed");
      });
  });
});
