/**
 * Run-surface ingress: `InputParserSpec`, `UploadFieldSpec`, `FileAcceptSpec`,
 * and `TextTemplate` (ref workflow-model §1.1).
 *
 * These are **closed, serializable domain unions with exhaustive interpreters**.
 * They contain no workflow callback, no endpoint function, and no component
 * reference, which is what lets one declaration drive both the server's start
 * command and the client's panel: the same spec, two interpreters, no per
 * workflow-id switch and no side registry. A genuinely new run-surface behavior
 * extends the union and both interpreters.
 *
 * The parser deliberately does NOT produce a workflow input value. It produces
 * typed *entries*; the caller assembles a submission and parses it with the
 * workflow's own `input` schema (ref workflow-model §2). A parser that could mint a
 * validated input would be a second, unaudited ingress path.
 */
import { z } from "zod";
import { PositiveIntSchema } from "../../rules/identity/ids.js";

/** A field name as it appears in a workflow input schema. */
export const InputFieldNameSchema = z.string().regex(
  /^[a-z][A-Za-z0-9]*$/,
  "input field name must be a camelCase identifier",
);

/* ── text templates ──────────────────────────────────────────────────────── */

export const TextTemplateSegmentSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("literal"), text: z.string().min(1) }),
  z.strictObject({ kind: z.literal("field"), field: InputFieldNameSchema }),
  z.strictObject({
    kind: z.literal("count"),
    field: InputFieldNameSchema,
    singular: z.string().min(1),
    plural: z.string().min(1),
  }),
]);
export type TextTemplateSegment = z.infer<typeof TextTemplateSegmentSchema>;

export const TextTemplateSchema = z.strictObject({
  segments: z.array(TextTemplateSegmentSchema).min(1),
});
export type TextTemplate = z.infer<typeof TextTemplateSchema>;

/* ── the typed values both interpreters exchange ─────────────────────────── */

/**
 * One resolved surface value. A closed union rather than `JsonValue`: a run
 * surface collects text, flags, choices, and counts — nothing that needs an
 * open record, and an open record at this boundary is exactly how a stray
 * `__runtimeOptions` rode along in the legacy shape.
 */
export const SurfaceValueSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("text"), text: z.string() }),
  z.strictObject({ kind: z.literal("boolean"), value: z.boolean() }),
  z.strictObject({ kind: z.literal("count"), value: z.number().int().nonnegative() }),
]);
export type SurfaceValue = z.infer<typeof SurfaceValueSchema>;

export const SurfaceFieldSchema = z.strictObject({
  field: InputFieldNameSchema,
  value: SurfaceValueSchema,
});
export type SurfaceField = z.infer<typeof SurfaceFieldSchema>;

function surfaceValueText(value: SurfaceValue): string {
  switch (value.kind) {
    case "text": return value.text;
    case "boolean": return value.value ? "yes" : "no";
    case "count": return String(value.value);
  }
}

function findField(fields: readonly SurfaceField[], field: string, owner: string): SurfaceField {
  const found = fields.find((candidate) => candidate.field === field);
  if (found === undefined) {
    throw new Error(`${owner} references field "${field}", which the surface did not supply`);
  }
  return found;
}

/** Render a template against resolved fields. A missing field throws — it never renders blank. */
export function renderTextTemplate(
  template: TextTemplate,
  fields: readonly SurfaceField[],
  owner = "text template",
): string {
  return template.segments.map((segment) => {
    switch (segment.kind) {
      case "literal":
        return segment.text;
      case "field":
        return surfaceValueText(findField(fields, segment.field, owner).value);
      case "count": {
        const value = findField(fields, segment.field, owner).value;
        if (value.kind !== "count") {
          throw new Error(`${owner} count segment "${segment.field}" received a ${value.kind} value`);
        }
        return `${String(value.value)} ${value.value === 1 ? segment.singular : segment.plural}`;
      }
    }
  }).join("");
}

