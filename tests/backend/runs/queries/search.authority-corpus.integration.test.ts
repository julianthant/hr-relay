import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { measuredSearchService } from "../../../support/helpers/backend/cross-date-search-harness.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, it, vi } from "vitest";
import { z } from "zod";
import { RunRecordSchema, type RunRecord } from "../../../../src/models/run/record.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { SANITIZED_CROSS_DATE_SEARCH_CORPUS } from "../../../support/fixtures/cross-date-search-corpus.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { insertMeasuredSearchRun } from "../../../support/helpers/backend/cross-date-search-harness.js";
import { runRecordOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { separationsDescriptor } from "../../../support/helpers/registered-workflows.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

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
  generatedAt: z.string(),
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
});

describe("cross-date search authority read", () => {
  it("ranks the corpus once per authority search", () => {
    const profile = createBoundProfileFixture();
    const database = AuthorityDatabase.open(
      { path: profile.path, busyTimeoutMs: 1_000, migrationOwner: "search-ranked-pass-test" },
      manualClock(new Date("2026-08-28T16:00:00.000Z")),
    );
    try {
      insertMeasuredSearchRun(database, { authorityPath: profile.path, seed: 89, enqueuedAt: "2026-08-28T15:00:00.000Z" });
      insertMeasuredSearchRun(database, { authorityPath: profile.path, seed: 90, enqueuedAt: "2026-08-28T14:00:00.000Z" });
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
      profile.close();
    }
  });

  it("admits current workflows beyond the measured corpus", () => {
    const profile = createBoundProfileFixture();
    const database = AuthorityDatabase.open(
      { path: profile.path, busyTimeoutMs: 1_000, migrationOwner: "search-outside-corpus-test" },
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
      profile.close();
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
      const profile = createBoundProfileFixture();
      const database = AuthorityDatabase.open(
        { path: profile.path, busyTimeoutMs: 1_000, migrationOwner: "search-corpus-dimension-test" },
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
        profile.close();
      }
    }
  });

  it("serves current queued lifecycle metadata", () => {
    const profile = createBoundProfileFixture();
    const database = AuthorityDatabase.open(
      { path: profile.path, busyTimeoutMs: 1_000, migrationOwner: "search-corpus-state-test" },
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
      profile.close();
    }
  });

  it("admits genuine peer commits and refuses raw corruption masked by generation changes or another mutation", () => {
    const profile = createBoundProfileFixture();
    const path = profile.path, clock = manualClock(new Date("2026-08-28T16:00:00.000Z"));
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
    } finally { peer?.close(); raw.close(); database.close(); profile.close(); }
  });

  it("keeps a pinned search snapshot coherent across peer commits and preserves rollback admission", () => {
    const profile = createBoundProfileFixture();
    const path = profile.path, clock = manualClock(new Date("2026-08-28T16:00:00.000Z"));
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
    } finally { peer?.close(); database.close(); profile.close(); }
  });

  it("refuses invalidated publication before facets or matching", () => {
    const profile = createBoundProfileFixture();
    const databasePath = profile.path;
    const database = AuthorityDatabase.open(
      { path: databasePath, busyTimeoutMs: 1_000, migrationOwner: "search-corpus-test" },
      manualClock(new Date("2026-08-28T16:00:00.000Z")),
    );
    const raw = new DatabaseSync(databasePath);
    try {
      const run = insertMeasuredSearchRun(database, { authorityPath: profile.path, seed: 88, enqueuedAt: "2026-08-28T15:00:00.000Z" });
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
      profile.close();
    }
  });

  it("refuses searchable columns that disagree with the strict run authority", () => {
    const profile = createBoundProfileFixture();
    const databasePath = profile.path;
    const database = AuthorityDatabase.open(
      { path: databasePath, busyTimeoutMs: 1_000, migrationOwner: "search-columns-test" },
      manualClock(new Date("2026-08-28T16:00:00.000Z")),
    );
    const raw = new DatabaseSync(databasePath);
    try {
      const run = insertMeasuredSearchRun(database, { authorityPath: profile.path, seed: 89, enqueuedAt: "2026-08-28T15:00:00.000Z" });
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
      profile.close();
    }
  });

  it("returns a bounded page in stable match, time, and run-id order", () => {
    const profile = createBoundProfileFixture();
    const database = AuthorityDatabase.open(
      { path: profile.path, busyTimeoutMs: 1_000, migrationOwner: "search-test" },
      manualClock(new Date("2026-08-28T16:00:00.000Z")),
    );
    try {
      const oldestSecondById = insertMeasuredSearchRun(
        database,
        { authorityPath: profile.path, seed: 2, enqueuedAt: "2026-08-27T12:00:00.000Z" },
      );
      const newest = insertMeasuredSearchRun(
        database,
        { authorityPath: profile.path, seed: 3, enqueuedAt: "2026-08-28T12:00:00.000Z" },
      );
      const oldestFirstById = insertMeasuredSearchRun(
        database,
        { authorityPath: profile.path, seed: 1, enqueuedAt: "2026-08-27T12:00:00.000Z" },
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
      profile.close();
    }
  });
});

