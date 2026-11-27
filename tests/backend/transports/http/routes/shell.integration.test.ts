import { afterAll, afterEach, describe, it, vi } from "vitest";
import { createProfileFixtureSet } from "../../../../support/helpers/admission-fixture.js";
import { runRecordColumns } from "../../../../../src/backend/storage/sqlite/run-record-row.js";

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import readXlsxFile from "read-excel-file/node";
import { Hono } from "hono";
import { z } from "zod";
import { measureSearchLaneHttp } from "../../../../../scripts/bench/search-lane.js";
import { composeActivity } from "../../../../../src/backend/app/composition/dashboard/activity.js";
import { createComposedDashboardReadHost } from "../../../../../src/backend/app/composition/dashboard/runtime-resources.js";
import { composeShell } from "../../../../../src/backend/app/composition/dashboard/shell.js";
import { READABLE_WORKFLOW_MODULES } from "../../../../../src/backend/app/registries/workflow-registry.js";
import { createContentAddressedArtifactWriter } from "../../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { createTransactionHistory } from "../../../../../src/backend/storage/sqlite/transaction-history.js";
import type { DashboardApp } from "../../../../../src/backend/transports/http/routes/api-types.js";
import type { NotificationObservationStatus } from "../../../../../src/backend/runs/notifications/observation.js";
import { registerActivityRoutes } from "../../../../../src/backend/transports/http/routes/activity.js";
import { failureStatus } from "../../../../../src/backend/transports/http/routes/failure-status.js";
import { registerShellRoutes } from "../../../../../src/backend/transports/http/routes/shell.js";
import { CalendarWireSchema } from "../../../../../src/models/dashboard/calendar.js";
import { ActorIdSchema } from "../../../../../src/rules/identity/ids.js";
import { ActivityReportSelectionSchema } from "../../../../../src/models/dashboard/activity-selection.js";
import { CrossDateSearchPageSchema } from "../../../../../src/models/dashboard/search.js";
import { DashboardStreamEnvelopeSchema, type DashboardStreamEnvelope } from "../../../../../src/models/dashboard/subscription.js";
import { ERROR_CATALOG } from "../../../../../src/models/failures/error-catalog.js";
import { RunRecordSchema, type RunRecord } from "../../../../../src/models/run/record.js";
import { seedSeparationsRunAuthority } from "../../../../support/fixtures/integration/separations-run-fixtures.js";
import { insertMeasuredSearchRun } from "../../../../support/helpers/backend/cross-date-search-harness.js";
import { AuthorityDatabase } from "../../../../support/helpers/synthetic-storage-admission.js";
import { fillDiagnosticBudget } from "../../../../support/helpers/backend/full-diagnostic-budget.js";
import { DAY, DESCRIPTOR_SET_HASH, makeWorld, queuedEventOf } from "../../../../support/helpers/backend/dashboard-harness.js";
import { personLookupQueuedRun } from "../../../../support/helpers/phase1f-executor-harness.js";

const profileFixtures = createProfileFixtureSet();
afterAll(() => profileFixtures.close());

function cursorDigest(cursor: string) {
  const [, encoded] = cursor.split(".");
  assert.ok(encoded);
  return z.object({ served: z.object({ digest: z.string().length(64) }) })
    .parse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))).served.digest;
}

