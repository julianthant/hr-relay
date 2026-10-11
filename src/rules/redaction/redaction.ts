import { z } from "zod";
import { canonicalJsonStringify, JsonValueSchema } from "../validation/canonical-json.js";
import { FingerprintSchema } from "../identity/ids.js";
import {
  DataClassificationSchema,
  EvidenceTransformSchema,
  evidenceTransformAllowed,
  refineLocalEvidenceTransformPair,
} from "./redaction-policy.js";
import { sha256Hex } from "../validation/sha256.js";

export { DataClassificationSchema, EvidenceTransformSchema, evidenceTransformAllowed } from "./redaction-policy.js";

export const ClassifiedDiagnosticValueSchema = z.strictObject({
  key: z.string().regex(/^[a-z][A-Za-z0-9]*$/),
  classification: DataClassificationSchema,
  transform: EvidenceTransformSchema,
  value: JsonValueSchema,
}).superRefine(refineLocalEvidenceTransformPair);

const RawValueField = { rawValue: JsonValueSchema.optional() } as const;
const RedactedDropArm = z.strictObject({
  state: z.literal("redacted"),
  classification: DataClassificationSchema,
  transform: z.literal("drop"),
  ...RawValueField,
});
const RedactedDigestArm = z.strictObject({
  state: z.literal("transformed"),
  classification: DataClassificationSchema,
  transform: z.literal("digest"),
  value: FingerprintSchema,
  ...RawValueField,
});
const RedactedLast4Arm = z.strictObject({
  state: z.literal("transformed"),
  classification: DataClassificationSchema,
  transform: z.literal("last4"),
  value: z.string().max(4, "must contain at most four characters"),
  ...RawValueField,
});
const RedactedBasenameArm = z.strictObject({
  state: z.literal("transformed"),
  classification: DataClassificationSchema,
  transform: z.literal("basename"),
  value: z.string(),
  ...RawValueField,
});
const RedactedCountArm = z.strictObject({
  state: z.literal("transformed"),
  classification: DataClassificationSchema,
  transform: z.literal("count"),
  value: z.number().int().nonnegative(),
  ...RawValueField,
});
const RedactedAllowedArm = z.strictObject({
  state: z.literal("allowed"),
  classification: DataClassificationSchema,
  transform: z.literal("allow"),
  value: JsonValueSchema,
  ...RawValueField,
});

/** A redacted value with no key of its own, sharing `RedactedFieldSchema`'s exact arms and `redactValue`'s exact transform: a second redaction path is a second thing to drift. */
export const RedactedValueSchema = z.discriminatedUnion("transform", [
  RedactedDropArm,
  RedactedDigestArm,
  RedactedLast4Arm,
  RedactedBasenameArm,
  RedactedCountArm,
  RedactedAllowedArm,
]).superRefine(refineLocalEvidenceTransformPair);

const KEYED = { key: z.string() } as const;
export const RedactedFieldSchema = z.discriminatedUnion("transform", [
  RedactedDropArm.extend(KEYED),
  RedactedDigestArm.extend(KEYED),
  RedactedLast4Arm.extend(KEYED),
  RedactedBasenameArm.extend(KEYED),
  RedactedCountArm.extend(KEYED),
  RedactedAllowedArm.extend(KEYED),
]).superRefine(refineLocalEvidenceTransformPair);

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

/** Display the identifier supplied by the authorized local caller. */
export function directIdentifierDisplay(value: string): string { return value; }

/** Operator-visible permanent-write identity, derived only from the authority digest. */
export function idempotencyKeyDigestReference(digestInput: unknown, withheld = false): string {
  if (withheld || digestInput === "withheld-protected-input") return "protected transaction key (withheld)";
  const digest = FingerprintSchema.parse(digestInput);
  return `key digest ${digest.slice(0, 12)}…`;
}

