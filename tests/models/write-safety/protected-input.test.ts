import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { SchemaBoundCanonicalValueSchema, SchemaBoundEvidenceValueSchema } from "../../../src/models/validation/schema-bound-value.js";
import { RunInputStorageSchema } from "../../../src/models/run/record.js";
import {
ProtectedInputBindingSchema,hasProtectedTransactionInput,protectedInputBindings,
retainedRunProtectedBindings,
valueFreeProtectedData,
valueFreeProtectedInput
} from "../../../src/models/write-safety/protected-input.js";
import { deriveCanonicalInputDigest } from "../../../src/models/run/start-plan.js";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { SeparationWritePlanSchema } from "../../../src/rules/separations/write-plan.js";

const timekeeper = ProtectedInputBindingSchema.parse({kind:"protected-store",inputPath:"timekeeperName",name:"timekeeperName",valueId:"10000000-0000-4000-8000-000000000001"});
const document = ProtectedInputBindingSchema.parse({kind:"test-data-local",inputPath:"documentNumber",name:"separationsKualiFinalizationCanaryDocumentNumber",sourceId:"10000000-0000-4000-8000-000000000002"});
const marker = {kind:"legacy-protected-input",inputPath:"timekeeperName",name:"timekeeperName"};

describe("current private protected origins and public projections", () => {
  it("keeps durable proof envelopes separate from admitted run-input profile provenance", () => {
    const profile = { kind: "profile", inputPath: "timekeeperName", name: "timekeeperName",
      profileId: "10000000-0000-4000-8000-000000000003", sessionEpoch: 1 };
    const value = { schemaHash: "a".repeat(64), value: { state: "observed" } };
    assert.equal(SchemaBoundCanonicalValueSchema.safeParse({ ...value, protectedBindings: [profile] }).success, true);
    assert.equal(SchemaBoundEvidenceValueSchema.safeParse({ ...value, protectedBindings: [profile] }).success, false);
    assert.deepEqual(SchemaBoundEvidenceValueSchema.parse({ ...value, protectedBindings: [timekeeper, document] }),
      { ...value, protectedBindings: [timekeeper, document] });
    assert.equal(SchemaBoundEvidenceValueSchema.safeParse({ ...value, protectedBindings: [timekeeper, timekeeper] }).success, false);
    assert.equal(SchemaBoundEvidenceValueSchema.safeParse({ ...value, protectedBindings: [{ ...document, inputPath: "emplId" }] }).success, false);
    assert.equal(SchemaBoundEvidenceValueSchema.safeParse({ ...value, protectedBindings: [timekeeper, document, document, document] }).success, false);
  });
  it("requires genuine private origin identities and refuses public markers as execution bindings", () => {
    assert.equal(ProtectedInputBindingSchema.safeParse(marker).success,false);
    const executionOrigin=SeparationWritePlanSchema.options[1].shape.document.shape.timekeeperName;
    assert.equal(executionOrigin.safeParse("Synthetic raw signer").success,false);
    assert.equal(executionOrigin.safeParse(marker).success,false);
    assert.deepEqual(executionOrigin.parse(timekeeper),timekeeper);
    assert.equal(ProtectedInputBindingSchema.safeParse({...timekeeper,valueId:undefined}).success,false);
    assert.equal(ProtectedInputBindingSchema.safeParse({...document,sourceId:undefined}).success,false);
    assert.deepEqual(protectedInputBindings({timekeeperName:"Private signer"},[timekeeper]),[timekeeper]);
    assert.throws(()=>protectedInputBindings({timekeeperName:"Private signer"}),/binding is absent/u);
    assert.throws(()=>protectedInputBindings({timekeeperName:"Private signer"},[]),/binding is absent/u);
    assert.deepEqual(protectedInputBindings({ordinaryOutput:"Current fact"}),[]);
  });
  it("refuses partial signer metadata despite another genuine protected binding", () => {
    const value = { documentNumber: "Synthetic document", timekeeperName: "Synthetic signer" };
    assert.throws(() => protectedInputBindings(value, [document]), /timekeeperName binding is absent/u);
    assert.throws(() => valueFreeProtectedInput(value, [document]), /timekeeperName binding is absent/u);
    assert.throws(() => retainedRunProtectedBindings({ envelope: { workflow: "separations" }, input: {
      parsed: { value, protectedBindings: [document] } } }), /timekeeperName binding is absent/u);
    const input = { raw: { documentNumber: value.documentNumber }, ingressSchemaHash: "b".repeat(64),
      parsed: { schemaHash: "a".repeat(64), value, protectedBindings: [document] } };
    assert.throws(() => RunInputStorageSchema.parse(input), /timekeeperName binding is absent/u);
    assert.deepEqual(RunInputStorageSchema.parse({ ...input, parsed: { ...input.parsed,
      protectedBindings: [document, timekeeper] } }).parsed.protectedBindings, [document, timekeeper]);
    assert.deepEqual(valueFreeProtectedInput(value, [document, timekeeper]), { documentNumber: document, timekeeperName: timekeeper });
  });
  it("classifies live transactions only from explicit admitted strict bindings", () => {
    const absent:Parameters<typeof retainedRunProtectedBindings>[0]={envelope:{workflow:"person-lookup"},input:{parsed:{value:{emplId:"Private identifier"}}}};
    assert.throws(()=>hasProtectedTransactionInput(absent),/bindings are absent/u);
    assert.throws(()=>retainedRunProtectedBindings(absent),/bindings are absent/u);
    assert.equal(hasProtectedTransactionInput({...absent,input:{parsed:{protectedBindings:[]}}}),false);
    assert.equal(hasProtectedTransactionInput({...absent,input:{parsed:{protectedBindings:[document]}}}),true);
    assert.deepEqual(retainedRunProtectedBindings({...absent,input:{parsed:{value:{documentNumber:"Private identifier"},protectedBindings:[document]}}}),[document]);
  });
  it("preserves byte-exact public withheld markers without admitting them as private origins", () => {
    assert.deepEqual(valueFreeProtectedData({timekeeperName:"Private signer"}),{timekeeperName:marker});
    assert.deepEqual(valueFreeProtectedData({timekeeperName:marker}),{timekeeperName:marker});
    const admittedProjection = { timekeeperName: timekeeper };
    assert.deepEqual(valueFreeProtectedData(admittedProjection), admittedProjection);
    assert.deepEqual(valueFreeProtectedData(valueFreeProtectedData(admittedProjection)), admittedProjection);
    assert.deepEqual(valueFreeProtectedData(valueFreeProtectedData({timekeeperName:marker})), {timekeeperName:marker});
    assert.deepEqual(valueFreeProtectedData({timekeeper:{name:"Private signer",comments:"Private note"}}),{timekeeper:{name:marker,comments:{state:"withheld-protected-input"}}});
    assert.deepEqual(valueFreeProtectedData({ordinaryOutput:"Current fact"}),{ordinaryOutput:"Current fact"});
  });
  it("projects nested arrays with exact protected markers and canonical bytes", () => {
    const input = { batches: [[{ protectedBindings: [timekeeper, document], rows: [[{
      timekeeperName: "Synthetic signer", documentNumber: "Synthetic document", timekeeperComments: "Checked Synthetic signer",
      idempotencyKeyDigest: "private digest", ordinary: [null, false, 17, "Current fact"],
    }]] }]], retained: [{ timekeeperName: marker }] };
    const before = structuredClone(input);
    const expected = { batches: [[{ protectedBindings: [timekeeper, document], rows: [[{
      timekeeperName: timekeeper, documentNumber: document, timekeeperComments: "Checked <protected timekeeperName>",
      idempotencyKeyDigest: "withheld-protected-input", ordinary: [null, false, 17, "Current fact"],
    }]] }]], retained: [{ timekeeperName: marker }] };
    const projected = valueFreeProtectedData(input);
    assert.deepEqual(projected, expected);
    assert.equal(canonicalJsonStringify(projected), canonicalJsonStringify(expected));
    assert.deepEqual(valueFreeProtectedData(projected), expected);
    assert.deepEqual(input, before);
  });
  it("refuses malformed JSON and protected bindings within nested arrays", () => {
    for (const invalid of [undefined, NaN, Infinity, 1n, () => "invalid"])
      assert.throws(() => valueFreeProtectedData({ batches: [[{ values: [invalid] }]] }));
    assert.throws(() => valueFreeProtectedData({ batches: [[{ protectedBindings: [{ ...document, inputPath: "emplId" }],
      values: [{ documentNumber: "Synthetic document" }] }]] }));
  });

  it("keeps stored Timekeeper initials out of value-free projections, so stored input digests stay stable", () => {
    const profile = ProtectedInputBindingSchema.parse({ kind: "profile", inputPath: "timekeeperName", name: "timekeeperName",
      profileId: "10000000-0000-4000-8000-000000000003", sessionEpoch: 1 });
    const without = { documentNumber: "4444", timekeeperName: "Lex Rivers" };
    const withInitials = { ...without, timekeeperInitials: "QZ" };
    const input = valueFreeProtectedInput(withInitials, [profile]);
    const data = valueFreeProtectedData({ ...withInitials, protectedBindings: [profile] });
    for (const projection of [input, data]) {
      assert.equal(JSON.stringify(projection).includes("QZ"), false);
      assert.equal(JSON.stringify(projection).includes("Lex Rivers"), false);
      assert.equal(JSON.stringify(projection).includes("timekeeperInitials"), false);
    }
    assert.deepEqual(input, valueFreeProtectedInput(without, [profile]));
    assert.equal(deriveCanonicalInputDigest(withInitials, [profile]), deriveCanonicalInputDigest(without, [profile]));
  });
  it("redacts the initials sign-off of a timekeeper comment", () => {
    const projected = valueFreeProtectedData({ timekeeperName: "Lex Rivers", timekeeperInitials: "QZ",
      timekeeperComments: "Termination filed on UCPath as T002209631. Re Kuali Form #4510. -QZ 06/11/2026" });
    assert.equal(JSON.stringify(projected).includes("QZ"), false);
    assert.deepEqual(projected, { timekeeperName: marker, timekeeperComments:
      "Termination filed on UCPath as T002209631. Re Kuali Form #4510. -<protected timekeeperName> 06/11/2026" });
  });
});
