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

export function i9CheckPersonRequests({ request, people, reference }: z.output<typeof ReadI9CheckRequests.input>) {
  if (reference.reference.request.typeId !== I9_CHECK_REFERENCE.typeId || reference.reference.snapshot.type.keyFieldId !== "eid") {
    throw new Error("i9-check-reference-unavailable");
  }
  const facts = reference.reference, snapshot = facts.snapshot;
  if (snapshot.rows.length !== people.people.length || snapshot.rows.some((row, index) => row.key !== people.people[index]?.eid)) throw new Error("i9-check-reference-membership-mismatch");
  const children = people.people.map((person, index) => {
    const matches = snapshot.rows[index].matches;
    const rows = matches.map(match => {
      const cell = (field: string) => {
        const found = match.values.filter(cell => cell.fieldId === field);
        if (found.length !== 1) throw new Error("i9-check-reference-field-unavailable");
        const value = found[0].value;
        return typeof value === "object" && value !== null ? value.value.slice(0, 10) : value;
      };
      const date = cell("separationDate");
      const separationDate = date === null || date === "" ? null : typeof date === "string" ? parseUsOrIsoDate(date, `${request.asOf}T00:00:00.000Z`) : null;
      if (date !== null && date !== "" && separationDate === null) throw new Error("i9-check-roster-date-invalid");
      const identifier = (field: string) => {
        const value = cell(field);
        return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : value;
      };
      return I9RosterRowSchema.parse({ eid: identifier("eid"), ppsEid: identifier("ppsEid"), separationDate, action: cell("roster.action") });
    });
    if (rows.some(row => row.eid !== person.eid)) throw new Error("i9-check-reference-person-mismatch");
    return I9CheckInput.parse({ ocrRunId: person.ocrRunId, recordId: person.recordId, person: person.person,
      asOf: request.asOf, reviewerName: request.reviewerName, roster: { rows } });
  });
  return ReadI9CheckRequests.output.parse({ people: people.people, children, reference: facts });
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
    people, tracker: { rows: people.map(person => person.result.row) } });
}
