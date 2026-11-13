import { z } from "zod";
import { ArtifactRefSchema } from "../../artifacts/artifacts.js";
import { AdmittedRecordSchema, type AdmittedRecord } from "../../ocr/extraction.js";
import { OcrFormTypeSchema, type OcrFormType } from "../../ocr/form-registry.js";
import { groupStack, personMatchKey, StackGroupingSchema } from "../../ocr/stack.js";
import { EidSchema, FingerprintSchema, IsoInstantSchema, RunIdSchema, StableRecordIdSchema } from "../../../rules/identity/ids.js";
import { matchRosterSubjects, RosterRowFactsSchema, RosterSubjectMatchSchema } from "../../../rules/matching/roster-match.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { deepFreeze } from "../../../rules/validation/immutability.js";
import { OcrPageAccountingSchema, OcrPageOutcomeSchema, type OcrPageReading } from "./page-accounting.js";
import { OcrWorkbookRosterEvidenceSchema } from "./roster.js";

const OcrArtifactRosterEvidenceSchema = z.strictObject({
  artifact: ArtifactRefSchema,
  readAt: IsoInstantSchema,
  rows: z.array(RosterRowFactsSchema),
}).superRefine((roster, context) => {
  if (new Set(roster.rows.map(row => row.sourceRow)).size !== roster.rows.length) {
    context.addIssue({ code: "custom", message: "OCR roster evidence contains duplicate source rows" });
  }
});
export const OcrRosterEvidenceSchema = z.union([OcrWorkbookRosterEvidenceSchema, OcrArtifactRosterEvidenceSchema]);

