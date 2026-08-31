# DCC2 M4 intake and parity plan

STATUS: VERIFICATION COMPLETE WITH UI CAVEAT on allocated candidate `56ba105f1841097927a444d6454686c954b4e9db`: coverage exit 0, parity exit 0, freshness checks exit 0. Heavy exits were reported immediately and release acknowledged before the bounded synthetic Storage health inspection. Loaded detail evidence is captured; owned browser/server are closed. The undisplayed spanAuthority field below needs supervisor disposition; no product repair or unconditional UI-acceptance claim is made.

ROLE: `sup_terra_dcc2_m4_verify_preflight`.

MODEL: native high 240k/220k.

REASONING:

- `HEAD` is `ac40292b8e3e8ff9b66242bbf8f8288554335f40`; `MERGE_HEAD` is `13175b13340fec7b5326207fe54f98078d481d7d`.
- The final candidate is tree object `56ba105f1841097927a444d6454686c954b4e9db`, superseding `e4ab3837feef579e8462b59e27eb9eb3015d0f65` and initial intake pin `a296aa29b7308d318c6fc4a8a9ba9642acbe9082`. Read-only `git diff --cached --quiet 56ba105f1841097927a444d6454686c954b4e9db` and `git diff --quiet` both returned 0; `git ls-files -u` returned no entries. Index matches final candidate; tracked worktree equals index.
- The complete e4ab-to-56ba delta is three paths / eleven additions: four runtime lines forwarding an explicitly supplied `duoCeremony`, three test lines supplying the existing fixture to two synthetic browser compositions, and four root AGENTS lines documenting that rule. Runtime/test files match approved reference `845ca5a115ee6eef3e10598e88ea0a7fdf361888` exactly. No assertions or timeouts changed. Production CLI still omits the override; the existing credential-backed worker default remains intact.
- Independent M3F [Tests](dcc2-m3f-review-tests.md), [Security](dcc2-m3f-review-security.md), [Correctness](dcc2-m3f-review-correctness.md), and [Silent failures](dcc2-m3f-review-silent-failures.md) each report Count 0 / Worst none. Raw reviews retain their historical statements that gates were pending; no review evidence was rewritten. Execution status comes from the later M3F final gate ledger's actual exit-0 records and supervisor confirmation, not the static reviews.
- Historical a296-to-e4ab delta: one redaction-test fixture correction excluded only the unsupported CLI intermediate-component case. Doctor/browser retained that case; all 18 valid CLI cases remained. The earlier [Tests](dcc2-cli-delta-tests.md) and [Security](dcc2-cli-delta-security.md) dispositions remain intact.
- Candidate and frozen baseline have the identical `src/dashboard` tree (`5bcc2a97199b768808135d1644931232e83d9c65`) and identical `tests/parity/references` tree (`2821164f92b32c11ab39acdd9dddb6064f4ce9d1`): 603 artifacts, 201 each PNG/a11y/meta. No reference re-freeze is permitted.
- The only baseline-relative parity helper change is `tests/parity/helpers/seeded-bff.ts`: doctor options now explicitly pass `stateRootTrustAnchor: root` and `stateRoot`; its prior `spanRoot` is removed. This matches the stated trust-root seam.

GATES:

Existing evidence inspected read-only: [M3F report](dcc2-m3f.md), its focused/typecheck/lint logs, four delta reviews, and independent supervisor logs. M3F records no active owned commands and a returned light lane; supervisor confirms no commands active. These are prior worker/supervisor results, not new M4 executions.

| Evidence on current 56ba105f | Recorded outcome |
|---|---|
| [Worker focused composition](../evidence/dcc2-m3f/focused-green.log), session 82510 | Exit 0; 8/8 passed; 2.96s; actual exit recorded in M3F |
| [Worker full locked typecheck](../evidence/dcc2-m3f/typecheck-locked.log), session 43140 | Exit 0; current candidate; actual exit recorded in M3F |
| [Worker full locked lint](../evidence/dcc2-m3f/lint-locked.log), session 44952 | Exit 0; current candidate; actual exit recorded in M3F |
| [Supervisor independent composition](../evidence/dcc2-supervisor/m3f-focused.log) | 8/8 passed, 2.56s; exit 0 confirmed by supervisor |
| [Supervisor independent locked lint](../evidence/dcc2-supervisor/m3f-lint.log) | Exit 0 confirmed by supervisor; log inspected |
| Tracked/staged diff checks, M3F report | Exit 0 each on 56ba105f |
| [M4 coverage](../evidence/dcc2-m4/coverage.log), session 42279 | Exit 0; 3,831 tests / 339 files; 320.74s; suite-size reporting also passed |
| [M4 parity](../evidence/dcc2-m4/parity.log), session 34687 | Exit 0; 239 passed, 3.4m; references unchanged |
| [M4 manifest check](../evidence/dcc2-m4/manifest-check.log) / [roadmap check](../evidence/dcc2-m4/roadmap-check.log) | Exit 0 each after heavy completion; manifest current/site fresh |
| [M4 tracked diff check](../evidence/dcc2-m4/diff-worktree-check.log) / [index diff check](../evidence/dcc2-m4/diff-index-check.log) | Exit 0 each after heavy completion |
| Rendered M4 Storage health detail | Loaded panel captured at 1440x900/Paper Ink; actual doctor HTTP 200 retained; see evidence/caveat below |

M4 exact commands, identity and exits are in [gate-identity.md](../evidence/dcc2-m4/gate-identity.md).
Both mandated lock commands acquired normally and ran sequentially; no timeout, retry, spin or lock
deletion. Coverage floors passed: lines 86.54%, statements 84.61%, functions 88.25% against 60%
global / 80% safety-critical configured floors; branches 74.97% reported. Full raw warning output
is retained. Current M3F typecheck/lint and review proof remains applicable to unchanged 56ba.