/* ── typed-text ingress ──────────────────────────────────────────────────── */

/**
 * The closed pattern vocabulary. A free regex would be a serialized callback —
 * unreviewable, and a ReDoS surface reachable from operator-typed text.
 */
export const ENTRY_PATTERNS = Object.freeze({
  eid: /^10\d{6}$/,
  digits: /^\d+$/,
  /**
   * A Kuali Build document number (D261). It is `KualiDocumentNumberSchema`'s
   * own rule restated as an ingress pattern — three to eight digits — and the
   * two are pinned equal by `tests/unit/ingress-parser-prose.test.ts`, because
   * a box that accepted a shape the workflow's schema then refused would be a
   * modal lying about what it starts.
   */
  "document-number": /^\d{3,8}$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  "non-empty": /\S/,
});
export const EntryPatternNameSchema = z.enum(["eid", "digits", "document-number", "email", "non-empty"]);
export type EntryPatternName = z.infer<typeof EntryPatternNameSchema>;

/**
 * The operator's words for each pattern — D250.
 *
 * It sits BESIDE `ENTRY_PATTERNS` on purpose. The run modal's typed box needs
 * to say what it accepts ("employee IDs, semicolon-separated — an employee ID
 * is eight digits beginning 10"), and the demo's oracle carries that as an
 * authored `parserLabel` string per method. An authored sentence can disagree
 * with the rule it describes, and a sentence that misstates what a box accepts
 * is a wrong value about what is being started; a legend keyed by the CLOSED
 * pattern enum cannot, because the words and the regex are declared together
 * and `ingress-parser-prose.test.ts` pins the two key sets equal.
 *
 * `shape` describes the regex one line above it, so a pattern whose regex moves
 * has its description in the same diff.
 */
const ENTRY_PATTERN_PROSE = Object.freeze({
  eid: { one: "an employee ID", many: "employee IDs", shape: "eight digits beginning 10" },
  digits: { one: "a number", many: "numbers", shape: "digits only" },
  "document-number": {
    one: "a Kuali document number",
    many: "Kuali document numbers",
    shape: "three to eight digits, the number printed at the top of the separation request",
  },
  email: { one: "an email address", many: "email addresses", shape: "text either side of one @, with a dot after it" },
  "non-empty": { one: "a value", many: "values", shape: "any text that is not blank" },
} satisfies Readonly<Record<EntryPatternName, Readonly<{ one: string; many: string; shape: string }>>>);

/** The pattern legend, exposed so a guard can pin it against `ENTRY_PATTERNS`. */
export const ENTRY_PATTERN_NOUNS: Readonly<
  Record<EntryPatternName, Readonly<{ one: string; many: string; shape: string }>>
> = ENTRY_PATTERN_PROSE;

/** "a", "a or b", "a, b or c" — the one list-joining rule this module's prose uses. */
function listPhrase(items: readonly string[]): string {
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

export const EntryRuleSchema = z.strictObject({
  when: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("pattern"), pattern: EntryPatternNameSchema }),
    z.strictObject({ kind: z.literal("otherwise") }),
  ]),
  /** The input field this entry's text becomes. */
  emit: InputFieldNameSchema,
});
export type EntryRule = z.infer<typeof EntryRuleSchema>;

export const InputParserSpecSchema = z.strictObject({
  split: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("delimited"),
      delimiters: z.array(z.string().min(1)).min(1),
    }),
    z.strictObject({ kind: z.literal("whole-text") }),
  ]),
  /** First matching rule wins; an entry matching none is a loud parse failure. */
  rules: z.array(EntryRuleSchema).min(1),
  /** Fields the panel contributes to every entry (operator flags, never text). */
  constants: z.array(SurfaceFieldSchema).optional(),
});
export type InputParserSpec = z.infer<typeof InputParserSpecSchema>;

export const ParsedInputEntrySchema = z.strictObject({
  index: z.number().int().nonnegative(),
  sourceText: z.string().min(1),
  fields: z.array(SurfaceFieldSchema).min(1),
});
export type ParsedInputEntry = z.infer<typeof ParsedInputEntrySchema>;

