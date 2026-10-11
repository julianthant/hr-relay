import assert from "node:assert/strict";
import { readdirSync,readFileSync,unlinkSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach,it } from "vitest";
import { CommandResultSchema } from "../../../src/rules/commands/commands.js";
import { createIntakeAuthority,INTAKE_CSV } from "../../support/fixtures/dashboard/fixture-intake-authority.js";
import { defineIntakeFixtureDescriptor,INTAKE_FIXTURE_WORKFLOW_ID } from "../../support/fixtures/intake-workflow-fixture.js";

type Harness = ReturnType<typeof createIntakeAuthority>;
const opened: Harness[] = [];
afterEach(() => { for (const h of opened.splice(0)) h.close(); });
function harness() { const h = createIntakeAuthority(); opened.push(h); return h; }
async function send(h: Harness, wire: { intakeSessionId: string; expectedVersion: number }, type: string, payload?: unknown) {
  const response = await h.post(h.request(wire, type, payload));
  const result = CommandResultSchema.parse(await response.json());
  assert.equal(result.state, "applied", JSON.stringify(result));
  return h.intake.read(wire.intakeSessionId);
}
async function ready(h: Harness, csv = INTAKE_CSV) {
  let wire = (await h.upload(csv)).session;
  for (const [target, column] of [["emplId", 0], ["effectiveDate", 1]] as const) wire = await send(h, wire, "confirm-intake-mapping", { targetFieldId: target, sourceColumnId: wire.columns[column].sourceColumnId, headerFingerprint: wire.headerFingerprint });
  wire = await send(h, wire, "exclude-intake-row", { sourceRow: 2, reason: "Synthetic malformed identifier" });
  return send(h, wire, "validate-intake");
}
async function enqueue(h: Harness, wire: Awaited<ReturnType<typeof ready>>) {
  return send(h, wire, "enqueue-intake-manifest", { dryRun: false, reviewBinding: wire.reviewBinding });
}
function noEffects(h: Harness, wire: Awaited<ReturnType<typeof ready>>) {
  assert.equal(h.database.authority.intakeManifests.get(wire.reservedManifestId ?? ""), undefined);
  assert.equal(h.database.authority.intakeSessions.get(wire.intakeSessionId)?.state, "validated");
  assert.ok(h.database.authority.runSessions.list().every(session => session.origin.kind !== "intake-manifest" || session.origin.intakeManifestId !== wire.reservedManifestId));
}
it("refuses an unavailable declared protected origin and rolls back the entire prepared fan-out",async()=>{
  const h=harness();
  h.setDescriptor(defineIntakeFixtureDescriptor({id:INTAKE_FIXTURE_WORKFLOW_ID,code:"if",contractFingerprint:"f".repeat(64),enqueue:"allow-parallel",protectedTimekeeper:true}));
  const wire=await ready(h);
  const result=CommandResultSchema.parse(await (await h.post(h.request(wire,"enqueue-intake-manifest",{dryRun:false,reviewBinding:wire.reviewBinding}))).json());
  assert.equal(result.state,"rejected");
  if (result.state !== "rejected") throw new Error("protected source refusal missing");
  assert.equal(result.code, "invalid-state");
  assert.equal(result.message, "protected input timekeeperName source is unavailable");
  noEffects(h,wire);
  assert.deepEqual(h.database.authority.runs.listByWorkflow(INTAKE_FIXTURE_WORKFLOW_ID),[]);
});
it.each([undefined, "0".repeat(64)])("refuses missing or mismatched confirmation with zero manifest effects (%s)", async reviewBinding => {
  const h = harness(); const wire = await ready(h);
  const result = CommandResultSchema.parse(await (await h.post(h.request(wire, "enqueue-intake-manifest", { dryRun: false, ...(reviewBinding === undefined ? {} : { reviewBinding }) }))).json());
  assert.equal(result.state, "rejected"); noEffects(h, wire);
  const committed = await enqueue(h, wire); assert.equal(committed.state, "enqueued"); assert.equal(committed.manifest?.validRows.length, 2);
});
it("binds explicit different-file comparison, preserves it on retry/restart, and invalidates old confirmation", async () => {
  const h = harness(); const first = await enqueue(h, await ready(h)); assert.ok(first.manifest);
  const before = JSON.stringify(h.database.authority.intakeManifests.get(first.manifest.manifestId));
  const changedCsv = INTAKE_CSV.replace("10998801", "10888888");
  const wire = await ready(h, changedCsv); const priorBinding = wire.reviewBinding;
  const compared = await send(h, wire, "inspect-intake", { comparisonManifestId: first.manifest.manifestId });
  assert.notEqual(compared.reviewBinding, priorBinding); assert.equal(compared.rerun?.intakeManifestId, first.manifest.manifestId);
  assert.equal(compared.rerun?.diff.kind, "changed");
  const retry = await h.upload(changedCsv); assert.equal(retry.state, "joined"); assert.equal(retry.session.reviewBinding, compared.reviewBinding);
  h.restart(); const cold = await h.intake.read(wire.intakeSessionId); assert.deepEqual(cold, compared);
  const stale = CommandResultSchema.parse(await (await h.post(h.request(compared, "enqueue-intake-manifest", { dryRun: false, reviewBinding: priorBinding }))).json());
  assert.equal(stale.state, "rejected"); noEffects(h, compared);
  await enqueue(h, cold); assert.equal(JSON.stringify(h.database.authority.intakeManifests.get(first.manifest.manifestId)), before);
});

it("replays a genuinely completed current intake command after its source bytes disappear without rereading or new effects", async () => {
  const h = harness();
  const wire = await ready(h);
  const request = h.request(wire, "enqueue-intake-manifest", { dryRun: false, reviewBinding: wire.reviewBinding });
  const result = CommandResultSchema.parse(await (await h.post(request)).json());
  assert.equal(result.state, "applied");
  const inventory = () => {
    const raw = new DatabaseSync(h.path, { readOnly: true });
    try { return raw.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => {
      if (typeof name !== "string" || !/^[a-z_]+$/u.test(name)) throw new Error("invalid native table name");
      return { name, rows: raw.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all() };
    }); } finally { raw.close(); }
  };
  const before = inventory();
  const generation = h.database.getMeta().authorityGeneration;
  const ids = h.mintedIds;
  const reads = h.artifactReads;
  const artifactRoot = join(h.root, ".tracker", "artifacts");
  const source = join(artifactRoot, `${wire.artifact.sha256}.artifact`);
  assert.ok(readFileSync(source).length > 0);
  unlinkSync(source);
  const remainingFiles = readdirSync(artifactRoot).map(name => ({ name, bytes: readFileSync(join(artifactRoot, name)) }));
  h.restart();
  const replay = CommandResultSchema.parse(await (await h.post(request)).json());
  assert.deepEqual(replay, { ...result, state: "already-applied" });
  assert.deepEqual(inventory(), before);
  assert.equal(h.database.getMeta().authorityGeneration, generation);
  assert.deepEqual(h.mintedIds, ids);
  assert.equal(h.artifactReads, reads);
  assert.deepEqual(readdirSync(artifactRoot).map(name => ({ name, bytes: readFileSync(join(artifactRoot, name)) })), remainingFiles);
});
