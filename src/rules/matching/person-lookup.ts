import { selectPreferredUcpathCandidate } from "./ucpath-person.js";
import { PersonLookupNotFoundError, PersonLookupMultipleMatchesError, PersonLookupMatchMultipleMatchesError, PersonLookupEmploymentStatusError, PersonLookupIdentityError } from "../../models/workflows/person-lookup/errors.js";
import type { z } from "zod";
import { ReadResolvedIdentity, type ResolvedIdentity } from "../../models/workflows/person-lookup/read-resolved-identity.js";
import { ReadActiveStatus, type ActiveStatusOutcome } from "../../models/workflows/person-lookup/read-active-status.js";
import { personLookupSearchText } from "../../models/workflows/person-lookup/input.js";

function dateWithinWeek(left: string, right: string): boolean {
  const a = Date.parse(left); const b = Date.parse(right);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 7 * 86400000;
}
export function resolvePersonLookupIdentity({ input, person, match, crm }: z.output<typeof ReadResolvedIdentity.input>): ResolvedIdentity {
  const records = crm?.state === "checked" ? crm.records : [];
  let candidates = person?.results ?? [];
  let candidateEids = [...new Set(candidates.map((candidate) => candidate.emplId))];
  let method: ResolvedIdentity["method"] = "ucpath";
  if (input.mode === "match") {
    if (match === undefined) throw new Error("Match identity requires the UCPath Match read");
    candidateEids = [...new Set(match.confirmed.map((hit) => hit.emplId))]; method = "match";
  } else if (!("emplId" in input) && records.length > 0) {
    const direct = [...new Set(records.filter((record) => candidateEids.includes(record.emplId)).map((record) => record.emplId))];
    const dated = direct.length > 0 ? direct : [...new Set(candidates.filter((candidate) => records.some((record) =>
      dateWithinWeek(record.firstDayOfService, candidate.startDate))).map((candidate) => candidate.emplId))];
    if (dated.length > 0) { candidateEids = dated; candidates = candidates.filter((candidate) => dated.includes(candidate.emplId)); method = direct.length > 0 ? "eid-match" : "date-match"; }
    else if (candidateEids.length === 0) { candidateEids = [...new Set(records.map((record) => record.emplId))]; method = "crm-only"; }
  }
  const eid = candidateEids.length === 1 ? candidateEids[0] : undefined;
  const preferred = person?.selection.selected;
  const selected = eid === undefined ? null : preferred?.emplId === eid ? preferred : selectPreferredUcpathCandidate(candidates.filter((candidate) => candidate.emplId === eid));
  const knownEid = input.mode === "search" && "emplId" in input ? input.emplId : eid;
  const exactRecords = knownEid === undefined ? [] : records.filter((record) => record.emplId === knownEid);
  const crmRecord = exactRecords.length === 1 ? exactRecords[0] ?? null : null;
  const unanimous = (field: "name" | "department" | "firstDayOfService"): string | null => {
    const values = new Set(exactRecords.map(record => record[field]));
    return values.size === 1 ? [...values][0] ?? null : null;
  };
  const crmIdentity = knownEid === undefined || exactRecords.length === 0 ? null : { emplId: knownEid, name: unanimous("name"), department: unanimous("department"), firstDayOfService: unanimous("firstDayOfService") };
  const state = candidateEids.length > 1 ? "multiple-matches" : selected !== null || input.mode === "match" && eid !== undefined ? "resolved" : crmIdentity !== null ? "crm-only" : "not-found";
  return { unselectedCrmRecords: crm?.state === "checked" && crmRecord === null ? records : null, ucpathFound: input.mode === "match" ? (match?.confirmed.length ?? 0) > 0 : (person?.results.length ?? 0) > 0, crmErrorCode: crm?.state === "check-failed" ? crm.code : null, shouldCheckCrm: input.crmCheck && (input.mode === "search" || candidateEids.length === 1), state, selected, crmRecord, crmIdentity, candidateEids: candidateEids.length === 0 && crmIdentity !== null ? [crmIdentity.emplId] : candidateEids,
    recoveryEid: input.mode === "search" && state === "crm-only" ? crmIdentity!.emplId : null,
    crmState: crm === undefined ? "Not checked" : crm.state === "check-failed" ? "Check failed" : crmIdentity === null ? "Not found" : "Found",
    method: state === "multiple-matches" ? "multiple-matches" : state === "not-found" ? "no-match" : method };
}