it("serves search, calendar and both search export routes with the main read connection disabled", async () => {
  const profile = await profileFixtures.create();
  const descriptors = { resolve: (id: string) => READABLE_WORKFLOW_MODULES.find(module => module.descriptor.id === id)?.descriptor };
  const world = await makeWorld({ profileFixture: async () => profile, descriptors });
  const { database, clock, projection } = world;
  try {
    const lanes = createComposedDashboardReadHost({ admission: profile.admission, database, clock });
    try {
      const artifacts = createContentAddressedArtifactWriter({ admission: profile.admission });
      await artifacts.ready;
      const unused = () => { throw new Error("unexpected shell dependency"); };
      const activity = composeActivity({ database, clock, descriptors, ledger: createTransactionHistory(database.authority) });
      const input = { database, readLanes: lanes, projection, clock, ids: { uuid: randomUUID }, artifacts, descriptors,
        activity: activity.activity, appVersion: "test", actorLabel: () => "Test operator",
        descriptorSetHash: DESCRIPTOR_SET_HASH, preflightReport: unused, workbookCompatibility: unused,
        backfillGaps: { detected: unused } };
      const shell = composeShell(input);
      try {
        const app: DashboardApp = new Hono();
        app.use("*", async (c, next) => { c.set("requestActorId", ActorIdSchema.parse("local-operator")); await next(); });
        app.onError((error, c) => { const failure = failureStatus(error); return c.json(failure.body, failure.status); });
        registerShellRoutes(app, shell);
        registerActivityRoutes(app, activity);
        const events = [
          queuedEventOf(world, { seed: 981, workflow: "i9-lookup", title: "First queued title" }),
          queuedEventOf(world, { seed: 982, workflow: "i9-lookup", title: "Second queued title", displayName: "Operator rename" }),
          queuedEventOf(world, { seed: 983, title: "Third queued title" }),
        ];
        const query = { q: "", scope: "all", facets: { day: DAY }, limit: 1 };
        const expectedTitles = new Map<string, string | undefined>(shell.search.search({ ...query, limit: 3 }).results.map(row => [row.runId, row.displayTitle]));
        assert.equal(expectedTitles.size, 3);
        assert.equal(expectedTitles.get(events[0].runId), projection.runFold(events[0].runId)?.queued.title);
        assert.equal(expectedTitles.get(events[0].runId), "First queued title");
        assert.equal(expectedTitles.get(events[1].runId), "Operator rename");
        const url = `/api/v1/search?q=&day=${DAY}&limit=1`;
        const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers: OPERATOR_JSON_HEADERS, body: JSON.stringify(body) });
        const readPage = async (path: string) => {
          const response = await app.request(path);
          const body: unknown = await response.json();
          assert.equal(response.status, 200, JSON.stringify(body));
          return CrossDateSearchPageSchema.parse(body);
        };
        const noMainRead = () => { throw new Error("main-connection read"); };
        const snapshot = vi.spyOn(database, "withAuthorityReadSnapshot").mockImplementation(noMainRead);
        const calendar = vi.spyOn(database, "queryRunCalendar").mockImplementation(noMainRead);
        const source = vi.spyOn(database, "getSourceDatabaseIdentity").mockImplementation(noMainRead);
        try {
          const page = await readPage(url);
          assert.equal(page.totalMatches, 3);
          assert.equal(page.results[0]?.displayTitle, expectedTitles.get(page.results[0].runId));
          assert.equal(page.nextCursor.state, "present");
          const resumedUrl = `${url}&cursor=${encodeURIComponent(page.nextCursor.value)}`;
          const resumed = await readPage(resumedUrl);
          assert.equal(resumed.results[0]?.displayTitle, expectedTitles.get(resumed.results[0].runId));
          assert.equal(resumed.snapshot.token, page.snapshot.token);
          assert.equal(resumed.nextCursor.state, "present");
          const last = await readPage(`${url}&cursor=${encodeURIComponent(resumed.nextCursor.value)}`);
          assert.equal(last.results[0]?.displayTitle, expectedTitles.get(last.results[0].runId));
          assert.equal(last.nextCursor.state, "absent");

          const calendarResponse = await app.request(`/api/v1/calendar?month=${DAY.slice(0, 7)}&day=${DAY}`);
          assert.equal(calendarResponse.status, 200);
          assert.equal(CalendarWireSchema.parse(await calendarResponse.json()).day, DAY);

          const selection = { kind: "search", query, snapshot: { ...page.snapshot, generatedAt: page.generatedAt } };
          const metadata = await post("/api/v1/exports/search", { format: "diagnostic", selection });
          assert.equal(metadata.status, 200);
          assert.equal((await json(metadata)).totalMatches, 3);
          const csv = await post("/api/v1/exports/search", { format: "csv", selection });
          assert.equal(csv.status, 200);
          assert.match(await csv.text(), /Matches,3/u);

          const workbook = await post("/api/v1/exports/xlsx", { requestVersion: 3, selection });
          assert.equal(workbook.status, 200);
          assert.equal((await readXlsxFile(Buffer.from(await workbook.arrayBuffer())))[1]?.data.length, 4);
          assert.equal(snapshot.mock.calls.length + calendar.mock.calls.length + source.mock.calls.length, 0);

          // Registration advanced the generation without changing any of the search rows.
          const revalidated = await readPage(resumedUrl);
          assert.deepEqual(revalidated.results, resumed.results);
          assert.equal(revalidated.nextCursor.state, "present");
          assert.equal(cursorDigest(revalidated.nextCursor.value), cursorDigest(resumed.nextCursor.value));
          const stale = await post("/api/v1/exports/xlsx", { requestVersion: 3, selection });
          assert.equal(stale.status, 400);
          assert.match(String((await json(stale)).message), /search snapshot token names authority generation/u);
          const fresh = await readPage(url);
          clock.advanceWall(15 * 60_000);
          const expired = await post("/api/v1/exports/xlsx", { requestVersion: 3,
            selection: { ...selection, snapshot: { ...fresh.snapshot, generatedAt: fresh.generatedAt } } });
          assert.equal(expired.status, 400);
          assert.match(String((await json(expired)).message), /search snapshot expired/u);
        } finally { source.mockRestore(); calendar.mockRestore(); snapshot.mockRestore(); }

        const report = await app.request(`/api/v1/reports/activity?from=${DAY}&to=${DAY}`);
        assert.equal(report.status, 200);
        const selection = ActivityReportSelectionSchema.parse(await report.json());
        const activityWorkbook = await post("/api/v1/exports/xlsx", { requestVersion: 3,
          selection: { kind: "activity", from: DAY, to: DAY, snapshotToken: selection.snapshot.token } });
        assert.equal(activityWorkbook.status, 200);
        const activityExportId = activityWorkbook.headers.get("x-operator-export-id");
        assert.ok(activityExportId);
        assert.equal(database.authority.operatorXlsxExports.get(activityExportId)?.selection.kind, "activity");

        const observed = await measureSearchLaneHttp(input, 1);
        assert.equal(observed.day, DAY);
        assert.equal(observed.runsOnDay, 3);
        assert.equal(observed.search[0]?.mainSqliteCalls, 0);
        assert.equal(observed.calendar[0]?.mainSqliteCalls, 0);
        assert.equal(observed.xlsx.selectionMainSqliteCalls, 0);
        assert.ok(observed.xlsx.effectMainSqliteCalls > 0);
      } finally { shell.hub.close(); }
    } finally { await lanes.close(); }
  } finally { await world.dispose(); }
});

