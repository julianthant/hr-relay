import type { DatabaseSync } from "node:sqlite";
import { OcrReviewRevisionSchema, OcrApprovedSnapshotSchema, OcrSourceUploadSchema, type OcrApprovedSnapshot, type OcrReviewRevision } from "../../../models/ocr/review.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { z } from "zod";

export const OCR_REVIEW_MIGRATION = Object.freeze({ version: 17, statements: Object.freeze([
  `CREATE TABLE ocr_source_uploads (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at TEXT NOT NULL) STRICT`,
  `CREATE TABLE ocr_review_revisions (
    id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), revision INTEGER NOT NULL CHECK(revision>0),
    command_id TEXT UNIQUE REFERENCES commands(id), payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
    created_at TEXT NOT NULL, UNIQUE(run_id,revision)
  ) STRICT`,
  `CREATE TABLE ocr_approved_snapshots (
    id TEXT PRIMARY KEY REFERENCES commands(id), run_id TEXT NOT NULL REFERENCES runs(id),
    revision INTEGER NOT NULL CHECK(revision>0), payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), created_at TEXT NOT NULL
  ) STRICT`,
  ...["ocr_source_uploads", "ocr_review_revisions", "ocr_approved_snapshots"].flatMap(table => [
    `CREATE TRIGGER ${table}_immutable BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'ocr-evidence-immutable'); END`,
    `CREATE TRIGGER ${table}_retained BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'ocr-evidence-retained'); END`,
    `CREATE TRIGGER ${table}_no_replace BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${table} WHERE id=NEW.id${table === "ocr_review_revisions"
      ? " OR (run_id=NEW.run_id AND revision=NEW.revision) OR (command_id IS NOT NULL AND command_id=NEW.command_id)" : ""})
      BEGIN SELECT RAISE(ABORT,'ocr-evidence-replace-refused'); END`,
  ]),
]) });

interface Ports {
  database: DatabaseSync;
  read<T>(work: () => T): T;
  mutate<T>(table: "ocr_source_uploads" | "ocr_review_revisions" | "ocr_approved_snapshots", work: () => Readonly<{ result: T; changes: number }>): T;
}

export function ocrReviewFromRow(input: unknown) {
  const row = z.strictObject({ id: z.string(), run_id: z.string(), revision: z.number(), command_id: z.string().nullable(),
    payload_json: z.string(), created_at: z.string() }).parse(input);
  const record = OcrReviewRevisionSchema.parse(JSON.parse(row.payload_json));
  if (record.id !== row.id || record.sourceRunId !== row.run_id || record.revision !== row.revision
    || record.createdAt !== row.created_at || row.command_id !== (record.origin.kind === "command" ? record.origin.commandId : null)) {
    throw new Error("ocr-review-row-mismatch");
  }
  return record;
}
export function ocrSnapshotFromRow(input: unknown) {
  const row = z.strictObject({ id: z.string(), run_id: z.string(), revision: z.number(), payload_json: z.string(), created_at: z.string() }).parse(input);
  const record = OcrApprovedSnapshotSchema.parse(JSON.parse(row.payload_json));
  if (record.snapshotId !== row.id || record.sourceRunId !== row.run_id || record.revision !== row.revision || record.approvedAt !== row.created_at) {
    throw new Error("ocr-snapshot-row-mismatch");
  }
  return record;
}

export type OcrReviewState =
  | { kind: "reading" }
  | { kind: "in-review"; revision: number }
  | { kind: "approved"; snapshot: OcrApprovedSnapshot };
type OcrReviewEvent = "publish-checkpoint" | "operator-revise" | "approve";
type OcrReviewRefusal = "ocr-review-not-published" | "ocr-review-approved";
type OcrReviewStep = "in-review" | "approved" | OcrReviewRefusal;

// Replays return before this table. stateOf reads rows inside the same mutate.
const OCR_REVIEW_TRANSITIONS: { readonly [State in OcrReviewState["kind"]]: { readonly [Event in OcrReviewEvent]: OcrReviewStep } } = Object.freeze({
  reading: Object.freeze({ "publish-checkpoint": "in-review", "operator-revise": "ocr-review-not-published", approve: "ocr-review-not-published" }),
  "in-review": Object.freeze({ "publish-checkpoint": "in-review", "operator-revise": "in-review", approve: "approved" }),
  approved: Object.freeze({ "publish-checkpoint": "ocr-review-approved", "operator-revise": "ocr-review-approved", approve: "ocr-review-approved" }),
});

function stateOf(revision: OcrReviewRevision | undefined, snapshots: readonly OcrApprovedSnapshot[]): OcrReviewState {
  const snapshot = snapshots[0];
  if (snapshots.length > 1 || (snapshot !== undefined && snapshot.revision < (revision?.revision ?? 0))) throw new Error("ocr-review-snapshot-ambiguous");
  if (snapshot !== undefined) return { kind: "approved", snapshot };
  if (revision !== undefined) return { kind: "in-review", revision: revision.revision };
  return { kind: "reading" };
}
function transitionRefusal(state: OcrReviewState, event: OcrReviewEvent): OcrReviewRefusal | undefined {
  const step = OCR_REVIEW_TRANSITIONS[state.kind][event];
  return step === "in-review" || step === "approved" ? undefined : step;
}

