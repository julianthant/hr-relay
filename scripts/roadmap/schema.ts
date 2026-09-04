import { z } from "zod";

/**
 * The roadmap's shape — the ONE schema `scripts/generate-roadmap.ts` validates
 * `parsePlan`'s output against, split out so a guard can import it without
 * dragging the generator's filesystem entry point along. This module is pure:
 * no I/O, no `process`, no top-level side effect beyond building the schemas.
 *
 * `scripts/roadmap/parse-plan.ts` produces the values; this file says what a
 * valid one looks like. Notation → shape is documented in `parse-plan.ts`.
 */

export const StatusSchema = z.enum(["done", "active", "you", "planned", "proposed", "never"]);
export type Status = z.infer<typeof StatusSchema>;

export const ChipSchema = z.object({ text: z.string().min(1), tone: StatusSchema.optional() }).strict();
export type Chip = z.infer<typeof ChipSchema>;

export const RequirementSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("node"), ref: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("you"), text: z.string().min(1), met: z.boolean() }).strict(),
  z.object({ kind: z.literal("fact"), text: z.string().min(1), met: z.boolean() }).strict(),
]);
export type Requirement = z.infer<typeof RequirementSchema>;

export const LayerSchema = z.enum(["frontend", "backend", "both", "wiring", "docs", "proof"]);
export type Layer = z.infer<typeof LayerSchema>;

/** `YYYY-MM-DD`. Calendar validity is checked by the parser, which owns the line number. */
export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * A node's binding to the plan SSOT: which doc section owns the contract this
 * node builds. Two kinds, because the shelf has two halves — a `phase` ref
 * names an actionable `docs/rebuild/NN-*.md` by its phase number (`03.1`), a
 * `reference` ref names an unnumbered spec under `docs/rebuild/reference/` by
 * slug and carries the `ref:` prefix in `doc` (`ref:write-safety`). `section`
 * is the part after `§` (dotted numbers, a range, or a heading NAME — the
 * phase docs number no headings), `raw` the ref exactly as the notation wrote
 * it. Whether the named file and section EXIST is the `roadmap-doc-binding`
 * guard's question; this schema only pins the shape.
 */
export const DocRefSchema = z
  .object({
    doc: z.string().regex(/^(?:0[0-2]|03\.[1-4]|0[456]|ref:[a-z][a-z0-9-]*)$/),
    kind: z.enum(["phase", "reference"]),
    section: z.string().min(1).optional(),
    raw: z.string().min(1),
  })
  .strict()
  .refine((ref) => ref.kind === (ref.doc.startsWith("ref:") ? "reference" : "phase"), {
    message: "kind must agree with doc: a ref:<slug> doc is a reference, a phase number is a phase",
  });
export type DocRef = z.infer<typeof DocRefSchema>;

/** One session's work on one node: what landed, by whom, when. Rendered newest-first. */
export const LogEntrySchema = z
  .object({ date: IsoDateSchema, session: z.string().min(1), text: z.string().min(1) })
  .strict();
export type LogEntry = z.infer<typeof LogEntrySchema>;

/**
 * A feature is what a node BUILDS. The layer says WHERE it lives so a gap on a
 * surface can be read as "not built yet" versus "built, and sloppy": `frontend`
 * is React only, `backend` is the BFF/kernel only, `both` is a vertical slice,
 * `wiring` is the connection between two halves that already exist. `docs` and
 * `proof` (a live run, a measurement) are the non-code kinds. A feature's own
 * status defaults to its node's, so a node can be active while three of its
 * five features are already done.
 */
export const FeatureSchema = z.union([
  z.string().min(1),
  z.object({ text: z.string().min(1), layer: LayerSchema, status: StatusSchema.optional() }).strict(),
]);
export type Feature = z.infer<typeof FeatureSchema>;

export const TableSchema = z
  .object({
    columns: z.array(z.string().min(1)).min(1),
    rows: z.array(
      z.object({ cells: z.array(z.string()).min(1), tone: z.enum(["you", "done"]).optional() }).strict(),
    ),
  })
  .strict();
export type Table = z.infer<typeof TableSchema>;

export interface Item {
  id?: string;
  status: Status;
  title: string;
  date?: string;
  chip?: Chip;
  size?: "S" | "M" | "L" | "XL";
  docs?: DocRef[];
  desc?: string;
  features?: Feature[];
  requires?: Requirement[];
  table?: Table;
  notes?: string[];
  log?: LogEntry[];
  items?: Item[];
}

export const ItemSchema: z.ZodType<Item> = z.lazy(() =>
  z
    .object({
      id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
      status: StatusSchema,
      title: z.string().min(1),
      date: z.string().optional(),
      chip: ChipSchema.optional(),
      size: z.enum(["S", "M", "L", "XL"]).optional(),
      docs: z.array(DocRefSchema).min(1).optional(),
      desc: z.string().optional(),
      features: z.array(FeatureSchema).optional(),
      requires: z.array(RequirementSchema).optional(),
      table: TableSchema.optional(),
      notes: z.array(z.string().min(1)).optional(),
      log: z.array(LogEntrySchema).min(1).optional(),
      items: z.array(ItemSchema).optional(),
    })
    .strict(),
);

