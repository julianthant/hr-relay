import { RunWorkbookReferenceSchema } from "../../../src/models/dashboard/workbooks.js";
import { CrmDocumentRecordsSchema } from "../../../src/models/systems/crm/document-tasks.js";
import { ONBOARDING_ROSTER_FIELDS } from "../../../src/models/workflows/onboarding/roster.js";

export const CRM_DOCUMENT_RECORDS_FIXTURE = CrmDocumentRecordsSchema.parse({ records: [
  { subject: { kind: "eid", value: "10000001" }, identity: { recordId: "one", eid: "10000001", workEmail: "one@example.test", personalEmail: null } },
  { subject: { kind: "email", value: "two@example.test" }, identity: { recordId: "two", eid: null, workEmail: "two@example.test", personalEmail: "other@example.test" } },
] });

export function crmDocumentReferenceFixture() {
  const keys = ["one@example.test", "two@example.test", "other@example.test"];
  return RunWorkbookReferenceSchema.parse({ request: { typeId: "onboarding-roster", keys, fields: [...ONBOARDING_ROSTER_FIELDS] },
    snapshot: { libraryId: "roster", version: 2, worksheets: [{ sheetId: "july", name: "July 6" }, { sheetId: "august", name: "August 2" }],
      type: { id: "onboarding-roster", name: "Onboarding roster", keyFieldId: "email", fields: [...ONBOARDING_ROSTER_FIELDS], defaultWorkbookId: "roster" },
      rows: keys.map((key, index) => ({ key, state: index === 2 ? "missing" : "matched", matches: index === 2 ? [] : [{
        sheetId: index === 0 ? "july" : "august", rowId: `row-${String(index)}`, values: {
          email: key, firstName: index === 0 ? "Legal" : "Second", lastName: "Fixture", middleName: "",
          "roster.livedFirstName": null, "roster.livedLastName": null, "roster.livedMiddleName": null,
        },
      }] })),
    } });
}
