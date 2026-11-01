import { z } from "zod";
import { ArtifactRefSchema } from "../../artifacts/artifacts.js";
import { AdmittedRecordSchema, type AdmittedRecord } from "../../ocr/extraction.js";
import { groupStack, personMatchKey, StackGroupingSchema } from "../../ocr/stack.js";
import { EidSchema, FingerprintSchema, IsoInstantSchema, RunIdSchema, StableRecordIdSchema } from "../../../rules/identity/ids.js";
import { matchRosterSubjects, RosterRowFactsSchema, RosterSubjectMatchSchema } from "../../../rules/matching/roster-match.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { deepFreeze } from "../../../rules/validation/immutability.js";
import { OcrPageAccountingSchema } from "./page-accounting.js";

export const OcrRosterEvidenceSchema = z.strictObject({
  artifact: ArtifactRefSchema,
  readAt: IsoInstantSchema,
  rows: z.array(RosterRowFactsSchema),
}).superRefine((roster, context) => {
  if (new Set(roster.rows.map(row => row.sourceRow)).size !== roster.rows.length) {
    context.addIssue({ code: "custom", message: "OCR roster evidence contains duplicate source rows" });
  }
});

const OcrReviewSeedInputSchema = z.strictObject({
  sourceRunId: RunIdSchema,
  accounting: OcrPageAccountingSchema,
  roster: OcrRosterEvidenceSchema.nullable(),
});
export type OcrReviewSeedInput = z.infer<typeof OcrReviewSeedInputSchema>;

export const OcrReviewRecordSeedSchema = z.strictObject({
  recordId: StableRecordIdSchema,
  sourcePage: z.number().int().positive(),
  extractionId: FingerprintSchema,
  fields: AdmittedRecordSchema,
  subjectName: z.string().min(1).nullable(),
  assertedEid: EidSchema.nullable(),
  identitySource: z.enum(["document", "operator"]),
  rosterMatch: RosterSubjectMatchSchema.nullable(),
  lookup: z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("required"), name: z.string().min(1).nullable(), eid: EidSchema.nullable() }),
    z.strictObject({ state: z.literal("unavailable"), reason: z.literal("missing-identity") }),
  ]),
  issues: z.array(z.enum(["mandatory-fields", "duplicate-subject", "unidentified-subject", "identity-unverified"])).min(1),
});

const OcrPageDispositionSchema = z.strictObject({
  sourcePage: z.number().int().positive(),
  disposition: z.enum(["record", "blank", "boilerplate", "unrelated", "wrong-form", "failed", "cancelled", "blocked"]),
});

function fieldText(record: AdmittedRecord, path: string): string | null {
  const answer = record.answers.find(answer => answer.path === path);
  return answer?.state === "read" && typeof answer.value === "string" ? answer.value : null;
}

function deriveReview(input: OcrReviewSeedInput) {
  const { accounting, roster } = input;
  const pages = accounting.outcomes.map((outcome, index) => OcrPageDispositionSchema.parse({
    sourcePage: index + 1,
    disposition: outcome.state !== "done" ? outcome.state : outcome.output.extraction.record !== null ? "record"
      : ["blank", "boilerplate", "unrelated"].includes(outcome.output.extraction.pageKind) ? outcome.output.extraction.pageKind : "wrong-form",
  }));
  const classified = accounting.outcomes.flatMap((outcome, index) => outcome.state !== "done" ? [] : [{
    sourcePage: index + 1, pageKind: outcome.output.extraction.pageKind,
    subjectName: outcome.output.extraction.record === null ? null : fieldText(outcome.output.extraction.record, "employee.name"),
  }]);
  const grouping = groupStack({ pages: classified }, "emergency-contact");
  const records = accounting.outcomes.flatMap((outcome, index) => {
    if (outcome.state !== "done") return [];
    const { extractionId, extraction } = outcome.output;
    const fields = extraction.record;
    if (fields === null) return [];
    const subjectName = fieldText(fields, "employee.name");
    const eid = fieldText(fields, "employee.employeeId");
    const assertedEid = eid === null ? null : EidSchema.parse(eid);
    const recordId = StableRecordIdSchema.parse(`${accounting.manifest.document.sha256}#emergency-contact#${index + 1}`);
    const rosterMatch = roster === null ? null : matchRosterSubjects([{ subjectId: recordId,
      ...(subjectName === null ? {} : { name: subjectName }), ...(assertedEid === null ? {} : { eid: assertedEid }) }], roster.rows);
    const match = rosterMatch === null ? null : rosterMatch[0];
    if (match === undefined) throw new Error("OCR roster matcher returned no disposition for a record");
    const key = subjectName === null ? null : personMatchKey(subjectName);
    const duplicate = key !== null && grouping.subjects.some(subject => subject.matchKey === key && subject.completeness === "duplicate");
    return [OcrReviewRecordSeedSchema.parse({ recordId, sourcePage: index + 1, extractionId, fields, subjectName, assertedEid,
      identitySource: extraction.source.kind === "operator" ? "operator" : "document", rosterMatch: match,
      lookup: subjectName === null && assertedEid === null ? { state: "unavailable", reason: "missing-identity" }
        : { state: "required", name: subjectName, eid: assertedEid ?? match?.matchedEid ?? null },
      issues: [...(fields.blockingPaths.length > 0 ? ["mandatory-fields"] : []),
        ...(duplicate ? ["duplicate-subject"] : []), ...(key === null ? ["unidentified-subject"] : []), "identity-unverified"],
    })];
  });
  return { pages, grouping, records };
}

export const OcrReviewSeedSchema = OcrReviewSeedInputSchema.extend({
  formType: z.literal("emergency-contact"),
  pages: z.array(OcrPageDispositionSchema).min(1),
  grouping: StackGroupingSchema,
  records: z.array(OcrReviewRecordSeedSchema),
}).superRefine((seed, context) => {
  const source = OcrReviewSeedInputSchema.safeParse({ sourceRunId: seed.sourceRunId, accounting: seed.accounting, roster: seed.roster });
  if (!source.success) return;
  const expected = deriveReview(source.data);
  if (canonicalJsonStringify({ pages: seed.pages, grouping: seed.grouping, records: seed.records }) !== canonicalJsonStringify(expected)) {
    context.addIssue({ code: "custom", message: "OCR review seed does not match its retained page and roster evidence" });
  }
});
export type OcrReviewSeed = z.infer<typeof OcrReviewSeedSchema>;

export function buildOcrReviewSeed(candidate: OcrReviewSeedInput): OcrReviewSeed {
  const input = OcrReviewSeedInputSchema.parse(candidate);
  return deepFreeze(OcrReviewSeedSchema.parse({ ...input, formType: "emergency-contact", ...deriveReview(input) }));
}
