import { createHash } from "node:crypto";
import { z } from "zod";
import rawProvenance from "../../../config/ports/legacy-architecture-provenance.json" with { type: "json" };

/**
 * These facts intentionally live outside the mutable JSON payload. A payload
 * that carries both an inventory and its digest is self-authenticating: an
 * edit can replace both values. This anchor binds every legacy source revision,
 * generated-snapshot identity, frozen source-blob provenance, redaction policy,
 * and the complete sanitized payload to this guard's code.
 */
const FROZEN_PROVENANCE_ANCHORS = {
  schemaVersion: 2,
  payloadContentAddress: "sha256:99bf648dd1691edd132ec8e0d3105e7b8b3d71f4d1c847d0a57676104a5017d0",
  sourceRedaction: {
    policy: "zero-direct-identifiers-v1",
    ssnReplacement: "000000000",
    ucsdEidReplacement: "00000000",
  },
  selector: {
    commit: "793abe1f8265f3213ffe8a80d6cfd9860a32a1dc",
    files: [
      ["src/systems/crm/SELECTORS.md", "5b928a9bd686727fb10700a61ac116138df7eb44"],
      ["src/systems/crm/selectors.ts", "e63530d375478dd330d07460c740f2027dbd7bdd"],
      ["src/systems/i9/SELECTORS.md", "0302ce0eb941aa62a4a5739a39e6b1c2fd6ef76b"],
      ["src/systems/i9/selectors.ts", "8df7df2fb8738e98eccec822d3859a4d1d4d644c"],
      ["src/systems/kuali/SELECTORS.md", "9a152606c127a186fc9fd9b40d9c1744d7027932"],
      ["src/systems/kuali/selectors.ts", "1c55c7d307891e07951ca38a89548418bdc23f49"],
      ["src/systems/new-kronos/SELECTORS.md", "6645bab491b9157b8958a479c354c6607ae77a0e"],
      ["src/systems/new-kronos/selectors.ts", "4143290c85acf70d0730ad4c1c97b243bbd74208"],
      ["src/systems/old-kronos/SELECTORS.md", "07ad175356d1597eb5cf88649babe51c55b9bb81"],
      ["src/systems/old-kronos/selectors.ts", "ec373ce32bcef315466030c00d711e485712e789"],
      ["src/systems/onbase/SELECTORS.md", "2d0cdd0dbd7e6ae9dac77b863d04f86251be921c"],
      ["src/systems/onbase/selectors.ts", "3189846425dd1ded3e2847dde4811093b5ec4185"],
      ["src/systems/servicenow/SELECTORS.md", "b8458941ed8465196dbd2565d8ca55d057031c9d"],
      ["src/systems/servicenow/selectors.ts", "87b029469a77fa4d2760f06dca4dcaf5258f28e5"],
      ["src/systems/sharepoint/SELECTORS.md", "c29f4e2f80b18e1ff040f2b36cc6e72636fd5a7b"],
      ["src/systems/sharepoint/selectors.ts", "71505d63b7316edcd8a64a8a3cf32e92ed57f8c8"],
      ["src/systems/ucpath/SELECTORS.md", "b9f19d3e709d6502a65a613b8f9a8ce470563b0a"],
      ["src/systems/ucpath/selectors.ts", "695d88fcc7a108f262b91b45eb1b9a276deaf427"],
    ],
  },
  runtime: {
    commit: "9d19e4141d57617e2bf895e21e34a5bd8f15047c",
    browserSystemFiles: {
      name: "legacy-browser-system-files",
      sourceCommand: "git ls-tree -r --name-only 9d19e4141d57617e2bf895e21e34a5bd8f15047c -- src/systems",
      contentAddress: "sha256:d0a90aa07b59e544a0f766dc6b3b4181a55ee287302410b9870e6f7aef50e808",
    },
    files: [["src/services/ocr/provider-limits.ts", "7d31e2bfa22db12730b5b25985a6db20049a59db"]],
  },
  capabilities: {
    commit: "9d19e4141d57617e2bf895e21e34a5bd8f15047c",
    discoveredPaths: {
      name: "legacy-capability-discovered-paths",
      sourceCommand: "jq -r '[.entries[].sourcePaths[]] | sort[]' config/legacy-capabilities.json",
      contentAddress: "sha256:1701fb3ec3dec90acdf16b8b4f8b5c7c70f2181a57e4c157216e3bfb861560e8",
    },
    sourcePaths: {
      name: "legacy-capability-source-paths",
      sourceCommand: "jq -r '[.entries[].sourcePaths[]] | sort[]' config/legacy-capabilities.json",
      contentAddress: "sha256:1701fb3ec3dec90acdf16b8b4f8b5c7c70f2181a57e4c157216e3bfb861560e8",
    },
    legacyPaths: {
      name: "legacy-capability-evidence-paths",
      sourceCommand: "jq -r '[.entries[].sourcePaths[], \"src/services/timecard/index.ts\"] | sort[]' config/legacy-capabilities.json",
      contentAddress: "sha256:bd390da0640f495998f5ab29c456dbde0587ed773c22a40ce91e6495ccf581fc",
    },
  },
  testDisposition: {
    baselineCommit: "353739ac9e1db01cae9da8a13da53605cd767574",
    baselineFiles: {
      name: "legacy-test-baseline-files",
      sourceCommand: "git ls-tree -r --name-only 353739ac9e1db01cae9da8a13da53605cd767574 -- tests | grep -v '^tests/rebuild/'",
      contentAddress: "sha256:254653487de057b60f073462503d3e7b49057743d23c4a4c0da8fc371dfe5d9f",
    },
    currentCommit: "9d19e4141d57617e2bf895e21e34a5bd8f15047c",
    currentFiles: {
      name: "legacy-test-current-files",
      sourceCommand: "git ls-tree -r --name-only 9d19e4141d57617e2bf895e21e34a5bd8f15047c -- tests | grep -v '^tests/rebuild/'",
      contentAddress: "sha256:c9a63a4345e23437c26ebf5a2023c7c1ca87c208312df0401d72af722b18a062",
    },
  },
  canonicalFields: {
    commit: "4deabc5afc4f97b33959a0802ce2090cb3b30a07",
    files: [
      ["src/domain/delegation-input-fragments.ts", "ca157e565b85f521aaa8df30425c4c4f8228b038"],
      ["src/services/matching/roster-loader.ts", "e0cde5d072e2064f1451b4a39b44009191b59884"],
      ["src/services/ocr/forms/emergency-contact.ts", "0cc686ecd075fb9984218a94e780da4936aeaccd"],
      ["src/services/ocr/forms/i9.ts", "f14431c5d10c70365cec97b16cf7ab7a2d4be579"],
      ["src/services/ocr/forms/oath.ts", "9952f82fa55c13d5e5496056027e60abcc409e32"],
      ["src/services/ocr/forms/shared.ts", "70d25e10e055e52758ef34607dca157242488c2b"],
      ["src/workflows/crm-doc-download/schema.ts", "cf254a5c6f22d4d71f35af579e5920f2cc0c0e6b"],
      ["src/workflows/emergency-contact/schema.ts", "d265ae8c97cd38521a70301ed60fa28eac5267e8"],
      ["src/workflows/emergency-contact/workflow.ts", "c3b2103e1621ab5dea2184db50b33510e5a66546"],
      ["src/workflows/i9-check/schema.ts", "770b4358e3e9aad743d12fd6a93aeec2787c05f3"],
      ["src/workflows/i9-lookup/schema.ts", "f242077ddd3503a12b133bfa96ea347adc8cc7d2"],
      ["src/workflows/kronos-pay-rule/schema.ts", "6241a52263fd9981f4e9bfc49a2f29d92216a21f"],
      ["src/workflows/oath-signature/schema.ts", "66db13a93a009014d33ca4cdd1aeef3d7891f3d0"],
      ["src/workflows/oath-signature/workflow.ts", "e138b5a36e1ebd40d72fc0ccaad7bcfac5e4a354"],
      ["src/workflows/oath-upload/schema.ts", "5c9784171ca63cd0d815484ec6f2b83dd8149607"],
      ["src/workflows/ocr/schema.ts", "f3fe921d88b1424af0875c72d6596e411a8b378e"],
      ["src/workflows/old-kronos-reports/schema.ts", "47293b15517009b6773d41b4c70eddb89f980c15"],
      ["src/workflows/onbase/schema.ts", "c401bead4750e6d59112ad72107fe657c7e2d381"],
      ["src/workflows/onboarding/schema.ts", "854ad3423c11fd6d1fec646e105d9b083000940f"],
      ["src/workflows/person-lookup/schema.ts", "57573d01eabf359bf780254cd2fd6935d4eeec85"],
      ["src/workflows/separations/schema.ts", "08be75b7d9b3f20c6c639148737d149794a873a0"],
      ["src/workflows/separations/workflow.ts", "b292a0366f309a3feb0b08cd6fbf2b982209fdb9"],
      ["src/workflows/sharepoint-download/schema.ts", "7d07271649912ff078b86ee5bc2050aff62e24d2"],
      ["src/workflows/work-study/schema.ts", "69f4134a901e3d90fd88bc5c22e93f541353c768"],
    ],
  },
  operationalIsolation: {
    commit: "9d19e4141d57617e2bf895e21e34a5bd8f15047c",
    files: [["package.json", "fd94ce86cef204cd40569f9b7728a2c5999ffc57"]],
  },
} as const;

