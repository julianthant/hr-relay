import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "vitest";
import {
  CURRENT_AUTHORITY_SCHEMA_VERSION,
  SQLITE_MIGRATIONS,
} from "../../../src/infra/sqlite/migrations.js";

interface MigrationShape {
  readonly version: number;
  readonly statements: readonly string[];
}

/**
 * v1-v7 were derived from the known-correct history at 5ec912e; v8 was pinned
 * when its repair shipped, v9 with provider admission, and v10 with the D134
 * 2g trust/ledger foundation. Every newly released migration extends this
 * literal list. A historical hash is never recomputed to bless edited old
 * statements.
 */
const RELEASED_MIGRATION_DIGESTS = Object.freeze([
  { version: 1, sha256: "19df8bb638864aefb5ef95d16d746cb36a4f215601d60873bf4d1b5823ef49d8" },
  { version: 2, sha256: "405f1cde1a83ae0938fa113b827601e89ad840ae17048035fe251a18ae93bcff" },
  { version: 3, sha256: "790f2bbd12791949ca77d9a794da37bc7646f4a1972173d27ce145e55aa7829c" },
  { version: 4, sha256: "21467bf4ac80bef6fbb983cb6dee3c0bc97db49502b370851b9001cbeb48ed7e" },
  { version: 5, sha256: "0c943b0e2019da062e4d9b665ee5815f4210f5f4cc4ecc91154eb72df9c77104" },
  { version: 6, sha256: "cfad2a293f36ec666ce652a4fb424f92a30a3d678725955e0717bc62291f4006" },
  { version: 7, sha256: "80a877874f1a5ac939fed0ed3c4939b9d6fe53e889529f215e8baf4ffb4e141a" },
  { version: 8, sha256: "a07ef35f3c970822104220a1d7e8c4053f0e4ef7379a2be4976606fc3370b63d" },
  { version: 9, sha256: "92e27b25c7de354f12d0a381653d4d3b6ccf8fb707e084eb0c94730c977374f6" },
  { version: 10, sha256: "e0d4f3a758a4fb282b3ccb22f1793cf3010124bcaec7bdc6546e1c1265347ced" },
  { version: 11, sha256: "76f96d6aa4ac9e92682d4dd834d60bee0ae551e7a2f0e14b8cb6b560810e15d9" },
  { version: 12, sha256: "2d4cbe31faa32b148d9f9ac9faa68d7d43f78a3680e9415e095ec1ab0ae19132" },
  { version: 13, sha256: "f4114661557b997cdde798b786ebc91874914436f27db3baaff7a51a45eb1031" },
  { version: 14, sha256: "ed19446302152b031aa0362e3a266cada2e4a37a8fe5e63190c219d29c72f1c9" },
  { version: 15, sha256: "baa6b9953941a0a17af060d690dfd581630d3b596558437db89200d41a269662" },
  { version: 16, sha256: "282802cfeb23d7ede5b926df6f9417e678826ba71e052f171570a11637d2895e" },
  { version: 17, sha256: "a2b560b347adc9e151b599ab61e3a65a8afdaabd609a2844a365d2ce2e9ec89f" },
  { version: 18, sha256: "f1a471cef9b932c508095edbc102df94b851af722652c0a752d7382912464dfc" },
  { version: 19, sha256: "06ec41a35f5d6be47be67f19da26e504cf6788d892bc21d4d10d1d0768872c39" },
  { version: 20, sha256: "e3c09c940fb52c1193bb37c0d01644bbe3f15d4bbd84e89a18be4e200360cbe2" },
] as const);

/** Version, count, statement position, byte length, and bytes are all framed. */
function migrationDigest(migration: MigrationShape): string {
  const hash = createHash("sha256");
  hash.update("hrauto:sqlite-migration:v1\0");
  hash.update(String(migration.version));
  hash.update("\0");
  hash.update(String(migration.statements.length));
  hash.update("\0");
  for (const [index, statement] of migration.statements.entries()) {
    hash.update(String(index));
    hash.update(":");
    hash.update(String(Buffer.byteLength(statement, "utf8")));
    hash.update("\0");
    hash.update(statement, "utf8");
    hash.update("\0");
  }
  return hash.digest("hex");
}

describe("immutable SQLite migration history", () => {
  it("pins every released migration's metadata, order, and ordered statement bytes", () => {
    assert.equal(
      CURRENT_AUTHORITY_SCHEMA_VERSION,
      RELEASED_MIGRATION_DIGESTS.at(-1)?.version,
      "a new schema version must append its reviewed literal digest",
    );
    assert.deepEqual(
      SQLITE_MIGRATIONS.map((migration) => ({
        version: migration.version,
        sha256: migrationDigest(migration),
      })),
      RELEASED_MIGRATION_DIGESTS,
    );
  });

  it("changes its digest for metadata, statement edits, insertion, deletion, and reorder", () => {
    const fixture = {
      version: 41,
      statements: [
        "CREATE TABLE alpha (id INTEGER PRIMARY KEY)",
        "CREATE INDEX alpha_id_idx ON alpha(id)",
      ],
    } as const;
    const expected = migrationDigest(fixture);
    const adversarial: readonly MigrationShape[] = [
      { ...fixture, version: 42 },
      { ...fixture, statements: [fixture.statements[0], `${fixture.statements[1]} `] },
      { ...fixture, statements: [...fixture.statements, "SELECT 1"] },
      { ...fixture, statements: [fixture.statements[0]] },
      { ...fixture, statements: [fixture.statements[1], fixture.statements[0]] },
    ];
    for (const changed of adversarial) assert.notEqual(migrationDigest(changed), expected);
  });
});
