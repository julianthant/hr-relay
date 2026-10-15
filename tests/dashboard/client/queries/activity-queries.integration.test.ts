import { RunIdSchema } from "../../../../src/rules/identity/ids.js";
import assert from "node:assert/strict";
import { afterEach,it } from "vitest";
import { DashboardClientError } from "../../../../src/dashboard/client/errors.js";
import { createActivityQueries } from "../../../../src/dashboard/client/queries/activity-queries.js";
import { createDashboardTransport } from "../../../../src/dashboard/client/transport.js";

const cleanup:(()=>void)[]=[];
afterEach(()=>{for(const dispose of cleanup.splice(0))dispose();});

it("propagates a locally cancelled Activity request without accepting a replacement response", async () => {
  let observedSignal: AbortSignal | undefined;
  const client = createActivityQueries(createDashboardTransport({
    baseUrl: "http://localhost",
    fetchImpl: (_url, init) => new Promise<Response>((_resolve, reject) => {
      observedSignal = init?.signal ?? undefined;
      observedSignal?.addEventListener("abort", () => reject(new DOMException("request cancelled", "AbortError")), { once: true });
    }),
  }));
  const controller = new AbortController();
  const request = client.activityReport("2026-09-20", "2026-09-20", controller.signal);
  controller.abort();
  await assert.rejects(request, (error: unknown) => error instanceof DashboardClientError
    && error.kind === "network" && error.retryable);
  assert.equal(observedSignal, controller.signal);
  assert.equal(controller.signal.aborted, true);
});

it("reads the complete population, browses the selected snapshot and downloads bound CSV through the same client", async () => {
  const h = harness();
  let observedSignal: AbortSignal | undefined;
  const paths: string[] = [];
  const client = createActivityQueries(createDashboardTransport({ baseUrl: "http://localhost", fetchImpl: (url, init) => {
    paths.push(String(url)); observedSignal = init?.signal ?? undefined;
    return Promise.resolve(h.app.request(url, init));
  } }));
  const controller = new AbortController();
  const selection = await client.activityPopulation(DAY, DAY, controller.signal);
  assert.equal(observedSignal, controller.signal);
  assert.equal(selection.population.length, selection.report.totalRuns);
  assert.match(selection.snapshot.token, /^ap1\./u);
  const read = await client.readActivityPopulation(selection, undefined, controller.signal);
  assert.deepEqual(read, { selection, browse: null });
  for (const query of [undefined, "", "   "]) {
    const browse = { metric: "completed" as const, page: 0, query };
    const result = await client.readActivityPopulation(selection, browse, controller.signal);
    assert.equal(result.browse?.identity.browse.query, query);
    const requested = new URL(paths.at(-1)!);
    const serialized = JSON.parse(requested.searchParams.get("browse")!) as Record<string, unknown>;
    assert.equal("query" in serialized, query !== undefined);
    assert.equal(observedSignal, controller.signal);
  }
  const download = await client.exportActivityPopulationCsv(selection, controller.signal);
  assert.equal(observedSignal, controller.signal);
  assert.equal(download.filename, `activity-${DAY}_${DAY}.csv`);
  assert.match(new TextDecoder().decode(download.bytes), /Complete selected run population/u);
});

