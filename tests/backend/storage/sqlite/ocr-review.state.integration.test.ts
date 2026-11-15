import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it } from "vitest";
import { OcrApprovedSnapshotSchema, OcrReviewRevisionSchema, ocrReviewDigest } from "../../../../src/models/ocr/review.js";
import { timelineCheckpointReference } from "../../../../src/models/events/timeline.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { accountOcrPages } from "../../../../src/models/workflows/ocr/page-accounting.js";
import { buildOcrReviewSeed } from "../../../../src/models/workflows/ocr/review-seed.js";
import { RunIdSchema } from "../../../../src/rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { createAuthorityAccountingTestWorld } from "../../../support/helpers/backend/authority-accounting-world.js";
import { COMMAND_FIXTURES, CONFIG_SNAPSHOT, HASH_A, HASH_B, HASH_C, LATER, LATEST, NOW, UUID_1, UUID_3, UUID_4, UUID_5 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN, RUN_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { READING_ID, donePage, sourceFixture } from "../../../support/fixtures/ocr/source-pages.js";

const world = createAuthorityAccountingTestWorld();
afterEach(world.cleanup);

const source = sourceFixture(1);
const page = source.inputs[0];
if (page === undefined) throw new Error("ocr-review-state-fixture");
const seed = { review: buildOcrReviewSeed({ sourceRunId: RunIdSchema.parse(RUN_ID),
  accounting: accountOcrPages(source.manifest, READING_ID, [donePage(page)]), roster: null }), identities: [] };
const records = seed.review.records.map(record => ({ recordId: record.recordId, fields: record.fields,
  assertedEid: "10800000", discarded: false as const }));
const checkpoint = timelineCheckpointReference(RunCheckpointRecordSchema.parse({ ...world.RUN_CHECKPOINT, runId: RUN_ID }));

type Database = Awaited<ReturnType<typeof world.openDatabase>>;
type StateName = "reading" | "in-review" | "approved";
type EventName = "publish-checkpoint" | "operator-revise" | "approve";
type View = { readonly revision: number | null; readonly snapshots: readonly string[] };

const MATRIX = [
  ["reading", "publish-checkpoint", { revision: 1, snapshots: [] }],
  ["reading", "operator-revise", "ocr-review-not-published"],
  ["reading", "approve", "ocr-review-not-published"],
  ["in-review", "publish-checkpoint", { revision: 2, snapshots: [] }],
  ["in-review", "operator-revise", { revision: 2, snapshots: [] }],
  ["in-review", "approve", { revision: 1, snapshots: [UUID_1] }],
  ["approved", "publish-checkpoint", "ocr-review-approved"],
  ["approved", "operator-revise", "ocr-review-approved"],
  ["approved", "approve", "ocr-review-approved"],
] as const satisfies readonly (readonly [StateName, EventName, View | string])[];

function at(revision: number) {
  if (revision === 1) return NOW;
  if (revision === 2) return LATER;
  return LATEST;
}
function digest(revision: number) {
  if (revision === 1) return HASH_A;
  if (revision === 2) return HASH_B;
  return HASH_C;
}
function checkpointRevision(revision: number, createdAt = at(revision)) {
  return OcrReviewRevisionSchema.parse({ id: `${RUN_ID}#${revision}`, sourceRunId: RUN_ID, revision, seed, records,
    origin: { kind: "checkpoint", key: `ocr-review-checkpoint-${revision}`, digest: digest(revision), checkpoint },
    actorId: "local-operator", createdAt });
}
function commandRevision(revision: number, commandId: string) {
  return OcrReviewRevisionSchema.parse({ id: `${RUN_ID}#${revision}`, sourceRunId: RUN_ID, revision, seed, records,
    origin: { kind: "command", commandId }, actorId: "local-operator", createdAt: at(revision) });
}
function approval(commandId: string, approvedAt: string) {
  const review = checkpointRevision(1);
  return OcrApprovedSnapshotSchema.parse({ snapshotId: commandId, sourceRunId: RUN_ID, revision: review.revision,
    reviewDigest: ocrReviewDigest(review), selectedRecordIds: review.records.map(record => record.recordId),
    records: review.records, approvedBy: "local-operator", approvedAt });
}
function insertCommand(database: Database, commandId: string) {
  const prototype = COMMAND_FIXTURES[0];
  if (prototype === null || typeof prototype !== "object") throw new Error("ocr-review-state-fixture");
  database.authority.commands.insert({ ...prototype, commandId });
}
function view(database: Database): View {
  const reviews = database.authority.ocrReviews;
  const current = reviews.latest(RUN_ID);
  return { revision: current === undefined ? null : current.revision,
    snapshots: reviews.snapshots(RUN_ID).map(snapshot => snapshot.snapshotId) };
}
function boot(database: Database) {
  if (database.authority.runtimeConfig.get() === undefined) database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
}
function prepare(database: Database, state: StateName) {
  boot(database);
  database.authority.runs.enqueue(QUEUED_RUN);
  if (state === "reading") return;
  database.authority.ocrReviews.append(checkpointRevision(1), 0);
  if (state === "in-review") return;
  insertCommand(database, UUID_1);
  database.authority.ocrReviews.approve(approval(UUID_1, NOW));
}
function fire(database: Database, event: EventName, state: StateName) {
  if (event === "publish-checkpoint") {
    const revision = state === "reading" ? 1 : 2;
    return database.authority.ocrReviews.append(checkpointRevision(revision), revision - 1);
  }
  if (event === "operator-revise") {
    const revision = 2;
    insertCommand(database, UUID_3);
    return database.authority.ocrReviews.append(commandRevision(revision, UUID_3), state === "reading" ? 0 : 1);
  }
  const commandId = state === "approved" ? UUID_4 : UUID_1;
  insertCommand(database, commandId);
  return database.authority.ocrReviews.approve(approval(commandId, state === "approved" ? LATER : NOW));
}
function assertRefused(run: () => void, message: string) {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, message);
    return true;
  });
}
function plantSnapshot(path: string, snapshot: ReturnType<typeof approval>) {
  const raw = new DatabaseSync(path);
  try {
    raw.exec("PRAGMA foreign_keys=ON");
    raw.prepare("INSERT INTO ocr_approved_snapshots VALUES(?,?,?,?,?)").run(snapshot.snapshotId, snapshot.sourceRunId,
      snapshot.revision, canonicalJsonStringify(snapshot), snapshot.approvedAt);
  } finally { raw.close(); }
}

