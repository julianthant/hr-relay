import assert from "node:assert/strict";
import { it, vi } from "vitest";
import { ArtifactRefSchema } from "../../../../src/models/artifacts/artifacts.js";
import { artifactReferencesIn, deletionArtifactReferenceMatcher } from "../../../../src/backend/storage/sqlite/artifact-references.js";

const ref = (digit: string) => ArtifactRefSchema.parse({ id: `${digit.repeat(8)}-0000-4000-8000-000000000000`, sha256: digit.repeat(64), bytes: 1, mediaType: "application/pdf" });

it("matches every candidate a value names by id, digest field or nested preparation in one walk", () => {
  const byId = ref("1"), bySha = ref("2"), byDigest = ref("3"), bySource = ref("4"), nested = ref("5"), absent = ref("6");
  const matches = deletionArtifactReferenceMatcher([byId, bySha, byDigest, bySource, nested, absent]);
  const value = { rows: [{ artifactId: byId.id }, { file: { sha256: bySha.sha256 } }], digest: byDigest.sha256, sourceSha256: bySource.sha256,
    preparationJson: JSON.stringify({ deep: [{ sha256: nested.sha256 }] }), artifactId: 7, sha256: null };
  assert.deepEqual([...matches(value)].sort(), [byId, bySha, byDigest, bySource, nested].map(candidate => candidate.sha256).sort());
  assert.equal(matches({ artifactId: "unknown", other: absent.id, sha256: "f".repeat(64) }).size, 0);
});

const attachment = (digit: string) => ({ kind: "network-summary", artifactId: `${digit.repeat(8)}-0000-4000-8000-000000000000`, mediaType: "application/json",
  byteLength: 2, digest: digit.repeat(64), sensitivity: "redacted" });

it("finds the references the schema walk finds: full refs, attachments, nested preparations, and nothing under an own __proto__ key", () => {
  const direct = ref("1"), inArray = ref("2"), nested = ref("3"), hidden = ref("4"), nullPrototype = ref("5");
  const holder: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  holder.file = nullPrototype;
  const value = JSON.parse(JSON.stringify({ direct, rows: [{ file: inArray }, attachment("6")], preparationJson: JSON.stringify({ deep: nested }),
    extraKey: { ...ref("7"), note: "strict schemas refuse extra keys" }, wrongType: { sha256: 7, digest: null } })) as Record<string, unknown>;
  Object.defineProperty(value, "__proto__", { value: { file: hidden }, enumerable: true, configurable: true, writable: true });
  value.holder = holder;
  assert.deepEqual(artifactReferencesIn(value).map(found => found.sha256).sort(),
    [direct, inArray, nested, nullPrototype].map(found => found.sha256).concat("6".repeat(64)).sort());
  assert.throws(() => artifactReferencesIn({ file: direct, at: new Date(0) }));
  assert.throws(() => artifactReferencesIn([direct, { ...direct, bytes: 2 }]), /artifact-reference-identity-mismatch/u);
});

it("tries the reference schemas only on nodes that carry a string sha256 or digest", () => {
  const full = vi.spyOn(ArtifactRefSchema, "safeParse");
  try {
    artifactReferencesIn({ rows: [{ a: 1 }, { b: { c: [{ d: 2 }] } }], file: ref("1"), digestless: { artifactId: "x" } });
    assert.equal(full.mock.calls.length, 1);
  } finally { full.mockRestore(); }
});
