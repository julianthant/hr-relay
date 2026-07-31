import { createHash } from "node:crypto";
import { basename } from "node:path";
import { z } from "zod";
import { canonicalJsonStringify, JsonValueSchema } from "./canonical-json.js";
import { FingerprintSchema } from "./ids.js";

export const DataClassificationSchema = z.enum([
  "secret",
  "credential-file",
  "direct-identifier",
  "sensitive-hr",
  "safe-diagnostic",
]);
export const EvidenceTransformSchema = z.enum(["drop", "digest", "last4", "basename", "count", "allow"]);

const ALLOWED_TRANSFORMS = {
  secret: new Set(["drop", "digest"]),
  "credential-file": new Set(["drop", "digest"]),
  "direct-identifier": new Set(["drop", "digest", "last4"]),
  "sensitive-hr": new Set(["drop", "digest", "count"]),
  "safe-diagnostic": new Set(["allow", "count", "basename"]),
} satisfies Record<z.infer<typeof DataClassificationSchema>, ReadonlySet<string>>;

export const ClassifiedDiagnosticValueSchema = z.strictObject({
  key: z.string().regex(/^[a-z][A-Za-z0-9]*$/),
  classification: DataClassificationSchema,
  transform: EvidenceTransformSchema,
  value: JsonValueSchema,
}).superRefine((field, context) => {
  if (!ALLOWED_TRANSFORMS[field.classification].has(field.transform)) {
    context.addIssue({ code: "custom", path: ["transform"], message: `${field.transform} is forbidden for ${field.classification}` });
  }
});

export const RedactedFieldSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("redacted"),
    key: z.string(),
    classification: DataClassificationSchema,
    transform: z.literal("drop"),
  }),
  z.strictObject({
    state: z.literal("transformed"),
    key: z.string(),
    classification: DataClassificationSchema,
    transform: z.enum(["digest", "last4", "basename", "count"]),
    value: z.union([FingerprintSchema, z.string(), z.number().int().nonnegative()]),
  }),
  z.strictObject({
    state: z.literal("allowed"),
    key: z.string(),
    classification: z.literal("safe-diagnostic"),
    transform: z.literal("allow"),
    value: JsonValueSchema,
  }),
]);

export const RedactionResultSchema = z.strictObject({
  fields: z.array(RedactedFieldSchema),
  warnings: z.array(z.string()),
});

export function redactionDigest(value: z.infer<typeof JsonValueSchema>) {
  const canonical = canonicalJsonStringify(value);
  return FingerprintSchema.parse(
    createHash("sha256").update("hrauto:redaction-digest:v1\0").update(canonical).digest("hex"),
  );
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

function redact(field: z.infer<typeof ClassifiedDiagnosticValueSchema>): z.infer<typeof RedactedFieldSchema> {
  switch (field.transform) {
    case "drop": return { state: "redacted", key: field.key, classification: field.classification, transform: "drop" };
    case "digest": return {
      state: "transformed",
      key: field.key,
      classification: field.classification,
      transform: "digest",
      value: redactionDigest(field.value),
    };
    case "last4": return {
      state: "transformed",
      key: field.key,
      classification: field.classification,
      transform: "last4",
      value: safeText(field.value).slice(-4),
    };
    case "basename": return {
      state: "transformed",
      key: field.key,
      classification: field.classification,
      transform: "basename",
      value: basename(safeText(field.value)),
    };
    case "count": return {
      state: "transformed",
      key: field.key,
      classification: field.classification,
      transform: "count",
      value: count(field.value),
    };
    case "allow": return {
      state: "allowed",
      key: field.key,
      classification: "safe-diagnostic",
      transform: "allow",
      value: field.value,
    };
  }
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
