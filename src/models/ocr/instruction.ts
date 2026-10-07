/**
 * The extraction instruction, GENERATED from the form registry.
 *
 * This is the other half of "the same result no matter who does it". The
 * admission gate makes every producer's output conform; this makes every
 * producer's INPUT identical. A model reached through a provider adapter, an
 * agent the operator runs in their terminal, and the operator reading the page
 * themselves are all given the same field list, the same per-field prompt, the
 * same closed absence vocabulary, and the same answer shape — because all of it
 * is derived from `OCR_FORMS` rather than written out beside it.
 *
 * A hand-maintained prompt is the failure this avoids. Add a field to the
 * registry and every route asks for it on its next run; forget to update a
 * prompt that lives in a string constant and one route silently stops looking,
 * which is precisely the skipping the operator asked to make impossible.
 *
 * The instruction is plain text on purpose. It has to be equally usable as a
 * provider system prompt, as something pasted into another terminal agent, and
 * as something a person reads.
 */
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { CANONICAL_FIELDS } from "../fields/registry.js";
import { OcrPageKindSchema, fieldOnPageKind, ocrForm, type OcrFormType } from "./form-registry.js";

function expectationFor(spec: ReturnType<typeof ocrForm>["fields"][number]): string {
  if (spec.canonicalFieldId === null) {
    return spec.localKind === "boolean" ? "yes or no" : "text exactly as written";
  }
  const field = CANONICAL_FIELDS[spec.canonicalFieldId];
  return `${field.label} — e.g. ${field.examples.map((example) => JSON.stringify(example)).join(" or ")}`;
}

/**
 * The whole instruction for one form type.
 *
 * `sourceSha256` and `sourcePage` are named in the skeleton rather than left to
 * the producer's memory, because an extraction that cannot say which page it
 * came from cannot be checked against another producer's reading of it.
 */
export function buildExtractionInstruction(formType: OcrFormType): string {
  const form = ocrForm(formType);
  const expectedKinds = form.pageKinds.map((kind) => `\`${kind}\``).join(" / ");
  const lines: string[] = [
    `# Extract: ${form.title}`,
    "",
    form.description,
    "",
    "## Rules",
    "",
    "0. CLASSIFY the page first, as `pageKind`. A scanned stack is loose paper,",
    "   so name what you actually see:",
    ...OcrPageKindSchema.options.map((kind) => `   - \`${kind}\``),
    "   `boilerplate` is a printed page of a real form that carries no data —",
    "   the I-9 instructions and Lists of Acceptable Documents are seven of every",
    "   nine pages in a packet. `unrelated` is a document that is not one of",
    "   these forms at all. `blank` is an empty scan or a separator. If this page",
    "   is not",
    `   ${expectedKinds}, report the kind you saw and set \`record\` to`,
    "   `null` — that is a correct answer, not a failure. Never invent fields for",
    "   a form the page is not.",
    "1. This form holds ONE person per page. Send that person as `record`,",
    "   or `null` when the page is not this form.",
    "2. Answer EVERY field listed below, for every record. There are no optional fields.",
    "3. If you cannot give a value, say which kind of nothing you saw:",
    "   - `not-on-form` — this form has no such box at all.",
    "   - `blank` — the box exists and is empty.",
    "   - `illegible` — the box has something in it that you cannot read.",
    "   These are not interchangeable. Only `illegible` tells a human that a",
    "   better scan or a second look would help.",
    "4. Report `raw` EXACTLY as it appears on the page. Do not tidy, expand,",
    "   reformat or correct it — validation happens after you, against the same",
    "   schema every other route uses, and it needs to see what you saw.",
    "5. Never infer a value from another field, from a different row, or from",
    "   what would be plausible. A guess that looks right is the one failure",
    "   this process exists to prevent.",
    "6. `confidence` is your own 0–1 opinion of your reading. It gates nothing;",
    "   report it honestly rather than defensively.",
  ];

  if (form.pageKinds.length > 1) {
    lines.push(
      `7. This form's data pages come in SECTIONS: a page is exactly one of ${expectedKinds}.`,
      "   Classify which section the page is, then read it. A field marked as living",
      "   on another section has no box on this page — answer it `not-on-form`, and",
      "   never carry a value over from a different page.",
    );
  }

  lines.push("", "## Fields", "");

  if (form.extractionNotes.length > 0) {
    lines.splice(lines.length - 2, 0, "## What this form gets wrong", "");
    for (const note of form.extractionNotes) lines.splice(lines.length - 2, 0, `- ${note}`);
    lines.splice(lines.length - 2, 0, "");
  }

  for (const spec of form.fields) {
    lines.push(`- \`${spec.path}\`${spec.mandatory ? " (mandatory)" : ""} — ${spec.prompt}`);
    lines.push(`  Expected: ${expectationFor(spec)}`);
    if (spec.onPageKinds !== null) {
      const on = spec.onPageKinds.map((kind) => `\`${kind}\``).join(" / ");
      lines.push(`  Only on ${on} pages — on any other page of this form, answer \`not-on-form\`.`);
    }
  }

  lines.push(
    "",
    "## Answer with exactly this shape",
    "",
    "```json",
    canonicalJsonStringify(buildAnswerSkeleton(formType)),
    "```",
    "",
    "Every key above must be present. An extra key, a missing key, or an answer",
    "that is neither `read` nor `absent` is refused by the same gate for every",
    "route — including a value you were confident about.",
  );
  return lines.join("\n");
}

/**
 * A filled-in-shape example the producer copies. Deliberately shows one of each
 * answer arm so neither looks like the exceptional case. The example page is
 * the form's FIRST data kind, and the skeleton is consistent with that
 * classification: a field living on another section is shown as `not-on-form`,
 * exactly as the gate will demand.
 */
export function buildAnswerSkeleton(formType: OcrFormType): unknown {
  const form = ocrForm(formType);
  const exampleKind = form.pageKinds[0];
  const onKind = form.fields.filter((spec) => fieldOnPageKind(spec, exampleKind));
  const blankExample = onKind[onKind.length - 1];
  // An index-signature literal rather than an open `Record`: this is a JSON
  // object under construction, not a decision-bearing map crossing a boundary.
  const answers: { [path: string]: unknown } = {};
  for (const spec of form.fields) {
    answers[spec.path] = !fieldOnPageKind(spec, exampleKind)
      ? { state: "absent", reason: "not-on-form" }
      : spec === blankExample
        ? { state: "absent", reason: "blank" }
        : { state: "read", raw: "<exactly as written>", confidence: 0.95 };
  }
  return {
    formType,
    source: { kind: "local-agent", agentId: "<your tool id>", invocation: "<the command you ran>" },
    readAt: "<ISO-8601 instant with offset>",
    sourceSha256: "<sha256 of the page image or PDF you read>",
    sourcePage: 1,
    pageKind: exampleKind,
    record: { answers },
  };
}

/** The answer keys one record must carry — what the completeness rule checks. */
export function skeletonAnswerPaths(formType: OcrFormType): readonly string[] {
  return ocrForm(formType).fields.map((spec) => spec.path);
}
