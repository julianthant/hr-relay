import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { readHireDataTask } from "../../../../../src/backend/systems/crm/tasks/read-hire-data.js";
import { createDeterministicCrmOnboardingDriver } from "../../../../../src/backend/systems/crm/driver/fake.js";
import { CrmReadHireData, CrmHireDataSchema } from "../../../../../src/models/systems/crm/read-hire-data.js";
import { CrmReadOnboardingDates } from "../../../../../src/models/systems/crm/read-onboarding-dates.js";
import { CrmReadOnboardingRecord } from "../../../../../src/models/systems/crm/read-onboarding-record.js";
import { classifyEvidenceLeaf, evidenceLeaves, redactEvidenceLeaf } from "../../../../../src/models/trust/evidence-classification.js";
import { DataPointSchema, type DataPoint } from "../../../../../src/rules/workflow/task-provenance.js";
import { TaskRefusal } from "../../../../support/helpers/separation-task-fixtures.js";

const data = CrmReadHireData.example;
const driver = (hireData = data) => createDeterministicCrmOnboardingDriver({
  record: CrmReadOnboardingRecord.example, dates: CrmReadOnboardingDates.example, hireData,
});
const context = (records: DataPoint[]) => ({
  driver: driver(), signal: new AbortController().signal,
  captureScreenshot: async () => { throw new Error("Fixture read has no screenshot surface"); },
  log: { debug: () => undefined, info: () => undefined, warn: () => undefined },
  fail: (code: string, message: string): never => { throw new TaskRefusal(code, message); },
  recordData: (batch: DataPoint | readonly DataPoint[]) => {
    for (const point of Array.isArray(batch) ? batch : [batch]) records.push(DataPointSchema.parse(point));
  },
});

describe("CRM hire read task", () => {
  it("records the complete validated output and keeps every raw diagnostic leaf private", async () => {
    const records: DataPoint[] = [];
    const output = await readHireDataTask.impl.run({ input: { email: data.requestedEmail }, ctx: context(records) });
    assert.deepEqual(output, data);
    assert.deepEqual(Object.fromEntries(records.map(point => [point.field, point.value])), data);
    const scope = { kind: "task-output" as const, taskId: CrmReadHireData.id };
    const privateData = { ...data, fields: { ...data.fields, ssn: "123-45-6789" } };
    const leaves = evidenceLeaves(privateData);
    const redacted = leaves.map(leaf => {
      assert.equal(classifyEvidenceLeaf(scope, leaf.path).transform, "digest");
      return redactEvidenceLeaf(scope, leaf);
    });
    const encoded = JSON.stringify(redacted);
    for (const value of [privateData.requestedEmail, privateData.fields.ssn, privateData.fields.address]) assert.equal(encoded.includes(value), false);
  });

  it("refuses a different requested person without recording output", async () => {
    const records: DataPoint[] = [];
    await assert.rejects(readHireDataTask.impl.run({ input: { email: "other@example.test" }, ctx: context(records) }),
      error => error instanceof TaskRefusal && error.code === "ONBOARDING_CRM_READ_FAILED");
    assert.deepEqual(records, []);
  });

  it.each([
    { ...data, fields: { ...data.fields, firstName: "Other" } },
    { ...data, fields: { ...data.fields, email: "other@example.test" } },
    { ...data, recordUrl: "not a URL" },
    { ...data, recordUrl: "https://other.example.test/hr/ONB_ViewOnboarding?id=fixture-hire" },
    { ...data, recordUrl: "https://act-crm.my.site.com/hr/ONB_ViewOnboarding?id=other" },
  ])("rejects inconsistent displayed identity and source URLs", input => {
    assert.equal(CrmHireDataSchema.safeParse(input).success, false);
  });

  it("propagates an aborted read without replacing it with a business failure", async () => {
    const records: DataPoint[] = [];
    const abort = new AbortController();
    abort.abort();
    const failure = new Error("fixture aborted");
    const ctx = context(records);
    await assert.rejects(readHireDataTask.impl.run({ input: { email: data.requestedEmail }, ctx: {
      ...ctx, signal: abort.signal, driver: { ...ctx.driver, readHireData: async () => { throw failure; } },
    } }), error => error === failure);
    assert.deepEqual(records, []);
  });
});
