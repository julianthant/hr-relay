import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "vitest";
import { AuthorityDatabase } from "../../helpers/synthetic-storage-admission.js";
import { failureResolutionCapability } from "../../../src/core/failure-resolution.js";
import { readTimelineRecords } from "../../../src/infra/events/timeline-reader.js";
import { TimelineAppendSchema } from "../../../src/events/timeline.js";
import { deriveWriteBindingProofDigest } from "../../../src/domain/write-safety.js";
import { WRITE_INTENT_ATTEMPTING, WRITE_ATTEMPT } from "../../fixtures/phase1c-contract-fixtures.js";
import { resolutionFixture, resolutionKernel, resolutionCommand } from "./fixtures.js";
import { NOW, failure, terminalizeFixtureFailure, id } from "../database-foundation/fixtures.js";

function snapshot(f: ReturnType<typeof resolutionFixture>) {
  const sql = new DatabaseSync(f.path);
  try { return JSON.stringify({ generation: f.db.getMeta().authorityGeneration,
    tables: Object.fromEntries(["workflow_runs", "run_failures", "commands", "command_audits", "timeline_events", "run_receipts"]
      .map(table => [table, sql.prepare(`SELECT * FROM ${table} ORDER BY record_key`).all()])) }); }
  finally { sql.close(); }
}

describe("D resolution command authority", () => {
  it("resolves/reopens only its annotation and preserves immutable failure/run/completion evidence", () => {
    const f = resolutionFixture();
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
    } finally { f.dispose(); }
  });
  it("exact replay after lost acknowledgement and restart does not advance any authority; divergent identity refuses", () => {
    const f = resolutionFixture();
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
    } finally { f.dispose(); }
  });
  it("two real connections fence the same annotation version", async () => {
    const f = resolutionFixture();
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
    } finally { second.close(); f.dispose(); }
  });
  for (const boundary of ["annotation", "event", "audit"] as const) it(`rolls back generation, annotation and journal on ${boundary} failure with a same-boundary positive control`, () => {
    const f = resolutionFixture();
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
    } finally { f.dispose(); }
  });
  it("refuses absent, mismatched, stale and same-state targets without any mutation", () => {
    const f = resolutionFixture();
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
    } finally { f.dispose(); }
  });
  it("matching fingerprints remain independently unresolved", () => {
    const f = resolutionFixture();
    try {
      const run = f.createRun(id(81));
      const sibling = { ...failure(), failureId: id(82), runId: run.envelope.runId, traceId: run.envelope.traceId };
      terminalizeFixtureFailure(f, run, sibling);
      assert.equal(f.kernel.execute(resolutionCommand()).state, "applied");
      assert.deepEqual(f.db.authority.failureResolution.read(sibling.runId, sibling.failureId)?.resolution, { status: "unresolved", version: 1 });
      assert.equal(f.db.authority.failures.get(f.record.failureId)?.writeState, "unknown");
    } finally { f.dispose(); }
  });
  it("annotation cannot settle a parked UNKNOWN write or admit its generic retry", () => {
    const f = resolutionFixture();
    try {
      const run = f.createRun(id(83));
      assert.equal(run.lifecycle.state, "running");
      if (run.lifecycle.state !== "running") throw new Error("fixture not running");
      const bindingProof = { ...WRITE_INTENT_ATTEMPTING.bindingProof, runId: run.envelope.runId };
      const bindingProofDigest = deriveWriteBindingProofDigest(bindingProof);
      const intent = { ...WRITE_INTENT_ATTEMPTING, runId: run.envelope.runId, bindingProof, bindingProofDigest,
        workflowId: run.envelope.workflow, itemId: run.envelope.itemId };
      assert.equal(f.db.authority.writeIntents.fenceAttempt({ intent,
        attempt: { ...WRITE_ATTEMPT, runId: run.envelope.runId, bindingProof, bindingProofDigest } }).state, "fenced");
      const parked = f.db.authority.runs.transition({ runId: run.envelope.runId, expectedVersion: run.version,
        claim: { workerId: run.lifecycle.workerId, claimGeneration: run.claimGeneration },
        lifecycle: { state: "parked-write", writeIntentId: intent.writeIntentId, intentGeneration: 1,
          parkedAt: NOW, code: "unknown", message: "Synthetic UNKNOWN submit" }, now: NOW });
      assert.equal(parked.state, "applied");
      if (parked.state !== "applied") throw new Error("fixture not parked");
      const retry = () => f.kernel.execute({ commandId: randomUUID(), requestedAt: NOW,
        requestedBy: "local-operator", source: "dashboard", reason: "Synthetic retry",
        family: "run", type: "retry", target: { runId: run.envelope.runId, expectedVersion: parked.run.version } });
      const before = JSON.stringify({ run: f.db.authority.runs.get(run.envelope.runId),
        intent: f.db.authority.writeIntents.get(intent.writeIntentId) });
      const first = retry(); assert.equal(first.state, "rejected");
      if (first.state === "rejected") assert.match(first.message, /never generic retry/u);
      assert.equal(f.kernel.execute(resolutionCommand()).state, "applied");
      const after = retry(); assert.equal(after.state, "rejected");
      if (after.state === "rejected") assert.match(after.message, /never generic retry/u);
      assert.equal(JSON.stringify({ run: f.db.authority.runs.get(run.envelope.runId),
        intent: f.db.authority.writeIntents.get(intent.writeIntentId) }), before);
      assert.equal(f.db.authority.failures.get(f.record.failureId)?.writeState, "unknown");
    } finally { f.dispose(); }
  });
  it("strict history binds scope/time/source, duplicate identity and ordinary retention", () => {
    const f = resolutionFixture();
    try {
      f.kernel.execute(resolutionCommand());
      const record = readTimelineRecords(f.db.authority.timelineEvents).records.find(row => row.payload.kind === "failure-resolution"); assert.ok(record);
      const { cursor: _cursor, ...append } = record;
      assert.equal(f.db.authority.timelineEvents.append(append).state, "existing");
      for (const bad of [{ ...append, workflow: "separations" }, { ...append, scope: { kind: "run", runId: randomUUID() } }, { ...append, occurredAt: "2026-09-10T00:00:00.000Z" }, { ...append, payload: { ...append.payload, note: "forbidden" } }]) {
        assert.equal(TimelineAppendSchema.safeParse(bad).success, false);
      }
      assert.throws(() => f.db.authority.timelineEvents.append({ ...append, retentionDate: "2026-09-08" }), /identity-conflict/u);
      assert.ok(f.db.authority.timelineEvents.pruneBefore("2026-09-10") >= 1);
      assert.equal(f.db.authority.timelineEvents.get(record.eventId), undefined);
      assert.equal(f.db.authority.failureResolution.read(f.record.runId, f.record.failureId)?.resolution.status, "resolved");
    } finally { f.dispose(); }
  });
});