export function derivePersonLookupOutcome({ input, identity: originalIdentity, verifiedCrm, recovered, match }: z.output<typeof ReadActiveStatus.input>): ActiveStatusOutcome {
  const identity = verifiedCrm === undefined ? originalIdentity : {
    ...originalIdentity,
    crmRecord: verifiedCrm.state === "checked" ? verifiedCrm.records[0] ?? null : null,
    crmIdentity: verifiedCrm.state === "checked" ? verifiedCrm.records[0] ?? null : null,
    crmState: verifiedCrm.state === "check-failed" ? "Check failed" as const : "Found" as const,
    crmErrorCode: verifiedCrm.state === "check-failed" ? verifiedCrm.code : null,
  };
  const selected = recovered?.selection.selected ?? identity.selected;
  if (selected !== null && identity.crmRecord !== null && selected.emplId !== identity.crmRecord.emplId) throw new PersonLookupIdentityError();
  const crm = identity.crmIdentity;
  const matched = match?.confirmed.length === 1 ? match.confirmed[0] : undefined;
  let state: ActiveStatusOutcome["state"];
  let reason = ""; let code: string | null = null;
  if (identity.state === "multiple-matches") { state = "multiple-matches"; const failure = input.mode === "match" ? new PersonLookupMatchMultipleMatchesError() : new PersonLookupMultipleMatchesError(); code = failure.code; reason = failure.message; }
  else if (input.mode === "match") { state = matched === undefined ? "not-found-in-ucpath" : "found"; }
  else if (selected === null) {
    state = crm === null ? "not-found" : "crm-only";
    if (state === "not-found") { const failure = new PersonLookupNotFoundError(); code = failure.code; reason = failure.message; }
  } else if (selected.terminationDate !== "" || selected.employeeStatus === "inactive" || selected.employeeStatus === "terminated") {
    state = "inactive"; reason = selected.terminationReason || `UCPath reports ${selected.hrStatus}`;
  } else if (selected.employeeStatus === "unknown") {
    state = "undetermined"; code = new PersonLookupEmploymentStatusError().code; reason = selected.hrStatus === "" ? "UCPath HR status is blank" : `UCPath HR status is unreadable: ${selected.hrStatus}`;
  } else { state = "active"; }
  const ambiguous = state === "multiple-matches";
  const eid = ambiguous ? null : selected?.emplId ?? matched?.emplId ?? crm?.emplId ?? null;
  const name = ambiguous ? null : selected?.name ?? matched?.name ?? crm?.name ?? null;
  const terminated = !ambiguous && selected !== null && (selected.terminationDate !== "" || selected.employeeStatus === "terminated");
  return { ucpathSelection: ambiguous ? "ambiguous" : selected !== null || matched !== undefined ? "resolved" : "not-found", datesEid: input.mode === "search" && input.crmCheck && input.includeCrmDates && !ambiguous ? eid : null, state, reason, code: code ?? identity.crmErrorCode, hdh: selected?.hdh ?? null, candidateEids: identity.candidateEids,
    details: { search: personLookupSearchText(input), name, eid, department: ambiguous ? null : selected?.department ?? crm?.department ?? null,
      hrStatus: ambiguous ? null : selected?.hrStatus ?? null, ucpath: selected !== null || identity.ucpathFound ? "Found" : "Not found", crm: identity.crmState,
      startDate: ambiguous || crm?.firstDayOfService === "" ? null : crm?.firstDayOfService ?? null,
      endDate: terminated ? selected.terminationDate || null : null, terminationReason: terminated ? selected.terminationReason || null : null,
      foundInUcpath: input.mode === "match" ? (match?.confirmed.length ?? 0) > 0 : null,
      matchedEid: input.mode === "match" ? matched?.emplId ?? null : null, matchedName: input.mode === "match" ? matched?.name ?? null : null,
    } };
}
