import { AssistantM1NativeCommandAuditSchema, convertAssistantCommandPairToM1 } from "./command-record-row.js";
import { CURRENT_RUN_SETTLEMENT_SQL } from "./run-settlement-row.js";
import { CHANGE_LOG_SCHEMA_VERSION } from "./authority-change-log.js";
import { OCR_SEARCH_TERMS_SCHEMA_VERSION } from "./migrations.js";
import { RUN_SEARCH_FTS_SCHEMA_VERSION } from "./run-search-fts.js";
import { RUN_REFERENCES_TABLE } from "../../../models/config/authority.js";
import { hash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { OcrReviewRevisionSchema, ocrEmployeeIdAnswer, ocrRecordName } from "../../../models/ocr/review.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { searchPartitionDay } from "../../../models/dashboard/search-calendar.js";
import { TimelineEventRecordSchema } from "../../../models/events/timeline.js";
import { ActorIdSchema, RunIdSchema } from "../../../rules/identity/ids.js";
import { type PredecessorRunRecord } from "../../../models/run/record.js";
import { RunCheckpointRecordSchema } from "../../../models/workflow/checkpoint.js";
import { FailureRecordSchema } from "../../../models/trust/failure.js";
import { CROSS_DATE_SEARCH_MATCH_ORDER, CROSS_DATE_SEARCH_QUERY_LIMIT, SearchMetadataSchema } from "../../../models/dashboard/search.js";
import { RunSearchDeclarationSchema, RunSearchIndexRecordSchema, RunSearchPublicationSchema, RunSearchReadRequestSchema, RunSearchRebuildRequestSchema } from "../../../models/dashboard/search-index.js";
import { deepFreeze } from "../../../rules/validation/immutability.js";

import { runRecordFromRow } from "./run-record-row.js";
import { CommandAuditRecordSchema } from "../../../rules/commands/commands.js";
const JsonRowSchema = z.object({ payload_json: z.string() });
const CountSchema = z.object({ count: z.number().int().nonnegative() });
const KeySchema = z.object({ id: z.string() });
const IndexRowSchema = z.object({ id: z.string(), payload_json: z.string(), match_rank: z.number().int().nonnegative() });
const ActorSourcesSchema = z.array(z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("queued"), event: TimelineEventRecordSchema }),
  z.strictObject({ kind: z.literal("start-audit"), audit: CommandAuditRecordSchema }),
]));
function sourceActors(sources: z.infer<typeof ActorSourcesSchema>, run: PredecessorRunRecord) {
  const id = run.envelope.runId;
  const actors = sources.map(source => {
      if (source.kind === "queued") {
        const event = source.event;
        if (event.scope.kind !== "run" || event.scope.runId !== id || event.workflow !== run.envelope.workflow
          || event.payload.kind !== "span" || event.payload.event.t !== "run.queued" || event.payload.event.runId !== id) throw new Error("run-search-actor-source-invalid");
        return ActorIdSchema.parse(event.payload.event.actorId);
      }
      const audit = source.audit;
      if (audit.request.family !== "start" || !(audit.result.state === "applied" || audit.result.state === "already-applied")
        || !audit.result.affectedTargets.some(target => target.family === "run" && target.runId === id)) throw new Error("run-search-actor-source-invalid");
      return audit.request.requestedBy;
    });
  if (new Set(actors).size > 1) throw new Error("run-search-actor-ambiguous");
  return actors;
 }
const FullIndexRowSchema = z.strictObject({ run_id:z.string(),workflow:z.string(),trace:z.string(),local_day:z.string(),state:z.string(),shape:z.string(),
  dry_run:z.number().int().min(0).max(1),enqueued_ms:z.number().int(),subject:z.string().nullable(),actor_id:z.string().nullable(),descriptor_version:z.number().int().positive(),
  failure_code:z.string().nullable(),has_receipt:z.number().int().min(0).max(1),has_diagnostic:z.number().int().min(0).max(1),systems_json:z.string(),source_version:z.number().int().positive(),
  declaration_json:z.string().nullable(),actor_source_json:z.string().nullable(),metadata_json:z.string(),created_at:z.string(),updated_at:z.string(),
  ocr_subject_terms:z.string().nullable().optional() });
export function runSearchIndexFromRow(input: unknown, run: PredecessorRunRecord, requireCurrent = true) {
  const row = FullIndexRowSchema.parse(input), record = RunSearchIndexRecordSchema.parse(JSON.parse(row.metadata_json));
  const declaration = row.declaration_json === null ? null : RunSearchDeclarationSchema.parse(JSON.parse(row.declaration_json));
  if (declaration !== null && (declaration.workflow !== run.envelope.workflow || declaration.version !== run.envelope.descriptorVersion
    || declaration.contractFingerprint !== run.envelope.contractFingerprint)) throw new Error("run-search-declaration-identity-mismatch");
  const actors = sourceActors(row.actor_source_json === null ? [] : ActorSourcesSchema.parse(JSON.parse(row.actor_source_json)),run);
  const actor = record.metadata.actor.state === "available" ? record.metadata.actor.value : null;
  const subject = record.metadata.subject.state === "available" ? record.metadata.subject.value.toLowerCase() : null;
  if (row.run_id !== run.envelope.runId || record.runId !== row.run_id || record.sourceVersion !== row.source_version || requireCurrent && row.source_version !== run.version
    || row.workflow !== run.envelope.workflow || row.trace !== run.envelope.traceId.toLowerCase() || row.local_day !== searchPartitionDay(new Date(run.envelope.enqueuedAt))
    || requireCurrent && row.state !== (run.lifecycle.state === "terminal" ? run.lifecycle.outcome : run.lifecycle.state) || row.shape !== run.envelope.shape
    || row.dry_run !== Number(run.envelope.dryRun) || row.enqueued_ms !== Date.parse(run.envelope.enqueuedAt)
    || row.descriptor_version !== run.envelope.descriptorVersion || record.metadata.version !== row.descriptor_version
    || row.subject !== subject || row.actor_id !== actor || actor !== (actors[0] ?? null)
    || row.failure_code !== record.metadata.failureCode || row.has_receipt !== Number(record.metadata.evidence.receipt)
    || row.has_diagnostic !== Number(record.metadata.evidence.diagnostic)
    || canonicalJsonStringify(z.array(z.string()).parse(JSON.parse(row.systems_json))) !== canonicalJsonStringify(Object.keys(run.envelope.resolvedInstance).sort())) {
    throw new Error("run-search-index-corrupt");
  }
  return record;
}

