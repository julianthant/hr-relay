import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { startDashboardHttpServer } from "../../../src/server/dashboard/http-server.js";
import { CommandResultSchema } from "../../../src/domain/commands.js";
import { SavedArchiveDetailWireSchema } from "../../../src/domain/dashboard/archive.js";
import { lifecycleCommandId } from "../../../src/domain/identifiers.js";
import { savedHttpFixture } from "../served-database-surfaces/fixtures.js";
import { id } from "../database-foundation/fixtures.js";

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
