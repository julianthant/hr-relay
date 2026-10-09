import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ArchivedRunContentSchema, archivedRunContentDigest, archivedRunReferenceFingerprint } from "../../../../../src/models/archive/model.js";
import { canonicalJsonStringify } from "../../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../../src/rules/validation/sha256.js";
import { FingerprintSchema } from "../../../../../src/rules/identity/ids.js";
import { ARCHIVED_RUN } from "../../../../support/fixtures/archive-fixtures.js";

const bindings = [{ kind: "test-data-local", inputPath: "documentNumber",
  name: "separationsKualiFinalizationCanaryDocumentNumber", sourceId: "10000000-0000-4000-8000-000000000001" }] as const;
function content(documentNumber = "12345678", effectiveDate = "2026-09-01") {
  const { contentDigest: _digest, ...base } = ARCHIVED_RUN;
  return ArchivedRunContentSchema.parse({ ...base, workflowId: "separations",
    input: { ...base.input, raw: { documentNumber, effectiveDate },
      parsed: { ...base.input.parsed, value: { documentNumber, effectiveDate }, protectedBindings: bindings } } });
}

describe("protected archive identities", () => {
  it("binds ordinary retained input while excluding both protected raw and parsed bytes", () => {
    const original = content();
    const rotated = content("87654321");
    assert.equal(archivedRunContentDigest(original), archivedRunContentDigest(rotated));
    assert.notEqual(archivedRunContentDigest(original), archivedRunContentDigest(content("12345678", "2026-09-02")));
    assert.notEqual(archivedRunContentDigest(original), archivedRunContentDigest({ ...original,
      input: { ...original.input, parsed: { ...original.input.parsed,
        protectedBindings: [{ ...bindings[0], sourceId: "10000000-0000-4000-8000-000000000002" }] } } }));
  });
  it("authenticates retained archives and binds safe content without publishing historical raw digests", () => {
    const original = content();
    const record = (value: typeof original) => ({ ...value, contentDigest: FingerprintSchema.parse(archivedRunContentDigest(value)) });
    const fingerprint = archivedRunReferenceFingerprint(record(original));
    for (const changed of [content("12345678", "2026-09-02"),
      { ...original, row: { ...original.row, status: "failed" as const } },
      { ...original, evidence: { ...original.evidence, checkpointNodeIds: [] } }]) {
      assert.notEqual(archivedRunReferenceFingerprint(record(changed)), fingerprint);
      assert.throws(() => archivedRunReferenceFingerprint({ ...changed, contentDigest: record(original).contentDigest }), /archive.*integrity/u);
    }
    assert.equal(archivedRunReferenceFingerprint(record(content("87654321"))), fingerprint);
    const legacy = (value: typeof original) => ({ ...value,
      contentDigest: FingerprintSchema.parse(sha256Hex(`hrauto:archived-run:v1\0${canonicalJsonStringify(value)}`)) });
    assert.notEqual(legacy(original).contentDigest, legacy(content("87654321")).contentDigest);
    assert.equal(archivedRunReferenceFingerprint(legacy(original)), archivedRunReferenceFingerprint(legacy(content("87654321"))));
    assert.notEqual(archivedRunReferenceFingerprint(legacy(original)), legacy(original).contentDigest);
  });
  it("does not turn withheld historical diagnostic hashes into new archive fingerprints", () => {
    const first = content();
    const second = content("87654321");
    const oldDiagnostic = (value: typeof first, raw: string) => ({ ...value,
      row: { ...value.row, liveMessage: { state: "present" as const, value: sha256Hex(raw) } } });
    assert.equal(archivedRunContentDigest(oldDiagnostic(first, "12345678")),
      archivedRunContentDigest(oldDiagnostic(second, "87654321")));
  });
});