function runSearchColumns(run: PredecessorRunRecord, metadata: z.infer<typeof SearchMetadataSchema>,
  generation: number, declaration: z.infer<typeof RunSearchDeclarationSchema> | null, sources: z.infer<typeof ActorSourcesSchema>,
  createdAt: string, updatedAt: string) {
  const record = RunSearchIndexRecordSchema.parse({ runId: run.envelope.runId, sourceVersion: run.version, buildGeneration: generation, metadata });
  return { run_id: run.envelope.runId, workflow: run.envelope.workflow, trace: run.envelope.traceId.toLowerCase(),
    local_day: searchPartitionDay(new Date(run.envelope.enqueuedAt)), state: run.lifecycle.state === "terminal" ? run.lifecycle.outcome : run.lifecycle.state,
    shape: run.envelope.shape, dry_run: Number(run.envelope.dryRun), enqueued_ms: Date.parse(run.envelope.enqueuedAt),
    subject: metadata.subject.state === "available" ? metadata.subject.value.toLowerCase() : null,
    actor_id: metadata.actor.state === "available" ? metadata.actor.value : null, descriptor_version: metadata.version,
    failure_code: metadata.failureCode, has_receipt: Number(metadata.evidence.receipt), has_diagnostic: Number(metadata.evidence.diagnostic),
    systems_json: canonicalJsonStringify(Object.keys(run.envelope.resolvedInstance).sort()), source_version: run.version,
    declaration_json: declaration === null ? null : canonicalJsonStringify(declaration),
    actor_source_json: sources.length === 0 ? null : canonicalJsonStringify(sources),
    metadata_json: canonicalJsonStringify(record), created_at: createdAt, updated_at: updatedAt };
}

export function copySeedSearchColumns(run: PredecessorRunRecord, queued: z.infer<typeof TimelineEventRecordSchema>, failureCode: string | null) {
  const sources = ActorSourcesSchema.parse([{ kind: "queued", event: queued }]);
  const [actor] = sourceActors(sources, run);
  const metadata = SearchMetadataSchema.parse({ subject: { state: "unavailable", reason: "declaration-unavailable" },
    actor: { state: "available", value: actor }, version: run.envelope.descriptorVersion, failureCode,
    evidence: { receipt: false, failure: failureCode !== null, diagnostic: false } });
  return { ...runSearchColumns(run, metadata, 0, null, sources, run.createdAt, run.updatedAt), ocr_subject_terms: null };
}
const LIMIT = 10000;
function parse<T>(schema: z.ZodType<T>, row: unknown): T { return schema.parse(JSON.parse(JsonRowSchema.parse(row).payload_json)); }
function declarationKey(run: PredecessorRunRecord): string {
  return `${run.envelope.workflow}:${String(run.envelope.descriptorVersion)}:${run.envelope.contractFingerprint}`;
}
function safeSubject(database: DatabaseSync, run: PredecessorRunRecord, declaration: z.infer<typeof RunSearchDeclarationSchema> | null): z.infer<typeof SearchMetadataSchema>["subject"] {
  if (declaration === null) return { state: "unavailable", reason: "declaration-unavailable" };
  const { subjectProjection } = declaration;
  if (subjectProjection === null) return { state: "unavailable", reason: "subject-unavailable" };
  const checkpoint = database.prepare(`SELECT payload_json FROM run_checkpoints WHERE run_id=? AND node_id=? ORDER BY attempt DESC,claim_generation DESC LIMIT 1`)
    .get(run.envelope.runId, subjectProjection.nodeId);
  if (checkpoint === undefined) return { state: "unavailable", reason: "subject-unavailable" };
  const stored = parse(RunCheckpointRecordSchema, checkpoint);
  if (stored.descriptorVersion !== run.envelope.descriptorVersion || stored.contractFingerprint !== run.envelope.contractFingerprint) return { state: "unavailable", reason: "declaration-unavailable" };
  let value: unknown = stored.output.value;
  for (const part of subjectProjection.fieldPath.split(".")) {
    if (value === null || typeof value !== "object" || Array.isArray(value) || !Object.hasOwn(value, part)) return { state: "unavailable", reason: "subject-unavailable" };
    value = Reflect.get(value, part);
  }
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 500) throw new Error("run-search-subject-invalid");
  return { state: "available", value: value.trim() };
}

const OCR_SUBJECT_STRENGTH = deepFreeze({ exact: 0, prefix: 1, contains: 2 });
const OCR_UNFINISHED_OUTCOMES = deepFreeze(["cancelled", "discarded", "superseded"]);
const OCR_UNFINISHED_SQL = OCR_UNFINISHED_OUTCOMES.map(outcome => `'${outcome}'`).join(",");
const FTS_FIELDS = { all: "{run_id trace workflow subject actor}", run: "run_id", trace: "trace",
  workflow: "workflow", subject: "subject", actor: "actor" } as const;

function ftsSubjectMatch(field: string, query: string, ocrDigest: string | undefined): string | undefined {
  // shortcut: shorter than a trigram uses the exact predicate, revisit if short searches become a bottleneck.
  const phrase = query.split("\0").find(part => [...part].length >= 3);
  if (phrase === undefined) return undefined;
  const plain = `${field}:"${phrase.replaceAll('"', '""')}"`;
  return ocrDigest === undefined ? plain : `(${plain} OR ocr_subject_terms:"|${ocrDigest}|")`;
}

function ocrSubjectDigest(term: string): string {
  return hash("sha256", Buffer.from(`relay:run-search-ocr-subject:v1\0${term}`, "utf16le"), "base64url");
}

const OcrSearchRecordsSchema = z.strictObject({ records_json: z.string() });

function ocrSubjectWithheld(subject: z.infer<typeof SearchMetadataSchema>["subject"] | undefined): boolean {
  return subject?.state === "unavailable" && subject.reason === "withheld";
}

function ocrSubjectTermsFor(database: DatabaseSync, runId: string, subject: z.infer<typeof SearchMetadataSchema>["subject"]): string | null {
  if (ocrSubjectWithheld(subject)) return null;
  const reviews = database.prepare(`SELECT json_extract(review.payload_json,'$.records') AS records_json FROM runs ocr
    JOIN ocr_review_revisions review ON review.run_id=ocr.id AND review.revision=(
      SELECT max(revision) FROM ocr_review_revisions WHERE run_id=ocr.id
    )
    WHERE ocr.workflow='ocr' AND (ocr.parent_id=? OR (ocr.id=? AND ocr.parent_id IS NULL))
      AND COALESCE(ocr.outcome,'') NOT IN (${OCR_UNFINISHED_SQL})
      AND NOT EXISTS (SELECT 1 FROM runs WHERE id=? AND outcome IN (${OCR_UNFINISHED_SQL}))
    ORDER BY ocr.id`);
  const subjects = new Set<string>();
  for (const row of reviews.iterate(runId, runId, runId)) {
    const { records_json } = OcrSearchRecordsSchema.parse(row);
    for (const record of OcrReviewRevisionSchema.shape.records.parse(JSON.parse(records_json))) {
      const employeeId = ocrEmployeeIdAnswer(record.fields);
      for (const value of [ocrRecordName(record.fields), record.assertedEid, employeeId?.state === "read" ? employeeId.value : undefined]) {
        if (typeof value === "string") subjects.add(value.trim().toLowerCase());
      }
    }
  }
  const terms = new Map<string, number>();
  for (const value of subjects) {
    for (let start = 0; start < value.length; start += 1) {
      // Lowercasing can expand a query character to two code units.
      const limit = Math.min(value.length, start + 2 * CROSS_DATE_SEARCH_QUERY_LIMIT);
      for (let end = start + 1; end <= limit; end += 1) {
        const term = value.slice(start, end);
        if (term !== term.trim()) continue;
        const strength = start > 0 ? OCR_SUBJECT_STRENGTH.contains
          : end < value.length ? OCR_SUBJECT_STRENGTH.prefix : OCR_SUBJECT_STRENGTH.exact;
        if (strength < (terms.get(term) ?? Infinity)) terms.set(term, strength);
      }
    }
  }
  if (terms.size === 0) return null;
  return [...terms].map(([term, strength]) => `|${String(strength)}|${ocrSubjectDigest(term)}|`).join("");
}

