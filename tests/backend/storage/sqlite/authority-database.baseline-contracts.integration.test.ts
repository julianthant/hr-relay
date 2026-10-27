import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
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
