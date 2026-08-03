import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "vitest";
import {
  CandidateProposalIdSchema,
  LegacySelectorPortMapSchema,
  PINNED_LEGACY_SELECTOR_COMMIT,
  assertLegacySelectorDefinitionAtLine,
  auditLegacySelectorPortMap,
  buildLegacySelectorPortMap,
} from "./helpers/legacy-selector-port-map-audit.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const LEGACY_ROOT = process.env.HRAUTO_LEGACY_REPO ?? resolve(REPO_ROOT, "../hr-automation");
const PORT_MAP_PATH = resolve(REPO_ROOT, "config/ports/legacy-selector-port-map.json");

function readPortMap(): unknown {
  return JSON.parse(readFileSync(PORT_MAP_PATH, "utf8"));
}

// Same reason as legacy-change-accounting: this audit reads every pinned
// legacy blob through git, which is slow under full-suite parallelism.
describe("legacy selector port provenance", { timeout: 180_000 }, () => {
  it("pins all 406 keys exactly once to the clean legacy snapshot", () => {
    const portMap = LegacySelectorPortMapSchema.parse(readPortMap());
    assert.equal(portMap.legacyCommit, PINNED_LEGACY_SELECTOR_COMMIT);
    assert.deepEqual(portMap.systems.map(({ system, expectedKeyCount }) => [system, expectedKeyCount]), [
      ["crm", 12], ["i9", 41], ["kuali", 22], ["new-kronos", 54], ["old-kronos", 23],
      ["onbase", 28], ["servicenow", 11], ["sharepoint", 10], ["ucpath", 205],
    ]);
    assert.equal(portMap.entries.length, 406);
    assert.deepEqual(auditLegacySelectorPortMap(portMap, LEGACY_ROOT), []);
    assert.equal(portMap.entries.filter((entry) => entry.disposition === "candidate").length, 387);
    assert.equal(portMap.entries.filter((entry) => entry.disposition === "ported").length, 18);
    assert.equal(portMap.entries.filter((entry) => entry.disposition === "driver-internal").length, 1);
  });

  it("rebuilds exact provenance while keeping path-derived proposals non-authoritative", () => {
    const generated = buildLegacySelectorPortMap(LEGACY_ROOT);
    const checkedIn = LegacySelectorPortMapSchema.parse(readPortMap());
    const generatedProposals = generated.entries.map((entry) => {
      if (entry.disposition !== "candidate") throw new Error("generated port-map entry was classified unexpectedly");
      return { system: entry.system, legacyKey: entry.legacyKey, candidateId: entry.candidateId };
    });
    assert.deepEqual(
      generatedProposals,
      checkedIn.entries.map((entry) => {
        const generatedEntry = generated.entries.find(
          (candidate) => candidate.system === entry.system && candidate.legacyKey === entry.legacyKey,
        );
        if (!generatedEntry || generatedEntry.disposition !== "candidate") {
          throw new Error(`missing generated candidate proposal for ${entry.system}:${entry.legacyKey}`);
        }
        return {
          system: entry.system,
          legacyKey: entry.legacyKey,
          candidateId: generatedEntry.candidateId,
        };
      }),
    );
    assert.equal(generated.entries.every((entry) => entry.semanticKind === "unclassified"), true);
    const serialized = JSON.stringify(generated);
    assert.doesNotMatch(serialized, /locator\(|getByRole\(|xpath=|css=|screenshot|password\s*[:=]/i);
  });

  it("rejects missing keys, duplicate keys, stale blobs, and recipe-shaped additions", () => {
    const valid = LegacySelectorPortMapSchema.parse(readPortMap());
    const missing = structuredClone(valid);
    missing.entries.pop();
    assert.notEqual(auditLegacySelectorPortMap(missing, LEGACY_ROOT).length, 0);

    const duplicate = structuredClone(valid) as Record<string, unknown>;
    const duplicateEntries = duplicate.entries as unknown[];
    duplicateEntries[1] = duplicateEntries[0];
    assert.match(auditLegacySelectorPortMap(duplicate, LEGACY_ROOT).join("\n"), /exactly once|unique/);

    const staleBlob = structuredClone(valid) as Record<string, unknown>;
    const staleSystems = staleBlob.systems as Record<string, unknown>[];
    staleSystems[0] = { ...staleSystems[0], sourceBlob: "0".repeat(40) };
    assert.match(auditLegacySelectorPortMap(staleBlob, LEGACY_ROOT).join("\n"), /git blobs/);

    const leakedRecipe = structuredClone(valid) as Record<string, unknown>;
    const leakedEntries = leakedRecipe.entries as Record<string, unknown>[];
    leakedEntries[0] = { ...leakedEntries[0], locator: "#secret" };
    assert.notEqual(auditLegacySelectorPortMap(leakedRecipe, LEGACY_ROOT).length, 0);
  });

  it("requires dual evidence only when a candidate becomes ported", () => {
    const valid = LegacySelectorPortMapSchema.parse(readPortMap());
    const malformedPorted = structuredClone(valid) as Record<string, unknown>;
    const entries = malformedPorted.entries as Record<string, unknown>[];
    const candidateIndex = entries.findIndex((entry) => entry.disposition === "candidate");
    assert.notEqual(candidateIndex, -1);
    const candidate = entries[candidateIndex];
    assert.ok(candidate);
    entries[candidateIndex] = {
      ...candidate,
      disposition: "ported",
      semanticKind: "element",
      canonicalId: "crm.search.result-rows",
    };
    delete entries[candidateIndex]?.candidateId;
    assert.notEqual(auditLegacySelectorPortMap(malformedPorted, LEGACY_ROOT).length, 0);
  });

  it("keeps one-to-many legacy recipes closed by unique context and canonical id", () => {
    const valid = LegacySelectorPortMapSchema.parse(readPortMap());
    const contextual = valid.entries.find((entry) =>
      entry.disposition === "ported" && "canonicalBindings" in entry
    );
    assert.ok(contextual && "canonicalBindings" in contextual);

    const duplicateContext = structuredClone(valid) as Record<string, unknown>;
    const contextEntries = duplicateContext.entries as Record<string, unknown>[];
    const contextIndex = contextEntries.findIndex((entry) => "canonicalBindings" in entry);
    const contextEntry = contextEntries[contextIndex];
    if (contextEntry === undefined) throw new Error("contextual port fixture missing");
    const contextBindings = contextEntry.canonicalBindings as Record<string, unknown>[];
    contextBindings[1] = { ...contextBindings[1], context: contextBindings[0]?.context };
    assert.match(
      LegacySelectorPortMapSchema.safeParse(duplicateContext).error?.message ?? "",
      /contexts must be unique/,
    );

    const duplicateCanonical = structuredClone(valid) as Record<string, unknown>;
    const canonicalEntries = duplicateCanonical.entries as Record<string, unknown>[];
    const canonicalEntry = canonicalEntries[contextIndex];
    if (canonicalEntry === undefined) throw new Error("contextual canonical fixture missing");
    const canonicalBindings = canonicalEntry.canonicalBindings as Record<string, unknown>[];
    canonicalBindings[1] = {
      ...canonicalBindings[1],
      canonicalId: canonicalBindings[0]?.canonicalId,
    };
    assert.match(
      auditLegacySelectorPortMap(duplicateCanonical, LEGACY_ROOT).join("\n"),
      /ported semantic ids must be globally unique/,
    );
  });

  it("does not treat candidate proposals as classified semantic ids", () => {
    const valid = LegacySelectorPortMapSchema.parse(readPortMap());
    const candidate = valid.entries.find((entry) => entry.disposition === "candidate");
    assert.ok(candidate);
    assert.equal(candidate.semanticKind, "unclassified");
    assert.equal("canonicalId" in candidate, false);
    assert.equal(CandidateProposalIdSchema.safeParse("ucpath.person-org.eid-input").success, false);
    assert.equal(CandidateProposalIdSchema.safeParse(candidate.candidateId).success, true);
  });

  it("binds source provenance to the selector definition at the pinned line", () => {
    const source = [
      "export const selectors = {",
      "  emplIdInput: () => undefined,",
      "};",
    ].join("\n");
    assert.doesNotThrow(() => assertLegacySelectorDefinitionAtLine(source, "personOrgSummary.emplIdInput()", 2));
    assert.throws(
      () => assertLegacySelectorDefinitionAtLine(source, "personOrgSummary.emplIdInput()", 1),
      /no selector definition at pinned source line/,
    );
  });
});
