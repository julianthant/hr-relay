import { AuthorityDatabase, createClonedProfileFixtures, type BoundProfileStorageFixture } from "../../../support/helpers/admission-fixture.js";
import { NOTIFICATION } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe,it } from "vitest";
import { buildIntakeManifest } from "../../../../src/models/intake/manifest.js";
import { IntakeSessionSchema } from "../../../../src/models/intake/session.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { foundationFixture } from "../../../support/helpers/database-foundation/fixtures.js";
const NOW = "2026-09-09T12:00:00.000Z";
const hash = "a".repeat(64);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function session(n = 1) {
  return IntakeSessionSchema.parse({ intakeSessionId: id(n), actorId: "local-operator", workflow: "person-lookup",
    artifact: { id: id(90), sha256: hash, bytes: 9, mediaType: "text/csv" },
    sourceName: "synthetic.csv", sheet: "default", headerRowIndex: null, bindings: [], constants: [], corrections: [], exclusions: [],
    state: "mapping", validation: { state: "none" }, reservedManifestId: id(n + 10), version: 1, createdAt: NOW, updatedAt: NOW });
}
function manifest(n = 1) {
  return buildIntakeManifest({ manifestId: id(n + 10), workflow: "person-lookup",
    source: { artifactId: id(90), sha256: hash, originalName: "synthetic.csv" }, mappingFingerprint: hash, mappingSnapshotHash: hash,
    intakeProjectionFingerprint: hash, workflowContractFingerprint: hash, canonicalInputSchemaHash: hash, createdAt: NOW,
    sourceRows: 1, valid: [{ sourceRow: 1, itemId: id(80), inputHash: hash, parsedInput: { value: "retained" } }],
    currentRejects: new Map(), rejectionHistory: [], corrections: [], exclusions: [] });
}
describe("native imported-artifact contracts", () => {
  for (const mode of ["read", "write"] as const) it(`rechecks profile authority before committing a ${mode} operation`, async () => {
    const f = await foundationFixture();
    const path = join(f.profile.machine.stateRoot, "machine", "profiles.json");
    const before = readFileSync(path);
    const generation = f.db.getMeta().authorityGeneration;
    try {
      const work = () => {
        if (mode === "write") f.db.authority.intakeSessions.create(session());
        writeFileSync(path, "{}");
      };
      assert.throws(() => mode === "write"
        ? f.db.withAuthorityTransaction(work)
        : f.db.withAuthorityReadSnapshot(work), { name: "ZodError" });
      writeFileSync(path, before);
      assert.equal(f.db.authority.intakeSessions.get(id(1)), undefined);
      assert.equal(f.db.getMeta().authorityGeneration, generation);
    } finally {
      writeFileSync(path, before);
      await f.dispose();
    }
  });
  it("keeps nested writes and generation in the outer transaction and freezes submitted content", async () => {
    const f = await foundationFixture();
    const db = f.db;
    try {
      const generation = db.getMeta().authorityGeneration;
      assert.throws(() => db.withAuthorityTransaction((a) => { a.intakeSessions.create(session()); a.intakeManifests.insert(manifest()); throw new Error("audit-fault"); }), /audit-fault/u);
      assert.equal(db.authority.intakeSessions.get(id(1)), undefined);
      assert.equal(db.authority.intakeManifests.get(id(11)), undefined);
      assert.equal(db.getMeta().authorityGeneration, generation);
      db.withAuthorityTransaction((a) => {
        a.intakeSessions.create(session()); a.intakeManifests.insert(manifest());
        a.intakeSessions.update({ ...session(), state: "enqueued", intakeManifestId: id(11), version: 2 });
      });
      const raw = new DatabaseSync(f.path);
      try { assert.throws(() => raw.exec("INSERT OR REPLACE INTO artifacts SELECT * FROM artifacts"), /artifact-identity-conflict/u); } finally { raw.close(); }
      const frozen = canonicalJsonStringify(db.authority.intakeManifests.get(id(11)));
      const savedGeneration = db.getMeta().authorityGeneration;
      assert.equal(db.authority.intakeManifests.insert(manifest()).state, "existing");
      assert.equal(db.getMeta().authorityGeneration, savedGeneration);
      assert.throws(() => db.authority.intakeManifests.insert({ ...manifest(), createdAt: "2026-09-10T12:00:00.000Z" }), /different content/u);
      assert.throws(() => db.authority.intakeSessions.update({ ...session(), version: 3 }), /submission-immutable/u);
      assert.equal(canonicalJsonStringify(db.authority.intakeManifests.get(id(11))), frozen);
    } finally { await f.dispose(); }
  });
});

it("clones seeded profile state without sharing writes or a live canonical path", async () => {
  const fixtures = createClonedProfileFixtures();
  const held: BoundProfileStorageFixture[] = [];
  const databases: AuthorityDatabase[] = [];
  try {
    const first = await fixtures.create(); held.push(first);
    const peer = await fixtures.create(); held.push(peer);
    assert.notEqual(peer.path, first.path);
    const originalInode = lstatSync(first.path).ino;
    const database = AuthorityDatabase.open({ path: first.path, busyTimeoutMs: 250, migrationOwner: "clone-isolation" });
    databases.push(database);
    database.authority.notifications.create({ ...NOTIFICATION, trigger: "backfill-gap", links: [] });
    database.close();
    await first.close();
    const next = await fixtures.create(); held.push(next);
    assert.equal(next.path, first.path);
    assert.notEqual(lstatSync(next.path).ino, originalInode);
    await first.close();
    next.admission.assertLive();
    for (const profile of [next, peer]) {
      const current = AuthorityDatabase.open({ path: profile.path, busyTimeoutMs: 250, migrationOwner: "clone-isolation" });
      databases.push(current);
      assert.equal(current.authority.notifications.get(NOTIFICATION.notificationId), undefined);
      current.close();
    }
  } finally {
    for (const database of databases) database.close();
    for (const profile of held) await profile.close();
    await fixtures.close();
  }
});
