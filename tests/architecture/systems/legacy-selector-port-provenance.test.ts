import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "vitest";
import {
  CandidateProposalIdSchema,
  LegacySelectorPortMapSchema,
  PINNED_LEGACY_SELECTOR_COMMIT,
  assertLegacySelectorDefinitionAtLine,
  auditLegacySelectorPortMap,
  buildLegacySelectorPortMap,
} from "./helpers/legacy-selector-port-map-audit.js";
import {
  FROZEN_LEGACY_ARCHITECTURE_PROVENANCE,
  FrozenLegacyArchitectureProvenanceSchema,
  frozenLegacyPaths,
  parseFrozenLegacyArchitectureProvenance,
} from "../support/helpers/frozen-legacy-architecture-provenance.js";

const PORT_MAP_PATH = new URL("../../../docs/rebuild/migrations/legacy/ports/legacy-selector-port-map.json", import.meta.url);
const ARCHITECTURE_PROVENANCE_PATH = new URL(
  "../../../docs/rebuild/migrations/legacy/ports/legacy-architecture-provenance.json",
  import.meta.url,
);

function readPortMap(): unknown {
  return JSON.parse(readFileSync(PORT_MAP_PATH, "utf8"));
}

const FROZEN_PATH_SNAPSHOT_CASES = [
  { name: "legacy-browser-system-files", path: ["runtime", "browserSystemFiles"] },
  { name: "legacy-capability-discovered-paths", path: ["capabilities", "discoveredPaths"] },
  { name: "legacy-capability-source-paths", path: ["capabilities", "sourcePaths"] },
  { name: "legacy-capability-evidence-paths", path: ["capabilities", "legacyPaths"] },
  { name: "legacy-test-baseline-files", path: ["testDisposition", "baselineFiles"] },
  { name: "legacy-test-current-files", path: ["testDisposition", "currentFiles"] },
] as const;

function snapshotAt(draft: Record<string, unknown>, path: readonly string[]): Record<string, unknown> {
  let cursor: unknown = draft;
  for (const key of path) cursor = (cursor as Record<string, unknown>)[key];
  return cursor as Record<string, unknown>;
}

