const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const cp = require("node:child_process");
const fs = require("node:fs");

const root = "/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4";
const evidence = "docs/coordinator/worktree-completion/evidence/";
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const read = (path) => fs.readFileSync(path);
const json = (name) => JSON.parse(read(evidence + name));
const git = (args) => cp.execFileSync("git", args, { cwd: root, encoding: "utf8" });

assert.equal(process.cwd(), root);
const head = git(["rev-parse", "HEAD"]).trim();
assert.equal(head, "eda17b2708286e36542e1e18e9f8ef6a06cf3187");
assert.equal(git(["diff", "--cached", "--name-only"]), "");
git(["diff", "--check"]);

const originals = { ...json("dca4-a10-authority-before.json").original };
for (const name of ["dca4-a10-receipt-before.json", "dca4-a10-accounting-before.json"]) {
  for (const [path, pin] of Object.entries(json(name).scope)) {
    if (pin !== null) {
      const saved = read(pin.saved);
      assert.equal(hash(saved), pin.sha256, path);
      assert.equal(saved.length, pin.bytes, path);
    }
    if (!(path in originals)) {
      originals[path] = pin === null ? null : read(pin.saved).toString("utf8");
    }
  }
}

const candidate = {};
for (const path of Object.keys(originals).sort()) {
  const bytes = read(path);
  candidate[path] = {
    beforeSha256: originals[path] === null ? null : hash(originals[path]),
    sha256: hash(bytes),
    bytes: bytes.length,
  };
}
const generatedRoadmapPath = "docs/roadmap/index.html";
const generatedRoadmapBytes = read(generatedRoadmapPath);
candidate[generatedRoadmapPath] = {
  beforeSha256: "3388956a28d38cebdd63d08dc95b6c6268e49e8d7f52331f2244a128ff0a437b",
  sha256: hash(generatedRoadmapBytes),
  bytes: generatedRoadmapBytes.length,
};
assert.equal(Object.keys(candidate).length, 30);

const intake = json("dca4-a10-authority-before.json");
const paths = [...new Set(git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
  .split("\0").filter(Boolean))].sort();
const protectedMap = {};
for (const path of paths) {
  if (path.startsWith("docs/coordinator/") || path in candidate) continue;
  const now = fs.existsSync(path) ? hash(read(path)) : null;
  assert.equal(now, intake.hashes[path], path);
  protectedMap[path] = now;
}

const unitArtifacts = [
  "dca4-a10-fixture-owner-delta.patch",
  "dca4-a10-oracles-test-delta.patch",
  "dca4-a10-origin-accumulator-delta.patch",
  "dca4-a10-docs-isolated.patch",
].map((name) => ({ path: evidence + name, sha256: hash(read(evidence + name)) }));

if (process.argv[2] === "patch") {
  for (const [path, before] of Object.entries(originals)) {
    const result = cp.spawnSync(
      "/usr/bin/diff",
      ["-u", "--label", `a/${path}`, "--label", `b/${path}`, before === null ? "/dev/null" : "/dev/stdin", path],
      { input: before ?? "", encoding: "utf8", cwd: root, maxBuffer: 4_000_000 },
    );
    assert.ok(result.status === 0 || result.status === 1, result.stderr);
    process.stdout.write(result.stdout);
  }
} else {
  console.log(JSON.stringify({
    head,
    branch: git(["branch", "--show-current"]).trim(),
    index: "",
    candidate,
    candidateDigest: hash(JSON.stringify(candidate)),
    protectedCount: Object.keys(protectedMap).length,
    protectedDigest: hash(JSON.stringify(protectedMap)),
    unitArtifacts,
    generatedRoadmap: {
      path: generatedRoadmapPath,
      beforeSha256: "3388956a28d38cebdd63d08dc95b6c6268e49e8d7f52331f2244a128ff0a437b",
      afterSha256: hash(generatedRoadmapBytes),
      continuity: "Before hash captured immediately before npm run roadmap; regeneration followed the two owning-doc edits and roadmap:check passed.",
      patchLimit: "The 29-path intake patch excludes this generated file; generated continuity is recorded by exact before/after hashes and freshness proof.",
    },
    status: git(["status", "--short", "--untracked-files=all"]).split("\n")
      .filter((line) => line && !line.slice(3).startsWith("docs/coordinator/")),
  }, null, 2));
}
