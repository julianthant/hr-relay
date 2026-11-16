import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "vitest";
import { ARTIFACT_COLLECTION_MEDIA_TYPE, ArtifactCollectionFilesSchema, ArtifactRefSchema, NamedArtifactOutputSchema } from "../../../src/models/artifacts/artifacts.js";
import { deriveArtifactProjectionRows } from "../../../src/models/workflow/artifact-projection.js";
import { collectionArtifactOutput, namedArtifactOutput } from "../../../src/workflow-kit/artifacts.js";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { classifyEvidenceLeaf, evidenceLeaves } from "../../../src/models/trust/evidence-classification.js";
import { redactValue } from "../../../src/rules/redaction/redaction.js";
import { namedFileOutputContract } from "../../support/fixtures/named-file-output-workflow.js";
const artifact = ArtifactRefSchema.parse({ id: randomUUID(), sha256: "a".repeat(64), bytes: 12, mediaType: "application/zip" });
const specs = [{ id: "batch-archive", source: { nodeId: "archive", fieldPath: "archive" }, keyFields: ["archive.fileName"], sink: "documents-file", blocking: true }];

it.each(["../file.zip", "folder/file.zip", "folder\\file.zip", ".hidden", "CON.zip", "file.zip.", "file.zip ", "a:b.zip", "file\u0000.zip", "file\n.zip", "file\t.zip"])("refuses unsafe file output name %j", fileName => {
  assert.equal(NamedArtifactOutputSchema.safeParse({ artifact, fileName }).success, false);
});

it.each(["../file.zip", "/file.zip", "folder/../file.zip", "folder//file.zip", "folder/", "folder\\file.zip", "C:/file.zip", "folder/CON.zip", "folder/file.zip.", "folder/file\u0000.zip"])("refuses unsafe collection path %j", relativePath => {
  assert.equal(ArtifactCollectionFilesSchema.safeParse([{ relativePath, artifact }]).success, false);
});

it.each([["July/a.zip", "July/a.zip"], ["July/A.zip", "july/a.zip"], ["July", "July/a.zip"], ["July/a.zip", "july/b.zip"], ["Caf\u00e9/a.zip", "Cafe\u0301/b.zip"]])("refuses conflicting collection destinations %j", (...paths) => {
  assert.equal(ArtifactCollectionFilesSchema.safeParse(paths.map(relativePath => ({ relativePath, artifact }))).success, false);
});

it("retains the exact ordered collection manifest and derives one run-bound projection", async () => {
  const files = [{ relativePath: "July 6/July 6.zip", artifact }, { relativePath: "August 2/August 2.zip", artifact }];
  let captured: Uint8Array | undefined;
  const manifestRef = { ...artifact, mediaType: ARTIFACT_COLLECTION_MEDIA_TYPE };
  const output = await collectionArtifactOutput({ async put(bytes, metadata) {
    assert.ok(bytes instanceof Uint8Array); captured = bytes;
    assert.equal(metadata.mediaType, ARTIFACT_COLLECTION_MEDIA_TYPE); return manifestRef;
  }, async open() { throw new Error("manifest creation must not read artifacts"); } }, files);
  assert.deepEqual(output, { files, artifact: manifestRef });
  assert.equal(new TextDecoder().decode(captured), canonicalJsonStringify({ files }));
  const runId = randomUUID();
  const rows = deriveArtifactProjectionRows({ specs: [{ ...specs[0], keyFields: ["archive.artifact.sha256"] }], nodeId: "archive", outputValue: { archive: output }, runId });
  assert.equal(rows.length, 1); assert.equal(rows[0]?.sinkId, `documents-file-${runId}`); assert.deepEqual(rows[0]?.value, output);
});

it("derives a deterministic output for exactly its original run", () => {
  const runId = randomUUID(), outputValue = { archive: namedArtifactOutput(artifact, "Onboarding Docs batch.zip") };
  const row = deriveArtifactProjectionRows({ specs, nodeId: "archive", outputValue, runId });
  assert.equal(row[0]?.sinkId, `documents-file-${runId}`);
  assert.deepEqual(deriveArtifactProjectionRows({ specs, nodeId: "archive", outputValue, runId }), row);
  assert.notEqual(deriveArtifactProjectionRows({ specs, nodeId: "archive", outputValue, runId: randomUUID() })[0]?.sinkId, row[0]?.sinkId);
  assert.throws(() => deriveArtifactProjectionRows({ specs, nodeId: "archive", outputValue }));
});

it("classifies every recorded collection leaf and withholds its private destination population", () => {
  const archive = NamedArtifactOutputSchema.parse({ files: [{ relativePath: "Private worksheet/Private archive.zip", artifact }],
    artifact: { ...artifact, mediaType: ARTIFACT_COLLECTION_MEDIA_TYPE } });
  const scope = { kind: "task-output", taskId: namedFileOutputContract.id } as const;
  for (const leaf of evidenceLeaves({ archive })) {
    const declared = classifyEvidenceLeaf(scope, leaf.path);
    if (leaf.path === "archive.files") {
      assert.equal(declared.classification, "direct-identifier"); assert.equal(declared.transform, "drop");
      assert.equal(JSON.stringify(redactValue(declared.classification, declared.transform, leaf.value)).includes("Private"), false);
    }
  }
});
