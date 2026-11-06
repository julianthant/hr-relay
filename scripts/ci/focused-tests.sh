#!/usr/bin/env bash
# Runs named test files in GitHub Actions on a scratch branch built from HEAD's tree; not merge evidence.
# Usage: scripts/ci/focused-tests.sh <lane> <ubuntu|macos|both> <test file>...
set -euo pipefail
die() { echo "$*" >&2; exit 2; }
[ $# -ge 3 ] || die "usage: focused-tests.sh <lane> <ubuntu|macos|both> <test file>..."
lane=$1 os=$2
shift 2
[[ $lane =~ ^[a-z0-9][a-z0-9._-]*$ ]] || die "lane must be lowercase letters, digits, '.', '_' or '-'."
case "$os" in ubuntu|macos|both) ;; *) die "os must be ubuntu, macos or both." ;; esac
git diff --quiet HEAD -- || die "Tracked files have uncommitted changes; the run tests HEAD. Commit them first."

branch=scratch/$lane
# A parentless commit on HEAD's tree: the working tree, index, branch and local history stay untouched.
commit=$(printf 'Focused tests for %s\n\nFocused-tests: %s\nFocused-os: %s\n' "$lane" "$*" "$os" | git commit-tree 'HEAD^{tree}')
results=$(mktemp -d)
trap 'rm -rf "$results"; git push -q origin --delete "$branch" 2>/dev/null || true' EXIT

# GitHub sometimes rejects a push while other pushes land at once; retry.
for attempt in 1 2 3; do
  git push -q --force origin "$commit:refs/heads/$branch" && break
  [ "$attempt" -lt 3 ] || die "Push to $branch failed."
  sleep $((attempt * 3))
done
run=
for _ in $(seq 60); do
  run=$(gh api "repos/{owner}/{repo}/actions/runs?head_sha=$commit&event=push" \
    --jq '.workflow_runs[] | select(.path == ".github/workflows/focused-tests.yml") | .id' | head -n1)
  [ -n "$run" ] && break
  sleep 2
done
[ -n "$run" ] || die "No focused-tests run started for $commit."

echo "Run $run: https://github.com/$(gh repo view --json nameWithOwner --jq .nameWithOwner)/actions/runs/$run"
while [ "$(gh api "repos/{owner}/{repo}/actions/runs/$run" --jq .status)" != completed ]; do sleep 10; done
conclusion=$(gh api "repos/{owner}/{repo}/actions/runs/$run" --jq .conclusion)
status=0
if [ "$conclusion" != success ]; then
  status=1
  gh run view "$run" --log-failed 2>/dev/null | grep -F '##[error]' | sed 's/.*##\[error\]/error: /' | sort -u | head -5 || true
fi
gh run download "$run" --dir "$results" 2>/dev/null || true
gh run view "$run" --json url,jobs > "$results/run.json"

node -e '
  const { readdirSync, readFileSync } = require("node:fs");
  const [dir, ...files] = process.argv.slice(1);
  const run = JSON.parse(readFileSync(`${dir}/run.json`, "utf8"));
  const seconds = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 1000);
  for (const job of run.jobs.filter(job => job.conclusion !== "skipped")) {
    const tests = job.steps.find(step => step.name === "Run focused tests");
    const total = seconds(job.startedAt, job.completedAt);
    const test = tests ? seconds(tests.startedAt, tests.completedAt) : 0;
    console.log(`${job.name}: ${job.conclusion}, ${total}s total, ${test}s tests, ${total - test}s setup`);
  }
  for (const artifact of readdirSync(dir).filter(name => name.startsWith("focused-"))) {
    const results = new Map();
    for (const name of readdirSync(`${dir}/${artifact}`).filter(name => name.endsWith(".json")))
      for (const { name: path, status } of JSON.parse(readFileSync(`${dir}/${artifact}/${name}`, "utf8")).testResults)
        results.set(path.slice(path.lastIndexOf("/tests/") + 1), status);
    for (const file of files) console.log(`${artifact.slice(8)} ${(results.get(file) ?? "no result").toUpperCase()} ${file}`);
  }
  console.log(run.url);
' "$results" "$@"
exit "$status"