function sha256ContentAddress(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

describe("legacy selector port provenance", { timeout: 180_000 }, () => {
  it("commits no SSN- or UCSD EID-shaped values in frozen legacy evidence", () => {
    const serialized = readFileSync(ARCHITECTURE_PROVENANCE_PATH, "utf8");
    assert.doesNotMatch(serialized, /\b\d{3}-\d{2}-\d{4}\b/u);
    assert.doesNotMatch(serialized, /\b10\d{6}\b/u);
  });

  it("pins all 406 keys exactly once to the clean legacy snapshot", () => {
    const portMap = LegacySelectorPortMapSchema.parse(readPortMap());
    assert.equal(portMap.legacyCommit, PINNED_LEGACY_SELECTOR_COMMIT);
    assert.deepEqual(portMap.systems.map(({ system, expectedKeyCount }) => [system, expectedKeyCount]), [
      ["crm", 12], ["i9", 41], ["kuali", 22], ["new-kronos", 54], ["old-kronos", 23],
      ["onbase", 28], ["servicenow", 11], ["sharepoint", 10], ["ucpath", 205],
    ]);
    assert.equal(portMap.entries.length, 406);
    assert.deepEqual(auditLegacySelectorPortMap(portMap), []);
    // Separations chunk 4 moved THIRTEEN ucpath keys candidate→ported (D206):
    // the Smart HR wizard's three pages, the pending-sweep delete, and the SS
    // Smart HR search filter — one of which (`ssSmartHRTransactions.emplIdInput()`)
    // binds TWO canonical ids by context.
    //
    // **D261 moved THREE more, all kuali**: `actionList.searchInput()`,
    // `actionList.searchGoButton()` and `actionList.docLink()`, which is the
    // Action-List resolve the operator's "document number should work" ruling
    // asked for. The other two of that family stay CANDIDATE and stay named:
    // `actionList.menuItem()` is superseded by the list's own route (a direct
    // `goto` rendered it in 1.1 s live 2026-08-20) and `actionList.docLinks()`
    // enumerates every pending document, which is candidate discovery no
    // workflow here performs.
    assert.equal(portMap.entries.filter((entry) => entry.disposition === "candidate").length, 336);
    assert.equal(portMap.entries.filter((entry) => entry.disposition === "ported").length, 69);
    assert.equal(portMap.entries.filter((entry) => entry.disposition === "driver-internal").length, 1);
  });

  it("rebuilds exact provenance while keeping path-derived proposals non-authoritative", () => {
    const generated = buildLegacySelectorPortMap();
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
    assert.notEqual(auditLegacySelectorPortMap(missing).length, 0);

    const duplicate = structuredClone(valid) as Record<string, unknown>;
    const duplicateEntries = duplicate.entries as unknown[];
    duplicateEntries[1] = duplicateEntries[0];
    assert.match(auditLegacySelectorPortMap(duplicate).join("\n"), /exactly once|unique/);

    const staleBlob = structuredClone(valid) as Record<string, unknown>;
    const staleSystems = staleBlob.systems as Record<string, unknown>[];
    staleSystems[0] = { ...staleSystems[0], sourceBlob: "0".repeat(40) };
    assert.match(auditLegacySelectorPortMap(staleBlob).join("\n"), /git blobs/);

    const leakedRecipe = structuredClone(valid) as Record<string, unknown>;
    const leakedEntries = leakedRecipe.entries as Record<string, unknown>[];
    leakedEntries[0] = { ...leakedEntries[0], locator: "#secret" };
    assert.notEqual(auditLegacySelectorPortMap(leakedRecipe).length, 0);
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
    assert.notEqual(auditLegacySelectorPortMap(malformedPorted).length, 0);
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
      auditLegacySelectorPortMap(duplicateCanonical).join("\n"),
      /ported semantic ids must be globally unique/,
    );
  });

  it("refuses missing or malformed checked-in source provenance", () => {
    const missing = structuredClone(FROZEN_LEGACY_ARCHITECTURE_PROVENANCE) as Record<string, unknown>;
    const selector = missing.selector as Record<string, unknown>;
    selector.files = (selector.files as unknown[]).slice(1);
    assert.throws(
      () => buildLegacySelectorPortMap(FrozenLegacyArchitectureProvenanceSchema.parse(missing).selector),
      /frozen legacy provenance requires exactly one/i,
    );

    const malformed = structuredClone(FROZEN_LEGACY_ARCHITECTURE_PROVENANCE) as Record<string, unknown>;
    const malformedSelector = malformed.selector as Record<string, unknown>;
    malformedSelector.commit = "not-a-commit";
    assert.throws(() => FrozenLegacyArchitectureProvenanceSchema.parse(malformed), /commit/i);

    const tamperedText = structuredClone(FROZEN_LEGACY_ARCHITECTURE_PROVENANCE) as Record<string, unknown>;
    const tamperedSelector = tamperedText.selector as Record<string, unknown>;
    const files = tamperedSelector.files as Record<string, unknown>[];
    files[0] = { ...files[0], text: `${String(files[0]?.text)}tampered` };
    assert.throws(
      () => parseFrozenLegacyArchitectureProvenance(tamperedText),
      /frozen legacy file content-address mismatch/i,
    );

    const recomputed = structuredClone(FROZEN_LEGACY_ARCHITECTURE_PROVENANCE) as Record<string, unknown>;
    const recomputedSelector = recomputed.selector as Record<string, unknown>;
    const [recomputedFile] = recomputedSelector.files as Record<string, unknown>[];
    assert.ok(recomputedFile);
    recomputedFile.text = `${String(recomputedFile.text)}tampered`;
    recomputedFile.contentAddress = sha256ContentAddress(String(recomputedFile.text));
    assert.throws(
      () => parseFrozenLegacyArchitectureProvenance(recomputed),
      /frozen legacy payload anchor mismatch for contentAddress/i,
    );

    const reordered = structuredClone(FROZEN_LEGACY_ARCHITECTURE_PROVENANCE) as Record<string, unknown>;
    const reorderedSelector = reordered.selector as Record<string, unknown>;
    const reorderedFiles = reorderedSelector.files as unknown[];
    [reorderedFiles[0], reorderedFiles[1]] = [reorderedFiles[1], reorderedFiles[0]];
    assert.throws(
      () => parseFrozenLegacyArchitectureProvenance(reordered),
      /selector file anchor mismatch for path\[0\]/i,
    );
  });

  it("authenticates every named generated legacy path snapshot before exposing paths", () => {
    assert.deepEqual(
      FROZEN_PATH_SNAPSHOT_CASES.map(({ name, path }) => [name, frozenLegacyPaths(snapshotAt(
        FROZEN_LEGACY_ARCHITECTURE_PROVENANCE as unknown as Record<string, unknown>, path,
      ) as Parameters<typeof frozenLegacyPaths>[0]).length]),
      [
        ["legacy-browser-system-files", 87],
        ["legacy-capability-discovered-paths", 78],
        ["legacy-capability-source-paths", 78],
        ["legacy-capability-evidence-paths", 79],
        ["legacy-test-baseline-files", 518],
        ["legacy-test-current-files", 534],
      ],
    );
  });

  it.each(FROZEN_PATH_SNAPSHOT_CASES)("refuses a dropped entry from $name while its content address is unchanged", ({ name, path }) => {
    const dropped = structuredClone(FROZEN_LEGACY_ARCHITECTURE_PROVENANCE) as unknown as Record<string, unknown>;
    const snapshot = snapshotAt(dropped, path);
    snapshot.text = String(snapshot.text).replace(/^[^\n]+\n/u, "");
    assert.throws(
      () => parseFrozenLegacyArchitectureProvenance(dropped),
      new RegExp(`content-address mismatch for ${name}: expected`, "u"),
    );
  });

  it("refuses a same-count sorted path substitution even when its hash is recomputed", () => {
    const substituted = structuredClone(FROZEN_LEGACY_ARCHITECTURE_PROVENANCE) as unknown as Record<string, unknown>;
    const snapshot = snapshotAt(substituted, ["runtime", "browserSystemFiles"]);
    snapshot.text = String(snapshot.text).replace(
      "src/systems/CLAUDE.md\n",
      "src/systems/AAAA.md\n",
    );
    snapshot.contentAddress = sha256ContentAddress(String(snapshot.text));

    assert.throws(
      () => parseFrozenLegacyArchitectureProvenance(substituted),
      /frozen legacy runtime\.browserSystemFiles snapshot anchor mismatch for contentAddress/i,
    );
  });

  it("refuses malformed, unordered, or duplicate generated path records even with a matching content address", () => {
    const malformed = structuredClone(FROZEN_LEGACY_ARCHITECTURE_PROVENANCE) as unknown as Record<string, unknown>;
    const malformedSnapshot = snapshotAt(malformed, ["runtime", "browserSystemFiles"]);
    malformedSnapshot.text = "src/systems/crm/selectors.ts\n\n";
    malformedSnapshot.contentAddress = sha256ContentAddress(String(malformedSnapshot.text));
    assert.throws(
      () => frozenLegacyPaths(malformedSnapshot as Parameters<typeof frozenLegacyPaths>[0]),
      /malformed path entry/i,
    );

    const unordered = structuredClone(FROZEN_LEGACY_ARCHITECTURE_PROVENANCE) as unknown as Record<string, unknown>;
    const unorderedSnapshot = snapshotAt(unordered, ["runtime", "browserSystemFiles"]);
    const unorderedPaths = String(unorderedSnapshot.text).trimEnd().split("\n");
    [unorderedPaths[0], unorderedPaths[1]] = [unorderedPaths[1] ?? "", unorderedPaths[0] ?? ""];
    unorderedSnapshot.text = `${unorderedPaths.join("\n")}\n`;
    unorderedSnapshot.contentAddress = sha256ContentAddress(String(unorderedSnapshot.text));
    assert.throws(
      () => frozenLegacyPaths(unorderedSnapshot as Parameters<typeof frozenLegacyPaths>[0]),
      /must be sorted/i,
    );

    const duplicate = structuredClone(FROZEN_LEGACY_ARCHITECTURE_PROVENANCE) as unknown as Record<string, unknown>;
    const duplicateSnapshot = snapshotAt(duplicate, ["runtime", "browserSystemFiles"]);
    const duplicatePaths = String(duplicateSnapshot.text).trimEnd().split("\n");
    duplicatePaths.splice(1, 0, duplicatePaths[0] ?? "");
    duplicateSnapshot.text = `${duplicatePaths.join("\n")}\n`;
    duplicateSnapshot.contentAddress = sha256ContentAddress(String(duplicateSnapshot.text));
    assert.throws(
      () => frozenLegacyPaths(duplicateSnapshot as Parameters<typeof frozenLegacyPaths>[0]),
      /must not contain duplicate paths/i,
    );

    const missingNewline = structuredClone(FROZEN_LEGACY_ARCHITECTURE_PROVENANCE) as unknown as Record<string, unknown>;
    const missingNewlineSnapshot = snapshotAt(missingNewline, ["runtime", "browserSystemFiles"]);
    missingNewlineSnapshot.text = String(missingNewlineSnapshot.text).trimEnd();
    missingNewlineSnapshot.contentAddress = sha256ContentAddress(String(missingNewlineSnapshot.text));
    assert.throws(
      () => frozenLegacyPaths(missingNewlineSnapshot as Parameters<typeof frozenLegacyPaths>[0]),
      /must end with one trailing newline/i,
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
