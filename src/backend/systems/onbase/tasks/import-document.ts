import { OnbaseCommitImport, OnbaseMatchImport, OnbasePrepareImport, OnbaseVerifyImport, validateOnbaseImportVerdict } from "../../../../models/systems/onbase/import-document.js";
import { defineTask } from "../../../../workflow-kit/task.js";
import { JsonValueSchema } from "../../../../rules/validation/canonical-json.js";
import { onbaseDriver } from "../driver-declaration.js";

export const prepareImportTask = defineTask(onbaseDriver, OnbasePrepareImport, {
  sessions: [{ system: "onbase", access: "transaction", session: "reuse-worker", exclusive: true }],
  async run({ input, ctx }) {
    const staged = await ctx.driver.prepareImport(input);
    if (staged.observedEid !== input.ucpathId || staged.pageSha256 !== input.pageSha256) return ctx.fail("ONBASE_IMPORT_UNPROVED", "The prepared import belongs to another subject or PDF page.");
    ctx.recordData(Object.entries(staged).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return staged;
  },
});
export const matchImportTask = defineTask(onbaseDriver, OnbaseMatchImport, {
  sessions: [{ system: "onbase", access: "read", session: "reuse-worker", exclusive: true }],
  async run({ input, ctx }) {
    const verdict = validateOnbaseImportVerdict(input, await ctx.driver.readSavedImport(input));
    ctx.recordData(Object.entries(verdict).map(([field, value]) => ({ direction: "read" as const, field, value: JsonValueSchema.parse(value) })));
    return verdict;
  },
});
export const verifyImportTask = defineTask(onbaseDriver, OnbaseVerifyImport, {
  sessions: [{ system: "onbase", access: "read", session: "reuse-worker", exclusive: true }],
  async run({ input, ctx }) {
    const verdict = validateOnbaseImportVerdict(input, await ctx.driver.readSavedImport(input));
    ctx.recordData(Object.entries(verdict).map(([field, value]) => ({ direction: "read" as const, field, value: JsonValueSchema.parse(value) })));
    return verdict;
  },
});
export const commitImportTask = defineTask(onbaseDriver, OnbaseCommitImport, {
  sessions: [{ system: "onbase", access: "transaction", session: "reuse-worker", exclusive: true }],
  async run({ input, ctx }) {
    const action = await ctx.driver.commitImport(input, ctx.mutation);
    if (action.effect !== "external-commit") return ctx.fail("ONBASE_IMPORT_UNPROVED", "OnBase did not record the fenced Import action.");
    const verdict = validateOnbaseImportVerdict(input, await ctx.driver.readSavedImport(input));
    if (verdict.state !== "present") return ctx.fail("ONBASE_IMPORT_UNPROVED", "The imported PDF is unproved; preserve this write for reconciliation.");
    ctx.recordData([{ direction: "write", field: "savedDocument", value: verdict.proof }]);
    return { savedDocument: verdict.proof };
  },
});
