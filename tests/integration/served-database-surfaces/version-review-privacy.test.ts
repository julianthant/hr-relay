import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { savedHttpFixture } from "../../unit/served-database-surfaces/fixtures.js";
import { NOW, id } from "../../unit/database-foundation/fixtures.js";
import { RunRecordSchema } from "../../../src/domain/run/record.js";
import { createRunLifecycleStorage, lifecycleSourceDigest } from "../../../src/infra/sqlite/lifecycle-storage.js";
import { captureArchiveReport } from "../../../src/services/archive/report-capture.js";
import { projectArchiveReport } from "../../../src/server/dashboard/queries/archive-reports.js";
import { SavedVersionIndexWireSchema } from "../../../src/domain/dashboard/archive.js";
import { startDashboardHttpServer } from "../../../src/backend/transports/dashboard/http-server.js";
import { CommandResultSchema } from "../../../src/domain/commands.js";

it("keeps planned and applying HTTP review bindings independent of protected-only input rotations", async () => {
  const observations = [];
  for (const value of ["10873698", "10999999"]) {
    const f = savedHttpFixture();
    let server: Awaited<ReturnType<typeof startDashboardHttpServer>> | undefined;
    try {
      const seed = RunRecordSchema.parse({ ...f.base.run, input: { ...f.base.run.input, raw: { emplId: value },
        parsed: { ...f.base.run.input.parsed, value: { emplId: value }, protectedBindings: [
          { kind: "test-data-local", inputPath: "emplId", name: "personLookupCanaryEid", sourceId: id(89920) },
        ] } } });
      f.database.close();
      const raw = new DatabaseSync(f.base.path);
      try { raw.prepare("UPDATE workflow_runs SET record_json=? WHERE record_key=?").run(JSON.stringify(seed), seed.envelope.runId); }
      finally { raw.close(); }
      f.reopen(); f.terminal();
      const storage = createRunLifecycleStorage(f.database), source = storage.capture(seed.envelope.runId);
      const safe = projectArchiveReport(captureArchiveReport({ snapshot: source, transferId: id(89921), capturedAt: NOW, files: [], sections: [] }));
      const row = f.plan();
      server = await startDashboardHttpServer({ app: f.app(), port: 0 });
      const read = async () => {
        const response = await fetch(`http://127.0.0.1:${server!.port}/api/v1/archive/versions`);
        assert.equal(response.status, 200);
        return SavedVersionIndexWireSchema.parse(await response.json());
      };
      const planned = await read();
      f.failAfter("readPendingReport");
      assert.throws(() => f.kernel.execute(f.applyRequest(row)), /injected-readPendingReport/u);
      const applying = await read();
      assert.ok(applying.changes[0].resumeRequest);
      observations.push({ sourceDigest: lifecycleSourceDigest(source), privateReview: row.reviewFingerprint, safe, planned, applying });
    } finally { await server?.close(); f.dispose(); }
  }
  const [first, second] = observations;
  assert.notEqual(first.sourceDigest, second.sourceDigest);
  assert.notEqual(first.privateReview, second.privateReview);
  assert.deepEqual(first.safe, second.safe);
  assert.deepEqual(first.planned, second.planned);
  assert.deepEqual(first.applying, second.applying);
  for (const observation of observations) {
    const publicText = JSON.stringify({ safe: observation.safe, planned: observation.planned, applying: observation.applying });
    for (const secret of ["10873698", "10999999", observation.sourceDigest, observation.privateReview]) assert.equal(publicText.includes(secret), false);
  }
});

