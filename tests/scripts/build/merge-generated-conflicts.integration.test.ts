import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { it } from "vitest";
import { GENERATED_OUTPUTS } from "../../../scripts/build/generated-outputs.js";
import { mergeGeneratedConflicts } from "../../../scripts/build/merge-generated-conflicts.js";
import { collectSourceClosure } from "../../../scripts/build/workflow-build-manifest.js";

const manifest = "src/workflow-kit/validation/generated-build-manifest.ts";
const authored = "workflow.ts";

function fixture(mixed: boolean, run: (root: string, head: string, staging: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "relay-generated-merge-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const put = (path: string, content: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  try {
    git("init", "--initial-branch=staging");
    git("config", "core.autocrlf", "false");
    git("config", "commit.gpgsign", "false");
    git("config", "user.name", "Train fixture");
    git("config", "user.email", "train@example.invalid");
    for (const output of GENERATED_OUTPUTS) for (const path of output.paths) put(path, "base\n");
    put(authored, "base\n");
    git("add", ".");
    git("commit", "-m", "base");
    git("checkout", "-b", "feature");
    put(manifest, "feature manifest\n");
    put(authored, "feature workflow\n");
    git("commit", "-am", "feature");
    const head = git("rev-parse", "HEAD");
    git("checkout", "staging");
    put(manifest, "staging manifest\n");
    put(mixed ? authored : "staging.ts", "staging workflow\n");
    git("add", ".");
    git("commit", "-m", "staging");
    const staging = git("rev-parse", "HEAD");
    git("checkout", "feature");
    run(root, head, staging);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

it("resolves generated conflicts from the combined sources and retains both merge parents", () => {
  fixture(false, (root, head, staging) => {
    assert.equal(mergeGeneratedConflicts(root, staging, checkout => {
      assert.equal(readFileSync(join(checkout, authored), "utf8"), "feature workflow\n");
      assert.equal(readFileSync(join(checkout, "staging.ts"), "utf8"), "staging workflow\n");
      writeFileSync(join(checkout, manifest), "regenerated combined manifest\n");
    }), true);
    execFileSync("git", ["commit", "-m", "merge"], { cwd: root });
    const parents = execFileSync("git", ["show", "-s", "--format=%P", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    assert.equal(parents, `${head} ${staging}`);
    assert.equal(readFileSync(join(root, manifest), "utf8"), "regenerated combined manifest\n");
  });
});

it("keeps the generated manifest import resolvable while computing fresh source fingerprints", () => {
  fixture(false, (root, _head, staging) => {
    writeFileSync(join(root, authored), `import "./${manifest.replace(/\.ts$/u, ".js")}";\n`);
    execFileSync("git", ["commit", "-am", "reference generated manifest"], { cwd: root });
    assert.equal(mergeGeneratedConflicts(root, staging, checkout => {
      assert.deepEqual(collectSourceClosure(checkout, join(checkout, authored)).map(source => source.path), [authored]);
      writeFileSync(join(checkout, manifest), "regenerated combined manifest\n");
    }), true);
  });
});

it("refuses a mixed conflict before running any generator or creating a commit", () => {
  fixture(true, (root, head, staging) => {
    assert.equal(mergeGeneratedConflicts(root, staging, () => assert.fail("generator must not run")), false);
    assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), head);
    assert.match(readFileSync(join(root, authored), "utf8"), /<<<<<<< HEAD/u);
  });
});

it("regenerates a generated file deleted by the PR and modified by staging", () => {
  fixture(false, (root, _head, staging) => {
    execFileSync("git", ["rm", "--", manifest], { cwd: root });
    execFileSync("git", ["commit", "-m", "delete generated output"], { cwd: root });
    assert.equal(mergeGeneratedConflicts(root, staging, checkout => {
      writeFileSync(join(checkout, manifest), "regenerated combined manifest\n");
    }), true);
    assert.equal(readFileSync(join(root, manifest), "utf8"), "regenerated combined manifest\n");
    assert.equal(execFileSync("git", ["diff", "--name-only", "--diff-filter=U"], { cwd: root, encoding: "utf8" }), "");
  });
});

it("refuses a deleted catalog rather than restoring its authored sections", () => {
  fixture(false, (root, _head, staging) => {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    const catalog = "docs/rebuild/reference/stores.md";
    git("rm", "--", catalog);
    git("commit", "-m", "delete catalog");
    git("checkout", "--detach", staging);
    writeFileSync(join(root, catalog), "Authored introduction\n<!-- store-catalog:start -->\nnew catalog\n<!-- store-catalog:end -->\n");
    git("commit", "-am", "update catalog");
    const updatedStaging = git("rev-parse", "HEAD");
    git("checkout", "feature");
    let generated = false;
    assert.throws(() => mergeGeneratedConflicts(root, updatedStaging, () => { generated = true; }), /Command failed: git cat-file/u);
    assert.equal(generated, false);
  });
});

it("merges on a fresh runner without a configured Git identity", () => {
  fixture(false, (root, _head, staging) => {
    execFileSync("git", ["config", "user.name", ""], { cwd: root });
    execFileSync("git", ["config", "user.email", ""], { cwd: root });
    assert.equal(mergeGeneratedConflicts(root, staging, checkout => {
      writeFileSync(join(checkout, manifest), "regenerated combined manifest\n");
    }), true);
  });
});

it("propagates generator failures and refuses unexpected authored output", () => {
  fixture(false, (root, _head, staging) => {
    assert.throws(() => mergeGeneratedConflicts(root, staging, () => { throw new Error("generator failed"); }), /generator failed/u);
  });
  fixture(false, (root, _head, staging) => {
    assert.throws(() => mergeGeneratedConflicts(root, staging, checkout => {
      writeFileSync(join(checkout, authored), "unexpected generator edit\n");
    }), /generator-changed-authored-file/u);
  });
});
