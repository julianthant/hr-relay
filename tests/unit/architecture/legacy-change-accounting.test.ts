import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import accounting from "../../../config/legacy-change-accounting.json" with { type: "json" };
import capabilities from "../../../config/legacy-capabilities.json" with { type: "json" };
import { LEGACY_REPO_ROOT } from "./helpers/guard-files.js";
import {
  legacyChangeAccountingViolations,
  type LegacyAccountingPathChange,
  type LegacyChangeAccountingAuditInput,
  type LegacyChangeAccountingManifest,
  type LegacyChangeKind,
  type LegacyCommitSnapshot,
  type LegacyPathChange,
  type ReviewedImpactRule,
} from "./helpers/legacy-change-accounting-audit.js";

function manifestChangeKind(value: string): LegacyChangeKind {
  if (value === "added" || value === "modified" || value === "deleted") return value;
  throw new Error(`unsupported accounting changeKind: ${value}`);
}

const changeAccounting: LegacyChangeAccountingManifest = {
  ...accounting,
  commits: accounting.commits.map((commit) => ({
    ...commit,
    changes: commit.changes.map((change) => ({
      ...change,
      changeKind: manifestChangeKind(change.changeKind),
    })),
  })),
};
const ACCOUNTED_ROOTS = ["src", "tests"] as const;

const DAEMON_CAPABILITY_IDS = [
  "legacy-cli-daemon",
  "legacy-workflow-crm-doc-download",
  "legacy-workflow-emergency-contact",
  "legacy-workflow-i9-check",
  "legacy-workflow-i9-lookup",
  "legacy-workflow-kronos-pay-rule",
  "legacy-workflow-oath-signature",
  "legacy-workflow-oath-upload",
  "legacy-workflow-onbase",
  "legacy-workflow-onboarding",
  "legacy-workflow-person-lookup",
  "legacy-workflow-separations",
  "legacy-workflow-work-study",
] as const;

const OCR_CAPABILITY_IDS = [
  "legacy-service-ocr",
  "legacy-workflow-emergency-contact",
  "legacy-workflow-i9-check",
  "legacy-workflow-i9-lookup",
  "legacy-workflow-oath-signature",
  "legacy-workflow-oath-upload",
  "legacy-workflow-ocr",
  "legacy-workflow-onbase",
  "legacy-workflow-person-lookup",
] as const;

/**
 * Every legacy capability that consumes `src/systems/ucpath/**`. Derived by
 * reading the legacy import graph (`grep -rl "systems/ucpath" src/`): eight
 * workflows drive UCPath directly and the OCR form-verify service reads it.
 * A change anywhere in that shared module — the selector registry, the
 * transaction/receipt rules, or the recorded page-state facts the rebuild
 * ports from — can reach every one of them.
 */
const UCPATH_CAPABILITY_IDS = [
  "legacy-service-ocr",
  "legacy-workflow-emergency-contact",
  "legacy-workflow-i9-check",
  "legacy-workflow-oath-signature",
  "legacy-workflow-ocr",
  "legacy-workflow-onboarding",
  "legacy-workflow-person-lookup",
  "legacy-workflow-separations",
  "legacy-workflow-work-study",
] as const;

/**
 * Reviewed D94 affected-capability floor.
 *
 * Rules are intentionally independent of the accounting JSON: a manifest edit
 * cannot lower its own required blast radius. Every matching exact/prefix rule
 * contributes to the required set, and a record may keep justified extras.
 */
