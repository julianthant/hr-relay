import { AssistantM1NativeCommandAuditSchema,commandIdentity,convertAssistantCommandPairToM1 } from "../../../../src/backend/storage/sqlite/command-record-row.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { COMMAND_FIXTURES,LATER,UUID_1,UUID_3,UUID_4 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { runQueuedSpanEvent } from "../../../../src/backend/runs/commands/run-queued-span.js";
import { ActorIdSchema } from "../../../../src/rules/identity/ids.js";
import { TimelineEventRecordSchema } from "../../../../src/models/events/timeline.js";
import { DatabaseSync } from "node:sqlite";
import { afterEach,describe,expect,it,vi } from "vitest";
import { z } from "zod";
import { CURRENT_AUTHORITY_SCHEMA_VERSION, SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { RUN_SEARCH_FTS_TABLES } from "../../../../src/models/config/authority.js";
import { runRecordColumns,runRecordFromRow } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import {
  RUN_SEARCH_EVENTS,
  RUN_SEARCH_STATES,
  RUN_SEARCH_TRANSITIONS,
  SearchStateColumnSchema,
  createRunSearchIndex,
  rebindAssistantM1RunSearchRow,
  runSearchIndexFromRow,
  runSearchPublicationOf,
  runSearchStateOf,
  runSearchTransition,
  type RunSearchEvent,
  type RunSearchState,
} from "../../../../src/backend/storage/sqlite/run-search-index.js";
import { RunSearchIndexRecordSchema,RunSearchPublicationSchema } from "../../../../src/models/dashboard/search-index.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function fixture(registered = true, fullText = false) {
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false }); databases.push(db);
  for (const migration of SQLITE_MIGRATIONS) for (const sql of migration.statements) db.exec(sql);
  db.prepare("INSERT INTO database_states(id,schema_version,authority_generation,updated_at,search_generation,search_state,installation_id,profile_id) VALUES(1,1,0,?,0,'ready',?,?)")
    .run(QUEUED_RUN.createdAt, "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222");
  if (fullText) db.exec(`PRAGMA user_version=${String(CURRENT_AUTHORITY_SCHEMA_VERSION)}`);
  const index = createRunSearchIndex(db); index.installTracking();
  if (registered) index.register([{ workflow: QUEUED_RUN.envelope.workflow, version: 1, contractFingerprint: QUEUED_RUN.envelope.contractFingerprint, subjectProjection: null }], QUEUED_RUN.createdAt);
  const add = (sequence: number, date: string) => {
    const row = runRecordColumns(RunRecordSchema.parse({ ...QUEUED_RUN,
      envelope: { ...QUEUED_RUN.envelope, runId: `10000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`, itemId: `20000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`, enqueuedAt: date },
      createdAt: date, updatedAt: date }));
    db.prepare(`INSERT INTO runs (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
    return row.id;
  };
  const publish = () => {
    db.prepare("UPDATE database_states SET authority_generation=authority_generation+1,search_generation=NULL,search_state='invalid'").run();
    index.publishChanges(1, QUEUED_RUN.createdAt, RunSearchPublicationSchema.parse({ state: "published", sourceGeneration: 0, afterRun: null, rowCount: 0 }));
  };
  return { db, index, add, publish };
}
const query = { q: "", scope: "all", facets: {}, limit: 1 };
describe("native one-row search", () => {
  it.each([0, 1000, 10000])("does not rescan %i unrelated audits for a pure heartbeat", population => {
    const f = fixture(); const id = f.add(1, "2026-10-01T12:00:00.000Z"); f.publish();
    const insert = f.db.prepare("INSERT INTO command_audits(id,command_id,payload_json,created_at) VALUES(?,?,?,?)");
    f.db.exec("BEGIN");
    for (let ordinal = 0; ordinal < population; ordinal++) insert.run(`audit-${String(ordinal)}`, `command-${String(ordinal)}`,
      JSON.stringify({ request: { family: "lifecycle" }, result: { state: "applied", affectedTargets: [{ family: "run", runId: id }] } }), QUEUED_RUN.createdAt);
    f.db.exec("COMMIT");
    const prepare = vi.spyOn(f.db, "prepare");
    f.db.prepare("UPDATE runs SET version=version+1,lifecycle_json=json_set(lifecycle_json,'$.version',version+1) WHERE id=?").run(id);
    f.db.prepare("UPDATE database_states SET authority_generation=2,search_generation=NULL,search_state='invalid'").run();
    f.index.publishChanges(2, QUEUED_RUN.createdAt, RunSearchPublicationSchema.parse({ state: "published", sourceGeneration: 1, afterRun: null, rowCount: 1 }));
    expect(prepare.mock.calls.filter(([sql]) => sql.includes("FROM command_audits"))).toHaveLength(0);
    expect(f.index.search(query, 2).rows[0]?.metadata.actor).toEqual({ state: "unavailable", reason: "not-recorded" });
  });
  it("serves a hosted OCR run through its host: the child is not a search row, count or cursor anchor", () => {
    const f = fixture(); const host = f.add(1, "2026-10-01T12:00:00.000Z"), other = f.add(2, "2026-10-01T13:00:00.000Z");
    const row = runRecordColumns(RunRecordSchema.parse({ ...QUEUED_RUN,
      envelope: { ...QUEUED_RUN.envelope, workflow: "ocr", runId: "10000000-0000-4000-8000-000000000003", itemId: "20000000-0000-4000-8000-000000000003",
        enqueuedAt: "2026-10-01T14:00:00.000Z", parent: { runId: host, edgeId: "document-ocr", tracePrefix: QUEUED_RUN.envelope.traceId } },
      createdAt: "2026-10-01T14:00:00.000Z", updatedAt: "2026-10-01T14:00:00.000Z" }));
    f.db.prepare(`INSERT INTO runs (${Object.keys(row).join(",")}) VALUES (${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
    f.publish();
    const all = f.index.search({ ...query, limit: 10 }, 1);
    expect(all.totalMatches).toBe(2);
    expect(all.rows.map(entry => entry.record.envelope.runId)).toEqual([other, host]);
    expect(f.index.search({ ...query, q: "ocr", limit: 10 }, 1).totalMatches).toBe(0);
  });
  it("invalidates actor provenance for contributing audit insert, update and deletion including old bindings", () => {
    const f = fixture(); const id = f.add(1, "2026-10-01T12:00:00.000Z"), other = f.add(2, "2026-10-01T13:00:00.000Z"); f.publish();
    const payload = (runId: string) => JSON.stringify({ request: { family: "start" }, result: { state: "applied", affectedTargets: [{ family: "run", runId }] } });
    const dirty = () => f.db.prepare("SELECT run_id FROM search_actor_dirty ORDER BY run_id").all();
    f.db.prepare("INSERT INTO command_audits(id,command_id,payload_json,created_at) VALUES('audit','command',?,?)").run(payload(id), QUEUED_RUN.createdAt);
    expect(dirty()).toEqual([{ run_id: id }]);
    f.db.exec("DELETE FROM search_actor_dirty; DELETE FROM search_dirty");
    f.db.exec("DROP TRIGGER command_audits_immutable");
    f.db.prepare("UPDATE command_audits SET payload_json=? WHERE id='audit'").run(payload(other));
    expect(dirty()).toEqual([{ run_id: id }, { run_id: other }]);
    expect(() => f.index.publishChanges(2, QUEUED_RUN.createdAt, RunSearchPublicationSchema.parse({ state: "published", sourceGeneration: 1, afterRun: null, rowCount: 2 }))).toThrow();
    f.db.exec("DELETE FROM search_actor_dirty; DELETE FROM search_dirty; DROP TRIGGER command_audits_retained; DELETE FROM command_audits WHERE id='audit'");
    expect(dirty()).toEqual([{ run_id: other }]);
  });

  it("freezes declaration identity and serves literal ranked results with full count and keyset order", () => {
    const f = fixture(true, true); const old = f.add(1, "2026-10-01T12:00:00.000Z"), recent = f.add(2, "2026-10-02T12:00:00.000Z"); f.publish();
    const page = f.index.search(query, 1);
    expect(page.totalMatches).toBe(2);
    expect(page.rows.map(row => row.record.envelope.runId)).toEqual([recent]);
    expect(f.index.search({ ...query, after: { matchRank: 0, enqueuedAt: page.rows[0]?.record.envelope.enqueuedAt, runId: recent } }, 1).rows.map(row => row.record.envelope.runId)).toEqual([old]);
    expect(f.index.search({ ...query, q: "%" }, 1).totalMatches).toBe(0);
    expect(f.index.search({ ...query, q: "_" }, 1).totalMatches).toBe(0);
    expect(f.index.search({ ...query, q: '" OR *' }, 1).totalMatches).toBe(0);
    expect(f.index.search({ ...query, q: "0\0nope" }, 1).totalMatches).toBe(0);
    expect(f.index.search({ ...query, q: "02", scope: "run" }, 1).rows[0]?.record.envelope.runId).toBe(recent);
    expect(f.index.search({ ...query, q: recent, scope: "run" }, 1).rows[0]?.record.envelope.runId).toBe(recent);
    expect(f.index.search({ ...query, facets: { from: "2026-10-02", to: "2026-10-02" } }, 1).totalMatches).toBe(1);
    expect(f.db.prepare("SELECT declaration_json FROM run_search").all()).toHaveLength(2);
    expect(f.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE 'run_search%' ORDER BY name").all())
      .toEqual(["run_search", ...RUN_SEARCH_FTS_TABLES].map(name => ({ name })));
  });

  it("preserves the frozen declaration when rebuilding after the current registry is unavailable", () => {
    const f = fixture(); f.add(1, "2026-10-01T12:00:00.000Z"); f.publish();
    const before = f.db.prepare("SELECT declaration_json,actor_source_json,created_at FROM run_search").get();
    f.db.exec("DELETE FROM search_declarations; UPDATE database_states SET search_state='invalid',search_generation=NULL");
    expect(f.index.rebuild({ restart: true, limit: 1 }, 1, "2026-10-10T12:00:00.000Z").state).toBe("published");
    expect(f.db.prepare("SELECT declaration_json,actor_source_json,created_at FROM run_search").get()).toEqual(before);
    expect(f.index.search(query, 1).totalMatches).toBe(1);
  });

  it("rejects corrupt search scalars and admits retained identity while a stale projection is unavailable", () => {
    const f = fixture(); const id = f.add(1, "2026-10-01T12:00:00.000Z"); f.publish();
    const run = runRecordFromRow(f.db.prepare("SELECT * FROM runs WHERE id=?").get(id));
    const row = f.db.prepare("SELECT * FROM run_search WHERE run_id=?").get(id);
    expect(() => runSearchIndexFromRow({ ...row,actor_id:"forged-actor" },run)).toThrow(/corrupt/u);
    expect(() => runSearchIndexFromRow({ ...row,systems_json:'["kuali"]' },run)).toThrow(/corrupt/u);
    expect(() => runSearchIndexFromRow(row,RunRecordSchema.parse({ ...run,version:run.version+1 }))).toThrow(/corrupt/u);
    expect(runSearchIndexFromRow(row,RunRecordSchema.parse({ ...run,version:run.version+1 }),false).sourceVersion).toBe(run.version);
    f.db.exec("UPDATE database_states SET search_state='invalid',search_generation=NULL");
    expect(() => f.index.search(query,1)).toThrow(/rebuild-required/u);
  });

  it("keeps invalid generations unavailable until a complete bounded rebuild publishes", () => {
    const f = fixture(); f.add(1, "2026-10-01T12:00:00.000Z"); f.add(2, "2026-10-02T12:00:00.000Z");
    f.db.exec("UPDATE database_states SET search_state='invalid',search_generation=NULL");
    expect(() => f.index.search(query, 0)).toThrow(/rebuild-required/u);
    expect(f.index.rebuild({ restart: true, limit: 1 }, 0, QUEUED_RUN.createdAt).state).toBe("building");
    expect(() => f.index.search(query, 0)).toThrow(/rebuild-required/u);
    expect(f.index.rebuild({ limit: 1 }, 0, QUEUED_RUN.createdAt).state).toBe("published");
    expect(f.index.search(query, 0).totalMatches).toBe(2);
  });
});

/** Written by hand from the design's machine 8 table; it is the specification RUN_SEARCH_TRANSITIONS must reproduce. */
const RESTART = { refused: "run-search-rebuild-restart-required" } as const;
const REBUILD = { refused: "run-search-index-rebuild-required" } as const;
const PUBLISHED = { state: "published" } as const, BUILDING = { state: "building" } as const, INVALID = { state: "invalid" } as const;
const UNPUBLISHED = {
  "authority-write": INVALID, register: INVALID, "register-bulk": INVALID, "native-cancellation": INVALID, "projection-repair": INVALID,
  "restart-chunk": BUILDING, "restart-last-chunk": PUBLISHED, "continue-chunk": RESTART, "continue-last-chunk": RESTART, search: REBUILD,
} as const;
const expectedTransitions: Record<RunSearchState, Record<RunSearchEvent, { readonly state: RunSearchState } | { readonly refused: string }>> = {
  published: {
    "authority-write": PUBLISHED, register: PUBLISHED, "register-bulk": INVALID, "native-cancellation": INVALID, "projection-repair": INVALID,
    "restart-chunk": BUILDING, "restart-last-chunk": PUBLISHED, "continue-chunk": RESTART, "continue-last-chunk": RESTART, search: PUBLISHED,
  },
  building: { ...UNPUBLISHED, "continue-chunk": BUILDING, "continue-last-chunk": PUBLISHED },
  stale: UNPUBLISHED,
  invalid: UNPUBLISHED,
};

describe("run search publication transition table", () => {
  it("declares exactly the four publication states and ten events", () => {
    expect([...RUN_SEARCH_STATES]).toEqual(["published", "building", "stale", "invalid"]);
    expect([...RUN_SEARCH_EVENTS]).toEqual(["authority-write", "register", "register-bulk", "native-cancellation", "projection-repair",
      "restart-chunk", "restart-last-chunk", "continue-chunk", "continue-last-chunk", "search"]);
    expect(Object.keys(RUN_SEARCH_TRANSITIONS).sort()).toEqual([...RUN_SEARCH_STATES].sort());
    expect(Object.isFrozen(RUN_SEARCH_TRANSITIONS.building)).toBe(true);
  });

  for (const state of RUN_SEARCH_STATES) {
    for (const event of RUN_SEARCH_EVENTS) {
      it(`${state} on ${event}`, () => {
        expect(runSearchTransition(state, event)).toEqual(expectedTransitions[state][event]);
      });
    }
  }
});

describe("run search publication derivation", () => {
  const progress = (generation: number) => `30000000-0000-4000-8000-${String(generation).padStart(12, "0")}`;
  it.each([
    [{ authority_generation: 4, search_generation: 4, search_state: "ready" }, { state: "published", sourceGeneration: 4, afterRun: null }],
    [{ authority_generation: 4, search_generation: 3, search_state: "invalid" }, { state: "building", sourceGeneration: 3, afterRun: "30000000-0000-4000-8000-000000000003" }],
    [{ authority_generation: 4, search_generation: null, search_state: "invalid" }, { state: "invalid", sourceGeneration: 4, afterRun: null }],
    [{ authority_generation: 4, search_generation: null, search_state: "unbuilt" }, { state: "invalid", sourceGeneration: 4, afterRun: null }],
  ] as const)("derives %j as %j", (row, publication) => {
    expect(runSearchPublicationOf(row, progress)).toEqual(publication);
  });

  it("reads the stored column with one schema that keeps the historical unbuilt value", () => {
    expect(SearchStateColumnSchema.options).toEqual(["unbuilt", "ready", "invalid"]);
    expect(SearchStateColumnSchema.safeParse("published").success).toBe(false);
  });

  it.each([
    ["published", 4, "published"], ["published", 5, "stale"], ["building", 4, "building"], ["building", 5, "stale"], ["invalid", 5, "invalid"],
  ] as const)("keys a %s publication at generation 4 against authority generation %i as %s", (state, authorityGeneration, key) => {
    expect(runSearchStateOf({ state, sourceGeneration: 4 }, authorityGeneration)).toBe(key);
  });
});

/** Arranges each stored publication state on a real index with three runs, then applies each event the index owns. */
function walkFixture(state: RunSearchState) {
  const f = fixture(false), now = QUEUED_RUN.createdAt;
  f.add(1, "2026-10-01T12:00:00.000Z"); f.add(2, "2026-10-02T12:00:00.000Z"); f.add(3, "2026-10-03T12:00:00.000Z"); f.publish();
  if (state !== "published") f.db.exec("UPDATE database_states SET search_state='invalid',search_generation=NULL");
  if (state === "building" || state === "stale") f.index.rebuild({ restart: true, limit: 1 }, 1, now);
  if (state === "stale") f.db.exec("UPDATE database_states SET authority_generation=2");
  const generation = () => z.object({ g: z.number() }).parse(f.db.prepare("SELECT authority_generation AS g FROM database_states").get()).g;
  return { ...f, now, generation, key: () => runSearchStateOf(f.index.publication(), generation()) };
}
const INDEX_EVENTS = ["authority-write", "register", "restart-chunk", "restart-last-chunk", "continue-chunk", "continue-last-chunk", "search"] as const;

describe("run search index follows its transition table", () => {
  for (const state of RUN_SEARCH_STATES) {
    for (const event of INDEX_EVENTS) {
      it(`${state} on ${event}`, () => {
        const f = walkFixture(state);
        expect(f.key()).toBe(state);
        const g = f.generation();
        const apply = () => {
          if (event === "authority-write") {
            const prior = f.index.publication();
            f.db.exec("UPDATE database_states SET authority_generation=authority_generation+1,search_generation=NULL,search_state='invalid'");
            f.index.publishChanges(g + 1, f.now, prior);
          } else if (event === "register") {
            expect(f.index.register([{ workflow: QUEUED_RUN.envelope.workflow, version: 1, contractFingerprint: QUEUED_RUN.envelope.contractFingerprint, subjectProjection: null }], f.now)).toBeGreaterThan(0);
          } else if (event === "search") f.index.search(query, g);
          else f.index.rebuild({ restart: event.startsWith("restart"), limit: event.endsWith("last-chunk") ? 500 : 1 }, g, f.now);
        };
        const expected = expectedTransitions[state][event];
        if ("refused" in expected) expect(apply).toThrow(new RegExp(`^${expected.refused}$`, "u"));
        else { apply(); expect({ state: f.key() }).toEqual(expected); }
      });
    }
  }
});

function rebindFixture() {
  const run = RunRecordSchema.parse(QUEUED_RUN), id = run.envelope.runId;
  const f = fixture();
  const columns = runRecordColumns(run);
  f.db.prepare(`INSERT INTO runs (${Object.keys(columns).join(",")}) VALUES (${Object.keys(columns).map(() => "?").join(",")})`).run(...Object.values(columns));
  f.publish();
  const event = TimelineEventRecordSchema.parse({ schemaVersion: 1, eventId: UUID_4, cursor: 1,
    workflow: run.envelope.workflow, scope: { kind: "run", runId: id }, occurredAt: run.createdAt, recordedAt: run.createdAt,
    retentionDate: run.createdAt.slice(0, 10), source: { kind: "native" },
    payload: { kind: "span", event: { ...runQueuedSpanEvent({ run, actorId: ActorIdSchema.parse("local-operator"), title: "Lookup" }), pid: 1 } } });
  const request = { ...commandIdentity(COMMAND_FIXTURES[0]).request, target: { workflowId: run.envelope.workflow, startPlanId: UUID_3, expectedVersion: 1 } };
  const audit = { auditId: UUID_3, request, result: { state: "applied", commandId: UUID_1,
    affectedTargets: [{ family: "run", runId: id }] }, completedAt: LATER, versionChanges: [], affectedDependencyIds: [] };
  const identity = commandIdentity(request);
  const pair = { command: { id: UUID_1, family: identity.family, actor_id: identity.actor, parent_id: null,
    target_id: identity.targetId, request_digest: sha256Hex(identity.json), request_json: identity.json, state: "succeeded",
    outcome_json: canonicalJsonStringify(audit), created_at: identity.createdAt, updated_at: LATER },
    audit: { id: UUID_3, command_id: UUID_1, code: null, payload_json: canonicalJsonStringify(audit), created_at: LATER } };
  const old = f.db.prepare("SELECT * FROM run_search WHERE run_id=?").get(id);
  const metadata = RunSearchIndexRecordSchema.parse(JSON.parse(String(old?.metadata_json)));
  metadata.metadata.actor = { state: "available", value: "local-operator" };
  const row = { ...old, actor_id: "local-operator", metadata_json: canonicalJsonStringify(metadata),
    actor_source_json: canonicalJsonStringify([{ kind: "start-audit", audit }, { kind: "queued", event }]) };
  return { run, row, event, pair, audit };
}
describe("unregistered M1 search audit-copy rebind", () => {
  it("authenticates full retained sources, preserving queued order and frozen row fields", () => {
    const f = rebindFixture(), before = structuredClone(f.row);
    const next = rebindAssistantM1RunSearchRow(f.row, f.run, [f.event], [f.pair]);
    const converted = convertAssistantCommandPairToM1(f.pair.command, f.pair.audit);
    expect(next).toEqual({ ...before, actor_source_json: canonicalJsonStringify([
      { kind: "start-audit", audit: AssistantM1NativeCommandAuditSchema.parse(JSON.parse(converted.audit?.payload_json ?? "null")) }, { kind: "queued", event: f.event }]) });
    expect(f.row).toEqual(before);
    expect(() => runSearchIndexFromRow(next, f.run)).toThrow();
  });
  it("retains an honestly empty source set without inventing actor evidence", () => {
    const f = fixture(), id = f.add(1, "2026-10-01T12:00:00.000Z"); f.publish();
    const row = f.db.prepare("SELECT * FROM run_search WHERE run_id=?").get(id);
    const run = runRecordFromRow(f.db.prepare("SELECT * FROM runs WHERE id=?").get(id));
    expect(rebindAssistantM1RunSearchRow(row, run, [], [])).toEqual(row);
  });
  it("refuses missing, duplicated, changed, foreign or wrong-run source evidence", () => {
    const f = rebindFixture();
    expect(() => rebindAssistantM1RunSearchRow(f.row, f.run, [], [f.pair])).toThrow();
    expect(() => rebindAssistantM1RunSearchRow(f.row, f.run, [f.event], [])).toThrow();
    expect(() => rebindAssistantM1RunSearchRow(f.row, f.run, [f.event, f.event], [f.pair])).toThrow();
    expect(() => rebindAssistantM1RunSearchRow(f.row, f.run, [f.event], [f.pair, f.pair])).toThrow();
    const sources = [{ kind: "start-audit", audit: f.audit }, { kind: "queued", event: f.event }];
    for (const changed of [[], [...sources, sources[0]], [{ kind: "start-audit", audit: { ...f.audit, completedAt: f.run.createdAt } }, sources[1]],
      [{ kind: "start-audit", audit: { ...f.audit, result: { ...f.audit.result, affectedTargets: [{ family: "run", runId: UUID_4 }] } } }, sources[1]],
      [sources[0], { kind: "queued", event: { ...f.event, eventId: UUID_3 } }]]) {
      expect(() => rebindAssistantM1RunSearchRow({ ...f.row, actor_source_json: canonicalJsonStringify(changed) }, f.run, [f.event], [f.pair])).toThrow();
    }
    expect(() => rebindAssistantM1RunSearchRow({ ...f.row, declaration_json: '{}' }, f.run, [f.event], [f.pair])).toThrow();
    const metadata = RunSearchIndexRecordSchema.parse(JSON.parse(f.row.metadata_json));
    expect(() => rebindAssistantM1RunSearchRow({ ...f.row, source_version: f.run.version + 1,
      metadata_json: canonicalJsonStringify({ ...metadata, sourceVersion: f.run.version + 1 }) }, f.run, [f.event], [f.pair])).toThrow();
    expect(() => rebindAssistantM1RunSearchRow({ ...f.row, state: "running" }, f.run, [f.event], [f.pair])).toThrow();
    expect(() => rebindAssistantM1RunSearchRow(f.row, f.run, [f.event], [{ ...f.pair, command: { ...f.pair.command, request_digest: "a".repeat(64) } }])).toThrow();
  });
});
