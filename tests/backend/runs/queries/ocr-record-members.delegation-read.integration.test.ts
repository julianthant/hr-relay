import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it, vi } from "vitest";
import { readOcrQueueMembers } from "../../../../src/backend/runs/queries/ocr-record-members.js";
import { authenticateDelegationGroup } from "../../../../src/backend/storage/sqlite/delegation-authority.js";
import { authenticateRootRun } from "../../../../src/backend/storage/sqlite/delegation-root-authority.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../src/backend/systems/ucpath/driver/fake.js";
import { lifecycleCommandId } from "../../../../src/rules/identity/identifiers.js";
import { ActorIdSchema, NodeIdSchema } from "../../../../src/rules/identity/ids.js";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";
import { EXECUTOR_EID, healthyCrmDriver, sessionFactoryHarness } from "../../../support/helpers/phase1f-executor-harness.js";

const world = createOcrReviewWorld();
afterEach(world.cleanup);
type Fixture = Awaited<ReturnType<typeof world.fixture>>;

const LOOKUP_NAMES = ["Example, Avery", "Example, Robin", "Example, Avery"];

function lookupFixture() {
  const person = { emplId: EXECUTOR_EID, name: "Example, Avery", department: "Housing Dining Hospitality", jobTitle: "Fixture employee",
    employeeStatus: "active" as const, hdh: true, hrStatus: "Active", startDate: "", effectiveDate: "", terminationDate: "", terminationReason: "" };
  const sessions = sessionFactoryHarness({ ucpath: () => createDeterministicUcpathPersonOrgDriver({ results: [person],
    selection: { status: "resolved", selected: person, candidateEids: [EXECUTOR_EID] } }), crm: () => healthyCrmDriver() });
  return world.fixture({ record: true, release: true, pageCount: 3, lookupNames: LOOKUP_NAMES, pauseAtLookup: true, sessions });
}

function readMembers(f: Fixture) {
  return readOcrQueueMembers(f.database.authority, f.canonical.lifecycle, f.run.envelope.runId, id => f.resolve(id)?.label ?? id);
}

/** Counts the reads of each given command row while `read` runs. */
function countCommandReads<Result>(ids: readonly string[], read: () => Result): { result: Result; reads: number[] } {
  const reads = ids.map(() => 0);
  // Captured before the prototype probe and invoked below with its original connection.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const nativePrepare = DatabaseSync.prototype.prepare;
  const probe = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function countReads(this: DatabaseSync, sql: string) {
    const statement = nativePrepare.call(this, sql);
    if (!/\bFROM commands\b/.test(sql)) return statement;
    return new Proxy(statement, { get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      return (...parameters: unknown[]) => {
        if (property === "get" || property === "all")
          for (const [index, id] of ids.entries()) if (parameters.includes(id)) reads[index] = (reads[index] ?? 0) + 1;
        const returned: unknown = Reflect.apply(value, target, parameters);
        return returned;
      };
    } });
  });
  try { return { result: read(), reads }; } finally { probe.mockRestore(); }
}

it("authenticates each delegation group and the root run once in one read of an OCR run's record members", async () => {
  const f = await lookupFixture();
  const repositories = f.database.authority;
  const groups = repositories.dependencies.groups(f.run.envelope.runId, "retained").filter(({ group }) => group.children.length > 0);
  assert.deepEqual(groups.map(({ group }) => group.invocation.nodeId).toSorted(), ["lookup-identities", "read-pages"]);
  // Each group authentication reads its first member's creation command once; the root authentication reads its creation command once.
  const proofs = [...groups.map(({ group }) => lifecycleCommandId("delegation-child-create", { invocationCommandId: group.invocation.commandId, index: 0 })),
    authenticateRootRun(repositories, f.run).create.commandId];
  const { result, reads } = countCommandReads(proofs, () => f.database.withAuthorityReadSnapshot(() => readMembers(f)));
  assert.deepEqual(result?.members.map(member => member.statusLabel), ["Looking up", "Looking up", "Looking up"]);
  assert.deepEqual(reads, [1, 1, 1]);
});

it("refuses a tampered delegation group on every read of a snapshot and again in the next snapshot", async () => {
  const f = await lookupFixture();
  const pages = f.database.authority.dependencies.groups(f.run.envelope.runId).find(({ group }) => group.invocation.nodeId === "read-pages");
  const member = pages?.group.children[0]; assert.ok(member);
  assert.equal(f.database.withAuthorityReadSnapshot(() => readMembers(f))?.members.length, 3);
  const raw = new DatabaseSync(f.path);
  try {
    const tampered = raw.prepare("UPDATE delegation_dependencies SET payload_json = replace(payload_json, ?, ?) WHERE id = ?")
      .run(`"childItemId":${JSON.stringify(member.dependency.childItemId)}`, `"childItemId":${JSON.stringify(randomUUID())}`, member.dependency.dependencyId);
    assert.equal(tampered.changes, 1);
  } finally { raw.close(); }
  const refusal = /^delegation-dependency-binding-mismatch$/;
  f.database.withAuthorityReadSnapshot(() => {
    assert.throws(() => readMembers(f), { message: refusal });
    assert.throws(() => readMembers(f), { message: refusal });
  });
  assert.throws(() => f.database.withAuthorityReadSnapshot(() => readMembers(f)), { message: refusal });
});

it("shows a lookup that settles between two reads in the second read", async () => {
  const f = await lookupFixture();
  const labels = () => f.database.withAuthorityReadSnapshot(() => {
    const first = readMembers(f)?.members.map(member => member.statusLabel);
    assert.deepEqual(readMembers(f)?.members.map(member => member.statusLabel), first);
    return first;
  });
  assert.deepEqual(labels(), ["Looking up", "Looking up", "Looking up"]);
  const settled = await f.canonical.step(f.run, new AbortController().signal);
  assert.equal(settled.run.envelope.workflow, "person-lookup");
  assert.equal(settled.outcome.state, "done");
  assert.deepEqual(labels(), ["Verified", "Looking up", "Verified"]);
});

it("keeps the read snapshot's authentications out of write transactions and repository copies, and hands out copies", async () => {
  const f = await lookupFixture();
  const authority = f.database.authority;
  const root = [authenticateRootRun(authority, f.run).create.commandId];
  const twice = (repositories: typeof authority) => { authenticateRootRun(repositories, f.run); authenticateRootRun(repositories, f.run); };
  assert.deepEqual(countCommandReads(root, () => f.database.withAuthorityReadSnapshot(() => twice(authority))).reads, [1]);
  assert.deepEqual(countCommandReads(root, () => f.database.withAuthorityTransaction(repositories => twice(repositories))).reads, [2]);
  assert.deepEqual(countCommandReads(root, () => f.database.withAuthorityReadSnapshot(() => twice({ ...authority }))).reads, [2]);

  const manifest = authority.dependencies.groups(f.run.envelope.runId).find(({ group }) => group.invocation.nodeId === "read-pages")?.manifest;
  assert.ok(manifest);
  f.database.withAuthorityReadSnapshot(() => {
    const proof = authenticateRootRun(authority, f.run), requestedBy = proof.command.requestedBy;
    proof.command.requestedBy = ActorIdSchema.parse("someone-else");
    assert.equal(authenticateRootRun(authority, f.run).command.requestedBy, requestedBy);
    const group = authenticateDelegationGroup(authority, manifest);
    group.invocation.nodeId = NodeIdSchema.parse("another-node");
    assert.equal(authenticateDelegationGroup(authority, manifest).invocation.nodeId, "read-pages");
  });
});
