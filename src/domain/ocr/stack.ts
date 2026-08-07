/**
 * Stage 1 and 2 of the scanner pipeline — classify a stack, then group its
 * pages into subjects (D157).
 *
 * Stage 3, `admitOcrExtraction`, reads ONE page and already assumes its caller
 * knows the form type. These two stages are what let a caller know it, and they
 * are separate from extraction for three reasons: classification is cheap while
 * extraction is not, so nobody pays to extract twenty-four boilerplate pages; a
 * misclassification is visible and correctable BEFORE the expensive step; and
 * grouping gets to be deterministic code over classifications rather than
 * something a model holds in its head across forty-four pages.
 *
 * ## Grouping matches by NAME across the whole stack, never by adjacency
 *
 * Measured on raw Xerox output (D157): the 44-page I-9 scan's first four pages
 * are four DIFFERENT people with alternating sections — §2 Casey, §1 Cho, §2
 * Cisneros, §1 Chan. Neighbour-pairing would have attached Casey's Section 1
 * from Cho's page: a real employment verification bound to the wrong person,
 * and it would have looked entirely successful. Adjacency is a property of how
 * a particular pile was assembled, not of scanning.
 *
 * ## The match is exact, and ambiguity is reported rather than resolved
 *
 * A fuzzy surname score is precisely where this would start guessing. The key
 * is a normalized token set with single-letter initials dropped — because a
 * middle initial is written inconsistently and its absence must not split one
 * person into two — and two pages group only on an EXACT key match. Anything
 * else is `ambiguous` or `unidentified` and reaches a human.
 */
import { z } from "zod";
import { IsoInstantSchema } from "../ids.js";
import { displayPersonName } from "../fields/cell-coercion.js";
import { OcrFormTypeSchema, OcrPageKindSchema, type OcrFormType, type OcrPageKind } from "./form-registry.js";

/**
 * Page kinds that carry no data and are never grouped.
 *
 * Every form that exists today is one page per person, so a subject is one
 * page. When the `i9` form lands it introduces the SECTIONED case — a subject
 * spanning a Section 1 and a Section 2 — and with it the orphan outcome D157
 * settled (flag, never block). That arm is deliberately not written here in
 * advance: unreachable code with no test is exactly what this tree removes.
 */
const DATALESS: ReadonlySet<OcrPageKind> = new Set(["boilerplate", "unrelated", "blank"]);

export const ClassifiedPageSchema = z.strictObject({
  sourcePage: z.number().int().positive(),
  pageKind: OcrPageKindSchema,
  /**
   * The person this page names, exactly as written, or null when the page
   * carries no name or it could not be read. An I-9 Section 2 names the person
   * independently of its Section 1 ("Employee Last Name, First Name and Middle
   * Initial from Section 1"), which is what makes the pair matchable at all.
   */
  subjectName: z.string().min(1).nullable(),
  confidence: z.number().min(0).max(1),
});
export type ClassifiedPage = z.infer<typeof ClassifiedPageSchema>;

export const ClassifiedStackSchema = z.strictObject({
  sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
  classifiedAt: IsoInstantSchema,
  pages: z.array(ClassifiedPageSchema).min(1),
}).superRefine((stack, context) => {
  const seen = new Set<number>();
  for (const page of stack.pages) {
    if (seen.has(page.sourcePage)) {
      context.addIssue({ code: "custom", message: `page ${String(page.sourcePage)} is classified twice` });
    }
    seen.add(page.sourcePage);
  }
});
export type ClassifiedStack = z.infer<typeof ClassifiedStackSchema>;

/**
 * A person's identity for matching: lowercased alphabetic tokens, sorted, with
 * single letters dropped.
 *
 * Sorted because `Clauldia, Drona A.` and `Drona Clauldia` are one person and the two
 * forms both occur. Initials dropped because a middle initial is written
 * inconsistently — present on the Section 2 header, absent on the Section 1 —
 * and letting its absence split one person into two would orphan both halves of
 * a complete pair.
 *
 * Returns null below two tokens: one name does not identify anybody here, and a
 * key that matched on a surname alone would group siblings.
 */
export function personMatchKey(name: string): string | null {
  const tokens = displayPersonName(name)
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((token) => token.length > 1);
  if (tokens.length < 2) return null;
  return [...new Set(tokens)].sort().join(" ");
}

export const SubjectCompletenessSchema = z.enum([
  /** Every page this form needs is present. */
  "complete",
  /** Two pages name one person; a human decides which is theirs. */
  "duplicate",
]);

export const StackSubjectSchema = z.strictObject({
  matchKey: z.string().min(1),
  /** The name as first read, for the operator to recognize. */
  displayName: z.string().min(1),
  pages: z.array(z.strictObject({
    sourcePage: z.number().int().positive(),
    pageKind: OcrPageKindSchema,
  })).min(1),
  completeness: SubjectCompletenessSchema,
});
export type StackSubject = z.infer<typeof StackSubjectSchema>;

