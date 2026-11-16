import { defineTask } from "../../../../workflow-kit/task.js";
import { CrmSearchDocumentRecords } from "../../../../models/systems/crm/search-document-records.js";
import { CrmDocumentRecordsSchema, CrmDocumentIdentitySchema } from "../../../../models/systems/crm/documents.js";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { matchesCrmDocumentSubject } from "../../../../rules/crm-doc-download/documents.js";
import { crmDriver } from "../driver-declaration.js";

export const searchDocumentRecordsTask = defineTask(crmDriver, CrmSearchDocumentRecords, {
  sessions: [{ system: "crm", access: "read", session: "reuse-worker" }],
  async run({ input, ctx }) {
    let output;
    try {
      const records = [], seen = new Set<string>();
      for (const subject of input.subjects) {
        ctx.signal.throwIfAborted();
        const identity = CrmDocumentIdentitySchema.parse(await ctx.driver.findDocumentRecord(subject));
        if (!matchesCrmDocumentSubject(subject, identity) || seen.has(identity.recordId)) throw new Error("CRM record identity is inconsistent or repeated");
        seen.add(identity.recordId); records.push({ subject, identity });
      }
      ctx.signal.throwIfAborted();
      output = CrmDocumentRecordsSchema.parse({ records });
    } catch (cause) {
      if (ctx.signal.aborted) throw cause;
      return ctx.fail("CRM_DOCUMENT_SOURCE_UNAVAILABLE", ERROR_CATALOG.CRM_DOCUMENT_SOURCE_UNAVAILABLE.text, { cause });
    }
    ctx.recordData({ direction: "read", field: "records", value: output.records });
    return output;
  },
});
