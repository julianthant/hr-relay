import { CrmWorksheetPersonSchema, type CrmWorksheetPerson } from "../../models/workflows/crm-doc-download/documents.js";
import { crmDocumentFolderName } from "./documents.js";
import { NamedArtifactFileNameSchema } from "../../models/artifacts/artifacts.js";

export function groupCrmWorksheetDocuments(raw: readonly CrmWorksheetPerson[]) {
  if (raw.length === 0) throw new Error("CRM document collection has no people");
  const worksheets = new Map<string, { worksheetId: string; worksheetName: string; relativePath: string;
    people: Array<{ folderName: string; source: CrmWorksheetPerson }> }>();
  const destinations = new Set<string>(), members = new Set<string>(), rows = new Set<string>(), folders = new Set<string>();
  for (const value of raw) {
    const person = CrmWorksheetPersonSchema.parse(value), { worksheetId, worksheetName, rowId } = person.reference;
    const archiveName = NamedArtifactFileNameSchema.parse(`${worksheetName}.zip`);
    const relativePath = `${worksheetName}/${archiveName}`, destination = relativePath.normalize("NFC").toLowerCase();
    const existing = worksheets.get(worksheetId);
    if (existing !== undefined && existing.worksheetName !== worksheetName) throw new Error("CRM worksheet identity has conflicting names");
    if (existing === undefined && destinations.has(destination)) throw new Error("CRM worksheet archive destinations collide");
    const row = JSON.stringify([worksheetId, rowId]);
    if (rows.has(row)) throw new Error("CRM document collection repeats a reference row");
    rows.add(row);
    const folderName = crmDocumentFolderName(person.reference.names);
    const folder = JSON.stringify([worksheetId, folderName.normalize("NFC").toLowerCase()]);
    if (folders.has(folder)) throw new Error("CRM person folder names collide");
    folders.add(folder);
    for (const document of person.documents) {
      const member = JSON.stringify([worksheetId, `${folderName}/${document.fileName}`.normalize("NFC").toLowerCase()]);
      if (members.has(member)) throw new Error("CRM archive member names collide");
      if (document.artifact.mediaType !== "application/pdf") throw new Error("CRM archive member is not a retained PDF");
      members.add(member);
    }
    if (existing === undefined) worksheets.set(worksheetId, { worksheetId, worksheetName, relativePath, people: [{ folderName, source: person }] });
    else existing.people.push({ folderName, source: person });
    destinations.add(destination);
  }
  return [...worksheets.values()];
}
