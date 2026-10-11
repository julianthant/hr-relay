import { TimelineAppendSchema } from "../../../../../../src/models/events/timeline.js";
import { CONFIG_SNAPSHOT } from "../../../../../support/fixtures/phase1c-contract-fixtures.js";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { describe, it, vi } from "vitest";
import {
  CrossDateSearchPageSchema,
  CrossDateSearchQuerySchema,
} from "../../../../../../src/models/dashboard/search.js";
import { AuthorityDatabase } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../../../../src/rules/validation/canonical-json.js";
import { RunRecordSchema, type RunRecord } from "../../../../../../src/models/run/record.js";
import { createCrossDateSearchService } from "../../../../../../src/backend/runs/queries/search.js";
import { runRecordOf } from "../../../../../support/helpers/backend/dashboard-harness.js";
import { insertMeasuredSearchRun } from "../../../../../support/helpers/backend/cross-date-search-harness.js";
import { SANITIZED_CROSS_DATE_SEARCH_CORPUS } from "../../../../../support/fixtures/cross-date-search-corpus.js";
import { separationsDescriptor } from "../../../../../support/helpers/registered-workflows.js";

function corruptRunSource(raw: DatabaseSync, sql: string, ...values: (string | number | null)[]) {
  const trigger = z.object({ sql: z.string() }).parse(raw.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name='runs_identity'").get());
  raw.exec("DROP TRIGGER runs_identity");
  try { raw.prepare(sql).run(...values); }
  finally { raw.exec(trigger.sql); }
}

const TEST_CURSOR_SIGNING_KEY = new Uint8Array(32).fill(0x53);
const MEASURED_SEARCH_DESCRIPTOR = Object.freeze({
  id: "separations",
  label: "Separations",
  code: "sp",
  category: "separation",
});

function resolveMeasuredSearchDescriptor(workflowId: string) {
  return workflowId === MEASURED_SEARCH_DESCRIPTOR.id ? MEASURED_SEARCH_DESCRIPTOR : undefined;
}

const CursorAttackPayloadSchema = z.strictObject({
  version: z.literal(1),
  queryHash: z.string(),
  sourceIdentity: z.string(),
  authorityGeneration: z.number().int().nonnegative(),
  expiresAt: z.string(),
  order: z.literal("match-strength/enqueued-desc/run-id-asc:v2"),
  after: z.strictObject({
    matchRank: z.number().int().nonnegative(),
    enqueuedAt: z.string(),
    runId: z.string(),
  }),
});

function forgeCursorWithDisclosedSource(
  cursor: string,
  after: Readonly<{ enqueuedAt: string; runId: string }>,
): string {
  const [prefix, encoded] = cursor.split(".");
  if (prefix !== "sc1" || encoded === undefined) throw new Error("test cursor does not carry an sc1 payload");
  const payload = CursorAttackPayloadSchema.parse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
  const forgedPayload = canonicalJsonStringify({ ...payload, after: { ...payload.after, ...after } });
  const forgedEncoded = Buffer.from(forgedPayload, "utf8").toString("base64url");
  const forgedDigest = createHash("sha256")
    .update("cross-date-search-cursor:v1\0")
    .update(payload.sourceIdentity)
    .update("\0")
    .update(forgedEncoded)
    .digest("hex");
  return `sc1.${forgedEncoded}.${forgedDigest}`;
}

function searchWireResult(input: Readonly<{
  runId: string;
  traceId: string;
  enqueuedAt: string;
}>): Readonly<Record<string, unknown>> {
  return {
    runId: input.runId,
    traceId: input.traceId,
    workflowId: "separations",
    registration: {
      state: "registered",
      label: "Separations",
      code: "sp",
      categoryId: "separation",
    },
    partitionDay: "2026-11-01",
    state: "parked-gate",
    shape: "single",
    dryRun: true,
    priority: "interactive",
    systems: ["kuali", "new-kronos", "ucpath"],
    runNumber: { state: "absent", reason: "this historical run has no durable workflow ordinal" },
    retryOf: { state: "absent", reason: "this run is not a retry" },
    enqueuedAt: input.enqueuedAt,
    endedAt: { state: "absent", reason: `run ${input.runId} is parked-gate, not terminal` },
    match: { field: "workflow", strength: "exact" },
    metadata: { subject: { state: "unavailable", reason: "not-recorded" }, actor: { state: "unavailable", reason: "not-recorded" }, version: 1, failureCode: null, evidence: { receipt: false, failure: false, diagnostic: false } },
  };
}

function queuedSearchCorpusCandidate(input: Readonly<{
  seed: number;
  shape?: "single" | "preview";
  dryRun?: boolean;
  resolvedInstance?: Readonly<Record<string, "prod">>;
}>): RunRecord {
  const base = runRecordOf({
    seed: input.seed,
    workflow: "separations",
    shape: input.shape ?? "single",
    dryRun: input.dryRun ?? true,
    enqueuedAt: "2026-08-28T15:00:00.000Z",
  });
  return RunRecordSchema.parse({
    ...base,
    envelope: {
      ...base.envelope,
      resolvedInstance: input.resolvedInstance ?? {
        kuali: "prod",
        "new-kronos": "prod",
        ucpath: "prod",
      },
    },
  });
}

describe("cross-date search query", () => {
  it("pins the sanitized authority corpus that closed the facet vocabulary", () => {
    const corpus = SANITIZED_CROSS_DATE_SEARCH_CORPUS;
    assert.equal(corpus.authority.runs, 7);
    assert.equal(corpus.projection.authorityJoinedSpanIdentities, corpus.authority.runs);
    assert.equal(corpus.projection.orphanSpanIdentitiesExcluded, 50);
    assert.equal(corpus.projection.authorityRunsMissingSpans, 0);
    assert.equal(corpus.authority.displayName.present, 0);
    assert.deepEqual(corpus.supportedQueryFacets, {
      workflows: ["separations"],
      states: ["done", "failed", "parked-gate"],
      shapes: ["single"],
      dryRun: [true],
      systems: ["kuali", "new-kronos", "ucpath"],
      priority: { state: "unmeasured" },
    });
  });

  it("parses the bounded default query contract", () => {
    assert.deepEqual(CrossDateSearchQuerySchema.parse({ q: "separations" }), {
      q: "separations",
      scope: "all",
      facets: {},
      limit: 20,
    });
  });

  it("refuses a page limit above the public maximum", () => {
    assert.throws(
      () => CrossDateSearchQuerySchema.parse({ q: "separations", limit: 51 }),
      /less than or equal to 50/,
    );
  });

  it("refuses query text above the public maximum", () => {
    assert.throws(
      () => CrossDateSearchQuerySchema.parse({ q: "x".repeat(161) }),
      /query must be at most 160 characters/,
    );
  });

  it("accepts query text and page limits at their exact public maxima", () => {
    const parsed = CrossDateSearchQuerySchema.parse({
      q: "x".repeat(160),
      limit: 50,
    });

    assert.equal(parsed.q.length, 160);
    assert.equal(parsed.limit, 50);
  });

  it("accepts filter-only queries under the explicit bounded candidate contract", () => {
    for (const q of ["", "   "]) {
      assert.equal(CrossDateSearchQuerySchema.parse({ q }).q, "");
    }
  });

  it("refuses zero, negative, and non-integer page limits", () => {
    for (const limit of [0, -1, 1.5]) {
      assert.throws(() => CrossDateSearchQuerySchema.parse({ q: "separations", limit }));
    }
  });

  it("bounds cursor length and refuses a non-string cursor", () => {
    const maximum = CrossDateSearchQuerySchema.parse({
      q: "separations",
      cursor: "x".repeat(2_048),
    });
    assert.equal(maximum.cursor?.length, 2_048);
    for (const cursor of ["", "x".repeat(2_049), 1]) {
      assert.throws(() => CrossDateSearchQuerySchema.parse({ q: "separations", cursor }));
    }
  });

  it("accepts the historical measured facets and refuses arbitrary input fields", () => {
    const facets = {
      workflow: "separations",
      day: "2026-08-28",
      state: "failed",
      shape: "single",
      dryRun: true,
      system: "kuali",
    };

    assert.deepEqual(
      CrossDateSearchQuerySchema.parse({ q: "separations", facets }).facets,
      facets,
    );
    assert.throws(
      () => CrossDateSearchQuerySchema.parse({ q: "separations", facets: { title: "unsafe" } }),
      /title/,
    );
  });

  it("refuses malformed facet values and the unassigned priority family", () => {
    const unsupportedFacets = [
      { workflow: "NOT A WORKFLOW" },
      { state: "imaginary" },
      { shape: "unknown-shape" },
      { dryRun: "false" },
      { system: "unknown-system" },
      { priority: "interactive" },
    ];

    for (const facets of unsupportedFacets) {
      assert.throws(
        () => CrossDateSearchQuerySchema.parse({ q: "separations", facets }),
        (error) => error instanceof z.ZodError,
        `facets ${JSON.stringify(facets)} are outside the approved strict metadata contract`,
      );
    }
  });
});

describe("cross-date search result", () => {
  it("refuses offset-form results that are not ordered by their instants", () => {
    const earlier = searchWireResult({
      runId: "00010001-0001-4001-8001-000100010001",
      traceId: "sp-160001-0001",
      enqueuedAt: "2026-11-01T01:30:00.000-07:00",
    });
    const later = searchWireResult({
      runId: "00020002-0002-4002-8002-000200020002",
      traceId: "sp-160002-0002",
      enqueuedAt: "2026-11-01T01:15:00.000-08:00",
    });

    assert.throws(
      () => CrossDateSearchPageSchema.parse({
        wireVersion: 1,
        generatedAt: "2026-11-02T16:00:00.000Z",
        snapshot: {
          authorityGeneration: 19,
          order: "match-strength/enqueued-desc/run-id-asc:v2",
          token: "test-snapshot-token",
        },
        totalMatches: 2,
      coverage: { matched: 2, subjectUnavailable: 2, actorUnavailable: 2, candidateLimit: 10000 },
        results: [earlier, later],
        nextCursor: { state: "absent", reason: "the snapshot has no later matching run" },
      }),
      /search page is not ordered by match-strength\/enqueued-desc\/run-id-asc:v2/,
    );
  });

  it("represents an exact zero-match page without an absent or unknown count", () => {
    assert.deepEqual(CrossDateSearchPageSchema.parse({
      wireVersion: 1,
      generatedAt: "2026-08-28T16:00:00.000Z",
      snapshot: {
        authorityGeneration: 19,
        order: "match-strength/enqueued-desc/run-id-asc:v2",
        token: "test-snapshot-token",
      },
      totalMatches: 0,
      coverage: { matched: 0, subjectUnavailable: 0, actorUnavailable: 0, candidateLimit: 10000 },
      results: [],
      nextCursor: { state: "absent", reason: "the snapshot has no later matching run" },
    }).totalMatches, 0);
  });

  it("serves one redacted authority row without a title or person identifier", () => {
    const parsed = CrossDateSearchPageSchema.parse({
      wireVersion: 1,
      generatedAt: "2026-08-28T16:00:00.000Z",
      snapshot: {
        authorityGeneration: 19,
        order: "match-strength/enqueued-desc/run-id-asc:v2",
        token: "test-snapshot-token",
      },
      totalMatches: 1,
      coverage: { matched: 1, subjectUnavailable: 1, actorUnavailable: 1, candidateLimit: 10000 },
      results: [{
        runId: "00010001-0001-4001-8001-000100010001",
        traceId: "sp-160000-0001",
        workflowId: "separations",
        registration: {
          state: "registered",
          label: "Separations",
          code: "sp",
          categoryId: "separation",
        },
        partitionDay: "2026-08-28",
        state: "failed",
        shape: "single",
        dryRun: true,
        priority: "interactive",
        systems: ["kuali", "new-kronos", "ucpath"],
        runNumber: { state: "present", value: 7 },
        retryOf: { state: "absent", reason: "this run is not a retry" },
        enqueuedAt: "2026-08-28T15:00:00.000Z",
        endedAt: { state: "present", value: "2026-08-28T15:05:00.000Z" },
        match: { field: "workflow", strength: "exact" },
    metadata: { subject: { state: "unavailable", reason: "not-recorded" }, actor: { state: "unavailable", reason: "not-recorded" }, version: 1, failureCode: null, evidence: { receipt: false, failure: false, diagnostic: false } },
      }],
      nextCursor: { state: "absent", reason: "the snapshot has no later matching run" },
    });

    assert.equal(parsed.results[0]?.workflowId, "separations");
    assert.equal("title" in (parsed.results[0] ?? {}), false);
    assert.throws(
      () => CrossDateSearchPageSchema.parse({ ...parsed, totalMatches: 0 }),
      /totalMatches cannot be smaller than the returned result count/,
    );
  });
});

describe("cross-date search authority read", () => {
  it("ranks the corpus once per authority search", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-cross-date-ranked-pass-"));
    const database = AuthorityDatabase.open(
      { path: join(root, "authority.db"), busyTimeoutMs: 1_000, migrationOwner: "search-ranked-pass-test" },
      manualClock(new Date("2026-08-28T16:00:00.000Z")),
    );
    try {
      insertMeasuredSearchRun(database, { authorityPath: join(root, "authority.db"), seed: 89, enqueuedAt: "2026-08-28T15:00:00.000Z" });
      insertMeasuredSearchRun(database, { authorityPath: join(root, "authority.db"), seed: 90, enqueuedAt: "2026-08-28T14:00:00.000Z" });
      const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
      try {
        database.authority.runs.search({
          q: "separations",
          scope: "workflow",
          facets: {},
          limit: 1,
        });

        const rankedPasses = prepare.mock.calls.filter(([sql]) => (
          sql.includes("WITH ranked AS")
        )).length;
        assert.equal(rankedPasses, 1);
      } finally {
        prepare.mockRestore();
      }
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("admits current workflows beyond the measured corpus", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-cross-date-outside-corpus-"));
    const database = AuthorityDatabase.open(
      { path: join(root, "authority.db"), busyTimeoutMs: 1_000, migrationOwner: "search-outside-corpus-test" },
      manualClock(new Date("2026-08-28T16:00:00.000Z")),
    );
    database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    try {
      const run = runRecordOf({ seed: 87, enqueuedAt: "2026-08-28T15:00:00.000Z" });
      database.authority.runs.enqueue(run);

      const page = database.authority.runs.search({ q: run.envelope.runId, scope: "run", facets: {}, limit: 1 });
      assert.equal(page.totalMatches, 1);
      assert.equal(page.rows[0]?.record.envelope.workflow, "person-lookup");
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("admits all supported shapes, dry-run values and system dimensions", () => {
    const cases = [
      {
        label: "shape preview",
        run: queuedSearchCorpusCandidate({ seed: 84, shape: "preview" }),
        message: /has shape outside the closed D283 corpus/,
      },
      {
        label: "dry-run false",
        run: queuedSearchCorpusCandidate({ seed: 85, dryRun: false }),
        message: /has dry-run outside the closed D283 corpus/,
      },
      {
        label: "missing new-kronos",
        run: queuedSearchCorpusCandidate({
          seed: 86,
          resolvedInstance: { kuali: "prod", ucpath: "prod" },
        }),
        message: /has resolved systems outside the closed D283 corpus/,
      },
      {
        label: "extra crm",
        run: queuedSearchCorpusCandidate({
          seed: 82,
          resolvedInstance: { crm: "prod", kuali: "prod", "new-kronos": "prod", ucpath: "prod" },
        }),
        message: /has resolved systems outside the closed D283 corpus/,
      },
    ];

    for (const { label, run } of cases) {
      const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-cross-date-corpus-dimension-"));
      const database = AuthorityDatabase.open(
        { path: join(root, "authority.db"), busyTimeoutMs: 1_000, migrationOwner: "search-corpus-dimension-test" },
        manualClock(new Date("2026-08-28T16:00:00.000Z")),
      );
      database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
      try {
        database.authority.runs.enqueue(run);
        const page = database.authority.runs.search({ q: run.envelope.runId, scope: "run", facets: {}, limit: 1 });
        assert.equal(page.totalMatches, 1, label);
        assert.deepEqual(page.rows[0]?.record.envelope.resolvedInstance, run.envelope.resolvedInstance);
        assert.equal(page.rows[0]?.record.envelope.shape, run.envelope.shape);
        assert.equal(page.rows[0]?.record.envelope.dryRun, run.envelope.dryRun);
      } finally {
        database.close();
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("serves current queued lifecycle metadata", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-cross-date-corpus-state-"));
    const database = AuthorityDatabase.open(
      { path: join(root, "authority.db"), busyTimeoutMs: 1_000, migrationOwner: "search-corpus-state-test" },
      manualClock(new Date("2026-08-28T16:00:00.000Z")),
    );
    database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    try {
      const run = queuedSearchCorpusCandidate({ seed: 83 });
      database.authority.runs.enqueue(run);

      const page = database.authority.runs.search({ q: run.envelope.runId, scope: "run", facets: { state: "queued" }, limit: 1 });
      assert.equal(page.totalMatches, 1);
      assert.equal(page.rows[0]?.record.lifecycle.state, "queued");
      assert.equal(database.authority.runs.search({ q: run.envelope.runId, scope: "run", facets: { state: "running" }, limit: 1 }).totalMatches, 0);
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("authenticates complete retained actor sources and keeps frozen actors through genuine ordinary pruning", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-search-actor-"));
    const path=join(root,"authority.db"),clock=manualClock(new Date("2026-11-01T16:00:00.000Z"));
    const database=AuthorityDatabase.open({path,busyTimeoutMs:1000,migrationOwner:"search-actor-test"},clock);
    const raw=new DatabaseSync(path);
    try {
      const run=insertMeasuredSearchRun(database,{seed:983,enqueuedAt:"2026-08-01T16:00:00.000Z",authorityPath:path});
      const unrelated=insertMeasuredSearchRun(database,{seed:984,enqueuedAt:"2026-08-01T16:00:00.000Z",authorityPath:path});
      const e=run.envelope;
      const event=TimelineAppendSchema.parse({schemaVersion:1,eventId:randomUUID(),workflow:e.workflow,
        scope:{kind:"run",runId:e.runId},occurredAt:e.enqueuedAt,recordedAt:e.enqueuedAt,retentionDate:"2026-08-01",source:{kind:"native"},
        payload:{kind:"span",event:{t:"run.queued",kind:"run",pid:4242,ts:e.enqueuedAt,workflow:e.workflow,runId:e.runId,
          attempt:e.attempt,traceId:e.traceId,spanPath:e.traceId,itemId:e.itemId,shape:e.shape,priority:e.priority,dryRun:e.dryRun,
          actorId:"local-operator",title:"Synthetic actor source",descriptorVersion:e.descriptorVersion,contractFingerprint:e.contractFingerprint,
          resolvedInstance:e.resolvedInstance,configFingerprint:e.configFingerprint,configSnapshotId:e.configSnapshotId}}});
      database.authority.timelineEvents.append(event);
      const saved=z.object({actor_source_json:z.string(),metadata_json:z.string(),actor_id:z.string()}).parse(raw.prepare("SELECT actor_source_json,metadata_json,actor_id FROM run_search WHERE run_id=?").get(e.runId));
      for(const fault of ["erase","forge"] as const) {
        if(fault === "erase")raw.prepare("UPDATE run_search SET actor_source_json=NULL,actor_id=NULL,metadata_json=json_set(metadata_json,'$.metadata.actor',json(?)) WHERE run_id=?")
          .run('{"state":"unavailable","reason":"not-recorded"}',e.runId);
        else raw.prepare("UPDATE run_search SET actor_source_json=json_set(actor_source_json,'$[0].event.payload.event.actorId','forged-actor'),actor_id='forged-actor',metadata_json=json_set(metadata_json,'$.metadata.actor.value','forged-actor') WHERE run_id=?").run(e.runId);
        const generation=database.getMeta().authorityGeneration;
        assert.throws(()=>database.authority.runs.search({q:"NONMATCH",scope:"run",facets:{},limit:1}),/run-search-index-rebuild-required/u);
        assert.equal(database.getMeta().authorityGeneration,generation);
        raw.prepare("UPDATE run_search SET actor_source_json=?,actor_id=?,metadata_json=? WHERE run_id=?").run(saved.actor_source_json,saved.actor_id,saved.metadata_json,e.runId);
      }
      const before=database.authority.runs.search({q:e.runId,scope:"run",facets:{},limit:1});
      assert.equal(before.rows[0]?.metadata.actor.state,"available");
      const validBytes=[readFileSync(path),readFileSync(`${path}-wal`)];
      const validGeneration=database.getMeta().authorityGeneration;
      assert.equal(AuthorityDatabase.inspectExistingReadOnly(path).authorityGeneration,validGeneration);
      const readOnly=AuthorityDatabase.open({path,busyTimeoutMs:1000,openMode:"storage-doctor-read-only-no-migrate",migrationOwner:"search-readonly"},clock);
      try { assert.deepEqual(readOnly.authority.runs.search({q:e.runId,scope:"run",facets:{},limit:1}),before); }
      finally { readOnly.close(); }
      assert.deepEqual([readFileSync(path),readFileSync(`${path}-wal`)],validBytes);
      assert.equal(database.getMeta().authorityGeneration,validGeneration);
      const pinned=database.authority.timelineEvents.get(event.eventId);assert.ok(pinned);
      const debug=TimelineAppendSchema.parse({schemaVersion:1,eventId:randomUUID(),scope:{kind:"transport",connectionId:"synthetic-completed-request"},occurredAt:e.enqueuedAt,recordedAt:e.enqueuedAt,retentionDate:"2026-08-01",source:{kind:"native"},payload:{kind:"debug",event:{category:"http",phase:"settled",correlationId:"synthetic-completed-request",method:"GET",route:"/api/v1/health",status:200,build:"test",pid:4242}}});
      database.authority.timelineEvents.append(debug);
      assert.equal(database.authority.timelineEvents.pruneBefore("2026-10-01"),1);
      assert.equal(database.authority.timelineEvents.get(debug.eventId),undefined);
      assert.deepEqual(database.authority.timelineEvents.get(event.eventId),pinned);
      assert.deepEqual(database.authority.runs.search({q:e.runId,scope:"run",facets:{},limit:1}),before);
      for(const fault of ["erase","forge"] as const) {
        if(fault === "erase")raw.prepare("UPDATE run_search SET actor_source_json=NULL,actor_id=NULL,metadata_json=json_set(metadata_json,'$.metadata.actor',json(?)) WHERE run_id=?")
          .run('{"state":"unavailable","reason":"not-recorded"}',e.runId);
        else raw.prepare("UPDATE run_search SET actor_source_json=json_set(actor_source_json,'$[0].event.payload.event.actorId','forged-actor'),actor_id='forged-actor',metadata_json=json_set(metadata_json,'$.metadata.actor.value','forged-actor') WHERE run_id=?").run(e.runId);
        const generation=database.getMeta().authorityGeneration;
        const unrelatedBefore=database.authority.runs.get(unrelated.envelope.runId);assert.ok(unrelatedBefore);
        const sourceBefore=raw.prepare("SELECT * FROM timeline_events ORDER BY cursor").all();
        assert.throws(()=>database.authority.runs.search({q:"NONMATCH",scope:"run",facets:{actor:"nonmatching-actor"},limit:1}),/run-search-index-rebuild-required/u);
        assert.throws(()=>database.authority.runs.updatePresentation({runId:unrelated.envelope.runId,expectedVersion:unrelated.version,displayName:"Must not mutate",now:clock.now().toISOString()}),/run-search-retained-actor-source-mismatch/u);
        assert.deepEqual(database.authority.runs.get(unrelated.envelope.runId),unrelatedBefore);
        assert.equal(database.getMeta().authorityGeneration,generation);
        assert.deepEqual(raw.prepare("SELECT * FROM timeline_events ORDER BY cursor").all(),sourceBefore);
        assert.throws(()=>{
          const unexpected=AuthorityDatabase.open({path,busyTimeoutMs:1000,migrationOwner:"search-post-prune-corrupt-reopen"},clock);
          unexpected.close();
        },/run-search-retained-actor-source-mismatch/u);
        const corruptBytes=[readFileSync(path),readFileSync(`${path}-wal`)];
        assert.throws(()=>AuthorityDatabase.inspectExistingReadOnly(path),/run-search-retained-actor-source-mismatch/u);
        assert.throws(()=>{
          const unexpected=AuthorityDatabase.open({path,busyTimeoutMs:1000,openMode:"storage-doctor-read-only-no-migrate",migrationOwner:"search-corrupt-readonly"},clock);
          unexpected.close();
        },/run-search-retained-actor-source-mismatch/u);
        assert.deepEqual([readFileSync(path),readFileSync(`${path}-wal`)],corruptBytes);
        assert.equal(database.getMeta().authorityGeneration,generation);
        raw.prepare("UPDATE run_search SET actor_source_json=?,actor_id=?,metadata_json=? WHERE run_id=?").run(saved.actor_source_json,saved.actor_id,saved.metadata_json,e.runId);
      }
      const reopened=AuthorityDatabase.open({path,busyTimeoutMs:1000,migrationOwner:"search-post-prune-genuine-reopen"},clock);
      try { assert.deepEqual(reopened.authority.runs.search({q:e.runId,scope:"run",facets:{},limit:1}),before); }
      finally { reopened.close(); }
    } finally { raw.close();database.close();rmSync(root,{recursive:true,force:true}); }
  });

  it("admits genuine peer commits and refuses raw corruption masked by generation changes or another mutation", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-search-peer-"));
    const path = join(root, "authority.db"), clock = manualClock(new Date("2026-08-28T16:00:00.000Z"));
    const database = AuthorityDatabase.open({ path, busyTimeoutMs: 1000, migrationOwner: "search-peer-test" }, clock);
    const raw = new DatabaseSync(path);
    let peer: AuthorityDatabase | undefined;
    try {
      const first = insertMeasuredSearchRun(database, { authorityPath: path, seed: 91 });
      const second = insertMeasuredSearchRun(database, { authorityPath: path, seed: 92 });
      const search = () => database.authority.runs.search({ q: "", scope: "run", facets: {}, limit: 10 });
      assert.equal(search().totalMatches, 2);
      peer = AuthorityDatabase.open({ path, busyTimeoutMs: 1000, migrationOwner: "search-genuine-peer" }, clock);
      const advance = () => {
        const current = peer?.authority.runs.get(first.envelope.runId);
        assert.ok(current);
        return peer?.authority.runs.advanceRevision({ runId: current.envelope.runId, expectedVersion: current.version, now: clock.now().toISOString() });
      };
      assert.equal(advance()?.state, "applied");
      assert.equal(search().rows.find(row => row.record.envelope.runId === first.envelope.runId)?.record.version, first.version + 1);
      const ownBefore = database.getMeta(), beforeRows = raw.prepare("SELECT * FROM runs ORDER BY id").all();
      corruptRunSource(raw, "UPDATE runs SET workflow=? WHERE id=?", "person-lookup", second.envelope.runId);
      const corrupted = raw.prepare("SELECT * FROM runs ORDER BY id").all();
      assert.throws(advance, /authority table runs failed native record validation: run row workflow does not match its whole-record JSON/u);
      assert.throws(() => database.authority.runs.advanceRevision({ runId: first.envelope.runId,
        expectedVersion: first.version + 1, now: clock.now().toISOString() }), /authority table runs failed native record validation: run row workflow does not match its whole-record JSON/u);
      assert.deepEqual(raw.prepare("SELECT * FROM runs ORDER BY id").all(), corrupted);
      assert.deepEqual(database.getMeta(), ownBefore, "refused peer and own mutations cannot launder the changed source");
      raw.exec("UPDATE database_states SET authority_generation=authority_generation+1,search_generation=search_generation+1");
      assert.throws(() => database.authority.runs.search({ q: "NONMATCH", scope: "run", facets: { workflow: "separations" }, limit: 1 }), /run-search-index-rebuild-required/);
      corruptRunSource(raw, "UPDATE runs SET workflow=? WHERE id=?", second.envelope.workflow, second.envelope.runId);
      raw.prepare("UPDATE database_states SET authority_generation=?,search_generation=?").run(ownBefore.authorityGeneration, ownBefore.authorityGeneration);
      assert.deepEqual(raw.prepare("SELECT * FROM runs ORDER BY id").all(), beforeRows);
      assert.equal(search().totalMatches, 2);
    } finally { peer?.close(); raw.close(); database.close(); rmSync(root, { recursive: true, force: true }); }
  });

  it("keeps a pinned search snapshot coherent across peer commits and preserves rollback admission", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-search-pinned-"));
    const path = join(root, "authority.db"), clock = manualClock(new Date("2026-08-28T16:00:00.000Z"));
    const database = AuthorityDatabase.open({ path, busyTimeoutMs: 1000, migrationOwner: "search-pinned-test" }, clock);
    let peer: AuthorityDatabase | undefined;
    try {
      const run = insertMeasuredSearchRun(database, { authorityPath: path, seed: 93 });
      const search = () => database.authority.runs.search({ q: run.envelope.runId, scope: "run", facets: {}, limit: 1 });
      peer = AuthorityDatabase.open({ path, busyTimeoutMs: 1000, migrationOwner: "search-pinned-peer" }, clock);
      database.withAuthorityReadSnapshot(() => {
        const before = search(), generation = database.getMeta().authorityGeneration;
        const applied = peer?.authority.runs.advanceRevision({ runId: run.envelope.runId, expectedVersion: run.version, now: clock.now().toISOString() });
        assert.equal(applied?.state, "applied");
        assert.deepEqual(search(), before);
        assert.equal(database.getMeta().authorityGeneration, generation);
      });
      assert.equal(search().rows[0]?.record.version, run.version + 1);
      const before = search(), generation = database.getMeta().authorityGeneration;
      const fault = new Error("rollback-search-admission");
      assert.throws(() => database.withAuthorityTransaction(repositories => {
        const applied = repositories.runs.advanceRevision({ runId: run.envelope.runId, expectedVersion: run.version + 1, now: clock.now().toISOString() });
        assert.equal(applied.state, "applied");
        throw fault;
      }), error => error === fault);
      assert.deepEqual(search(), before);
      assert.equal(database.getMeta().authorityGeneration, generation);
    } finally { peer?.close(); database.close(); rmSync(root, { recursive: true, force: true }); }
  });

  it("refuses invalidated publication before facets or matching", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-cross-date-corpus-"));
    const databasePath = join(root, "authority.db");
    const database = AuthorityDatabase.open(
      { path: databasePath, busyTimeoutMs: 1_000, migrationOwner: "search-corpus-test" },
      manualClock(new Date("2026-08-28T16:00:00.000Z")),
    );
    const raw = new DatabaseSync(databasePath);
    try {
      const run = insertMeasuredSearchRun(database, { authorityPath: join(root, "authority.db"), seed: 88, enqueuedAt: "2026-08-28T15:00:00.000Z" });
      const search = (input: unknown): unknown => database.authority.runs.search(input);
      assert.equal(database.authority.runs.search({
        q: run.envelope.runId,
        scope: "run",
        facets: {},
        limit: 1,
      }).totalMatches, 1, "the clean corpus must be read once before out-of-band corruption");

      corruptRunSource(raw, "UPDATE runs SET workflow = ? WHERE id = ?", "person-lookup", run.envelope.runId);
      assert.throws(
        () => search({
          q: "does-not-match-any-run",
          scope: "run",
          facets: { workflow: "separations" },
          limit: 1,
        }),
        /run-search-index-rebuild-required/,
      );
      corruptRunSource(raw, "UPDATE runs SET workflow = ? WHERE id = ?", "separations", run.envelope.runId);
      database.rebuildRunSearchIndex({ restart: true });
      assert.equal(database.authority.runs.search({ q: "separations", scope: "workflow", facets: {}, limit: 1 }).totalMatches, 1);

      corruptRunSource(raw, "UPDATE runs SET created_at = ? WHERE id = ?", "2026-08-27T15:00:00.000Z", run.envelope.runId);
      assert.throws(
        () => search({
          q: "does-not-match-any-run",
          scope: "run",
          facets: {
            day: {
              startsAt: "2026-08-28T07:00:00.000Z",
              endsBefore: "2026-08-29T07:00:00.000Z",
            },
          },
          limit: 1,
        }),
        /run-search-index-rebuild-required/,
      );
      corruptRunSource(raw, "UPDATE runs SET created_at = ? WHERE id = ?", run.createdAt, run.envelope.runId);
      database.rebuildRunSearchIndex({ restart: true });
      assert.equal(database.authority.runs.search({ q: "separations", scope: "workflow", facets: {}, limit: 1 }).totalMatches, 1);

      corruptRunSource(raw, "UPDATE runs SET envelope_json = json_set(envelope_json, '$.traceId', ?) WHERE id = ?",
        "sp-sensitive-10873698-fragment", run.envelope.runId);
      let nonMatchMessage = "";
      assert.throws(
        () => search({ q: "does-not-match-any-run", scope: "trace", facets: {}, limit: 1 }),
        (error) => {
          nonMatchMessage = error instanceof Error ? error.message : String(error);
          return /run-search-index-rebuild-required/.test(nonMatchMessage);
        },
      );
      assert.throws(
        () => search({ q: "10873698", scope: "trace", facets: {}, limit: 1 }),
        (error) => (error instanceof Error ? error.message : String(error)) === nonMatchMessage,
        "a sensitive raw trace substring must not change the corruption refusal",
      );
    } finally {
      raw.close();
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses searchable columns that disagree with the strict run authority", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-cross-date-columns-"));
    const databasePath = join(root, "authority.db");
    const database = AuthorityDatabase.open(
      { path: databasePath, busyTimeoutMs: 1_000, migrationOwner: "search-columns-test" },
      manualClock(new Date("2026-08-28T16:00:00.000Z")),
    );
    const raw = new DatabaseSync(databasePath);
    try {
      const run = insertMeasuredSearchRun(database, { authorityPath: join(root, "authority.db"), seed: 89, enqueuedAt: "2026-08-28T15:00:00.000Z" });
      const searchExactRun = (facets: unknown): unknown => database.authority.runs.search({
        q: run.envelope.runId,
        scope: "run",
        facets,
        limit: 1,
      });

      corruptRunSource(raw, "UPDATE runs SET workflow = ? WHERE id = ?", "person-lookup", run.envelope.runId);
      assert.throws(
        () => searchExactRun({ workflow: "separations" }),
        /run-search-index-rebuild-required/,
      );
      corruptRunSource(raw, "UPDATE runs SET workflow = ? WHERE id = ?", "separations", run.envelope.runId);
      database.rebuildRunSearchIndex({ restart: true });
      assert.equal(database.authority.runs.search({ q: "separations", scope: "workflow", facets: {}, limit: 1 }).totalMatches, 1);

      corruptRunSource(raw, "UPDATE runs SET state = ?, outcome = ? WHERE id = ?", "terminal", "done", run.envelope.runId);
      assert.throws(
        () => searchExactRun({ state: "parked-gate" }),
        /run-search-index-rebuild-required/,
      );
      corruptRunSource(raw, "UPDATE runs SET state = ?, outcome = ? WHERE id = ?", run.lifecycle.state, null, run.envelope.runId);
      database.rebuildRunSearchIndex({ restart: true });
      assert.equal(database.authority.runs.search({ q: "separations", scope: "workflow", facets: {}, limit: 1 }).totalMatches, 1);

      corruptRunSource(raw, "UPDATE runs SET priority = ? WHERE id = ?", "bulk", run.envelope.runId);
      assert.throws(
        () => searchExactRun({}),
        /run-search-index-rebuild-required/,
      );
    } finally {
      raw.close();
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a strict run record whose authority order instant is foreign", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-cross-date-malformed-"));
    const databasePath = join(root, "authority.db");
    const database = AuthorityDatabase.open(
      { path: databasePath, busyTimeoutMs: 1_000, migrationOwner: "search-malformed-test" },
      manualClock(new Date("2026-08-28T16:00:00.000Z")),
    );
    const raw = new DatabaseSync(databasePath);
    try {
      const run = insertMeasuredSearchRun(database, { authorityPath: join(root, "authority.db"), seed: 90, enqueuedAt: "2026-08-28T15:00:00.000Z" });
      const malformed = RunRecordSchema.parse({
        ...run,
        createdAt: "2026-08-28T15:01:00.000Z",
        updatedAt: "2026-08-28T15:01:00.000Z",
      });
      const { envelope, ...lifecycle } = malformed;
      corruptRunSource(raw, "UPDATE runs SET envelope_json = ?, lifecycle_json = ? WHERE id = ?",
        canonicalJsonStringify(envelope), canonicalJsonStringify(lifecycle), run.envelope.runId);

      assert.throws(
        () => database.authority.runs.search({
          q: "separations",
          scope: "workflow",
          facets: {},
          limit: 1,
        }),
        /run-search-index-rebuild-required/,
      );
    } finally {
      raw.close();
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns a bounded page in stable match, time, and run-id order", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-cross-date-search-"));
    const database = AuthorityDatabase.open(
      { path: join(root, "authority.db"), busyTimeoutMs: 1_000, migrationOwner: "search-test" },
      manualClock(new Date("2026-08-28T16:00:00.000Z")),
    );
    try {
      const oldestSecondById = insertMeasuredSearchRun(
        database,
        { authorityPath: join(root, "authority.db"), seed: 2, enqueuedAt: "2026-08-27T12:00:00.000Z" },
      );
      const newest = insertMeasuredSearchRun(
        database,
        { authorityPath: join(root, "authority.db"), seed: 3, enqueuedAt: "2026-08-28T12:00:00.000Z" },
      );
      const oldestFirstById = insertMeasuredSearchRun(
        database,
        { authorityPath: join(root, "authority.db"), seed: 1, enqueuedAt: "2026-08-27T12:00:00.000Z" },
      );

      const page = database.authority.runs.search({
        q: "separations",
        scope: "all",
        facets: {},
        limit: 3,
      });

      assert.equal(page.totalMatches, 3);
      assert.deepEqual(page.rows.map(({ record }) => record.envelope.runId), [
        newest.envelope.runId,
        oldestFirstById.envelope.runId,
        oldestSecondById.envelope.runId,
      ]);
      assert.deepEqual(page.rows.map(({ matchRank }) => matchRank), [2, 2, 2]);

      const exhausted = database.authority.runs.search({
        q: "separations",
        scope: "all",
        facets: {},
        limit: 3,
        after: {
          matchRank: 2,
          enqueuedAt: oldestSecondById.envelope.enqueuedAt,
          runId: oldestSecondById.envelope.runId,
        },
      });
      assert.deepEqual(exhausted, { totalMatches: 3, coverage: { matched: 3, subjectUnavailable: 3, actorUnavailable: 3, candidateLimit: 10000 }, rows: [] });

      const exactRun = database.authority.runs.search({
        q: newest.envelope.runId,
        scope: "run",
        facets: {},
        limit: 1,
      });
      assert.equal(exactRun.totalMatches, 1);
      assert.equal(exactRun.rows[0]?.matchRank, 0);
      const exactTrace = database.authority.runs.search({
        q: newest.envelope.traceId,
        scope: "trace",
        facets: {},
        limit: 1,
      });
      assert.equal(exactTrace.totalMatches, 1);
      assert.equal(exactTrace.rows[0]?.matchRank, 1);
      assert.equal(database.authority.runs.search({
        q: "separations",
        scope: "run",
        facets: {},
        limit: 1,
      }).totalMatches, 0, "a workflow match cannot leak through run-only scope");

      const measuredFacets = database.authority.runs.search({
        q: "separations",
        scope: "workflow",
        facets: {
          workflow: "separations",
          day: {
            startsAt: "2026-08-28T07:00:00.000Z",
            endsBefore: "2026-08-29T07:00:00.000Z",
          },
          state: "parked-gate",
          shape: "single",
          dryRun: true,
          system: "ucpath",
        },
        limit: 2,
      });
      assert.equal(measuredFacets.totalMatches, 1);
      assert.equal(measuredFacets.rows[0]?.record.envelope.runId, newest.envelope.runId);
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("cross-date search service", () => {
  it("accepts cursors only from the same BFF process signer", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-cross-date-signer-"));
    const clock = manualClock(new Date("2026-08-28T16:00:00.000Z"));
    const database = AuthorityDatabase.open(
      { path: join(root, "authority.db"), busyTimeoutMs: 1_000, migrationOwner: "search-signer-test" },
      clock,
    );
    try {
      insertMeasuredSearchRun(database, { authorityPath: join(root, "authority.db"), seed: 41, enqueuedAt: "2026-08-28T15:00:00.000Z" });
      const second = insertMeasuredSearchRun(database, { authorityPath: join(root, "authority.db"), seed: 42, enqueuedAt: "2026-08-27T15:00:00.000Z" });
      insertMeasuredSearchRun(database, { authorityPath: join(root, "authority.db"), seed: 43, enqueuedAt: "2026-08-26T15:00:00.000Z" });
      const signer = new Uint8Array(32).fill(0x41);
      const service = createCrossDateSearchService({
        clock,
        sourceIdentity: database.getSourceDatabaseIdentity(),
        cursorSigningKey: signer,
        descriptors: { resolve: resolveMeasuredSearchDescriptor },
        authority: {
          readSnapshot: (read) => database.withAuthorityReadSnapshot(() => read({
            authorityGeneration: database.getMeta().authorityGeneration,
            searchRuns: (input) => database.authority.runs.search(input),
          })),
        },
      });
      const firstPage = service.search({ q: "separations", limit: 1 });
      if (firstPage.nextCursor.state !== "present") {
        throw new Error("three matching runs must produce a continuation cursor");
      }
      const cursor = firstPage.nextCursor.value;
      const forged = forgeCursorWithDisclosedSource(cursor, {
        enqueuedAt: second.envelope.enqueuedAt,
        runId: second.envelope.runId,
      });

      assert.throws(
        () => service.search({ q: "separations", limit: 1, cursor: forged }),
        /cursor signature.*different BFF process or was modified/,
      );

      const restarted = createCrossDateSearchService({
        clock,
        sourceIdentity: database.getSourceDatabaseIdentity(),
        cursorSigningKey: new Uint8Array(32).fill(0x42),
        descriptors: { resolve: resolveMeasuredSearchDescriptor },
        authority: {
          readSnapshot: (read) => database.withAuthorityReadSnapshot(() => read({
            authorityGeneration: database.getMeta().authorityGeneration,
            searchRuns: (input) => database.authority.runs.search(input),
          })),
        },
      });
      assert.throws(
        () => restarted.search({ q: "separations", limit: 1, cursor }),
        /cursor signature.*different BFF process or was modified/,
      );

      const foreignAuthority = createCrossDateSearchService({
        clock,
        sourceIdentity: "f".repeat(64),
        cursorSigningKey: signer,
        descriptors: { resolve: resolveMeasuredSearchDescriptor },
        authority: {
          readSnapshot: (read) => database.withAuthorityReadSnapshot(() => read({
            authorityGeneration: database.getMeta().authorityGeneration,
            searchRuns: (input) => database.authority.runs.search(input),
          })),
        },
      });
      assert.throws(
        () => foreignAuthority.search({ q: "separations", limit: 1, cursor }),
        /cursor belongs to a foreign authority source/,
      );
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("normalizes offset instants across a Pacific DST day and keyset pages", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-cross-date-offsets-"));
    const clock = manualClock(new Date("2026-11-02T12:00:00.000Z"));
    const database = AuthorityDatabase.open(
      { path: join(root, "authority.db"), busyTimeoutMs: 1_000, migrationOwner: "search-offset-test" },
      clock,
    );
    try {
      const middle = insertMeasuredSearchRun(
        database,
        { authorityPath: join(root, "authority.db"), seed: 32, enqueuedAt: "2026-11-01T01:30:00.000-07:00" },
      );
      const outsideDay = insertMeasuredSearchRun(
        database,
        { authorityPath: join(root, "authority.db"), seed: 34, enqueuedAt: "2026-11-02T07:30:00.000-02:00" },
      );
      const oldest = insertMeasuredSearchRun(
        database,
        { authorityPath: join(root, "authority.db"), seed: 33, enqueuedAt: "2026-10-31T23:30:00.000-08:00" },
      );
      const newest = insertMeasuredSearchRun(
        database,
        { authorityPath: join(root, "authority.db"), seed: 31, enqueuedAt: "2026-11-01T01:15:00.000-08:00" },
      );
      const search = createCrossDateSearchService({
        clock,
        sourceIdentity: database.getSourceDatabaseIdentity(),
        cursorSigningKey: TEST_CURSOR_SIGNING_KEY,
        descriptors: { resolve: resolveMeasuredSearchDescriptor },
        authority: {
          readSnapshot: (read) => database.withAuthorityReadSnapshot(() => read({
            authorityGeneration: database.getMeta().authorityGeneration,
            searchRuns: (input) => database.authority.runs.search(input),
          })),
        },
      });

      const first = search.search({
        q: "separations",
        facets: { day: "2026-11-01" },
        limit: 1,
      });
      assert.equal(first.totalMatches, 3);
      assert.equal(first.results[0]?.runId, newest.envelope.runId);
      assert.equal(first.results[0]?.enqueuedAt, "2026-11-01T09:15:00.000Z");
      assert.equal(first.results[0]?.partitionDay, "2026-11-01");
      if (first.nextCursor.state !== "present") {
        throw new Error("the first normalized page must carry a continuation");
      }

      const second = search.search({
        q: "separations",
        facets: { day: "2026-11-01" },
        limit: 1,
        cursor: first.nextCursor.value,
      });
      assert.equal(second.results[0]?.runId, middle.envelope.runId);
      assert.equal(second.results[0]?.enqueuedAt, "2026-11-01T08:30:00.000Z");
      if (second.nextCursor.state !== "present") {
        throw new Error("the second normalized page must carry a continuation");
      }

      const third = search.search({
        q: "separations",
        facets: { day: "2026-11-01" },
        limit: 1,
        cursor: second.nextCursor.value,
      });
      assert.equal(third.results[0]?.runId, oldest.envelope.runId);
      assert.equal(third.results[0]?.enqueuedAt, "2026-11-01T07:30:00.000Z");
      assert.equal(third.nextCursor.state, "absent");
      assert.equal(third.results.some(({ runId }) => runId === outsideDay.envelope.runId), false);
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("projects authoritative descriptor registration from one exact authority snapshot", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-cross-date-service-"));
    const clock = manualClock(new Date("2026-08-28T16:00:00.000Z"));
    const database = AuthorityDatabase.open(
      { path: join(root, "authority.db"), busyTimeoutMs: 1_000, migrationOwner: "search-service-test" },
      clock,
    );
    try {
      const run = insertMeasuredSearchRun(database, { authorityPath: join(root, "authority.db"),
        seed: 7,
        runNumber: 7,
        enqueuedAt: "2026-08-28T15:00:00.000Z",
      });
      const search = createCrossDateSearchService({
        clock,
        sourceIdentity: database.getSourceDatabaseIdentity(),
        cursorSigningKey: TEST_CURSOR_SIGNING_KEY,
        descriptors: {
          resolve: (workflowId) => workflowId === separationsDescriptor.id ? separationsDescriptor : undefined,
        },
        authority: {
          readSnapshot: (read) => database.withAuthorityReadSnapshot(() => read({
            authorityGeneration: database.getMeta().authorityGeneration,
            searchRuns: (input) => database.authority.runs.search(input),
          })),
        },
      });

      const page = search.search({ q: "separations", limit: 1 });

      assert.equal(page.totalMatches, 1);
      assert.equal(page.results[0]?.runId, run.envelope.runId);
      assert.deepEqual(page.results[0]?.registration, {
        state: "registered",
        label: "Separations",
        code: "sp",
        categoryId: "separation",
      });
      assert.equal("title" in (page.results[0] ?? {}), false);
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("continues the stable order with an opaque cursor", () => {
    const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-cross-date-cursor-"));
    const clock = manualClock(new Date("2026-08-28T16:00:00.000Z"));
    const database = AuthorityDatabase.open(
      { path: join(root, "authority.db"), busyTimeoutMs: 1_000, migrationOwner: "search-cursor-test" },
      clock,
    );
    try {
      const first = insertMeasuredSearchRun(database, { authorityPath: join(root, "authority.db"), seed: 11, enqueuedAt: "2026-08-28T15:00:00.000Z" });
      const second = insertMeasuredSearchRun(database, { authorityPath: join(root, "authority.db"), seed: 12, enqueuedAt: "2026-08-28T14:00:00.000Z" });
      const search = createCrossDateSearchService({
        clock,
        sourceIdentity: database.getSourceDatabaseIdentity(),
        cursorSigningKey: TEST_CURSOR_SIGNING_KEY,
        descriptors: { resolve: resolveMeasuredSearchDescriptor },
        authority: {
          readSnapshot: (read) => database.withAuthorityReadSnapshot(() => read({
            authorityGeneration: database.getMeta().authorityGeneration,
            searchRuns: (input) => database.authority.runs.search(input),
          })),
        },
      });

      const baseQuery = {
        q: "separations",
        scope: "all",
        facets: {
          workflow: "separations",
          day: "2026-08-28",
          state: "parked-gate",
          shape: "single",
          dryRun: true,
          system: "ucpath",
        },
        limit: 1,
      };
      const firstPage = search.search(baseQuery);
      assert.equal(firstPage.results[0]?.runId, first.envelope.runId);
      assert.equal(firstPage.nextCursor.state, "present");
      if (firstPage.nextCursor.state !== "present") return;
      const cursorValue = firstPage.nextCursor.value;

      assert.throws(
        () => search.search({ ...baseQuery, q: "person", cursor: cursorValue }),
        /cursor belongs to a different query/,
      );
      const changedBindings = [
        { binding: "scope", query: { ...baseQuery, scope: "workflow" } },
        {
          binding: "workflow facet",
          query: {
            ...baseQuery,
            facets: {
              day: baseQuery.facets.day,
              state: baseQuery.facets.state,
              shape: baseQuery.facets.shape,
              dryRun: baseQuery.facets.dryRun,
              system: baseQuery.facets.system,
            },
          },
        },
        {
          binding: "day facet",
          query: { ...baseQuery, facets: { ...baseQuery.facets, day: "2026-08-27" } },
        },
        {
          binding: "state facet",
          query: { ...baseQuery, facets: { ...baseQuery.facets, state: "failed" } },
        },
        {
          binding: "shape facet",
          query: {
            ...baseQuery,
            facets: {
              workflow: baseQuery.facets.workflow,
              day: baseQuery.facets.day,
              state: baseQuery.facets.state,
              dryRun: baseQuery.facets.dryRun,
              system: baseQuery.facets.system,
            },
          },
        },
        {
          binding: "dry-run facet",
          query: {
            ...baseQuery,
            facets: {
              workflow: baseQuery.facets.workflow,
              day: baseQuery.facets.day,
              state: baseQuery.facets.state,
              shape: baseQuery.facets.shape,
              system: baseQuery.facets.system,
            },
          },
        },
        {
          binding: "system facet",
          query: { ...baseQuery, facets: { ...baseQuery.facets, system: "kuali" } },
        },
        { binding: "page limit", query: { ...baseQuery, limit: 2 } },
      ];
      for (const { binding, query } of changedBindings) {
        assert.throws(
          () => search.search({ ...query, cursor: cursorValue }),
          /cursor belongs to a different query/,
          `cursor must bind ${binding}`,
        );
      }
      assert.throws(
        () => search.search({ ...baseQuery, cursor: "not-a-cursor" }),
        /cursor.*malformed/,
      );
      const foreignAuthority = createCrossDateSearchService({
        clock,
        sourceIdentity: "f".repeat(64),
        cursorSigningKey: TEST_CURSOR_SIGNING_KEY,
        descriptors: { resolve: resolveMeasuredSearchDescriptor },
        authority: {
          readSnapshot: (read) => database.withAuthorityReadSnapshot(() => read({
            authorityGeneration: database.getMeta().authorityGeneration,
            searchRuns: (input) => database.authority.runs.search(input),
          })),
        },
      });
      assert.throws(
        () => foreignAuthority.search({ ...baseQuery, cursor: cursorValue }),
        /cursor belongs to a foreign authority source/,
      );

      const secondPage = search.search({
        ...baseQuery,
        cursor: cursorValue,
      });
      assert.equal(secondPage.results[0]?.runId, second.envelope.runId);
      assert.equal(secondPage.nextCursor.state, "absent");
      assert.equal(secondPage.totalMatches, 2);

      insertMeasuredSearchRun(database, { authorityPath: join(root, "authority.db"),
        seed: 13,
        enqueuedAt: "2026-08-26T15:00:00.000Z",
      });
      assert.throws(
        () => search.search({ ...baseQuery, cursor: cursorValue }),
        /cursor names authority generation .*current snapshot is generation/,
      );
    } finally {
      database.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
