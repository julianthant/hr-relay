import { ReadCrmDocumentRows } from "../../../models/workflows/crm-doc-download/read-document-rows.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { evidenceLeaves } from "../../../models/trust/evidence-classification.js";
import { resolveCrmDocumentRows } from "../../../rules/crm-doc-download/reference.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { defineTask } from "../../../workflow-kit/task.js";

export const readCrmDocumentRowsTask = defineTask(ReadCrmDocumentRows, {
  sessions: [],
  async run({ input, ctx }) {
    ctx.signal.throwIfAborted();
    let output;
    try {
      const sourceDigests = input.sources.map(source => source.referenceDigest);
      const [only] = sourceDigests;
      const people = resolveCrmDocumentRows(input.records, input.sources);
      output = ReadCrmDocumentRows.output.parse({
        referenceDigest: sourceDigests.length === 1 ? only : sha256Hex(canonicalJsonStringify(sourceDigests)),
        sourceDigests, people,
        state: people.every(person => person.resolution.state === "resolved") ? "resolved" : "resolve-required" });
    } catch (cause) {
      return ctx.fail("CRM_DOCUMENT_REFERENCE_UNAVAILABLE", ERROR_CATALOG.CRM_DOCUMENT_REFERENCE_UNAVAILABLE.text, { cause });
    }
    ctx.recordData(evidenceLeaves(output).map(({ path, value }) => ({ direction: "read" as const, field: path, value })));
    return output;
  },
});