const REVIEWED_IMPACT_RULES: readonly ReviewedImpactRule[] = [
  {
    kind: "prefix",
    path: "tests/unit/architecture/",
    capabilityIds: ["legacy-dev-tool-architecture-guards"],
  },
  { kind: "prefix", path: "src/core/daemon/", capabilityIds: DAEMON_CAPABILITY_IDS },
  { kind: "exact", path: "src/core/CLAUDE.md", capabilityIds: DAEMON_CAPABILITY_IDS },
  { kind: "exact", path: "tests/unit/core/daemon.test.ts", capabilityIds: DAEMON_CAPABILITY_IDS },
  { kind: "prefix", path: "src/services/ocr/", capabilityIds: OCR_CAPABILITY_IDS },
  {
    kind: "prefix",
    path: "src/systems/new-kronos/",
    capabilityIds: [
      "legacy-workflow-kronos-pay-rule",
      "legacy-workflow-old-kronos-reports",
      "legacy-workflow-separations",
    ],
  },
  {
    kind: "prefix",
    path: "src/workflows/separations/",
    capabilityIds: ["legacy-workflow-separations"],
  },
  {
    kind: "prefix",
    path: "tests/unit/workflows/separations/",
    capabilityIds: ["legacy-workflow-separations"],
  },
  { kind: "prefix", path: "src/systems/ucpath/", capabilityIds: UCPATH_CAPABILITY_IDS },
  { kind: "prefix", path: "tests/unit/systems/ucpath/", capabilityIds: UCPATH_CAPABILITY_IDS },
  {
    kind: "prefix",
    path: "src/workflows/onboarding/",
    capabilityIds: ["legacy-workflow-onboarding"],
  },
  {
    kind: "prefix",
    path: "tests/unit/workflows/onboarding/",
    capabilityIds: ["legacy-workflow-onboarding"],
  },
];

function legacyGitText(args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd: LEGACY_REPO_ROOT, encoding: "utf8" });
}

function legacyGitBytes(args: readonly string[]): Buffer {
  return execFileSync("git", [...args], { cwd: LEGACY_REPO_ROOT });
}

function legacyGitSucceeds(args: readonly string[]): boolean {
  return spawnSync("git", [...args], { cwd: LEGACY_REPO_ROOT, stdio: "ignore" }).status === 0;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function changeKind(status: string, commit: string, path: string): LegacyChangeKind {
  if (status === "A") return "added";
  if (status === "M") return "modified";
  if (status === "D") return "deleted";
  throw new Error(`${commit}:${path}: unsupported git change status ${status}`);
}

function hashAt(commit: string, path: string): string {
  return sha256(legacyGitBytes(["show", `${commit}:${path}`]));
}

/** Every src/tests commit in exact ancestry order, with commit-local blobs. */
function legacyHistory(): LegacyCommitSnapshot[] {
  const output = legacyGitText([
    "rev-list",
    "--reverse",
    `${changeAccounting.baselineCommit}..HEAD`,
    "--",
    ...ACCOUNTED_ROOTS,
  ]).trim();
  const commits = output === "" ? [] : output.split("\n");
  return commits.map((commit) => {
    const parentCommit = legacyGitText(["rev-parse", `${commit}^1`]).trim();
    const diff = legacyGitText([
      "diff-tree",
      "--no-commit-id",
      "--name-status",
      "--no-renames",
      "-r",
      parentCommit,
      commit,
      "--",
      ...ACCOUNTED_ROOTS,
    ]).trim();
    const changes: LegacyPathChange[] = diff === "" ? [] : diff.split("\n").map((line) => {
      const separator = line.indexOf("\t");
      if (separator < 0) throw new Error(`${commit}: malformed git diff-tree row: ${line}`);
      const status = line.slice(0, separator);
      const path = line.slice(separator + 1);
      const kind = changeKind(status, commit, path);
      return {
        path,
        changeKind: kind,
        beforeSha256: kind === "added" ? null : hashAt(parentCommit, path),
        afterSha256: kind === "deleted" ? null : hashAt(commit, path),
      };
    });
    return { commit, parentCommit, changes };
  });
}

function liveAuditInput(): LegacyChangeAccountingAuditInput {
  const dirtyStatus = legacyGitText([
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    ...ACCOUNTED_ROOTS,
  ]).trimEnd();
  return {
    manifest: changeAccounting,
    history: legacyHistory(),
    knownCapabilityIds: new Set(capabilities.entries.map(({ id }) => id)),
    impactRules: REVIEWED_IMPACT_RULES,
    dirtyStatus,
    baselineExists: legacyGitSucceeds(["cat-file", "-e", `${changeAccounting.baselineCommit}^{commit}`]),
    baselineIsAncestor: legacyGitSucceeds([
      "merge-base",
      "--is-ancestor",
      changeAccounting.baselineCommit,
      "HEAD",
    ]),
  };
}

const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);
const COMMIT_E = "e".repeat(40);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const FIXTURE_PATH = "src/example.ts";

