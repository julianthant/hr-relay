export class PersonLookupNotFoundError extends Error {
  readonly code = "person-lookup-not-found";
  constructor() { super("Person not found."); this.name = "PersonLookupNotFoundError"; }
}
export class PersonLookupMultipleMatchesError extends Error {
  readonly code = "person-lookup-multiple-matches";
  constructor() { super("Multiple people match; none was chosen."); this.name = "PersonLookupMultipleMatchesError"; }
}
export class PersonLookupMatchMultipleMatchesError extends Error {
  readonly code = "person-lookup-match-multiple-matches";
  constructor() { super("Multiple UCPath people match; none was chosen."); this.name = "PersonLookupMatchMultipleMatchesError"; }
}
export class PersonLookupEmploymentStatusError extends Error {
  readonly code = "person-lookup-employment-status-undetermined";
  constructor() { super("Employment status could not be determined."); this.name = "PersonLookupEmploymentStatusError"; }
}
export class PersonLookupIdentityError extends Error {
  readonly code = "inconsistent-inputs";
  constructor() { super("Person Lookup received inconsistent UCPath and CRM identities."); this.name = "PersonLookupIdentityError"; }
}
