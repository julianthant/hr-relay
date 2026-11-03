import assert from "node:assert/strict";
import { it } from "vitest";
import { createDeterministicCrmOnboardingDriver } from "../../../../../src/backend/systems/crm/driver/fake.js";
import { CrmDocumentSubjectSchema, CrmIdocsBytesSchema } from "../../../../../src/models/systems/crm/documents.js";
import { CrmReadOnboardingRecord } from "../../../../../src/models/systems/crm/read-onboarding-record.js";
import { CrmReadOnboardingDates } from "../../../../../src/models/systems/crm/read-onboarding-dates.js";

const documents = [1, 2].map(index => CrmIdocsBytesSchema.parse({
  identity: { recordId: `fixture-${String(index)}`, eid: `1000000${String(index)}`, workEmail: `fixture${String(index)}@example.test`, personalEmail: null },
  totalDocuments: 1, documents: [{ index: 0, fileName: "Signed Offer Letter.pdf", bytes: new TextEncoder().encode(`%PDF-1.7 person ${String(index)}`) }],
}));
const driver = () => createDeterministicCrmOnboardingDriver({ record: CrmReadOnboardingRecord.example, dates: CrmReadOnboardingDates.example, documents });

it("keeps distinct people and document bytes in a deterministic batch", async () => {
  const fake = driver();
  for (const value of documents) {
    const subject = { kind: "eid", value: value.identity.eid };
    assert.ok(subject.value);
    const identity = await fake.findDocumentRecord({ kind: "eid", value: subject.value });
    assert.deepEqual(identity, value.identity);
    assert.deepEqual(await fake.readIdocs({ recordId: identity.recordId, subject: { kind: "eid", value: subject.value } }), value);
  }
  assert.equal((await fake.findDocumentRecord({ kind: "email", value: "FIXTURE2@example.test" })).recordId, "fixture-2");
});

it("refuses missing, ambiguous or mismatched fixture identities and absent document selections", async () => {
  const fake = driver(), first = documents[0]; assert.ok(first);
  await assert.rejects(fake.findDocumentRecord({ kind: "email", value: "missing@example.test" }));
  const one = CrmDocumentSubjectSchema.parse({ kind: "eid", value: "10000001" }), two = CrmDocumentSubjectSchema.parse({ kind: "eid", value: "10000002" });
  await assert.rejects(fake.readIdocs({ recordId: "fixture-1", subject: two }));
  await assert.rejects(fake.readIdocs({ recordId: "fixture-1", subject: one, docIndices: [1] }));
  const duplicate = createDeterministicCrmOnboardingDriver({ record: CrmReadOnboardingRecord.example, dates: CrmReadOnboardingDates.example, documents: [first, first] });
  await assert.rejects(duplicate.findDocumentRecord(one));
  const empty = createDeterministicCrmOnboardingDriver({ record: CrmReadOnboardingRecord.example, dates: CrmReadOnboardingDates.example });
  await assert.rejects(empty.findDocumentRecord(one));
});
