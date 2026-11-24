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
refuses queued or otherwise nonterminal runs. It resumes the existing copy session or signs in
to the existing profile through the copy launcher. A copy that needs sign-up or Duo enrollment
is refused. All three tabs run in headless Chromium against the owned loopback frontend. Browser
routing blocks other origins and disables the HTTP cache in all runs. Each timed window starts
after all three tabs render the workspace and open their dashboard streams. The development
runtime refuses ChatGPT credential renewal. The rig starts from the copy's own checkout and
browser directory with fixed copy ports, so it has no live spawn arguments or browser state to
rewrite.

The command writes an aggregate JSON file in the invoking directory with mode `600`. Report
both runs from the exact target SHA, their ranges, and the verdict on #485. Each run records:

- Main backend thread CPU as user plus system CPU time divided by the measured wall time.
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