const CommitSchema = z.string().regex(/^[0-9a-f]{40}$/u, "legacy commit must be an exact SHA-1 commit id");
const BlobSchema = z.string().regex(/^[0-9a-f]{40}$/u, "legacy blob must be an exact SHA-1 object id");
const ContentAddressSchema = z.string().regex(
  /^sha256:[0-9a-f]{64}$/u,
  "frozen snapshot needs a SHA-256 content address",
);
const FrozenFileSchema = z.strictObject({
  path: z.string().min(1),
  sourceBlob: BlobSchema,
  contentAddress: ContentAddressSchema,
  text: z.string(),
});

const FrozenFilesSchema = z.array(FrozenFileSchema).min(1).superRefine((files, context) => {
  const paths = files.map(({ path }) => path);
  if (new Set(paths).size !== paths.length) {
    context.addIssue({ code: "custom", message: "frozen legacy file paths must be unique" });
  }
});

/**
 * Unlike a Git blob, a path inventory is a generated snapshot: it represents
 * the output of the named legacy collection command, not an object reachable
 * from the legacy commit. Its SHA-256 authenticates the exact UTF-8 bytes.
 */
const FrozenPathSnapshotSchema = z.strictObject({
  name: z.string().regex(/^[a-z0-9-]+$/u, "frozen path snapshot name must be kebab-case"),
  sourceCommand: z.string().min(1),
  contentAddress: ContentAddressSchema,
  text: z.string(),
});

