import type { CanonicalField } from "../../../../src/models/fields/registry.js";
import { evidenceTransformAllowed } from "../../../../src/rules/redaction/redaction.js";

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
