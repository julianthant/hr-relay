import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { searchPartitionDay } from "../../../models/dashboard/search-calendar.js";
import { TimelineEventRecordSchema } from "../../../models/events/timeline.js";
import { ActorIdSchema } from "../../../rules/identity/ids.js";
import { type RunRecord } from "../../../models/run/record.js";
import { RunCheckpointRecordSchema } from "../../../models/workflow/checkpoint.js";
import { FailureRecordSchema } from "../../../models/trust/failure.js";
import { CROSS_DATE_SEARCH_MATCH_ORDER, SearchMetadataSchema } from "../../../models/dashboard/search.js";
import { RunSearchDeclarationSchema, RunSearchIndexRecordSchema, RunSearchPublicationSchema, RunSearchReadRequestSchema, RunSearchRebuildRequestSchema } from "../../../models/dashboard/search-index.js";

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
function sourceActors(sources: z.infer<typeof ActorSourcesSchema>, run: RunRecord) {
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
  declaration_json:z.string().nullable(),actor_source_json:z.string().nullable(),metadata_json:z.string(),created_at:z.string(),updated_at:z.string() });
export function runSearchIndexFromRow(input: unknown, run: RunRecord, requireCurrent = true) {
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
const LIMIT = 10000;
function parse<T>(schema: z.ZodType<T>, row: unknown): T { return schema.parse(JSON.parse(JsonRowSchema.parse(row).payload_json)); }
function declarationKey(run: RunRecord): string {
  return `${run.envelope.workflow}:${String(run.envelope.descriptorVersion)}:${run.envelope.contractFingerprint}`;
}
function safeSubject(database: DatabaseSync, run: RunRecord, declaration: z.infer<typeof RunSearchDeclarationSchema> | null): z.infer<typeof SearchMetadataSchema>["subject"] {
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

export function createRunSearchIndex(database: DatabaseSync) {
  const prepareTemporaryState = () => {
    database.exec("CREATE TEMP TABLE IF NOT EXISTS search_actor_dirty(run_id TEXT PRIMARY KEY) WITHOUT ROWID");
    database.exec("CREATE TEMP TABLE IF NOT EXISTS search_declarations(id TEXT PRIMARY KEY,json TEXT NOT NULL) WITHOUT ROWID");
  };
  const count = () => CountSchema.parse(database.prepare("SELECT count(*) AS count FROM run_search").get()).count;
  const publication = () => {
    const row = z.strictObject({authority_generation:z.number().int(),search_generation:z.number().int().nullable(),search_state:z.enum(["unbuilt","ready","invalid"])}).parse(
      database.prepare("SELECT authority_generation,search_generation,search_state FROM database_states WHERE id=1").get());
    if (row.search_state === "invalid" && row.search_generation !== null) {
      const progress = z.strictObject({count:z.number().int().nonnegative(),after_run:z.string().nullable()}).parse(database.prepare("SELECT count(*) AS count,max(run_id) AS after_run FROM run_search WHERE json_extract(metadata_json,'$.buildGeneration')=?").get(row.search_generation));
      return RunSearchPublicationSchema.parse({state:"building",sourceGeneration:row.search_generation,afterRun:progress.after_run,rowCount:progress.count});
    }
    return RunSearchPublicationSchema.parse({state:row.search_state === "ready" ? "published" : "invalid",sourceGeneration:row.search_generation ?? row.authority_generation,afterRun:null,rowCount:count()});
  };
  const publish = (value: z.input<typeof RunSearchPublicationSchema>, _now: string) => {
    const parsed = RunSearchPublicationSchema.parse(value);
    database.prepare("UPDATE database_states SET search_generation=?,search_state=? WHERE id=1").run(parsed.state === "invalid" ? null : parsed.sourceGeneration,parsed.state === "published" ? "ready" : "invalid");
    return parsed;
  };
  const retainedActorSources = (run: RunRecord): z.infer<typeof ActorSourcesSchema> => {
    const id = run.envelope.runId;
    const sources: z.infer<typeof ActorSourcesSchema> = [];
    for (const raw of database.prepare("SELECT payload_json FROM timeline_events WHERE run_id=? AND json_extract(payload_json,'$.payload.event.t')='run.queued' ORDER BY cursor").all(id)) sources.push({kind:"queued",event:parse(TimelineEventRecordSchema,raw)});
    for (const raw of database.prepare("SELECT payload_json FROM command_audits WHERE json_extract(payload_json,'$.request.family')='start' AND json_extract(payload_json,'$.result.state') IN ('applied','already-applied') AND EXISTS(SELECT 1 FROM json_each(payload_json,'$.result.affectedTargets') target WHERE json_extract(target.value,'$.family')='run' AND json_extract(target.value,'$.runId')=?) ORDER BY id").all(id)) sources.push({kind:"start-audit",audit:parse(CommandAuditRecordSchema,raw)});
    sourceActors(sources,run);
    return sources;
  };
  const actorSourceKey = (source: z.infer<typeof ActorSourcesSchema>[number]) => source.kind === "queued" ? `queued:${source.event.eventId}` : `start-audit:${source.audit.auditId}`;
  const validateActorSources = (run: RunRecord, sources: z.infer<typeof ActorSourcesSchema>, retained = retainedActorSources(run)) => {
    const frozen = new Map(sources.map(source => [actorSourceKey(source),source]));
    if (frozen.size !== sources.length) throw new Error("run-search-actor-source-duplicate");
    const actual = new Map(retained.map(source => [actorSourceKey(source),source]));
    for (const source of retained) if (frozen.get(actorSourceKey(source)) === undefined || canonicalJsonStringify(frozen.get(actorSourceKey(source))) !== canonicalJsonStringify(source)) throw new Error("run-search-retained-actor-source-mismatch");
    for (const source of sources) if (!actual.has(actorSourceKey(source))) throw new Error("run-search-retained-actor-source-missing");
  };
  const metadataFor = (run: RunRecord, declaration: z.infer<typeof RunSearchDeclarationSchema> | null, sources: z.infer<typeof ActorSourcesSchema>) => {
    const id = run.envelope.runId;
    const actors = sourceActors(sources, run);
    const failureRow = database.prepare("SELECT payload_json FROM run_failures WHERE run_id=?").get(id);
    const failure = failureRow === undefined ? null : parse(FailureRecordSchema, failureRow);
    const exists = (table: string) => database.prepare(`SELECT 1 FROM ${table} WHERE run_id=? LIMIT 1`).get(id) !== undefined;
    return SearchMetadataSchema.parse({ subject: safeSubject(database, run, declaration),
      actor: actors.length === 0 ? { state: "unavailable", reason: "not-recorded" } : { state: "available", value: actors[0] },
      version: run.envelope.descriptorVersion, failureCode: failure?.code ?? null,
      evidence: { receipt: exists("run_receipts"), failure: failure !== null, diagnostic: exists("diagnostic_snapshots") } });
  };
  const validateCoverage = () => {
    const current = publication();
    if (current.state === "invalid") return;
    if (current.state === "building") {
      if (database.prepare("SELECT 1 FROM runs r LEFT JOIN run_search s ON s.run_id=r.id AND json_extract(s.metadata_json,'$.buildGeneration')=? WHERE r.id<=? AND s.run_id IS NULL LIMIT 1").get(current.sourceGeneration,current.afterRun) !== undefined) throw new Error("run-search-build-prefix-invalid");
    } else if (database.prepare("SELECT 1 FROM runs r LEFT JOIN run_search s ON s.run_id=r.id WHERE s.run_id IS NULL LIMIT 1").get() !== undefined
      || database.prepare("SELECT 1 FROM run_search s LEFT JOIN runs r ON r.id=s.run_id WHERE r.id IS NULL LIMIT 1").get() !== undefined) throw new Error("run-search-source-coverage-invalid");
    const rows = current.state === "building"
      ? database.prepare("SELECT * FROM run_search WHERE json_extract(metadata_json,'$.buildGeneration')=? ORDER BY run_id").iterate(current.sourceGeneration)
      : database.prepare("SELECT * FROM run_search ORDER BY run_id").iterate();
    for (const raw of rows) {
      const indexed = FullIndexRowSchema.parse(raw);
      const run = runRecordFromRow(database.prepare("SELECT * FROM runs WHERE id=?").get(indexed.run_id));
      const record = runSearchIndexFromRow(raw, run);
      const declaration = indexed.declaration_json === null ? null : RunSearchDeclarationSchema.parse(JSON.parse(indexed.declaration_json));
      const sources = indexed.actor_source_json === null ? [] : ActorSourcesSchema.parse(JSON.parse(indexed.actor_source_json));
      validateActorSources(run,sources);
      if (canonicalJsonStringify(record.metadata) !== canonicalJsonStringify(metadataFor(run, declaration, sources))) throw new Error("run-search-source-metadata-invalid");
    }
  };
  const write = (run: RunRecord, now: string, rebuilding = false) => {
    const id = run.envelope.runId;
    const prior = database.prepare("SELECT * FROM run_search WHERE run_id=?").get(id);
    const frozen = prior === undefined ? undefined : FullIndexRowSchema.parse(prior);
    const declared = database.prepare("SELECT json AS payload_json FROM search_declarations WHERE id=?").get(declarationKey(run));
    const declaration = frozen?.declaration_json != null ? RunSearchDeclarationSchema.parse(JSON.parse(frozen.declaration_json))
      : declared === undefined ? null : parse(RunSearchDeclarationSchema,declared);
    if (declaration !== null && (declaration.workflow !== run.envelope.workflow || declaration.version !== run.envelope.descriptorVersion
      || declaration.contractFingerprint !== run.envelope.contractFingerprint)) throw new Error("run-search-declaration-identity-mismatch");
    if (prior !== undefined && !rebuilding) runSearchIndexFromRow(prior, run, false);
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
    const record = RunSearchIndexRecordSchema.parse({ runId: id, sourceVersion: run.version, buildGeneration: generation, metadata });
    const subject = metadata.subject.state === "available" ? metadata.subject.value.toLowerCase() : null;
    const actor = metadata.actor.state === "available" ? metadata.actor.value : null;
    database.prepare(`INSERT INTO run_search(run_id,workflow,trace,local_day,state,shape,dry_run,enqueued_ms,subject,actor_id,descriptor_version,failure_code,has_receipt,has_diagnostic,systems_json,source_version,declaration_json,actor_source_json,metadata_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET workflow=excluded.workflow,trace=excluded.trace,local_day=excluded.local_day,shape=excluded.shape,dry_run=excluded.dry_run,enqueued_ms=excluded.enqueued_ms,descriptor_version=excluded.descriptor_version,systems_json=excluded.systems_json,declaration_json=excluded.declaration_json,state=excluded.state,subject=excluded.subject,actor_id=excluded.actor_id,failure_code=excluded.failure_code,has_receipt=excluded.has_receipt,has_diagnostic=excluded.has_diagnostic,source_version=excluded.source_version,actor_source_json=excluded.actor_source_json,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`).run(
      id,run.envelope.workflow,run.envelope.traceId.toLowerCase(),searchPartitionDay(new Date(run.envelope.enqueuedAt)),
      run.lifecycle.state === "terminal" ? run.lifecycle.outcome : run.lifecycle.state,run.envelope.shape,Number(run.envelope.dryRun),Date.parse(run.envelope.enqueuedAt),
      subject,actor,metadata.version,metadata.failureCode,Number(metadata.evidence.receipt),Number(metadata.evidence.diagnostic),
      canonicalJsonStringify(Object.keys(run.envelope.resolvedInstance).sort()),run.version,declaration === null ? null : canonicalJsonStringify(declaration),
      sources.length === 0 ? null : canonicalJsonStringify(sources),canonicalJsonStringify(record),frozen?.created_at ?? now,now);
    database.prepare("DELETE FROM search_actor_dirty WHERE run_id=?").run(id);
  };
  const writeId = (id: string, now: string, rebuilding = false) => {
    const raw = database.prepare("SELECT * FROM runs WHERE id=?").get(id);
    if (raw === undefined) {
      database.prepare("DELETE FROM run_search WHERE run_id=?").run(id);
      database.prepare("DELETE FROM search_actor_dirty WHERE run_id=?").run(id);
    } else write(runRecordFromRow(raw),now,rebuilding);
  };
  return {
    publication,
    validateCoverage,
    initialize(sourceGeneration: number, now: string) { return publish({ state: "published", sourceGeneration, afterRun: null, rowCount: 0 }, now); },
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
    },
    register(input: unknown, now: string) {
      const current = publication();
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
      if (current.state !== "published" || affected.size > 500) {
        publish({state:"invalid",sourceGeneration:current.sourceGeneration,afterRun:null,rowCount:count()},now);
      } else {
        for (const id of affected) writeId(id,now);
      }
      return affected.size;
    },
    publishChanges(sourceGeneration: number, now: string, prior: z.infer<typeof RunSearchPublicationSchema>) {
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
      if (!restart && (prior.state !== "building" || prior.sourceGeneration !== sourceGeneration)) throw new Error("run-search-rebuild-restart-required");
      if (restart) database.exec("UPDATE run_search SET metadata_json=json_remove(metadata_json,'$.buildGeneration'); DELETE FROM run_search WHERE run_id NOT IN (SELECT id FROM runs)");
      const after = restart ? "" : prior.afterRun ?? "";
      const rows = database.prepare(`SELECT id FROM runs WHERE id>? ORDER BY id LIMIT ?`).all(after, limit + 1).map(row => KeySchema.parse(row).id);
      const selected = rows.slice(0, limit);
      for (const id of selected) writeId(id, now, true);
      return publish({ state: rows.length > limit ? "building" : "published", sourceGeneration, afterRun: selected.at(-1) ?? prior.afterRun, rowCount: (restart ? 0 : prior.rowCount) + selected.length }, now);
    },
    search(input: unknown, sourceGeneration: number) {
      const request = RunSearchReadRequestSchema.parse(input);
      const current = publication();
      if (current.state !== "published" || current.sourceGeneration !== sourceGeneration) throw new Error("run-search-index-rebuild-required");
      const clauses: string[] = [], parameters: (string | number)[] = [];
      const add = (sql: string, ...values: (string | number)[]) => { clauses.push(sql); parameters.push(...values); };
      const { facets, q } = request;
      if (q.length > 0) add("(instr(lower(s.id),?)>0 OR instr(s.trace,?)>0 OR instr(lower(s.workflow),?)>0 OR instr(s.subject,?)>0 OR instr(lower(s.actor),?)>0)", q,q,q,q,q);
      for (const [field, value] of Object.entries({ workflow: facets.workflow, state: facets.state, shape: facets.shape, actor: facets.actor, version: facets.version, failure: facets.failure })) if (value !== undefined) add(`s.${field}=?`, value);
      if (facets.from !== undefined) add("s.local_day>=?", facets.from);
      if (facets.to !== undefined) add("s.local_day<=?", facets.to);
      if (facets.day !== undefined) add("s.enqueued_ms>=? AND s.enqueued_ms<?", Date.parse(facets.day.startsAt), Date.parse(facets.day.endsBefore));
      if (facets.dryRun !== undefined) add("s.dry_run=?", Number(facets.dryRun));
      if (facets.system !== undefined) add("EXISTS(SELECT 1 FROM json_each(s.systems) WHERE value=?)", facets.system);
      if (facets.subject !== undefined) add("instr(s.subject,?)>0",facets.subject.toLowerCase());
      if (facets.evidence === "receipt") add("s.receipt=1");
      if (facets.evidence === "failure") add("s.failure IS NOT NULL");
      if (facets.evidence === "diagnostic") add("s.diagnostic=1");
      if (facets.evidence === "none") add("s.receipt=0 AND s.failure IS NULL AND s.diagnostic=0");
      const where = clauses.length === 0 ? "1" : clauses.join(" AND ");
      const candidateCount = CountSchema.parse(database.prepare(`SELECT count(*) AS count FROM (SELECT 1 FROM (SELECT run_id AS id,workflow,trace,local_day,state,shape,dry_run,enqueued_ms,subject,actor_id AS actor,descriptor_version AS version,failure_code AS failure,has_receipt AS receipt,has_diagnostic AS diagnostic,systems_json AS systems,metadata_json AS payload_json FROM run_search) s WHERE ${where} LIMIT ?)`)
        .get(...parameters, LIMIT + 1)).count;
      if (candidateCount > LIMIT) throw new Error("run-search-query-too-broad: narrow dates or metadata filters (maximum 10000 candidates)");
      const fields = { run: "s.id", trace: "s.trace", workflow: "s.workflow", subject: "s.subject", actor: "lower(s.actor)" };
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
      const matched = `WITH ranked AS (SELECT s.*,${rank} AS match_rank FROM (SELECT run_id AS id,workflow,trace,local_day,state,shape,dry_run,enqueued_ms,subject,actor_id AS actor,descriptor_version AS version,failure_code AS failure,has_receipt AS receipt,has_diagnostic AS diagnostic,systems_json AS systems,metadata_json AS payload_json FROM run_search) s WHERE ${where})`;
      const after = request.after;
      const afterSql = after === undefined ? "" : "AND (match_rank>? OR (match_rank=? AND enqueued_ms<?) OR (match_rank=? AND enqueued_ms=? AND id>?))";
      const cursorBindings = after === undefined ? [] : [after.matchRank, after.matchRank, Date.parse(after.enqueuedAt), after.matchRank, Date.parse(after.enqueuedAt), after.runId];
      const pass = database.prepare(`${matched}, matched AS MATERIALIZED (SELECT * FROM ranked WHERE match_rank IS NOT NULL),
        page AS (SELECT id,payload_json,match_rank,enqueued_ms FROM matched WHERE 1=1 ${afterSql} ORDER BY match_rank,enqueued_ms DESC,id LIMIT ?)
        SELECT 'row' AS kind,json_object('id',id,'payload_json',payload_json,'match_rank',match_rank) AS payload,match_rank,enqueued_ms,id FROM page
        UNION ALL SELECT 'summary',json_object('count',count(*),'subject_missing',COALESCE(sum(subject IS NULL),0),'actor_missing',COALESCE(sum(actor IS NULL),0)),NULL,NULL,NULL FROM matched
        ORDER BY kind,match_rank,enqueued_ms DESC,id`).all(...bindings, ...cursorBindings, request.limit)
        .map(row => z.object({ kind: z.enum(["row", "summary"]), payload: z.string() }).parse(row));
      const summary = pass.find(row => row.kind === "summary");
      if (summary === undefined) throw new Error("run-search-summary-missing");
      const coverage = z.object({ count: z.number().int(), subject_missing: z.number().int(), actor_missing: z.number().int() }).parse(JSON.parse(summary.payload));
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

