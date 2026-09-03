# R1 u06 — consequential review

## Verdict

No unresolved R1 correctness, security, standards, silent-failure, performance, or test-quality
finding remains. The final review repaired four issues before close:

| Axis | Finding | Repair / proof |
|---|---|---|
| Security | The first self-contained provenance payload copied direct SSN- and UCSD EID-shaped values from historical source comments/examples. | Schema v2 retains the original `sourceBlob`, stores identifier-redacted text under a separate SHA-256, and binds the complete sanitized payload from code. The focused test was red before sanitization and the final JSON contains zero matching literals. |
| Test quality | One membership assertion used a weaker redundant regular expression. | Replaced by the exact project-membership oracle in `3906ddac`; independent unit witness remains outside the architecture lane. |
| Provenance integrity | Adjacent/recomputable snapshot digests could authenticate a coordinated substitution. | External anchors now bind generated inventories, file/source-blob order, redaction policy, and the complete payload. Recomputed-digest controls fail loud. |
| Public gate identity | The architecture command could inherit permissive empty collection or regress to a narrow path. | Exact named project, explicit `--passWithNoTests=false`, empty project exclusions, and a real subprocess negative control are pinned. |

Independent reviewers returned zero final findings for repository standards, correctness, and silent
failures. Performance review found no attributable regression: the exact verbose architecture gate
ran 70 files / 703 tests in 22.97 s; its earlier like-for-like reporter comparison was 24.80 s
verbose versus 24.39 s dot (+0.41 s). Security was reviewed by the supervisor and the finding above
was repaired before this artifact.

## Test and documentation judgment

All 70 architecture files remain because each owns a distinct seam/oracle; no file was retained
solely to preserve count. The only exact duplicate assertion was removed from `gate-coverage` and
left with `guard-manifest`. The independent empty-project witness adds a second collection seam, not
a duplicate oracle. Every changed guard has either a recorded violating fixture or a subprocess
control that demonstrably goes red.

Focused owner prose in ref `guards-and-tests` is current. Broad historical taxonomy, count,
reporting, and budget prose was intentionally not rewritten here because the R1 brief assigns that
cross-family reconciliation to R7.

## Exact R7 authority edits requested

1. Replace the stale 75-row / 65-active / 65-file snapshots with 81 rows / 70 active / 9 retired /
   2 planned and 70 recursive architecture files; refresh scenario and coverage snapshots from the
   final integrated run rather than copying R1's pre-integration numbers.
2. Describe the three current Vitest projects: `unit` recursively includes unit tests while
   excluding architecture, `architecture` recursively owns `tests/unit/architecture/**/*.test.ts`
   with no exclusions, and `scenario` owns scenario tests.
3. Record the public architecture command as the exact named-project lane with explicit verbose
   output and empty-collection refusal; remove path-filter/two-project descriptions.
4. Ratify self-contained, identifier-redacted frozen legacy provenance: source commits/paths/blob
   identities remain provenance, sanitized text and generated inventories are content-addressed,
   and a code-owned full-payload anchor prevents recomputed-digest substitution.
5. Ratify the deletion standard: only same risk + same seam + same oracle is a duplicate; every
   deletion/consolidation maps to a retained owner and a red-capable mutation or proves it cannot
   fail.
6. Ratify legible streaming output: project/file/full test labels for ordinary gates; stable phase
   labels for long multi-phase tests; expected diagnostics must be captured/asserted, not globally
   suppressed.
7. Record the coordinator budgets without weakening guarantees: affected checks ≤30 s, complete
   coverage ≤90 s, parity ≤75 s. The measured full coverage run remains green but took 120.03 s
   with tree output (121.67 s verbose), so R7 must treat the coverage budget as open residue.
8. Change the broad `test`/`test:coverage` reporters consistently and eliminate the existing React
   `act(...)` warning output at its dashboard-test owners. R1 changed only the architecture command,
   as scoped.
9. Exercise the integrated coverage lane while the dashboard owns ports 3938/5174; no dashboard was
   listening during R1's coverage measurements, so that hermetic concurrency check remains an
   integration/R7 obligation.

## Final gate evidence

| Gate | Result |
|---|---|
| `env -u HRAUTO_LEGACY_REPO npm run test:architecture` | PASS — 70 files / 703 tests, 22.97 s, explicit project/file/test labels, no warnings |
| independent unit empty-project witness | PASS — 1 file / 3 tests, including real command exit behavior |
| `npm run typecheck` | PASS — 18.40 s in the final parallel verification |
| `npm run lint` | PASS — zero warnings, 30.01 s final isolated completion |
| `npm run build:manifest:check` | PASS — generated manifest current |
| `npm run roadmap:check` | PASS — generated roadmap current |
| identifier-shape scan | PASS — zero SSN-shaped and zero UCSD EID-shaped literals in the frozen evidence JSON |
| instruction twins / `git diff --check` | PASS |

The pre-security full coverage run was also green at 391 files / 4,854 tests with 85.34% statements,
76.40% branches, 89.31% functions, and 87.28% lines. It is evidence of behavior, not a claim that
the 90-second R7 budget or clean-output requirement is met.