export const OcrReviewSeedInputSchema = z.strictObject({
  sourceRunId: RunIdSchema.optional(),
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

function subjectName(record: AdmittedRecord, formType: OcrFormType): string | null {
  if (formType === "emergency-contact") return fieldText(record, "employee.name");
  if (formType === "oath") return fieldText(record, "printedName");
  const last = fieldText(record, "lastName"), first = fieldText(record, "firstName");
  return last === null || first === null ? null : `${last}, ${first}`;
}

function deriveReview(input: OcrReviewSeedInput) {
  const { accounting, roster } = input;
  const { formType } = accounting;
  const pages = accounting.outcomes.map((outcome, index) => OcrPageDispositionSchema.parse({
    sourcePage: index + 1,
    disposition: outcome.state !== "done" ? outcome.state : outcome.output.extraction.record !== null ? "record"
      : ["blank", "boilerplate", "unrelated"].includes(outcome.output.extraction.pageKind) ? outcome.output.extraction.pageKind : "wrong-form",
  }));
  const classified = accounting.outcomes.flatMap((outcome, index) => outcome.state !== "done" ? [] : [{
    sourcePage: index + 1, pageKind: outcome.output.extraction.pageKind,
    subjectName: outcome.output.extraction.record === null ? null : subjectName(outcome.output.extraction.record, formType),
  }]);
  const grouping = groupStack({ pages: classified }, formType);
  const records = accounting.outcomes.flatMap((outcome, index) => {
    if (outcome.state !== "done") return [];
    const { extractionId, extraction } = outcome.output;
    const fields = extraction.record;
    if (fields === null) return [];
    const name = subjectName(fields, formType);
    const eid = formType === "i9" ? null : fieldText(fields, formType === "oath" ? "employeeId" : "employee.employeeId");
    const assertedEid = eid === null ? null : EidSchema.parse(eid);
    const recordId = StableRecordIdSchema.parse(`${accounting.manifest.document.sha256}#${formType}#${index + 1}`);
    const rosterMatch = roster === null ? null : matchRosterSubjects([{ subjectId: recordId,
      ...(name === null ? {} : { name }), ...(assertedEid === null ? {} : { eid: assertedEid }) }], roster.rows);
    const match = rosterMatch === null ? null : rosterMatch[0];
    if (match === undefined) throw new Error("OCR roster matcher returned no disposition for a record");
    const key = name === null ? null : personMatchKey(name);
    const duplicate = key !== null && grouping.subjects.some(subject => subject.matchKey === key && subject.completeness === "duplicate");
    return [OcrReviewRecordSeedSchema.parse({ recordId, sourcePage: index + 1, extractionId, fields, subjectName: name, assertedEid,
      identitySource: extraction.source.kind === "operator" ? "operator" : "document", rosterMatch: match,
      lookup: name === null && assertedEid === null ? { state: "unavailable", reason: "missing-identity" }
        : { state: "required", name, eid: assertedEid ?? match?.matchedEid ?? null },
      issues: [...(fields.blockingPaths.length > 0 ? ["mandatory-fields"] : []),
        ...(duplicate ? ["duplicate-subject"] : []), ...(key === null ? ["unidentified-subject"] : []), "identity-unverified"],
    })];
  });
  return { pages, grouping, records };
}

export const OcrReviewSeedSchema = OcrReviewSeedInputSchema.extend({
  formType: OcrFormTypeSchema,
  pages: z.array(OcrPageDispositionSchema).min(1),
  grouping: StackGroupingSchema,
  records: z.array(OcrReviewRecordSeedSchema),
}).superRefine((seed, context) => {
  const source = OcrReviewSeedInputSchema.safeParse({ sourceRunId: seed.sourceRunId, accounting: seed.accounting, roster: seed.roster });
  if (!source.success) return;
  if (seed.formType !== source.data.accounting.formType) {
    context.addIssue({ code: "custom", message: "OCR review form does not match its page accounting" });
  }
  const expected = deriveReview(source.data);
  if (canonicalJsonStringify({ pages: seed.pages, grouping: seed.grouping, records: seed.records }) !== canonicalJsonStringify(expected)) {
    context.addIssue({ code: "custom", message: "OCR review seed does not match its retained page and roster evidence" });
  }
});
export type OcrReviewSeed = z.infer<typeof OcrReviewSeedSchema>;

export function buildOcrReviewSeed(candidate: OcrReviewSeedInput): OcrReviewSeed {
  const input = OcrReviewSeedInputSchema.parse(candidate);
  return deepFreeze(OcrReviewSeedSchema.parse({ ...input, formType: input.accounting.formType, ...deriveReview(input) }));
}

const [donePage, ...unreadPages] = OcrPageOutcomeSchema.options;
const { output: _reading, ...doneRef } = donePage.shape;
const { rows: _workbookRows, ...workbookRosterRef } = OcrWorkbookRosterEvidenceSchema.shape;
const { rows: _artifactRows, ...artifactRosterRef } = OcrArtifactRosterEvidenceSchema.shape;
const { fields: _fields, ...recordRef } = OcrReviewRecordSeedSchema.shape;
export const OcrReviewCheckpointSchema = z.strictObject({ ...OcrReviewSeedSchema.shape,
  accounting: z.strictObject({ ...OcrPageAccountingSchema.shape,
    outcomes: z.array(z.discriminatedUnion("state", [z.strictObject({ ...doneRef, extractionId: FingerprintSchema }), ...unreadPages])).min(1) }),
  roster: z.union([z.strictObject(workbookRosterRef), z.strictObject(artifactRosterRef)]).nullable(),
  records: z.array(z.strictObject(recordRef)),
});
export type OcrReviewCheckpoint = z.infer<typeof OcrReviewCheckpointSchema>;

export function compactOcrReviewSeed({ roster, accounting, records, ...seed }: OcrReviewSeed): OcrReviewCheckpoint {
  const { rows: _rows, ...rosterRef } = roster ?? { rows: [] };
  return OcrReviewCheckpointSchema.parse({ ...seed, roster: roster === null ? null : rosterRef,
    accounting: { ...accounting, outcomes: accounting.outcomes.map(outcome => outcome.state !== "done" ? outcome
      : { state: outcome.state, runId: outcome.runId, itemId: outcome.itemId, extractionId: outcome.output.extractionId }) },
    records: records.map(({ fields: _recordFields, ...record }) => record) });
}

export function hydrateOcrReviewSeed(checkpoint: OcrReviewCheckpoint, reading: (extractionId: string) => OcrPageReading | undefined,
  roster: OcrReviewSeed["roster"]): OcrReviewSeed {
  const { sourceRunId, accounting } = checkpoint;
  const seed = buildOcrReviewSeed({ ...(sourceRunId === undefined ? {} : { sourceRunId }), roster, accounting: { ...accounting,
    outcomes: accounting.outcomes.map(outcome => {
      if (outcome.state !== "done") return outcome;
      const output = reading(outcome.extractionId);
      if (output === undefined) throw new Error("OCR review checkpoint names a page reading that is not retained.");
      return { state: outcome.state, runId: outcome.runId, itemId: outcome.itemId, output };
    }) } });
  if (canonicalJsonStringify(compactOcrReviewSeed(seed)) !== canonicalJsonStringify(checkpoint)) {
    throw new Error("OCR review checkpoint does not match its retained page readings and roster.");
  }
  return seed;
}
