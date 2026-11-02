import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "vitest";
import { ArtifactRefSchema, NamedArtifactOutputSchema } from "../../../src/models/artifacts/artifacts.js";
import { deriveArtifactProjectionRows } from "../../../src/models/workflow/artifact-projection.js";
import { namedArtifactOutput } from "../../../src/workflow-kit/artifacts.js";
const artifact = ArtifactRefSchema.parse({ id: randomUUID(), sha256: "a".repeat(64), bytes: 12, mediaType: "application/zip" });
const specs = [{ id: "batch-archive", source: { nodeId: "archive", fieldPath: "archive" }, keyFields: ["archive.fileName"], sink: "documents-file", blocking: true }];

it.each(["../file.zip", "folder/file.zip", "folder\\file.zip", ".hidden", "CON.zip", "file.zip.", "file.zip ", "a:b.zip", "file\u0000.zip", "file\n.zip", "file\t.zip"])("refuses unsafe file output name %j", fileName => {
  assert.equal(NamedArtifactOutputSchema.safeParse({ artifact, fileName }).success, false);
});

it("derives a deterministic output for exactly its original run", () => {
  const runId = randomUUID(), outputValue = { archive: namedArtifactOutput(artifact, "Onboarding Docs batch.zip") };
  const row = deriveArtifactProjectionRows({ specs, nodeId: "archive", outputValue, runId });
  assert.equal(row[0]?.sinkId, `documents-file-${runId}`);
  assert.deepEqual(deriveArtifactProjectionRows({ specs, nodeId: "archive", outputValue, runId }), row);
  assert.notEqual(deriveArtifactProjectionRows({ specs, nodeId: "archive", outputValue, runId: randomUUID() })[0]?.sinkId, row[0]?.sinkId);
  assert.throws(() => deriveArtifactProjectionRows({ specs, nodeId: "archive", outputValue }));
});