export const StackGroupingSchema = z.strictObject({
  formType: OcrFormTypeSchema,
  subjects: z.array(StackSubjectSchema),
  /**
   * Pages of the RIGHT type that could not be attributed to anybody — no name,
   * or a name too short to identify. They are listed rather than dropped.
   */
  unidentified: z.array(z.number().int().positive()),
  /** Pages of a different form than this run is processing. */
  otherForms: z.array(z.strictObject({
    sourcePage: z.number().int().positive(),
    pageKind: OcrPageKindSchema,
  })),
  /** Pages carrying no data at all. */
  dataless: z.array(z.strictObject({
    sourcePage: z.number().int().positive(),
    pageKind: OcrPageKindSchema,
  })),
});
export type StackGrouping = z.infer<typeof StackGroupingSchema>;

/** The page kinds this run is processing. One per form, today. */
function expectedKinds(formType: OcrFormType): readonly OcrPageKind[] {
  return [formType];
}

/**
 * Group a classified stack into subjects for one workflow.
 *
 * Every page lands in exactly one bucket — a subject, `unidentified`,
 * `otherForms` or `dataless` — so a count can be reconciled against the paper
 * that was fed in. That total coverage is the point: a page that quietly
 * belonged to no bucket is a page nobody knows was skipped.
 */
export function groupStack(stack: ClassifiedStack, formType: OcrFormType): StackGrouping {
  const wanted = new Set(expectedKinds(formType));
  const subjects = new Map<string, { displayName: string; pages: ClassifiedPage[] }>();
  const unidentified: number[] = [];
  const otherForms: { sourcePage: number; pageKind: OcrPageKind }[] = [];
  const dataless: { sourcePage: number; pageKind: OcrPageKind }[] = [];

  for (const page of [...stack.pages].sort((left, right) => left.sourcePage - right.sourcePage)) {
    if (DATALESS.has(page.pageKind)) {
      dataless.push({ sourcePage: page.sourcePage, pageKind: page.pageKind });
      continue;
    }
    if (!wanted.has(page.pageKind)) {
      otherForms.push({ sourcePage: page.sourcePage, pageKind: page.pageKind });
      continue;
    }
    const key = page.subjectName === null ? null : personMatchKey(page.subjectName);
    if (key === null) {
      unidentified.push(page.sourcePage);
      continue;
    }
    const held = subjects.get(key) ?? { displayName: displayPersonName(page.subjectName ?? ""), pages: [] };
    held.pages.push(page);
    subjects.set(key, held);
  }

  const grouped = [...subjects].map(([matchKey, held]) => StackSubjectSchema.parse({
    matchKey,
    displayName: held.displayName,
    pages: held.pages.map((page) => ({ sourcePage: page.sourcePage, pageKind: page.pageKind })),
    completeness: held.pages.length > 1 ? "duplicate" : "complete",
  })).sort((left, right) => left.pages[0].sourcePage - right.pages[0].sourcePage);

  return StackGroupingSchema.parse({
    formType,
    subjects: grouped,
    unidentified,
    otherForms,
    dataless,
  });
}

/**
 * The operator's first checkpoint: what is in this pile, and what does not
 * belong in this run.
 *
 * The counts reconcile — `pagesAccounted` equals the pages classified — because
 * the whole reason to look at this before extracting is to check the machine
 * saw the same stack you fed it.
 */
export const StackReportSchema = z.strictObject({
  formType: OcrFormTypeSchema,
  pagesClassified: z.number().int().positive(),
  pagesAccounted: z.number().int().nonnegative(),
  byKind: z.array(z.strictObject({
    pageKind: OcrPageKindSchema,
    pages: z.number().int().positive(),
    belongsToThisRun: z.boolean(),
  })),
  subjects: z.strictObject({
    complete: z.number().int().nonnegative(),
    duplicate: z.number().int().nonnegative(),
  }),
  unidentifiedPages: z.array(z.number().int().positive()),
});
export type StackReport = z.infer<typeof StackReportSchema>;

export function reportStack(stack: ClassifiedStack, formType: OcrFormType): StackReport {
  const grouping = groupStack(stack, formType);
  const wanted = new Set(expectedKinds(formType));
  const counts = new Map<OcrPageKind, number>();
  for (const page of stack.pages) counts.set(page.pageKind, (counts.get(page.pageKind) ?? 0) + 1);

  const accounted = grouping.subjects.reduce((total, subject) => total + subject.pages.length, 0)
    + grouping.unidentified.length + grouping.otherForms.length + grouping.dataless.length;

  return StackReportSchema.parse({
    formType,
    pagesClassified: stack.pages.length,
    pagesAccounted: accounted,
    byKind: [...counts]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([pageKind, pages]) => ({ pageKind, pages, belongsToThisRun: wanted.has(pageKind) })),
    subjects: {
      complete: grouping.subjects.filter((subject) => subject.completeness === "complete").length,
      duplicate: grouping.subjects.filter((subject) => subject.completeness === "duplicate").length,
    },
    unidentifiedPages: grouping.unidentified,
  });
}