Historical input evidence remains attributed to e4ab, not promoted to fresh 56ba execution: [M3 report](dcc2-m3.md) and [command/exit ledger](../evidence/dcc2-m3/final-gate-commands.md) record diagnostics 56/56, composed focused scope 417 distinct tests / 25 files, locked typecheck/lint 0, and manifest/roadmap/diff checks 0. M4's fresh complete suite proof is the separately recorded 3,831-test result above.

Historical failures remain failures: main's proactive composition check on e4ab and the worker's [M3F reproduction](../evidence/dcc2-m3f/focused-red.log) each exited 1 with 2 failures / 6 passes due to missing synthetic Duo injection. The approved repair cleared those cases. The broad 418-test invocation exited 1 before its follow-up; a296 typecheck exited 2; the old 57-case diagnostic result included the unsupported CLI fixture. Canceled sessions remain CANCELED/143, and the prior lock timeout remains QUEUED/75.

UI evidence and limits:

- Inspected frozen `storage-settings--paper-ink--1440x900.png`: General settings page, full-width authority-unavailable band, and Storage health navigation. It does not show the doctor detail panel. `dashboard-reference.spec.ts:559` explicitly routes this capture to `settings: ""`.
- Passing `panel-heading-accessibility.spec.ts:63` navigates to `settings: "storage"` and checks the level-two Storage health heading. It does not request/assert loaded diagnostic detail, so neither that test nor the General screenshot closes detail inspection.
- After acknowledged release, the existing seeded parity server proved the current bundle and served synthetic Storage health at 1440x900/Paper Ink. Current loaded [screenshot](../evidence/dcc2-m4/storage-detail-loaded-paper-ink-1440x900.png) and [snapshot](../evidence/dcc2-m4/storage-detail-loaded-paper-ink-1440x900.yml) show the actual doctor detail, distinct from the General/hazard reference above.
- Successful NEW [doctor response capture](../evidence/dcc2-m4/doctor-response-verified.log): HTTP 200; mode read-only; authority healthy, schema v18/generation 37/176 pages; unresolved write intents 1 and terminal outbox 1, all other six counts 0; backup missing, service never-run, zero restore candidates. The panel displays these values legibly. Preflight shows six retained checks and its rerun control; no preflight rerun was executed and no real-runtime detector success is inferred from this synthetic fixture.
- **Supervisor disposition required:** the successful payload also contains `spanAuthority.state: degraded`, streamRunCount 11/liveRunCount 7 and four malformed `span_stream` problems. Unchanged baseline `src/dashboard/surfaces/settings.tsx:241` DoctorReport does not render `spanAuthority`, and those rows are absent from screenshot/snapshot. This proves loaded UI and the served wire separately, not visual coverage of those span diagnoses. No new repair, fixture change or reference update was made.
- The unsuccessful [original response attempt](../evidence/dcc2-m4/doctor-response.log) remains unchanged: `ReferenceError: page.waitForResponse: URL is not defined` is an inspection-helper error, not an app failure. The successful capture uses a predicate without that unsupported global. [Console evidence](../evidence/dcc2-m4/browser-console.log) retains one `favicon.ico` 404 from the synthetic server; zero console errors is not claimed. No product change was made to suppress it.
- A longer named CLI session initially failed UNIX socket admission with EINVAL; shorter owned `m4d` succeeded. Both the failed daemon and successful session PID were checked absent after cleanup. This tooling issue did not cause a product gate rerun.

Owned-process closure and final identity:

- [Browser close](../evidence/dcc2-m4/browser-close.log) exited 0 for `m4d`; [server log](../evidence/dcc2-m4/manual-server.log) records ready then closed for PID 59590/port 60189, and owned session 99125 exited 0. The existing harness removed only its owned temporary synthetic state, which is disposable; captured evidence remains.
- [Owned PID lookup](../evidence/dcc2-m4/owned-process-check.log) and [owned listener lookup](../evidence/dcc2-m4/owned-port-check.log) are empty and returned 1: PIDs 59590/60215/60026 absent; port 60189 has no listener. No fleet close, foreign process action or further heavy gate occurred.
- Post-cleanup index-to-56ba and tracked-worktree-to-index comparisons returned 0; no unmerged entries; dashboard and 603 references have no baseline-relative diff. All raw gate logs retain their original whitespace; artifact SHA-256 hashes are in the gate identity ledger. Manifest/roadmap checks were not needlessly repeated.

FILES: This report and assigned `evidence/dcc2-m4/` gate logs, identity, evidence-only seeded-server wrapper, and manual UI captures. No product, index, raw review or reference file was modified; raw logs were not normalized.

COMMITS: None. SCOUTS: None.

REVIEW-HINT: Coverage/parity are proved on exact 56ba105f. View the new loaded-detail PNG and successful response capture together; decide the unchanged renderer's undisplayed spanAuthority separately. All integration/repair decisions and any merge/docs commits remain supervisor-owned.

NOTES: The /ui verification route led to a distinct loaded-detail capture after identifying that the frozen General screenshot and heading-only parity assertion did not cover doctor detail. Raw review evidence is unchanged. Both heavy sessions, freshness commands, manual browser and server are finished; no owned process remains. HEAD/MERGE_HEAD unchanged; index matches 56ba; tracked worktree equals index. No source/index edit, commit, new unit, credential/live-authority access or shared-browser action occurred. DCC4's later heavy ownership was untouched.