export const FrozenLegacyArchitectureProvenanceSchema = z.strictObject({
  schemaVersion: z.literal(2),
  selector: z.strictObject({
    commit: CommitSchema,
    objectFormat: z.literal("sha1"),
    files: FrozenFilesSchema,
  }),
  runtime: z.strictObject({
    commit: CommitSchema,
    browserSystemFiles: FrozenPathSnapshotSchema,
    visionProvider: FrozenFileSchema,
  }),
  capabilities: z.strictObject({
    commit: CommitSchema,
    discoveredPaths: FrozenPathSnapshotSchema,
    sourcePaths: FrozenPathSnapshotSchema,
    legacyPaths: FrozenPathSnapshotSchema,
  }),
  testDisposition: z.strictObject({
    baselineCommit: CommitSchema,
    baselineFiles: FrozenPathSnapshotSchema,
    currentCommit: CommitSchema,
    currentFiles: FrozenPathSnapshotSchema,
  }),
  canonicalFields: z.strictObject({
    commit: CommitSchema,
    files: FrozenFilesSchema,
  }),
  operationalIsolation: z.strictObject({
    commit: CommitSchema,
    package: FrozenFileSchema.extend({
      path: z.literal("package.json"),
    }),
  }),
  sourceRedaction: z.strictObject({
    policy: z.literal("zero-direct-identifiers-v1"),
    ssnReplacement: z.literal("000000000"),
    ucsdEidReplacement: z.literal("00000000"),
  }),
});

export type FrozenLegacyFile = z.infer<typeof FrozenFileSchema>;
export type FrozenPathSnapshot = z.infer<typeof FrozenPathSnapshotSchema>;
export type FrozenLegacyArchitectureProvenance = z.infer<typeof FrozenLegacyArchitectureProvenanceSchema>;

function assertAnchorValue(scope: string, field: string, actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error(`frozen legacy ${scope} anchor mismatch for ${field}: expected ${expected}; actual ${actual}`);
  }
}

function assertFrozenFileAnchors(
  scope: string,
  files: readonly FrozenLegacyFile[],
  expected: readonly (readonly [string, string])[],
): void {
  if (files.length !== expected.length) {
    throw new Error(
      `frozen legacy ${scope} file-anchor count mismatch: expected ${String(expected.length)}; actual ${String(files.length)}`,
    );
  }
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const expectedRecord = expected[index];
    if (file === undefined || expectedRecord === undefined) {
      throw new Error(`frozen legacy ${scope} file-anchor is missing record ${String(index)}`);
    }
    const [expectedPath, expectedBlob] = expectedRecord;
    assertAnchorValue(`${scope} file`, `path[${String(index)}]`, file.path, expectedPath);
    assertAnchorValue(`${scope} file`, expectedPath, file.sourceBlob, expectedBlob);
  }
}

