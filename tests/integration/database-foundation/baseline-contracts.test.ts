import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "vitest";
import { AuthorityDatabase } from "../../helpers/synthetic-storage-admission.js";
import { SQLITE_MIGRATIONS } from "../../../src/backend/storage/sqlite/migrations.js";
import { convertImportedArtifacts, createImportedArtifactRepositories } from "../../../src/backend/storage/sqlite/imported-artifacts.js";
import { importedArtifact } from "../../../src/domain/intake/imported-artifact.js";
import { IntakeSessionSchema } from "../../../src/domain/intake/session.js";
import { buildIntakeManifest } from "../../../src/domain/intake/manifest.js";
import { canonicalJsonStringify } from "../../../src/domain/canonical-json.js";
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
function historical() {
  const db = new DatabaseSync(":memory:");
  for (const migration of SQLITE_MIGRATIONS.filter((m) => m.version <= 41)) for (const sql of migration.statements) db.exec(sql);
  const submitted = manifest();
  const prepared = { ...session(), state: "enqueued", intakeManifestId: submitted.manifestId };
  const prepJson = JSON.stringify(prepared, null, 2); const manifestJson = JSON.stringify(submitted, null, 2);
  db.prepare("INSERT INTO intake_sessions VALUES(?,?,?,?,?,?,?)").run(id(1), "person-lookup", hash, "enqueued", prepJson, NOW, NOW);
  db.prepare("INSERT INTO intake_manifests VALUES(?,?,?,?,?,?)").run(submitted.manifestId, "person-lookup", hash, hash, manifestJson, NOW);
  const historicalOnly = manifest(2);
  db.prepare("INSERT INTO intake_manifests VALUES(?,?,?,?,?,?)").run(historicalOnly.manifestId, "person-lookup", hash, hash, JSON.stringify(historicalOnly), NOW);
  return { db, prepJson, manifestJson, submitted, historicalOnly };
}
function convert(db: DatabaseSync) {
  db.exec("BEGIN");
  try {
    const migration = SQLITE_MIGRATIONS.find((m) => m.version === 42); assert.ok(migration);
    for (const sql of migration.statements) {
      if (sql === "DROP TABLE intake_sessions") convertImportedArtifacts(db);
      db.exec(sql);
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

describe("F imported-artifact baseline contracts", () => {
  it("converts explicit pairs and distinct same-byte manifest-only history, preserving JSON and aliases", () => {
    const f = historical();
    try {
      convert(f.db);
      const rows = f.db.prepare("SELECT record_json FROM imported_artifacts ORDER BY record_key").all(); assert.equal(rows.length, 2);
      assert.deepEqual(JSON.parse(String(rows[0]?.record_json)), importedArtifact(f.prepJson, f.manifestJson));
      const repositories = createImportedArtifactRepositories({ database: f.db, mutate: (work) => work().result });
      assert.deepEqual(repositories.manifests.get(f.submitted.manifestId), f.submitted);
      assert.deepEqual(repositories.manifests.get(f.historicalOnly.manifestId), f.historicalOnly);
      assert.equal(repositories.sessions.get(id(1))?.intakeManifestId, f.submitted.manifestId);
      assert.equal(f.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name IN ('intake_sessions','intake_manifests','ocr_extractions')").get()?.n, 0);
    } finally { f.db.close(); }
  });
  for (const fault of ["missing", "source-conflict", "duplicate-link"] as const) it(`refuses ${fault} atomically with the positive conversion reaching this same boundary`, () => {
    const f = historical();
    try {
      if (fault === "missing") { f.db.exec("DROP TRIGGER intake_manifests_never_deleted"); f.db.prepare("DELETE FROM intake_manifests WHERE record_key=?").run(f.submitted.manifestId); }
      if (fault === "source-conflict") {
        f.db.prepare("UPDATE intake_sessions SET record_json=json_set(record_json,'$.artifact.sha256',?) WHERE record_key=?").run("b".repeat(64), id(1));
      }
      if (fault === "duplicate-link") {
        const duplicate = { ...JSON.parse(f.prepJson) as object, intakeSessionId: id(3) };
        f.db.prepare("INSERT INTO intake_sessions VALUES(?,?,?,?,?,?,?)").run(id(3), "person-lookup", hash, "enqueued", JSON.stringify(duplicate), NOW, NOW);
      }
      const before = f.db.prepare("SELECT * FROM intake_sessions ORDER BY record_key").all();
      assert.throws(() => convert(f.db), /imported-artifact-linkage-invalid/u);
      assert.deepEqual(f.db.prepare("SELECT * FROM intake_sessions ORDER BY record_key").all(), before);
      assert.equal(f.db.prepare("SELECT name FROM sqlite_master WHERE name='imported_artifacts'").get(), undefined);
    } finally { f.db.close(); }
  });
  it("keeps nested writes and generation in the outer transaction and freezes submitted content", () => {
    const root = mkdtempSync(join(tmpdir(), "foundation-contract-"));
    const db = AuthorityDatabase.open({ path: join(root, "state.db"), busyTimeoutMs: 250, migrationOwner: "foundation-proof" });
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
      const raw = new DatabaseSync(join(root,"state.db"));
      try { assert.throws(() => raw.exec("INSERT OR REPLACE INTO imported_artifacts SELECT * FROM imported_artifacts"), /insert conflicts/u); } finally { raw.close(); }
      const frozen = canonicalJsonStringify(db.authority.intakeManifests.get(id(11)));
      const savedGeneration = db.getMeta().authorityGeneration;
      assert.equal(db.authority.intakeManifests.insert(manifest()).state, "existing");
      assert.equal(db.getMeta().authorityGeneration, savedGeneration);
      assert.throws(() => db.authority.intakeManifests.insert({ ...manifest(), createdAt: "2026-09-10T12:00:00.000Z" }), /different content/u);
      assert.throws(() => db.authority.intakeSessions.update({ ...session(), version: 3 }), /submission-immutable/u);
      assert.equal(canonicalJsonStringify(db.authority.intakeManifests.get(id(11))), frozen);
    } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
  });
});
