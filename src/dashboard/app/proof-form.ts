/**
 * Compose a ref write-safety §4.1 confirmed-present PROOF from the field list the server
 * described (D245), and refuse — by field, by name — everything the description
 * says is wrong.
 *
 * ## Why this is a pure module beside `command-dispatch.ts`
 *
 * It is the same job that file does for every other verb — turn a SERVED
 * descriptor plus what the operator answered into a legal command payload, or
 * a named refusal — and it sits here rather than in `src/domain/` because
 * composing a proof is client work: the server DESCRIBES the schema, the
 * kernel PARSES the result, and neither needs this. Two callers need the same
 * verdict and must never disagree: the parked-write dialog, which blocks its
 * own verb and puts a sentence beside the box the operator has to fix, and the
 * tests that pin what a real contract's proof form accepts without rendering
 * React. A second implementation inside the dialog would be a client
 * deciding what a real HR record may say.
 *
 * ## What this validation IS, and what it is not
 *
 * It is an EARLY refusal over the constraints a wire can carry: the field's
 * presence, its shape, its bounds, its pattern, its option list. It is not the
 * verdict. `resolvePresent` parses the composed value through the commit
 * contract's own `completion.proofSchema` and refuses `schema-mismatch` when it
 * does not fit — that is the authority, and a field flagged `serverOnlyRules`
 * (a `.refine()` no wire can transport) is checked ONLY there. So a green form
 * is a claim that nothing obviously wrong was typed, never a claim that the
 * kernel will accept it, and the surface says so in those terms.
 */
import type { JsonValue } from "../../domain/canonical-json.js";
import type { ProofFieldWire } from "../../domain/dashboard/run-detail.js";

/** Every operator-supplied leaf, keyed by the field's dot path, as typed. */
export type ProofDrafts = Readonly<Record<string, string>>;

export interface ProofFieldProblem {
  readonly path: string;
  readonly message: string;
}

export type ComposedProof =
  | { readonly state: "composed"; readonly value: JsonValue }
  | { readonly state: "invalid"; readonly problems: readonly ProofFieldProblem[] };

/** `fixed` leaves are the schema's, not the operator's — they get no box. */
export function isOperatorSuppliedProofField(field: ProofFieldWire): boolean {
  return field.kind !== "fixed";
}

/**
 * A blank draft per operator-supplied field. Deliberately blank, never
 * pre-filled from the run: the run holds what it TRIED to write, and offering
 * that back as the proof would turn an attestation about a live HR system into
 * a click-through of the system's own guess (ref write-safety §14.6's rubber-stamping
 * shape, one control over).
 */
export function initialProofDrafts(fields: readonly ProofFieldWire[]): Record<string, string> {
  const drafts: Record<string, string> = {};
  for (const field of fields) {
    if (isOperatorSuppliedProofField(field)) drafts[field.path] = "";
  }
  return drafts;
}

/** The two spellings a boolean field accepts, in the order they are offered. */
export const PROOF_BOOLEAN_OPTIONS: readonly string[] = Object.freeze(["true", "false"]);

/**
 * What is wrong with ONE draft, or `undefined` when nothing this description
 * can see is. Never a verdict on the whole proof — see the module header.
 */
export function proofFieldProblem(field: ProofFieldWire, draft: string): string | undefined {
  if (field.kind === "fixed") return undefined;
  const value = draft.trim();
  if (value.length === 0) {
    return "This is part of the proof; an empty value is not something you saw.";
  }
  switch (field.kind) {
    case "text": {
      if (field.minLength !== undefined && value.length < field.minLength) {
        return `At least ${String(field.minLength)} character(s); this one has ${String(value.length)}.`;
      }
      if (field.maxLength !== undefined && value.length > field.maxLength) {
        return `At most ${String(field.maxLength)} character(s); this one has ${String(value.length)}.`;
      }
      if (field.pattern !== undefined && !new RegExp(field.pattern, "u").test(value)) {
        return field.format === "iso-datetime"
          ? "This must be an ISO-8601 instant with an offset, e.g. 2026-08-20T09:15:00.000Z."
          : `This must match the contract's own pattern ${field.pattern}.`;
      }
      return undefined;
    }
    case "choice":
      return field.options.includes(value)
        ? undefined
        : `The contract admits only: ${field.options.join(", ")}.`;
    case "integer": {
      if (!/^-?\d+$/u.test(value)) return "This must be a whole number.";
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed)) return "This is outside the range of a whole number.";
      if (field.minimum !== undefined && parsed < field.minimum) {
        return `At least ${String(field.minimum)}.`;
      }
      if (field.maximum !== undefined && parsed > field.maximum) {
        return `At most ${String(field.maximum)}.`;
      }
      return undefined;
    }
    case "boolean":
      return PROOF_BOOLEAN_OPTIONS.includes(value) ? undefined : "Answer true or false.";
  }
}

