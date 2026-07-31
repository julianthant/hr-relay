import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import accounting from "../../../config/legacy-change-accounting.json" with { type: "json" };
import capabilities from "../../../config/legacy-capabilities.json" with { type: "json" };
import { LEGACY_REPO_ROOT, gitVisibleFilesIn } from "./helpers/guard-files.js";

interface ChangeRecord {
  readonly path: string;
  readonly beforeSha256: string | null;
  readonly afterSha256: string;
  readonly capabilityIds: readonly string[];
  readonly rebuildRecheckIds: readonly string[];
  readonly preservation: string;
}

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const ACCOUNTED_ROOTS = ["src", "tests"] as const;

function legacyGit(args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd: LEGACY_REPO_ROOT, encoding: "utf8" });
}

/**
 * The baseline file set, read from the legacy repo's own history.
 *
 * D93 retired `legacy-preservation.json`, which used to cache this list beside
 * a whole-file SHA map for the same-tree strict scan. The scan is gone, but the
 * baseline itself is not optional — accounting is a diff against a fixed point.
 * Reading it from `git ls-tree` is strictly better than the cached copy: it
 * cannot go stale, and it removes the manifest D93 deleted.
 */
function baselineFiles(): ReadonlySet<string> {
  return new Set(
    legacyGit(["ls-tree", "-r", "--name-only", accounting.baselineCommit, "--", ...ACCOUNTED_ROOTS])
      .trim().split("\n").filter(Boolean),
  );
}

function currentFiles(): string[] {
  return gitVisibleFilesIn(LEGACY_REPO_ROOT, ACCOUNTED_ROOTS);
}

function baselineBytes(path: string): Buffer {
  return execFileSync("git", ["show", `${accounting.baselineCommit}:${path}`], { cwd: LEGACY_REPO_ROOT });
}

function changedPaths(): Map<string, { before: string | null; after: string }> {
  const baseline = baselineFiles();
  const current = [...currentFiles()].sort();
  const modified = new Set(
    legacyGit(["diff", "--name-only", accounting.baselineCommit, "--", ...ACCOUNTED_ROOTS])
      .trim().split("\n").filter((path) => path.length > 0 && baseline.has(path)),
  );
  const changes = new Map<string, { before: string | null; after: string }>();
  for (const path of current) {
    const added = !baseline.has(path);
    if (!added && !modified.has(path)) continue;
    const after = hash(readFileSync(join(LEGACY_REPO_ROOT, path)));
    const before = added ? null : hash(baselineBytes(path));
    changes.set(path, { before, after });
  }
  return changes;
}

/**
 * D90 accounting, now CROSS-REPO (D93). Every path here is a LEGACY-repo path;
 * the manifest lives in this repo but its subject is the other one. Doc 10
 * §3.13: with the same-tree scan retired, this is "the program's only drift
 * detector" — so it is load-bearing rather than corroborating, and it fails
 * loud when the legacy repo cannot be reached at all (see `guard-files.ts`).
 */
describe("D90 legacy change accounting", () => {
  it("accounts from the explicit Phase-0 base rather than git diff HEAD", () => {
    assert.match(accounting.baselineCommit, /^[a-f0-9]{40}$/);

    const changes = changedPaths();
    const records: readonly ChangeRecord[] = accounting.records;
    const recordedPaths = records.map(({ path }) => path);
    assert.equal(new Set(recordedPaths).size, recordedPaths.length, "change paths must be unique");
    assert.deepEqual(recordedPaths.sort(), [...changes.keys()].sort());

    const capabilityIds = new Set(capabilities.entries.map(({ id }) => id));
    for (const record of records) {
      const actual = changes.get(record.path);
      assert.ok(actual, `stale change record: ${record.path}`);
      assert.equal(record.beforeSha256, actual.before, `${record.path}: before hash`);
      assert.equal(record.afterSha256, actual.after, `${record.path}: after hash`);
      assert.ok(record.capabilityIds.length > 0, `${record.path}: affected capability`);
      assert.ok(record.rebuildRecheckIds.length > 0, `${record.path}: rebuild recheck`);
      assert.equal(record.preservation, "preserved");
      for (const id of record.capabilityIds) assert.ok(capabilityIds.has(id), `${record.path}: ${id}`);
    }
  });
});
