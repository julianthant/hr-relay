import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import { searchPartitionDay } from "../../domain/dashboard/search-calendar.js";
import { TimelineEventRecordSchema } from "../../events/timeline.js";
import { ActorIdSchema } from "../../domain/ids.js";
import { RunRecordSchema, type RunRecord } from "../../domain/run/record.js";
import { RunCheckpointRecordSchema } from "../../domain/workflow/checkpoint.js";
import { FailureRecordSchema } from "../../domain/trust/failure.js";
import { CROSS_DATE_SEARCH_MATCH_ORDER, SearchMetadataSchema } from "../../domain/dashboard/search.js";
import { RunSearchDeclarationSchema, RunSearchIndexRecordSchema, RunSearchPublicationSchema, RunSearchReadRequestSchema, RunSearchRebuildRequestSchema } from "../../domain/dashboard/search-index.js";
import { unarchivedRunSql } from "./archive-compatibility.js";

export const RUN_SEARCH_INDEX_DDL = `CREATE TABLE run_search_index (
 record_key TEXT PRIMARY KEY, workflow TEXT NOT NULL, trace TEXT NOT NULL, local_day TEXT NOT NULL,
 state TEXT NOT NULL, shape TEXT NOT NULL, dry_run INTEGER NOT NULL, enqueued_ms INTEGER NOT NULL,
 subject TEXT, actor TEXT, version INTEGER NOT NULL, failure TEXT, receipt INTEGER NOT NULL,
 diagnostic INTEGER NOT NULL, systems TEXT NOT NULL, record_json TEXT NOT NULL CHECK(json_valid(record_json)), created_at TEXT NOT NULL
) STRICT`;
export const RUN_SEARCH_GRAMS_DDL = `CREATE TABLE run_search_grams (
 record_key TEXT PRIMARY KEY, token TEXT NOT NULL, run_id TEXT NOT NULL REFERENCES run_search_index(record_key) ON DELETE CASCADE,
 record_json TEXT NOT NULL CHECK(json_valid(record_json)), created_at TEXT NOT NULL
) STRICT`;
export const RUN_SEARCH_PUBLICATION_DDL = `CREATE TABLE run_search_publication (
 record_key TEXT PRIMARY KEY CHECK(record_key='current'), record_json TEXT NOT NULL CHECK(json_valid(record_json)), created_at TEXT NOT NULL
) STRICT`;
export const RUN_SEARCH_DECLARATIONS_DDL = `CREATE TABLE run_search_declarations (
 record_key TEXT PRIMARY KEY, record_json TEXT NOT NULL CHECK(json_valid(record_json)), created_at TEXT NOT NULL
) STRICT`;
export const RUN_SEARCH_ACTORS_DDL = `CREATE TABLE run_search_actors (
 record_key TEXT PRIMARY KEY, run_id TEXT NOT NULL, record_json TEXT NOT NULL CHECK(json_valid(record_json)), created_at TEXT NOT NULL
) STRICT`;
const INVALIDATE = "UPDATE run_search_publication SET record_json=json_set(record_json,'$.state','invalid');";
export const RUN_SEARCH_INDEX_CONSTRAINTS = [
  "CREATE INDEX run_search_gram_token_idx ON run_search_grams(token,run_id)",
  "CREATE INDEX run_search_day_idx ON run_search_index(local_day,record_key)",
  ...["workflow", "state", "actor", "version", "failure", "shape", "dry_run"].map(field => `CREATE INDEX run_search_${field}_idx ON run_search_index(${field},local_day,record_key)`),
  "CREATE INDEX run_search_actor_owner_idx ON run_search_actors(run_id)",
  ...["INSERT", "UPDATE", "DELETE"].map(action => `CREATE TRIGGER search_invalidate_timeline_${action} AFTER ${action} ON timeline_events WHEN json_extract(${action === "DELETE" ? "OLD" : "NEW"}.record_json,'$.payload.event.t')='run.queued' BEGIN ${INVALIDATE} END`),
  ...["workflow_runs", "run_checkpoints", "run_receipts", "run_failures", "diagnostic_snapshots", "archive_transfers", "command_audits", "run_search_index", "run_search_grams", "run_search_declarations", "run_search_actors"].flatMap(table => ["INSERT", "UPDATE", "DELETE"].map(action =>
    `CREATE TRIGGER search_invalidate_${table}_${action} AFTER ${action} ON ${table} BEGIN ${INVALIDATE} END`)),
];
const JsonRowSchema = z.object({ record_json: z.string() });
const CountSchema = z.object({ count: z.number().int().nonnegative() });
const KeySchema = z.object({ record_key: z.string() });
const IndexRowSchema = z.object({ record_key: z.string(), record_json: z.string(), match_rank: z.number().int().nonnegative() });
const publicationKey = "current";
const LIMIT = 10000;
function parse<T>(schema: z.ZodType<T>, row: unknown): T { return schema.parse(JSON.parse(JsonRowSchema.parse(row).record_json)); }
function tokens(text: string): Set<string> {
  const result = new Set<string>();
  for (let size = 1; size <= 3; size++) for (let at = 0; at + size <= text.length; at++) result.add(text.slice(at, at + size));
  return result;
}
function declarationKey(run: RunRecord): string {
  return `${run.envelope.workflow}:${String(run.envelope.descriptorVersion)}:${run.envelope.contractFingerprint}`;
}
function safeSubject(database: DatabaseSync, run: RunRecord): z.infer<typeof SearchMetadataSchema>["subject"] {
  const raw = database.prepare("SELECT record_json FROM run_search_declarations WHERE record_key=?").get(declarationKey(run));
  if (raw === undefined) return { state: "unavailable", reason: "declaration-unavailable" };
  const { subjectProjection } = parse(RunSearchDeclarationSchema, raw);
  if (subjectProjection === null) return { state: "unavailable", reason: "subject-unavailable" };
  const checkpoint = database.prepare(`SELECT record_json FROM run_checkpoints WHERE run_id=? AND node_id=? ORDER BY attempt DESC,claim_generation DESC LIMIT 1`)
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

export function createRunSearchIndex(database: DatabaseSync) {
  const publication = () => {
    const row = database.prepare("SELECT record_json FROM run_search_publication WHERE record_key=?").get(publicationKey);
    if (row === undefined) throw new Error("run-search-index-missing");
    try { return parse(RunSearchPublicationSchema, row); } catch { throw new Error("run-search-index-corrupt"); }
  };
  const publish = (value: z.input<typeof RunSearchPublicationSchema>, now: string) => {
    const parsed = RunSearchPublicationSchema.parse(value);
    database.prepare("INSERT INTO run_search_publication VALUES ('current',?,?) ON CONFLICT(record_key) DO UPDATE SET record_json=excluded.record_json,created_at=excluded.created_at").run(canonicalJsonStringify(parsed), now);
    return parsed;
  };
  const count = () => CountSchema.parse(database.prepare("SELECT count(*) AS count FROM run_search_index").get()).count;
  const write = (run: RunRecord, now: string) => {
    const id = run.envelope.runId;
    const actors = database.prepare("SELECT json_extract(record_json,'$.actor') AS actor FROM run_search_actors WHERE run_id=?").all(id).map(row => z.object({ actor: z.string() }).parse(row).actor);
    const queuedEvents = database.prepare("SELECT record_json FROM timeline_events WHERE run_id=? AND json_extract(record_json,'$.payload.event.t')='run.queued' ORDER BY cursor LIMIT 2").all(id);
    for (const raw of queuedEvents) {
      const event = parse(TimelineEventRecordSchema, raw);
      if (event.payload.kind !== "span" || event.payload.event.t !== "run.queued") throw new Error("run-search-actor-source-invalid");
      const actor = ActorIdSchema.parse(event.payload.event.actorId);
      actors.push(actor);
    }
    if (new Set(actors).size > 1) throw new Error("run-search-actor-ambiguous");
    for (const actor of actors) database.prepare("INSERT OR IGNORE INTO run_search_actors VALUES (?,?,?,?)").run(`${id}:recorded`, id, canonicalJsonStringify({ runId: id, actor, sourceId: "recorded-run-queued" }), now);
    const failureRow = database.prepare("SELECT record_json FROM run_failures WHERE run_id=?").get(id);
    const failure = failureRow === undefined ? null : parse(FailureRecordSchema, failureRow);
    const exists = (table: string) => database.prepare(`SELECT 1 FROM ${table} WHERE run_id=? LIMIT 1`).get(id) !== undefined;
    const metadata = SearchMetadataSchema.parse({ subject: safeSubject(database, run),
      actor: actors.length === 0 ? { state: "unavailable", reason: "not-recorded" } : { state: "available", value: actors[0] },
      version: run.envelope.descriptorVersion, failureCode: failure?.code ?? null,
      evidence: { receipt: exists("run_receipts"), failure: failure !== null, diagnostic: exists("diagnostic_snapshots") } });
    const record = RunSearchIndexRecordSchema.parse({ runId: id, sourceVersion: run.version, metadata });
    const subject = metadata.subject.state === "available" ? metadata.subject.value.toLowerCase() : null;
    const actor = metadata.actor.state === "available" ? metadata.actor.value : null;
    database.prepare("DELETE FROM run_search_index WHERE record_key=?").run(id);
    database.prepare("INSERT INTO run_search_index VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
      id, run.envelope.workflow, run.envelope.traceId.toLowerCase(), searchPartitionDay(new Date(run.envelope.enqueuedAt)),
      run.lifecycle.state === "terminal" ? run.lifecycle.outcome : run.lifecycle.state, run.envelope.shape, Number(run.envelope.dryRun), Date.parse(run.envelope.enqueuedAt),
      subject, actor, metadata.version, metadata.failureCode, Number(metadata.evidence.receipt), Number(metadata.evidence.diagnostic),
      `,${Object.keys(run.envelope.resolvedInstance).sort().join(",")},`, canonicalJsonStringify(record), now,
    );
    const grams = new Set([id, run.envelope.traceId, run.envelope.workflow, subject ?? "", actor ?? ""].flatMap(text => [...tokens(text.toLowerCase())]));
    const insert = database.prepare("INSERT INTO run_search_grams VALUES (?,?,?,?,?)");
    for (const token of grams) insert.run(`${id}:${token}`, token, id, canonicalJsonStringify({ token, runId: id }), now);
  };
  const writeId = (id: string, now: string) => {
    const raw = database.prepare(`SELECT record_key,workflow,state,priority,created_at,record_json FROM workflow_runs WHERE record_key=? AND ${unarchivedRunSql(database,"workflow_runs.record_key")}`).get(id);
    if (raw === undefined) database.prepare("DELETE FROM run_search_index WHERE record_key=?").run(id);
    else { try {
      const run = parse(RunRecordSchema, raw);
      const columns = z.object({ record_key: z.string(), workflow: z.string(), state: z.string(), priority: z.string(), created_at: z.string() }).parse(raw);
      if (columns.record_key !== run.envelope.runId || columns.workflow !== run.envelope.workflow || columns.state !== run.lifecycle.state
        || columns.priority !== run.envelope.priority || Date.parse(columns.created_at) !== Date.parse(run.envelope.enqueuedAt)
        || Date.parse(run.createdAt) !== Date.parse(run.envelope.enqueuedAt)) throw new Error("run-search-source-columns-corrupt");
      write(run, now);
    } catch (cause) { throw new Error("run-search-publication-invalid", { cause }); } }
  };
  return {
    publication,
    initialize(sourceGeneration: number, now: string) { return publish({ state: "published", sourceGeneration, afterRun: null, rowCount: 0 }, now); },
    installTracking() {
      database.exec("CREATE TEMP TABLE IF NOT EXISTS search_dirty (run_id TEXT PRIMARY KEY) WITHOUT ROWID");
      database.exec("CREATE TEMP TABLE IF NOT EXISTS search_rebuild_required (id INTEGER PRIMARY KEY CHECK(id=1))");
      const sources: Record<string, string> = { workflow_runs: "$.envelope.runId", run_checkpoints: "$.runId", run_receipts: "$.runId", run_failures: "$.runId", diagnostic_snapshots: "$.runId", archive_transfers: "$.run.envelope.runId", timeline_events: "$.scope.runId" };
      for (const [table, path] of Object.entries(sources)) for (const action of ["INSERT", "UPDATE", "DELETE"]) {
        const refs = action === "INSERT" ? ["NEW"] : action === "DELETE" ? ["OLD"] : ["OLD", "NEW"];
        database.exec(`CREATE TEMP TRIGGER IF NOT EXISTS search_dirty_${table}_${action} AFTER ${action} ON main.${table}${table === "timeline_events" ? ` WHEN json_extract(${action === "DELETE" ? "OLD" : "NEW"}.record_json,'$.payload.event.t')='run.queued'` : ""} BEGIN ${refs.map(ref => `INSERT OR IGNORE INTO search_dirty SELECT json_extract(${ref}.record_json,'${path}') WHERE json_extract(${ref}.record_json,'${path}') IS NOT NULL;`).join(" ")} END`);
      }
      // Accepted start audit is the authentic attribution link. No requester backfill.
      database.exec(`CREATE TEMP TRIGGER IF NOT EXISTS search_start_actor AFTER INSERT ON main.command_audits
        WHEN json_extract(NEW.record_json,'$.request.family')='start' AND json_extract(NEW.record_json,'$.result.state') IN ('applied','already-applied')
        BEGIN
          INSERT OR IGNORE INTO run_search_actors SELECT json_extract(value,'$.runId') || ':' || json_extract(NEW.record_json,'$.request.commandId'), json_extract(value,'$.runId'),
            json_object('runId',json_extract(value,'$.runId'),'actor',json_extract(NEW.record_json,'$.request.requestedBy'),'sourceId',json_extract(NEW.record_json,'$.request.commandId')),NEW.created_at
            FROM json_each(NEW.record_json,'$.result.affectedTargets') WHERE json_extract(value,'$.family')='run';
          INSERT OR IGNORE INTO search_dirty SELECT json_extract(value,'$.runId') FROM json_each(NEW.record_json,'$.result.affectedTargets') WHERE json_extract(value,'$.family')='run';
        END`);
    },
    register(input: unknown, now: string) {
      const declarations = z.array(RunSearchDeclarationSchema).parse(input);
      let changes = 0;
      for (const declaration of declarations) {
        const key = `${declaration.workflow}:${String(declaration.version)}:${declaration.contractFingerprint}`;
        const existing = database.prepare("SELECT record_json FROM run_search_declarations WHERE record_key=?").get(key);
        if (existing !== undefined) {
          if (canonicalJsonStringify(parse(RunSearchDeclarationSchema, existing)) !== canonicalJsonStringify(declaration)) throw new Error("run-search-declaration-conflict");
          continue;
        }
        database.prepare("INSERT INTO run_search_declarations VALUES (?,?,?)").run(key, canonicalJsonStringify(declaration), now);
        const affected=database.prepare("SELECT record_key FROM workflow_runs WHERE workflow=? LIMIT 501").all(declaration.workflow);
        if(affected.length>500)database.exec("INSERT OR IGNORE INTO search_rebuild_required VALUES(1)");
        else for(const row of affected)database.prepare("INSERT OR IGNORE INTO search_dirty VALUES(?)").run(KeySchema.parse(row).record_key);
        changes++;
      }
      return changes;
    },
    publishChanges(sourceGeneration: number, now: string, prior: z.infer<typeof RunSearchPublicationSchema>) {
      if(database.prepare("SELECT 1 FROM search_rebuild_required").get()!==undefined) {
        publish({state:"invalid",sourceGeneration,afterRun:null,rowCount:count()},now);
        database.exec("DELETE FROM search_rebuild_required; DELETE FROM search_dirty");return;
      }
      if (prior.state !== "published" || prior.sourceGeneration !== sourceGeneration - 1) {
        // An explicit chunked rebuild may already have published this transaction's generation.
        // Search stays unavailable until explicit rebuild. Unrelated execution remains authoritative.
        if (publication().sourceGeneration !== sourceGeneration) publish({state:"invalid",sourceGeneration,afterRun:null,rowCount:count()},now);
        database.exec("DELETE FROM search_dirty");
        return;
      }
      for (const row of database.prepare("SELECT run_id FROM search_dirty").iterate()) writeId(z.object({ run_id: z.string() }).parse(row).run_id, now);
      publish({ state: "published", sourceGeneration, afterRun: null, rowCount: count() }, now);
      database.exec("DELETE FROM search_dirty");
    },
    rebuild(input: unknown, sourceGeneration: number, now: string) {
      const { restart, limit } = RunSearchRebuildRequestSchema.parse(input);
      const prior = publication();
      if (!restart && (prior.state !== "building" || prior.sourceGeneration !== sourceGeneration - 1 && prior.sourceGeneration !== sourceGeneration)) throw new Error("run-search-rebuild-restart-required");
      if (restart) database.exec("DELETE FROM run_search_index");
      const after = restart ? "" : prior.afterRun ?? "";
      const rows = database.prepare(`SELECT record_key FROM workflow_runs WHERE record_key>? AND ${unarchivedRunSql(database,"workflow_runs.record_key")} ORDER BY record_key LIMIT ?`).all(after, limit + 1).map(row => KeySchema.parse(row).record_key);
      const selected = rows.slice(0, limit);
      for (const id of selected) writeId(id, now);
      return publish({ state: rows.length > limit ? "building" : "published", sourceGeneration, afterRun: selected.at(-1) ?? prior.afterRun, rowCount: count() }, now);
    },
    search(input: unknown, sourceGeneration: number) {
      const request = RunSearchReadRequestSchema.parse(input);
      const current = publication();
      if (current.state !== "published" || current.sourceGeneration !== sourceGeneration) throw new Error("run-search-index-rebuild-required");
      const clauses: string[] = [], parameters: (string | number)[] = [];
      const add = (sql: string, ...values: (string | number)[]) => { clauses.push(sql); parameters.push(...values); };
      const { facets, q } = request;
      if (q.length > 0) add("s.record_key IN (SELECT run_id FROM run_search_grams WHERE token=?)", q.slice(0, 3));
      for (const [field, value] of Object.entries({ workflow: facets.workflow, state: facets.state, shape: facets.shape, actor: facets.actor, version: facets.version, failure: facets.failure })) if (value !== undefined) add(`s.${field}=?`, value);
      if (facets.from !== undefined) add("s.local_day>=?", facets.from);
      if (facets.to !== undefined) add("s.local_day<=?", facets.to);
      if (facets.day !== undefined) add("s.enqueued_ms>=? AND s.enqueued_ms<?", Date.parse(facets.day.startsAt), Date.parse(facets.day.endsBefore));
      if (facets.dryRun !== undefined) add("s.dry_run=?", Number(facets.dryRun));
      if (facets.system !== undefined) add("instr(s.systems,?)>0", `,${facets.system},`);
      if (facets.subject !== undefined) { add("s.record_key IN (SELECT run_id FROM run_search_grams WHERE token=?)", facets.subject.toLowerCase().slice(0,3)); add("instr(s.subject,?)>0", facets.subject.toLowerCase()); }
      if (facets.evidence === "receipt") add("s.receipt=1");
      if (facets.evidence === "failure") add("s.failure IS NOT NULL");
      if (facets.evidence === "diagnostic") add("s.diagnostic=1");
      if (facets.evidence === "none") add("s.receipt=0 AND s.failure IS NULL AND s.diagnostic=0");
      const where = clauses.length === 0 ? "1" : clauses.join(" AND ");
      const candidateCount = CountSchema.parse(database.prepare(`SELECT count(*) AS count FROM (SELECT 1 FROM run_search_index s WHERE ${where} LIMIT ?)`)
        .get(...parameters, LIMIT + 1)).count;
      if (candidateCount > LIMIT) throw new Error("run-search-query-too-broad: narrow dates or metadata filters (maximum 10000 candidates)");
      const fields = { run: "s.record_key", trace: "s.trace", workflow: "s.workflow", subject: "s.subject", actor: "lower(s.actor)" };
      const rankParameters: string[] = [];
      const rankClauses = CROSS_DATE_SEARCH_MATCH_ORDER.flatMap((match, rank) => {
        if (request.scope !== "all" && request.scope !== match.field) return [];
        rankParameters.push(q);
        const field = fields[match.field];
        const condition = match.strength === "exact" ? `${field}=?` : match.strength === "prefix" ? `substr(${field},1,${String(q.length)})=?` : `instr(${field},?)>0`;
        return [`WHEN ${condition} THEN ${String(rank)}`];
      });
      const rank = q.length === 0 ? "0" : `CASE ${rankClauses.join(" ")} ELSE NULL END`;
      const bindings = q.length === 0 ? parameters : [...rankParameters, ...parameters];
      const matched = `WITH ranked AS (SELECT s.*,${rank} AS match_rank FROM run_search_index s WHERE ${where})`;
      const after = request.after;
      const afterSql = after === undefined ? "" : "AND (match_rank>? OR (match_rank=? AND enqueued_ms<?) OR (match_rank=? AND enqueued_ms=? AND record_key>?))";
      const cursorBindings = after === undefined ? [] : [after.matchRank, after.matchRank, Date.parse(after.enqueuedAt), after.matchRank, Date.parse(after.enqueuedAt), after.runId];
      const pass = database.prepare(`${matched}, matched AS MATERIALIZED (SELECT * FROM ranked WHERE match_rank IS NOT NULL),
        page AS (SELECT record_key,record_json,match_rank,enqueued_ms FROM matched WHERE 1=1 ${afterSql} ORDER BY match_rank,enqueued_ms DESC,record_key LIMIT ?)
        SELECT 'row' AS kind,json_object('record_key',record_key,'record_json',record_json,'match_rank',match_rank) AS payload,match_rank,enqueued_ms,record_key FROM page
        UNION ALL SELECT 'summary',json_object('count',count(*),'subject_missing',COALESCE(sum(subject IS NULL),0),'actor_missing',COALESCE(sum(actor IS NULL),0)),NULL,NULL,NULL FROM matched
        ORDER BY kind,match_rank,enqueued_ms DESC,record_key`).all(...bindings, ...cursorBindings, request.limit)
        .map(row => z.object({ kind: z.enum(["row", "summary"]), payload: z.string() }).parse(row));
      const summary = pass.find(row => row.kind === "summary");
      if (summary === undefined) throw new Error("run-search-summary-missing");
      const coverage = z.object({ count: z.number().int(), subject_missing: z.number().int(), actor_missing: z.number().int() }).parse(JSON.parse(summary.payload));
      const rows = pass.filter(row => row.kind === "row").map(row => {
        const indexed = IndexRowSchema.parse(JSON.parse(row.payload));
        const metadata = parse(RunSearchIndexRecordSchema, indexed);
        const source = database.prepare("SELECT record_json FROM workflow_runs WHERE record_key=?").get(indexed.record_key);
        if (source === undefined) throw new Error("run-search-source-missing");
        const record = parse(RunRecordSchema, source);
        if (record.version !== metadata.sourceVersion || record.envelope.runId !== metadata.runId) throw new Error("run-search-index-corrupt");
        return { record, metadata: metadata.metadata, matchRank: indexed.match_rank };
      });
      return { totalMatches: coverage.count, coverage: { matched: coverage.count, subjectUnavailable: coverage.subject_missing, actorUnavailable: coverage.actor_missing, candidateLimit: LIMIT }, rows };
    },
  };
}

/** Explicit stopped-upgrade backfill; absent actors stay absent. Source audits remain immutable. */
export const RUN_SEARCH_ACTOR_BACKFILL_SQL = [
  `INSERT OR IGNORE INTO run_search_actors SELECT json_extract(target.value,'$.runId') || ':' || json_extract(a.record_json,'$.request.commandId'),json_extract(target.value,'$.runId'),
    json_object('runId',json_extract(target.value,'$.runId'),'actor',json_extract(a.record_json,'$.request.requestedBy'),'sourceId',json_extract(a.record_json,'$.request.commandId')),a.created_at
    FROM command_audits a,json_each(a.record_json,'$.result.affectedTargets') target
    WHERE json_extract(a.record_json,'$.request.family')='start' AND json_extract(a.record_json,'$.result.state') IN ('applied','already-applied')
      AND json_extract(target.value,'$.family')='run' AND json_type(a.record_json,'$.request.requestedBy')='text'`,
  `INSERT OR IGNORE INTO run_search_actors SELECT run_id || ':' || record_key,run_id,
    json_object('runId',run_id,'actor',json_extract(record_json,'$.payload.event.actorId'),'sourceId',record_key),created_at FROM timeline_events
    WHERE json_extract(record_json,'$.payload.event.t')='run.queued' AND json_type(record_json,'$.payload.event.actorId')='text'`,
];

/** Called only by the explicit stopped conversion, with its transaction and backup custody. */
export function rebuildRunSearchForUpgrade(database: DatabaseSync, generation: number, now: string): void {
  const index = createRunSearchIndex(database);
  let progress = index.rebuild({ restart: true, limit: 500 }, generation, now);
  while (progress.state === "building") progress = index.rebuild({ limit: 500 }, generation, now);
}