it("rejects population content or range substitution and a selected response from another snapshot", async () => {
  const h = harness();
  const valid = await httpClient(h).activityPopulation(DAY, DAY);
  const respond = (value: unknown) => createActivityQueries(createDashboardTransport({ baseUrl: "http://localhost", fetchImpl: () => Promise.resolve(Response.json(value)) }));
  await assert.rejects(respond(valid).activityPopulation("2026-09-07", "2026-09-07"), /identity-mismatch/u);
  await assert.rejects(respond({ ...valid, snapshot: { ...valid.snapshot, populationDigest: "d".repeat(64) } }).activityPopulation(DAY, DAY), /identity-mismatch/u);
  const reportChanged = structuredClone(valid);
  reportChanged.report.durations.totalMs += 1;
  await assert.rejects(respond(reportChanged).activityPopulation(DAY, DAY), /identity-mismatch/u);
  const tokenChanged = structuredClone(valid);
  tokenChanged.snapshot.token = "ap1.foreign.signature";
  await assert.rejects(respond({ selection: tokenChanged, browse: null }).readActivityPopulation(valid), /selection-mismatch/u);
  const reportTokenChanged = structuredClone(valid);
  reportTokenChanged.report.snapshot.token = "as1.foreign.signature";
  reportTokenChanged.snapshot.reportToken = reportTokenChanged.report.snapshot.token;
  await assert.rejects(respond({ selection: reportTokenChanged, browse: null }).readActivityPopulation(valid), /selection-mismatch/u);
  await assert.rejects(respond({ selection: valid, browse: {} }).readActivityPopulation(valid), (error: unknown) => error instanceof DashboardClientError && error.kind === "schema");
});

it("rejects browse request, digest, range, token, selected run and presence substitutions", async () => {
  const h = harness();
  const actual = httpClient(h);
  const selection = await actual.activityPopulation(DAY, DAY);
  const browse = { metric: "completed" as const, page: 0, query: "" };
  const valid = await actual.readActivityPopulation(selection, browse);
  assert.ok(valid.browse);
  const respond = (value: unknown) => createActivityQueries(createDashboardTransport({ baseUrl: "http://localhost", fetchImpl: () => Promise.resolve(Response.json(value)) }));
  for (const change of [
    { ...valid, browse: null },
    { ...valid, browse: { ...valid.browse, identity: { ...valid.browse.identity, token: "ap1.foreign.signature" } } },
    { ...valid, browse: { ...valid.browse, identity: { ...valid.browse.identity, from: "2026-09-07" } } },
    { ...valid, browse: { ...valid.browse, identity: { ...valid.browse.identity, digest: "d".repeat(64) } } },
    { ...valid, browse: { ...valid.browse, start: 20 } },
    { ...valid, browse: { ...valid.browse, totalMatches: 1 } },
  ]) await assert.rejects(respond(change).readActivityPopulation(selection, browse), /browse-identity-mismatch/u);
  const withoutQuery = { metric: "completed" as const, page: 0 };
  const other = await actual.readActivityPopulation(selection, withoutQuery);
  await assert.rejects(respond(other).readActivityPopulation(selection, browse), /browse-identity-mismatch/u);
  await assert.rejects(respond(valid).readActivityPopulation(selection, withoutQuery), /browse-identity-mismatch/u);
  await assert.rejects(respond(valid).readActivityPopulation(selection), /browse-identity-mismatch/u);
  await assert.rejects(respond(valid).readActivityPopulation(selection, { ...browse, run: RunIdSchema.parse("11111111-1111-4111-8111-111111111111") }), /browse-identity-mismatch/u);
});

