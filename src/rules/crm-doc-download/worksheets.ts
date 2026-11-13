import { CrmWorksheetPersonSchema, type CrmWorksheetPerson } from "../../models/workflows/crm-doc-download/documents.js";
import { crmDocumentFolderName } from "./documents.js";
import { NamedArtifactFileNameSchema } from "../../models/artifacts/artifacts.js";

export function groupCrmWorksheetDocuments(raw: readonly CrmWorksheetPerson[]) {
  if (raw.length === 0) throw new Error("CRM document collection has no people");
  const worksheets = new Map<string, { referenceDigest: string; worksheetId: string; worksheetName: string;
    people: Array<{ folderName: string; source: CrmWorksheetPerson }> }>();
  const members = new Set<string>(), rows = new Set<string>(), folders = new Set<string>();
  for (const value of raw) {
    const person = CrmWorksheetPersonSchema.parse(value), { referenceDigest, worksheetId, worksheetName, rowId } = person.reference;
    const groupKey = JSON.stringify([referenceDigest, worksheetId]);
    const existing = worksheets.get(groupKey);
    if (existing !== undefined && existing.worksheetName !== worksheetName) throw new Error("CRM worksheet identity has conflicting names");
    const row = JSON.stringify([referenceDigest, worksheetId, rowId]);
    if (rows.has(row)) throw new Error("CRM document collection repeats a reference row");
    rows.add(row);
    const folderName = crmDocumentFolderName(person.reference.names);
    const folder = JSON.stringify([referenceDigest, worksheetId, folderName.normalize("NFC").toLowerCase()]);
    if (folders.has(folder)) throw new Error("CRM person folder names collide");
    folders.add(folder);
    for (const document of person.documents) {
      const member = JSON.stringify([referenceDigest, worksheetId, `${folderName}/${document.fileName}`.normalize("NFC").toLowerCase()]);
      if (members.has(member)) throw new Error("CRM archive member names collide");
      if (document.artifact.mediaType !== "application/pdf") throw new Error("CRM archive member is not a retained PDF");
      members.add(member);
    }
    if (existing === undefined) worksheets.set(groupKey, { referenceDigest, worksheetId, worksheetName, people: [{ folderName, source: person }] });
    else existing.people.push({ folderName, source: person });
  }
  const groups = [...worksheets.values()], nameCounts = new Map<string, number>(), destinations = new Set<string>();
  for (const group of groups) {
    const key = group.worksheetName.normalize("NFC").toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  return groups.map(group => {
    const archiveName = NamedArtifactFileNameSchema.parse(`${group.worksheetName}.zip`);
    const shared = (nameCounts.get(group.worksheetName.normalize("NFC").toLowerCase()) ?? 0) > 1;
    const relativePath = shared ? `${group.referenceDigest}/${group.worksheetName}/${archiveName}` : `${group.worksheetName}/${archiveName}`;
    const destination = relativePath.normalize("NFC").toLowerCase();
    if (destinations.has(destination)) throw new Error("CRM worksheet archive destinations collide");
    destinations.add(destination);
    return { ...group, relativePath };
  });
}
