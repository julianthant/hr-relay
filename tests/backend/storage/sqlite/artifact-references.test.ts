import assert from "node:assert/strict";
import { it } from "vitest";
import { ArtifactRefSchema } from "../../../../src/models/artifacts/artifacts.js";
import { deletionArtifactReferenceMatcher } from "../../../../src/backend/storage/sqlite/artifact-references.js";

const ref = (digit: string) => ArtifactRefSchema.parse({ id: `${digit.repeat(8)}-0000-4000-8000-000000000000`, sha256: digit.repeat(64), bytes: 1, mediaType: "application/pdf" });

it("matches every candidate a value names by id, digest field or nested preparation in one walk", () => {
  const byId = ref("1"), bySha = ref("2"), byDigest = ref("3"), bySource = ref("4"), nested = ref("5"), absent = ref("6");
  const matches = deletionArtifactReferenceMatcher([byId, bySha, byDigest, bySource, nested, absent]);
  const value = { rows: [{ artifactId: byId.id }, { file: { sha256: bySha.sha256 } }], digest: byDigest.sha256, sourceSha256: bySource.sha256,
    preparationJson: JSON.stringify({ deep: [{ sha256: nested.sha256 }] }), artifactId: 7, sha256: null };
  assert.deepEqual([...matches(value)].sort(), [byId, bySha, byDigest, bySource, nested].map(candidate => candidate.sha256).sort());
  assert.equal(matches({ artifactId: "unknown", other: absent.id, sha256: "f".repeat(64) }).size, 0);
});
