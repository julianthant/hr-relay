import { OcrInputSchema, OCR_INPUT_EXAMPLE } from "../ocr/input.js";
import { defineCanonicalInput } from "../../workflow/canonical-input.js";

export const EmergencyContactInputSchema = OcrInputSchema.omit({ sourceRunId: true, formType: true, approval: true });
const { sourceRunId: _sourceRunId, formType: _formType, approval: _approval, ...example } = OCR_INPUT_EXAMPLE;
export const EmergencyContactCanonicalInput = defineCanonicalInput(EmergencyContactInputSchema, EmergencyContactInputSchema, [example]);