function fixturePathChange(
  overrides: Partial<LegacyAccountingPathChange> = {},
): LegacyAccountingPathChange {
  return {
    path: FIXTURE_PATH,
    changeKind: "modified",
    beforeSha256: HASH_C,
    afterSha256: HASH_D,
    capabilityIds: ["legacy-cap-a"],
    impactRationale: "The fixture path affects capability A.",
    rebuildRecheckIds: ["fixture-recheck"],
    ...overrides,
  };
}

function fixtureManifest(
  changes: readonly LegacyAccountingPathChange[] = [fixturePathChange()],
): LegacyChangeAccountingManifest {
  return {
    schemaVersion: 2,
    baselineCommit: COMMIT_B,
    accountedRoots: ["src", "tests"],
    deletionPolicy: "forbidden-through-initial-cutover",
    closedRecheckCatalog: [{
      id: "fixture-recheck",
      closedAt: "2026-07-31",
      evidence: ["fixture evidence"],
    }],
    commits: [{ commit: COMMIT_A, parentCommit: COMMIT_B, changes }],
  };
}

function fixtureHistory(
  changes: readonly LegacyPathChange[] = [{
    path: FIXTURE_PATH,
    changeKind: "modified",
    beforeSha256: HASH_C,
    afterSha256: HASH_D,
  }],
): readonly LegacyCommitSnapshot[] {
  return [{ commit: COMMIT_A, parentCommit: COMMIT_B, changes }];
}

function fixtureInput(
  overrides: Partial<LegacyChangeAccountingAuditInput> = {},
): LegacyChangeAccountingAuditInput {
  return {
    manifest: fixtureManifest(),
    history: fixtureHistory(),
    knownCapabilityIds: new Set(["legacy-cap-a"]),
    impactRules: [{ kind: "exact", path: FIXTURE_PATH, capabilityIds: ["legacy-cap-a"] }],
    dirtyStatus: "",
    baselineExists: true,
    baselineIsAncestor: true,
    ...overrides,
  };
}

