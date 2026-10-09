import { z } from "zod";
import {
  BrowserSystemIdSchema,
  DateOnlySchema,
  ElementIdSchema,
  ObservationIdSchema,
  PageStateIdSchema,
  ScreenIdSchema,
} from "../../../../src/rules/identity/ids.js";
import {
  FROZEN_LEGACY_ARCHITECTURE_PROVENANCE,
  frozenLegacyFile,
} from "../../support/helpers/frozen-legacy-architecture-provenance.js";

export const PINNED_LEGACY_SELECTOR_COMMIT = "793abe1f8265f3213ffe8a80d6cfd9860a32a1dc";

const EXPECTED_COUNTS = {
  crm: 12,
  i9: 41,
  kuali: 22,
  "new-kronos": 54,
  "old-kronos": 23,
  onbase: 28,
  servicenow: 11,
  sharepoint: 10,
  ucpath: 205,
} as const;

const GitBlobSchema = z.string().regex(/^[0-9a-f]{40}$/, "legacy blob must be an exact SHA-1 object id");
const LegacyPathSchema = z.string().regex(
  /^src\/systems\/(?:crm|i9|kuali|new-kronos|old-kronos|onbase|servicenow|sharepoint|ucpath)\/(?:selectors\.ts|SELECTORS\.md)$/,
);
const LegacyKeySchema = z.string().regex(/^[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*\(\)$/);
const SearchTermSchema = z.string().regex(/^[a-z0-9]+(?:[ -][a-z0-9]+)*$/);
const EvidenceReferenceSchema = z.string().regex(/^evidence\/ui\/[a-z0-9/_.-]+\.[a-z0-9]+$/);

export const LegacySelectorSystemSnapshotSchema = z.strictObject({
  system: BrowserSystemIdSchema,
  expectedKeyCount: z.number().int().positive(),
  sourcePath: LegacyPathSchema,
  sourceBlob: GitBlobSchema,
  catalogPath: LegacyPathSchema,
  catalogBlob: GitBlobSchema,
});

const EntryProvenanceSchema = z.strictObject({
  system: BrowserSystemIdSchema,
  legacyKey: LegacyKeySchema,
  searchTerms: z.array(SearchTermSchema).min(1),
  sourcePath: LegacyPathSchema,
  sourceLine: z.number().int().positive(),
  sourceBlob: GitBlobSchema,
  catalogPath: LegacyPathSchema,
  catalogBlob: GitBlobSchema,
});

const VerificationEvidenceSchema = z.strictObject({
  verifiedAt: DateOnlySchema,
  fixtureEvidenceRef: EvidenceReferenceSchema,
  liveReadOnlyEvidenceRef: EvidenceReferenceSchema,
});

export const ContextualElementPortBindingSchema = z.array(z.strictObject({
  context: z.enum([
    "search-results-view-toggle",
    "employment-instances-view-toggle",
    // Separations chunk 4 (D206): `ssSmartHRTransactions.emplIdInput()` names
    // TWO live controls. Legacy fills the Smart HR WIZARD's Page-B Empl ID with
    // the SS Smart HR SEARCH form's key, and live they are
    // `#HR_TBH_WRK_EMPLID_PROMPT2` and `#UC_SS_TBH_DVW_EMPLID`. Binding both by
    // context is what keeps one of them from being demoted to a "fallback".
    "smart-hr-wizard-details",
    "ss-smart-hr-search",
  ]),
  canonicalId: ElementIdSchema,
})).min(2).superRefine((bindings, context) => {
  const contexts = bindings.map((binding) => binding.context);
  if (new Set(contexts).size !== contexts.length) {
    context.addIssue({ code: "custom", message: "contextual element port contexts must be unique" });
  }
});

export const CandidateProposalIdSchema = z.string().regex(
  /^candidate:(?:ucpath|crm|onbase|kuali|servicenow|i9|new-kronos|old-kronos|sharepoint)\/[a-z0-9]+(?:[.-][a-z0-9]+)*$/,
  "candidate proposal id must use the candidate:<system>/<proposal> namespace",
);

export const LegacySelectorPortEntrySchema = z.union([
  EntryProvenanceSchema.extend({
    disposition: z.literal("candidate"),
    semanticKind: z.literal("unclassified"),
    candidateId: CandidateProposalIdSchema,
  }),
  EntryProvenanceSchema.extend({
    disposition: z.literal("ported"),
    semanticKind: z.literal("screen"),
    canonicalId: ScreenIdSchema,
    evidence: VerificationEvidenceSchema,
  }),
  EntryProvenanceSchema.extend({
    disposition: z.literal("ported"),
    semanticKind: z.literal("element"),
    canonicalId: ElementIdSchema,
    evidence: VerificationEvidenceSchema,
  }),
  EntryProvenanceSchema.extend({
    disposition: z.literal("ported"),
    semanticKind: z.literal("element"),
    canonicalBindings: ContextualElementPortBindingSchema,
    evidence: VerificationEvidenceSchema,
  }),
  EntryProvenanceSchema.extend({
    disposition: z.literal("ported"),
    semanticKind: z.literal("page-state"),
    canonicalId: PageStateIdSchema,
    evidence: VerificationEvidenceSchema,
  }),
  EntryProvenanceSchema.extend({
    disposition: z.literal("ported"),
    semanticKind: z.literal("observation"),
    canonicalId: ObservationIdSchema,
    evidence: VerificationEvidenceSchema,
  }),
  EntryProvenanceSchema.extend({
    disposition: z.literal("driver-internal"),
    semanticKind: z.literal("driver-internal"),
    reason: z.string().min(1),
  }),
  EntryProvenanceSchema.extend({
    disposition: z.literal("not-porting"),
    semanticKind: z.literal("not-porting"),
    reason: z.string().min(1),
  }),
]);

export const LegacySelectorPortMapSchema = z.strictObject({
  schemaVersion: z.literal(1),
  legacyCommit: z.literal(PINNED_LEGACY_SELECTOR_COMMIT),
  legacyObjectFormat: z.literal("sha1"),
  systems: z.array(LegacySelectorSystemSnapshotSchema).length(9),
  entries: z.array(LegacySelectorPortEntrySchema).length(406),
});

export type LegacySelectorPortMap = z.infer<typeof LegacySelectorPortMapSchema>;
type LegacySelectorPortEntry = LegacySelectorPortMap["entries"][number];

function camelToKebab(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

function candidateId(system: keyof typeof EXPECTED_COUNTS, legacyKey: string): string {
  const path = legacyKey.slice(0, -2).split(".").map(camelToKebab).join(".");
  return CandidateProposalIdSchema.parse(`candidate:${system}/${path}`);
}

export function assertLegacySelectorDefinitionAtLine(
  source: string,
  legacyKey: string,
  sourceLine: number,
): void {
  const method = legacyKey.slice(0, -2).split(".").at(-1);
  const line = source.split("\n")[sourceLine - 1];
  if (method === undefined || line === undefined
    || (!line.includes(`${method}:`) && !line.includes(`function ${method}(`))) {
    throw new Error(`${legacyKey} has no selector definition at pinned source line ${String(sourceLine)}`);
  }
}

function parseCatalog(system: keyof typeof EXPECTED_COUNTS, catalog: string): readonly {
  legacyKey: string;
  sourceLine: number;
  searchTerms: readonly string[];
}[] {
  const lines = catalog.split("\n");
  const entries: { legacyKey: string; sourceLine: number; searchTerms: readonly string[] }[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const heading = /^## `([^`]+\(\))`(?: — verified \d{4}-\d{2}-\d{2})?$/.exec(lines[index] ?? "");
    if (!heading) continue;
    const legacyKey = LegacyKeySchema.parse(heading[1]);
    const nextHeadingOffset = lines.slice(index + 1).findIndex((line) => line.startsWith("## `"));
    const blockEnd = nextHeadingOffset === -1 ? lines.length : index + 1 + nextHeadingOffset;
    const block = lines.slice(index + 1, blockEnd);
    const tagsLine = block.find((line) => line.startsWith("**Tags:** "));
    const sourceLine = block.find((line) => line.startsWith("**Source:** "));
    if (!sourceLine) throw new Error(`${system}.${legacyKey} is missing catalog source provenance`);
    const sourceMatch = /selectors\.ts:(\d+)/.exec(sourceLine);
    if (!sourceMatch) throw new Error(`${system}.${legacyKey} has malformed source provenance`);
    const rawTerms = tagsLine
      ? tagsLine.slice("**Tags:** ".length).split(", ")
      : legacyKey.slice(0, -2).split(".").flatMap((segment) => camelToKebab(segment).split("-"));
    const searchTerms = [...new Set(rawTerms.map((term) => {
      const normalized = camelToKebab(term);
      const parsed = SearchTermSchema.safeParse(normalized);
      if (!parsed.success) throw new Error(`${system}.${legacyKey} has invalid search term ${term}`);
      return parsed.data;
    }))];
    entries.push({ legacyKey, sourceLine: Number(sourceMatch[1]), searchTerms });
  }
  return entries;
}

/** Rebuild the safe candidate inventory from its checked-in exact legacy blobs. */
export function buildLegacySelectorPortMap(
  frozen = FROZEN_LEGACY_ARCHITECTURE_PROVENANCE.selector,
): LegacySelectorPortMap {
  if (frozen.commit !== PINNED_LEGACY_SELECTOR_COMMIT || frozen.objectFormat !== "sha1") {
    throw new Error("frozen selector provenance does not name the pinned SHA-1 legacy commit");
  }
  const systems = Object.entries(EXPECTED_COUNTS).map(([systemValue, expectedKeyCount]) => {
    const system = systemValue as keyof typeof EXPECTED_COUNTS;
    const sourcePath = `src/systems/${system}/selectors.ts`;
    const catalogPath = `src/systems/${system}/SELECTORS.md`;
    return {
      system,
      expectedKeyCount,
      sourcePath,
      sourceBlob: GitBlobSchema.parse(frozenLegacyFile(frozen.files, sourcePath).sourceBlob),
      catalogPath,
      catalogBlob: GitBlobSchema.parse(frozenLegacyFile(frozen.files, catalogPath).sourceBlob),
    };
  });
  const entries = systems.flatMap((snapshot) => {
    const catalog = frozenLegacyFile(frozen.files, snapshot.catalogPath).text;
    const source = frozenLegacyFile(frozen.files, snapshot.sourcePath).text;
    return parseCatalog(snapshot.system, catalog).map((entry) => {
      assertLegacySelectorDefinitionAtLine(source, entry.legacyKey, entry.sourceLine);
      return {
        system: snapshot.system,
        legacyKey: entry.legacyKey,
        candidateId: candidateId(snapshot.system, entry.legacyKey),
        searchTerms: entry.searchTerms,
        sourcePath: snapshot.sourcePath,
        sourceLine: entry.sourceLine,
        sourceBlob: snapshot.sourceBlob,
        catalogPath: snapshot.catalogPath,
        catalogBlob: snapshot.catalogBlob,
        disposition: "candidate" as const,
        semanticKind: "unclassified" as const,
      };
    });
  });
  return LegacySelectorPortMapSchema.parse({
    schemaVersion: 1,
    legacyCommit: PINNED_LEGACY_SELECTOR_COMMIT,
    legacyObjectFormat: "sha1",
    systems,
    entries,
  });
}

const PROHIBITED_PORT_MAP_TEXT = [
  "locator(",
  "getbyrole(",
  "getbytext(",
  "xpath=",
  "css=",
  "data-testid=",
  "screenshot",
  "fallbackrecipe",
];

export function auditLegacySelectorPortMap(input: unknown): readonly string[] {
  const issues: string[] = [];
  const parsed = LegacySelectorPortMapSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);

  const actual = parsed.data;
  const expected = buildLegacySelectorPortMap();
  const identity = (entry: LegacySelectorPortEntry): string => `${entry.system}:${entry.legacyKey}`;
  const identities = actual.entries.map(identity);
  if (new Set(identities).size !== identities.length) issues.push("every legacy selector key must appear exactly once");
  const candidateIds = actual.entries.flatMap((entry) => entry.disposition === "candidate" ? [entry.candidateId] : []);
  if (new Set(candidateIds).size !== candidateIds.length) {
    issues.push("non-authoritative candidate proposal ids must be globally unique");
  }
  const canonicalIds = actual.entries.flatMap((entry) => {
    if (entry.disposition !== "ported") return [];
    return "canonicalBindings" in entry
      ? entry.canonicalBindings.map(({ canonicalId }) => canonicalId)
      : [entry.canonicalId];
  });
  if (new Set(canonicalIds).size !== canonicalIds.length) {
    issues.push("ported semantic ids must be globally unique");
  }
  if (JSON.stringify(actual.systems) !== JSON.stringify(expected.systems)) {
    issues.push("system paths, counts, or git blobs differ from the pinned legacy commit");
  }
  const expectedByIdentity = new Map(expected.entries.map((entry) => [identity(entry), entry]));
  for (const entry of actual.entries) {
    const expectedEntry = expectedByIdentity.get(identity(entry));
    if (!expectedEntry) {
      issues.push(`unknown legacy selector key ${identity(entry)}`);
      continue;
    }
    if (expectedEntry.disposition !== "candidate") {
      issues.push(`generated selector inventory unexpectedly classified ${identity(entry)}`);
      continue;
    }
    const stableActual = {
      system: entry.system,
      legacyKey: entry.legacyKey,
      searchTerms: entry.searchTerms,
      sourcePath: entry.sourcePath,
      sourceLine: entry.sourceLine,
      sourceBlob: entry.sourceBlob,
      catalogPath: entry.catalogPath,
      catalogBlob: entry.catalogBlob,
      candidateId: expectedEntry.candidateId,
      disposition: "candidate" as const,
      semanticKind: "unclassified" as const,
    };
    const stableExpected = {
      system: expectedEntry.system,
      legacyKey: expectedEntry.legacyKey,
      searchTerms: expectedEntry.searchTerms,
      sourcePath: expectedEntry.sourcePath,
      sourceLine: expectedEntry.sourceLine,
      sourceBlob: expectedEntry.sourceBlob,
      catalogPath: expectedEntry.catalogPath,
      catalogBlob: expectedEntry.catalogBlob,
      candidateId: expectedEntry.candidateId,
      disposition: "candidate" as const,
      semanticKind: "unclassified" as const,
    };
    if (JSON.stringify(stableActual) !== JSON.stringify(stableExpected)) {
      issues.push(`provenance or canonical search intent drifted for ${identity(entry)}`);
    }
  }
  if (actual.entries.length !== expected.entries.length) issues.push("selector inventory count differs from pinned catalog");
  const serialized = JSON.stringify(actual).toLowerCase();
  for (const prohibited of PROHIBITED_PORT_MAP_TEXT) {
    if (serialized.includes(prohibited)) issues.push(`port map contains prohibited recipe/capture text: ${prohibited}`);
  }
  return issues;
}
