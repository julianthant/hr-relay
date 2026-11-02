import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "vitest";
import { BrowserRootSchema, BrowserRootsSchema, type BrowserRootsDocument } from "../../../src/backend/storage/browser-root-contract.js";

function document(): BrowserRootsDocument {
  const profileId = randomUUID();
  return BrowserRootsSchema.parse({ schemaVersion: 1, installationId: randomUUID(), revision: 0, nextGeneration: 2,
    roots: [{ profileId, profileRoot: `profiles/${profileId}/browsers`, directory: `profiles/${profileId}/browsers/w1/crm`,
      owner: { kind: "worker", workerId: "person-lookup-worker-1", workflowId: "person-lookup", ordinal: 1,
        membershipRevision: 1, leaseGeneration: 1 }, sessionGeneration: 0, credentialFingerprint: "a".repeat(64),
      launch: { launchId: randomUUID(), generation: 1, state: "unknown" } }] });
}

it("bounds retained roots at 64 without discarding unknown launches", () => {
  const base = document(), row = base.roots[0]; assert.ok(row);
  const roots = Array.from({ length: 65 }, (_, index) => ({ ...row,
    profileRoot: `profiles/${row.profileId}/browser-${index}`, directory: `profiles/${row.profileId}/browser-${index}/w1/crm`,
    launch: { ...row.launch, launchId: randomUUID(), generation: index + 1 } }));
  const full = { ...base, nextGeneration: 66, roots: roots.slice(0, 64) };
  assert.equal(BrowserRootsSchema.parse(full).roots.filter(value => value.launch.state === "unknown").length, 64);
  assert.equal(BrowserRootsSchema.safeParse({ ...full, roots }).success, false);
  assert.equal(full.roots.length, 64);
});

const invalidDocuments: ReadonlyArray<readonly [string, (value: BrowserRootsDocument) => unknown]> = [
  ["future document", value => ({ ...value, schemaVersion: 2 })],
  ["unknown document field", value => ({ ...value, pruned: true })],
  ["unsafe revision", value => ({ ...value, revision: Number.MAX_SAFE_INTEGER + 1 })],
  ["generation reuse", value => ({ ...value, nextGeneration: 1 })],
  ["duplicate directory", value => ({ ...value, nextGeneration: 3, roots: [...value.roots,
    { ...value.roots[0], launch: { launchId: randomUUID(), generation: 2, state: "closed" } }] })],
  ["duplicate launch", value => { const row = value.roots[0]; assert.ok(row); return { ...value, nextGeneration: 3,
    roots: [...value.roots, { ...row, profileRoot: `profiles/${row.profileId}/other`, directory: `profiles/${row.profileId}/other/w1/crm`,
      launch: { ...row.launch, generation: 2 } }] }; }],
  ["duplicate generation", value => { const row = value.roots[0]; assert.ok(row); return { ...value,
    roots: [...value.roots, { ...row, profileRoot: `profiles/${row.profileId}/other`, directory: `profiles/${row.profileId}/other/w1/crm`,
      launch: { ...row.launch, launchId: randomUUID() } }] }; }],
];
for (const [name, invalid] of invalidDocuments) it(`refuses ${name}`, () => {
  assert.equal(BrowserRootsSchema.safeParse(invalid(document())).success, false);
});

for (const directory of ["/tmp/profile", "../profile", "profiles/../profile", "profiles\\profile", "profiles//profile", "profiles/./profile"])
  it(`refuses unsafe directory ${directory}`, () => {
    const row = document().roots[0]; assert.ok(row);
    assert.equal(BrowserRootSchema.safeParse({ ...row, directory }).success, false);
  });

it("binds worker paths to the actual profile, ordinal and browser system", () => {
  const row = document().roots[0]; assert.ok(row);
  for (const invalid of [
    { ...row, profileId: randomUUID() },
    { ...row, directory: `${row.profileRoot}/w2/crm` },
    { ...row, directory: `${row.profileRoot}/w1/unregistered-system` },
    { ...row, owner: { ...row.owner, workerId: "person-lookup-worker-2" } },
    { ...row, launch: { ...row.launch, state: "unused" } },
    { ...row, credentialFingerprint: "secret" },
  ]) assert.equal(BrowserRootSchema.safeParse(invalid).success, false);
});

it("binds signup directory to its operation, profile, account and provider generation", () => {
  const profileId = randomUUID(), operationId = randomUUID(), accountId = randomUUID();
  const row = BrowserRootSchema.parse({ profileId, profileRoot: "browsers/onboarding",
    directory: `browsers/onboarding/onboarding-${operationId}-${profileId}-${accountId}-g3`,
    owner: { kind: "signup", operationId, accountId, providerGeneration: 3 }, sessionGeneration: 0,
    credentialFingerprint: null, launch: { launchId: randomUUID(), generation: 1, state: "launching" } });
  for (const owner of [{ ...row.owner, accountId: randomUUID() }, { ...row.owner, providerGeneration: 4 },
    { ...row.owner, operationId: randomUUID() }, { ...row.owner, workerId: "person-lookup-worker-1" }])
    assert.equal(BrowserRootSchema.safeParse({ ...row, owner }).success, false);
});

it("includes native launch IDs and generations in the same document uniqueness boundary", () => {
  const value = document(), row = value.roots[0]; assert.ok(row);
  const native = { operationId: randomUUID(), launchId: randomUUID(), generation: 2,
    source: { device: 1, inode: 2 }, priorLaunchDigest: "b".repeat(64), phase: "probing" };
  const valid = { ...value, nextGeneration: 3, roots: [{ ...row, native }] };
  assert.equal(BrowserRootsSchema.safeParse(valid).success, true);
  for (const invalid of [{ ...native, generation: row.launch.generation }, { ...native, launchId: row.launch.launchId },
    { ...native, phase: "assumed-closed" }, { ...native, priorLaunchDigest: "invalid" }, { ...native, source: { device: -1, inode: 2 } }])
    assert.equal(BrowserRootsSchema.safeParse({ ...valid, roots: [{ ...row, native: invalid }] }).success, false);
});


it("refuses extra authority fields at every retained row boundary", () => {
  const value = document(), row = value.roots[0]; assert.ok(row);
  for (const invalid of [{ ...row, reusable: true }, { ...row, owner: { ...row.owner, processDead: true } },
    { ...row, launch: { ...row.launch, closedProof: true } }, { ...row, native: { operationId: randomUUID(),
      launchId: randomUUID(), generation: 2, source: { device: 1, inode: 2, closed: true }, priorLaunchDigest: "b".repeat(64), phase: "observed" } }])
    assert.equal(BrowserRootSchema.safeParse(invalid).success, false);
});