function parseDraft(field: ProofFieldWire, draft: string): JsonValue {
  const value = draft.trim();
  switch (field.kind) {
    case "fixed":
      return field.value;
    case "integer":
      return Number(value);
    case "boolean":
      return value === "true";
    case "text":
    case "choice":
      return value;
  }
}

/**
 * Write one leaf at its dot path, minting the intermediate objects the path
 * names. It throws rather than overwriting when a prefix is already a scalar:
 * a description that says both `fields` and `fields.x` is a described shape
 * that cannot exist, and quietly picking one would compose a proof neither the
 * schema nor the operator asked for.
 */
function assignAtPath(root: Record<string, JsonValue>, path: string, value: JsonValue): void {
  const segments = path.split(".");
  const leaf = segments.pop();
  if (leaf === undefined) throw new Error(`proof field path "${path}" names no leaf`);
  let cursor = root;
  const walked: string[] = [];
  for (const segment of segments) {
    walked.push(segment);
    const existing = cursor[segment];
    if (existing === undefined) {
      const created: Record<string, JsonValue> = {};
      cursor[segment] = created;
      cursor = created;
      continue;
    }
    if (typeof existing !== "object" || existing === null || Array.isArray(existing)) {
      throw new Error(
        `proof field "${path}" needs "${walked.join(".")}" to be an object, and another field made it a value`,
      );
    }
    cursor = existing as Record<string, JsonValue>;
  }
  if (cursor[leaf] !== undefined) {
    throw new Error(`proof field path "${path}" is described twice`);
  }
  cursor[leaf] = value;
}

/**
 * The whole proof value, or every problem at once.
 *
 * Every problem, rather than the first: the operator is transcribing what they
 * read off a live HR page, and telling them about one bad field at a time turns
 * one look at the screen into four.
 */
export function composeProofValue(
  fields: readonly ProofFieldWire[],
  drafts: ProofDrafts,
): ComposedProof {
  const problems: ProofFieldProblem[] = [];
  for (const field of fields) {
    if (!isOperatorSuppliedProofField(field)) continue;
    const problem = proofFieldProblem(field, drafts[field.path] ?? "");
    if (problem !== undefined) problems.push({ path: field.path, message: problem });
  }
  if (problems.length > 0) return { state: "invalid", problems };
  const value: Record<string, JsonValue> = {};
  for (const field of fields) {
    assignAtPath(value, field.path, parseDraft(field, drafts[field.path] ?? ""));
  }
  return { state: "composed", value };
}

/**
 * The field's ACCESSIBLE NAME, derived from the dot path the schema gave it.
 *
 * It lives here rather than in the dialog for the reason D126 and D187 both
 * found the hard way: an accessible name is a load-bearing operator-facing
 * string, and one that exists only inside JSX is pinned by nothing in a tree
 * that renders no React in the unit lane.
 *
 * The path is the label, humanised and nothing more — no dictionary of
 * friendlier words. A proof leaf is named by the contract author, and a second
 * naming layer here would let the form call a field something the contract,
 * the receipt and the ledger all call something else.
 */
export function proofFieldLabel(field: ProofFieldWire): string {
  const words = (segment: string): string =>
    segment.replace(/([a-z0-9])([A-Z])/gu, "$1 $2").toLowerCase();
  const segments = field.path.split(".").map(words);
  const [first, ...rest] = segments;
  if (first === undefined) return field.path;
  const head = `${first.slice(0, 1).toUpperCase()}${first.slice(1)}`;
  return [head, ...rest].join(" · ");
}

/**
 * What the contract requires of this box, in one sentence, or `undefined` when
 * the control itself already says it (a `choice` renders its options and a
 * `boolean` renders both answers).
 *
 * The pattern is printed VERBATIM. It is the contract's own regex and it is
 * cryptic, and a friendlier paraphrase here would be this surface claiming to
 * know what `^T\d{6,}$` means about a UCPath receipt — which is exactly the
 * kind of restatement that goes stale the first time the contract moves.
 */
export function proofFieldHint(field: ProofFieldWire): string | undefined {
  const parts: string[] = [];
  if (field.kind === "text") {
    if (field.format === "iso-datetime") parts.push("an ISO-8601 instant with an offset");
    else if (field.pattern !== undefined) parts.push(`must match ${field.pattern}`);
    if (field.minLength !== undefined) parts.push(`at least ${String(field.minLength)} character(s)`);
    if (field.maxLength !== undefined) parts.push(`at most ${String(field.maxLength)} character(s)`);
    if (field.serverOnlyRules) {
      parts.push("the server checks more rules on this one than this box can");
    }
  }
  if (field.kind === "integer") {
    parts.push("a whole number");
    if (field.minimum !== undefined) parts.push(`at least ${String(field.minimum)}`);
    if (field.maximum !== undefined) parts.push(`at most ${String(field.maximum)}`);
  }
  return parts.length === 0 ? undefined : parts.join(" · ");
}
