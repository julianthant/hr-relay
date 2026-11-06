import assert from "node:assert/strict";
import { it } from "vitest";
import { peoplePlugin } from "../../../../../src/backend/assistant/plugins/people/index.js";
import { AssistantToolRefusal } from "../../../../../src/backend/assistant/plugins/plugin.js";
import { AssistantReferenceError, createAssistantReferenceTable } from "../../../../../src/backend/assistant/references.js";
import type { AssistantPluginDeps } from "../../../../../src/backend/assistant/plugins/registry.js";
import type { CrossDateSearchPage, CrossDateSearchQueryInput } from "../../../../../src/models/dashboard/search.js";

const unused = () => { throw new Error("not read by find_people"); };
function tool() {
  const queries: CrossDateSearchQueryInput[] = [];
  const deps: AssistantPluginDeps = { runDetail: unused, notifications: unused, workbookCatalog: unused, settings: unused, facts: unused,
    search(query) { queries.push(query); return { wireVersion: 1, generatedAt: "2026-11-06T00:00:00.000Z", snapshot: { authorityGeneration: 1, order: "match-strength/enqueued-desc/run-id-asc:v2", token: "t" },
      totalMatches: 0, coverage: { matched: 0, subjectUnavailable: 0, actorUnavailable: 0, candidateLimit: 10000 }, results: [], nextCursor: { state: "absent", reason: "end" } } as unknown as CrossDateSearchPage; } };
  const [findPeople] = peoplePlugin(deps, id => id).tools; assert.ok(findPeople);
  const references = createAssistantReferenceTable(3);
  const context = { signal: new AbortController().signal, references, actorId: "local-operator", assertCurrent() {} };
  return { queries, references, run: (query: string) => findPeople.invoke({ query }, context) };
}

it("searches a current reference by its expanded value and plain text as typed", async () => {
  const t = tool(), eid = t.references.issue("E", "10812345", "10812345"), person = t.references.issue("P", "Avery Synthetic", "Avery Synthetic");
  await t.run(eid); await t.run(`${person} again`); await t.run("Jordan Lee");
  assert.deepEqual(t.queries.map(query => query.q), ["10812345", "Avery Synthetic again", "Jordan Lee"]);
});

it("refuses stale, unknown, foreign-kind and over-bound queries before any search", async () => {
  const t = tool();
  const run = t.references.issue("R", "run-a", "run", "run-a"), long = t.references.issue("P", "x".repeat(150), "x".repeat(150));
  for (const [query, reason] of [["[[P1.g2]]", "reference-expired"], ["[[P7.g3]]", "reference-unknown"], ["Smith [[X1.g3]]", "reference-unknown"], [run, "reference-kind"]] as const) {
    await assert.rejects(t.run(query), (error: unknown) => error instanceof AssistantReferenceError && error.reason === reason, query);
  }
  await assert.rejects(t.run(`${long} and someone else`), (error: unknown) => error instanceof AssistantToolRefusal && error.code === "ASSISTANT_LIMIT");
  assert.deepEqual(t.queries, []);
});
