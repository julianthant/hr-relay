#!/usr/bin/env bash
# Runs this CI job's share of a Vitest project and records file durations for scripts/test/ci-durations.json.
# Usage: ci-run.sh <unit|integration|architecture> <ubuntu|native|serial|storage> <job>/<jobs> [vitest args...]
set -euo pipefail
# Selection refuses a native file Vitest did not list, so every slice opts in before listing.
export RELAY_TEST_NATIVE=1
project=$1 runner=$2 slice=$3
shift 3
runner_temp="${RUNNER_TEMP//\\//}"
listing="$runner_temp/$project-$runner-files.json"
paths="$runner_temp/$project-$runner-paths"
npx vitest list --project "$project" --filesOnly --json="$listing"
npx tsx scripts/test/ci-files.ts select "$project" "$runner" "$listing" "$slice" > "$paths"
files=()
while IFS= read -r -d '' file; do files+=("$file"); done < "$paths"
if [ ${#files[@]} -eq 0 ]; then
  echo "No $project files for $runner job $slice."
  exit 0
fi
mkdir -p "$runner_temp/durations"
npm run "test:$project" -- "${files[@]}" --reporter=verbose --reporter=json \
  --outputFile.json="$runner_temp/durations/$RUNNER_OS-$project-$runner-${slice%/*}.json" "$@"
