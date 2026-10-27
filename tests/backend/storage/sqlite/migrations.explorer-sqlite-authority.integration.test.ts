import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { explorerAuthorityFixture } from "../../../support/fixtures/explorer-authority.js";

const FIRST = "11111111-1111-4111-8111-111111111111";
const SECOND = "22222222-2222-4222-8222-222222222222";
const THIRD = "33333333-3333-4333-8333-333333333333";

describe("Explorer SQLite command authority", () => {
  it("commits one override revision and one audit in the command transaction, with hot readback and restart replay", async () => {
    const f = await explorerAuthorityFixture();
    try {
      const command = f.command(FIRST);
      const generation = f.database.getMeta().authorityGeneration;
      assert.equal(f.kernel.execute(command).state, "applied");
      assert.equal(f.transactionCount, 1);
      assert.equal(f.database.getMeta().authorityGeneration, generation + 1);
      const saved = f.database.authority.explorerOverrides.read("person-lookup");
      assert.equal(saved?.revision, 1);
      assert.equal(saved?.presentation.label, "People search");
      assert.equal(f.database.authority.commandAudits.findByCommand(FIRST)?.result.state, "applied");
      assert.equal(f.read().workflows.find(row => row.id === "person-lookup")?.label, "People search");
      f.restart();
      assert.equal(f.kernel.execute(command).state, "already-applied");
      assert.equal(f.database.getMeta().authorityGeneration, generation + 1);
      assert.deepEqual(f.database.authority.explorerOverrides.read("person-lookup"), saved);
      f.restart();
      assert.equal(f.kernel.execute(command).state, "already-applied");
      assert.equal(f.read().workflows.find(row => row.id === "person-lookup")?.label, "People search");
    } finally { await f.dispose(); }
  });

  it("refuses an executor's fabricated successful readback when the transaction repository has no override", async () => {
    const f = await explorerAuthorityFixture();
    try {
      f.omitOverrideWrite(true);
      assert.throws(() => f.kernel.execute(f.command(FIRST)), /readback that does not exactly advance/u);
      assert.equal(f.database.authority.commands.get(FIRST), undefined);
      assert.equal(f.database.authority.commandAudits.findByCommand(FIRST), undefined);
      assert.deepEqual(f.database.authority.explorerOverrides.readAll(), []);
      f.omitOverrideWrite(false);
      assert.equal(f.kernel.execute(f.command(SECOND)).state, "applied");
    } finally { await f.dispose(); }
  });

  it("rolls back override, revision, command, audit and generation on audit failure; stale then valid competitors work", async () => {
    const f = await explorerAuthorityFixture();
    try {
      const generation = f.database.getMeta().authorityGeneration;
      f.failAudit(true);
      assert.throws(() => f.kernel.execute(f.command(FIRST)), /injected Explorer audit failure/u);
      assert.equal(f.database.getMeta().authorityGeneration, generation);
      assert.deepEqual(f.database.authority.explorerOverrides.readAll(), []);
      assert.equal(f.database.authority.commands.get(FIRST), undefined);
      assert.equal(f.database.authority.commandAudits.findByCommand(FIRST), undefined);
      f.failAudit(false);
      assert.equal(f.kernel.execute(f.command(SECOND, 1)).state, "conflict");
      assert.equal(f.database.authority.commands.get(SECOND), undefined);
      assert.equal(f.kernel.execute(f.command(THIRD, 0, "Directory search")).state, "applied");
      assert.equal(f.kernel.execute(f.command(FIRST)).state, "conflict");
      assert.equal(f.database.authority.explorerOverrides.read("person-lookup")?.presentation.label, "Directory search");
    } finally { await f.dispose(); }
  });

  it.each(["reason", "requestedAt", "source", "requestedBy"] as const)("refuses a divergent %s on restart replay before mutation", async field => {
    const f = await explorerAuthorityFixture();
    try {
      const command = f.command(FIRST);
      assert.equal(f.kernel.execute(command).state, "applied");
      f.restart();
      const value = field === "requestedAt" ? "2026-09-13T11:00:00Z" : field === "source" ? "cli" : field === "requestedBy" ? "other-operator" : "Changed reason";
      assert.throws(() => f.kernel.execute({ ...command, [field]: value }), /reused|identity|different/u);
      assert.equal(f.database.authority.explorerOverrides.read("person-lookup")?.revision, 1);
    } finally { await f.dispose(); }
  });

  it("refuses stale descriptor/version/revision and restores appearance through a new revision", async () => {
    const f = await explorerAuthorityFixture();
    try {
      const command = f.command(FIRST);
      for (const target of [ { expectedVersion: command.target.expectedVersion + 1 }, { contractFingerprint: "0".repeat(64) }, { expectedOverrideRevision: 8 } ]) {
        assert.equal(f.kernel.execute({ ...command, target: { ...command.target, ...target } }).state, "conflict");
        assert.equal(f.database.authority.commands.get(FIRST), undefined);
      }
      assert.equal(f.kernel.execute(command).state, "applied");
      assert.equal(f.kernel.execute(f.command(SECOND, 1, f.descriptor.label)).state, "applied");
      assert.equal(f.read().workflows.find(row => row.id === "person-lookup")?.label, f.descriptor.label);
      assert.equal(f.database.authority.explorerOverrides.read("person-lookup")?.revision, 2);
      assert.equal(f.kernel.execute(command).state, "already-applied");
    } finally { await f.dispose(); }
  });
});
