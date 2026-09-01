import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
const root = "/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4";
if (process.cwd() !== root) throw new Error("Wrong workdir");
const before = JSON.parse(readFileSync("docs/coordinator/worktree-completion/evidence/dca4-a10-accounting-before.json", "utf8"));
const paths = Object.keys(before.scope);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
const fact = path => existsSync(path) ? { sha256: sha(readFileSync(path)), bytes: readFileSync(path).length } : null;
if (process.argv[2] === "patch") {
  for (const path of paths) {
    const saved = before.scope[path]?.saved;
    if (saved && sha(readFileSync(saved)) !== before.scope[path].sha256) throw new Error("Before bytes changed: " + path);
    const result = spawnSync("diff", ["-u", "-L", "a/" + path, "-L", "b/" + path, saved ?? "/dev/null", path], { cwd: root, encoding: "utf8" });
    if (result.status !== 0 && result.status !== 1) throw new Error(result.stderr);
    process.stdout.write(result.stdout);
  }
} else {
  const selected = [...new Set(git("ls-files", "-z", "--cached", "--others", "--exclude-standard").split("\0").filter(Boolean))].sort()
    .filter(path => !paths.includes(path) && !path.startsWith("docs/coordinator/"));
  const protectedMap = Object.fromEntries(selected.map(path => [path, existsSync(path) ? sha(readFileSync(path)) : null]));
  const protectedDigest = sha(JSON.stringify(protectedMap));
  const scope = Object.fromEntries(paths.map(path => [path, fact(path)]));
  const beforeScope = Object.fromEntries(paths.map(path => [path, before.scope[path]?.sha256 ?? null]));
  const afterScope = Object.fromEntries(paths.map(path => [path, scope[path]?.sha256 ?? null]));
  const named = ["src/dashboard/surfaces/run-captures-model.ts", "src/dashboard/surfaces/run-captures.tsx",
    "src/dashboard/app/dashboard-app.tsx", "src/dashboard/surfaces/log-panel.tsx",
    "tests/unit/dashboard/run-captures-app.test.ts", "tests/unit/dashboard/run-captures-lifecycle.test.ts",
    "tests/unit/architecture/helpers/wire-connectivity.ts", "tests/unit/architecture/helpers/archive-browser-route-references.ts",
    "tests/unit/dashboard/archive-evidence-fixture.test.ts", "tests/parity/helpers/fixture-archive-evidence.ts",
    "tests/unit/fixtures/capture-image-fixtures.ts", "tests/parity/archive-evidence.spec.ts",
    "src/domain/workflow/generated-build-manifest.ts", "config/pending-wire-bindings.json"];
  const referencePaths = selected.filter(path => path.startsWith("tests/parity/references/") && path.includes("archive-evidence"));
  const original = readFileSync(before.scope[paths[0]].saved, "utf8");
  const current = readFileSync(paths[0], "utf8");
  const a8Start = '  it("A8 credits the actual mounted Archive parent native sinks and leaves the generic route open"';
  const a8End = "  /*\n   * The negative controls.";
  const a8Block = text => { const start = text.indexOf(a8Start); if(start < 0) throw new Error("Missing A8"); const end = text.indexOf(a8End, start); if(end < 0) throw new Error("Missing A8 end"); return text.slice(start, end); };
  const head = git("rev-parse", "HEAD").trim();
  const index = git("diff", "--cached", "--name-only");
  const result = { observedAt: new Date().toISOString(), head, index, protectedCount: selected.length, protectedDigest,
    beforeScopeDigest: sha(JSON.stringify(beforeScope)), afterScopeDigest: sha(JSON.stringify(afterScope)),
    scope, namedPins: Object.fromEntries([...named, ...referencePaths].map(path => [path, fact(path)])),
    a8ExistingBlock: { unchanged: a8Block(original) === a8Block(current), sha256: sha(a8Block(current)) },
    beforeMatches: head === before.head && index === before.index && selected.length === before.protectedCount && protectedDigest === before.protectedDigest };
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (!result.beforeMatches || !result.a8ExistingBlock.unchanged) process.exitCode = 1;
}