export const WhenSchema = z.object({ primary: z.string().min(1), secondary: z.string().optional() }).strict();

export const PhaseNodeSchema = z
  .object({
    kind: z.literal("phase"),
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    status: StatusSchema,
    when: WhenSchema,
    phase: z.string().min(1),
    title: z.string().min(1),
    chip: ChipSchema.optional(),
    size: z.enum(["S", "M", "L", "XL"]).optional(),
    docs: z.array(DocRefSchema).min(1).optional(),
    summary: z.string().min(1),
    open: z.boolean(),
    features: z.array(FeatureSchema).optional(),
    requires: z.array(RequirementSchema).optional(),
    items: z.array(ItemSchema),
    notes: z.array(z.string().min(1)).optional(),
    log: z.array(LogEntrySchema).min(1).optional(),
  })
  .strict();
export type PhaseNode = z.infer<typeof PhaseNodeSchema>;

export const FlagNodeSchema = z
  .object({ kind: z.literal("flag"), status: StatusSchema, when: z.string().min(1), text: z.string().min(1) })
  .strict();
export type FlagNode = z.infer<typeof FlagNodeSchema>;

export const TodayNodeSchema = z.object({ kind: z.literal("today"), text: z.string().min(1) }).strict();
export type TodayNode = z.infer<typeof TodayNodeSchema>;

export const SpineEntrySchema = z.discriminatedUnion("kind", [
  PhaseNodeSchema,
  FlagNodeSchema,
  TodayNodeSchema,
]);
export type SpineEntry = z.infer<typeof SpineEntrySchema>;

// ─── the doc side of the binding (D263 / plan R7) ──────────────────────────

/** A plan node's stable anchor — the `{#id}` the notation declares. */
export const NodeIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);

/** A repo-relative markdown path with forward slashes, e.g. `docs/rebuild/03.1-…md`. */
export const DocPathSchema = z.string().regex(/^docs\/[A-Za-z0-9._/-]+\.md$/);

/**
 * The doc section a tag or a status block sits under: the nearest heading above
 * it, split into its number (when the heading starts with one) and the rest of
 * its text. `## 3.1 The wire boundary` → `{ section: "3.1", text: "The wire
 * boundary" }`; an unnumbered heading carries `text` alone.
 */
export const DocHeadingSchema = z.object({ text: z.string().min(1), section: z.string().min(1).optional() }).strict();
export type DocHeading = z.infer<typeof DocHeadingSchema>;

/** `<!-- roadmap: <id> -->` — "the section above describes this node". */
export const DocTagSchema = z
  .object({ id: NodeIdSchema, doc: DocPathSchema, heading: DocHeadingSchema, line: z.number().int().positive() })
  .strict();
export type DocTag = z.infer<typeof DocTagSchema>;

/** One `- [x| |~|?|-|!] text` line: the doc's own checklist item, with NO layer tag. */
export const DocStatusItemSchema = z.object({ box: StatusSchema, text: z.string().min(1) }).strict();
export type DocStatusItem = z.infer<typeof DocStatusItemSchema>;

/**
 * One `<!-- roadmap-status: <id> -->` … `<!-- /roadmap-status -->` block. Its
 * notes are `LogEntry`s — a doc note and a `log:` line record the same three
 * facts (day, session, what happened), so they are the same shape on purpose.
 * `items` and `notes` may both be empty: an empty block is a section that has
 * not been assessed yet, which is a fact worth stating.
 */
export const DocStatusBlockSchema = z
  .object({
    id: NodeIdSchema,
    doc: DocPathSchema,
    heading: DocHeadingSchema,
    line: z.number().int().positive(),
    items: z.array(DocStatusItemSchema),
    notes: z.array(LogEntrySchema),
  })
  .strict();
export type DocStatusBlock = z.infer<typeof DocStatusBlockSchema>;

/** Everything one scan found, flat and in sorted path order. */
export const DocBindingsSchema = z
  .object({ tags: z.array(DocTagSchema), statuses: z.array(DocStatusBlockSchema) })
  .strict();
export type DocBindings = z.infer<typeof DocBindingsSchema>;

export const RoadmapSchema = z
  .object({
    meta: z
      .object({
        title: z.string().min(1),
        asOf: IsoDateSchema,
        head: z.string().min(1),
        eyebrow: z.string().min(1),
        lede: z.string().min(1),
        sources: z.array(z.string().min(1)).min(1),
        footer: z.string().min(1),
      })
      .strict(),
    tiles: z.array(
      z.object({ label: z.string().min(1), value: z.string().min(1), sub: z.string().optional(), hot: z.boolean() }).strict(),
    ),
    spine: z.array(SpineEntrySchema),
  })
  .strict();
export type Roadmap = z.infer<typeof RoadmapSchema>;
