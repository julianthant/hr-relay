import { selectPreferredUcpathCandidate } from "./ucpath-person.js";
import { PersonLookupNotFoundError, PersonLookupMultipleMatchesError, PersonLookupMatchMultipleMatchesError, PersonLookupEmploymentStatusError, PersonLookupIdentityError } from "../../models/workflows/person-lookup/errors.js";
import type { z } from "zod";
import type { EidSchema } from "../identity/ids.js";
import type { SearchPersonOrgOutput, UcpathCandidate } from "../../models/systems/ucpath/search-person-org.js";
import type { SearchPersonMatchOutputSchema } from "../../models/systems/ucpath/search-person-match.js";
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
  } else {
    const { employeeStatus } = selected;
    switch (employeeStatus) {
      case "inactive":
      case "terminated": state = "inactive"; break;
      case "unknown": state = "undetermined"; break;
      case "active": state = "active"; break;
      default: throw new Error(`unhandled UCPath employment status: ${String(employeeStatus satisfies never)}`);
    }
    if (selected.terminationDate !== "") state = "inactive";
    if (state === "inactive") reason = selected.terminationReason || `UCPath reports ${selected.hrStatus}`;
    else if (state === "undetermined") {
      code = new PersonLookupEmploymentStatusError().code;
      reason = selected.hrStatus === "" ? "UCPath HR status is blank" : `UCPath HR status is unreadable: ${selected.hrStatus}`;
    }
  }
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

/** The employment status the operator typed, over the run's own identity reads; only `foundInUcpath` is derived from a typed field. */
export function typedPersonLookupOutcome(read: z.output<typeof ReadActiveStatus.input>, typed: Readonly<{
  state: "active" | "inactive"; hrStatus: string | null; startDate: string | null; endDate: string | null; terminationReason: string | null; ucpath: "Found" | "Not found";
}>): ActiveStatusOutcome {
  const base = derivePersonLookupOutcome(read);
  return { ...base, state: typed.state, reason: "", code: read.identity.crmErrorCode,
    details: { ...base.details, hrStatus: typed.hrStatus, startDate: typed.startDate, endDate: typed.endDate, terminationReason: typed.terminationReason,
      ucpath: typed.ucpath, foundInUcpath: typed.ucpath === "Found" } };
}

/** The one Employee ID this run's UCPath identity knows, the key a CRM check is made under; undefined when there is none. */
export function personLookupKnownEid(input: z.output<typeof ReadResolvedIdentity.input>["input"], identity: ResolvedIdentity): z.output<typeof EidSchema> | undefined {
  return input.mode === "search" && "emplId" in input ? input.emplId : identity.candidateEids.length === 1 ? identity.candidateEids[0] : undefined;
}

/**
 * The cross-checked identity when the operator types the CRM record's name and start date: today's resolution of
 * the UCPath identity with that record found under the known Employee ID. No CRM record is read.
 */
export function typedCrmIdentity(input: z.output<typeof ReadResolvedIdentity.input>["input"], identity: ResolvedIdentity, knownEid: z.output<typeof EidSchema>,
  typed: Readonly<{ name: string; firstDayOfService: string }>): ResolvedIdentity {
  const state = identity.state === "not-found" ? "crm-only" : identity.state;
  return { ...identity, crmIdentity: { emplId: knownEid, name: typed.name, department: null, firstDayOfService: typed.firstDayOfService },
    crmRecord: null, unselectedCrmRecords: null, crmErrorCode: null, crmState: "Found", state,
    candidateEids: identity.candidateEids.length === 0 ? [knownEid] : identity.candidateEids,
    recoveryEid: input.mode === "search" && state === "crm-only" ? knownEid : null,
    method: state === "crm-only" ? "crm-only" : identity.method };
}

type TypedSearchPerson = Pick<UcpathCandidate, "emplId" | "name" | "department" | "jobTitle" | "hrStatus" | "employeeStatus" | "hdh">;

/** The candidate the operator typed; the dates UCPath would show stay empty (they are typed under Read employment status). */
function typedCandidate(input: z.output<typeof ReadResolvedIdentity.input>["input"], typed: TypedSearchPerson): UcpathCandidate {
  if (input.mode === "search" && "emplId" in input && input.emplId !== typed.emplId) {
    throw new Error("The typed Employee ID is not the searched Employee ID");
  }
  return { ...typed, startDate: "", effectiveDate: "", terminationDate: "", terminationReason: "" };
}

/** Search mode's read when the operator types the person: one result, selected. */
export function typedSearchPerson(input: z.output<typeof ReadResolvedIdentity.input>["input"], typed: TypedSearchPerson): SearchPersonOrgOutput {
  const candidate = typedCandidate(input, typed);
  return { results: [candidate], selection: { status: "resolved", selected: candidate, candidateEids: [candidate.emplId] } };
}

/** Match mode's read when the operator types the person: one confirmed hit. */
export function typedSearchMatch(typed: TypedSearchPerson): z.output<typeof SearchPersonMatchOutputSchema> {
  const hit = { emplId: typed.emplId, name: typed.name };
  return { hits: [hit], confirmed: [hit], dropped: [] };
}

/** Today's resolution over the mode's typed read, with the typed person selected in either mode. */
export function typedSearchIdentity(input: z.output<typeof ReadResolvedIdentity.input>["input"], typed: TypedSearchPerson): ResolvedIdentity {
  const resolved = input.mode === "match"
    ? resolvePersonLookupIdentity({ input, match: typedSearchMatch(typed) })
    : resolvePersonLookupIdentity({ input, person: typedSearchPerson(input, typed) });
  return { ...resolved, selected: typedCandidate(input, typed) };
}