export function createOcrReviewRepository(ports: Ports) {
  const { database } = ports;
  const latest = (runId: string) => {
    const row = database.prepare("SELECT * FROM ocr_review_revisions WHERE run_id=? ORDER BY revision DESC LIMIT 1").get(runId);
    return row === undefined ? undefined : ocrReviewFromRow(row);
  };
  return Object.freeze({
    source: (id: string) => ports.read(() => {
      const raw = database.prepare("SELECT * FROM ocr_source_uploads WHERE id=?").get(id);
      if (raw === undefined) return undefined;
      const row = z.strictObject({ id: z.string(), payload_json: z.string(), created_at: z.string() }).parse(raw);
      const source = OcrSourceUploadSchema.parse(JSON.parse(row.payload_json));
      if (source.artifact.id !== row.id || source.uploadedAt !== row.created_at) throw new Error("ocr-source-row-mismatch");
      return source;
    }),
    upload: (input: unknown) => {
      const source = OcrSourceUploadSchema.parse(input);
      return ports.mutate("ocr_source_uploads", () => {
        database.prepare("INSERT INTO ocr_source_uploads VALUES(?,?,?)").run(source.artifact.id, canonicalJsonStringify(source), source.uploadedAt);
        return { result: source, changes: 1 };
      });
    },
    latest: (runId: string) => ports.read(() => latest(runId)),
    revision: (runId: string, revision: number) => ports.read(() => {
      const row = database.prepare("SELECT * FROM ocr_review_revisions WHERE run_id=? AND revision=?").get(runId, revision);
      return row === undefined ? undefined : ocrReviewFromRow(row);
    }),
    snapshot: (id: string) => ports.read(() => {
      const row = database.prepare("SELECT * FROM ocr_approved_snapshots WHERE id=?").get(id);
      return row === undefined ? undefined : ocrSnapshotFromRow(row);
    }),
    snapshots: (runId: string) => ports.read(() => database.prepare("SELECT * FROM ocr_approved_snapshots WHERE run_id=? ORDER BY created_at,id").all(runId).map(ocrSnapshotFromRow)),
    append(input: unknown, expectedRevision: number) {
      const record = OcrReviewRevisionSchema.parse(input);
      return ports.mutate("ocr_review_revisions", () => {
        const current = latest(record.sourceRunId);
        if (current?.id === record.id && canonicalJsonStringify(current) === canonicalJsonStringify(record)) return { result: current, changes: 0 };
        const snapshots = database.prepare("SELECT * FROM ocr_approved_snapshots WHERE run_id=? ORDER BY created_at,id").all(record.sourceRunId).map(ocrSnapshotFromRow);
        const refusal = transitionRefusal(stateOf(current, snapshots), record.origin.kind === "checkpoint" ? "publish-checkpoint" : "operator-revise");
        if (refusal !== undefined) throw new Error(refusal);
        if ((current?.revision ?? 0) !== expectedRevision || record.revision !== expectedRevision + 1) throw new Error("ocr-review-revision-conflict");
        database.prepare("INSERT INTO ocr_review_revisions VALUES(?,?,?,?,?,?)").run(record.id, record.sourceRunId, record.revision,
          record.origin.kind === "command" ? record.origin.commandId : null, canonicalJsonStringify(record), record.createdAt);
        return { result: record, changes: 1 };
      });
    },
    approve(input: unknown) {
      const snapshot = OcrApprovedSnapshotSchema.parse(input);
      return ports.mutate("ocr_approved_snapshots", () => {
        const before = database.prepare("SELECT * FROM ocr_approved_snapshots WHERE id=?").get(snapshot.snapshotId);
        if (before !== undefined) {
          if (canonicalJsonStringify(ocrSnapshotFromRow(before)) !== canonicalJsonStringify(snapshot)) throw new Error("ocr-snapshot-replay-conflict");
          return { result: snapshot, changes: 0 };
        }
        const snapshots = database.prepare("SELECT * FROM ocr_approved_snapshots WHERE run_id=? ORDER BY created_at,id").all(snapshot.sourceRunId).map(ocrSnapshotFromRow);
        const refusal = transitionRefusal(stateOf(latest(snapshot.sourceRunId), snapshots), "approve");
        if (refusal !== undefined) throw new Error(refusal);
        database.prepare("INSERT INTO ocr_approved_snapshots VALUES(?,?,?,?,?)").run(snapshot.snapshotId,
          snapshot.sourceRunId, snapshot.revision, canonicalJsonStringify(snapshot), snapshot.approvedAt);
        return { result: snapshot, changes: 1 };
      });
    },
  });
}