it("moves a stored OCR review only through the explicit transition table", async () => {
  const states = ["reading", "in-review", "approved"] as const;
  const events = ["publish-checkpoint", "operator-revise", "approve"] as const;
  assert.deepEqual(MATRIX.map(([state, event]) => `${state}:${event}`).sort(),
    states.flatMap(state => events.map(event => `${state}:${event}`)).sort());

  for (const [state, event, expected] of MATRIX) {
    const database = await world.openDatabase();
    try {
      prepare(database, state);
      const before = view(database);
      if (typeof expected === "string") {
        assertRefused(() => { fire(database, event, state); }, expected);
        assert.deepEqual(view(database), before);
      } else {
        fire(database, event, state);
        assert.deepEqual(view(database), expected);
        if (event !== "approve") {
          const stored = database.authority.ocrReviews.revision(RUN_ID, expected.revision);
          assert.equal(stored?.origin.kind, event === "publish-checkpoint" ? "checkpoint" : "command");
        }
      }
    } finally { database.close(); }
  }

  const replay = await world.openDatabase();
  try {
    prepare(replay, "approved");
    const current = replay.authority.ocrReviews.latest(RUN_ID);
    const stored = replay.authority.ocrReviews.snapshot(UUID_1);
    assert.ok(current);
    assert.ok(stored);
    const generation = replay.getMeta().authorityGeneration;
    assert.deepEqual(replay.authority.ocrReviews.append(current, 0), current);
    assert.deepEqual(replay.authority.ocrReviews.approve(stored), stored);
    assert.equal(replay.getMeta().authorityGeneration, generation);
    assert.deepEqual(view(replay), { revision: 1, snapshots: [UUID_1] });
  } finally { replay.close(); }

  const conflict = await world.openDatabase();
  try {
    prepare(conflict, "in-review");
    const before = view(conflict);
    assertRefused(() => { conflict.authority.ocrReviews.append(checkpointRevision(1, LATER), 1); }, "ocr-review-revision-conflict");
    assert.deepEqual(view(conflict), before);
  } finally { conflict.close(); }

  const approvedConflict = await world.openDatabase();
  try {
    prepare(approvedConflict, "approved");
    const before = view(approvedConflict);
    const stored = approvedConflict.authority.ocrReviews.revision(RUN_ID, 1);
    assert.ok(stored);
    assertRefused(() => { approvedConflict.authority.ocrReviews.append(checkpointRevision(1, LATER), 0); }, "ocr-review-revision-conflict");
    assert.deepEqual(view(approvedConflict), before);
    assert.equal(approvedConflict.authority.ocrReviews.revision(RUN_ID, 1)?.createdAt, stored.createdAt);
  } finally { approvedConflict.close(); }

  const snapshotConflict = await world.openDatabase();
  try {
    prepare(snapshotConflict, "approved");
    const stored = snapshotConflict.authority.ocrReviews.snapshot(UUID_1);
    assert.ok(stored);
    assertRefused(() => { snapshotConflict.authority.ocrReviews.approve(approval(UUID_1, LATER)); }, "ocr-snapshot-replay-conflict");
    assert.equal(snapshotConflict.authority.ocrReviews.snapshot(UUID_1)?.approvedAt, stored.approvedAt);
  } finally { snapshotConflict.close(); }

  const manyPath = await world.databasePath();
  let many = await world.openDatabase(manyPath);
  try {
    prepare(many, "approved");
    insertCommand(many, UUID_5);
    const extra = approval(UUID_5, NOW);
    many.close();
    plantSnapshot(manyPath, extra);
    many = await world.openDatabase(manyPath);
    assertRefused(() => { many.authority.ocrReviews.append(checkpointRevision(2), 1); }, "ocr-review-snapshot-ambiguous");
  } finally { many.close(); }

  const belowPath = await world.databasePath();
  let below = await world.openDatabase(belowPath);
  try {
    boot(below);
    below.authority.runs.enqueue(QUEUED_RUN);
    below.authority.ocrReviews.append(checkpointRevision(1), 0);
    below.authority.ocrReviews.append(checkpointRevision(2), 1);
    insertCommand(below, UUID_1);
    const stale = approval(UUID_1, NOW);
    below.close();
    plantSnapshot(belowPath, stale);
    below = await world.openDatabase(belowPath);
    assertRefused(() => { below.authority.ocrReviews.append(checkpointRevision(3), 2); }, "ocr-review-snapshot-ambiguous");
  } finally { below.close(); }
});