function assertFrozenPathSnapshotAnchor(
  scope: string,
  snapshot: FrozenPathSnapshot,
  expected: { readonly name: string; readonly sourceCommand: string; readonly contentAddress: string },
): void {
  assertAnchorValue(`${scope} snapshot`, "name", snapshot.name, expected.name);
  assertAnchorValue(`${scope} snapshot`, "sourceCommand", snapshot.sourceCommand, expected.sourceCommand);
  assertAnchorValue(`${scope} snapshot`, "contentAddress", snapshot.contentAddress, expected.contentAddress);
}

function assertFrozenProvenanceAnchors(provenance: FrozenLegacyArchitectureProvenance): void {
  assertAnchorValue(
    "payload",
    "schemaVersion",
    String(provenance.schemaVersion),
    String(FROZEN_PROVENANCE_ANCHORS.schemaVersion),
  );
  assertAnchorValue(
    "source redaction",
    "policy",
    provenance.sourceRedaction.policy,
    FROZEN_PROVENANCE_ANCHORS.sourceRedaction.policy,
  );
  assertAnchorValue(
    "source redaction",
    "ssnReplacement",
    provenance.sourceRedaction.ssnReplacement,
    FROZEN_PROVENANCE_ANCHORS.sourceRedaction.ssnReplacement,
  );
  assertAnchorValue(
    "source redaction",
    "ucsdEidReplacement",
    provenance.sourceRedaction.ucsdEidReplacement,
    FROZEN_PROVENANCE_ANCHORS.sourceRedaction.ucsdEidReplacement,
  );
  assertAnchorValue("selector", "commit", provenance.selector.commit, FROZEN_PROVENANCE_ANCHORS.selector.commit);
  assertFrozenFileAnchors("selector", provenance.selector.files, FROZEN_PROVENANCE_ANCHORS.selector.files);

  assertAnchorValue("runtime", "commit", provenance.runtime.commit, FROZEN_PROVENANCE_ANCHORS.runtime.commit);
  assertFrozenPathSnapshotAnchor(
    "runtime.browserSystemFiles",
    provenance.runtime.browserSystemFiles,
    FROZEN_PROVENANCE_ANCHORS.runtime.browserSystemFiles,
  );
  assertFrozenFileAnchors("runtime", [provenance.runtime.visionProvider], FROZEN_PROVENANCE_ANCHORS.runtime.files);

  assertAnchorValue("capabilities", "commit", provenance.capabilities.commit, FROZEN_PROVENANCE_ANCHORS.capabilities.commit);
  assertFrozenPathSnapshotAnchor(
    "capabilities.discoveredPaths",
    provenance.capabilities.discoveredPaths,
    FROZEN_PROVENANCE_ANCHORS.capabilities.discoveredPaths,
  );
  assertFrozenPathSnapshotAnchor(
    "capabilities.sourcePaths",
    provenance.capabilities.sourcePaths,
    FROZEN_PROVENANCE_ANCHORS.capabilities.sourcePaths,
  );
  assertFrozenPathSnapshotAnchor(
    "capabilities.legacyPaths",
    provenance.capabilities.legacyPaths,
    FROZEN_PROVENANCE_ANCHORS.capabilities.legacyPaths,
  );

  assertAnchorValue(
    "testDisposition",
    "baselineCommit",
    provenance.testDisposition.baselineCommit,
    FROZEN_PROVENANCE_ANCHORS.testDisposition.baselineCommit,
  );
  assertFrozenPathSnapshotAnchor(
    "testDisposition.baselineFiles",
    provenance.testDisposition.baselineFiles,
    FROZEN_PROVENANCE_ANCHORS.testDisposition.baselineFiles,
  );
  assertAnchorValue(
    "testDisposition",
    "currentCommit",
    provenance.testDisposition.currentCommit,
    FROZEN_PROVENANCE_ANCHORS.testDisposition.currentCommit,
  );
  assertFrozenPathSnapshotAnchor(
    "testDisposition.currentFiles",
    provenance.testDisposition.currentFiles,
    FROZEN_PROVENANCE_ANCHORS.testDisposition.currentFiles,
  );

  assertAnchorValue(
    "canonicalFields",
    "commit",
    provenance.canonicalFields.commit,
    FROZEN_PROVENANCE_ANCHORS.canonicalFields.commit,
  );
  assertFrozenFileAnchors(
    "canonicalFields",
    provenance.canonicalFields.files,
    FROZEN_PROVENANCE_ANCHORS.canonicalFields.files,
  );

  assertAnchorValue(
    "operationalIsolation",
    "commit",
    provenance.operationalIsolation.commit,
    FROZEN_PROVENANCE_ANCHORS.operationalIsolation.commit,
  );
  assertFrozenFileAnchors(
    "operationalIsolation",
    [provenance.operationalIsolation.package],
    FROZEN_PROVENANCE_ANCHORS.operationalIsolation.files,
  );
  assertAnchorValue(
    "payload",
    "contentAddress",
    pathSnapshotSha256(JSON.stringify(provenance)),
    FROZEN_PROVENANCE_ANCHORS.payloadContentAddress,
  );
}