/** The stopped authority and imported history both backfill their existing search rows. */
export function backfillRunSearchOcrSubjects(database: DatabaseSync): void {
  const candidates = database.prepare(`SELECT run_id,metadata_json FROM run_search WHERE run_id IN (
    SELECT COALESCE(ocr.parent_id,ocr.id) FROM runs ocr WHERE ocr.workflow='ocr'
      AND EXISTS (SELECT 1 FROM ocr_review_revisions WHERE run_id=ocr.id)
  )`).all();
  const update = database.prepare("UPDATE run_search SET ocr_subject_terms=? WHERE run_id=?");
  for (const row of candidates) {
    const { run_id, metadata_json } = z.strictObject({ run_id: RunIdSchema, metadata_json: z.string() }).parse(row);
    const { metadata } = RunSearchIndexRecordSchema.parse(JSON.parse(metadata_json));
    update.run(ocrSubjectTermsFor(database, run_id, metadata.subject), run_id);
  }
}

type RunSearchPublication = z.infer<typeof RunSearchPublicationSchema>;

/** `database_states.search_state`. Nothing writes `unbuilt`; a store upgraded from schema 6 or earlier may still hold it. */
export const SearchStateColumnSchema = z.enum(["unbuilt", "ready", "invalid"]);
const SearchColumnsSchema = z.strictObject({ authority_generation: z.number().int(), search_generation: z.number().int().nullable(), search_state: SearchStateColumnSchema });
const StoredPublicationSchema = RunSearchPublicationSchema.omit({ rowCount: true });

/**
 * The stored publication, without its row count. An invalid state that keeps a generation is a build in progress at that
 * generation; its progress is the last run written with that `buildGeneration`.
 */
export function runSearchPublicationOf(row: z.infer<typeof SearchColumnsSchema>, buildProgress: (generation: number) => string | null): Omit<RunSearchPublication, "rowCount"> {
  if (row.search_state === "invalid" && row.search_generation !== null) return StoredPublicationSchema.parse({ state: "building", sourceGeneration: row.search_generation, afterRun: buildProgress(row.search_generation) });
  return StoredPublicationSchema.parse({ state: row.search_state === "ready" ? "published" : "invalid", sourceGeneration: row.search_generation ?? row.authority_generation, afterRun: null });
}

/** A publication against the current authority generation; a publication or build at any other generation is stale. */
export const RUN_SEARCH_STATES = deepFreeze(["published", "building", "stale", "invalid"] as const);
export type RunSearchState = (typeof RUN_SEARCH_STATES)[number];

export function runSearchStateOf(publication: Pick<z.input<typeof RunSearchPublicationSchema>, "state" | "sourceGeneration">, authorityGeneration: number): RunSearchState {
  if (publication.state === "invalid") return "invalid";
  return publication.sourceGeneration === authorityGeneration ? publication.state : "stale";
}

/**
 * `register` affects at most 500 indexed runs and `register-bulk` more. A rebuild chunk is `last` when it writes the final run.
 * Native cancellation and projection repair invalidate in their own SQL in `authority-database.ts`.
 */
export const RUN_SEARCH_EVENTS = deepFreeze(["authority-write", "register", "register-bulk", "native-cancellation", "projection-repair",
  "restart-chunk", "restart-last-chunk", "continue-chunk", "continue-last-chunk", "search"] as const);
export type RunSearchEvent = (typeof RUN_SEARCH_EVENTS)[number];
export type RunSearchTransition = { readonly state: RunSearchState } | { readonly refused: "run-search-rebuild-restart-required" | "run-search-index-rebuild-required" };

const RESTART_REQUIRED = { refused: "run-search-rebuild-restart-required" } as const;
const REBUILD_REQUIRED = { refused: "run-search-index-rebuild-required" } as const;
const PUBLISHED = { state: "published" } as const, BUILDING = { state: "building" } as const, INVALID = { state: "invalid" } as const;
const UNPUBLISHED_ROW = {
  "authority-write": INVALID, register: INVALID, "register-bulk": INVALID, "native-cancellation": INVALID, "projection-repair": INVALID,
  "restart-chunk": BUILDING, "restart-last-chunk": PUBLISHED, "continue-chunk": RESTART_REQUIRED, "continue-last-chunk": RESTART_REQUIRED, search: REBUILD_REQUIRED,
} as const;

/** Only a published index serves search and survives a write; only a build at the current generation continues. */
export const RUN_SEARCH_TRANSITIONS = deepFreeze({
  published: {
    "authority-write": PUBLISHED, register: PUBLISHED, "register-bulk": INVALID, "native-cancellation": INVALID, "projection-repair": INVALID,
    "restart-chunk": BUILDING, "restart-last-chunk": PUBLISHED, "continue-chunk": RESTART_REQUIRED, "continue-last-chunk": RESTART_REQUIRED, search: PUBLISHED,
  },
  building: { ...UNPUBLISHED_ROW, "continue-chunk": BUILDING, "continue-last-chunk": PUBLISHED },
  stale: UNPUBLISHED_ROW,
  invalid: UNPUBLISHED_ROW,
} as const satisfies Record<RunSearchState, Record<RunSearchEvent, RunSearchTransition>>);

export function runSearchTransition(state: RunSearchState, event: RunSearchEvent): RunSearchTransition {
  return RUN_SEARCH_TRANSITIONS[state][event];
}

/** The next state, or the refusal raised as today's error. */
function nextRunSearchState(state: RunSearchState, event: RunSearchEvent): RunSearchState {
  const next = runSearchTransition(state, event);
  if ("refused" in next) throw new Error(next.refused);
  return next.state;
}

