import { z } from "zod";
import { OcrParentInputSchema, OCR_INPUT_EXAMPLE } from "../ocr/input.js";
import { defineCanonicalInput } from "../../workflow/canonical-input.js";

// The operator's pick for one run: every member's form is filed to OnBase after its Save, or none is. It has no default.
export const OnbaseFilingPickSchema = z.enum(["file", "skip"]);
export const EmergencyContactInputSchema = OcrParentInputSchema.omit({ sourceRunId: true, formType: true, approval: true }).extend({ onbaseFiling: OnbaseFilingPickSchema });
const { sourceRunId: _sourceRunId, formType: _formType, approval: _approval, ...example } = OCR_INPUT_EXAMPLE;
export const EmergencyContactCanonicalInput = defineCanonicalInput(EmergencyContactInputSchema, EmergencyContactInputSchema, [{ ...example, onbaseFiling: "file" }]);