// These guards shell out to `git` across BOTH repositories — hundreds of
// blob reads per run. Alone they take ~10s; under full-suite fork parallelism
// they exceed the 30s default. The work is real, so the budget is raised
// rather than the audit narrowed.
describe("D94 legacy change accounting", { timeout: 180_000 }, () => {
  it("binds every ordered legacy src/tests commit and path to its named commit blobs", () => {
    assert.equal(changeAccounting.baselineCommit, capabilities.baselineCommit);
    const baselineFiles = legacyGitText([
      "ls-tree",
      "-r",
      "--name-only",
      changeAccounting.baselineCommit,
      "--",
      ...ACCOUNTED_ROOTS,
    ]).trim().split("\n").filter(Boolean);
    assert.ok(baselineFiles.length > 0, "the Phase-0 baseline file set must come from legacy Git history");
    const input = liveAuditInput();
    assert.deepEqual(legacyChangeAccountingViolations(input), []);
    for (const { commit } of changeAccounting.commits) {
      assert.ok(
        legacyGitSucceeds(["merge-base", "--is-ancestor", changeAccounting.baselineCommit, commit]),
        `${commit}: must descend from the Phase-0 baseline`,
      );
      assert.ok(
        legacyGitSucceeds(["merge-base", "--is-ancestor", commit, "HEAD"]),
        `${commit}: must be an ancestor of legacy HEAD`,
      );
    }
  });

  it("rejects missing and unknown commit records", () => {
    const base = fixtureInput();
    assert.match(
      legacyChangeAccountingViolations({ ...base, manifest: { ...base.manifest, commits: [] } }).join("\n"),
      /missing commit record/,
    );
    const unknownCommit = { ...base.manifest.commits[0], commit: COMMIT_E };
    assert.match(
      legacyChangeAccountingViolations({
        ...base,
        manifest: { ...base.manifest, commits: [...base.manifest.commits, unknownCommit] },
      }).join("\n"),
      /unknown or out-of-range commit record/,
    );
  });

  it("rejects missing paths, stale path records, and commit-local stale hashes", () => {
    const base = fixtureInput();
    const emptyChanges = [{ ...base.manifest.commits[0], changes: [] }];
    assert.match(
      legacyChangeAccountingViolations({
        ...base,
        manifest: { ...base.manifest, commits: emptyChanges },
      }).join("\n"),
      /missing path record/,
    );
    const stalePath = fixturePathChange({ path: "src/stale.ts" });
    assert.match(
      legacyChangeAccountingViolations({
        ...base,
        manifest: fixtureManifest([stalePath]),
      }).join("\n"),
      /stale path record/,
    );
    const staleHash = fixturePathChange({ beforeSha256: "f".repeat(64) });
    assert.match(
      legacyChangeAccountingViolations({
        ...base,
        manifest: fixtureManifest([staleHash]),
      }).join("\n"),
      /stale before hash for named commit/,
    );
  });

  it("models deletion but rejects it through initial cutover", () => {
    const deletedHistory: LegacyPathChange = {
      path: FIXTURE_PATH,
      changeKind: "deleted",
      beforeSha256: HASH_C,
      afterSha256: null,
    };
    const deletedRecord = fixturePathChange({
      changeKind: "deleted",
      beforeSha256: HASH_C,
      afterSha256: null,
    });
    const base = fixtureInput({
      manifest: fixtureManifest([deletedRecord]),
      history: fixtureHistory([deletedHistory]),
    });
    assert.match(legacyChangeAccountingViolations(base).join("\n"), /deletion is forbidden/);
  });

  it("treats unstaged, staged, and untracked legacy src/tests state as unaccountable", () => {
    for (const dirtyStatus of [
      " D src/unstaged-delete.ts",
      "D  src/staged-delete.ts",
      "?? tests/untracked.test.ts",
    ]) {
      assert.match(
        legacyChangeAccountingViolations(fixtureInput({ dirtyStatus })).join("\n"),
        /must be clean before accounting by commit/,
        dirtyStatus,
      );
    }
  });

  it("rejects inadequate impact mapping and unknown recheck evidence", () => {
    const impactInput = fixtureInput({
      knownCapabilityIds: new Set(["legacy-cap-a", "legacy-cap-b"]),
      impactRules: [{
        kind: "prefix",
        path: "src/",
        capabilityIds: ["legacy-cap-a", "legacy-cap-b"],
      }],
    });
    assert.match(
      legacyChangeAccountingViolations(impactInput).join("\n"),
      /missing required affected capability legacy-cap-b/,
    );
    const unknownRecheck = fixturePathChange({ rebuildRecheckIds: ["not-closed"] });
    assert.match(
      legacyChangeAccountingViolations({
        ...fixtureInput(),
        manifest: fixtureManifest([unknownRecheck]),
      }).join("\n"),
      /unknown or open rebuild recheck id not-closed/,
    );
  });

  it("fails when the baseline is missing or is not ancestral", () => {
    assert.match(
      legacyChangeAccountingViolations(fixtureInput({ baselineExists: false })).join("\n"),
      /baseline commit does not exist/,
    );
    assert.match(
      legacyChangeAccountingViolations(fixtureInput({ baselineIsAncestor: false })).join("\n"),
      /baseline commit is not an ancestor/,
    );
  });
});
