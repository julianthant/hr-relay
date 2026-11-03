import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import JSZip from "jszip";
import { it } from "vitest";
import { ArtifactRefSchema, type ArtifactRef } from "../../../../src/models/artifacts/artifacts.js";
import type { ContentAddressedArtifactWriter } from "../../../../src/workflow-kit/artifacts.js";
import { CrmWorksheetPersonSchema, type CrmWorksheetPerson } from "../../../../src/models/workflows/crm-doc-download/documents.js";
import { packageCrmWorksheetArchives, readCrmWorksheetArchivesTask } from "../../../../src/workflows/crm-doc-download/tasks/read-worksheet-archives.js";
import { ReadCrmWorksheetArchives } from "../../../../src/models/workflows/crm-doc-download/read-worksheet-archives.js";
import { classifyEvidenceLeaf, evidenceLeaves } from "../../../../src/models/trust/evidence-classification.js";
import { redactValue } from "../../../../src/rules/redaction/redaction.js";
import { DataPointSchema, type DataPoint } from "../../../../src/rules/workflow/task-provenance.js";
import { TaskRefusal } from "../../../support/helpers/separation-task-fixtures.js";

async function fixture() {
  const stored = new Map<string, { ref: ArtifactRef; bytes: Buffer }>();
  const artifacts: ContentAddressedArtifactWriter = {
    async put(source, metadata) {
      assert.ok(source instanceof Uint8Array);
      const bytes = Buffer.from(source), sha256 = createHash("sha256").update(bytes).digest("hex");
      const old = stored.get(sha256);
      if (old !== undefined) return old.ref;
      const ref = ArtifactRefSchema.parse({ id: randomUUID(), sha256, bytes: bytes.byteLength, mediaType: metadata.mediaType });
      stored.set(sha256, { ref, bytes }); return ref;
    },
    async open(ref) { const value = stored.get(ref.sha256); assert.ok(value); return Readable.from([value.bytes]); },
  };
  const people: CrmWorksheetPerson[] = [];
  for (const [index, worksheetName, firstName] of [[1, "July 6", "One"], [2, "August 2", "Two"]] as const) {
    const artifact = await artifacts.put(Buffer.from(`%PDF-1.7 fixture ${index}`), { mediaType: "application/pdf" });
    people.push(CrmWorksheetPersonSchema.parse({ identity: { recordId: `record-${index}`, eid: `1000000${index}`, workEmail: `person${index}@example.test`, personalEmail: null },
      reference: { worksheetId: `sheet-${index}`, worksheetName, rowId: `row-${index}`,
        names: { legalName: { firstName, lastName: "Fixture", middleName: "" }, livedName: null } },
      documents: [{ index: 0, fileName: "Signed Offer Letter.pdf", artifact }] }));
  }
  const records: DataPoint[] = [], controller = new AbortController();
  const ctx = { artifacts, signal: controller.signal, log: { debug() {}, info() {}, warn() {} },
    fail(this: void, code: string, message: string): never { throw new TaskRefusal(code, message); },
    recordData(this: void, points: DataPoint | readonly DataPoint[]) { for (const point of Array.isArray(points) ? points : [points]) records.push(DataPointSchema.parse(point)); },
  };
  return { artifacts, people, stored, controller, records, ctx };
}

it("packages only each worksheet's people at both approved archive destinations with reproducible bytes", async () => {
  const f = await fixture(), outputs = await packageCrmWorksheetArchives(f.artifacts, f.people, f.controller.signal);
  assert.deepEqual(outputs.map(output => output.relativePath), ["July 6/July 6.zip", "August 2/August 2.zip"]);
  for (const [index, output] of outputs.entries()) {
    const person = f.people[index]; assert.ok(person);
    const bytes = f.stored.get(output.artifact.sha256)?.bytes; assert.ok(bytes);
    const zip = await JSZip.loadAsync(bytes), expected = `Fixture, ${person.reference.names.legalName.firstName} EID/Signed Offer Letter.pdf`;
    assert.deepEqual(Object.keys(zip.files), [expected]);
    assert.equal(await zip.file(expected)?.async("string"), `%PDF-1.7 fixture ${String(index + 1)}`);
    assert.deepEqual(output.people.map(value => value.rowId), [person.reference.rowId]);
  }
  const replay = await packageCrmWorksheetArchives(f.artifacts, f.people, f.controller.signal);
  assert.deepEqual(replay.map(output => output.artifact.sha256), outputs.map(output => output.artifact.sha256));
});

