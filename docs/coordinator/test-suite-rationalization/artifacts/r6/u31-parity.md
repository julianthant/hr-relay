# R6 u31 — parity inventory

## Baseline inventory

At kickoff commit `7982650c`, the Playwright parity lane contained 17 collected specs, 287 cases, and 228 complete reference triples (684 files: 228 PNG, 228 accessibility YAML, 228 metadata JSON). The reference adapters were 225 fixture, two seeded, and one adapter-independent specimen. The stored matrix contained 118 Graphite Warm and 110 Paper Ink triples; viewport membership was 61 at 1280×720, 94 at 1440×900, 72 at narrow 1024×768, and one phone reference.

| Spec | Cases at intake |
| --- | ---: |
| `archive-accessibility.spec.ts` | 5 |
| `archive-evidence.spec.ts` | 11 |
| `backfill-gap.spec.ts` | 1 |
| `cross-date-search.spec.ts` | 6 |
| `dashboard-reference.spec.ts` | 198 |
| `diagnostic-bundle-dialog.spec.ts` | 19 |
| `dual-adapter.spec.ts` | 9 |
| `intake-accessibility.spec.ts` | 4 |
| `kit-reference.spec.ts` | 1 |
| `member-touch-target.spec.ts` | 5 |
| `observed-log-ui.spec.ts` | 7 |
| `panel-heading-accessibility.spec.ts` | 2 |
| `pool-control-touch-target.spec.ts` | 4 |
| `run-captures.spec.ts` | 8 |
| `shell-toast-floor.spec.ts` | 2 |
| `toolbar-touch-target.spec.ts` | 3 |
| `top-bar-search-touch-target.spec.ts` | 2 |

The lane also owns 17 helper modules. A clean untouched run passed 287/287 in 83.58 seconds (`real`; user 336.47, system 53.91) on this host.

## Risk map

| Dimension | Distinct failure protected | Disposition |
| --- | --- | --- |
| Graphite Warm / Paper Ink | Theme-token contrast, borders, fills, foregrounds, and theme-specific pixel output | Retain both |
| 1280×720 / 1440×900 / narrow 1024×768 / scoped phone | Wrapping, containment, fixed-footer overlap, dense-table presentation, and touch layout | Retain where declared |
| PNG + accessibility YAML | Pixel presentation and semantic tree are independent oracles | Retain strict pairs |
| Fixture + seeded adapter | Deterministic projection and real seeded-backend composition are independent | Retain both |
| `maxDiffPixels: 0`, threshold 0.2 | No counted pixel may drift; only per-pixel color noise remains tolerated | Retain unchanged |
| Per-worker ephemeral servers | Isolation from rebuild ports 3938/5174 and concurrent runtime state | Retain |
| Reduced-motion variant | Motion-preference media query and zeroed motion tokens | Retain and strengthen with a direct oracle |

## Equivalence findings

The sole safely removable family was explicit `run-receipt`: it addressed the same completed run, defaulted to the same Receipt panel as `run-done`, produced identical accessibility bodies in all six theme/viewport variants, and produced byte-identical Graphite PNGs. Paper PNGs differed by only 5–11 sub-threshold edge pixels. The surviving `run-done` family owns the exact same seam and oracle.

`intake-rerun` and `intake-review` looked equivalent but were not legitimate duplicates: the route for `intake-rerun` opened the default Review tab, so the test never exercised its named state. The fixture already contained a real changed-plan diff. u32 repaired the scene rather than deleting it.

Stale truth found for u35/R7: the parity config described 289 cases; the current intake was 287. The lane's normative documentation also contains older reference counts and belongs to the later authority-reconciliation run.