export function createRunSearchIndex(database: DatabaseSync) {
  const schemaVersion = z.object({ user_version: z.number() }).parse(database.prepare("PRAGMA user_version").get()).user_version;
  const hasOcrSubjects = schemaVersion >= OCR_SEARCH_TERMS_SCHEMA_VERSION;
  const searchColumns = `r.run_id AS id,r.workflow,r.trace,r.local_day,r.state,r.shape,r.dry_run,r.enqueued_ms,
    r.subject,r.actor_id AS actor,r.descriptor_version AS version,r.failure_code AS failure,r.has_receipt AS receipt,
    r.has_diagnostic AS diagnostic,r.systems_json AS systems,r.metadata_json AS payload_json${hasOcrSubjects ? ",r.ocr_subject_terms" : ""}`;
  const prepareTemporaryState = () => {
    database.exec("CREATE TEMP TABLE IF NOT EXISTS search_actor_dirty(run_id TEXT PRIMARY KEY) WITHOUT ROWID");
    database.exec("CREATE TEMP TABLE IF NOT EXISTS search_ocr_dirty(run_id TEXT PRIMARY KEY) WITHOUT ROWID");
    database.exec("CREATE TEMP TABLE IF NOT EXISTS search_declarations(id TEXT PRIMARY KEY,json TEXT NOT NULL) WITHOUT ROWID");
  };
  const count = () => CountSchema.parse(database.prepare("SELECT count(*) AS count FROM run_search").get()).count;
  /** The publication without its row count, which coverage checks do not need and which reads every index row. */
  const columns = () => SearchColumnsSchema.parse(database.prepare("SELECT authority_generation,search_generation,search_state FROM database_states WHERE id=1").get());
  const buildProgress = (generation: number) => z.strictObject({after_run:z.string().nullable()})
    .parse(database.prepare("SELECT max(run_id) AS after_run FROM run_search WHERE json_extract(metadata_json,'$.buildGeneration')=?").get(generation)).after_run;
  const publicationState = () => runSearchPublicationOf(columns(), buildProgress);
  const publication = () => {
    const current = publicationState();
    const rowCount = current.state === "building"
      ? CountSchema.parse(database.prepare("SELECT count(*) AS count FROM run_search WHERE json_extract(metadata_json,'$.buildGeneration')=?").get(current.sourceGeneration)).count
      : count();
    return RunSearchPublicationSchema.parse({...current,rowCount});
  };
  const publish = (value: z.input<typeof RunSearchPublicationSchema>, _now: string) => {
    const parsed = RunSearchPublicationSchema.parse(value);
    database.prepare("UPDATE database_states SET search_generation=?,search_state=? WHERE id=1").run(parsed.state === "invalid" ? null : parsed.sourceGeneration,parsed.state === "published" ? "ready" : "invalid");
    return parsed;
  };
  const retainedActorSources = (run: PredecessorRunRecord): z.infer<typeof ActorSourcesSchema> => {
    const id = run.envelope.runId;
    const sources: z.infer<typeof ActorSourcesSchema> = [];
    for (const raw of database.prepare("SELECT payload_json FROM timeline_events WHERE run_id=? AND json_extract(payload_json,'$.payload.event.t')='run.queued' ORDER BY cursor").all(id)) sources.push({kind:"queued",event:parse(TimelineEventRecordSchema,raw)});
    // From schema 31 the audits naming the run are found through its references rather than by reading every audit.
    const audits = schemaVersion >= CHANGE_LOG_SCHEMA_VERSION
      ? `SELECT audit.payload_json FROM ${RUN_REFERENCES_TABLE} AS reference JOIN command_audits AS audit ON audit.id=json_extract(reference.row_key,'$[0]') WHERE reference.run_id=? AND reference.table_name='command_audits' AND`
      : "SELECT payload_json FROM command_audits AS audit WHERE";
    for (const raw of database.prepare(`${audits} json_extract(audit.payload_json,'$.request.family')='start' AND json_extract(audit.payload_json,'$.result.state') IN ('applied','already-applied') AND EXISTS(SELECT 1 FROM json_each(audit.payload_json,'$.result.affectedTargets') target WHERE json_extract(target.value,'$.family')='run' AND json_extract(target.value,'$.runId')=?) ORDER BY audit.id`).all(...(schemaVersion >= CHANGE_LOG_SCHEMA_VERSION ? [id, id] : [id]))) sources.push({kind:"start-audit",audit:parse(CommandAuditRecordSchema,raw)});
    sourceActors(sources,run);
    return sources;
  };
  const actorSourceKey = (source: z.infer<typeof ActorSourcesSchema>[number]) => source.kind === "queued" ? `queued:${source.event.eventId}` : `start-audit:${source.audit.auditId}`;
  const validateActorSources = (run: PredecessorRunRecord, sources: z.infer<typeof ActorSourcesSchema>, retained = retainedActorSources(run)) => {
    const frozen = new Map(sources.map(source => [actorSourceKey(source),source]));
    if (frozen.size !== sources.length) throw new Error("run-search-actor-source-duplicate");
    const actual = new Map(retained.map(source => [actorSourceKey(source),source]));
    for (const source of retained) if (frozen.get(actorSourceKey(source)) === undefined || canonicalJsonStringify(frozen.get(actorSourceKey(source))) !== canonicalJsonStringify(source)) throw new Error("run-search-retained-actor-source-mismatch");
    for (const source of sources) if (!actual.has(actorSourceKey(source))) throw new Error("run-search-retained-actor-source-missing");
  };
  const metadataFor = (run: PredecessorRunRecord, declaration: z.infer<typeof RunSearchDeclarationSchema> | null, sources: z.infer<typeof ActorSourcesSchema>) => {
    const id = run.envelope.runId;
    const actors = sourceActors(sources, run);
    const failureRow = database.prepare("SELECT payload_json FROM run_failures WHERE run_id=?").get(id);
    const failure = failureRow === undefined ? null : parse(FailureRecordSchema, failureRow);
    const exists = (table: string) => database.prepare(`SELECT 1 FROM ${table} WHERE run_id=? LIMIT 1`).get(id) !== undefined;
    return SearchMetadataSchema.parse({ subject: safeSubject(database, run, declaration),
      actor: actors.length === 0 ? { state: "unavailable", reason: "not-recorded" } : { state: "available", value: actors[0] },
      version: run.envelope.descriptorVersion, failureCode: failure?.code ?? null,
      evidence: { receipt: schemaVersion < 20 ? exists("run_receipts")
        : database.prepare(`SELECT 1 FROM run_receipts receipt JOIN run_results settlement ON settlement.run_id=receipt.run_id
          AND settlement.settlement_version=receipt.settlement_version JOIN runs run ON run.id=settlement.run_id
          WHERE receipt.run_id=? AND ${CURRENT_RUN_SETTLEMENT_SQL} LIMIT 1`).get(id) !== undefined, failure: failure !== null, diagnostic: exists("diagnostic_snapshots") } });
  };
  const validateCoverage = (readRun: (raw: unknown) => PredecessorRunRecord = runRecordFromRow) => {
    const current = publicationState();
    if (current.state === "invalid") return;
    if (current.state === "building") {
      if (database.prepare("SELECT 1 FROM runs r LEFT JOIN run_search s ON s.run_id=r.id AND json_extract(s.metadata_json,'$.buildGeneration')=? WHERE r.id<=? AND s.run_id IS NULL LIMIT 1").get(current.sourceGeneration,current.afterRun) !== undefined) throw new Error("run-search-build-prefix-invalid");
    } else if (database.prepare("SELECT 1 FROM runs r LEFT JOIN run_search s ON s.run_id=r.id WHERE s.run_id IS NULL LIMIT 1").get() !== undefined
      || database.prepare("SELECT 1 FROM run_search s LEFT JOIN runs r ON r.id=s.run_id WHERE r.id IS NULL LIMIT 1").get() !== undefined) throw new Error("run-search-source-coverage-invalid");
    const rows = current.state === "building"
      ? database.prepare("SELECT * FROM run_search WHERE json_extract(metadata_json,'$.buildGeneration')=? ORDER BY run_id").iterate(current.sourceGeneration)
      : database.prepare("SELECT * FROM run_search ORDER BY run_id").iterate();
    for (const raw of rows) validateIndexedRow(raw, readRun);
  };
  const validateIndexedRow = (raw: unknown, readRun: (raw: unknown) => PredecessorRunRecord) => {
    const indexed = FullIndexRowSchema.parse(raw);
    const run = readRun(database.prepare("SELECT * FROM runs WHERE id=?").get(indexed.run_id));
    const record = runSearchIndexFromRow(raw, run);
    const declaration = indexed.declaration_json === null ? null : RunSearchDeclarationSchema.parse(JSON.parse(indexed.declaration_json));
    const sources = indexed.actor_source_json === null ? [] : ActorSourcesSchema.parse(JSON.parse(indexed.actor_source_json));
    validateActorSources(run,sources);
    if (canonicalJsonStringify(record.metadata) !== canonicalJsonStringify(metadataFor(run, declaration, sources))) throw new Error("run-search-source-metadata-invalid");
    if (hasOcrSubjects && indexed.ocr_subject_terms !== ocrSubjectTermsFor(database, indexed.run_id, record.metadata.subject)) {
      throw new Error("run-search-source-ocr-subject-invalid");
    }
  };
  /**
   * `validateCoverage` limited to the given runs: the same rules, applied to their runs and index rows only. While a build is in
   * progress, `changedRows` names the index rows that changed: a build row added above the old prefix end moves `afterRun`, so
   * every run between the highest unchanged build row and the new end must have a build row too.
   */
  const validateCoverageOf = (runIds: ReadonlySet<string>, changedRows: ReadonlySet<string> = new Set()) => {
    const current = publicationState();
    if (current.state === "invalid") return;
    if (current.state === "building" && changedRows.size > 0 && current.afterRun !== null) {
      const unchanged = z.strictObject({run_id:z.string()}).optional().parse(database.prepare("SELECT run_id FROM run_search WHERE json_extract(metadata_json,'$.buildGeneration')=? AND run_id NOT IN (SELECT value FROM json_each(?)) ORDER BY run_id DESC LIMIT 1")
        .get(current.sourceGeneration, JSON.stringify([...changedRows])))?.run_id ?? "";
      if (database.prepare("SELECT 1 FROM runs r LEFT JOIN run_search s ON s.run_id=r.id AND json_extract(s.metadata_json,'$.buildGeneration')=? WHERE r.id>? AND r.id<=? AND s.run_id IS NULL LIMIT 1")
        .get(current.sourceGeneration, unchanged, current.afterRun) !== undefined) throw new Error("run-search-build-prefix-invalid");
    }
    for (const id of runIds) {
      const run = database.prepare("SELECT 1 FROM runs WHERE id=?").get(id) !== undefined;
      if (current.state === "building") {
        const raw = database.prepare("SELECT * FROM run_search WHERE run_id=? AND json_extract(metadata_json,'$.buildGeneration')=?").get(id, current.sourceGeneration);
        if (run && raw === undefined && current.afterRun !== null && id <= current.afterRun) throw new Error("run-search-build-prefix-invalid");
        if (raw !== undefined) validateIndexedRow(raw, runRecordFromRow);
        continue;
      }
      const raw = database.prepare("SELECT * FROM run_search WHERE run_id=?").get(id);
      if (run !== (raw !== undefined)) throw new Error("run-search-source-coverage-invalid");
      if (raw !== undefined) validateIndexedRow(raw, runRecordFromRow);
    }
  };
  const write = (run: PredecessorRunRecord, now: string, rebuilding = false) => {
    const id = run.envelope.runId;
    const prior = database.prepare("SELECT * FROM run_search WHERE run_id=?").get(id);
    const frozen = prior === undefined ? undefined : FullIndexRowSchema.parse(prior);
    const declared = database.prepare("SELECT json AS payload_json FROM search_declarations WHERE id=?").get(declarationKey(run));
    const declaration = frozen?.declaration_json != null ? RunSearchDeclarationSchema.parse(JSON.parse(frozen.declaration_json))
      : declared === undefined ? null : parse(RunSearchDeclarationSchema,declared);
    if (declaration !== null && (declaration.workflow !== run.envelope.workflow || declaration.version !== run.envelope.descriptorVersion
      || declaration.contractFingerprint !== run.envelope.contractFingerprint)) throw new Error("run-search-declaration-identity-mismatch");
    const previous = prior !== undefined && !rebuilding ? runSearchIndexFromRow(prior, run, false) : undefined;
    const sources = frozen?.actor_source_json == null ? [] : ActorSourcesSchema.parse(JSON.parse(frozen.actor_source_json));
    const refreshActor = rebuilding || prior === undefined || database.prepare("SELECT 1 FROM search_actor_dirty WHERE run_id=?").get(id) !== undefined;
    const retained = refreshActor ? retainedActorSources(run) : sources;
    for (const source of retained) {
      const existing = sources.find(entry => actorSourceKey(entry) === actorSourceKey(source));
      if (existing === undefined) sources.push(source);
      else if (canonicalJsonStringify(existing) !== canonicalJsonStringify(source)) throw new Error("run-search-retained-actor-source-mismatch");
    }
    validateActorSources(run,sources,retained);
    const metadata = metadataFor(run, declaration, sources);
    const generation = z.object({authority_generation:z.number().int().nonnegative()}).parse(database.prepare("SELECT authority_generation FROM database_states WHERE id=1").get()).authority_generation;
    const columns = runSearchColumns(run, metadata, generation, declaration, sources, frozen?.created_at ?? now, now);
    database.prepare(`INSERT INTO run_search(run_id,workflow,trace,local_day,state,shape,dry_run,enqueued_ms,subject,actor_id,descriptor_version,failure_code,has_receipt,has_diagnostic,systems_json,source_version,declaration_json,actor_source_json,metadata_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET workflow=excluded.workflow,trace=excluded.trace,local_day=excluded.local_day,shape=excluded.shape,dry_run=excluded.dry_run,enqueued_ms=excluded.enqueued_ms,descriptor_version=excluded.descriptor_version,systems_json=excluded.systems_json,declaration_json=excluded.declaration_json,state=excluded.state,subject=excluded.subject,actor_id=excluded.actor_id,failure_code=excluded.failure_code,has_receipt=excluded.has_receipt,has_diagnostic=excluded.has_diagnostic,source_version=excluded.source_version,actor_source_json=excluded.actor_source_json,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`).run(
      ...Object.values(columns));
    if (hasOcrSubjects && (rebuilding || prior === undefined
      || ocrSubjectWithheld(previous?.metadata.subject) !== ocrSubjectWithheld(metadata.subject)
      || OCR_UNFINISHED_OUTCOMES.includes(columns.state) !== OCR_UNFINISHED_OUTCOMES.includes(frozen?.state ?? "")
      || database.prepare("SELECT 1 FROM search_ocr_dirty WHERE run_id=?").get(id) !== undefined)) {
      const terms = ocrSubjectTermsFor(database, id, metadata.subject);
      if (terms !== (frozen?.ocr_subject_terms ?? null)) {
        database.prepare("UPDATE run_search SET ocr_subject_terms=? WHERE run_id=?").run(terms, id);
      }
    }
    database.prepare("DELETE FROM search_actor_dirty WHERE run_id=?").run(id);
  };
  const writeId = (id: string, now: string, rebuilding = false, readRun: (raw: unknown) => PredecessorRunRecord = runRecordFromRow) => {
    const raw = database.prepare("SELECT * FROM runs WHERE id=?").get(id);
    if (raw === undefined) {
      database.prepare("DELETE FROM run_search WHERE run_id=?").run(id);
      database.prepare("DELETE FROM search_actor_dirty WHERE run_id=?").run(id);
    } else write(readRun(raw),now,rebuilding);
  };
  return {
    publication,
    publicationState,
    validateCoverage,
    validateCoverageOf,
    installTracking() {
      prepareTemporaryState();
      database.exec("CREATE TEMP TABLE IF NOT EXISTS search_dirty(run_id TEXT PRIMARY KEY) WITHOUT ROWID");
      const sources = ["runs","run_checkpoints","run_receipts","run_failures","diagnostic_snapshots","timeline_events"];
      for (const table of sources) for (const action of ["INSERT","UPDATE","DELETE"]) {
        const refs = action === "INSERT" ? ["NEW"] : action === "DELETE" ? ["OLD"] : ["OLD","NEW"];
        const when = table === "timeline_events" ? ` WHEN ${refs.map(ref => `json_extract(${ref}.payload_json,'$.payload.event.t')='run.queued'`).join(" OR ")}` : "";
        const inserts = refs.map(ref => `INSERT OR IGNORE INTO search_dirty SELECT ${ref}.${table === "runs" ? "id" : "run_id"} WHERE ${ref}.${table === "runs" ? "id" : "run_id"} IS NOT NULL;`).join(" ");
        const actors = table === "timeline_events" ? refs.map(ref => `INSERT OR IGNORE INTO search_actor_dirty SELECT ${ref}.run_id WHERE ${ref}.run_id IS NOT NULL;`).join(" ") : "";
        database.exec(`CREATE TEMP TRIGGER IF NOT EXISTS search_dirty_${table}_${action} AFTER ${action} ON main.${table}${when} BEGIN ${inserts} ${actors} END`);
      }
      for (const action of ["INSERT", "UPDATE", "DELETE"]) {
        const refs = action === "INSERT" ? ["NEW"] : action === "DELETE" ? ["OLD"] : ["OLD", "NEW"];
        const statements = refs.flatMap(ref => ["search_dirty", "search_actor_dirty"].map(table =>
          `INSERT OR IGNORE INTO ${table} SELECT json_extract(value,'$.runId') FROM json_each(${ref}.payload_json,'$.result.affectedTargets')
            WHERE json_extract(${ref}.payload_json,'$.request.family')='start'
            AND json_extract(${ref}.payload_json,'$.result.state') IN ('applied','already-applied') AND json_extract(value,'$.family')='run';`)).join(" ");
        database.exec(`CREATE TEMP TRIGGER IF NOT EXISTS search_start_actor_${action} AFTER ${action} ON main.command_audits BEGIN ${statements} END`);
      }
      if (hasOcrSubjects) {
        const dirtyTables = ["search_dirty", "search_ocr_dirty"];
        const review = dirtyTables.map(table => `INSERT OR IGNORE INTO ${table}
          SELECT COALESCE(parent_id,id) FROM runs WHERE id=NEW.run_id AND workflow='ocr';`).join(" ");
        const host = dirtyTables.map(table => `INSERT OR IGNORE INTO ${table} VALUES(OLD.parent_id);`).join(" ");
        database.exec(`CREATE TEMP TRIGGER IF NOT EXISTS search_ocr_review_insert AFTER INSERT ON main.ocr_review_revisions
          BEGIN ${review} END;
          CREATE TEMP TRIGGER IF NOT EXISTS search_ocr_child_outcome AFTER UPDATE OF outcome ON main.runs
          WHEN OLD.workflow='ocr' AND OLD.parent_id IS NOT NULL AND OLD.outcome IS NOT NEW.outcome BEGIN ${host} END;
          CREATE TEMP TRIGGER IF NOT EXISTS search_ocr_child_delete AFTER DELETE ON main.runs
          WHEN OLD.workflow='ocr' AND OLD.parent_id IS NOT NULL BEGIN ${host} END;`);
      }
    },
    register(input: unknown, now: string) {
      const stored = columns(), current = runSearchPublicationOf(stored, buildProgress);
      const affected = new Set<string>();
      for (const declaration of z.array(RunSearchDeclarationSchema).parse(input)) {
        const key = `${declaration.workflow}:${declaration.version}:${declaration.contractFingerprint}`, json = canonicalJsonStringify(declaration);
        const prior = database.prepare("SELECT json FROM search_declarations WHERE id=?").get(key);
        if (prior !== undefined && z.strictObject({json:z.string()}).parse(prior).json !== json) throw new Error("run-search-declaration-conflict");
        if (prior === undefined) database.prepare("INSERT INTO search_declarations VALUES(?,?)").run(key,json);
        const rows = database.prepare("SELECT r.id FROM runs r JOIN run_search s ON s.run_id=r.id WHERE r.workflow=? AND r.descriptor_version=? AND r.contract_fingerprint=? AND s.declaration_json IS NULL").all(declaration.workflow,declaration.version,declaration.contractFingerprint);
        for (const row of rows) affected.add(KeySchema.parse(row).id);
        database.prepare("UPDATE run_search SET declaration_json=? WHERE run_id IN (SELECT id FROM runs WHERE workflow=? AND descriptor_version=? AND contract_fingerprint=?) AND declaration_json IS NULL").run(json,declaration.workflow,declaration.version,declaration.contractFingerprint);
      }
      if (affected.size === 0) return 0;
      if (nextRunSearchState(runSearchStateOf(current, stored.authority_generation), affected.size > 500 ? "register-bulk" : "register") === "invalid") {
        publish({state:"invalid",sourceGeneration:current.sourceGeneration,afterRun:null,rowCount:count()},now);
      } else {
        for (const id of affected) writeId(id,now);
      }
      return affected.size;
    },
    publishChanges(sourceGeneration: number, now: string, prior: RunSearchPublication) {
      if (nextRunSearchState(runSearchStateOf(prior, sourceGeneration - 1), "authority-write") === "invalid") {
        // An explicit chunked rebuild may already have published this transaction's generation.
        // Search stays unavailable until explicit rebuild. Unrelated execution remains authoritative.
        if (publication().sourceGeneration !== sourceGeneration) publish({state:"invalid",sourceGeneration,afterRun:null,rowCount:count()},now);
        database.exec("DELETE FROM search_dirty; DELETE FROM search_ocr_dirty");
        return;
      }
      for (const row of database.prepare("SELECT run_id FROM search_dirty").iterate()) writeId(z.object({ run_id: z.string() }).parse(row).run_id, now);
      publish({ state: "published", sourceGeneration, afterRun: null, rowCount: count() }, now);
      database.exec("DELETE FROM search_dirty; DELETE FROM search_ocr_dirty");
    },
    rebuild(input: unknown, sourceGeneration: number, now: string, readRun: (raw: unknown) => PredecessorRunRecord = runRecordFromRow) {
      const { restart, limit } = RunSearchRebuildRequestSchema.parse(input);
      const prior = publication();
      const state = runSearchStateOf(prior, sourceGeneration);
      // A continuation is refused before it writes; whether its chunk is the last is known only after.
      if (!restart) nextRunSearchState(state, "continue-chunk");
      if (restart) database.exec("UPDATE run_search SET metadata_json=json_remove(metadata_json,'$.buildGeneration'); DELETE FROM run_search WHERE run_id NOT IN (SELECT id FROM runs)");
      const after = restart ? "" : prior.afterRun ?? "";
      const rows = database.prepare(`SELECT id FROM runs WHERE id>? ORDER BY id LIMIT ?`).all(after, limit + 1).map(row => KeySchema.parse(row).id);
      const selected = rows.slice(0, limit);
      for (const id of selected) writeId(id, now, true, readRun);
      const last = rows.length <= limit, next = nextRunSearchState(state, restart ? (last ? "restart-last-chunk" : "restart-chunk") : (last ? "continue-last-chunk" : "continue-chunk"));
      if (next !== "published" && next !== "building") throw new Error(`run-search-rebuild-result-invalid: ${next}`);
      return publish({ state: next, sourceGeneration, afterRun: selected.at(-1) ?? prior.afterRun, rowCount: (restart ? 0 : prior.rowCount) + selected.length }, now);
    },
    search(input: unknown, sourceGeneration: number, includeHistory = false) {
      const request = RunSearchReadRequestSchema.parse(input);
      nextRunSearchState(runSearchStateOf(publicationState(), sourceGeneration), "search");
      const clauses: string[] = [], parameters: (string | number)[] = [];
      const add = (sql: string, ...values: (string | number)[]) => { clauses.push(sql); parameters.push(...values); };
      const { facets, q, scope } = request;
      const fields = { run: "s.id", trace: "s.trace", workflow: "s.workflow", subject: "s.subject", actor: "lower(s.actor)" };
      const stores = includeHistory ? ["main", "history"] : ["main"];
      const childRuns = stores.map(store => `SELECT 1 FROM ${store}.runs r WHERE r.id=s.id AND r.parent_id IS NOT NULL`).join(" UNION ALL ");
      add(`NOT (s.workflow='ocr' AND EXISTS(${childRuns}))`);
      for (const [field, value] of Object.entries({ workflow: facets.workflow, state: facets.state, shape: facets.shape, actor: facets.actor, version: facets.version, failure: facets.failure })) if (value !== undefined) add(`s.${field}=?`, value);
      if (facets.from !== undefined) add("s.local_day>=?", facets.from);
      if (facets.to !== undefined) add("s.local_day<=?", facets.to);
      if (facets.day !== undefined) add("s.enqueued_ms>=? AND s.enqueued_ms<?", Date.parse(facets.day.startsAt), Date.parse(facets.day.endsBefore));
      if (facets.dryRun !== undefined) add("s.dry_run=?", Number(facets.dryRun));
      if (facets.system !== undefined) add("EXISTS(SELECT 1 FROM json_each(s.systems) WHERE value=?)", facets.system);
      if (facets.evidence === "receipt") add("s.receipt=1");
      if (facets.evidence === "failure") add("s.failure IS NOT NULL");
      if (facets.evidence === "diagnostic") add("s.diagnostic=1");
      if (facets.evidence === "none") add("s.receipt=0 AND s.failure IS NULL AND s.diagnostic=0");

      const ocrDigest = hasOcrSubjects && q.length > 0 && (scope === "all" || scope === "subject") ? ocrSubjectDigest(q) : undefined;
      const ocrMatch = "instr(s.ocr_subject_terms,?)>0";
      let searchRows = `SELECT ${searchColumns} FROM run_search r`;
      const searchParameters: string[] = [];
      if (schemaVersion >= RUN_SEARCH_FTS_SCHEMA_VERSION) {
        const facet = facets.subject?.toLowerCase();
        const match = [ftsSubjectMatch(FTS_FIELDS[scope], q, ocrDigest),
          facet === undefined ? undefined : ftsSubjectMatch("subject", facet, ocrSubjectDigest(facet))]
          .filter(part => part !== undefined).join(" AND ");
        if (match !== "") {
          // CROSS JOIN keeps the FTS matches outermost even for a small local store.
          searchRows = stores.map(store => `SELECT ${searchColumns} FROM ${store}.run_search_fts f
            CROSS JOIN ${store}.run_search r ON r.run_id=f.run_id WHERE f.run_search_fts MATCH ?`).join(" UNION ALL ");
          searchParameters.push(...stores.map(() => match));
        }
      }
      if (q.length > 0) {
        const scopedFields = scope === "all" ? Object.values(fields) : [fields[scope]];
        const conditions = scopedFields.map(field => `instr(${field},?)>0`);
        const queryBindings = scopedFields.map(() => q);
        if (ocrDigest !== undefined) {
          conditions.push(ocrMatch);
          queryBindings.push(`|${ocrDigest}|`);
        }
        add(`(${conditions.join(" OR ")})`, ...queryBindings);
      }
      if (facets.subject !== undefined) {
        const subject = facets.subject.toLowerCase();
        if (hasOcrSubjects) add(`(instr(s.subject,?)>0 OR ${ocrMatch})`, subject, `|${ocrSubjectDigest(subject)}|`);
        else add("instr(s.subject,?)>0", subject);
      }
      const where = clauses.join(" AND ");
      const rankParameters: string[] = [];
      const rankClauses = CROSS_DATE_SEARCH_MATCH_ORDER.flatMap((match, rank) => {
        if (scope !== "all" && scope !== match.field) return [];
        rankParameters.push(q);
        const field = fields[match.field];
        const condition = match.strength === "exact" ? `${field}=?` : match.strength === "prefix" ? `substr(${field},1,${String(q.length)})=?` : `instr(${field},?)>0`;
        if (match.field === "subject" && ocrDigest !== undefined) {
          rankParameters.push(`|${String(OCR_SUBJECT_STRENGTH[match.strength])}|${ocrDigest}|`);
          return [`WHEN (${condition} OR ${ocrMatch}) THEN ${String(rank)}`];
        }
        return [`WHEN ${condition} THEN ${String(rank)}`];
      });
      const rank = q.length === 0 ? "0" : `CASE ${rankClauses.join(" ")} ELSE NULL END`;
      const bindings = [...(q.length === 0 ? [] : rankParameters), ...searchParameters, ...parameters];
      const matched = `WITH ranked AS (SELECT id,payload_json,subject,actor,enqueued_ms,${rank} AS match_rank FROM (${searchRows}) s WHERE ${where})`;
      const after = request.after;
      const afterSql = after === undefined ? "" : "AND (match_rank>? OR (match_rank=? AND enqueued_ms<?) OR (match_rank=? AND enqueued_ms=? AND id>?))";
      const cursorBindings = after === undefined ? [] : [after.matchRank, after.matchRank, Date.parse(after.enqueuedAt), after.matchRank, Date.parse(after.enqueuedAt), after.runId];
      const pass = database.prepare(`${matched}, matched AS MATERIALIZED (SELECT * FROM ranked WHERE match_rank IS NOT NULL LIMIT ?),
        page AS (SELECT id,payload_json,match_rank,enqueued_ms FROM matched WHERE 1=1 ${afterSql} ORDER BY match_rank,enqueued_ms DESC,id LIMIT ?)
        SELECT 'row' AS kind,json_object('id',id,'payload_json',payload_json,'match_rank',match_rank) AS payload,match_rank,enqueued_ms,id FROM page
        UNION ALL SELECT 'summary',json_object('count',count(*),'subject_missing',COALESCE(sum(subject IS NULL),0),'actor_missing',COALESCE(sum(actor IS NULL),0)),NULL,NULL,NULL FROM matched
        ORDER BY kind,match_rank,enqueued_ms DESC,id`).all(...bindings, LIMIT + 1, ...cursorBindings, request.limit)
        .map(row => z.object({ kind: z.enum(["row", "summary"]), payload: z.string() }).parse(row));
      const summary = pass.find(row => row.kind === "summary");
      if (summary === undefined) throw new Error("run-search-summary-missing");
      const coverage = z.object({ count: z.number().int(), subject_missing: z.number().int(), actor_missing: z.number().int() }).parse(JSON.parse(summary.payload));
      if (coverage.count > LIMIT) throw new Error("run-search-query-too-broad: narrow dates or metadata filters (maximum 10000 candidates)");
      const rows = pass.filter(row => row.kind === "row").map(row => {
        const indexed = IndexRowSchema.parse(JSON.parse(row.payload));

        const source = database.prepare("SELECT * FROM runs WHERE id=?").get(indexed.id);
        if (source === undefined) throw new Error("run-search-source-missing");
        const record = runRecordFromRow(source);
        const metadata = runSearchIndexFromRow(database.prepare("SELECT * FROM run_search WHERE run_id=?").get(indexed.id),record);
        if (indexed.payload_json !== canonicalJsonStringify(metadata)) throw new Error("run-search-index-corrupt");
        return { record, metadata: metadata.metadata, matchRank: indexed.match_rank };
      });
      return { totalMatches: coverage.count, coverage: { matched: coverage.count, subjectUnavailable: coverage.subject_missing, actorUnavailable: coverage.actor_missing, candidateLimit: LIMIT }, rows };
    },
  };
}