function splitEntries(spec: InputParserSpec, text: string): readonly string[] {
  if (spec.split.kind === "whole-text") {
    const whole = text.trim();
    return whole.length === 0 ? [] : [whole];
  }
  let parts: readonly string[] = [text];
  for (const delimiter of spec.split.delimiters) {
    parts = parts.flatMap((part) => part.split(delimiter));
  }
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function matchRule(spec: InputParserSpec, entry: string): EntryRule | undefined {
  return spec.rules.find((rule) => rule.when.kind === "otherwise"
    || ENTRY_PATTERNS[rule.when.pattern].test(entry));
}

/**
 * Interpret operator-typed text into one entry per intended run.
 *
 * Fails loud on empty text and on an entry no rule claims: a silently dropped
 * entry is an EID the operator believes is queued and that never runs.
 */
export function parseInputRunText(
  spec: InputParserSpec,
  text: string,
): readonly ParsedInputEntry[] {
  const entries = splitEntries(spec, text);
  if (entries.length === 0) {
    throw new Error("input-run text contained no entries to run");
  }
  const constants = spec.constants ?? [];
  return Object.freeze(entries.map((sourceText, index) => {
    const rule = matchRule(spec, sourceText);
    if (rule === undefined) {
      throw new Error(`input-run entry ${String(index)} ("${sourceText}") matched no parser rule`);
    }
    const fields = [
      { field: rule.emit, value: { kind: "text", text: sourceText } },
      ...constants.filter((constant) => constant.field !== rule.emit),
    ];
    return ParsedInputEntrySchema.parse({ index, sourceText, fields });
  }));
}

/** Assemble one entry into a raw submission. The CALLER parses it with `descriptor.input`. */
export function toRawSubmission(entry: ParsedInputEntry): unknown {
  const submission: { [key: string]: string | boolean | number } = {};
  for (const { field, value } of entry.fields) {
    switch (value.kind) {
      case "text": submission[field] = value.text; break;
      case "boolean": submission[field] = value.value; break;
      case "count": submission[field] = value.value; break;
    }
  }
  return submission;
}

/* ── the parser, described to the operator (D250) ────────────────────────── */

/**
 * What this box accepts, as a plural noun phrase — the demo's `START_VALUE_NOUN`
 * half of its Field label, derived rather than authored.
 *
 * A spec whose only rule is `otherwise` claims nothing about its values, so it
 * gets "entries": the honest word for "whatever you type, one per entry". It is
 * not a fabricated constant — it is the absence of a pattern claim, stated.
 */
export function inputRunValueNoun(spec: InputParserSpec): string {
  const nouns = [...new Set(spec.rules.flatMap((rule) =>
    rule.when.kind === "pattern" ? [ENTRY_PATTERN_PROSE[rule.when.pattern].many] : []))];
  return nouns.length === 0 ? "entries" : listPhrase(nouns);
}

/** How the box is split, in words — the other half of the Field's label. */
export function inputRunSeparatorLabel(spec: InputParserSpec): string {
  if (spec.split.kind === "whole-text") return "the whole box is one entry";
  const shown = spec.split.delimiters.map((delimiter) => (delimiter === "\n" ? "a new line" : `“${delimiter}”`));
  return `separated by ${listPhrase(shown)}`;
}

/**
 * The rules, stated. This is the demo's `parserLabel`, derived from the ordered
 * rule list instead of authored per workflow.
 *
 * The last clause is load-bearing and is the reason this is worth deriving at
 * all: a spec with NO `otherwise` rule refuses the whole text when one entry
 * matches nothing (`parseInputRunText` throws by design), and an operator who
 * was never told that reads the refusal as a bug. A spec WITH one takes
 * anything, which is equally worth saying before they paste forty lines.
 *
 * Field names never appear: `rule.emit` is an input-schema identifier, and the
 * factory already binds it (`assertSurfaceFields`). The operator is choosing
 * what to type, not which field it lands in.
 */
export function inputRunParserLabel(spec: InputParserSpec): string {
  const shapes = [...new Set(spec.rules.flatMap((rule) => rule.when.kind === "pattern"
    ? [`${ENTRY_PATTERN_PROSE[rule.when.pattern].one} is ${ENTRY_PATTERN_PROSE[rule.when.pattern].shape}`]
    : []))];
  const fallback = spec.rules.some((rule) => rule.when.kind === "otherwise")
    ? "anything else is taken exactly as typed"
    : "an entry matching none of these refuses the whole box, and nothing is started";
  const sentence = [...shapes, fallback].join("; ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

/* ── upload ingress ──────────────────────────────────────────────────────── */

export const UploadFieldSpecSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("text"),
    field: InputFieldNameSchema,
    label: z.string().min(1),
    required: z.boolean(),
    placeholder: z.string().optional(),
  }),
  z.strictObject({
    kind: z.literal("boolean"),
    field: InputFieldNameSchema,
    label: z.string().min(1),
    initial: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal("select"),
    field: InputFieldNameSchema,
    label: z.string().min(1),
    required: z.boolean(),
    options: z.array(z.strictObject({
      value: z.string().min(1),
      label: z.string().min(1),
    })).min(1),
  }),
]);
export type UploadFieldSpec = z.infer<typeof UploadFieldSpecSchema>;

