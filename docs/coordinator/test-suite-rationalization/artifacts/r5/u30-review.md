# R5b u30 — scenario layout, naming, collection, and family review

## Before/after census

| Layer | R5a baseline | R5b candidate | Disposition |
| --- | ---: | ---: | --- |
| Ordinary capability scenarios | 6 files / 33 cases | 6 / 33 | Retained; fixture data syntheticized. |
| Workflow T1a | 7 files / 81 cases | 7 / 81 | Byte-untouched; one structural owner per workflow preserved. |
| Dashboard T2 | 3 files / 26 cases | 3 / 16 | 4 claims moved to unit owners; 6 exact duplicates removed. |
| Integration walk | 1 file / 2 cases | 1 / 2 | Retained; fixture data syntheticized. |
| **Collected scenario project** | **17 / 142** | **17 / 132** | Every file remains classified and collected once. |
| Uncollected T1b | 2 manifests / 2 cases | 2 / 2 | Untouched and still excluded from Vitest by the `.scenario.ts` suffix. |

No additional scenario test appeared after the R5a inventory. The current filesystem contains the
same 17 collected files, with only the two truthful T2 path changes below.

## Reconciled paths and maps

| Before | After | Reconciled consumers |
| --- | --- | --- |
| `dashboard/separations/wired-surfaces.scenario.test.ts` | `dashboard/separations/run-projection.scenario.test.ts` | Filesystem collection and `tests/scenario/{AGENTS,CLAUDE}.md`; no manifest/import referenced the old path. |
| `dashboard/separations/needs-you-and-ledger.scenario.test.ts` | `dashboard/separations/needs-you.scenario.test.ts` | Filesystem collection and paired scenario instruction maps; ledger-only imports/helpers removed. |

`vitest.config.ts` continues to collect exactly `tests/scenario/**/*.test.ts` in the named
`scenario` project. Unit excludes architecture, architecture owns its recursive directory, and no
other project includes the scenario tree. `auditScenarioCorpusLayout` and the architecture suite
still enforce the three disjoint file kinds. The seven workflow source paths in the executable
manifest and both uncollected T1b paths are unchanged.

The paired scenario instruction files are byte-identical and now map the three T2 files by their
real seams. They also record the collected-fixture rule. No canonical guards/test specification was
changed because R7/u38 owns the final cross-family taxonomy and runner contract.

## Synthetic-data ratchet and controlled red

`tests/unit/architecture/scenario-coverage.test.ts` scans collected scenario sources and local
support for standalone eight-digit EID shapes. It accepts only
`10800000`–`10800099` and the explicit invalid sentinel `19999999`; a failure prints file/line,
never the matched value. The two uncollected `dry-run.scenario.ts` T1b declarations are the sole
source exclusion.

The first controlled red failed with five actionable source locations (dashboard ledger,
intake-extraction, OCR, operator walk, and roster matching). After fixture replacement and removal
of the duplicate dashboard ledger harness, the guard was then mutation-checked against an unsafe
value placed in `dashboard/separations/world.ts`; it failed on that helper's exact line without
echoing the value. The restored architecture file passed **17/17**. Synthetic names, document
numbers, and the normalization address were also made visually explicit by review, even though they
are not safe to diagnose mechanically by a numeric guard.

## Execution-output review

The representative verbose run reports `|scenario|`, exact file, suite, and full behavior/refusal
title while work executes. T2 files use stable suite phases (`start door`, `queue row`, `categorical
timeline`, `server-chosen ceremony`, `gate command`, `needs-you alert`). The retained long operator
walk has ten stable named source phases and operation-specific non-secret assertion messages. R7/u38
owns the one default streaming reporter and therefore remains responsible for exposing nested phase
progress without adding duplicate output or reducing isolation/parallelism.

Expected corrupt-PDF diagnostic output remains scoped to its named test. No warning was globally
suppressed. All new controlled-red output names a project, file, suite, full behavior, and exact
assertion location without secret material.

## Supervisor verification state

Implementation commits:

- `2abf8b62` — reserved synthetic offline identities plus architecture ratchet and paired map update.
- `74805a25` — T2 relocation/deduplication, truthful paths, and cheaper missing-answer owner.

Pre-review gates are green: full scenario **17/132**; focused scenario **9/44**; Explorer unit
**20/20**; cheaper-owner unit set **59/59**; focused architecture **17/17**; typecheck; lint; and
`git diff --check`. Independent axis reviews and final integrated gates are recorded in the R5b
report rather than pre-claimed here.
