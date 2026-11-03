import { createHash } from "node:crypto";
import JSZip from "jszip";
import type { ContentAddressedArtifactWriter } from "../../../workflow-kit/artifacts.js";
import { collectionArtifactOutput } from "../../../workflow-kit/artifacts.js";
import type { CrmWorksheetPerson } from "../../../models/workflows/crm-doc-download/documents.js";
import { ReadCrmWorksheetArchives } from "../../../models/workflows/crm-doc-download/read-worksheet-archives.js";
import { CrmWorksheetArchiveSchema } from "../../../models/workflows/crm-doc-download/documents.js";
import { evidenceLeaves } from "../../../models/trust/evidence-classification.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { groupCrmWorksheetDocuments } from "../../../rules/crm-doc-download/worksheets.js";
import { defineTask } from "../../../workflow-kit/task.js";

export async function packageCrmWorksheetArchives(artifacts: ContentAddressedArtifactWriter, people: readonly CrmWorksheetPerson[], signal: AbortSignal) {
  signal.throwIfAborted();
  const archives = [];
  for (const worksheet of groupCrmWorksheetDocuments(people)) {
    signal.throwIfAborted();
    const zip = new JSZip();
    for (const person of worksheet.people) {
      for (const document of person.source.documents) {
        const chunks: Buffer[] = []; let length = 0;
        for await (const chunk of await artifacts.open(document.artifact)) {
          signal.throwIfAborted();
          if (!(chunk instanceof Uint8Array)) throw new Error("CRM retained PDF yielded non-byte data");
          length += chunk.byteLength;
          if (length > document.artifact.bytes) throw new Error("CRM retained PDF size changed");
          chunks.push(Buffer.from(chunk));
        }
        const bytes = Buffer.concat(chunks);
        if (bytes.byteLength !== document.artifact.bytes || createHash("sha256").update(bytes).digest("hex") !== document.artifact.sha256
          || bytes.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("CRM retained PDF bytes changed");
        zip.file(`${person.folderName}/${document.fileName}`, bytes, { date: new Date("1980-01-01T00:00:00.000Z"), createFolders: false });
      }
    }
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    signal.throwIfAborted();
    archives.push(CrmWorksheetArchiveSchema.parse({ relativePath: worksheet.relativePath, artifact: await artifacts.put(bytes, { mediaType: "application/zip" }),
      worksheetId: worksheet.worksheetId, worksheetName: worksheet.worksheetName,
      people: worksheet.people.map(person => ({ identity: person.source.identity, rowId: person.source.reference.rowId, folderName: person.folderName,
        documentCount: person.source.documents.length })) }));
  }
  signal.throwIfAborted();
  return archives;
}

export const readCrmWorksheetArchivesTask = defineTask(ReadCrmWorksheetArchives, {
  sessions: [],
  async run({ input, ctx }) {
    let output;
    try {
      const worksheets = await packageCrmWorksheetArchives(ctx.artifacts, input.people, ctx.signal);
      ctx.signal.throwIfAborted();
      const collection = await collectionArtifactOutput(ctx.artifacts, worksheets.map(({ relativePath, artifact }) => ({ relativePath, artifact })));
      ctx.signal.throwIfAborted();
      output = ReadCrmWorksheetArchives.output.parse({ collection, worksheets, worksheetCount: worksheets.length,
        personCount: worksheets.reduce((total, sheet) => total + sheet.people.length, 0),
        documentCount: worksheets.reduce((total, sheet) => total + sheet.people.reduce((count, person) => count + person.documentCount, 0), 0) });
    } catch (cause) {
      if (ctx.signal.aborted) throw cause;
      return ctx.fail("CRM_DOCUMENT_PACKAGE_FAILED", ERROR_CATALOG.CRM_DOCUMENT_PACKAGE_FAILED.text, { cause });
    }
    ctx.recordData(evidenceLeaves(output).map(({ path, value }) => ({ direction: "read" as const, field: path, value })));
    return output;
  },
});
