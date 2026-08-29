import { z } from "zod";
import { canonicalJsonStringify, JsonValueSchema } from "./canonical-json.js";
import { FingerprintSchema } from "./ids.js";
import {
  DataClassificationSchema,
  EvidenceTransformSchema,
  evidenceTransformAllowed,
  refineEvidenceTransformPair,
} from "./redaction-policy.js";
import { sha256Hex } from "./sha256.js";

export { DataClassificationSchema, EvidenceTransformSchema, evidenceTransformAllowed } from "./redaction-policy.js";

export const ClassifiedDiagnosticValueSchema = z.strictObject({
  key: z.string().regex(/^[a-z][A-Za-z0-9]*$/),
  classification: DataClassificationSchema,
  transform: EvidenceTransformSchema,
  value: JsonValueSchema,
}).superRefine(refineEvidenceTransformPair);

const RedactedDropArm = z.strictObject({
  state: z.literal("redacted"),
  classification: DataClassificationSchema,
  transform: z.literal("drop"),
});
const RedactedDigestArm = z.strictObject({
  state: z.literal("transformed"),
  classification: DataClassificationSchema,
  transform: z.literal("digest"),
  value: FingerprintSchema,
});
const RedactedLast4Arm = z.strictObject({
  state: z.literal("transformed"),
  classification: DataClassificationSchema,
  transform: z.literal("last4"),
  value: z.string().max(4, "must contain at most four characters"),
});
const RedactedBasenameArm = z.strictObject({
  state: z.literal("transformed"),
  classification: DataClassificationSchema,
  transform: z.literal("basename"),
  value: z.string(),
});
const RedactedCountArm = z.strictObject({
  state: z.literal("transformed"),
  classification: DataClassificationSchema,
  transform: z.literal("count"),
  value: z.number().int().nonnegative(),
});
const RedactedAllowedArm = z.strictObject({
  state: z.literal("allowed"),
  classification: DataClassificationSchema,
  transform: z.literal("allow"),
  value: JsonValueSchema,
});

/**
 * A redacted value with no key of its own — the form a durable record uses
 * when the surrounding row already names what the value is (ref data-intake-and-edit-data §5's
 * `RowReject.raw` names its source column and target field).
 *
 * It shares `RedactedFieldSchema`'s exact arms and `redactValue`'s exact
 * transform implementation on purpose: a second redaction path is a second
 * thing to drift, and a reject row that leaked a value the receipt would have
 * dropped is the same defect from a different surface.
 */
export const RedactedValueSchema = z.discriminatedUnion("transform", [
  RedactedDropArm,
  RedactedDigestArm,
  RedactedLast4Arm,
  RedactedBasenameArm,
  RedactedCountArm,
  RedactedAllowedArm,
]).superRefine(refineEvidenceTransformPair);

const KEYED = { key: z.string() } as const;
export const RedactedFieldSchema = z.discriminatedUnion("transform", [
  RedactedDropArm.extend(KEYED),
  RedactedDigestArm.extend(KEYED),
  RedactedLast4Arm.extend(KEYED),
  RedactedBasenameArm.extend(KEYED),
  RedactedCountArm.extend(KEYED),
  RedactedAllowedArm.extend(KEYED),
]).superRefine(refineEvidenceTransformPair);

export const RedactionResultSchema = z.strictObject({
  fields: z.array(RedactedFieldSchema),
  warnings: z.array(z.string()),
});

export function redactionDigest(value: z.infer<typeof JsonValueSchema>) {
  const canonical = canonicalJsonStringify(value);
  return FingerprintSchema.parse(sha256Hex(`hrauto:redaction-digest:v1\0${canonical}`));
}

/** A stable operator-safe reference for one direct identifier, never the identifier itself. */
export function directIdentifierDigestReference(value: string): string {
  return `identifier#${redactionDigest(value).slice(0, 12)}`;
}

/**
 * The last path segment, over BOTH separators, with trailing separators
 * dropped — `node:path`'s `basename` in a form the dashboard bundle can
 * reach.
 *
 * This module is value-reachable from the browser entry (ref operator-trust §2.3's
 * receipt rides the run-detail wire), and Vite replaces an externalized
 * built-in with a proxy that throws on the first property read, so the
 * `node:path` import alone would kill the app at module evaluation. Splitting
 * on `\` as well as `/` is deliberately WIDER than POSIX `basename`: a
 * classified `credential-file` value may be a Windows path, and leaking a
 * whole directory tree because the platform separator differed is the exact
 * failure this transform exists to prevent.
 */
function pathBasename(value: string): string {
  const trimmed = value.replace(/[\\/]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return cut === -1 ? trimmed : trimmed.slice(cut + 1);
}

function safeText(value: z.infer<typeof JsonValueSchema>): string {
  if (typeof value === "string") return value;
  return canonicalJsonStringify(value);
}

function count(value: z.infer<typeof JsonValueSchema>): number {
  if (typeof value === "string" || Array.isArray(value)) return value.length;
  if (value !== null && typeof value === "object") return Object.keys(value).length;
  return 1;
}

/**
 * Apply one declared (classification, transform) pair to one value.
 *
 * The pair is REFUSED here as well as at declaration time: a caller that
 * assembled it dynamically would otherwise be able to widen a classification's
 * permitted transform by passing the wider one, and this function is the last
 * place before the value becomes durable.
 */
export function redactValue(
  classification: z.infer<typeof DataClassificationSchema>,
  transform: z.infer<typeof EvidenceTransformSchema>,
  value: z.infer<typeof JsonValueSchema>,
): z.infer<typeof RedactedValueSchema> {
  if (!evidenceTransformAllowed(classification, transform)) {
    throw new Error(`redaction transform ${transform} is forbidden for ${classification}`);
  }
  switch (transform) {
    case "drop": return { state: "redacted", classification, transform: "drop" };
    case "digest": return { state: "transformed", classification, transform: "digest", value: redactionDigest(value) };
    case "last4": return { state: "transformed", classification, transform: "last4", value: safeText(value).slice(-4) };
    case "basename": return {
      state: "transformed",
      classification,
      transform: "basename",
      value: pathBasename(safeText(value)),
    };
    case "count": return { state: "transformed", classification, transform: "count", value: count(value) };
    case "allow": return { state: "allowed", classification: "safe-diagnostic", transform: "allow", value };
  }
}

function redact(field: z.infer<typeof ClassifiedDiagnosticValueSchema>): z.infer<typeof RedactedFieldSchema> {
  return { key: field.key, ...redactValue(field.classification, field.transform, field.value) };
}

export function redactDiagnosticFields(input: unknown): z.infer<typeof RedactionResultSchema> {
  if (!Array.isArray(input)) return { fields: [], warnings: ["unclassified diagnostic payload dropped"] };
  const fields: Array<z.infer<typeof RedactedFieldSchema>> = [];
  const warnings: string[] = [];
  for (const [index, candidate] of input.entries()) {
    const parsed = ClassifiedDiagnosticValueSchema.safeParse(candidate);
    if (!parsed.success) {
      warnings.push(`unclassified diagnostic field at index ${String(index)} dropped`);
      continue;
    }
    fields.push(redact(parsed.data));
  }
  return RedactionResultSchema.parse({ fields, warnings });
}
