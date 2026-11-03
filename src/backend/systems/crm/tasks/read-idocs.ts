import { defineTask } from "../../../../workflow-kit/task.js";
import { CrmReadIdocs, CrmDownloadedPeopleSchema } from "../../../../models/systems/crm/document-tasks.js";
import { CrmIdocsBytesSchema } from "../../../../models/systems/crm/read-idocs.js";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { crmDocumentIndices, matchesCrmDocumentSubject } from "../../../../rules/crm-doc-download/documents.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import { crmDriver } from "../driver-declaration.js";

export const readIdocsTask = defineTask(crmDriver, CrmReadIdocs, {
  sessions: [{ system: "crm", access: "read", session: "reuse-worker" }],
  async run({ input, ctx }) {
    let output;
    try {
      const people = [];
      for (const record of input.records) {
        ctx.signal.throwIfAborted();
        if (!matchesCrmDocumentSubject(record.subject, record.identity)) throw new Error("CRM download input does not name the verified person");
        const read = CrmIdocsBytesSchema.parse(await ctx.driver.readIdocs({ recordId: record.identity.recordId, subject: record.subject,
          ...(input.docIndices === undefined ? {} : { docIndices: input.docIndices }) }));
        const expected = crmDocumentIndices(read.totalDocuments, input.docIndices);
        if (canonicalJsonStringify(read.identity) !== canonicalJsonStringify(record.identity)
          || read.documents.length !== expected.length || read.documents.some((document, index) => document.index !== expected[index])) {
          throw new Error("CRM downloaded a different person or document selection");
        }
        const documents = [], names = new Set<string>();
        for (const document of read.documents) {
          ctx.signal.throwIfAborted();
          const name = document.fileName.normalize("NFC").toLowerCase();
          if (names.has(name) || Buffer.from(document.bytes.subarray(0, 5)).toString("latin1") !== "%PDF-") throw new Error("CRM PDF bytes or filenames are invalid");
          names.add(name);
          documents.push({ index: document.index, fileName: document.fileName, artifact: await ctx.artifacts.put(document.bytes, { mediaType: "application/pdf" }) });
        }
        people.push({ ...record, totalDocuments: read.totalDocuments, documents });
      }
      ctx.signal.throwIfAborted();
      output = CrmDownloadedPeopleSchema.parse({ people });
    } catch (cause) {
      if (ctx.signal.aborted) throw cause;
      // Browser request errors can contain the private document token.
      return ctx.fail("CRM_DOCUMENT_DOWNLOAD_FAILED", ERROR_CATALOG.CRM_DOCUMENT_DOWNLOAD_FAILED.text);
    }
    ctx.recordData({ direction: "read", field: "people", value: output.people });
    return output;
  },
});
