import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it, vi } from "vitest";
import { createOperatorProjection, createOperatorRunDetail } from "../../../../src/backend/app/composition/dashboard/operator.js";
import { DASHBOARD_CATALOG_MODULES } from "../../../../src/backend/app/registries/workflow-registry.js";
import { buildRunDetail } from "../../../../src/backend/runs/queries/run-detail.js";
import { createCrossDateSearchService } from "../../../../src/backend/runs/queries/search.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION, SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { createRunSearchIndex } from "../../../../src/backend/storage/sqlite/run-search-index.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import { resolveRunNavigation } from "../../../../src/dashboard/app/navigation/run-navigation.js";
import { readSearchSnapshot, searchResults } from "../../../../src/dashboard/state/search-wiring-adapter.js";
import type { CrossDateSearchQueryInput } from "../../../../src/models/dashboard/search.js";
import { searchPartitionDay } from "../../../../src/models/dashboard/search-calendar.js";
import { ocrRecordName } from "../../../../src/models/ocr/review.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { correctOcrField } from "../../../support/fixtures/ocr/source-pages.js";
import { runRecordOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";
import { scaledMs } from "../../../support/time-scale.js";

const world = createOcrReviewWorld();
afterEach(world.cleanup);

type OcrWorld = Awaited<ReturnType<typeof world.fixture>>;

function searchOf({ clock, database, resolve }: OcrWorld) {
  return createCrossDateSearchService({ clock, sourceIdentity: database.getSourceDatabaseIdentity(),
    cursorSigningKey: new Uint8Array(32).fill(9), descriptors: { resolve },
    authority: { readSnapshot: read => database.withAuthorityReadSnapshot(() => read({
      authorityGeneration: database.getMeta().authorityGeneration,
      searchRuns: input => database.authority.runs.search(input),
    })) } });
}

async function assertOpensRun(f: OcrWorld, query: CrossDateSearchQueryInput, runId: string) {
  const { database, clock, resolve } = f;
  const reader = f.canonical.lifecycle;
  const descriptors = { resolve };
  const stateRoot = f.harness.authority.stateRoot;
  const projection = createOperatorProjection({ database, stateRoot, clock, reader, descriptors,
    appVersion: "0.1.0", descriptorSetHash: FingerprintSchema.parse("a".repeat(64)),
    ledger: createTransactionHistory(database.authority) });
  projection.ingestFromTimeline();
  const detail = createOperatorRunDetail({ database, stateRoot, projection, runReader: reader,
    canonical: { database, reader, descriptors } });
  const search = searchOf(f);
  const snapshot = await readSearchSnapshot({ searchRuns: async input => search.search(input) }, query, new AbortController().signal);
  const [result] = searchResults(snapshot);
  assert.ok(result?.destination?.kind === "run");
  assert.equal(result.destination.runId, runId);
  const navigation = await resolveRunNavigation({
    dashboardDay: async day => projection.buildDashboardDayWire(day),
    runDetail: async id => buildRunDetail(detail, id),
    runSection: async () => assert.fail("opening a run search hit should use its day and run detail"),
  }, result.destination, { start: false, day: "2026-01-01", view: { preview: null } },
  id => DASHBOARD_CATALOG_MODULES.some(module => module.descriptor.id === id));
  assert.equal(navigation.state, "ready");
  assert.equal(navigation.route.day, result.destination.day);
  assert.equal(navigation.route.run, runId);
  assert.equal(navigation.route.section, "logs");
}

it("finds an OCR run by a name or Employee ID carried only by its reviewed record", async () => {
  const name = "Example, Avery", eid = "10800000";
  const f = await world.fixture({
    record: true, lookupNames: [name], employeeIds: [eid],
  });
  const { database, run } = f;
  const { runId } = run.envelope;
  const review = database.authority.ocrReviews.latest(runId);
  assert.equal(review?.records.length, 1);
  const record = review?.records[0];
  assert.ok(record);
  assert.equal(ocrRecordName(record.fields), name);
  assert.ok(record.fields.answers.some(answer => answer.path === "employee.employeeId" && answer.state === "read" && answer.value === eid));

  const search = searchOf(f);
  const unfiltered = search.search({ q: "" });
  assert.ok(unfiltered.results.some(row => row.runId === runId));
  assert.ok(unfiltered.results.every(row => row.metadata.subject.state === "unavailable"));

  const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
  try {
    const matches = [name, eid, "xample, Av"].map(q => search.search({ q, scope: "subject" }).results.map(row => row.runId));
    assert.deepEqual(matches, [[runId], [runId], [runId]]);
    assert.ok(prepare.mock.calls.every(([sql]) => !sql.includes("ocr_review_revisions")));
  } finally { prepare.mockRestore(); }
  using native = new DatabaseSync(f.path, { readOnly: true });
  const projection = native.prepare("SELECT ocr_subject_terms FROM run_search WHERE run_id=?").get(runId)?.ocr_subject_terms;
  assert.ok(typeof projection === "string" && projection.length > 0);
  assert.ok(!projection.toLowerCase().includes(name.toLowerCase()) && !projection.includes(eid));
  for (const q of [name, eid]) {
    const [result] = search.search({ q }).results;
    assert.ok(result);
    assert.equal(result.runId, runId);
    assert.deepEqual(result.match, { field: "subject", strength: "exact" });
    assert.equal(result.metadata.subject.state, "unavailable");
  }
  assert.equal(search.search({ q: eid, scope: "run" }).totalMatches, 0);
  assert.equal(search.search({ q: "Example, Robin" }).totalMatches, 0);
  await assertOpensRun(f, { q: name }, runId);
}, scaledMs(30_000));

it("keeps selective subject queries available beyond ten thousand retained OCR reviews", () => {
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
  try {
    for (const migration of SQLITE_MIGRATIONS) for (const sql of migration.statements) db.exec(sql);
    db.exec(`PRAGMA user_version=${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`);
    db.exec(`INSERT INTO database_states(id,schema_version,authority_generation,updated_at,search_generation,search_state,installation_id,profile_id)
      VALUES(1,1,1,'2026-10-01T17:00:00.000Z',1,'ready','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222');
      WITH RECURSIVE seeds(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seeds WHERE n<10001),
      ids AS (SELECT printf('00000000-0000-4000-8000-%012d',n) AS id FROM seeds)
      INSERT INTO runs(id,workflow,item_id,attempt,state,priority,claim_generation,version,settings_snapshot_id,descriptor_version,contract_fingerprint,
        trace_id,dry_run,local_day,enqueued_at,envelope_json,lifecycle_json,created_at,updated_at)
      SELECT id,'ocr',id,1,'queued','interactive',0,1,'fixture',1,'fixture',id,0,'2026-10-01',
        '2026-10-01T17:00:00.000Z','{}','{}','2026-10-01T17:00:00.000Z','2026-10-01T17:00:00.000Z' FROM ids;
      INSERT INTO run_search(run_id,workflow,trace,local_day,state,shape,dry_run,enqueued_ms,descriptor_version,has_receipt,has_diagnostic,
        systems_json,source_version,metadata_json,created_at,updated_at)
      SELECT id,workflow,trace_id,local_day,state,'single',dry_run,unixepoch(enqueued_at)*1000,descriptor_version,0,0,'[]',version,'{}',created_at,updated_at FROM runs;
      INSERT INTO ocr_review_revisions(id,run_id,revision,payload_json,created_at)
      SELECT id||'#1',id,1,'{}',created_at FROM runs;`);

    const index = createRunSearchIndex(db);
    const input = { q: "example", scope: "subject", facets: {}, limit: 1 };
    assert.equal(index.search(input, 1).totalMatches, 0);
    assert.equal(index.search({ ...input, scope: "all" }, 1).totalMatches, 0);
  } finally {
    db.close();
  }
});

it("ranks hosted OCR identity matches on the host across dates and reads the latest correction", async () => {
  const name = "Example, Avery", eid = "10800000", correctedName = "Éxample, Avery";
  const f = await world.fixture({ coordinator: true, onbaseFiling: "skip", record: true, pageCount: 2,
    lookupNames: [name, "Example, Dakota"], employeeIds: [eid, "10800001"] });
  const { database, parentRun, run } = f;
  const hostId = parentRun.envelope.runId;
  const hostDay = searchPartitionDay(new Date(parentRun.envelope.enqueuedAt));
  const earlier = new Date(Date.parse(parentRun.envelope.enqueuedAt) - 86_400_000);
  const earlierDay = searchPartitionDay(earlier);
  const search = searchOf(f);
  assert.equal(search.search({ q: run.envelope.runId, scope: "run" }).totalMatches, 0);
  assert.deepEqual(search.search({ q: "", facets: { subject: eid, day: hostDay } }).results.map(row => row.runId), [hostId]);
  assert.equal(search.search({ q: eid, facets: { day: earlierDay } }).totalMatches, 0);
  await assertOpensRun(f, { q: eid }, hostId);

  const other = runRecordOf({ seed: 4250, workflow: "example", enqueuedAt: earlier.toISOString() });
  database.authority.runs.enqueue(other);
  const page = search.search({ q: "example", limit: 1 });
  assert.equal(page.totalMatches, 2);
  assert.equal(page.results[0]?.runId, other.envelope.runId);
  assert.ok(page.nextCursor.state === "present");
  const next = search.search({ q: "example", limit: 1, cursor: page.nextCursor.value });
  assert.equal(next.totalMatches, 2);
  assert.equal(next.results[0]?.runId, hostId);
  assert.deepEqual(next.results[0]?.match, { field: "subject", strength: "prefix" });
  assert.equal(next.nextCursor.state, "absent");

  const correction = f.command("correct-ocr-record", 1);
  const fields = correctOcrField(f.reading.extraction, "employee.name", correctedName);
  assert.equal(f.canonical.kernel.execute(CommandRequestSchema.parse({ ...correction,
    payload: { ...correction.payload, fields, assertedEid: eid },
  })).state, "applied");
  assert.equal(search.search({ q: name, scope: "subject" }).totalMatches, 0);
  assert.deepEqual(search.search({ q: correctedName.toUpperCase(), scope: "subject" }).results.map(row => row.runId), [hostId]);

  const host = database.authority.runs.get(hostId);
  assert.ok(host);
  assert.equal(f.canonical.kernel.execute(CommandRequestSchema.parse({ commandId: randomUUID(), family: "run", type: "cancel",
    source: "queue-row", requestedBy: "local-operator", requestedAt: f.clock.now().toISOString(),
    target: { runId: hostId, expectedVersion: host.version },
  })).state, "applied");
  assert.equal(search.search({ q: correctedName, scope: "subject" }).totalMatches, 0);
  assert.equal(search.search({ q: eid, scope: "subject" }).totalMatches, 0);
}, scaledMs(30_000));
