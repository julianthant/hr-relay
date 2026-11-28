# Idle dashboard benchmark

Run this on the Mac from a Relay checkout that contains the rig. Use Node 26 and install the
checkout's dependencies and Playwright Chromium first. Stop the development copy dashboard.
The development copy must have one enrolled profile and populated [imported run history](../profiles/README.md).
Use that import command to prepare the copy. It carries history from a verified backup and leaves
browser roots, tokens, and locks with their original installation. The benchmark keeps the copy's
own sign-in session available for subsequent runs. Prepare the copy with the operator present for
any Duo enrollment before starting the benchmark.

```sh
node --import tsx scripts/bench/idle-three-tab.ts <target-sha>
node --import tsx scripts/bench/idle-three-tab.ts <target-sha> --base <base-sha>
```

Use full 40-character Git SHAs. Each selected commit must contain the development copy sign-in
launcher and support the prepared copy's storage schema. A comparison runs the base first and
the target second, with two independent dashboard launches per SHA. Keep the Mac quiet and
use the same copy and imported history across runs. The rig checks that the history bytes stay
the same within one invocation. A run can take over 20 minutes per SHA, including two ten-minute
windows. The copy is left stopped at the target SHA. Ctrl+C cancels the current run and stops
the dashboard and Chromium it owns.

The rig checks the copy's Git worktree, ports, registered profile, and history binding and
refuses queued or otherwise nonterminal runs. It also requires `browser.headless` to resolve to
`true` before starting the dashboard. It resumes the existing copy session or signs in
to the existing profile through the copy launcher. A copy that needs sign-up or Duo enrollment
is refused. All three tabs run in headless Chromium against the owned loopback frontend. Browser
routing blocks other origins and disables the HTTP cache in all runs. Each timed window starts
after all three tabs render the workspace and open their dashboard streams. The development
runtime refuses ChatGPT credential renewal. The rig starts from the copy's own checkout and
browser directory with fixed copy ports, so it has no live spawn arguments or browser state to
rewrite.

The command writes an aggregate JSON file in the invoking directory with mode `600`. Report
both runs from the exact target SHA, their ranges, and the verdict on #485. Each run records:

- Main backend thread CPU as user plus system CPU time less the measured sampling callback CPU,
  divided by wall time. The result records the raw thread and callback CPU times in microseconds.
  Individual callbacks can fall below the CPU counter's resolution.
- Event-loop stalls strictly over 100 ms as count, longest, and total. A 20 ms timer measures
  the lateness of each wake-up. The copy store's event-loop diagnostic records appear as a
  separate cross-check because Relay coalesces those above its own 200 ms threshold.
- Backend process RSS at both endpoints. The two-run verdict considers each delta flat within
  16 MiB. Two endpoints establish net change over this window.
- Browser errors, tab count, measured wall time, and host load. An errored window is
  inconclusive even when its numbers meet the targets.

The two-run verdict identifies any missed limit of zero stalls and less than 2% thread CPU.
A base comparison reports no measurable difference when the ranges overlap. If a range shows
a gap, use an extra profiling run to identify the underlying limiter before attributing an
improvement. The two-run threshold verdict and RSS endpoints are the measurements for #485 and #415.

# Logs and step-note search

Use the stopped, enrolled development copy with imported history. Supply a mode-600 JSON
fixture containing `runId`, `day`, `workflow`, and a partial step-note `query` that matches the
same rendered note on both commits. Pick an existing Queue row that mounts on that day.

```sh
node --import tsx scripts/bench/logs-window.ts <base-sha> <target-sha> --fixture <private-json> --output <report-json>
```

The benchmark alternates five fresh dashboard launches per commit and uses one Chromium
window. It times opening Logs from Queue, then entering the query, through the rendered
result and two animation frames. The target must serve a matching step-note search response.
The report contains timings, match counts, failures, and host load. It omits the fixture
values. The checkout returns to its original commit when the run ends.

# Read-lane start benchmark (G2)

Run this from a Relay checkout with its dependencies installed. Stop the copy dashboard first. The copy must be
signed in and hold [imported run history](../profiles/README.md); prepare it with that import command, not by hand.

```sh
node --import tsx scripts/bench/read-lanes.ts development --runs 5 --fresh-copy
```

Each run is a cold process that opens the copy's store the way the dashboard does and starts the real read host:
shape A starts the navigation lane alone and shape B starts the navigation and search lanes. With `--fresh-copy`,
both shapes use one temporary clone of the stopped copy's data. The command removes the clone after the run.
Shapes alternate between
runs. A run records the time from host creation until every lane is ready, the process RSS added by the lanes after
one timeline page, and that page's time. Each run compares the first page and a page crossing the archive boundary
with the dashboard history. Each shape passes G2 on its own when every run is ready within 5 s and adds
at most 350 MiB. The backend runs under tsx, as `npm run dashboard:prod` runs it, because there is no packaged build.
The command writes the JSON report in the invoking directory with mode `600`.

# Settings editor benchmark (G6)

Run this from a Relay checkout with its dependencies installed. Stop the copy dashboard first; the copy must be signed in.

```sh
node --import tsx scripts/bench/settings-editor.ts development --runs 20
```

It reads the Settings editor as the dashboard does: the store part on the navigation lane, the protected facts and the
document on main. Each read alternates the fiscal year so the document is built every time. It reports main-thread CPU
per read (p50, p95, max) and wall time. For G6, use the p50 and max of `buildCpuMs`, which times
`buildSettingsEditor` alone. The gate requires every sample to build the editor and the max to be at most 5 ms. G6 does not cover the per-reply
lane `admit` cost; #986 tracks it.
