# M4 allocated heavy-gate identity

Explicit SLOT-OPEN received for tree `56ba105f1841097927a444d6454686c954b4e9db`.
Workspace: `/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc2`.
HEAD: `ac40292b8e3e8ff9b66242bbf8f8288554335f40`.
MERGE_HEAD: `13175b13340fec7b5326207fe54f98078d481d7d`.
Immediately before coverage: index-to-allocated comparison exit 0; tracked worktree-to-index comparison exit 0; no unmerged entries.

Commands, each admitted separately:

```sh
/usr/bin/lockf -k -t0 /tmp/hr-dashboard-full-gate.lock env HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation VITEST_MAX_WORKERS=1 npm run test:coverage
/usr/bin/lockf -k -t0 /tmp/hr-dashboard-full-gate.lock npm run test:parity
```

Raw stdout/stderr: `coverage.log`, then `parity.log` if coverage passes.
Exit outcomes will be recorded from completed tool processes, not inferred from log contents.
Configured coverage floors: global lines/statements/functions 60%; safety-critical patterns 80% each.
Parity: one worker, 120-second test timeout, no snapshot updates, maxDiffPixels 0, per-pixel threshold 0.2 unchanged.
Frozen reference tree: `2821164f92b32c11ab39acdd9dddb6064f4ce9d1` (603 files: 201 PNG/a11y/meta triples).
Frozen dashboard tree: `5bcc2a97199b768808135d1644931232e83d9c65`.

No optional manual browser until supervisor acknowledges heavy-slot release. On red or final parity exit, notify supervisor before report edits or cleanup.

## Completed outcomes on the allocated tree

| Command | Owned exec session | Actual exit | Result |
|---|---|---|---|
| Mandatory locked coverage | 42279 | 0 | 3,831 tests / 339 files; 320.74s; suite-size command also completed |
| Mandatory separately locked parity | 34687 | 0 | 239 passed; 3.4m |
| npm run build:manifest:check | 50926 | 0 | generated manifest current |
| npm run roadmap:check | direct completed call | 0 | generated site fresh |
| git diff --check | direct completed call | 0 | no whitespace errors |
| git diff --cached --check | direct completed call | 0 | no whitespace errors |

Coverage: statements 84.61% (24892/29418); branches 74.97% (12870/17166);
functions 88.25% (5058/5731); lines 86.54% (22923/26487). All configured global and
safety-critical floors passed. Branch coverage is reported, not a configured threshold here.
Raw warning output (PDF negative case, Node localStorage availability, React act environment)
remains in coverage.log; no warning was silently removed.

Final parity exit was reported immediately to the supervisor, before report writing, cleanup,
or optional manual browser. Both heavy sessions completed normally; no lock timeout, spin,
lock deletion, cancellation or retry. PARITY_UPDATE was verified unset before parity.
Post-heavy HEAD and MERGE_HEAD are unchanged. Index-to-56ba and tracked-worktree-to-index
comparisons returned 0; no unmerged entries. Baseline-relative src/dashboard and all reference
paths have no diff. Freshness checks were run serially only after heavy completion.

Supervisor acknowledged heavy release before manual browser startup. The bounded Storage health
detail inspection is complete. Frozen storage-settings--paper-ink--1440x900.png shows General
settings and the hazard band/navigation, not the loaded doctor detail. The existing panel-heading
parity test establishes only that the Storage health heading is visible.

## Manual UI evidence and cleanup

- Existing startSeededServer composition served the already verified current bundle on temporary
  loopback port 60189; only synthetic data, no HR workflow or credential/live-authority access.
- Owned playwright-cli session `m4d`, 1440x900, observed theme `light` (Paper Ink), route
  `/?day=2026-08-03&settings=storage`. No network mock or product/reference changes.
- `doctor-response.log` is the unchanged unsuccessful capture attempt: the CLI helper sandbox
  has no URL global, so its response predicate raised ReferenceError. The CLI wrapper returned 0;
  that exit is not treated as application or HTTP success.
- NEW `doctor-response-verified.log` uses the exact endpoint suffix predicate. Actual HTTP 200,
  complete read-only doctor payload, and viewport/theme identity were captured successfully.
- Current loaded screenshot: `storage-detail-loaded-paper-ink-1440x900.png`.
  Current snapshot: `storage-detail-loaded-paper-ink-1440x900.yml`.
  Earlier `storage-detail-paper-ink-1440x900.*` captures remain retained as earlier attempts.
- Observed authority healthy, schema 18, generation 37, 176 pages; unresolved write intents 1,
  terminal outbox 1, other six pending counts 0; backup missing, no backup service run, zero
  restore candidates. Preflight displays six retained checks and its rerun control; no rerun
  was performed.
- UI caveat: served spanAuthority is degraded with four malformed span_stream problems; the
  unchanged baseline DoctorReport does not render that field. Its wire payload is recorded,
  but no visual proof of those diagnostic rows is claimed. Supervisor owns disposition.
- `browser-console.log` retains exactly one console error: synthetic server favicon.ico 404.
  No zero-console-error claim; no product change to suppress the error.
- Initial longer browser session name failed socket admission with EINVAL (daemon PID 60026);
  shorter owned `m4d` opened normally (PID 60215). This was tooling, not a product gate failure.
- `browser-close.log`: m4d closed, actual command exit 0. `manual-server.log`: ready/closed for
  PID 59590/port 60189; owned server session 99125 completed exit 0 after its close command.
  Existing harness cleanup removed only its own temporary synthetic database/span directory.
- `owned-process-check.log` is empty: ps for PIDs 59590, 60215, 60026 returned 1 (none present).
  `owned-port-check.log` is empty: lsof on port 60189 returned 1 (no listener). No fleet sweep.
- After cleanup, index-to-56ba and tracked-worktree-to-index comparisons returned 0, unmerged
  entries were empty, and baseline-relative dashboard/reference diffs were empty. No further
  heavy command ran; successful freshness checks were not repeated needlessly.

SHA-256 of retained unnormalized artifacts:

| Artifact | SHA-256 |
|---|---|
| coverage.log | fc98e24aaec2d744d7d5100d222aa9b2a3964ce5bb2e5b122b3067e51d9e1f82 |
| parity.log | 2ff1ae95427036021c1854296caac30c27b068c57ca44aebae4f0ded558d8c43 |
| storage-detail-loaded-paper-ink-1440x900.png | 6fd604d0ea33f3c9e10f1d4154a6fcc24158d12b82c8135e071deaf0da2a5ba6 |
| storage-detail-loaded-paper-ink-1440x900.yml | ec747722a04c3ccdb9145b03a5f0316c44d748e85bcd6f14d04bda8e31cfa00a |
