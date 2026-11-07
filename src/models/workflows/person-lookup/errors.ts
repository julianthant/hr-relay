import { ERROR_CATALOG, type ErrorCatalogCode } from "../../failures/error-catalog.js";
export class PersonLookupNotFoundError extends Error {
  constructor(readonly code: Extract<ErrorCatalogCode, "PERSON_LOOKUP_NOT_FOUND"> = "PERSON_LOOKUP_NOT_FOUND") { super(ERROR_CATALOG[code].text); this.name = "PersonLookupNotFoundError"; }
}
export class PersonLookupMultipleMatchesError extends Error {
  constructor(readonly code: Extract<ErrorCatalogCode, "PERSON_LOOKUP_MULTIPLE_MATCHES"> = "PERSON_LOOKUP_MULTIPLE_MATCHES") { super(ERROR_CATALOG[code].text); this.name = "PersonLookupMultipleMatchesError"; }
}
export class PersonLookupMatchMultipleMatchesError extends Error {
  constructor(readonly code: Extract<ErrorCatalogCode, "PERSON_LOOKUP_MATCH_MULTIPLE_MATCHES"> = "PERSON_LOOKUP_MATCH_MULTIPLE_MATCHES") { super(ERROR_CATALOG[code].text); this.name = "PersonLookupMatchMultipleMatchesError"; }
}
export class PersonLookupEmploymentStatusError extends Error {
  constructor(readonly code: Extract<ErrorCatalogCode, "PERSON_LOOKUP_EMPLOYMENT_STATUS_UNDETERMINED"> = "PERSON_LOOKUP_EMPLOYMENT_STATUS_UNDETERMINED") { super(ERROR_CATALOG[code].text); this.name = "PersonLookupEmploymentStatusError"; }
}
export class PersonLookupIdentityError extends Error {
  constructor(readonly code: Extract<ErrorCatalogCode, "INCONSISTENT_INPUTS"> = "INCONSISTENT_INPUTS") { super(ERROR_CATALOG[code].text); this.name = "PersonLookupIdentityError"; }
}
