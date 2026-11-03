import { z } from "zod";
import { CrmDocumentSubjectSchema } from "../../systems/crm/read-idocs.js";
import { defineCanonicalInput } from "../../workflow/canonical-input.js";
import { InputParserSpecSchema } from "../../workflow/ingress.js";

const people = CrmDocumentSubjectSchema.array().min(1).refine(values =>
  new Set(values.map(subject => `${subject.kind}:${subject.value.toLowerCase()}`)).size === values.length, "CRM people must be unique")
  .refine(values => values.every(subject => subject.kind !== "email" || subject.value === subject.value.toLowerCase()), "CRM email keys must be canonical");

export const CrmDocDownloadInput = z.strictObject({ people: z.string().trim().min(1).transform(text =>
  text.split(/[,;\n]/u).map(entry => entry.trim()).filter(Boolean).map(value => value.includes("@")
    ? { kind: "email" as const, value: value.toLowerCase() } : { kind: "eid" as const, value })).pipe(people) });
export const CrmDocDownloadCanonicalInput = defineCanonicalInput(CrmDocDownloadInput, z.strictObject({ people }), [
  { people: "fixture@example.test; second@example.test" },
]);
export type CrmDocDownloadInputValue = z.output<typeof CrmDocDownloadInput>;
export const CRM_DOCUMENT_INPUT_PARSER = InputParserSpecSchema.parse({ split: { kind: "whole-text" }, rules: [{ when: { kind: "otherwise" }, emit: "people" }] });
