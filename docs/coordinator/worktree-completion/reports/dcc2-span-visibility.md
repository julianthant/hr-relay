# DCC2 Settings storage-doctor span visibility

Date: 2026-08-31

Mode: `standalone(no board)` — the brief supplied no exact coordinator-board path, so no board was searched for or edited.

Branch: `feature/dcc2-storage-span-visibility`

Base: `27fb6f0a`

Implementation head before this report: `ebd9eaac658d3aba71cf3cb9835eac6cf0b85a6c`

Authority: `docs/coordinator/worktree-completion/briefs/dcc2-span-visibility.md`; project profile `/Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/worktree-completion/project-profile.md`; primary disposition `/Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/worktree-completion/reports/dcc2-ui-disposition.md`; `docs/rebuild/reference/dashboard-surfaces.md` sections 2.5 and 9.8.

## Outcome

Settings now renders every strict `StorageDoctorWire.spanAuthority` arm after the real **Run doctor** action:

- `reconciled` shows exact stream/live counts and an accessible archived-run accounting disclosure.
- `degraded` shows the same accounting plus every typed problem, one-for-one, with its discriminant and safe authority facts.
- `unavailable` shows the exact closed cause code and summary and does not invent counts.

The result is read-only. It adds no endpoint, second wire, mutation, storage conversion or authority fallback. Archived instants retain their full day-and-time meaning and expose the exact ISO value in the title. Structural result regions announce asynchronous changes politely.

No merge, push, deploy, live HR action, database conversion, gate approval or worktree removal occurred.

## Supervised units

| Unit | Owner | Result |
|---|---|---|
| Contract and surface map | `sup_scout_u1_map_span_visibility` | Confirmed the strict union already reached `SettingsPage`; identified the missing render fold and parity-fixture seam |
| TDD and implementation | Supervisor | Added focused red/green coverage and the total presentation fold without changing the wire or backend |
| UI finish | `sup_terra_ui_finish_span_doctor` | One live-region finding fixed; refreshed desktop/narrow references visually accepted on re-review |
| Spec review | `sup_terra_review_spec_span_doctor` | One archived-instant ambiguity fixed; authority conformance clean on re-review |
| Correctness review | `sup_terra_review_correctness_span_doctor` | Clean before and after the follow-up range |

The supervisor retained the central discriminated-union design, implementation, integration and acceptance judgment.

## Commits

| Commit | Category |
|---|---|
| `98ec5490` | Render degraded span authority and its typed problem ledger |
| `f6769dba` | Render reconciled span authority and archived accounting |
| `7b75e293` | Render unavailable span authority without fabricated counts |
| `7e928994` | Use the verified span-status design token |
| `4c7b24a6` | Add the strict doctor fixture and four loaded-state parity references |
| `940b02bc` | Define the span-authority presentation contract and nearest dashboard lesson |
| `244f8e16` | Preserve archived dates as local day + time with exact ISO provenance |
| `7ec45081` | Announce reconciled/degraded result regions with `aria-live="polite"` |
| `f60f86cd` | Announce unavailable result regions with `aria-live="polite"` |
| `ebd9eaac` | Refresh the four reviewed parity triples after the fixes |

## TDD and review disposition

The agreed seam was the public loaded `SettingsPage` / `DoctorReport` renderer after the real **Run doctor** click. Each arm first failed against the absent UI, then passed after its minimum implementation. Follow-up red/green cycles pinned cross-date archived instants and polite announcements for all three arms.

| Review finding | Disposition | Re-review |
|---|---|---|
| Archived entries used time-only text, so identical clock times on different days were ambiguous | Added local day + time and exact ISO title; added a cross-date regression test | Spec reviewer: clean, count 0 |
| Asynchronous doctor verdicts were not announced | Added polite live regions to degraded, reconciled and unavailable results; added regression tests | UI reviewer: clean |
| Correctness | No finding | Correctness reviewer: clean, count 0 |

## Rendered proof

The deliberate parity lane covers graphite-warm and paper-ink at 1440x900 and narrow 1024x768. Each state opens the archived accounting disclosure and asserts all four degraded problems remain reachable. Every viewport/theme has a reviewed PNG, accessibility tree and metadata file:

- `tests/parity/references/storage-doctor-degraded--graphite-warm--1440x900.{png,a11y.yml,meta.json}`
- `tests/parity/references/storage-doctor-degraded--paper-ink--1440x900.{png,a11y.yml,meta.json}`
- `tests/parity/references/storage-doctor-degraded--graphite-warm--narrow-1024x768.{png,a11y.yml,meta.json}`
- `tests/parity/references/storage-doctor-degraded--paper-ink--narrow-1024x768.{png,a11y.yml,meta.json}`

Direct inspection found no clipped authority facts, horizontal overflow or theme contrast regression.

## Gates

| Gate | Result |
|---|---|
| focused Settings Vitest, one worker | PASS — 3 files, 53 tests |
| `npm run typecheck` under `/tmp/hr-worktree-light-gate.lock` | PASS |
| `npm run lint` under `/tmp/hr-worktree-light-gate.lock` | PASS — zero warnings |
| `npm run build:manifest:check` | PASS — generated manifest current |
| `npm run roadmap:check` | PASS — generated roadmap current |
| UI layout detector on `settings.tsx` | PASS — `[]` |
| targeted loaded-doctor parity assertion | PASS — 4/4 |
| locked `npm run test:coverage`, one worker, with the profile's legacy override | PASS — 361 files, 4,247 tests; 84.95% statements, 75.60% branches, 88.55% functions, 86.86% lines |
| locked `npm run test:parity` | PASS — 269/269 |
| `git diff --check` | PASS before report creation |

The first full-coverage invocation omitted the profile-mandated `HRAUTO_LEGACY_REPO` override. It failed only the missing-sibling legacy/provenance lanes (310 files and 3,744 tests had passed); the corrected locked invocation used `HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation` and passed the complete suite. No product change was made to mask that environment error.

## Residue and handback

The branch is ready for coordinator receipt from base `27fb6f0a`. No temporary browser process, gate lock, runtime mutation or handoff file is retained. The temporary dependency symlink used only to execute the gates is removed before handback. Integration and cleanup remain coordinator-owned.
