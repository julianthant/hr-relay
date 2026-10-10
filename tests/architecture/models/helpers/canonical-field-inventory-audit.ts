
import { z } from "zod";
import { CanonicalFieldIdSchema } from "../../../../src/models/fields/registry.js";
import type { CanonicalField } from "../../../../src/models/fields/registry.js";
import { evidenceTransformAllowed } from "../../../../src/rules/redaction/redaction.js";

const ReasonIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "reason id must be kebab-case");
const SourceRefSchema = z.string().regex(
  /^(?:legacy:|doc:)[A-Za-z0-9./_-]+$/,
  "a source ref must be a legacy: or doc: qualified path",
);

export const CanonicalFieldInventorySchema = z.strictObject({
  schemaVersion: z.literal(1),
  scannedAt: z.iso.date(),
  legacyCommit: z.string().regex(/^[0-9a-f]{7,40}$/, "legacy commit must be a git hash"),
  purpose: z.string().min(1),
  localReasons: z.record(ReasonIdSchema, z.string().min(1)),
  sources: z.array(z.strictObject({
    ref: SourceRefSchema,
    kind: z.enum(["workflow-input", "roster-header-rule", "ocr-form-field", "edit-data-field", "owning-doc"]),
    canonical: z.record(z.string().min(1), CanonicalFieldIdSchema),
    local: z.record(z.string().min(1), ReasonIdSchema),
    note: z.string().min(1).optional(),
  })).min(1),
});
export type CanonicalFieldInventory = z.infer<typeof CanonicalFieldInventorySchema>;

export interface InventoryAuditInput {
  readonly inventory: CanonicalFieldInventory;
  /** The registry, as data — id → field. */
  readonly fields: ReadonlyMap<string, CanonicalField>;

  readonly readSource: (ref: string) => string | null;
}


export function auditCanonicalFieldInventory(input: InventoryAuditInput): string[] {
  const { inventory, fields, readSource } = input;
  const violations: string[] = [];

  const declaredReasons = new Set(Object.keys(inventory.localReasons));
  const usedReasons = new Set<string>();
  const referencedCanonical = new Set<string>();
  const seenRefs = new Set<string>();

  for (const source of inventory.sources) {
    if (seenRefs.has(source.ref)) violations.push(`${source.ref}: listed more than once`);
    seenRefs.add(source.ref);

    const text = readSource(source.ref);
    if (text === null) {
      violations.push(`${source.ref}: does not resolve to a file in the repository it names`);
    }

    const names = [...Object.keys(source.canonical), ...Object.keys(source.local)];
    if (names.length === 0) violations.push(`${source.ref}: records no fields at all`);
    for (const name of names) {
      if (name in source.canonical && name in source.local) {
        violations.push(`${source.ref}: field ${name} has two dispositions`);
      }

      if (text !== null && !new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text)) {
        violations.push(`${source.ref}: scanned field ${name} no longer appears in that file`);
      }
    }

    for (const [name, canonicalId] of Object.entries(source.canonical)) {
      if (!fields.has(canonicalId)) {
        violations.push(`${source.ref}: field ${name} maps to unknown canonical field ${canonicalId}`);
        continue;
      }
      referencedCanonical.add(canonicalId);
    }
    for (const [name, reasonId] of Object.entries(source.local)) {
      if (!declaredReasons.has(reasonId)) {
        violations.push(`${source.ref}: field ${name} cites undeclared reason ${reasonId}`);
        continue;
      }
      usedReasons.add(reasonId);
    }
  }

  for (const reasonId of declaredReasons) {
    if (!usedReasons.has(reasonId)) violations.push(`localReasons.${reasonId}: declared but never cited`);
  }
  for (const id of fields.keys()) {
    if (!referencedCanonical.has(id)) {
      violations.push(`canonical field ${id}: no scanned source evidences it`);
    }
  }

  return violations;
}


export function auditCanonicalFieldRegistry(fields: ReadonlyMap<string, CanonicalField>): string[] {
  const violations: string[] = [];
  const aliasOwners = new Map<string, string>();

  for (const [id, field] of fields) {
    if (field.id !== id) violations.push(`canonical field ${id}: registered under a key that is not its id`);
    if (!evidenceTransformAllowed(field.classification, field.redactTransform)) {
      violations.push(`canonical field ${id}: transform ${field.redactTransform} is forbidden for ${field.classification}`);
    }
    if (field.evidence === "audit-at-migration" && (field.auditNote ?? "").trim().length === 0) {
      violations.push(`canonical field ${id}: defers its shape without an auditNote`);
    }
    if (field.evidence === "resolved" && field.auditNote !== undefined) {
      violations.push(`canonical field ${id}: is resolved yet carries an auditNote`);
    }
    if (field.examples.length === 0) violations.push(`canonical field ${id}: declares no examples`);
    for (const alias of field.aliases) {
      const normalized = alias.trim().toLowerCase().replace(/\s+/g, " ");
      const owner = aliasOwners.get(normalized);

      if (owner !== undefined && owner !== id) {
        violations.push(`alias "${alias}": claimed by both ${owner} and ${id}`);
      }
      aliasOwners.set(normalized, id);
    }
  }
  return violations;
}