/** A UUID-shaped evidence reference whose byte derivation carries no source identifier. */
export function redactedEvidenceId(namespace: string, parts: readonly string[]): string {
  const digest = sha256Hex(`hrauto:${namespace}:v1\0${parts.join("\0")}`);
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `4${digest.slice(13, 16)}`,
    `8${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
}

/** The last path segment over BOTH separators, in a form the dashboard bundle can reach; splitting on the Windows separator as well is deliberately wider than POSIX `basename`. */
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

/** Apply one declared (classification, transform) pair to one value; the pair is REFUSED here as well as at declaration time, because this is the last place before the value becomes durable. */
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

/** Retain a complete classified value in local evidence, never provider payloads. */
export function retainLocalEvidenceValue(
  classification: z.infer<typeof DataClassificationSchema>,
  transform: z.infer<typeof EvidenceTransformSchema>,
  value: z.infer<typeof JsonValueSchema>,
): z.infer<typeof RedactedValueSchema> {
  if (transform !== "allow" && !evidenceTransformAllowed(classification, transform)) {
    throw new Error(`redaction transform ${transform} is forbidden for ${classification}`);
  }
  return { state: "allowed", classification, transform: "allow", value };
}

function redact(field: z.infer<typeof ClassifiedDiagnosticValueSchema>): z.infer<typeof RedactedFieldSchema> {
  return { key: field.key, ...retainLocalEvidenceValue(field.classification, field.transform, field.value) };
}

export function redactDiagnosticFields(input: unknown): z.infer<typeof RedactionResultSchema> {
  if (!Array.isArray(input)) return { fields: [], warnings: [`unclassified diagnostic payload: ${JSON.stringify(input)}`] };
  const fields: Array<z.infer<typeof RedactedFieldSchema>> = [];
  const warnings: string[] = [];
  for (const [index, candidate] of input.entries()) {
    const parsed = ClassifiedDiagnosticValueSchema.safeParse(candidate);
    if (!parsed.success) {
      warnings.push(`unclassified diagnostic field at index ${String(index)}: ${JSON.stringify(candidate)}`);
      continue;
    }
    fields.push(redact(parsed.data));
  }
  return RedactionResultSchema.parse({ fields, warnings });
}

// Diagnostic text never carries authorization material or URL query values.
export function sanitizeDebugText(text: string): string {
  const credentialKey = /password|passwd|token|cookie|authorization|private[-_ ]?key|challenge|signature/iu;
  const keys = /("(?:\\(?:["\\/bfnrt]|u[0-9a-f]{4})|[\x20-\x21\x23-\x5b\x5d-\u{10ffff}])*")\s*:\s*/giu;
  let redacted = "";
  let retainedFrom = 0;
  for (const match of text.matchAll(keys)) {
    if (match.index < retainedFrom) continue;
    const key: unknown = JSON.parse(match[1]);
    if (typeof key !== "string" || !credentialKey.test(key)) continue;
    const start = match.index + match[0].length;
    let end = start;
    if (text[start] === '"' || text[start] === "{" || text[start] === "[") {
      let depth = 0;
      let quoted = false;
      let escaped = false;
      for (; end < text.length; end++) {
        const character = text[end];
        if (quoted) {
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === '"') {
            quoted = false;
            if (depth === 0) { end++; break; }
          }
        } else if (character === '"') quoted = true;
        else if (character === "{" || character === "[") depth++;
        else if (character === "}" || character === "]") {
          depth--;
          if (depth === 0) { end++; break; }
        }
      }
    } else {
      while (end < text.length && !/[,}\]]/u.test(text[end])) end++;
    }
    redacted += text.slice(retainedFrom, start) + '"[removed]"';
    retainedFrom = end;
  }
  text = redacted + text.slice(retainedFrom);
  return text.replace(/https?:\/\/[^\s<>"']+/gu, raw => {
    try { const url = new URL(raw); url.username = ""; url.password = ""; url.search = ""; url.hash = ""; return url.toString(); }
    catch { return "[invalid-url]"; }
  }).replace(/(?:bearer|basic)\s+[a-z0-9+/_.=-]+/giu, "[authorization removed]")
    .replace(/((?:password|passwd|token|cookie|authorization|private[-_ ]?key|challenge|signature)\s*[=:]\s*)[^\s,;]+/giu, "$1[removed]")
    .replace(/-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/gu, "[private key removed]");
}