function pathSnapshotSha256(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

function assertFrozenFileContentAddress(file: FrozenLegacyFile): void {
  const actual = pathSnapshotSha256(file.text);
  if (actual !== file.contentAddress) {
    throw new Error(
      `frozen legacy file content-address mismatch for ${file.path}: expected ${file.contentAddress}; actual ${actual}`,
    );
  }
}

/** Authenticate and parse a generated legacy path snapshot before exposing it. */
export function frozenLegacyPaths(snapshot: FrozenPathSnapshot): readonly string[] {
  const actual = pathSnapshotSha256(snapshot.text);
  if (actual !== snapshot.contentAddress) {
    throw new Error(
      `frozen legacy path snapshot content-address mismatch for ${snapshot.name}: expected ${snapshot.contentAddress}; actual ${actual}`,
    );
  }
  if (!snapshot.text.endsWith("\n")) {
    throw new Error(`frozen legacy path snapshot ${snapshot.name} must end with one trailing newline`);
  }
  const paths = snapshot.text.slice(0, -1).split("\n");
  if (paths.length === 0 || paths[0] === "") {
    throw new Error(`frozen legacy path snapshot ${snapshot.name} must not be empty`);
  }
  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index] ?? "";
    if (path.length === 0 || path.trim() !== path) {
      throw new Error(`frozen legacy path snapshot ${snapshot.name} has a malformed path entry`);
    }
    const previous = paths[index - 1];
    if (previous !== undefined && previous === path) {
      throw new Error(`frozen legacy path snapshot ${snapshot.name} must not contain duplicate paths`);
    }
    if (previous !== undefined && previous > path) {
      throw new Error(`frozen legacy path snapshot ${snapshot.name} must be sorted`);
    }
  }
  return Object.freeze(paths);
}

function assertFrozenProvenanceIntegrity(provenance: FrozenLegacyArchitectureProvenance): void {
  for (const file of [
    ...provenance.selector.files,
    provenance.runtime.visionProvider,
    ...provenance.canonicalFields.files,
    provenance.operationalIsolation.package,
  ]) {
    assertFrozenFileContentAddress(file);
  }
  for (const snapshot of [
    provenance.runtime.browserSystemFiles,
    provenance.capabilities.discoveredPaths,
    provenance.capabilities.sourcePaths,
    provenance.capabilities.legacyPaths,
    provenance.testDisposition.baselineFiles,
    provenance.testDisposition.currentFiles,
  ]) {
    frozenLegacyPaths(snapshot);
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export function parseFrozenLegacyArchitectureProvenance(input: unknown): FrozenLegacyArchitectureProvenance {
  const provenance = FrozenLegacyArchitectureProvenanceSchema.parse(input);
  assertFrozenProvenanceIntegrity(provenance);
  assertFrozenProvenanceAnchors(provenance);
  return deepFreeze(provenance);
}

export const FROZEN_LEGACY_ARCHITECTURE_PROVENANCE = parseFrozenLegacyArchitectureProvenance(rawProvenance);

export function frozenLegacyScripts(
  provenance: FrozenLegacyArchitectureProvenance = FROZEN_LEGACY_ARCHITECTURE_PROVENANCE,
): Readonly<Record<string, string>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(provenance.operationalIsolation.package.text);
  } catch {
    throw new Error("frozen legacy package.json is not valid JSON");
  }
  return z.object({ scripts: z.record(z.string(), z.string()) }).passthrough().parse(parsed).scripts;
}

/**
 * The legacy checkout is a porting input, never a finished-gate dependency.
 * A missing source is a corrupt committed snapshot, not permission to skip it.
 */
export function frozenLegacyFile(files: readonly FrozenLegacyFile[], path: string): FrozenLegacyFile {
  const matches = files.filter((file) => file.path === path);
  if (matches.length !== 1) {
    throw new Error(`frozen legacy provenance requires exactly one ${path}; found ${String(matches.length)}`);
  }
  return matches[0];
}