/** Rebinds a known predecessor snapshot against complete canonical contributing sources supplied by the stopped owner. */
export function rebindAssistantM1RunSearchRow(input: unknown, run: PredecessorRunRecord, queuedEvents: readonly unknown[], commandPairs: readonly Readonly<{ command: unknown; audit: unknown }>[]) {
  const row = FullIndexRowSchema.parse(input);
  runSearchIndexFromRow(row, run);
  const sources = row.actor_source_json === null ? [] : ActorSourcesSchema.parse(JSON.parse(row.actor_source_json));
  const canonical: z.infer<typeof ActorSourcesSchema> = queuedEvents.map(event => ({ kind: "queued", event: TimelineEventRecordSchema.parse(event) }));
  const nextAudits = new Map<string, z.infer<typeof AssistantM1NativeCommandAuditSchema>>();
  for (const pair of commandPairs) {
    const converted = convertAssistantCommandPairToM1(pair.command, pair.audit);
    if (converted.audit === null) throw new Error("run-search-audit-source-missing");
    const audit = AssistantM1NativeCommandAuditSchema.parse(JSON.parse(converted.audit.payload_json));
    const { attribution: _attribution, ...before } = audit;
    canonical.push({ kind: "start-audit", audit: CommandAuditRecordSchema.parse(before) });
    if (nextAudits.has(audit.auditId)) throw new Error("run-search-audit-source-duplicate");
    nextAudits.set(audit.auditId, audit);
  }
  sourceActors(canonical, run);
  const key = (source: z.infer<typeof ActorSourcesSchema>[number]) => source.kind === "queued" ? `queued:${source.event.eventId}` : `audit:${source.audit.auditId}`;
  const expected = new Map(canonical.map(source => [key(source), canonicalJsonStringify(source)]));
  if (expected.size !== canonical.length || new Set(sources.map(key)).size !== sources.length || sources.length !== canonical.length
    || sources.some(source => expected.get(key(source)) !== canonicalJsonStringify(source))) throw new Error("run-search-actor-source-mismatch");
  if (sources.length === 0) return row;
  return { ...row, actor_source_json: canonicalJsonStringify(sources.map(source => {
    if (source.kind === "queued") return source;
    const audit = nextAudits.get(source.audit.auditId);
    if (audit === undefined) throw new Error("run-search-audit-source-missing");
    return { kind: "start-audit", audit };
  })) };
}
