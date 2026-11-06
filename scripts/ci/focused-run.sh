#!/usr/bin/env bash
# Runs the named test files with the flags CI uses: serial proofs one at a time, the rest on two workers.
# Usage: focused-run.sh <test file>...
set -o pipefail
[ $# -gt 0 ] || { echo "usage: focused-run.sh <test file>..." >&2; exit 2; }
out="${RUNNER_TEMP//\\//}/focused"
mkdir -p "$out"
serial=()
parallel=()
kinds=$(node --import tsx --input-type=module -e '
  import { SERIAL_FILES, SERIAL_STORAGE_FILES } from "./scripts/test/ci-files.ts";
  for (const file of process.argv.slice(1)) console.log([...SERIAL_FILES, ...SERIAL_STORAGE_FILES].includes(file) ? "serial" : "parallel", file);
' "$@") || { echo "Could not classify the test files." >&2; exit 1; }
while read -r kind file; do
  if [ "$kind" = serial ]; then serial+=("$file"); else parallel+=("$file"); fi
done <<< "$kinds"
[ $((${#serial[@]} + ${#parallel[@]})) -eq $# ] || { echo "Classified ${#serial[@]}+${#parallel[@]} of $# test files." >&2; exit 1; }
status=0
run() {
  local name=$1
  shift
  npx vitest run --project unit --project integration --project architecture --passWithNoTests=false \
    --reporter=verbose --reporter=json --outputFile.json="$out/$name.json" "$@" 2>&1 | tee "$out/$name.log"
  [ "${PIPESTATUS[0]}" -eq 0 ] || status=1
}
if [ ${#serial[@]} -gt 0 ]; then run serial "${serial[@]}" --maxWorkers=1 --no-file-parallelism; fi
if [ ${#parallel[@]} -gt 0 ]; then run parallel "${parallel[@]}" --maxWorkers=2; fi
exit "$status"
