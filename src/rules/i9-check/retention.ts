import type { z } from "zod";
import type { I9CheckInputValue } from "../../models/workflows/i9-check/input.js";
import type { I9CheckRow, I9Identity, ReadRetentionRow } from "../../models/workflows/i9-check/check.js";
import type { SearchPersonMatchOutputSchema } from "../../models/systems/ucpath/search-person-match.js";
import { parseUsOrIsoDate } from "../../models/fields/cell-coercion.js";

export function i9MatchOutcome(match?: z.output<typeof SearchPersonMatchOutputSchema>): I9Identity {
  const hits = [...new Map(match?.confirmed.map(hit => [hit.emplId, hit]) ?? []).values()];
  if (hits.length === 0) return { status: "not-found", candidateCount: 0 };
  if (hits.length > 1) return { status: "ambiguous", candidateCount: hits.length, candidateEids: hits.map(hit => hit.emplId), reason: "multiple-matches" };
  const hit = hits[0];
  if (hit === undefined) throw new Error("I-9 match identity is missing");
  return { status: "found", eid: hit.emplId, name: hit.name };
}

function lookupIdentity({ input, initial, search }: z.output<typeof ReadRetentionRow.input>): I9Identity {
  if (initial.status === "found") return initial;
  if (search === undefined) throw new Error("I-9 name search observation is missing");
  const candidates = initial.status === "ambiguous" ? search.results.filter(candidate => initial.candidateEids.includes(candidate.emplId)) : search.results;
  const candidateEids = [...new Set(candidates.map(candidate => candidate.emplId))];
  const candidateCount = candidateEids.length;
  if (candidateCount === 0) return initial.status === "ambiguous" ? initial : { status: "not-found", candidateCount: 0 };
  const hireDate = input.person.hireDate;
  if (hireDate === undefined) return { status: "ambiguous", candidateCount, candidateEids, reason: "missing-hire-date" };
  const matched = candidates.filter(candidate => {
    const raw = candidate.startDate.trim() === "" ? candidate.effectiveDate : candidate.startDate;
    if (raw.trim() === "") return false;
    const date = parseUsOrIsoDate(raw, `${input.asOf}T00:00:00.000Z`);
    if (date === null) throw new Error("I-9 UCPath hire date is invalid");
    return Math.abs(Date.parse(date) - Date.parse(hireDate)) <= 7 * 86400000;
  });
  const hits = [...new Map(matched.map(candidate => [candidate.emplId, candidate])).values()];
  if (hits.length === 0) return initial.status === "ambiguous" ? initial : { status: "not-found", candidateCount };
  if (hits.length > 1) return { status: "ambiguous", candidateCount: hits.length, candidateEids: hits.map(hit => hit.emplId), reason: "multiple-hire-date-matches" };
  const hit = hits[0];
  if (hit === undefined) throw new Error("I-9 hire-date identity is missing");
  return { status: "found", eid: hit.emplId, name: hit.name };
}

const normalizePpsEid = (value: string): string => value.replace(/^0+(?=\d)/u, "");

function rosterEvidence(input: I9CheckInputValue, identity: I9Identity) {
  const seed = input.roster.seed;
  let rows = identity.status === "found" ? input.roster.rows.filter(row => row.eid === identity.eid) : [];
  if (identity.status === "found" && rows.length === 0 && seed?.ppsEid !== undefined) {
    const pps = normalizePpsEid(seed.ppsEid);
    rows = input.roster.rows.filter(row => normalizePpsEid(row.ppsEid) === pps);
    if (new Set(rows.map(row => row.eid)).size > 1) throw new Error("I-9 PPS roster match names multiple employees");
  }
  const terminations = rows.filter(row => /^(?:ter|termination)$/iu.test(row.action));
  const pool = terminations.length > 0 ? terminations : rows;
  const sorted = [...pool].sort((a, b) => (b.separationDate ?? "").localeCompare(a.separationDate ?? ""));
  const row = sorted[0];
  if (row !== undefined && sorted.some(other => other.separationDate === row.separationDate && normalizePpsEid(other.ppsEid) !== normalizePpsEid(row.ppsEid))) {
    throw new Error("I-9 roster rows disagree on the PPS ID");
  }
  return row === undefined ? { ppsEid: seed?.ppsEid ?? "", separationDate: seed?.separationDate ?? null }
    : { ppsEid: row.ppsEid, separationDate: row.separationDate };
}

export function i9RetentionRow(args: z.output<typeof ReadRetentionRow.input>): z.output<typeof ReadRetentionRow.output> {
  const { input } = args;
  const identity = lookupIdentity(args);
  const roster = rosterEvidence(input, identity);
  const row: I9CheckRow = {
    recordId: input.recordId, employeeName: input.person.name, ppsEid: roster.ppsEid,
    ucpathEmplId: identity.status === "found" ? identity.eid : "", hireDate: input.person.hireDate === undefined ? "" : input.person.hireDate,
    separationDate: roster.separationDate ?? "", foundInUcpath: identity.status === "found" ? "Yes" : identity.status === "ambiguous" ? "Ambiguous in UCPath" : "Not found in UCPath",
    action: "", reviewerName: input.reviewerName, notes: "",
  };
  if (identity.status === "ambiguous") {
    row.notes = identity.reason === "missing-hire-date" ? "I-9 hire date missing; review manually."
      : "Multiple UCPath candidates match; review manually.";
  } else if (identity.status === "not-found") row.action = "Shred";
  else if (roster.separationDate === null) row.notes = "No roster separation date; review manually.";
  else {
    const separation = new Date(`${roster.separationDate}T00:00:00.000Z`);
    const end = Date.UTC(separation.getUTCFullYear() + 5, separation.getUTCMonth(), separation.getUTCDate());
    if (Date.parse(input.asOf) > end) row.action = "Shred";
    else { row.action = "Keep"; row.notes = `Shred on ${new Date(end + 86400000).toISOString().slice(0, 10)}`; }
  }
  return { identity, row };
}
