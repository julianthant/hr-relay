import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { createOperatorProjection, createOperatorRunDetail } from "../../../../src/backend/app/composition/dashboard/operator.js";
import { DASHBOARD_CATALOG_MODULES } from "../../../../src/backend/app/registries/workflow-registry.js";
import { buildRunDetail } from "../../../../src/backend/runs/queries/run-detail.js";
import { createCrossDateSearchService } from "../../../../src/backend/runs/queries/search.js";
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

  const matches = [name, eid].map(q => search.search({ q, scope: "subject" }).results.map(row => row.runId));
  assert.deepEqual(matches, [[runId], [runId]]);
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

  const other = runRecordOf({ seed: 5250, workflow: "example", enqueuedAt: earlier.toISOString() });
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
}, scaledMs(30_000));
