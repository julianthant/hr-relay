import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe,it } from "vitest";
import { failureResolutionCapability } from "../../../../src/backend/runs/lifecycle/failure-resolution.js";
import { readTimelineRecords } from "../../../../src/backend/storage/events/timeline-reader.js";
import { NOW,failure,id,terminalizeFixtureFailure } from "../../../support/helpers/database-foundation/fixtures.js";
import { resolutionCommand,resolutionFixture,resolutionKernel } from "../../../support/helpers/failure-resolution/fixtures.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

function snapshot(f: Awaited<ReturnType<typeof resolutionFixture>>, excludeHttpDiagnostics = false) {
  const sql = new DatabaseSync(f.path);
  try { return JSON.stringify({ ...(excludeHttpDiagnostics ? {} : { generation: f.db.getMeta().authorityGeneration }),
    tables: Object.fromEntries(["runs", "run_failures", "commands", "command_audits", "timeline_events", "run_receipts"]
      .map(table => [table, sql.prepare(`SELECT * FROM ${table}${excludeHttpDiagnostics && table === "timeline_events" ? " WHERE kind <> 'debug'" : ""} ORDER BY 1`).all()])) }); }
  finally { sql.close(); }
}

describe("D resolution command authority", () => {
  it("resolves/reopens only its annotation and preserves immutable failure/run/completion evidence", async () => {
    const f = await resolutionFixture();
    try {
      assert.equal(failureResolutionCapability().state, "available");
      const beforeRun = JSON.stringify(f.db.authority.runs.get(f.record.runId));
      const beforeFailure = JSON.stringify(f.db.authority.failures.get(f.record.failureId));
      const command = resolutionCommand();
      assert.equal(f.kernel.execute(command).state, "applied");
      assert.deepEqual(f.db.authority.failureResolution.read(f.record.runId, f.record.failureId)?.resolution,
        { status: "resolved", version: 2, by: "local-operator", at: NOW, note: "Updated page control." });
      const audit = f.db.authority.commandAudits.findByCommand(command.commandId);
      assert.deepEqual(audit?.versionChanges, [{ target: { family: "failure-resolution", runId: f.record.runId, failureId: f.record.failureId }, before: 1, after: 2 }]);
      const reopen = resolutionCommand({ target: { ...command.target, expectedVersion: 2 }, payload: { action: "reopen" } });
      assert.equal(f.kernel.execute(reopen).state, "applied");
      assert.deepEqual(f.db.authority.failureResolution.read(f.record.runId, f.record.failureId)?.resolution, { status: "unresolved", version: 3 });
      assert.equal(JSON.stringify(f.db.authority.runs.get(f.record.runId)), beforeRun);
      assert.equal(JSON.stringify(f.db.authority.failures.get(f.record.failureId)), beforeFailure);
      const history = readTimelineRecords(f.db.authority.timelineEvents).records.filter(row => row.payload.kind === "failure-resolution");
      assert.deepEqual(history.map(row => row.payload.kind === "failure-resolution" && row.payload.action), ["resolve", "reopen"]);
      assert.ok(history.every(row => !JSON.stringify(row).includes("Updated page control")));
    } finally { await f.dispose(); }
  });
  it("exact replay after lost acknowledgement and restart does not advance any authority; divergent identity refuses", async () => {
    const f = await resolutionFixture();
    try {
      const command = resolutionCommand();
      const lostAck = resolutionKernel(f.db, f.clock, { authority: { withAuthorityTransaction: work => {
        f.db.withAuthorityTransaction(work); throw new Error("ack-lost");
      } } });
      assert.throws(() => lostAck.execute(command), /ack-lost/u);
      const before = snapshot(f);
      const second = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 500, migrationOwner: "d-restart" }, f.clock);
      try {
        const kernel = resolutionKernel(second, f.clock);
        assert.equal(kernel.execute(command).state, "already-applied");
        assert.equal(snapshot(f), before);
        const divergent = kernel.execute({ ...command, payload: { action: "resolve", note: "Different" } });
        assert.equal(divergent.state, "rejected");
        if (divergent.state === "rejected") assert.equal(divergent.code, "command-divergent");
        assert.equal(snapshot(f), before);
      } finally { second.close(); }
    } finally { await f.dispose(); }
  });
  it("two real connections fence the same annotation version", async () => {
    const f = await resolutionFixture();
    const second = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 500, migrationOwner: "d-race" }, f.clock);
    try {
      const other = resolutionKernel(second, f.clock);
      const commands = [resolutionCommand(), resolutionCommand()];
      const results = await Promise.all([Promise.resolve().then(() => f.kernel.execute(commands[0])), Promise.resolve().then(() => other.execute(commands[1]))]);
      assert.deepEqual(results.map(result => result.state).sort(), ["applied", "rejected"]);
      const loser = results.find(result => result.state === "rejected"); assert.ok(loser);
      assert.equal(f.db.authority.commands.get(loser.commandId), undefined);
      assert.equal(f.db.authority.commandAudits.findByCommand(loser.commandId), undefined);
      assert.equal(f.db.authority.failureResolution.read(f.record.runId, f.record.failureId)?.resolution.version, 2);
    } finally { second.close(); await f.dispose(); }
  });
  for (const boundary of ["annotation", "event", "audit"] as const) it(`rolls back generation, annotation and journal on ${boundary} failure with a same-boundary positive control`, async () => {
    const f = await resolutionFixture();
    let hit = 0;
    try {
      const original = snapshot(f);
      const command = resolutionCommand();
      const kernel = resolutionKernel(f.db, f.clock, { authority: { withAuthorityTransaction: work => f.db.withAuthorityTransaction(repositories => work({
        ...repositories,
        ...(boundary === "annotation" ? { failureResolution: { ...repositories.failureResolution, update: input => { repositories.failureResolution.update(input); hit++; throw new Error("injected-annotation"); } } } : {}),
        ...(boundary === "event" ? { timelineEvents: { ...repositories.timelineEvents, append: input => { repositories.timelineEvents.append(input); hit++; throw new Error("injected-event"); } } } : {}),
        ...(boundary === "audit" ? { commandAudits: { ...repositories.commandAudits, insert: input => { repositories.commandAudits.insert(input); hit++; throw new Error("injected-audit"); } } } : {}),
      })) } });
      assert.throws(() => kernel.execute(command), new RegExp(`injected-${boundary}`, "u"));
      assert.equal(hit, 1); assert.equal(snapshot(f), original);
      assert.equal(f.kernel.execute(command).state, "applied");
      assert.ok(f.db.authority.commandAudits.findByCommand(command.commandId));
    } finally { await f.dispose(); }
  });
  it("refuses absent, mismatched, stale and same-state targets without any mutation", async () => {
    const f = await resolutionFixture();
    try {
      const before = snapshot(f);
      for (const target of [
        { runId: randomUUID(), failureId: f.record.failureId, expectedVersion: 1 },
        { runId: f.record.runId, failureId: randomUUID(), expectedVersion: 1 },
        { runId: f.record.runId, failureId: f.record.failureId, expectedVersion: 9 },
      ]) { assert.equal(f.kernel.execute(resolutionCommand({ target })).state, "rejected"); assert.equal(snapshot(f), before); }
      assert.equal(f.kernel.execute(resolutionCommand({ payload: { action: "reopen" } })).state, "rejected");
      assert.equal(snapshot(f), before);
      for (const payload of [{ action: "other" }, { action: "resolve", note: " " }, { action: "resolve", note: "x".repeat(1001) }, { action: "reopen", note: "no" }]) {
        assert.throws(() => f.kernel.execute({ ...resolutionCommand(), payload })); assert.equal(snapshot(f), before);
      }
      assert.throws(() => f.kernel.execute({ ...resolutionCommand(), target: { runId: f.record.runId, failureId: f.record.failureId, expectedVersion: 0 } }));
      assert.equal(snapshot(f), before);
    } finally { await f.dispose(); }
  });
  it("matching fingerprints remain independently unresolved", async () => {
    const f = await resolutionFixture();
    try {
      const run = f.createRun(id(81));
      const sibling = { ...failure(), failureId: id(82), runId: run.envelope.runId, traceId: run.envelope.traceId };
      terminalizeFixtureFailure(f, run, sibling);
      assert.equal(f.kernel.execute(resolutionCommand()).state, "applied");
      assert.deepEqual(f.db.authority.failureResolution.read(sibling.runId, sibling.failureId)?.resolution, { status: "unresolved", version: 1 });
      assert.equal(f.db.authority.failures.get(f.record.failureId)?.writeState, "unknown");
    } finally { await f.dispose(); }
  });
});

import { resolutionPeer } from "../../../support/helpers/failure-resolution/fixtures.js";
it("two independent OS processes compete for one annotation version and exactly one commits", async () => {
  const f = await resolutionFixture(undefined, undefined, { sharedMachine: true });
  const peers: ReturnType<typeof resolutionPeer>[] = [];
  try {
    for (let index = 0; index < 2; index++) {
      const peer = resolutionPeer(f.path); peers.push(peer);
      await peer.ready;
    }
    const outcomes = await Promise.all(peers.map(peer => peer.send(resolutionCommand())));
    assert.deepEqual(outcomes.map(result => result.state).sort(), ["applied", "rejected"]);
    assert.equal(f.db.authority.failureResolution.read(f.record.runId, f.record.failureId)?.resolution.version, 2);
    const loser = outcomes.find(result => result.state === "rejected"); assert.ok(loser);
    assert.equal(f.db.authority.commands.get(loser.commandId), undefined);
  } finally { for (const peer of peers) peer.stop(); await f.dispose(); }
});