export const FileAcceptSpecSchema = z.strictObject({
  mediaType: z.enum(["application/pdf", "image/png", "image/jpeg", "text/csv"]),
  extensions: z.array(z.string().regex(/^\.[a-z0-9]+$/, "extension must be a lowercase dotted suffix")).min(1),
  maxBytes: PositiveIntSchema,
});
export type FileAcceptSpec = z.infer<typeof FileAcceptSpecSchema>;

export const UploadedFileSchema = z.strictObject({
  fileName: z.string().min(1),
  mediaType: z.string().min(1),
  byteLength: z.number().int().nonnegative(),
});
export type UploadedFile = z.infer<typeof UploadedFileSchema>;

/**
 * Interpret submitted upload-panel values. Unknown fields, missing required
 * values, and out-of-vocabulary select values all throw: an upload panel that
 * silently dropped a field would start a run against data the operator never
 * confirmed.
 */
export function resolveUploadFields(
  specs: readonly UploadFieldSpec[],
  submitted: readonly SurfaceField[],
): readonly SurfaceField[] {
  const declared = new Set(specs.map((spec) => spec.field));
  for (const value of submitted) {
    if (!declared.has(value.field)) {
      throw new Error(`upload surface received undeclared field "${value.field}"`);
    }
  }
  if (new Set(submitted.map((value) => value.field)).size !== submitted.length) {
    throw new Error("upload surface received the same field twice");
  }
  return Object.freeze(specs.map((spec) => {
    const supplied = submitted.find((value) => value.field === spec.field);
    switch (spec.kind) {
      case "boolean": {
        if (supplied === undefined) {
          return SurfaceFieldSchema.parse({ field: spec.field, value: { kind: "boolean", value: spec.initial } });
        }
        if (supplied.value.kind !== "boolean") {
          throw new Error(`upload field "${spec.field}" expects a boolean, received ${supplied.value.kind}`);
        }
        return supplied;
      }
      case "text": {
        if (supplied === undefined || supplied.value.kind !== "text" || supplied.value.text.trim().length === 0) {
          if (spec.required) throw new Error(`upload field "${spec.field}" is required`);
          return SurfaceFieldSchema.parse({ field: spec.field, value: { kind: "text", text: "" } });
        }
        return supplied;
      }
      case "select": {
        if (supplied === undefined || supplied.value.kind !== "text") {
          if (spec.required) throw new Error(`upload field "${spec.field}" is required`);
          return SurfaceFieldSchema.parse({ field: spec.field, value: { kind: "text", text: "" } });
        }
        const chosen = supplied.value.text;
        if (!spec.options.some((option) => option.value === chosen)) {
          throw new Error(`upload field "${spec.field}" received out-of-vocabulary value "${chosen}"`);
        }
        return supplied;
      }
    }
  }));
}

