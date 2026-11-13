import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { it } from "vitest";
import { peoplePlugin } from "../../../../../src/backend/assistant/plugins/people/index.js";
import { AssistantToolRefusal } from "../../../../../src/backend/assistant/plugins/plugin.js";
import { AssistantReferenceError, createAssistantReferenceTable } from "../../../../../src/backend/assistant/references.js";
import type { AssistantPluginDeps } from "../../../../../src/backend/assistant/plugins/registry.js";
import type { CrossDateSearchPage, CrossDateSearchQueryInput } from "../../../../../src/models/dashboard/search.js";

const unused = () => { throw new Error("not read by find_people"); };
function tool(findLookupRuns: AssistantPluginDeps["findLookupRuns"] = () => []) {
  const queries: CrossDateSearchQueryInput[] = [], eids: string[] = [];
  const deps: AssistantPluginDeps = { runReferenceLabel: unused, findLookupRuns(eid) { eids.push(eid); return findLookupRuns(eid); }, runDetail: unused, notifications: unused, workbooks: unused, attachment: unused, settings: unused, facts: unused,
    search(query) { queries.push(query); return { wireVersion: 1, generatedAt: "2026-11-06T00:00:00.000Z", snapshot: { authorityGeneration: 1, order: "match-strength/enqueued-desc/run-id-asc:v2", token: "t" },
      totalMatches: 0, coverage: { matched: 0, subjectUnavailable: 0, actorUnavailable: 0, candidateLimit: 10000 }, results: [], nextCursor: { state: "absent", reason: "end" } } as unknown as CrossDateSearchPage; } };
  const [findPeople] = peoplePlugin(deps, id => id).tools; assert.ok(findPeople?.kind === "read");
  const references = createAssistantReferenceTable(3);
  const context = { signal: new AbortController().signal, references, actorId: "local-operator", conversationId: "22222222-2222-4222-8222-222222222222", operatorText: "", assertCurrent() {}, assertRetainedCurrent() {} };
  return { queries, eids, references, run: (query: string) => findPeople.invoke({ query }, context) };
}

it("searches a current reference by its expanded value and plain text as typed", async () => {
  const t = tool(), eid = t.references.issue("E", "10812345", "10812345"), person = t.references.issue("P", "Avery Synthetic", "Avery Synthetic");
  await t.run(eid); await t.run(`${person} again`); await t.run("Jordan Lee");
  assert.deepEqual(t.queries.map(query => query.q), ["Avery Synthetic again", "Jordan Lee"]);
  assert.deepEqual(t.eids, ["10812345"]);
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

const People = z.object({ people: z.array(z.object({ person: z.string(), runs: z.array(z.object({ run: z.string(), workflow: z.string(), day: z.string() })) })), more: z.boolean() });
const lookupRun = (runId: string, version = 1, eid = "10000001") => ({ runId, version, day: "2026-11-08", status: "queued" as const, label: `Person Lookup · EID ${eid} · 2026-11-08T12:00:00Z · attempt 1` });

it("maps shuffled EID references to their exact queued run and revision with token-only facts", async () => {
  const ids = [randomUUID(), randomUUID(), randomUUID()], eids = ["10000002", "10812345", "10000001"];
  const t = tool(eid => { const index = eids.indexOf(eid); if (index < 0) return [];
    const id = ids[index]; assert.ok(id); return [lookupRun(id, index + 2, eid)]; });
  for (const index of [2, 0, 1]) {
    const eid = eids[index], id = ids[index]; assert.ok(eid && id);
    const output = People.parse(await t.run(t.references.issue("E", eid, eid))), person = output.people[0]; assert.ok(person);
    assert.equal(t.references.resolve(person.person, ["P"]).expand, eid);
    const run = person.runs[0]; assert.ok(run);
    assert.deepEqual(t.references.resolve(run.run, ["R"]), { kind: "R", target: id, expand: id, version: index + 2,
      display: lookupRun(id, index + 2, eid).label });
    assert.equal(output.more, false);
    for (const privateValue of [...eids, ...ids]) assert.equal(JSON.stringify(output).includes(privateValue), false);
  }
  assert.deepEqual(t.queries, []);
});

it("does not use a selected run when an exact EID has no candidates", async () => {
  const t = tool(), selected = t.references.issue("R", randomUUID(), "selected", "selected-id", 3);
  assert.deepEqual(People.parse(await t.run(t.references.issue("E", "10000002", "10000002"))), { people: [], more: false });
  assert.equal(t.references.resolve(selected, ["R"]).version, 3);
});

it("keeps duplicate EID candidates explicit and marks truncation beyond five runs", async () => {
  const candidates = Array.from({ length: 6 }, (_, index) => lookupRun(randomUUID(), index + 1)), t = tool(() => candidates);
  const output = People.parse(await t.run(t.references.issue("E", "10000001", "10000001")));
  assert.equal(output.more, true); assert.equal(output.people.length, 1);
  const person = output.people[0]; assert.ok(person); assert.equal(person.runs.length, 5);
  assert.deepEqual(person.runs.map(run => t.references.resolve(run.run, ["R"]).target), candidates.slice(0, 5).map(run => run.runId));
});
