import { createHash } from "node:crypto";
import JSZip from "jszip";
import type { ContentAddressedArtifactWriter } from "../../../workflow-kit/artifacts.js";
import type { CrmWorksheetPerson } from "../../../models/workflows/crm-doc-download/documents.js";
import { groupCrmWorksheetDocuments } from "../../../rules/crm-doc-download/worksheets.js";

export async function packageCrmWorksheetArchives(artifacts: ContentAddressedArtifactWriter, people: readonly CrmWorksheetPerson[]) {
  const archives = [];
  for (const worksheet of groupCrmWorksheetDocuments(people)) {
    const zip = new JSZip();
    for (const person of worksheet.people) {
      for (const document of person.source.documents) {
        const chunks: Buffer[] = []; let length = 0;
        for await (const chunk of await artifacts.open(document.artifact)) {
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
    archives.push({ relativePath: worksheet.relativePath, artifact: await artifacts.put(bytes, { mediaType: "application/zip" }),
      worksheetId: worksheet.worksheetId, worksheetName: worksheet.worksheetName,
      people: worksheet.people.map(person => ({ identity: person.source.identity, rowId: person.source.reference.rowId, folderName: person.folderName })) });
  }
  return archives;
}