function restoreSearchRun(h: Awaited<ReturnType<typeof harness>>, run: RunRecord): void {
  const raw = new DatabaseSync(join(h.stateRoot, "state.db"));
  try {
    const triggers = raw.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='runs'").all();
    for (const trigger of triggers) { assert.equal(typeof trigger.name, "string"); raw.exec(`DROP TRIGGER "${String(trigger.name)}"`); }
    const row = runRecordColumns(run), columns = Object.keys(row).filter(column => column !== "id");
    raw.prepare(`UPDATE runs SET ${columns.map(column => `${column}=?`).join(",")} WHERE id=?`)
      .run(...columns.map(column => row[column as keyof typeof row]), run.envelope.runId);
    for (const trigger of triggers) { assert.equal(typeof trigger.sql, "string"); raw.exec(String(trigger.sql)); }
  } finally { raw.close(); }
  assert.equal(h.database.rebuildRunSearchIndex({ restart: true, limit: 500 }).state, "published");
}

describe("BFF spine flow (start plan -> kernel -> spans -> projection)", () => {

  it("serves strict cross-date search from durable run authority", async () => {
    const h = await harness({ profileFixture: profileFixtures.create });
    insertMeasuredSearchRun(h.database, { authorityPath: join(h.stateRoot, "state.db"), seed: 77, enqueuedAt: "2026-08-28T15:00:00.000Z" });

    const response = await h.app.request("/api/v1/search?q=separations&scope=workflow&limit=1");

    assert.equal(response.status, 200);
    const page = CrossDateSearchPageSchema.parse(await response.json());
    assert.equal(page.totalMatches, 1);
    assert.equal(page.results[0]?.workflowId, "separations");

    const duplicate = await h.app.request("/api/v1/search?q=separations&q=other");
    assert.equal(duplicate.status, 400);
    const unknown = await h.app.request("/api/v1/search?q=separations&title=unsafe");
    assert.equal(unknown.status, 400);
    for (const parameter of [
      "workflow=Invalid_Workflow!",
      "state=unknown-state",
      "shape=invalid-shape",
      "dryRun=maybe",
      "system=invalid-system",
      "priority=interactive",
    ]) {
      const unmeasured = await h.app.request(`/api/v1/search?q=separations&${parameter}`);
      assert.equal(unmeasured.status, 400, parameter);
    }
    const maximum = await h.app.request(`/api/v1/search?q=${"x".repeat(160)}&limit=50`);
    assert.equal(maximum.status, 200);
  });

  it("serves an exact People count from persisted current Separations standalone and member evidence only", async () => {
    const h = await harness({ profileFixture: profileFixtures.create });
    const standalone = currentSeparationsRun({ seed: 310, shape: "single" });
    const operation = currentSeparationsRun({ seed: 311, shape: "operation" });
    const firstMember = currentSeparationsRun({ seed: 312, shape: "operation-member", parent: operation });
    const secondMember = currentSeparationsRun({ seed: 313, shape: "operation-member", parent: operation });

    const foreign = currentSeparationsRun({ seed: 314, shape: "single", enqueuedAt: "2026-08-02T17:00:00.000Z" });

    seedCurrentSeparationsRun(h, standalone, "10800000");
    seedCurrentSeparationsRun(h, operation, "10800000");
    seedCurrentSeparationsRun(h, firstMember, "10800000");
    seedCurrentSeparationsRun(h, secondMember, "10800001");
    seedCurrentSeparationsRun(h, foreign, "10800002");
    persistCurrentSeparationsEvidence(h, [standalone, firstMember, secondMember, foreign]);
    projectCurrentSeparationsRuns(h, [standalone, operation, firstMember, secondMember]);

    assert.deepEqual(await activityPeople(h), {
      state: "present",
      distinct: 2,
      evidenceRows: 3,
    });
  });

  it("refuses corrupt current terminal evidence instead of reporting a verified People count", async () => {
    const h = await harness({ profileFixture: profileFixtures.create });
    const evidenced = currentSeparationsRun({ seed: 320, shape: "single" });
    const missing = currentSeparationsRun({ seed: 321, shape: "single" });
    seedCurrentSeparationsRun(h, evidenced);
    projectCurrentSeparationsRuns(h, [evidenced]);
    seedSeparationsRunAuthority(h.database, join(h.stateRoot, "state.db"), missing, undefined);
    projectCurrentSeparationsRuns(h, [missing]);
    const response = await h.app.request(`/api/v1/reports/activity?from=${DAY}&to=${DAY}`);
    const body = await json(response);
    assert.equal(response.status, 500);
    assert.equal(body.code, "INTERNAL_FAILURE");
    assert.equal(body.message, ERROR_CATALOG.INTERNAL_FAILURE.text);
    assert.equal("people" in body, false);
    assert.throws(() => AuthorityDatabase.inspectExistingReadOnly(join(h.stateRoot, "state.db")), /invariant validation failed: run-completion-consequences/u);
    assert.equal(h.database.authority.runResults.get(missing.envelope.runId), undefined);
  });

  it("serves canonical People from both current result owners", async () => {
    const h = await harness({ profileFixture: profileFixtures.create });
    const first = currentSeparationsRun({ seed: 330, shape: "single" });
    const second = currentSeparationsRun({ seed: 331, shape: "single" });

    seedCurrentSeparationsRun(h, first, "10800000");
    seedCurrentSeparationsRun(h, second, "10800001");
    persistCurrentSeparationsEvidence(h, [first]);
    persistCurrentSeparationsEvidence(h, [second]);
    projectCurrentSeparationsRuns(h, [first, second]);

    assert.deepEqual(await activityPeople(h), {
      state: "present",
      evidenceRows: 2,
      distinct: 2,
    });
  });

  it("fails loud without echoing any observed value outside the closed search corpus", async () => {
    const cases: readonly Readonly<{
      dimension: string;
      observed: string;
      mutate: (record: RunRecord) => RunRecord;
    }>[] = [
      {
        dimension: "workflow",
        observed: "eid-10873698",
        mutate: (record) => RunRecordSchema.parse({
          ...record,
          envelope: { ...record.envelope, workflow: "eid-10873698" },
        }),
      },
      {
        dimension: "shape",
        observed: "preview",
        mutate: (record) => RunRecordSchema.parse({
          ...record,
          envelope: { ...record.envelope, shape: "preview" },
        }),
      },
      {
        dimension: "dry-run",
        observed: "false",
        mutate: (record) => RunRecordSchema.parse({
          ...record,
          envelope: { ...record.envelope, dryRun: false },
        }),
      },
      {
        dimension: "resolved systems",
        observed: "crm",
        mutate: (record) => RunRecordSchema.parse({
          ...record,
          envelope: {
            ...record.envelope,
            resolvedInstance: { ...record.envelope.resolvedInstance, crm: "prod" },
          },
        }),
      },
      {
        dimension: "lifecycle/outcome",
        observed: "queued",
        mutate: (record) => RunRecordSchema.parse({ ...record, lifecycle: { state: "queued" } }),
      },
    ];

    for (const [index, corpusCase] of cases.entries()) {
      const h = await harness({ profileFixture: profileFixtures.create });
      const run = insertMeasuredSearchRun(h.database, { authorityPath: join(h.stateRoot, "state.db"),
        seed: 80 + index,
        enqueuedAt: "2026-08-28T15:00:00.000Z",
      });
      const corrupted = corpusCase.mutate(run);
      const raw = new DatabaseSync(join(h.stateRoot, "state.db"));
      try {
        const triggers = ["runs_identity", "runs_completion_immutable", "runs_completion_update"].map(name => {
          const sql = raw.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name=?").get(name)?.sql;
          assert.equal(typeof sql, "string");
          if (typeof sql !== "string") throw new Error(`missing current run guard ${name}`);
          return { name, sql };
        });
        raw.exec("BEGIN IMMEDIATE");
        try {
          for (const trigger of triggers) raw.exec(`DROP TRIGGER ${trigger.name}`);
          const row = runRecordColumns(corrupted);
          const keys = Object.keys(row).filter(key => key !== "id");
          assert.equal(raw.prepare(`UPDATE runs SET ${keys.map(key => `${key}=?`).join(",")} WHERE id=?`)
            .run(...keys.map(key => row[key as keyof typeof row]), corrupted.envelope.runId).changes, 1);
          for (const trigger of triggers) raw.exec(trigger.sql);
          raw.exec("COMMIT");
        } catch (error) {
          raw.exec("ROLLBACK");
          throw error;
        }
      } finally {
        raw.close();
      }

      const response = await h.app.request("/api/v1/search?q=separations&limit=1");
      const body = await json(response);

      assert.equal(response.status, 500, corpusCase.dimension);
      assert.equal(body.code, "INTERNAL_FAILURE", corpusCase.dimension);
      assert.equal(body.message, ERROR_CATALOG.INTERNAL_FAILURE.text, corpusCase.dimension);
      assert.doesNotMatch(String(body.message), new RegExp(corpusCase.observed, "u"), corpusCase.dimension);
      restoreSearchRun(h, run);
    }
  });

  it("refuses corrupt search authority without exposing its sensitive bytes", async () => {
    const h = await harness({ profileFixture: profileFixtures.create });
    const run = insertMeasuredSearchRun(h.database, { authorityPath: join(h.stateRoot, "state.db"), seed: 78, enqueuedAt: "2026-08-28T15:00:00.000Z" });
    const sensitiveNodeId = "ssn-902-48-1357-eid-10873698";
    const sensitivePatch = {
      nodeId: sensitiveNodeId,
      fieldPath: "identifier",
      value: "redacted",
      correctedAt: run.createdAt,
      reason: "corrupt fixture",
    };
    const raw = new DatabaseSync(join(h.stateRoot, "state.db"));
    try {
      assert.equal(raw.prepare("UPDATE runs SET envelope_json = ? WHERE id = ?")
        .run(JSON.stringify({ ...run.envelope, injected: [sensitivePatch, sensitivePatch] }), run.envelope.runId).changes, 1);
    } finally {
      raw.close();
    }

    const response = await h.app.request("/api/v1/search?q=separations&scope=workflow&limit=1");
    const body = await json(response);

    assert.equal(response.status, 500);
    assert.equal(body.code, "INTERNAL_FAILURE");
    assert.equal(body.message, ERROR_CATALOG.INTERNAL_FAILURE.text);
    assert.doesNotMatch(JSON.stringify(body), new RegExp(sensitiveNodeId, "u"));
    restoreSearchRun(h, run);
  });

  it("serves one dedicated XLSX download only after its exact evidence is durable", async () => {
    const h = await harness({ profileFixture: profileFixtures.create });
    const activityReport = ActivityReportSelectionSchema.parse(
      await (await h.app.request(`/api/v1/reports/activity?from=${DAY}&to=${DAY}`)).json(),
    );

    const response = await h.app.request("/api/v1/exports/xlsx", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        requestVersion: 3,
        selection: { kind: "activity", from: DAY, to: DAY, snapshotToken: activityReport.snapshot.token },
      }),
    });

    assert.equal(response.status, 200);
    const exportId = response.headers.get("x-operator-export-id");
    assert.ok(exportId);
    const evidence = h.database.authority.operatorXlsxExports.get(exportId);
    assert.ok(evidence);
    assert.equal(evidence.workbookVersion, 3);
    assert.equal(evidence.requestedBy, "local-operator");
    assert.equal(response.headers.get("content-type"), evidence.download.mediaType);
    assert.equal(response.headers.get("content-disposition"), evidence.download.contentDisposition);
    assert.equal(response.headers.get("content-length"), String(evidence.download.byteLength));
    assert.equal(response.headers.get("etag"), `"${evidence.download.sha256}"`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.byteLength, evidence.download.byteLength);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), evidence.download.sha256);

    const genericRead = await h.app.request(`/artifacts/v1/${evidence.artifact.id}`);
    assert.equal(genericRead.status, 404);

    const malformed = await h.app.request("/api/v1/exports/xlsx", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        requestVersion: 3,
        selection: { kind: "activity", from: DAY, to: DAY, snapshotToken: activityReport.snapshot.token, latest: true },
      }),
    });
    assert.equal(malformed.status, 400);
    assert.equal((await json(malformed)).code, "SCHEMA_INVALID");

    const smuggledActor = await h.app.request("/api/v1/exports/xlsx", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        requestVersion: 3,
        requestedBy: "other-operator",
        selection: { kind: "activity", from: DAY, to: DAY, snapshotToken: activityReport.snapshot.token },
      }),
    });
    assert.equal(smuggledActor.status, 400);
    assert.equal((await json(smuggledActor)).code, "SCHEMA_INVALID");
  });

  it.each([
    {
      label: "foreign Origin",
      headers: { ...OPERATOR_JSON_HEADERS, origin: "https://hostile.example" },
      status: 403,
      code: "OPERATOR_MUTATION_ORIGIN_REFUSED",
    },
    {
      label: "simple text/plain media type",
      headers: { ...OPERATOR_JSON_HEADERS, "content-type": "text/plain" },
      status: 415,
      code: "OPERATOR_MUTATION_MEDIA_TYPE_REFUSED",
    },
  ])("refuses XLSX $label before durable effects", async ({ headers, status, code }) => {
    const h = await harness({ profileFixture: profileFixtures.create });
    const activityReport = ActivityReportSelectionSchema.parse(
      await (await h.app.request(`/api/v1/reports/activity?from=${DAY}&to=${DAY}`)).json(),
    );
    const before = h.database.getMeta();
    const beforeFault = faultAuthoritySnapshot(h);
    const response = await h.app.request("/api/v1/exports/xlsx", {
      method: "POST",
      headers,
      body: JSON.stringify({
        requestVersion: 3,
        selection: { kind: "activity", from: DAY, to: DAY, snapshotToken: activityReport.snapshot.token },
      }),
    });
    assert.equal(response.status, status);
    assert.equal((await json(response)).code, code);
    assert.deepEqual(h.database.getMeta(), before, "a debug-only fault advances no authority generation");
    assertHttpFaultOnly(h, beforeFault, 1);
  });

  it("exports every page of one real signed cross-date search selection as evidenced XLSX", async () => {
    const h = await harness({ profileFixture: profileFixtures.create });
    insertMeasuredSearchRun(h.database, { authorityPath: join(h.stateRoot, "state.db"), seed: 201, enqueuedAt: "2026-08-28T15:00:00.000Z" });
    insertMeasuredSearchRun(h.database, { authorityPath: join(h.stateRoot, "state.db"), seed: 202, enqueuedAt: "2026-08-28T14:00:00.000Z" });

    const firstSearch = await h.app.request("/api/v1/search?q=separations&scope=workflow&limit=1");
    assert.equal(firstSearch.status, 200);
    const selectionPage = CrossDateSearchPageSchema.parse(await firstSearch.json());
    assert.equal(selectionPage.totalMatches, 2);
    assert.equal(selectionPage.results.length, 1);
    assert.equal(selectionPage.nextCursor.state, "present");

    const response = await h.app.request("/api/v1/exports/xlsx", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        requestVersion: 3,
        selection: {
          kind: "search",
          query: { q: "separations", scope: "workflow", facets: {}, limit: 1 },
          snapshot: {
            generatedAt: selectionPage.generatedAt,
            authorityGeneration: selectionPage.snapshot.authorityGeneration,
            order: selectionPage.snapshot.order,
            token: selectionPage.snapshot.token,
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    const exportId = response.headers.get("x-operator-export-id");
    assert.ok(exportId);
    const evidence = h.database.authority.operatorXlsxExports.get(exportId);
    assert.ok(evidence);
    assert.equal(evidence.workbookVersion, 3);
    assert.equal(evidence.requestedBy, "local-operator");
    assert.equal(evidence.selection.kind, "search");
    assert.equal(evidence.workbook.rowCount, 2);
    assert.equal(response.headers.get("content-type"), evidence.download.mediaType);
    assert.equal(response.headers.get("content-length"), String(evidence.download.byteLength));
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(createHash("sha256").update(bytes).digest("hex"), evidence.download.sha256);
    const workbook = await readXlsxFile(bytes);
    assert.deepEqual(workbook.map(({ sheet }) => sheet), ["Read Me", "Runs"]);
    assert.equal(workbook[1]?.data.length, 3);
  });



  it("opens, serves and closes the dashboard event stream with a full diagnostic budget", async () => {
    const h = await harness({ profileFixture: profileFixtures.create });
    const timeline = h.database.authority.timelineEvents;
    fillDiagnosticBudget(DatabaseSync, join(h.stateRoot, "state.db"), timeline, h.clock);
    const before = timeline.highWaterMark();
    // The hello carries the cursor from before the connection takes its own.
    const cursor = h.projection.cursor();
    const response = await h.app.request(`http://localhost/events/v1?topics=dashboard-day:${DAY}`, { headers: { host: "localhost" } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/event-stream");
    assert.ok(response.body);
    const reader = response.body.getReader();
    try {
      const first = await reader.read();
      assert.equal(first.done, false);
      const descriptorHash = h.projection.descriptorSetHash();
      const generation = h.projection.generation();
      assert.equal(new TextDecoder().decode(first.value),
        `id: ${cursor}\ndata: {"type":"hello","wireVersion":1,"descriptorHash":"${descriptorHash}","projectionGeneration":${generation},"cursor":"${cursor}"}\n\n`);
      assert.equal(h.hub.subscriberCount(), 1);
    } finally { await reader.cancel(); }
    assert.equal(h.hub.subscriberCount(), 0);
    assert.equal(timeline.highWaterMark(), before);
  });

  it("serves a run topic's panel in the snapshot and refuses a malformed run id", async () => {
    const h = await harness({ profileFixture: profileFixtures.create });
    const absent = "00000000-0000-4000-8000-0000000000aa";
    const response = await h.app.request(`http://localhost/events/v1?topics=dashboard-day:${DAY},run:${absent}`, { headers: { host: "localhost" } });
    assert.equal(response.status, 200);
    assert.ok(response.body);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    try {
      while (!text.includes('"type":"snapshot"')) {
        const chunk = await reader.read();
        assert.equal(chunk.done, false);
        text += decoder.decode(chunk.value, { stream: true });
      }
    } finally { await reader.cancel(); }
    const snapshot = text.split("\n\n").filter(block => block.includes('"type":"snapshot"'))
      .map(block => DashboardStreamEnvelopeSchema.parse(JSON.parse(block.split("\n").filter(line => line.startsWith("data: ")).map(line => line.slice(6)).join("\n"))))[0];
    if (snapshot?.type !== "snapshot") assert.fail("expected the handoff snapshot");
    assert.deepEqual(snapshot.rows.map(row => ({ model: row.model, key: row.key, state: row.value.state })), [{ model: "run-panel", key: absent, state: "refused" }],
      "a run authority does not hold is a refused panel, not a stream failure");

    const malformed = await h.app.request(`http://localhost/events/v1?topics=dashboard-day:${DAY},run:not-a-run`, { headers: { host: "localhost" } });
    assert.equal(malformed.status, 400);
    assert.equal(h.hub.subscriberCount(), 0);
  });

  it("sends the live snapshot's status row only to the connection where it moved", async () => {
    const ready = { state: "ready", pending: 0 } as const;
    const failed = { state: "failed", pending: 1, code: "NOTIFICATION_OBSERVATION_FAILED" } as const;
    let status: NotificationObservationStatus = ready;
    const h = await harness({ profileFixture: profileFixtures.create,
      notificationStatus: { read: () => status, onChange: () => () => undefined } });
    const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
    const decoder = new TextDecoder();
    const snapshot = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
      for (;;) {
        const chunk = await reader.read();
        assert.equal(chunk.done, false);
        const data = decoder.decode(chunk.value).split("\n").find(line => line.startsWith("data: "));
        assert.ok(data);
        const envelope = DashboardStreamEnvelopeSchema.parse(JSON.parse(data.slice(6)));
        if (envelope.type === "snapshot") return envelope;
      }
    };
    const connect = async () => {
      const response = await h.app.request(`/events/v1?topics=dashboard-day:${DAY}`);
      assert.equal(response.status, 200);
      assert.ok(response.body);
      const reader = response.body.getReader();
      readers.push(reader);
      return { reader, initial: await snapshot(reader) };
    };
    const row = (value: NotificationObservationStatus) => ({
      model: "notification-status", key: "local-operator", value: { state: "available", value },
    });

    try {
      const first = await connect();
      assert.deepEqual(first.initial.rows, [row(ready)]);
      // The second handoff reads the new status before the first connection receives a status update.
      status = failed;
      const second = await connect();
      assert.deepEqual(second.initial.rows, [row(failed)]);

      const run = currentSeparationsRun({ seed: 340, shape: "single" });
      seedCurrentSeparationsRun(h, run);
      projectCurrentSeparationsRuns(h, [run]);

      const [moved, unchanged] = await Promise.all([snapshot(first.reader), snapshot(second.reader)]);
      assert.equal(moved.cursor, unchanged.cursor);
      assert.ok(unchanged.payload.queueSurfaces.some(entry => entry.runId === run.envelope.runId));
      assert.deepEqual(moved.rows, [row(failed)]);
      assert.deepEqual(unchanged.rows, []);
    } finally {
      await Promise.all(readers.map(reader => reader.cancel()));
    }
  });

  it("serves /events/v1 through the demand-driven bridge: an unread client is bounded to one reset-required and cancel closes the hub connection", async () => {
    const h = await harness({ profileFixture: profileFixtures.create, maxPending: 2 });
    const response = await h.app.request(`http://localhost/events/v1?topics=dashboard-day:${DAY}`, {
      headers: { host: "localhost" },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/event-stream");
    assert.ok(response.body);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parse = (text: string): DashboardStreamEnvelope[] => text.split("\n\n")
      .filter((block) => block.includes("data: "))
      .map((block) => DashboardStreamEnvelopeSchema.parse(JSON.parse(
        block.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n"),
      )));
    const initial: DashboardStreamEnvelope[] = [];
    while (initial.length < 3) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false);
      initial.push(...parse(decoder.decode(chunk.value, { stream: true })));
    }
    assert.deepEqual(initial.map(({ type }) => type), ["hello", "snapshot", "health"]);
    assert.equal(h.hub.subscriberCount(), 1);

    const runs = Array.from({ length: 6 }, (_, index) => {
      const runId = `9e8d7c6b-5a49-4382-9170-2f3e4d5c6c0${String(index)}`;
      h.database.authority.runs.enqueue(personLookupQueuedRun({
        runId,
        itemId: `3333333${String(index)}-3333-4333-8333-333333333333`,
      }));
      const record = h.database.authority.runs.get(runId);
      if (record === undefined) assert.fail(`run ${runId} did not enqueue`);
      return record;
    });
    for (const run of runs) projectCurrentSeparationsRuns(h, [run]);
    await new Promise<void>((resolve) => setImmediate(resolve));

    const live: DashboardStreamEnvelope[] = [];
    while (!live.some(({ type }) => type === "reset-required")) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false);
      live.push(...parse(decoder.decode(chunk.value, { stream: true })));
    }
    assert.equal(live.filter(({ type }) => type === "reset-required").length, 1);
    assert.equal(live.at(-1)?.type, "reset-required");
    assert.ok(live.filter(({ type }) => type === "snapshot").length < runs.length, "the bound must have collapsed most snapshots");

    await reader.cancel();
    assert.equal(h.hub.subscriberCount(), 0);
  });
});

import { OPERATOR_JSON_HEADERS, activityPeople, assertHttpFaultOnly, faultAuthoritySnapshot, currentSeparationsRun, disposeHttpRouteHarness, harness, json, persistCurrentSeparationsEvidence, projectCurrentSeparationsRuns, seedCurrentSeparationsRun } from "../../../../support/helpers/backend/http-route-harness.js";
afterEach(disposeHttpRouteHarness);

it("validates the whole event query before applying resume headers", async () => {
  const h = await harness({ profileFixture: profileFixtures.create });
  for (const suffix of ["&extra=unused", `&topics=dashboard-day:${DAY}`, "&cursor=pc:1&cursor=pc:2", "&cursor=malformed",
    "&projectionGeneration=1e0", "&projectionGeneration=1&projectionGeneration=2"]) {
    const response = await h.app.request(`/events/v1?topics=dashboard-day:${DAY}${suffix}`, {
      headers: { "Last-Event-ID": "pc:1", "Dashboard-Projection-Generation": "1" },
    });
    if (response.status === 200) await response.body?.cancel();
    assert.equal(response.status, 400, suffix);
    assert.equal((await json(response)).code, "SCHEMA_INVALID");
    assert.equal(h.hub.subscriberCount(), 0);
  }
});
