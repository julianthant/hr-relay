import type { z } from "zod";
import { RunWorkbookNamedReferenceSchema } from "../../models/dashboard/workbooks.js";
import { CrmDocumentRecordsSchema, CrmDownloadedPeopleSchema } from "../../models/systems/crm/documents.js";
import { CRM_DOCUMENT_ROSTER_FIELDS, CrmWorksheetPersonSchema } from "../../models/workflows/crm-doc-download/documents.js";
import { CrmDocumentRowsSchema, CrmDocumentRowChoiceSchema } from "../../models/workflows/crm-doc-download/read-document-rows.js";
import { ONBOARDING_ROSTER_TYPE_ID } from "../../models/workflows/onboarding/roster.js";
import { FingerprintSchema } from "../identity/ids.js";
import { canonicalJsonStringify } from "../validation/canonical-json.js";
import { matchesCrmDocumentSubject } from "./documents.js";

type Records = z.output<typeof CrmDocumentRecordsSchema>;
type Reference = z.output<typeof RunWorkbookNamedReferenceSchema>;
type Row = z.output<typeof CrmWorksheetPersonSchema>["reference"];
type Candidate = Readonly<{ key: string; referenceDigest: string; row: Row }>;
type Source = Readonly<{ referenceDigest: string; reference: Reference }>;

function emails(record: Records["records"][number]): string[] {
  if (!matchesCrmDocumentSubject(record.subject, record.identity)) throw new Error("CRM reference identity is unverified");
  const keys = [...new Set([record.identity.workEmail, record.identity.personalEmail]
    .flatMap(value => value === null ? [] : [value.toLowerCase()]))];
  if (keys.length === 0) throw new Error("CRM reference identity has no verified email");
  return keys;
}

export function crmDocumentReferenceKeys(value: z.input<typeof CrmDocumentRecordsSchema>): string[] {
  const records = CrmDocumentRecordsSchema.parse(value).records;
  return [...new Set(records.flatMap(emails))];
}

export function resolveCrmDocumentRows(value: z.input<typeof CrmDocumentRecordsSchema>, sourcesValue: readonly Source[]) {
  const records = CrmDocumentRecordsSchema.parse(value).records;
  const sources = sourcesValue.map(source => ({
    referenceDigest: FingerprintSchema.parse(source.referenceDigest),
    reference: RunWorkbookNamedReferenceSchema.parse(source.reference),
  }));
  const keys = crmDocumentReferenceKeys({ records });
  if (sources.length === 0 || new Set(sources.map(source => source.referenceDigest)).size !== sources.length) {
    throw new Error("CRM document reference does not retain the exact requested keys and fields");
  }
  for (const source of sources) {
    const { request, snapshot } = source.reference;
    if (request.typeId !== ONBOARDING_ROSTER_TYPE_ID || snapshot.type.keyFieldId !== "email"
      || request.keys.length !== keys.length || request.keys.some((key, index) => key !== keys[index])
      || request.fields.length !== CRM_DOCUMENT_ROSTER_FIELDS.length
      || CRM_DOCUMENT_ROSTER_FIELDS.some(field => !request.fields.includes(field) || !snapshot.type.fields.includes(field))) {
      throw new Error("CRM document reference does not retain the exact requested keys and fields");
    }
  }
  return records.map(record => {
    const candidates = new Map<string, Candidate>();
    for (const source of sources) {
      const { snapshot } = source.reference;
      for (const key of emails(record)) {
        const retained = snapshot.rows.find(row => row.key === key);
        if (retained === undefined) throw new Error("CRM document reference key is missing");
        for (const match of retained.matches) {
          const worksheet = snapshot.worksheets.find(sheet => sheet.sheetId === match.sheetId);
          if (worksheet === undefined || typeof match.values.email !== "string" || match.values.email.toLowerCase() !== key) {
            throw new Error("CRM document reference row membership is invalid");
          }
          const values = match.values;
          const row = CrmWorksheetPersonSchema.shape.reference.parse({
            referenceDigest: source.referenceDigest, worksheetId: match.sheetId, worksheetName: worksheet.name, rowId: match.rowId,
            names: {
              legalName: { firstName: values.firstName, lastName: values.lastName, middleName: values.middleName },
              livedName: CRM_DOCUMENT_ROSTER_FIELDS.slice(4).every(field => values[field] === null) ? null : {
                firstName: values["roster.livedFirstName"], lastName: values["roster.livedLastName"], middleName: values["roster.livedMiddleName"],
              },
            },
          });
          const membership = JSON.stringify([source.referenceDigest, row.worksheetId, row.rowId]);
          if (candidates.has(membership)) throw new Error("CRM document reference repeats a worksheet row");
          candidates.set(membership, { key, referenceDigest: source.referenceDigest, row });
        }
      }
    }
    const matches = [...candidates.values()];
    const [selected] = matches;
    const resolution = matches.length === 1 && selected !== undefined
      ? { state: "resolved" as const, selected }
      : { state: "resolve-required" as const, reason: matches.length === 0 ? "row-missing" as const : "row-ambiguous" as const, candidates: matches };
    return { ...record, resolution };
  });
}

export function bindCrmWorksheetPeople(downloadedValue: z.input<typeof CrmDownloadedPeopleSchema>,
  rowsValue: z.input<typeof CrmDocumentRowsSchema>, choiceValue?: z.input<typeof CrmDocumentRowChoiceSchema>) {
  const downloaded = CrmDownloadedPeopleSchema.parse(downloadedValue), rows = CrmDocumentRowsSchema.parse(rowsValue);
  const selected = rows.state === "resolved" ? rows : CrmDocumentRowChoiceSchema.parse(choiceValue);
  if (selected.referenceDigest !== rows.referenceDigest || selected.people.length !== rows.people.length
    || downloaded.people.length !== rows.people.length) throw new Error("CRM document row choices changed the retained batch");
  return rows.people.map((person, index) => {
    const selection = selected.people[index], documents = downloaded.people[index];
    if (selection === undefined || documents === undefined || selection.resolution.state !== "resolved"
      || canonicalJsonStringify({ subject: selection.subject, identity: selection.identity }) !== canonicalJsonStringify({ subject: person.subject, identity: person.identity })
      || canonicalJsonStringify({ subject: documents.subject, identity: documents.identity }) !== canonicalJsonStringify({ subject: person.subject, identity: person.identity })) {
      throw new Error("CRM document row choices changed the verified identity");
    }
    const candidates = person.resolution.state === "resolved" ? [person.resolution.selected] : person.resolution.candidates;
    const candidate = selection.resolution.selected;
    if (!candidates.some(value => canonicalJsonStringify(value) === canonicalJsonStringify(candidate))) {
      throw new Error("CRM document row choice is outside the retained membership");
    }
    return CrmWorksheetPersonSchema.parse({ identity: person.identity,
      reference: { ...candidate.row, referenceDigest: candidate.referenceDigest }, documents: documents.documents });
  });
}
