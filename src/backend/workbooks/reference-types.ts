import { I9_CHECK_REFERENCE } from "../../models/workflows/i9-check/start.js";
import { ONBOARDING_ROSTER_FIELDS, ONBOARDING_ROSTER_TYPE_ID } from "../../models/workflows/onboarding/roster.js";
import { OCR_ROSTER_FIELDS, OCR_ROSTER_TYPE_ID } from "../../models/workflows/ocr/roster.js";
import type { WorkbookType } from "../../models/dashboard/workbooks.js";
import { deepFreeze } from "../../rules/validation/immutability.js";

/** Reference types the registered workflows require; the library adds each one that is missing. */
export const WORKFLOW_REFERENCE_TYPES: readonly WorkbookType[] = deepFreeze([
  { id: OCR_ROSTER_TYPE_ID, name: "OCR roster", keyFieldId: "eid", fields: [...OCR_ROSTER_FIELDS], defaultWorkbookId: null },
  { id: I9_CHECK_REFERENCE.typeId, name: "Action History", keyFieldId: "eid", fields: [...I9_CHECK_REFERENCE.fields], defaultWorkbookId: null },
  { id: ONBOARDING_ROSTER_TYPE_ID, name: "Onboarding roster", keyFieldId: "email", fields: [...ONBOARDING_ROSTER_FIELDS], defaultWorkbookId: null },
]);
