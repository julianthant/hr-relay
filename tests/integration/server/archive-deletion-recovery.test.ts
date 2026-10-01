import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { RunRecordService } from "../../../src/core/run-record-service.js";
import { startDashboardHttpServer } from "../../../src/server/dashboard/http-server.js";
import { CommandResultSchema } from "../../../src/domain/commands.js";
import { SavedArchiveDetailWireSchema } from "../../../src/domain/dashboard/archive.js";
import { lifecycleCommandId } from "../../../src/domain/identifiers.js";
import { savedHttpFixture } from "../../unit/served-database-surfaces/fixtures.js";
import { id } from "../../unit/database-foundation/fixtures.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function archivedFixture() {
  const fixture = savedHttpFixture();
  cleanups.push(() => fixture.dispose());
  fixture.terminal();
  assert.equal(fixture.kernel.execute(fixture.applyRequest(fixture.plan())).state, "applied");
  const report = await fixture.app().request(`http://localhost/api/v1/archive/reports/${fixture.base.run.envelope.runId}`, {
    headers: { host: "localhost" },
  });
  const detail = SavedArchiveDetailWireSchema.parse(await report.json());
  assert.equal(detail.state, "available");
  if (detail.state !== "available") throw new Error("archive report unavailable");
  return { fixture, detail };
}