for (const source of ["dashboard", "archive"] as const) it(`resumes an authenticated ${source} claim through HTTP after restart without rewriting command identity`, async () => {
  const f = savedHttpFixture();
  let server: Awaited<ReturnType<typeof startDashboardHttpServer>> | undefined;
  try {
    f.terminal();
    const row = f.plan(), privateRequest = f.applyRequest(row);
    server = await startDashboardHttpServer({ app: f.app(), port: 0 });
    const read = async () => SavedVersionIndexWireSchema.parse(await (await fetch(`http://127.0.0.1:${server!.port}/api/v1/archive/versions`)).json());
    const post = async (body: unknown) => {
      const origin = `http://127.0.0.1:${server!.port}`;
      return fetch(`${origin}/api/v1/commands`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
    };
    const request = { ...privateRequest, payload: { planFingerprint: (await read()).changes[0].reviewFingerprint } };
    f.failAfter("saveReport");
    if (source === "archive") assert.throws(() => f.kernel.execute(privateRequest), /injected-saveReport/u);
    else assert.equal((await post(request)).status, 500);
    const claimed = f.database.readVersionChange(row.changeId);
    assert.ok(claimed?.application?.requestFingerprint);
    const expectedPrivateRequest = { ...privateRequest, source };
    await server.close(); server = undefined;
    f.reopen();
    f.base.clock.advanceWall(60_000);
    server = await startDashboardHttpServer({ app: f.app(), port: 0 });
    const applying = (await read()).changes[0];
    assert.ok(applying.resumeRequest);
    assert.equal(applying.resumeRequest.payload.planFingerprint, request.payload.planFingerprint);
    const before = f.database.getMeta().authorityGeneration;
    const wrongBinding = await post({ ...applying.resumeRequest, payload: { planFingerprint: "f".repeat(64) } });
    assert.equal(wrongBinding.status, 422);
    assert.equal(CommandResultSchema.parse(await wrongBinding.json()).state, "rejected");
    const divergent = await post({ ...applying.resumeRequest, reason: "Different caller intent" });
    assert.equal(divergent.status, 422);
    assert.equal(f.database.getMeta().authorityGeneration, before);
    const result = await post(applying.resumeRequest);
    assert.equal(result.status, 200);
    assert.equal(CommandResultSchema.parse(await result.json()).state, "applied");
    assert.deepEqual(f.database.authority.commands.get(privateRequest.commandId), expectedPrivateRequest);
    const completed = f.database.readVersionChange(row.changeId);
    assert.equal(completed?.reviewFingerprint, claimed.reviewFingerprint);
    assert.deepEqual(completed?.members, claimed.members);
    assert.equal(completed?.application?.requestFingerprint, claimed.application.requestFingerprint);
    const generation = f.database.getMeta().authorityGeneration;
    f.base.clock.advanceWall(60_000);
    const replay = await post(applying.resumeRequest);
    assert.equal(replay.status, 200);
    assert.equal(CommandResultSchema.parse(await replay.json()).state, "already-applied");
    assert.equal(f.database.getMeta().authorityGeneration, generation);
  } finally { await server?.close(); f.dispose(); }
});

it("requires a replacement review when private source changes behind the same public proposal binding", async () => {
  const f = savedHttpFixture();
  let server: Awaited<ReturnType<typeof startDashboardHttpServer>> | undefined;
  try {
    f.terminal(); const row = f.plan();
    server = await startDashboardHttpServer({ app: f.app(), port: 0 });
    const before = SavedVersionIndexWireSchema.parse(await (await fetch(`http://127.0.0.1:${server.port}/api/v1/archive/versions`)).json());
    await server.close(); server = undefined;
    const run = f.database.authority.runs.get(f.base.run.envelope.runId); assert.ok(run);
    const changed = RunRecordSchema.parse({ ...run, input: { ...run.input,
      raw: { emplId: "10999999" }, parsed: { ...run.input.parsed, value: { emplId: "10999999" }, protectedBindings: [
        { kind: "test-data-local", inputPath: "emplId", name: "personLookupCanaryEid", sourceId: id(89920) },
      ] } } });
    f.database.close();
    const raw = new DatabaseSync(f.base.path);
    try { raw.prepare("UPDATE workflow_runs SET record_json=? WHERE record_key=?").run(JSON.stringify(changed), run.envelope.runId); }
    finally { raw.close(); }
    f.reopen();
    server = await startDashboardHttpServer({ app: f.app(), port: 0 });
    const origin = `http://127.0.0.1:${server.port}`;
    const after = SavedVersionIndexWireSchema.parse(await (await fetch(`${origin}/api/v1/archive/versions`)).json());
    assert.deepEqual(after, before);
    const response = await fetch(`${origin}/api/v1/commands`, { method: "POST", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ ...f.applyRequest(row), payload: { planFingerprint: before.changes[0].reviewFingerprint } }) });
    assert.equal(response.status, 422);
    const refused = CommandResultSchema.parse(await response.json());
    assert.equal(refused.state, "rejected");
    if (refused.state !== "rejected") throw new Error("changed-source-admitted");
    assert.equal(refused.code, "replan-required");
    const latest = SavedVersionIndexWireSchema.parse(await (await fetch(`${origin}/api/v1/archive/versions`)).json());
    assert.equal(latest.changes.find(change => change.changeId === row.changeId)?.state, "superseded");
    const replacement = latest.changes.find(change => change.state === "planned"); assert.ok(replacement);
    assert.notEqual(replacement.reviewFingerprint, before.changes[0].reviewFingerprint);
    assert.ok(f.database.authority.runs.get(run.envelope.runId));
    assert.equal(f.database.transferredRun(run.envelope.runId), undefined);
  } finally { await server?.close(); f.dispose(); }
});