describe("cross-date search service", () => {
  it("accepts cursors only from the same BFF process signer", () => {
    const profile = createBoundProfileFixture();
    const clock = manualClock(new Date("2026-08-28T16:00:00.000Z"));
    const database = AuthorityDatabase.open(
      { path: profile.path, busyTimeoutMs: 1_000, migrationOwner: "search-signer-test" },
      clock,
    );
    try {
      insertMeasuredSearchRun(database, { authorityPath: profile.path, seed: 41, enqueuedAt: "2026-08-28T15:00:00.000Z" });
      const second = insertMeasuredSearchRun(database, { authorityPath: profile.path, seed: 42, enqueuedAt: "2026-08-27T15:00:00.000Z" });
      insertMeasuredSearchRun(database, { authorityPath: profile.path, seed: 43, enqueuedAt: "2026-08-26T15:00:00.000Z" });
      const signer = new Uint8Array(32).fill(0x41);
      const service = measuredSearchService(database, {
        clock,
        sourceIdentity: database.getSourceDatabaseIdentity(),
        cursorSigningKey: signer,
        descriptors: { resolve: resolveMeasuredSearchDescriptor },
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

      const restarted = measuredSearchService(database, {
        clock,
        sourceIdentity: database.getSourceDatabaseIdentity(),
        cursorSigningKey: new Uint8Array(32).fill(0x42),
        descriptors: { resolve: resolveMeasuredSearchDescriptor },
      });
      assert.throws(
        () => restarted.search({ q: "separations", limit: 1, cursor }),
        /cursor signature.*different BFF process or was modified/,
      );

      const foreignAuthority = measuredSearchService(database, {
        clock,
        sourceIdentity: "f".repeat(64),
        cursorSigningKey: signer,
        descriptors: { resolve: resolveMeasuredSearchDescriptor },
      });
      assert.throws(
        () => foreignAuthority.search({ q: "separations", limit: 1, cursor }),
        /cursor belongs to a foreign authority source/,
      );
    } finally {
      database.close();
      profile.close();
    }
  });

  it("normalizes offset instants across a Pacific DST day and keyset pages", () => {
    const profile = createBoundProfileFixture();
    const clock = manualClock(new Date("2026-11-02T12:00:00.000Z"));
    const database = AuthorityDatabase.open(
      { path: profile.path, busyTimeoutMs: 1_000, migrationOwner: "search-offset-test" },
      clock,
    );
    try {
      const middle = insertMeasuredSearchRun(
        database,
        { authorityPath: profile.path, seed: 32, enqueuedAt: "2026-11-01T01:30:00.000-07:00" },
      );
      const outsideDay = insertMeasuredSearchRun(
        database,
        { authorityPath: profile.path, seed: 34, enqueuedAt: "2026-11-02T07:30:00.000-02:00" },
      );
      const oldest = insertMeasuredSearchRun(
        database,
        { authorityPath: profile.path, seed: 33, enqueuedAt: "2026-10-31T23:30:00.000-08:00" },
      );
      const newest = insertMeasuredSearchRun(
        database,
        { authorityPath: profile.path, seed: 31, enqueuedAt: "2026-11-01T01:15:00.000-08:00" },
      );
      const search = measuredSearchService(database, {
        clock,
        sourceIdentity: database.getSourceDatabaseIdentity(),
        cursorSigningKey: TEST_CURSOR_SIGNING_KEY,
        descriptors: { resolve: resolveMeasuredSearchDescriptor },
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
      profile.close();
    }
  });

  it("projects authoritative descriptor registration from one exact authority snapshot", () => {
    const profile = createBoundProfileFixture();
    const clock = manualClock(new Date("2026-08-28T16:00:00.000Z"));
    const database = AuthorityDatabase.open(
      { path: profile.path, busyTimeoutMs: 1_000, migrationOwner: "search-service-test" },
      clock,
    );
    try {
      const run = insertMeasuredSearchRun(database, { authorityPath: profile.path,
        seed: 7,
        runNumber: 7,
        enqueuedAt: "2026-08-28T15:00:00.000Z",
      });
      const search = measuredSearchService(database, {
        clock,
        sourceIdentity: database.getSourceDatabaseIdentity(),
        cursorSigningKey: TEST_CURSOR_SIGNING_KEY,
        descriptors: {
          resolve: (workflowId) => workflowId === separationsDescriptor.id ? separationsDescriptor : undefined,
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
      profile.close();
    }
  });
});
