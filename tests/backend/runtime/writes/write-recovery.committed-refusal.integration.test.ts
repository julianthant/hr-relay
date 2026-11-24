import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import type { WriteResolutionContext } from "../../../../src/backend/runs/commands/write-resolution-command.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { UUID_6 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { absentProbeEvidence } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { sourceBoundHarness } from "../../../support/fixtures/integration/source-bound-fixtures.js";

const disposers: (() => Promise<void>)[] = [];

afterEach(async () => { for (const dispose of disposers.splice(0)) await dispose(); });

describe("ref write-safety §4.1 typed operator resolutions (the kernel seam)", () => {
  it("refuses to resolve a committed intent — there is no reopen of committed history", async () => {
    const h = await sourceBoundHarness();
    disposers.push(h.dispose);
    const executor = h.resolution;
    const started = h.start(h.proposal());
    h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
    assert.equal((await h.execute(started)).state, "done");
    const run = h.fresh(started);
    const committed = h.database.authority.writeIntents.listByRun(run.envelope.runId)[0];
    assert.ok(committed?.status === "committed");
    const writeIntentId = committed.writeIntentId;
    const command = CommandRequestSchema.parse({
      commandId: h.ids.uuid(), requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard",
      family: "run", type: "resolve-write-absent", target: {
        runId: run.envelope.runId, expectedVersion: run.version, writeIntentId,
        intentGeneration: committed.generation, writeAttemptId: committed.currentAttemptId, bindingProofDigest: committed.bindingProofDigest,
      }, payload: { occurrenceKeyDigest: committed.idempotencyKeyDigest },
    });
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