it("refuses duplicate rows, colliding person folders and worksheet destinations before producing archives", async () => {
  const f = await fixture(), one = f.people[0], two = f.people[1]; assert.ok(one); assert.ok(two);
  for (const invalid of [[], [one, one],
    [one, { ...one, reference: { ...one.reference, rowId: "different-row" } }],
    [{ ...one, reference: { ...one.reference, worksheetName: "x".repeat(199) } }],
    [one, { ...two, reference: { ...two.reference, worksheetName: one.reference.worksheetName } }]]) {
    await assert.rejects(packageCrmWorksheetArchives(f.artifacts, invalid, f.controller.signal));
    assert.equal([...f.stored.values()].filter(file => file.ref.mediaType === "application/zip").length, 0);
  }
});

it("refuses changed retained PDF bytes without producing an archive", async () => {
  const f = await fixture(), first = f.people[0]?.documents[0]; assert.ok(first);
  const value = f.stored.get(first.artifact.sha256); assert.ok(value); value.bytes = Buffer.from("%PDF-tampered");
  await assert.rejects(packageCrmWorksheetArchives(f.artifacts, f.people, f.controller.signal), /bytes changed/u);
  assert.equal([...f.stored.values()].filter(file => file.ref.mediaType === "application/zip").length, 0);
});

it("retains one exact collection and records every archive fact without provider disclosure of people or paths", async () => {
  const f = await fixture(), output = await readCrmWorksheetArchivesTask.impl.run({ input: { people: f.people }, ctx: f.ctx });
  assert.deepEqual([output.worksheetCount, output.personCount, output.documentCount], [2, 2, 2]);
  assert.deepEqual(output.collection.files.map(file => file.relativePath), ["July 6/July 6.zip", "August 2/August 2.zip"]);
  const manifest = f.stored.get(output.collection.artifact.sha256); assert.ok(manifest);
  assert.deepEqual(JSON.parse(manifest.bytes.toString()), { files: output.collection.files });
  const leaves = evidenceLeaves(output);
  assert.deepEqual(f.records.map(point => point.field), leaves.map(leaf => leaf.path));
  const scope = { kind: "task-output", taskId: ReadCrmWorksheetArchives.id } as const;
  const redacted = leaves.map(leaf => {
    const declared = classifyEvidenceLeaf(scope, leaf.path);
    return redactValue(declared.classification, declared.transform, leaf.value);
  });
  assert.doesNotMatch(JSON.stringify(redacted), /Fixture|example\.test|July 6|row-1/u);
  assert.equal(ReadCrmWorksheetArchives.output.safeParse({ ...output, personCount: 1 }).success, false);
  assert.equal(ReadCrmWorksheetArchives.output.safeParse({ ...output, collection: { ...output.collection, files: output.collection.files.toReversed() } }).success, false);
});

it("keeps cancellation and packaging failures from recording or retaining a collection", async () => {
  const cancelled = await fixture(), reason = new Error("fixture cancelled"); cancelled.controller.abort(reason);
  await assert.rejects(readCrmWorksheetArchivesTask.impl.run({ input: { people: cancelled.people }, ctx: cancelled.ctx }), error => error === reason);
  const invalid = await fixture();
  await assert.rejects(readCrmWorksheetArchivesTask.impl.run({ input: { people: [invalid.people[0], invalid.people[0]].filter(person => person !== undefined) }, ctx: invalid.ctx }),
    error => error instanceof TaskRefusal && error.code === "CRM_DOCUMENT_PACKAGE_FAILED");
  for (const f of [cancelled, invalid]) {
    assert.deepEqual(f.records, []);
    assert.equal([...f.stored.values()].filter(file => file.ref.mediaType !== "application/pdf").length, 0);
  }
});
