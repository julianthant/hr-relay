# DCA fresh reference refresh 28

Status: **RED — stopped after the sole authorized update-mode invocation; no retry or repair performed.**

## Authority and command

Decision 1A in `decisions/2026-08-31-dca-full-parity-authority.md` authorized exactly one refresh. In the assigned checkout and branch, this unit invoked exactly once:

```text
HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test:parity:update
```

The wrapper selected `PARITY_UPDATE=1`; no external update variable selected the mode. The shared lock was requested and acquired at `2026-08-31T22:19:06Z`, then released at `2026-08-31T22:28:00Z`; the equal request/acquire timestamps show no lock queue. No source/test/package/config/document repair, retry, staging, commit, merge, cleanup, or visual-acceptance decision occurred.

The command exited 1 after 8.9 minutes: 270 expected, 1 unexpected, 0 skipped, 0 flaky. The remaining failure was `dashboard-reference.spec.ts:982` (`keyboard-only focus lands on the queue`), timing out while waiting for `[data-parity-ready='true']`. See the raw log and copied JSON result below.

## Frozen inventories

Before and after each contain 591 files under `tests/parity/references`; the same 12 pre-existing untracked feature-reference files remain. The test output inventory changed from 66 to 38 files. Complete path+SHA-256 inventories and full porcelain status snapshots are preserved in the evidence directory.

| Inventory | Before aggregate SHA-256 | After aggregate SHA-256 |
| --- | --- | --- |
| Reference path+hash inventory | `b0f5c1cbb449fa700be06fae48c1951522f32c93e61575d1fa84166c92f2552c` | `b95e99e9cf8dfab7dec9e71db72a53d239b8d8b63ea7da0d9da72e533a793b58` |
| Playwright output path+hash inventory | `c5fbf9e9c8844b2e4e19ec11a6e27ce2ea7f83573679cad8691c8ced40e1ab26` | `23e58cccab70fe187152b1dab99f37714565f433a96421ec2f987f832db96823` |
| `results.json` copy | `abcf25941881fa0dfc429630c07c0389312d00943e3f9e8d82fe8b735131a129` | `c817dcc1a6dadcb48e65fced81e5f389d356be5969687b465de393b3eda492cf` |

## Reference delta accounting

All 81 changes are modifications: 50 `.a11y.yml`, 13 `.png`, and 18 `.meta.json`; no reference was added or deleted. The exhaustive per-path before/after hashes, extension, family, and outside-set flag are in `evidence/dca-fresh-reference-refresh28-20260831T221856Z-44921/reference-delta.tsv` (JSON equivalent alongside it).

| Prior affected family | A11y | PNG | Meta | Total |
| --- | ---: | ---: | ---: | ---: |
| Descriptor-set metadata hash drift (`start-run-separations`, `separations-start-input`) | 10 | 0 | 10 | 20 |
| Explorer implementation-fingerprint text drift (`explorer-graph`, `explorer-transaction`) | 12 | 0 | 0 | 12 |
| D292 standard Receipt: `run-done` | 6 | 4 | 0 | 10 |
| D292 standard Receipt: `run-member` | 6 | 4 | 0 | 10 |
| D292 standard Receipt: `run-receipt` | 6 | 5 | 0 | 11 |
| D292 populated Receipt: `run-receipt-populated` | 2 | 0 | 0 | 2 |
| **Subtotal mapping to the 42 prior a11y names** | **42** | **13** | **10** | **65** |

### Explicit outside-set flag

Sixteen changed paths were not among the 42 named prior failures: each of the following base names changed both its `.a11y.yml` and `.meta.json` reference.

- `separations-start-plan--graphite-warm--1440x900`
- `separations-start-plan--graphite-warm--narrow-1024x768`
- `separations-start-plan--paper-ink--1440x900`
- `separations-start-plan--paper-ink--narrow-1024x768`
- `separations-start-result--graphite-warm--1440x900`
- `separations-start-result--graphite-warm--narrow-1024x768`
- `separations-start-result--paper-ink--1440x900`
- `separations-start-result--paper-ink--narrow-1024x768`

They are flagged, not accepted or rejected, by this unit. The status delta and the exhaustive family matrix preserve the same classification.

## Evidence

Evidence root: `docs/coordinator/worktree-completion/evidence/dca-fresh-reference-refresh28-20260831T221856Z-44921/`

- `test-parity-update.log` — raw one-shot command log.
- `results-before.json`, `results-after.json` — exact copied Playwright reports.
- `parity-reference-inventory-{before,after}.tsv` — complete reference path+hash inventories.
- `parity-output-inventory-{before,after}.tsv` — complete output path+hash inventories.
- `status-{before,after}.txt`, `status-delta.patch` — full working-tree state and this command's delta.
- `reference-delta.{tsv,json}`, `reference-delta-by-family.tsv`, `reference-delta-summary.json` — exhaustive changed-path accounting and six-family grouping.
- `lock-{requested,acquired,released}.txt`, `command-terminal.txt` — lock and terminal receipt.
- `artifact-sha256.tsv` — hashes of the preserved evidence artifacts.

No visual acceptance is asserted here; supervisor inspection remains required.
