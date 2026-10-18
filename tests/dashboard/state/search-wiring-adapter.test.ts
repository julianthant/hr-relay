// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it } from "vitest";
import { readSearchSnapshot, searchResults, useSearchWiring, searchMessage, workspaceSearchQuery } from "../../../src/dashboard/state/search-wiring-adapter.js";
import { CrossDateSearchPageSchema, type CrossDateSearchQueryInput } from "../../../src/models/dashboard/search.js";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { zeroMatchSearchPage } from "../../support/helpers/dashboard/search-page-fixtures.js";
import { WorkflowIdSchema } from "../../../src/rules/identity/ids.js";
import type { NavbarData } from "../../../src/dashboard/surfaces/shell/search/navbar-view-model.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); });
const cursor = `sc1.e30.${"a".repeat(64)}`;
function result(n: number) { return { runId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, traceId: "pl-120000-0099", workflowId: "person-lookup", partitionDay: "2026-08-03",
  registration: { state: "registered", label: "Person Lookup", code: "pl", categoryId: "people" }, state: "done", shape: "single", dryRun: true, priority: "bulk", systems: [],
  runNumber: { state: "absent", reason: "not recorded" }, retryOf: { state: "absent", reason: "first" }, enqueuedAt: "2026-08-03T12:00:00Z", endedAt: { state: "absent", reason: "not recorded" }, match: { field: "workflow", strength: "contains" },
  metadata: { subject: { state: "available", value: `Subject ${n}` }, actor: { state: "unavailable", reason: "not-recorded" }, version: 1, failureCode: null, evidence: { receipt: false, failure: false, diagnostic: false } } }; }
function page(n: number, next = false) { return CrossDateSearchPageSchema.parse({ ...zeroMatchSearchPage(), totalMatches: 2, coverage: { matched: 2, subjectUnavailable: 0, actorUnavailable: 0, candidateLimit: 10000 }, results: [result(n)], nextCursor: next ? { state: "present", value: cursor } : { state: "absent", reason: "end" } }); }
it("materializes signed pages under the same query/facets/snapshot and uses the authority total", async () => {
  const requests: CrossDateSearchQueryInput[] = [];
  const client = { searchRuns: async (query: CrossDateSearchQueryInput) => { requests.push(query); return requests.length === 1 ? page(1, true) : page(2); } };
  const snapshot = await readSearchSnapshot(client, { q: "person", facets: { from: "2026-08-01", to: "2026-08-04", workflow: "person-lookup" }, limit: 1 }, new AbortController().signal);
  assert.equal(snapshot.totalMatches, 2); assert.equal(snapshot.results.length, 2);
  assert.deepEqual(requests[1], { ...requests[0], cursor });
  assert.equal(searchResults(snapshot)[1].destination?.kind, "run");
});
it("refuses inconsistent snapshots, repeated cursors, duplicates, incomplete totals and authority refusals", async () => {
  for (const second of [CrossDateSearchPageSchema.parse({ ...page(2), totalMatches: 3 }), { ...page(2), snapshot: { ...page(2).snapshot, token: "different" } }, page(1), page(2, true)]) {
    let count = 0;
    await assert.rejects(readSearchSnapshot({ searchRuns: async () => ++count === 1 ? page(1, true) : second }, { q: "person" }, new AbortController().signal));
  }
  await assert.rejects(readSearchSnapshot({ searchRuns: async () => page(1) }, { q: "person" }, new AbortController().signal), /INCOMPLETE/);
  await assert.rejects(readSearchSnapshot({ searchRuns: async () => { throw new Error("cursor expired"); } }, { q: "person", cursor }, new AbortController().signal), /cursor expired/);
});
it("keeps unavailable subject explicit without inventing an alias or destination", async () => {
  const missing = CrossDateSearchPageSchema.parse({ ...zeroMatchSearchPage(), totalMatches: 1, results: [{ ...result(1), metadata: { ...result(1).metadata, subject: { state: "unavailable", reason: "withheld" } } }] });
  const snapshot = await readSearchSnapshot({ searchRuns: async () => missing }, { q: "x" }, new AbortController().signal);
  const row = searchResults(snapshot)[0]; assert.equal(row.subject, searchMessage("SEARCH_SUBJECT_UNAVAILABLE")); assert.equal(row.publicId, undefined);
  assert.deepEqual(row.destination, { kind: "run", runId: missing.results[0].runId, day: "2026-08-03" });
});
it("does no reads in mock/closed mode and suppresses a stale query result", async () => {
  const requests: { q: string; finish: (page: unknown) => void }[] = [];
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async url => new Promise<Response>(resolve => {
    requests.push({ q: new URL(url).searchParams.get("q") ?? "", finish: value => resolve(Response.json(value)) });
  }) });
  let data: NavbarData | undefined; const epoch = {}, workflows: Parameters<typeof workspaceSearchQuery>[1] = [];
  function Probe({ query, enabled }: { query: string; enabled: boolean }) { data = useSearchWiring({ client, query, enabled, today: "2026-08-03", epoch, workflows }); return null; }
  root = createRoot(document.createElement("div"));
  const render = async (query: string, enabled: boolean) => { await act(async () => root?.render(createElement(Probe, { query, enabled }))); };
  await render("old", false); assert.equal(requests.length, 0);
  await render("old", true); await render("new", true);
  await act(async () => requests[1].finish(zeroMatchSearchPage()));
  assert.equal(data?.totalMatches, 0);
  await act(async () => requests[0].finish({ ...zeroMatchSearchPage(), totalMatches: 1, results: [result(1)] }));
  assert.equal(data?.totalMatches, 0); assert.equal(data?.results.length, 0);
});