it("refuses substituted population downloads and preserves caller cancellation for every population read", async () => {
  const h = harness();
  const selection = await httpClient(h).activityPopulation(DAY, DAY);
  const real = await h.app.request(`/api/v1/reports/activity/population.csv?${new URLSearchParams({ from: DAY, to: DAY, snapshot: selection.snapshot.token })}`);
  const bytes = await real.arrayBuffer();
  for (const header of ["content-type", "content-disposition", "content-length", "etag", "x-selection-digest"]) {
    const headers = new Headers(real.headers); headers.set(header, "wrong");
    const client = createActivityQueries(createDashboardTransport({ baseUrl: "http://localhost", fetchImpl: () => Promise.resolve(new Response(bytes, { headers })) }));
    await assert.rejects(client.exportActivityPopulationCsv(selection), /mismatch/u);
  }
  const corrupted = bytes.slice(0); new Uint8Array(corrupted)[0] ^= 1;
  const wrong = createActivityQueries(createDashboardTransport({ baseUrl: "http://localhost", fetchImpl: () => Promise.resolve(new Response(corrupted, { headers: real.headers })) }));
  await assert.rejects(wrong.exportActivityPopulationCsv(selection), /mismatch/u);
  for (const action of [
    (client: ReturnType<typeof createActivityQueries>, signal: AbortSignal) => client.activityPopulation(DAY, DAY, signal),
    (client: ReturnType<typeof createActivityQueries>, signal: AbortSignal) => client.readActivityPopulation(selection, undefined, signal),
    (client: ReturnType<typeof createActivityQueries>, signal: AbortSignal) => client.readActivityPopulation(selection, { metric: "completed", page: 0 }, signal),
    (client: ReturnType<typeof createActivityQueries>, signal: AbortSignal) => client.exportActivityPopulationCsv(selection, signal),
  ]) {
    let observedSignal: AbortSignal | undefined;
    const client = createActivityQueries(createDashboardTransport({ baseUrl: "http://localhost", fetchImpl: (_url, init) => new Promise<Response>((_resolve, reject) => {
      observedSignal = init?.signal ?? undefined;
      observedSignal?.addEventListener("abort", () => reject(new DOMException("request cancelled", "AbortError")), { once: true });
    }) }));
    const controller = new AbortController();
    const request = action(client, controller.signal); controller.abort();
    await assert.rejects(request, (error: unknown) => error instanceof DashboardClientError && error.kind === "network" && error.retryable);
    assert.equal(observedSignal, controller.signal);
  }
});

function httpClient(h: ReturnType<typeof harness>) {
  return createActivityQueries(createDashboardTransport({ baseUrl: "http://localhost", fetchImpl: (url, init) => Promise.resolve(h.app.request(url, init)) }));
}

import { DAY, runRecordOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { harness, disposeHttpRouteHarness } from "../../../support/helpers/backend/http-route-harness.js";
afterEach(disposeHttpRouteHarness);

it("retains exact nonempty browse rows and refuses foreign row or run metadata", async () => {
  const h = harness();
  const run = runRecordOf({ seed: 401, enqueuedAt: `${DAY}T12:00:00.000Z`, displayName: "Selected person" });
  h.database.authority.runs.enqueue(run);
  const client = httpClient(h);
  const selection = await client.activityPopulation(DAY, DAY);
  assert.equal(selection.population.length, 1);
  const browse = { metric: "outstanding" as const, page: 0, run: run.envelope.runId };
  const valid = await client.readActivityPopulation(selection, browse);
  assert.equal(valid.browse?.rows.length, 1);
  assert.equal(valid.browse?.run?.runId, run.envelope.runId);
  assert.ok(valid.browse);
  for (const changed of [
    { ...valid.browse, rows: valid.browse.rows.map(row => ({ ...row, title: "Foreign title" })) },
    { ...valid.browse, run: { ...valid.browse.run, title: "Foreign title" } },
    { ...valid.browse, run: null },
    { ...valid.browse, rows: [] },
  ]) {
    const replacement = createActivityQueries(createDashboardTransport({ baseUrl: "http://localhost", fetchImpl: () => Promise.resolve(Response.json({ ...valid, browse: changed })) }));
    await assert.rejects(replacement.readActivityPopulation(selection, browse), /browse-identity-mismatch/u);
  }
});

it("preserves stale and foreign snapshot refusals without replacing the selection", async () => {
  const h = harness();
  const client = httpClient(h);
  const selection = await client.activityPopulation(DAY, DAY);
  await assert.rejects(httpClient(harness()).readActivityPopulation(selection), (error: unknown) => error instanceof DashboardClientError && error.status === 409 && error.code === "ACTIVITY_SNAPSHOT_INVALID_OR_EXPIRED");
  h.clock.advanceWall(15 * 60_000);
  await assert.rejects(client.readActivityPopulation(selection), (error: unknown) => error instanceof DashboardClientError && error.status === 409 && error.code === "ACTIVITY_SNAPSHOT_INVALID_OR_EXPIRED");
  await assert.rejects(client.exportActivityPopulationCsv(selection), (error: unknown) => error instanceof DashboardClientError && error.status === 409 && error.code === "ACTIVITY_SNAPSHOT_INVALID_OR_EXPIRED");
});