/** A file the accept list does not cover is refused, never coerced to a default type. */
export function assertFileAccepted(accepts: readonly FileAcceptSpec[], file: UploadedFile): void {
  const suffix = file.fileName.toLowerCase().slice(file.fileName.lastIndexOf("."));
  const match = accepts.find((accept) => accept.mediaType === file.mediaType
    && accept.extensions.includes(suffix));
  if (match === undefined) {
    throw new Error(`upload "${file.fileName}" (${file.mediaType}) is not an accepted file for this surface`);
  }
  if (file.byteLength > match.maxBytes) {
    throw new Error(
      `upload "${file.fileName}" is ${String(file.byteLength)} bytes, over the ${String(match.maxBytes)}-byte limit`,
    );
  }
}

/* ── the descriptor's `surfaces` container ───────────────────────────────── */

/**
 * One example the run modal offers as a button that TYPES FOR THE OPERATOR
 * (D250). It carries the exact `text` the box receives — never a value list the
 * surface re-joins with a delimiter, because reconstructing the separator on the
 * client re-implements `splitEntries` outside the boundary that owns it, and a
 * client that split differently would fill the box with something the server
 * never receives (R8 finding 17's argument, from the writing side).
 *
 * `note` is the button's `title`: what this example demonstrates, so an operator
 * can tell "two ordinary values" from "one that gets refused" before clicking.
 */
export const InputRunExampleSchema = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9-]*$/),
  label: z.string().min(1),
  text: z.string().min(1),
  note: z.string().min(1),
});
export type InputRunExample = z.infer<typeof InputRunExampleSchema>;

export const InputRunSurfaceSchema = z.strictObject({
  placeholder: z.string().min(1),
  parser: InputParserSpecSchema,
  /**
   * D250 — declared, and PROVED typeable by `defineWorkflowDescriptor`: every
   * example's text must parse under this surface's own parser AND every entry it
   * yields must satisfy the workflow's own input schema. An example that does
   * not is a button that fills the box with a refusal, which teaches the
   * operator the modal is lying about what it accepts.
   *
   * Optional: a workflow with nothing worth demonstrating declares none and the
   * row simply does not render — never a fabricated sample identifier.
   */
  examples: z.array(InputRunExampleSchema).min(1).optional(),
  /**
   * **DERIVED, never authored (D209).** `defineWorkflowDescriptor` stamps this
   * from the graph — every transaction node declaring `dryRun:"stop-after-prepare"`
   * — and REFUSES a descriptor that declares it, because whether a workflow can
   * be previewed is a property of what it writes, not of how an operator types
   * into it. It stays on this surface because the run-start surface composes
   * `surfaces.inputRun` client-side off the bundled descriptor and reads the flag
   * there; the value that reader sees is now the graph's answer.
   */
  supportsDryRun: z.boolean().optional(),
  emptyOpensUpload: z.boolean().optional(),
});
export type InputRunSurface = z.infer<typeof InputRunSurfaceSchema>;

export const UploadRunSurfaceSchema = z.strictObject({
  title: TextTemplateSchema,
  fields: z.array(UploadFieldSpecSchema),
  accepts: z.array(FileAcceptSpecSchema).min(1),
  successMessage: TextTemplateSchema,
});
export type UploadRunSurface = z.infer<typeof UploadRunSurfaceSchema>;

export const WorkflowSurfacesSchema = z.strictObject({
  inputRun: InputRunSurfaceSchema.optional(),
  uploadRun: UploadRunSurfaceSchema.optional(),
});
export type WorkflowSurfaces = z.infer<typeof WorkflowSurfacesSchema>;