it.each([
  ["  pErSoN LoOkUp  ", "", "person-lookup", null],
  ["  FAILED  ", "", null, "failed"],
  ["pl-120000-0099", "pl-120000-0099", null, null],
  ["Person", "Person", null, null],
] as const)("maps exact workflow/status search %s through canonical facets and preserves ordinary text", async (query, q, workflow, state) => {
  const requests: URL[] = [];
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async url => {
    requests.push(new URL(url)); return Response.json(zeroMatchSearchPage());
  } });
  const workflows = [{ id: WorkflowIdSchema.parse("person-lookup"), label: "Person Lookup" }];
  const epoch = {};
  function Probe() { useSearchWiring({ client, enabled: true, query, today: "2026-08-03", epoch, workflows }); return null; }
  root = createRoot(document.createElement("div"));
  await act(async () => root?.render(createElement(Probe)));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].searchParams.get("q"), q);
  assert.equal(requests[0].searchParams.get("workflow"), workflow);
  assert.equal(requests[0].searchParams.get("state"), state);
  assert.equal(requests[0].searchParams.get("scope"), "all");
});

it("keeps ambiguous labels and ordinary names as text queries", () => {
  const workflows = [{ id: WorkflowIdSchema.parse("person-lookup"), label: "Same" }, { id: WorkflowIdSchema.parse("separations"), label: "Same" }];
  assert.deepEqual(workspaceSearchQuery("Same", workflows), { q: "Same", scope: "all", facets: {}, limit: 20 });
  assert.deepEqual(workspaceSearchQuery("Fable, Rowan", workflows), { q: "Fable, Rowan", scope: "all", facets: {}, limit: 20 });
});

it("drops a settlement when bootstrap workflow metadata changes under the same search text", async () => {
  const pending: { url: URL; finish: (page: unknown) => void }[] = [];
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async url => new Promise<Response>(resolve => {
    pending.push({ url: new URL(url), finish: value => resolve(Response.json(value)) });
  }) });
  const epoch = {};
  let data: NavbarData | undefined;
  function Probe({ workflows }: { workflows: Parameters<typeof workspaceSearchQuery>[1] }) {
    data = useSearchWiring({ client, enabled: true, query: "Lookup", workflows, today: "2026-08-03", epoch }); return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root?.render(createElement(Probe, { workflows: [{ id: WorkflowIdSchema.parse("person-lookup"), label: "Lookup" }] })));
  await act(async () => root?.render(createElement(Probe, { workflows: [{ id: WorkflowIdSchema.parse("separations"), label: "Lookup" }] })));
  assert.deepEqual(pending.map(request => request.url.searchParams.get("workflow")), ["person-lookup", "separations"]);
  await act(async () => pending[1].finish(zeroMatchSearchPage()));
  assert.equal(data?.totalMatches, 0);
  await act(async () => pending[0].finish({ ...zeroMatchSearchPage(), totalMatches: 1, results: [result(1)] }));
  assert.equal(data?.totalMatches, 0);
  assert.equal(data?.results.length, 0);
});
