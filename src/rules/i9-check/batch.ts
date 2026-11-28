import type { z } from "zod";
import { I9CheckInput, I9RosterRowSchema, i9CheckMatchKey } from "../../models/workflows/i9-check/input.js";
import { I9CheckPeopleSchema, I9CheckBatchRowsSchema } from "../../models/workflows/i9-check/batch.js";
import { ReadI9CheckPeople } from "../../models/workflows/i9-check-start/read-people.js";
import { ReadI9CheckRequests } from "../../models/workflows/i9-check-start/read-requests.js";
import { ReadI9CheckRows } from "../../models/workflows/i9-check-start/read-rows.js";
import { I9_CHECK_REFERENCE } from "../../models/workflows/i9-check/start.js";
import { deriveItemId } from "../identity/logical-item.js";
import { deriveStableUuid } from "../identity/stable-uuid.js";
import { parseUsOrIsoDate } from "../../models/fields/cell-coercion.js";
import { ocrRecordSourcePages } from "../../models/ocr/review-record.js";
import { decodeWorkbookReference, WorkbookReferenceReadSchema } from "../../models/processing/workbooks/read-reference.js";
import type { WorkbookCellValuesSchema } from "../../models/dashboard/workbooks.js";
import { canonicalJsonStringify } from "../validation/canonical-json.js";
import { resolveWorksheetRows } from "../spreadsheets/reference-rows.js";

type Person = z.output<typeof I9CheckPeopleSchema>["people"][number];
const mergeFields = ["firstName", "lastName", "dob", "ssn", "hireDate"] as const;
export function i9CheckApprovedPeople({ request, selection }: z.output<typeof ReadI9CheckPeople.input>) {
  if (selection.state !== "ready" || selection.sources.length !== request.documents.length) throw new Error("i9-check-approved-sources-unavailable");
  const people = new Map<string, Person>(), documents = new Set<string>();
  for (const source of selection.sources) {
    const { review, snapshot } = source, document = review.accounting.manifest.document;
    const requested = request.documents.find(entry => entry.document.id === document.id && entry.document.sha256 === document.sha256);
    if (review.formType !== "i9" || requested === undefined || documents.has(document.id)
      || review.accounting.readingId !== requested.readingId || review.accounting.outcomes.some(outcome => outcome.state !== "done")) {
      throw new Error("i9-check-incomplete-source-accounting");
    }
    documents.add(document.id);
    for (const record of snapshot.records) {
      if (record.assertedEid === null) throw new Error("i9-check-approved-record-unavailable");
      const pages = ocrRecordSourcePages(review.records, record);
      const values = new Map(record.fields.answers.flatMap(answer => answer.state === "read" && typeof answer.value === "string" ? [[answer.path, answer.value] as const] : []));
      const firstName = values.get("firstName"), lastName = values.get("lastName");
      if (firstName === undefined || lastName === undefined) throw new Error("i9-check-approved-name-unavailable");
      const sources = pages.map(sourcePage => ({ documentId: document.id, documentSha256: document.sha256, ocrRunId: snapshot.sourceRunId,
        snapshotId: snapshot.snapshotId, recordId: record.recordId, sourcePage }));
      const candidate = I9CheckInput.parse({ ocrRunId: snapshot.sourceRunId, recordId: deriveStableUuid("i9-check-person", record.assertedEid),
        asOf: request.asOf, reviewerName: request.reviewerName, roster: { rows: [] }, person: {
          name: `${lastName}, ${firstName}`, firstName, lastName, sourcePages: pages,
          ...(values.has("dateOfBirth") ? { dob: values.get("dateOfBirth") } : {}),
          ...(values.has("ssn") ? { ssn: values.get("ssn") } : {}),
          ...(values.has("hireDate") ? { hireDate: values.get("hireDate") } : {}),
        } });
      const previous = people.get(record.assertedEid);
      if (previous === undefined) {
        people.set(record.assertedEid, { eid: record.assertedEid, ocrRunId: candidate.ocrRunId,
          recordId: candidate.recordId, person: candidate.person, sources });
        continue;
      }
      for (const field of mergeFields) {
        const held = previous.person[field], next = candidate.person[field];
        if (held !== undefined && next !== undefined && held.toLowerCase() !== next.toLowerCase()) throw new Error("i9-check-contradictory-person-fields");
      }
      const person = I9CheckInput.parse({ ...candidate, person: { ...candidate.person, ...previous.person,
        ...Object.fromEntries(mergeFields.flatMap(field => previous.person[field] === undefined && candidate.person[field] !== undefined ? [[field, candidate.person[field]]] : [])),
        sourcePages: [...new Set([...previous.person.sourcePages, ...(previous.ocrRunId === snapshot.sourceRunId ? pages : [])])],
      } }).person;
      people.set(record.assertedEid, { ...previous, person, sources: [...previous.sources, ...sources] });
    }
  }
  return I9CheckPeopleSchema.parse({ people: [...people.values()] });
}

