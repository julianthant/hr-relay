#!/usr/bin/env bash
set -euo pipefail

sample_dir="$RUNNER_TEMP/unit-resources"
mkdir -p "$sample_dir"
export RELAY_CI_UNIT_FILE_LOG="$sample_dir/files.log"

sample_resources() {
  printf '[ci-unit-resources] %s\n' "$(date -u +%FT%TZ)"
  free -m
  df -P /tmp "$GITHUB_WORKSPACE" "$TMPDIR"
  awk '$1 == "oom_kill" { print "host_oom_kills=" $2 }' /proc/vmstat
  # Keep test and runner command identities without uploading arbitrary argument values.
  ps -ww -eo pid=,ppid=,rss=,args= --sort=-rss | awk '
    BEGIN { print "PID PPID RSS_KIB COMMAND (filtered)" }
    NR <= 10 {
      command = $4
      sub(/^.*\//, "", command)
      if (command !~ /^[[:alnum:]_.()-]+$/) command = "[redacted]"
      for (i = 5; i <= NF; i++) {
        argument = $i
        sub(/^.*\//, "", argument)
        if (argument ~ /^(ci-run\.sh|ci-files\.ts|ci-unit-sampler\.sh|vitest\.mjs|forks\.js|test:unit|--type=(renderer|gpu-process|utility))$/) {
          command = command " " argument
        }
      }
      print $1, $2, $3, command
    }
    END { print "process_count=" NR }
  '
}

# Stream snapshots as well, since a stopped runner may never reach the upload step.
record_sample() {
  sample_resources | tee -a "$sample_dir/resources.log"
}

(
  timer=
  trap 'if [[ -n "$timer" ]]; then kill "$timer" 2>/dev/null || :; fi; exit 0' TERM
  while :; do
    record_sample
    sleep 5 &
    timer=$!
    wait "$timer"
    timer=
  done
) &
sampler=$!

finish() {
  local status=$?
  kill "$sampler" 2>/dev/null || :
  wait "$sampler" 2>/dev/null || :
  record_sample || printf 'Final unit resource sample failed\n' >&2
  exit "$status"
}
trap finish EXIT

scripts/test/ci-run.sh unit ubuntu "$1" --maxWorkers=3 --reporter=./scripts/test/ci-unit-files-reporter.ts