describe("D actual HTTP admission", () => {
  it("admits actor and server time, refuses forged actor/Host/Origin and malformed actions without mutation", async () => {
    const f = resolutionFixture();
    try {
      const app = resolutionApp(f); const before = snapshot(f);
      const headers = { host: "localhost", origin: "http://localhost", "content-type": "application/json" };
      for (const input of [
        { headers: { ...headers, host: "evil.example" }, body: resolutionCommand(), status: 403 },
        { headers: { ...headers, origin: "http://evil.example" }, body: resolutionCommand(), status: 403 },
        { headers, body: resolutionCommand({ requestedBy: "forged-actor" }), status: 403 },
        { headers, body: { ...resolutionCommand(), payload: { action: "resolve", note: "x".repeat(1001) } }, status: 400 },
      ]) {
        const response = await app.request("http://localhost/api/v1/commands", { method: "POST", headers: input.headers, body: JSON.stringify(input.body) });
        assert.equal(response.status, input.status, await response.text()); assert.equal(snapshot(f), before);
      }
      const command = resolutionCommand({ requestedAt: "2000-01-01T00:00:00.000Z" });
      const response = await app.request("http://localhost/api/v1/commands", { method: "POST", headers, body: JSON.stringify(command) });
      assert.equal(response.status, 200, await response.text());
      const accepted = f.db.authority.commands.get(command.commandId); assert.equal(accepted?.requestedAt, NOW);
      assert.equal(accepted?.requestedBy, "local-operator");
      const replay = await app.request("http://localhost/api/v1/commands", { method: "POST", headers, body: JSON.stringify(command) });
      assert.equal(replay.status, 200);
      const committed = snapshot(f);
      const divergent = await app.request("http://localhost/api/v1/commands", { method: "POST", headers,
        body: JSON.stringify({ ...command, payload: { action: "resolve", note: "PRIVATE_CHANGED_NOTE" } }) });
      assert.equal(divergent.status, 422);
      const refusal = await divergent.text();
      assert.match(refusal, /command-divergent/u); assert.ok(!refusal.includes("PRIVATE_CHANGED_NOTE"));
      assert.equal(snapshot(f), committed);
    } finally { f.dispose(); }
  });
});
import { resolutionApp } from "./fixtures.js";

import { resolutionPeer } from "./fixtures.js";
it("two independent OS processes compete for one annotation version and exactly one commits", async () => {
  const f = resolutionFixture(); const peers = [resolutionPeer(f.path), resolutionPeer(f.path)];
  try {
    await Promise.all(peers.map(peer => peer.ready));
    const outcomes = await Promise.all(peers.map(peer => peer.send(resolutionCommand())));
    assert.deepEqual(outcomes.map(result => result.state).sort(), ["applied", "rejected"]);
    assert.equal(f.db.authority.failureResolution.read(f.record.runId, f.record.failureId)?.resolution.version, 2);
    const loser = outcomes.find(result => result.state === "rejected"); assert.ok(loser);
    assert.equal(f.db.authority.commands.get(loser.commandId), undefined);
  } finally { for (const peer of peers) peer.stop(); f.dispose(); }
});
