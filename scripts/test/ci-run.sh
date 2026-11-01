#!/usr/bin/env bash
# Runs this CI job's share of a Vitest project and records file durations for scripts/test/ci-durations.json.
# Usage: ci-run.sh <unit|integration|architecture> <ubuntu|macos|serial> <job>/<jobs> [vitest args...]
set -euo pipefail
project=$1 runner=$2 slice=$3
shift 3
listing="$RUNNER_TEMP/$project-$runner-files.json"
paths="$RUNNER_TEMP/$project-$runner-paths"
npx vitest list --project "$project" --filesOnly --json="$listing"
npx tsx scripts/test/ci-files.ts select "$project" "$runner" "$listing" "$slice" > "$paths"
files=()
while IFS= read -r -d '' file; do files+=("$file"); done < "$paths"
if [ ${#files[@]} -eq 0 ]; then
  echo "No $project files for $runner job $slice."
  exit 0
fi
mkdir -p "$RUNNER_TEMP/durations"
npm run "test:$project" -- "${files[@]}" --reporter=verbose --reporter=json \
  --outputFile.json="$RUNNER_TEMP/durations/$project-$runner-${slice%/*}.json" "$@"
