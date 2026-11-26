import assert from "node:assert/strict";
import { it } from "vitest";
import { createShellQueries } from "../../../../src/dashboard/client/queries/shell-queries.js";
import { createDashboardTransport } from "../../../../src/dashboard/client/transport.js";
import { CROSS_DATE_SEARCH_ORDER } from "../../../../src/models/dashboard/search.js";

it("resumes search with an opaque cursor and accepts the lane's JSON response", async () => {
  const cursor = "opaque+/= cursor";
  const page = { wireVersion: 1, generatedAt: "2026-08-03T17:00:00.000Z",
    snapshot: { authorityGeneration: 7, order: CROSS_DATE_SEARCH_ORDER, token: "signed-snapshot" },
    totalMatches: 0, coverage: { matched: 0, subjectUnavailable: 0, actorUnavailable: 0, candidateLimit: 10000 },
    results: [], nextCursor: { state: "absent", reason: "no more results" } };
  const transport = createDashboardTransport({ baseUrl: "http://localhost", fetchImpl: async input => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/api/v1/search");
    assert.deepEqual(Object.fromEntries(url.searchParams), { q: "", scope: "all", day: "2026-08-03", limit: "1", cursor });
    return new Response(JSON.stringify(page), { headers: { "content-type": "application/json" } });
  } });
  const queries = createShellQueries(transport);
  assert.deepEqual(await queries.searchRuns({ q: "", facets: { day: "2026-08-03" }, limit: 1, cursor }), page);
});
