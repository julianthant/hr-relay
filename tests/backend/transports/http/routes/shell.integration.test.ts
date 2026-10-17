import { runRecordColumns } from "../../../../../src/backend/storage/sqlite/run-record-row.js";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import readXlsxFile from "read-excel-file/node";
import { afterEach, describe, it } from "vitest";
import { ActivityReportSelectionSchema } from "../../../../../src/models/dashboard/activity-selection.js";
import { CrossDateSearchPageSchema } from "../../../../../src/models/dashboard/search.js";
import { DashboardStreamEnvelopeSchema, type DashboardStreamEnvelope } from "../../../../../src/models/dashboard/subscription.js";
import { RunRecordSchema, type RunRecord } from "../../../../../src/models/run/record.js";
import { seedSeparationsRunAuthority } from "../../../../support/fixtures/integration/activity-person-pseudonym-fixtures.js";
import { insertMeasuredSearchRun } from "../../../../support/helpers/backend/cross-date-search-harness.js";
import { DAY } from "../../../../support/helpers/backend/dashboard-harness.js";
import { personLookupQueuedRun } from "../../../../support/helpers/phase1f-executor-harness.js";

describe("BFF spine flow (start plan -> kernel -> spans -> projection)", () => {

  it("serves strict cross-date search from durable run authority", async () => {
    const h = harness();
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
    const h = harness();
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
    const h = harness();
    const evidenced = currentSeparationsRun({ seed: 320, shape: "single" });
    const missing = currentSeparationsRun({ seed: 321, shape: "single" });
    seedCurrentSeparationsRun(h, evidenced);
    projectCurrentSeparationsRuns(h, [evidenced]);
    seedSeparationsRunAuthority(h.database, join(h.stateRoot, "state.db"), missing, undefined);
    const before = h.database.getMeta();
    assert.throws(() => projectCurrentSeparationsRuns(h, [missing]), /current composite authority is invalid/u);
    const response = await h.app.request(`/api/v1/reports/activity?from=${DAY}&to=${DAY}`);
    const body = await json(response);
    assert.equal(response.status, 500);
    assert.equal(body.code, "LOGGING_UNAVAILABLE");
    assert.equal(body.message, "Debug logging is unavailable; inspect the local emergency fault log.");
    assert.equal("people" in body, false);
    assert.deepEqual(h.database.getMeta(), before);
    assert.equal(h.database.authority.runResults.get(missing.envelope.runId), undefined);
  });

  it("serves canonical People from both current result owners", async () => {
    const h = harness();
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
      const h = harness();
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
      assert.equal(body.code, "LOGGING_UNAVAILABLE", corpusCase.dimension);
      assert.equal(
        body.message,
        "Debug logging is unavailable; inspect the local emergency fault log.",
        corpusCase.dimension,
      );
      assert.doesNotMatch(String(body.message), new RegExp(corpusCase.observed, "u"), corpusCase.dimension);
    }
  });

  it("refuses corrupt search authority without exposing its sensitive bytes", async () => {
    const h = harness();
    const run = insertMeasuredSearchRun(h.database, { authorityPath: join(h.stateRoot, "state.db"), seed: 78, enqueuedAt: "2026-08-28T15:00:00.000Z" });
    const sensitiveNodeId = "ssn-920-74-1459-eid-10873698";
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
    assert.equal(body.code, "LOGGING_UNAVAILABLE");
    assert.equal(body.message, "Debug logging is unavailable; inspect the local emergency fault log.");
    assert.doesNotMatch(JSON.stringify(body), new RegExp(sensitiveNodeId, "u"));
  });

  it("serves one dedicated XLSX download only after its exact evidence is durable", async () => {
    const h = harness();
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
    const h = harness();
    const activityReport = ActivityReportSelectionSchema.parse(
      await (await h.app.request(`/api/v1/reports/activity?from=${DAY}&to=${DAY}`)).json(),
    );
    const before = h.database.getMeta();
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
    assert.deepEqual(h.database.getMeta(), before);
  });

  it("exports every page of one real signed cross-date search selection as evidenced XLSX", async () => {
    const h = harness();
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



  it("serves /events/v1 through the demand-driven bridge: an unread client is bounded to one reset-required and cancel closes the hub connection", async () => {
    const h = harness({ maxPending: 2 });
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
    projectCurrentSeparationsRuns(h, runs);
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

import { OPERATOR_JSON_HEADERS, activityPeople, currentSeparationsRun, disposeHttpRouteHarness, harness, json, persistCurrentSeparationsEvidence, projectCurrentSeparationsRuns, seedCurrentSeparationsRun } from "../../../../support/helpers/backend/http-route-harness.js";
afterEach(disposeHttpRouteHarness);