async function serve(fixture: ReturnType<typeof savedHttpFixture>) {
  const server = await startDashboardHttpServer({ app: fixture.app(), port: 0 });
  const cleanup = () => server.close();
  cleanups.push(cleanup);
  const origin = `http://127.0.0.1:${server.port}`;
  return {
    origin,
    post: (body: unknown) => fetch(`${origin}/api/v1/commands`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    detail: async (runId: string) => SavedArchiveDetailWireSchema.parse(
      await (await fetch(`${origin}/api/v1/archive/reports/${runId}`)).json(),
    ),
    close: async () => {
      await server.close();
      const index = cleanups.indexOf(cleanup);
      if (index >= 0) cleanups.splice(index, 1);
    },
  };
}

it.each(["cleanup", "operator-audit"] as const)(
  "retains and authenticates an Archive deletion after interrupted %s and a later-clock HTTP retry",
  async fault => {
    const { fixture, detail } = await archivedFixture();
    const runId = detail.runId;
    const commandId = id(fault === "cleanup" ? 8960 : 8970);
    const intent = {
      commandId,
      requestedAt: fixture.base.clock.now().toISOString(),
      requestedBy: "local-operator",
      source: "archive",
      family: "version-archive",
      type: "delete-archived-run",
      target: { archivedRunId: runId, archiveFingerprint: detail.archiveFingerprint },
    };

    if (fault === "cleanup") {
      fixture.database.settleArchivedDeletion = interruptedRunId => {
        const receipt = fixture.database.authority.deletedRuns.get(interruptedRunId);
        const report = fixture.database.lifecycleArchive(true).read(interruptedRunId);
        assert.ok(receipt);
        assert.ok(report);
        fixture.database.lifecycleArchive(true).beginDelete(receipt, report.digest);
        throw new Error("injected-cleanup-interruption");
      };
    } else {
      fixture.failAfter("audit");
    }

    let http = await serve(fixture);
    const interrupted = await http.post(intent);
    assert.equal(interrupted.status, 500);
    await http.close();
    fixture.reopen();
    fixture.base.clock.advanceWall(60_000);
    http = await serve(fixture);

    const pending = await http.detail(runId);
    assert.equal(pending.state, "deleted");
    if (pending.state !== "deleted") throw new Error("canonical deletion missing");
    assert.equal(pending.deletion.cleanup.state, fault === "cleanup" ? "pending" : "complete");
    assert.equal(pending.deletion.command.state, "pending");
    if (pending.deletion.command.state !== "pending") throw new Error("operator settlement not pending");
    assert.ok(pending.deletion.command.resumeRequest);
    const retained = pending.deletion.command.resumeRequest;
    assert.equal(retained.requestedAt, intent.requestedAt);
    assert.equal(retained.source, "dashboard");

    const before = fixture.database.getMeta().authorityGeneration;
    const foreignActor = await http.post({ ...retained, requestedBy: "other-operator" });
    assert.equal(foreignActor.status, 403);
    assert.equal(fixture.database.getMeta().authorityGeneration, before);
    for (const changed of [
      { ...retained, target: { ...retained.target, archiveFingerprint: "f".repeat(64) } },
      { ...retained, target: { ...retained.target, archivedRunId: id(8980) } },
      { ...retained, reason: "Different deletion intent" },
    ]) {
      const refused = await http.post(changed);
      assert.equal(refused.status, 422);
      const result = CommandResultSchema.parse(await refused.json());
      assert.equal(result.state, "rejected");
      assert.equal(fixture.database.getMeta().authorityGeneration, before);
      assert.equal(fixture.database.authority.deletedRuns.get(id(8980)), undefined);
    }

    const resumed = await http.post(retained);
    assert.equal(resumed.status, 200, await resumed.clone().text());
    assert.equal(CommandResultSchema.parse(await resumed.json()).state, "applied");
    const completed = await http.detail(runId);
    assert.equal(completed.state, "deleted");
    if (completed.state !== "deleted") throw new Error("completed deletion missing");
    assert.equal(completed.deletion.cleanup.state, "complete");
    assert.equal(completed.deletion.command.state, "complete");
    assert.equal(fixture.database.authority.deletedRuns.get(runId)?.commandId,
      lifecycleCommandId("operator-delete-archive", commandId));
    assert.deepEqual(fixture.database.authority.commands.get(commandId), retained);
    assert.deepEqual(fixture.database.authority.commandAudits.findByCommand(commandId)?.request, retained);
  },
);

it("preserves historical exact-envelope replay without inventing browser recovery metadata", async () => {
  const { fixture, detail } = await archivedFixture();
  const http = await serve(fixture);
  const intent = deleteIntent(detail, 8981);
  fixture.failAfter("audit");
  assert.equal((await http.post(intent)).status, 500);
  const before = fixture.database.readArchiveDeletion(detail.runId);
  assert.equal(before?.command.state, "pending");
  if (before?.command.state !== "pending") throw new Error("pending deletion missing");
  const original = before.command.request;
  const nested = lifecycleCommandId("operator-delete-archive", intent.commandId);
  using raw = new DatabaseSync(fixture.base.path);
  raw.prepare("UPDATE commands SET record_json=json_remove(record_json,'$.acceptedArchiveDeleteRequest') WHERE record_key=?").run(nested);
  raw.prepare("UPDATE command_audits SET record_json=json_remove(record_json,'$.request.acceptedArchiveDeleteRequest') WHERE command_id=?").run(nested);
  await http.close();
  fixture.reopen();
  fixture.base.clock.advanceWall(60_000);
  const restarted = await serve(fixture);
  const historical = await restarted.detail(detail.runId);
  assert.equal(historical.state, "deleted");
  if (historical.state !== "deleted") throw new Error("historical deletion missing");
  assert.equal(historical.deletion.command.state, "unavailable");
  assert.equal((await restarted.post(original)).status, 422, "caller-authored old timestamp cannot authenticate recovery");
  assert.equal(fixture.kernel.execute(original).state, "applied", "canonical original envelope remains replayable");
  assert.equal(CommandResultSchema.parse(await (await restarted.post(original)).json()).state, "already-applied");
  const retained = fixture.database.authority.lifecycleJournal.getCommand(nested);
  assert.ok(retained && "kind" in retained && retained.kind === "run-lifecycle");
  assert.equal(retained.acceptedArchiveDeleteRequest, undefined, "historical bytes are not backfilled");
});

import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { attachFile } from "../../unit/archive-transfer/fixtures.js";
import type { SavedArchiveReportWire } from "../../../src/domain/dashboard/archive.js";

function deleteIntent(detail: SavedArchiveReportWire, sequence: number) {
  return { commandId: id(sequence), requestedAt: "2000-01-01T00:00:00.000Z", requestedBy: "local-operator", source: "archive",
    family: "version-archive", type: "delete-archived-run", target: { archivedRunId: detail.runId, archiveFingerprint: detail.archiveFingerprint } };
}

it.each(["absent", "malformed", "mismatched-audit"] as const)("does not settle deletion when retained command evidence is %s", async fault => {
  const { fixture, detail } = await archivedFixture();
  const http = await serve(fixture);
  const intent = deleteIntent(detail, 8982);
  fixture.failAfter("settlement");
  assert.equal((await http.post(intent)).status, 500);
  const nested = lifecycleCommandId("operator-delete-archive", intent.commandId);
  using raw = new DatabaseSync(fixture.base.path);
  if (fault === "absent") raw.prepare("DELETE FROM command_audits WHERE command_id=?").run(nested);
  else if (fault === "malformed") raw.prepare("UPDATE commands SET record_json=json_set(record_json,'$.acceptedArchiveDeleteRequest.target.archivedRunId',?) WHERE record_key=?").run(id(8999), nested);
  else raw.prepare("UPDATE command_audits SET record_json=json_set(record_json,'$.result.runIds',json('[]')) WHERE command_id=?").run(nested);
  const generation = fixture.database.getMeta().authorityGeneration;
  const before = fixture.database.lifecycleArchive(true).read(detail.runId);
  const read = await http.detail(detail.runId);
  assert.equal(read.state, "deleted");
  if (read.state !== "deleted") throw new Error("deletion readback missing");
  assert.equal(read.deletion.command.state, "unavailable");
  assert.equal(fixture.database.getMeta().authorityGeneration, generation);
  assert.deepEqual(fixture.database.lifecycleArchive(true).read(detail.runId), before, "readback does not settle or resurrect");
  assert.equal(fixture.database.authority.commands.get(intent.commandId), undefined);
});

it("records no accepted deletion on pre-canonical failure, then deletes exactly once with real file byte deltas", async () => {
  const fixture = savedHttpFixture();
  cleanups.push(() => fixture.dispose());
  const runId = fixture.base.run.envelope.runId;
  const attachment = attachFile(fixture.database, fixture.base.root, runId, 8991);
  fixture.terminal();
  assert.equal(fixture.kernel.execute(fixture.applyRequest(fixture.plan())).state, "applied");
  const http = await serve(fixture);
  const detail = await http.detail(runId);
  if (detail.state !== "available") throw new Error("saved report missing");
  const intent = deleteIntent(detail, 8993);
  const originalDelete = fixture.database.authority.runs.delete;
  const originalTransaction = fixture.database.withAuthorityTransaction.bind(fixture.database);
  fixture.database.withAuthorityTransaction = work => originalTransaction(repositories => work({ ...repositories,
    runs: { ...repositories.runs, delete: () => { throw new Error("injected-before-canonical-removal"); } },
  }));
  assert.equal((await http.post(intent)).status, 500);
  fixture.database.withAuthorityTransaction = originalTransaction;
  assert.equal(fixture.database.authority.runs.delete, originalDelete);
  assert.equal(fixture.database.authority.deletedRuns.get(runId), undefined);
  assert.equal(fixture.database.authority.lifecycleJournal.getCommand(lifecycleCommandId("operator-delete-archive", intent.commandId)), undefined);
  const path = join(fixture.base.root, "archive-files", attachment.file.digest);
  const bytesBefore = readFileSync(path).length;
  assert.equal(bytesBefore, attachment.bytes.length);
  assert.equal((await http.post(intent)).status, 200);
  const completed = await http.detail(runId);
  assert.equal(completed.state, "deleted");
  if (completed.state !== "deleted") throw new Error("saved deletion missing");
  assert.deepEqual(completed.deletion.removed, fixture.database.authority.deletedRuns.get(runId)?.removed);
  assert.equal(completed.deletion.cleanup.state, "complete");
  assert.equal(completed.deletion.command.state, "complete");
  assert.equal(existsSync(path), false);
  const generation = fixture.database.getMeta().authorityGeneration;
  assert.equal(CommandResultSchema.parse(await (await http.post(intent)).json()).state, "already-applied");
  assert.equal(fixture.database.getMeta().authorityGeneration, generation);
});

it("replays interrupted cleanup while preserving live, published and pending-capture owners and measuring exclusive bytes", async () => {
  const fixture = savedHttpFixture(); cleanups.push(() => fixture.dispose());
  const first = fixture.base.run.envelope.runId;
  const shared = attachFile(fixture.database, fixture.base.root, first, 93001);
  const exclusive = attachFile(fixture.database, fixture.base.root, first, 93003, Buffer.from("exclusive synthetic file"));
  const published = fixture.base.createRun(id(93005));
  attachFile(fixture.database, fixture.base.root, published.envelope.runId, 93006, shared.bytes);
  fixture.database.authority.runs.transition({ runId: published.envelope.runId, expectedVersion: published.version,
    lifecycle: { state: "terminal", outcome: "cancelled", endedAt: fixture.base.clock.now().toISOString() }, now: fixture.base.clock.now().toISOString() });
  fixture.terminal();
  assert.equal(fixture.kernel.execute(fixture.applyRequest(fixture.plan())).state, "applied");
  const pending = fixture.base.createRun(id(93008));
  attachFile(fixture.database, fixture.base.root, pending.envelope.runId, 93009, shared.bytes);
  fixture.database.authority.runs.transition({ runId: pending.envelope.runId, expectedVersion: pending.version,
    lifecycle: { state: "terminal", outcome: "cancelled", endedAt: fixture.base.clock.now().toISOString() }, now: fixture.base.clock.now().toISOString() });
  const apply = fixture.applyRequest(fixture.plan());
  fixture.failAfter("readPendingReport");
  assert.throws(() => fixture.kernel.execute(apply), /injected-readPendingReport/);
  const live = fixture.base.createRun(id(93011));
  attachFile(fixture.database, fixture.base.root, live.envelope.runId, 93012, shared.bytes);
  const http = await serve(fixture);
  const detail = await http.detail(first);
  if (detail.state !== "available") throw new Error("saved report missing");
  const intent = deleteIntent(detail, 93014);
  const beforeShared = readFileSync(join(fixture.base.root, "archive-files", shared.file.digest));
  const beforeExclusive = readFileSync(join(fixture.base.root, "archive-files", exclusive.file.digest));
  const archive = fixture.database.lifecycleArchive(true);
  const settle = archive.settleDelete.bind(archive);
  archive.settleDelete = (runId, _afterFile, pendingDigests) => settle(runId, () => { throw new Error("interrupted-after-exclusive-unlink"); }, pendingDigests);
  assert.equal((await http.post(intent)).status, 500);
  const readback = await http.detail(first);
  if (readback.state !== "deleted") throw new Error("canonical deletion missing");
  assert.equal(readback.deletion.cleanup.state, "pending");
  assert.deepEqual(readFileSync(join(fixture.base.root, "archive-files", shared.file.digest)), beforeShared);
  assert.equal(existsSync(join(fixture.base.root, "archive-files", exclusive.file.digest)), false);
  await http.close(); fixture.reopen(); fixture.base.clock.advanceWall(60_000);
  const reopened = await serve(fixture);
  assert.equal((await reopened.post(intent)).status, 200);
  assert.equal(fixture.kernel.execute(apply).state, "applied");
  assert.deepEqual(readFileSync(join(fixture.base.root, "archive-files", shared.file.digest)), shared.bytes);
  assert.ok(fixture.database.authority.runs.get(live.envelope.runId));
  assert.ok(fixture.database.lifecycleArchive(true).readPublished(published.envelope.runId));
  assert.ok(fixture.database.lifecycleArchive(true).readPublished(pending.envelope.runId));
  assert.equal(beforeShared.length + beforeExclusive.length - readFileSync(join(fixture.base.root, "archive-files", shared.file.digest)).length, exclusive.bytes.length);
});

it("reports a deleted live identity explicitly without offering Archive recovery", async () => {
  const fixture = savedHttpFixture(); cleanups.push(() => fixture.dispose());
  fixture.terminal();
  const run = fixture.database.authority.runs.get(fixture.base.run.envelope.runId);
  assert.ok(run);
  const reader = new RunRecordService({ database: fixture.database, clock: fixture.base.clock, ids: { uuid: () => id(94000) }, publishQueued: () => {} });
  assert.equal(reader.delete({ commandId: id(94001), runId: run.envelope.runId, expectedVersion: run.version }).state, "deleted");
  const read = await (await serve(fixture)).detail(run.envelope.runId);
  assert.equal(read.state, "deleted");
  if (read.state !== "deleted") throw new Error("deleted identity missing");
  assert.equal(read.deletion.command.state, "unavailable");
});
it("does not claim final settlement from an audit whose outcome refuses the deletion", async () => {
  const { fixture, detail } = await archivedFixture();
  const http = await serve(fixture);
  const intent = deleteIntent(detail, 94101);
  assert.equal((await http.post(intent)).status, 200);
  using raw = new DatabaseSync(fixture.base.path);
  raw.prepare("UPDATE command_audits SET record_json=json_set(record_json,'$.result',json(?)) WHERE command_id=?")
    .run(JSON.stringify({ state: "rejected", commandId: intent.commandId, code: "policy-refused", message: "Synthetic contradictory audit" }), intent.commandId);
  const read = await http.detail(detail.runId);
  if (read.state !== "deleted") throw new Error("deleted disposition missing");
  assert.equal(read.deletion.cleanup.state, "complete");
  assert.equal(read.deletion.command.state, "unavailable");
});

it.each(["missing archive", "malformed cleanup"] as const)("keeps canonical deletion explicit with %s evidence and performs no settlement", async fault => {
  const { fixture, detail } = await archivedFixture();
  const http = await serve(fixture);
  const intent = deleteIntent(detail, 94201);
  fixture.failAfter("settlement");
  assert.equal((await http.post(intent)).status, 500);
  const archivePath = join(fixture.base.root, "archive.sqlite");
  const saved = fixture.database.lifecycleArchive(true).read(detail.runId);
  const receipt = fixture.database.authority.deletedRuns.get(detail.runId);
  assert.ok(saved && receipt);
  if (fault === "missing archive") renameSync(archivePath, `${archivePath}.held`);
  else {
    using raw = new DatabaseSync(archivePath);
    raw.prepare("INSERT INTO archive_deletions (run_id,digest,receipt_json,files_json,state) VALUES (?,?,?,?,'deleting')")
      .run(detail.runId, saved.digest, JSON.stringify(receipt), '{"malformed":"synthetic"}');
  }
  try {
    const generation = fixture.database.getMeta().authorityGeneration;
    const read = await http.detail(detail.runId);
    if (read.state !== "deleted") throw new Error("canonical deletion missing");
    assert.equal(read.deletion.cleanup.state, "unavailable");
    assert.equal(read.deletion.command.state, "pending");
    assert.equal(fixture.database.getMeta().authorityGeneration, generation);
    assert.equal(fixture.database.authority.commands.get(intent.commandId), undefined);
  } finally { if (fault === "missing archive") renameSync(`${archivePath}.held`, archivePath); }
});
