import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "vitest";
import {
  CURRENT_AUTHORITY_SCHEMA_VERSION,
  SQLITE_MIGRATIONS,
} from "../../../src/infra/sqlite/migrations.js";
import { DCC4_SUPERSEDED_V19_MIGRATION } from "../fixtures/dcc4-superseded-migration.js";

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
  { version: 21, sha256: "3f06f322f009e177afa8eeb1f48de6456a141da071fbf8ae8da33dab8168481d" },
  { version: 22, sha256: "70173d78676cdd88cec4e7f89fa2c364c955e7cd923d364ee6163950b3948f13" },
  { version: 23, sha256: "08565c854b7d809099a7e9d267466cec424c530ea7252469f43abebfe285419e" },
  { version: 24, sha256: "71dd383d16518b329ab1e5d64071646c43bf115619bec8093cc087e08fff511a" },
  { version: 25, sha256: "5566cba092c31714c90f00bd53f7750b06c8fd6604fe303eea88f1f77b47feaf" },
  { version: 26, sha256: "485ffaf7aa48240741edc2625d1f49df2691bf72047e97b95f9844174378f9da" },
  { version: 27, sha256: "080e5b70b41760035fd662fcf99210199ca604c51839df7750e82bd4ba63962f" },
  { version: 28, sha256: "e2bfa29e9f1672fa105aab5d4e6e36c874f831f5ee70a22805cee4fce12a7f30" },
  { version: 29, sha256: "81f79e75c4cff9a6b605b6c66d833f1f6886366e744c386d939bd2703085b086" },
  { version: 30, sha256: "3235ff67ad89abb16342be0e9b957a670785855c4f1c9edbdda376a2c52a8489" },
  { version: 31, sha256: "3ca8c5b9503c63ec93382a6b619a0a2ab917537377aa2b10dd5a03f7526ab81e" },
  { version: 32, sha256: "48ffb308b73d176799a1a48c40a172341c307f3267bad7bd71e45667974b34aa" },
  { version: 33, sha256: "1870130c84fa36da5417fb1eadb5ae785a04f632c9557a437c25990b3b1876b7" },
  { version: 34, sha256: "5bf68fd4da96c62c326bbaf739981085fa375f0f0da1feaa34eb41c7f6702e3d" },
  { version: 35, sha256: "79cb34a7cca24ada609849e5108646d107ed31f82b9b665dd6600f4a9e92f1f1" },
  { version: 36, sha256: "07bb5c43a608bb27fc961aa3ef8b477898af90dfcbc2384af6f009ec88b6f99d" },
  { version: 37, sha256: "a4dbb2f8c9511be6223234d3d75a8961e83a193d8accc270f05b4a02945df878" },
  { version: 38, sha256: "e4d84f51231d458c51fcc20524fe51e48b38a5ff42ae31b2557f7c7199fb0778" },
  { version: 39, sha256: "f15605b5eb310cb3633e6bef344bc1286da29fa676f35f3a92333210ef7a324b" },
  { version: 40, sha256: "b4672caf9fee1ebd8a624da4103e4be92c37db2d2e7c29dac3e6a9734e399da9" },
  { version: 41, sha256: "f0a3af4468464673a09aafd7d22ff4f25bf939a67f302d174f315e2d6133b886" },
  { version: 42, sha256: "3984fc2a414f410214e4af360064e6238e56d8b68e4963d6d22f996b4b3168cc" },
  { version: 43, sha256: "5cc49e5a8083cc49874af1923013716f0c96afae9da078174576e6e8b35384d4" },
  { version: 44, sha256: "ddb10ca4decf101959ffa200ec30b0b2dc626fd08b9aa4b9d5cfe8758e984512" },
  { version: 45, sha256: "2fdb9d16bab229dd5f91a69d0c7bc4a98d5fdad772dcc08bc1a3f129a7efb988" },
  { version: 46, sha256: "6d6110548381575a03fe19b5b4a492372691aa45a3bd21f8671cccb94b55eb80" },
  { version: 47, sha256: "6543066f191996475d3fac4d8262a202f496402d73429af13d499a9ba5eac0fa" },
  // Released L foundation bytes at 42df509; Q proof ownership amended by the operator.
  { version: 48, sha256: "c7ec15732fac549fce184f1cd8454203fd332e1f5b2e373d9182fba6060fcbeb" },
  { version: 49, sha256: "58fbd66e5e0cb76e244eb40fd4d7b1fb0aa8b32ef650ab0d6da07ab4d859864b" },
  { version: 50, sha256: "db802e79859911e0a118292baaf58c3ca835767f0f7e9d00e716e197d62da369" },
  { version: 51, sha256: "ca356d1afb71419b47620c6ce2e56dfc7fb1ea1e059133f018b1be11ca0e82d1" },
  { version: 52, sha256: "360f6b9bb5725cc9df6e48202cb2900dd9870270c332782d3377453445b81bb5" },
] as const);

const DCC1_SOURCE_SUFFIX_DIGESTS = Object.freeze([
  { version: 19, sha256: "f10c15c58161cf658eb6526c8b3994ef72b0d85473389114eebb4d54651429d5" },
  { version: 20, sha256: "29bbfab1ce3efdc17ac7f5943f6681b2af4604baaf0a5c91c42f7dee09d466fd" },
  { version: 21, sha256: "d2a0c8de6f97f1c737d85b3474df07b053357a12626b3c08659cf7369fa41ce6" },
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

  it("preserves the original DCC1 v19-v21 statement bytes as source-lineage evidence", () => {
    const integratedDcc1 = SQLITE_MIGRATIONS.filter(({ version }) => version >= 25 && version <= 27)
      .map((migration, index) => ({
        version: 19 + index,
        statements: migration.statements,
      }));
    assert.deepEqual(
      integratedDcc1.map((migration) => ({
        version: migration.version,
        sha256: migrationDigest(migration),
      })),
      DCC1_SOURCE_SUFFIX_DIGESTS,
    );
  });

  it("preserves the superseded DCC4 v19 statement bytes as source-lineage evidence", () => {
    assert.equal(
      migrationDigest(DCC4_SUPERSEDED_V19_MIGRATION),
      "bef14546c5a4bba520dca00f2bd0d950bc6f3824c5f953f54729d233b1701b8d",
    );
    assert.equal(
      SQLITE_MIGRATIONS.some(({ statements }) => statements.some((statement) => (
        statement.includes("explorer_edit_reviews") || statement.includes("explorer_edit_outbox")
      ))),
      false,
      "D290 preserves DCC4 history as lineage evidence without activating its dormant schema",
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
