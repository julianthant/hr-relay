import { execFileSync } from "node:child_process";
import { z } from "zod";
import { BrowserSystemIdSchema, DateOnlySchema, ElementIdSchema } from "../../../../src/domain/ids.js";

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
const EvidenceReferenceSchema = z.string().regex(/^evidence\/ui\/[a-z0-9/_-]+\.[a-z0-9]+$/);

export const LegacySelectorSystemSnapshotSchema = z.strictObject({
  system: BrowserSystemIdSchema,
  expectedKeyCount: z.number().int().positive(),
  sourcePath: LegacyPathSchema,
  sourceBlob: GitBlobSchema,
  catalogPath: LegacyPathSchema,
  catalogBlob: GitBlobSchema,
});

const EntryBaseSchema = z.strictObject({
  system: BrowserSystemIdSchema,
  legacyKey: LegacyKeySchema,
  canonicalId: ElementIdSchema,
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

export const LegacySelectorPortEntrySchema = z.discriminatedUnion("disposition", [
  EntryBaseSchema.extend({ disposition: z.literal("candidate") }),
  EntryBaseSchema.extend({ disposition: z.literal("ported"), evidence: VerificationEvidenceSchema }),
  EntryBaseSchema.extend({ disposition: z.literal("driver-internal"), reason: z.string().min(1) }),
  EntryBaseSchema.extend({ disposition: z.literal("not-porting"), reason: z.string().min(1) }),
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

function git(legacyRoot: string, args: readonly string[]): string {
  return execFileSync("git", ["-C", legacyRoot, ...args], { encoding: "utf8" }).trimEnd();
}

function camelToKebab(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

function canonicalId(system: keyof typeof EXPECTED_COUNTS, legacyKey: string): string {
  const path = legacyKey.slice(0, -2).split(".").map(camelToKebab).join(".");
  return ElementIdSchema.parse(`${system}.${path}`);
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

function blobAt(legacyRoot: string, path: string): string {
  return GitBlobSchema.parse(git(legacyRoot, ["rev-parse", `${PINNED_LEGACY_SELECTOR_COMMIT}:${path}`]));
}

export function buildLegacySelectorPortMap(legacyRoot: string): LegacySelectorPortMap {
  const systems = Object.entries(EXPECTED_COUNTS).map(([systemValue, expectedKeyCount]) => {
    const system = systemValue as keyof typeof EXPECTED_COUNTS;
    const sourcePath = `src/systems/${system}/selectors.ts`;
    const catalogPath = `src/systems/${system}/SELECTORS.md`;
    return {
      system,
      expectedKeyCount,
      sourcePath,
      sourceBlob: blobAt(legacyRoot, sourcePath),
      catalogPath,
      catalogBlob: blobAt(legacyRoot, catalogPath),
    };
  });
  const entries = systems.flatMap((snapshot) => {
    const catalog = git(legacyRoot, ["show", `${PINNED_LEGACY_SELECTOR_COMMIT}:${snapshot.catalogPath}`]);
    return parseCatalog(snapshot.system, catalog).map((entry) => ({
      system: snapshot.system,
      legacyKey: entry.legacyKey,
      canonicalId: canonicalId(snapshot.system, entry.legacyKey),
      searchTerms: entry.searchTerms,
      sourcePath: snapshot.sourcePath,
      sourceLine: entry.sourceLine,
      sourceBlob: snapshot.sourceBlob,
      catalogPath: snapshot.catalogPath,
      catalogBlob: snapshot.catalogBlob,
      disposition: "candidate" as const,
    }));
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

export function auditLegacySelectorPortMap(input: unknown, legacyRoot: string): readonly string[] {
  const issues: string[] = [];
  const parsed = LegacySelectorPortMapSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);

  const actual = parsed.data;
  const expected = buildLegacySelectorPortMap(legacyRoot);
  const identity = (entry: LegacySelectorPortEntry): string => `${entry.system}:${entry.legacyKey}`;
  const identities = actual.entries.map(identity);
  if (new Set(identities).size !== identities.length) issues.push("every legacy selector key must appear exactly once");
  if (new Set(actual.entries.map((entry) => entry.canonicalId)).size !== actual.entries.length) {
    issues.push("candidate canonical ids must be globally unique");
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
    const stableActual = {
      system: entry.system,
      legacyKey: entry.legacyKey,
      canonicalId: entry.canonicalId,
      searchTerms: entry.searchTerms,
      sourcePath: entry.sourcePath,
      sourceLine: entry.sourceLine,
      sourceBlob: entry.sourceBlob,
      catalogPath: entry.catalogPath,
      catalogBlob: entry.catalogBlob,
      disposition: "candidate" as const,
    };
    if (JSON.stringify(stableActual) !== JSON.stringify(expectedEntry)) {
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
