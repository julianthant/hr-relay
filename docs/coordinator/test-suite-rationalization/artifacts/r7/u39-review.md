# R7 u39 — consequential cross-family review

## Pinned target and method

The review target began as `e880da7...5d1909fc` and advanced only through explicit finding-fix
commits. Reviewers remained read-only and inspected immutable commit ranges. The supervisor owned
security judgment, integration, fixes, re-review, and the final gate. No reviewer changed the
working tree.

| Axis | Finding and disposition |
|---|---|
| Standards | One medium finding that topology declarations were duplicated and one low finding that a doc pointed at nonexistent `tests/CLAUDE.md`. `7bab5346` makes the executable config derive from exported project definitions and points at the real scenario twins. |
| Spec | One high finding that future live `tests/scenario/combined/**` sources would be collected by the offline scenario project. `530f85ae` explicitly excludes the tier and adds a zero-owner negative. A later medium wording finding was fixed by `689d5142`, which qualifies exact-once collection as offline-authored. The remaining high finding named only the not-yet-written u39/u42/report close artifacts; those are produced by this close sequence rather than waived. |
| Correctness | Zero findings. The reviewer ran lint, affected Vitest cases, and the dashboard benchmark. |
| Silent failures | Zero findings. Static project extraction, missing config fields, duplicate/zero ownership, phase order, and structural performance counters all refuse with named context. |
| Performance | Zero findings in the changed runner paths. Four-worker per-file fork isolation and 30-second fixture/guard bounds remain unchanged; elapsed budgets remain non-waiving targets. |
| Tests | Three medium findings: the topology guard did not inspect the resolved default config, multiple ownership lacked a red fixture, and lifecycle phase output was write-only. `3daa6de1` validates the resolved projects/reporters, supplies an overlapping-project refusal, and asserts the complete ordered 20-event phase stream. It also captures and exactly asserts pdfjs's expected unreadable-input diagnostic instead of leaking unexplained stderr. |
| Docs | The first pass found stale Settings parity-gap prose, a contradiction about per-file jsdom wiring, and a ten-row family table headed “Nine members”; `dea5a4f6` fixed all three. Re-review then found stale scenario/architecture line counts and a historical D191 topology sentence written in the present tense; `9ab1eede` refreshes the counts and explicitly marks the 2026-08-12 topology as historical. |
| Security | Zero findings. No authentication, authorization, dependency, credential, network, production-root, or command-execution behavior changed. The temporary `.env` used to admit the legitimate local dashboard was copied from the public example at mode 0600, remained ignored, held no added secret, and is removed at cleanup. Labeled output and errors contain only paths, project/test names, structural counters, and synthetic fixture context. |
| Simplify | Skipped. The accepted changes are direct enforcement, bounded caching, one lifecycle phase helper, and canonical documentation; a speculative reshaping would add risk without deleting an interface or adapter. |

## Fail-loud and mutation evidence

- Vitest: a temporary assertion immediately after `01-upload:begin` named the `scenario` project,
  lifecycle file, full test title, exact phase, and controlled message. The mutation was restored.
- Playwright: a temporary inverted toast-clearance assertion named the parity file and line, full
  `A169` behavior, viewport, and measured geometry; the JSON evidence verifier also refused the
  incomplete focused run. The mutation was restored.
- Duo: a temporary false base64 round-trip named the controlled case and reported 42 pass / 1 fail.
  The mutation was restored.
- Performance: a temporary day-wire ceiling of 5,568 failed with
  `dashboard performance dayWireStatements must be at most 5568; measured 5569`. The ceiling was
  immediately restored to the ratified 5,569.
- Architecture/topology: committed unit fixtures prove empty architecture collection, an orphaned
  offline file, accidental collection of the reserved combined tier, and duplicate ownership all
  fail with the offending project/path.

The controlled mutations changed no committed source. Full final re-review and gate outcomes are
recorded in u42 and the run report.
