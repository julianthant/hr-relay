/**
 * Ref data-intake-and-edit-data §1 — the canonical field vocabulary is frozen against a RECORDED
 * scan, and every entry in it is coherent.
 *
 * Three claims, each falsifiable:
 *
 * 1. `config/canonical-field-inventory.json` covers the registry in both
 *    directions. A canonical field nobody scanned is unevidenced vocabulary; a
 *    scanned field with no disposition is the silent omission ref data-intake-and-edit-data §1 bans
 *    in as many words ("No current mappable field may be silently omitted").
 * 2. Each scanned field still exists in the file the scan names. The legacy
 *    repository is frozen, so this can only fail when the inventory drifts.
 * 3. Each registry entry holds together: its declared redaction pair is legal,
 *    a deferred shape says why, and no header alias claims two fields.
 *
 * Each arm runs its audit against a violating fixture too, so a guard that
 * stopped checking would itself fail.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import rawInventory from "../../../config/canonical-field-inventory.json" with { type: "json" };
import { CANONICAL_FIELDS, CANONICAL_FIELD_IDS } from "../../../src/domain/fields/registry.js";
import type { CanonicalField } from "../../../src/domain/fields/registry.js";
import {
  CanonicalFieldInventorySchema,
  auditCanonicalFieldInventory,
  auditCanonicalFieldRegistry,
  type CanonicalFieldInventory,
} from "./helpers/canonical-field-inventory-audit.js";
import { REPO_ROOT } from "./helpers/guard-files.js";
import { FROZEN_LEGACY_ARCHITECTURE_PROVENANCE } from "./helpers/frozen-legacy-architecture-provenance.js";

const inventory = CanonicalFieldInventorySchema.parse(rawInventory);

const registry: ReadonlyMap<string, CanonicalField> = new Map(
  CANONICAL_FIELD_IDS.map((id) => [id, CANONICAL_FIELDS[id] as CanonicalField]),
);

function readSource(ref: string): string | null {
  if (ref.startsWith("legacy:")) {
    return FROZEN_LEGACY_ARCHITECTURE_PROVENANCE.canonicalFields.files
      .find(({ path }) => path === ref.slice("legacy:".length))?.text ?? null;
  }
  const path = resolve(REPO_ROOT, ref.startsWith("doc:") ? ref.slice("doc:".length) : ref);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function fixtureInventory(patch: (draft: CanonicalFieldInventory) => void): CanonicalFieldInventory {
  const draft = structuredClone(inventory);
  patch(draft);
  return draft;
}

describe("ref data-intake-and-edit-data §1 canonical field registry", () => {
  it("is covered by the recorded scan in both directions", () => {
    assert.deepEqual(auditCanonicalFieldInventory({ inventory, fields: registry, readSource }), []);
  });

  it("keeps every registry entry coherent", () => {
    assert.deepEqual(auditCanonicalFieldRegistry(registry), []);
  });

  it("names the legacy commit the scan was taken at", () => {
    assert.equal(inventory.legacyCommit.length >= 7, true);
    assert.equal(FROZEN_LEGACY_ARCHITECTURE_PROVENANCE.canonicalFields.commit.startsWith(inventory.legacyCommit), true);
    assert.equal(inventory.sources.some((source) => source.kind === "roster-header-rule"), true);
    assert.equal(inventory.sources.some((source) => source.kind === "ocr-form-field"), true);
    assert.equal(inventory.sources.some((source) => source.kind === "edit-data-field"), true);
    assert.equal(inventory.sources.some((source) => source.kind === "workflow-input"), true);
  });

  describe("negative controls — the audit fails when it should", () => {
    it("catches a canonical field no source evidences", () => {
      const orphaned = new Map(registry);
      orphaned.set("phantom", { ...(registry.get("eid") as CanonicalField), id: "phantom" as CanonicalField["id"] });
      const violations = auditCanonicalFieldInventory({ inventory, fields: orphaned, readSource });
      assert.deepEqual(violations, ["canonical field phantom: no scanned source evidences it"]);
    });

    it("catches a scanned field that maps to an unknown canonical id", () => {
      const drifted = fixtureInventory((draft) => {
        // Reuse a real field name so only the TARGET is wrong.
        (draft.sources[0].canonical as Record<string, string>).emplId = "notAField";
      });
      const violations = auditCanonicalFieldInventory({ inventory: drifted, fields: registry, readSource });
      assert.equal(
        violations.includes("legacy:src/workflows/work-study/schema.ts: field emplId maps to unknown canonical field notAField"),
        true,
        violations.join("\n"),
      );
    });

    it("catches a scanned field that no longer exists in its source file", () => {
      const drifted = fixtureInventory((draft) => {
        draft.sources[0].local.fieldRemovedFromLegacy = "execution-option";
      });
      const violations = auditCanonicalFieldInventory({ inventory: drifted, fields: registry, readSource });
      assert.equal(
        violations.includes(
          "legacy:src/workflows/work-study/schema.ts: scanned field fieldRemovedFromLegacy no longer appears in that file",
        ),
        true,
        violations.join("\n"),
      );
    });

    it("catches a source ref that resolves to nothing", () => {
      const drifted = fixtureInventory((draft) => {
        draft.sources.push({
          ref: "legacy:src/workflows/does-not-exist/schema.ts",
          kind: "workflow-input",
          canonical: {},
          local: { emplId: "execution-option" },
        });
      });
      const violations = auditCanonicalFieldInventory({ inventory: drifted, fields: registry, readSource });
      assert.equal(
        violations.includes(
          "legacy:src/workflows/does-not-exist/schema.ts: does not resolve to a file in the repository it names",
        ),
        true,
        violations.join("\n"),
      );
    });

    it("catches an undeclared local reason and an unused declared one", () => {
      const drifted = fixtureInventory((draft) => {
        draft.sources[1].local.dryRun = "because-i-said-so";
        draft.localReasons.never_used = "unused";
      });
      const parsed = CanonicalFieldInventorySchema.safeParse(drifted);
      // `never_used` is not kebab-case, so the schema refuses it before the
      // audit ever runs — which is the stronger of the two failures.
      assert.equal(parsed.success, false);

      const kebab = fixtureInventory((draft) => {
        draft.sources[1].local.dryRun = "because-i-said-so";
        draft.localReasons["never-used"] = "unused";
      });
      const violations = auditCanonicalFieldInventory({ inventory: kebab, fields: registry, readSource });
      assert.equal(
        violations.includes("legacy:src/workflows/oath-signature/schema.ts: field dryRun cites undeclared reason because-i-said-so"),
        true,
        violations.join("\n"),
      );
      assert.equal(violations.includes("localReasons.never-used: declared but never cited"), true, violations.join("\n"));
    });

    it("catches a header alias claimed by two fields", () => {
      const collided = new Map(registry);
      const eid = registry.get("eid") as CanonicalField;
      collided.set("pid", { ...(registry.get("pid") as CanonicalField), aliases: [...eid.aliases] });
      const violations = auditCanonicalFieldRegistry(collided);
      assert.equal(violations.length > 0, true);
      assert.equal(violations.every((violation) => violation.startsWith("alias ")), true, violations.join("\n"));
    });

    it("catches a deferred shape with no audit note, and a resolved one carrying one", () => {
      const silent = new Map(registry);
      const deptId = registry.get("deptId") as CanonicalField;
      silent.set("deptId", { ...deptId, auditNote: undefined });
      assert.deepEqual(auditCanonicalFieldRegistry(silent), [
        "canonical field deptId: defers its shape without an auditNote",
      ]);

      const overclaimed = new Map(registry);
      const eid = registry.get("eid") as CanonicalField;
      overclaimed.set("eid", { ...eid, auditNote: "should not be here" });
      assert.deepEqual(auditCanonicalFieldRegistry(overclaimed), [
        "canonical field eid: is resolved yet carries an auditNote",
      ]);
    });

    it("admits complete classified values and catches invalid transform declarations", () => {
      const leaky = new Map(registry);
      const ssn = registry.get("ssn") as CanonicalField;
      leaky.set("ssn", { ...ssn, redactTransform: "allow" });
      assert.deepEqual(auditCanonicalFieldRegistry(leaky), []);
      leaky.set("ssn", { ...ssn, redactTransform: "invalid-transform" as CanonicalField["redactTransform"] });
      assert.deepEqual(auditCanonicalFieldRegistry(leaky), [
        "canonical field ssn: transform invalid-transform is forbidden for direct-identifier",
      ]);
    });
  });

  describe("the definition factory refuses a declaration that cannot hold", () => {
    it("refuses an example its own coerce+parse rejects", async () => {
      const { defineCanonicalField } = await import("../../../src/domain/fields/registry.js");
      assert.throws(
        () => defineCanonicalField({
          id: "eid",
          label: "Employee ID (EID)",
          schema: CANONICAL_FIELDS.eid.schema,
          coerce: (raw) => raw,
          aliases: ["EID"],
          examples: ["not-an-eid"],
          classification: "direct-identifier",
          redactTransform: "last4",
          evidence: "resolved",
        }),
        /does not survive its own coerce\+parse/,
      );
    });

    it("admits complete values and refuses an invalid transform at definition time", async () => {
      const { defineCanonicalField } = await import("../../../src/domain/fields/registry.js");
      const spec = {
        id: "ssn" as const,
        label: "Social Security Number",
        schema: CANONICAL_FIELDS.ssn.schema,
        coerce: CANONICAL_FIELDS.ssn.coerce,
        aliases: ["SSN"],
        examples: ["123456789"],
        classification: "direct-identifier" as const,
        redactTransform: "allow" as const,
        evidence: "resolved" as const,
      };
      const field = defineCanonicalField(spec);
      assert.equal(field.classification, "direct-identifier");
      assert.equal(field.redactTransform, "allow");
      assert.throws(
        () => defineCanonicalField({
          id: "ssn",
          label: "Social Security Number",
          schema: CANONICAL_FIELDS.ssn.schema,
          coerce: CANONICAL_FIELDS.ssn.coerce,
          aliases: ["SSN"],
          examples: ["123456789"],
          classification: "direct-identifier",
          redactTransform: "invalid-transform" as CanonicalField["redactTransform"],
          evidence: "resolved",
        }),
        /Invalid option/,
      );
    });
  });
});
