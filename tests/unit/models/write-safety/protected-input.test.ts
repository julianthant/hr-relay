import { SeparationWritePlanSchema } from "../../../../src/rules/separations/write-plan.js";
import { RunInputStorageSchema } from "../../../../src/models/run/record.js";
import { SchemaBoundCanonicalValueSchema } from "../../../../src/models/validation/schema-bound-value.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ProtectedInputBindingSchema, hasProtectedTransactionInput, protectedInputBindings,
  retainedRunProtectedBindings, valueFreeProtectedInput, valueFreeProtectedData } from "../../../../src/models/write-safety/protected-input.js";

const timekeeper = ProtectedInputBindingSchema.parse({kind:"protected-store",inputPath:"timekeeperName",name:"timekeeperName",valueId:"10000000-0000-4000-8000-000000000001"});
const document = ProtectedInputBindingSchema.parse({kind:"test-data-local",inputPath:"documentNumber",name:"separationsKualiFinalizationCanaryDocumentNumber",sourceId:"10000000-0000-4000-8000-000000000002"});
const marker = {kind:"legacy-protected-input",inputPath:"timekeeperName",name:"timekeeperName"};

describe("current private protected origins and public projections", () => {
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
  it("requires persisted input classification while ordinary output metadata remains optional",()=>{
    const value={schemaHash:"a".repeat(64),value:{eid:"Synthetic public identifier"}};
    assert.equal(SchemaBoundCanonicalValueSchema.safeParse(value).success,true);
    const input={raw:value.value,parsed:value,ingressSchemaHash:"b".repeat(64)};
    assert.equal(RunInputStorageSchema.safeParse(input).success,false);
    assert.equal(RunInputStorageSchema.safeParse({...input,parsed:{...value,protectedBindings:[]}}).success,true);
    assert.equal(RunInputStorageSchema.safeParse({...input,parsed:{...value,protectedBindings:[marker]}}).success,false);
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
});