export function resolveI9WorksheetRows(read: z.output<typeof WorkbookReferenceReadSchema>) {
  const keys = read.reference.request.keys;
  const sources = read.sources.map(source => ({ referenceDigest: source.referenceDigest, ...decodeWorkbookReference(source.reference) }));
  const first = read.sources[0];
  if (first === undefined || first.referenceDigest !== read.referenceDigest
    || canonicalJsonStringify(first.reference) !== canonicalJsonStringify(read.reference)
    || new Set(sources.map(source => source.referenceDigest)).size !== sources.length
    || sources.some(({ request, snapshot }) => request.typeId !== I9_CHECK_REFERENCE.typeId || snapshot.type.keyFieldId !== "eid"
      || snapshot.rows.length !== keys.length || snapshot.rows.some((row, index) => row.key !== keys[index])
      || canonicalJsonStringify(request.fields) !== canonicalJsonStringify(I9_CHECK_REFERENCE.fields))) {
    throw new Error("i9-check-reference-membership-mismatch");
  }
  return keys.map((key, index) => ({ key, resolution: resolveWorksheetRows(sources.flatMap(({ referenceDigest, snapshot }) =>
    snapshot.rows[index].matches.map(match => ({ ...match, referenceDigest }))), row => row.values) }));
}

function retentionRosterRow(values: z.output<typeof WorkbookCellValuesSchema>, asOf: string) {
  const cell = (field: string) => {
    const value = values[field];
    if (value === undefined) throw new Error("i9-check-reference-field-unavailable");
    return typeof value === "object" && value !== null ? value.value.slice(0, 10) : value;
  };
  const date = cell("separationDate");
  const separationDate = date === null || date === "" ? null : typeof date === "string" ? parseUsOrIsoDate(date, `${asOf}T00:00:00.000Z`) : null;
  if (date !== null && date !== "" && separationDate === null) throw new Error("i9-check-roster-date-invalid");
  const identifier = (field: string) => {
    const value = cell(field);
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : value;
  };
  return I9RosterRowSchema.parse({ eid: identifier("eid"), ppsEid: identifier("ppsEid"), separationDate, action: cell("roster.action") });
}

export function i9CheckPersonRequests({ request, people, reference, choice }: z.output<typeof ReadI9CheckRequests.input>) {
  const resolved = resolveI9WorksheetRows(reference);
  const conflicts = resolved.filter(({ resolution }) => resolution.state === "ambiguous");
  if (conflicts.length !== (choice?.rows.length ?? 0) || choice !== undefined && choice.referenceDigest !== reference.referenceDigest
    || resolved.length !== people.people.length || resolved.some(({ key }, index) => key !== people.people[index]?.eid)) {
    throw new Error("i9-check-reference-membership-mismatch");
  }
  const children = people.people.map((person, index) => {
    const { resolution } = resolved[index];
    const selected = choice?.rows.find(row => row.key === person.eid);
    const match = resolution.state === "resolved" ? resolution.row : resolution.state === "missing" ? undefined
      : resolution.rows.find(row => selected?.referenceDigest === row.referenceDigest && selected.sheetId === row.sheetId && selected.rowId === row.rowId);
    if (resolution.state === "ambiguous" && match === undefined) throw new Error("i9-check-reference-choice-invalid");
    const rows = match === undefined ? [] : [retentionRosterRow(match.values, request.asOf)];
    if (rows.some(row => row.eid !== person.eid)) throw new Error("i9-check-reference-person-mismatch");
    return I9CheckInput.parse({ ocrRunId: person.ocrRunId, recordId: person.recordId, person: person.person,
      asOf: request.asOf, reviewerName: request.reviewerName, roster: { rows } });
  });
  return ReadI9CheckRequests.output.parse({ people: people.people, children, reference: reference.reference,
    ...(reference.sources.length > 1 ? { referenceSources: reference.sources } : {}) });
}

export function i9CheckBatchRows({ batchKey, prepared, outcomes }: z.output<typeof ReadI9CheckRows.input>) {
  if (outcomes.length !== prepared.children.length || prepared.people.length !== prepared.children.length) throw new Error("i9-check-child-membership-mismatch");
  const people = prepared.people.map((person, index) => {
    const child = prepared.children[index], outcome = outcomes[index];
    if (outcome.state !== "done" || outcome.itemId !== deriveItemId("i9-check", i9CheckMatchKey(child))
      || outcome.output.row.recordId !== person.recordId
      || outcome.output.identity.status === "found" && outcome.output.identity.eid !== person.eid) throw new Error("i9-check-child-result-mismatch");
    return { eid: person.eid, sources: person.sources, result: outcome.output };
  });
  return I9CheckBatchRowsSchema.parse({ batchKey, personCount: people.length, reference: prepared.reference,
    ...(prepared.referenceSources === undefined ? {} : { referenceSources: prepared.referenceSources }),
    people, tracker: { rows: people.map(person => person.result.row) } });
}
