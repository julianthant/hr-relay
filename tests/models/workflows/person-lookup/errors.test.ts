import assert from "node:assert/strict";
import { it } from "vitest";
import { ERROR_CATALOG } from "../../../../src/models/failures/error-catalog.js";
import { PersonLookupNotFoundError, PersonLookupMultipleMatchesError, PersonLookupMatchMultipleMatchesError, PersonLookupEmploymentStatusError, PersonLookupIdentityError } from "../../../../src/models/workflows/person-lookup/errors.js";
import { PersonLookupMatchInputError } from "../../../../src/models/workflows/person-lookup/input.js";
import { PersonLookupUcpathSearchError } from "../../../../src/models/systems/ucpath/search-person-match.js";
import { CrmRecordIdentityDriftError, PersonLookupCrmCheckError } from "../../../../src/models/systems/crm/search-onboarding-records.js";
import { PersonLookupCrmDatesBindingError, PersonLookupCrmDatesCheckError } from "../../../../src/models/systems/crm/read-onboarding-dates.js";

it("uses registered Person Lookup codes and fixed text while retaining causes", () => {
  const cause = new Error("private diagnostic");
  const cases = [
    [new PersonLookupNotFoundError(), "PERSON_LOOKUP_NOT_FOUND"],
    [new PersonLookupMultipleMatchesError(), "PERSON_LOOKUP_MULTIPLE_MATCHES"],
    [new PersonLookupMatchMultipleMatchesError(), "PERSON_LOOKUP_MATCH_MULTIPLE_MATCHES"],
    [new PersonLookupEmploymentStatusError(), "PERSON_LOOKUP_EMPLOYMENT_STATUS_UNDETERMINED"],
    [new PersonLookupIdentityError(), "INCONSISTENT_INPUTS"],
    [new PersonLookupMatchInputError(), "PERSON_LOOKUP_MATCH_INPUT_MISSING_IDENTIFIERS"],
    [new PersonLookupUcpathSearchError(cause), "PERSON_LOOKUP_UCPATH_SEARCH_FAILED"],
    [new CrmRecordIdentityDriftError(), "PERSON_LOOKUP_CRM_RECORD_IDENTITY_DRIFT"],
    [new PersonLookupCrmCheckError(cause), "PERSON_LOOKUP_CRM_CHECK_FAILED"],
    [new PersonLookupCrmDatesBindingError(), "PERSON_LOOKUP_CRM_DATES_BINDING_INVALID"],
    [new PersonLookupCrmDatesCheckError(cause), "PERSON_LOOKUP_CRM_DATES_CHECK_FAILED"],
  ] as const;
  for (const [error, code] of cases) {
    assert.equal(error.code, code);
    assert.equal(error.message, ERROR_CATALOG[code].text);
    assert.doesNotMatch(error.message, /private diagnostic/);
  }
  for (const error of [cases[6][0], cases[8][0], cases[10][0]]) assert.equal(error.cause, cause);
});
