# R2 u1 parity-final — UNIT 1 inventory (read-only)

**Date:** 2026-08-29
**Status:** COMPLETE — inventory + attribution; no accept/reject
**Parent:** `/Users/julianhein/.codex/worktrees/a1da/hr-automation-rebuild` `codex/r2-4537-controlled-close`
**Child:** `/Users/julianhein/.codex/worktrees/a1da/r2-units/u1-parity-final` `feature/r2-u1-parity-final`
**Verified HEAD (both, still):** `6f79b4457ae8e54407ac81c9503b03937abd7430`
**Parent dirty at inventory close:** this file only (was clean at start)
**Child dirty:** 436 unstaged paths under `tests/parity/references/` — 201 `*.a11y.yml` + 201 `*.meta.json` + 34 `*.png`; diffstat 470/470 + binaries
**No child commit.** Historical 48-path freeze `4ad93cb4` is a different corpus; not approval of this batch.

Authority: `tests/parity/helpers/reference-store.ts` (a11y+meta+png are one update switch). Capture hashes from `tests/parity/helpers/fixture-day.ts:83-84` (`FIXTURE_DESCRIPTOR_HASH = descriptorSetHash([personLookupDescriptor.contractFingerprint])`) and `:1557-1558` (`FIXTURE_START_PICKER_DESCRIPTOR_HASH`). Set hash: `src/server/dashboard/compose.ts:399-402`.

---

## 1. Family table (40 families / 436 paths)

Every dirty a11y has a matching dirty meta (201/201). No broken pairs. Committed PNG siblings that are **not** dirty are noted under Completeness.

| Family | a11y | meta | png | Variants (dirty) | Class | Causal SHA |
|---|---:|---:|---:|---|---|---|
| activity-report | 6 | 6 | 0 | both themes × 1280, 1440, narrow | fingerprint-only | `8f7d98fd` |
| archive-ledger | 6 | 6 | 0 | both × 1280, 1440, narrow | fingerprint-only | `8f7d98fd` |
| archive-run | 6 | 6 | 0 | both × 1280, 1440, narrow | fingerprint-only | `8f7d98fd` |
| archive-version-bump | 2 | 2 | 1 | both × 1440 only; PNG dirty **paper-ink only** | fingerprint + PNG | hash `8f7d98fd`; PNG **UNATTRIBUTED** |
| capture-empty | 1 | 1 | 0 | paper-ink × phone-390x844 | fingerprint-only | `8f7d98fd` |
| capture-failed | 1 | 1 | 0 | paper-ink × phone-390x844 | fingerprint-only | `8f7d98fd` |
| capture-photos | 1 | 1 | 0 | paper-ink × phone-390x844 | fingerprint-only | `8f7d98fd` |
| capture-reorder | 1 | 1 | 0 | paper-ink × phone-390x844 | fingerprint-only | `8f7d98fd` |
| capture-sent | 1 | 1 | 0 | paper-ink × phone-390x844 | fingerprint-only | `8f7d98fd` |
| catalog-search | 6 | 6 | 0 | both × 1280, 1440, narrow | fingerprint-only | `8f7d98fd` |
| ds-kit | 1 | 1 | 0 | graphite-warm × 1440 | fingerprint-only | `8f7d98fd` |
| explorer-graph | 6 | 6 | 0 | both × 1280, 1440, narrow | fingerprint + impl prefix | `8f7d98fd` |
| explorer-transaction | 6 | 6 | 0 | both × 1280, 1440, narrow | fingerprint + impl prefix | `8f7d98fd` |
| intake-manifest | 6 | 6 | 0 | both × 1280, 1440, narrow | fingerprint-only | `8f7d98fd` |
| intake-mapping | 6 | 6 | 0 | both × 1280, 1440, narrow | fingerprint-only | `8f7d98fd` |
| intake-rerun | 6 | 6 | 0 | both × 1280, 1440, narrow | fingerprint-only | `8f7d98fd` |
| intake-review | 6 | 6 | 0 | both × 1280, 1440, narrow | fingerprint-only | `8f7d98fd` |
| intake-upload | 6 | 6 | 0 | both × 1280, 1440, narrow | fingerprint-only | `8f7d98fd` |
| queue-day | 10 | 10 | 0 | both × 1280, 1440, narrow; + graphite 1440 `--panel-dismissed`; + paper 1440 `--keyboard` `--panel-dismissed` `--reduced-motion` | fingerprint-only | `8f7d98fd` |
| run-done | 6 | 6 | 0 | both × 1280, 1440, narrow | fingerprint-only | `8f7d98fd` |
| run-failed | 6 | 6 | 4 | both × 1280, 1440, narrow; PNG dirty 1280+1440 only (not narrow) | fingerprint + a11y 8-char hash + PNG | `8f7d98fd` |
| run-group | 6 | 6 | 4 | same as run-failed | fingerprint + a11y 8-char hash + PNG | `8f7d98fd` |
| run-member | 6 | 6 | 0 | both × 1280, 1440, narrow | fingerprint-only | `8f7d98fd` |
| run-member-gate | 1 | 1 | 1 | graphite 1440 `--gate-type-eid` | fingerprint + a11y content + PNG | `8f7d98fd` + `964c9636` |
| run-open-gate | 9 | 9 | 7 | both × 1280, 1440, narrow; + graphite 1440 `--gate-choose` `--gate-refused` `--gate-reject`; PNG dirty all except both narrow | default: hash text+PNG `8f7d98fd`; ceremonies: EID+packet `964c9636` | see §3 |
| run-parked-write | 8 | 8 | 7 | both × 1280, 1440, narrow; + graphite 1440 `--resolve-absent` `--resolve-present`; PNG dirty all except `--resolve-present` | parked copy+hash+PNG `8f7d98fd`; resolve-absent PNG **UNATTRIBUTED** | see §3 |
| run-queued | 6 | 6 | 4 | same as run-failed | fingerprint + a11y 8-char hash + PNG | `8f7d98fd` |
| run-receipt | 6 | 6 | 0 | both × 1280, 1440, narrow | fingerprint-only | `8f7d98fd` |
| run-receipt-populated | 2 | 2 | 0 | both × 1440 | fingerprint + a11y content | `8f7d98fd` + `891c9786` |
| run-running | 8 | 8 | 6 | both × 1280, 1440, narrow; + both 1440 `--panel-dismissed`; PNG dirty all except both narrow | fingerprint + a11y 8-char hash + PNG | `8f7d98fd` |
| separations-start-input | 4 | 4 | 0 | both × 1440, narrow | fingerprint-only (start-picker hash) | `8f7d98fd` |
| separations-start-options | 4 | 4 | 0 | both × 1440, narrow | fingerprint-only (start-picker hash) | `8f7d98fd` |
| separations-start-plan | 4 | 4 | 0 | both × 1440, narrow | fingerprint-only (start-picker hash) | `8f7d98fd` |
| separations-start-result | 4 | 4 | 0 | both × 1440, narrow | fingerprint-only (start-picker hash) | `8f7d98fd` |
| separations-start-steps | 4 | 4 | 0 | both × 1440, narrow | fingerprint-only (start-picker hash) | `8f7d98fd` |
| settings | 8 | 8 | 0 | both × 1280, 1440, narrow; + graphite 1440 `--capabilities` `--system-hosts` | fingerprint-only | `8f7d98fd` |
| start-run | 6 | 6 | 0 | both × 1280, 1440, narrow | fingerprint-only | `8f7d98fd` |
| start-run-separations | 6 | 6 | 0 | both × 1280, 1440, narrow | fingerprint-only (start-picker hash) | `8f7d98fd` |
| storage-queue | 7 | 7 | 0 | both × 1280, 1440, narrow; + graphite 1440 `--sidebar` | fingerprint-only | `8f7d98fd` |
| storage-settings | 6 | 6 | 0 | both × 1280, 1440, narrow | fingerprint-only | `8f7d98fd` |
| **Total** | **201** | **201** | **34** | | | |

`capturedAt`, `appVersion`, adapter, fixture, viewport, theme, variant: **unchanged** on every meta.

---

## 2. Shared datums (before → after)

| Datum | Before (HEAD `6f79b445` refs) | After (child working tree) | Class |
|---|---|---|---|
| Default `descriptorHash` (a11y `# descriptorHash` + meta `descriptorHash`) | `09a0111be4d55dd23ed1c7bfdc3473083c2be2fd7c59683a40abff4f09d2b151` | `4c6200f5066582b1edd195a15d1f23afcb9b90502008a0d1c691298de1d3662e` | fingerprint-only |
| Start-picker `descriptorHash` (separations-start-* + start-run-separations) | `0d397a00e2610f3dda22327e3ae5a4613b9e8fd9252c23b162a9d50ac3d136e8` | `eb4401b68f415edcc03efb748f6b337bde239d753504e18c90331a0dd976e8e5` | fingerprint-only |
| Painted / tree 8-char set-hash (`run-identity.tsx:99` `shortFingerprint`) | `09a0111b` | `4c6200f5` | a11y-tree content (+ PNG where painted) |
| Receipt contract 8-char (`trust.tsx` `shortHash(receipt.descriptorFingerprint)`) | `61eddfca` | `df157d2d` | a11y-tree content |
| Explorer-graph `impl` prefix | `impl fe99beff4f72` | `impl d880c1d4b422` | fingerprint-only (rendered prefix) |
| Explorer-transaction `impl` prefix | `impl 692804fed6ae` | `impl 4a23441dd3fd` | fingerprint-only (rendered prefix) |
| Gate name-search definition EID | `Blirea, Glaundi (10412770, BLDG MAINT WORKER SR)` | `Blirea, Glaundi (identifier#616c84508f38, BLDG MAINT WORKER SR)` | a11y-tree content |
| Gate packet 12-char (type-the-eid / Okonkwo) | `packet a68ede777ed6…` | `packet 3c270c684772…` | a11y-tree content |
| Gate packet 12-char (choose-a-candidate / Nguyen) | `packet 7adf06ff1c4c…` | `packet ebcf06d4d57d…` | a11y-tree content |
| Parked-write message | `the UCPath save was submitted and the confirmation page never rendered: read-back timed out after 30000ms at ucpath.termination-confirmed` | `Write intent 00000000-0906-4000-8000-000000000906 is parked (unknown) for key digest 777777777777…. Verify the target system, then use one typed resolution.` | a11y-tree content |
| Receipt-populated failure line | `Failed CRM onboarding dates were unavailable 10:00 AM #1 pl-090404-0004 took 0s` | `Failed CRM_UNAVAILABLE: historical diagnostic text withheld (predates diagnostic safety v1) 10:00 AM #1 pl-090404-0004 took 0s` | a11y-tree content |
| Receipt-populated identity line | `result partial trace pl-090303-0003 descriptor 61eddfca config bbbbbbbb` | `result partial trace pl-090303-0003 descriptor df157d2d config bbbbbbbb` | a11y-tree content |

---

## 3. Causal commits (parent)

Verified by `git log -S` / `git show` / manifest parse at `4ad93cb4`, `e34daf02`, `964c9636`, `8f7d98fd`, `891c9786`, `HEAD`. Current person-lookup / start-picker / explorer-task fingerprints are **byte-identical** `8f7d98fd` → `891c9786` → `HEAD`. Intermediates `e34daf02` and `964c9636` moved those fingerprints to other values that are **not** what this capture shows.

| SHA | Subject | What it caused in this batch |
|---|---|---|
| `8f7d98fd` `fix(security): keep identity raw only in authority` | Last commit that landed **current** `person-lookup` fp `df157d2d…` (`generated-build-manifest.ts` workflow id `person-lookup`); therefore current default set-hash `4c6200f5…` via `fixture-day.ts:83-84` + `compose.ts:399`. Same commit landed current start-picker module fps (person-lookup, separations, identity-check, kronos, kuali-read, kuali-finalization, ucpath-termination) → start-picker hash `eb4401b6…`. Landed current task fps `ucpath/search-person-org` `d880c1d4b422…` and `ucpath/read-job-summary` `4a23441dd3fd…` rendered at `explorer.tsx:1099`. Rewrote parked wire copy: `run-detail.ts:1632-1633` + fixture `fixture-day.ts:1070`. |
| `964c9636` `fix(security): close environment admission boundary` | Gate comparison value now uses `directIdentifierDigestReference`: `identity-evidence.ts:266` (`10412770` → `identifier#616c84508f38`). Packet digest re-derived at `identity-evidence.ts:170-173` (canonical packet JSON includes that value); painted at `identity-approve.tsx:135` `packet ${gate.evidenceDigest.slice(0, 12)}…`. |
| `891c9786` `fix(trust): version diagnostic safety boundaries` | Receipt failure projection: `failure.ts:141` `${failure.code}: historical diagnostic text withheld (predates diagnostic safety v1)` via `run-detail.ts` `projectFailureForOperator`. Did **not** move person-lookup / start-picker / explorer-task fps. |
| `c1e57a44` `Reuse receipt verdict in activity projection` | Touched `run-queue-projection.ts` internals. **activity-report a11y tree unchanged** except descriptorHash. Not a tree/PNG cause. |
| `d1a6a251` / `9e4677ae` | Later trust/archive projection. No additional dirty a11y tree lines beyond those already attributed. |

`4ad93cb4` frozen values: default hash `09a0111b…`, start-picker `0d397a00…`, impl `fe99beff4f72` / `692804fed6ae`, receipt descriptor `61eddfca`. Those are the **before** bytes; they are not this batch's cause.

Rendered sites: set-hash chip `run-identity.tsx:99` + `run-identity-model.ts:20-21` (`shortHash` 8 chars, `format.ts:173-177`); explorer impl `explorer.tsx:1099`.

---

## 4. Per-family field list

**Fingerprint-only families (header + meta `descriptorHash` only; tree otherwise byte-identical):**
activity-report, archive-ledger, archive-run, capture-*, catalog-search, ds-kit, intake-*, queue-day, run-done, run-member, run-receipt, settings, start-run, storage-queue, storage-settings — default hash `09a0111b…` → `4c6200f5…`.
separations-start-{input,options,plan,result,steps} + start-run-separations — start-picker hash `0d397a00…` → `eb4401b6…`.

**explorer-graph (6+6):** default hash as above; tree `impl fe99beff4f72` → `impl d880c1d4b422` (`ucpath/search-person-org`).

**explorer-transaction (6+6):** default hash; tree `impl 692804fed6ae` → `impl 4a23441dd3fd` (`ucpath/read-job-summary`).

**archive-version-bump (2+2+1):** default hash only in a11y/meta. Paper-ink 1440 PNG dirty; graphite 1440 PNG **not** dirty. See UNATTRIBUTED.

**run-failed / run-group / run-queued (6+6+4 each):** default hash; every a11y tree line `- text: 09a0111b` → `- text: 4c6200f5`. PNG dirty on 1280 and 1440 both themes; committed narrow PNGs unchanged.

**run-running (8+8+6):** same hash text on all 8 a11y (incl. both `--panel-dismissed`). PNG dirty on 1280, 1440, both `--panel-dismissed`; both narrow PNGs unchanged.

**run-open-gate:**
- Default 6 scenes (both × 1280/1440/narrow): hash text `09a0111b` → `4c6200f5` only. PNG dirty on 1280+1440 both themes (7 PNGs total with ceremonies); both narrow PNGs unchanged.
- `--gate-choose` / `--gate-refused` / `--gate-reject` (graphite 1440): packet `7adf06ff1c4c…` → `ebcf06d4d57d…`; definition EID `10412770` → `identifier#616c84508f38`; plus default hash in header/meta. All three PNGs dirty.

**run-member-gate (1+1+1):** packet `a68ede777ed6…` → `3c270c684772…`; definition EID `10412770` → `identifier#616c84508f38`; default hash header/meta. PNG dirty.

**run-parked-write:**
- 6 default scenes (both × 1280/1440/narrow): parked message rewrite (datum table) + hash text `09a0111b` → `4c6200f5`. Those 6 PNGs dirty + paper/graphite narrow PNGs dirty (7 PNGs; `--resolve-present` PNG not dirty).
- `--resolve-absent` / `--resolve-present` a11y: **descriptorHash only** (no parked-message tree line). `--resolve-absent` PNG dirty — UNATTRIBUTED. `--resolve-present` PNG clean.

**run-receipt-populated (2+2):** failure withheld sentence (`891c9786`) + descriptor `61eddfca` → `df157d2d` (`8f7d98fd` person-lookup fp). PNGs not dirty.

---

## 5. PNG list (34) — a11y/meta also dirty for every stem

| PNG stem | a11y dirty | meta dirty | Likely painted cause |
|---|---|---|---|
| archive-version-bump--paper-ink--1440x900 | yes | yes | **UNATTRIBUTED** (tree is hash-header only; graphite PNG clean) |
| run-failed--{graphite-warm,paper-ink}--{1280x720,1440x900} | yes | yes | 8-char set-hash `09a0111b`→`4c6200f5` |
| run-group--{graphite-warm,paper-ink}--{1280x720,1440x900} | yes | yes | same |
| run-member-gate--graphite-warm--1440x900--gate-type-eid | yes | yes | EID digest + packet digest |
| run-open-gate--graphite-warm--{1280x720,1440x900} | yes | yes | 8-char set-hash |
| run-open-gate--graphite-warm--1440x900--gate-{choose,refused,reject} | yes | yes | EID digest + packet digest |
| run-open-gate--paper-ink--{1280x720,1440x900} | yes | yes | 8-char set-hash |
| run-parked-write--graphite-warm--{1280x720,1440x900,narrow-1024x768} | yes | yes | parked copy + set-hash |
| run-parked-write--graphite-warm--1440x900--resolve-absent | yes | yes | **UNATTRIBUTED** (a11y tree hash-header only) |
| run-parked-write--paper-ink--{1280x720,1440x900,narrow-1024x768} | yes | yes | parked copy + set-hash |
| run-queued--{graphite-warm,paper-ink}--{1280x720,1440x900} | yes | yes | 8-char set-hash |
| run-running--{graphite-warm,paper-ink}--{1280x720,1440x900} | yes | yes | 8-char set-hash |
| run-running--{graphite-warm,paper-ink}--1440x900--panel-dismissed | yes | yes | 8-char set-hash |

Committed PNG present but **not** dirty (completeness, not a broken pair): archive-version-bump graphite 1440; all fingerprint-only families' PNGs; run-* narrow PNGs listed above; run-parked-write `--resolve-present`; run-open-gate both narrow; run-receipt-populated both.

---

## 6. Completeness

- 201/201 a11y↔meta pairs complete. No a11y-without-meta or meta-without-a11y.
- Every dirty PNG has matching dirty a11y+meta for that stem.
- Corpus variants match committed stems; no extra dirty stems.
- PNG dirtiness is a **subset** of the committed PNG corpus (fingerprint-only families keep pixels).
- Asymmetric PNG (same family, some viewports/themes dirty): archive-version-bump paper vs graphite; run-parked-write resolve-absent vs resolve-present; run-failed/group/queued/running/open-gate desktop vs narrow.

---

## 7. UNATTRIBUTED

1. **archive-version-bump--paper-ink--1440x900.png** — a11y/meta only move `descriptorHash`; graphite sibling PNG unchanged. No parent commit proven to paint a theme-only pixel at that stem.
2. **run-parked-write--graphite-warm--1440x900--resolve-absent.png** — matching a11y tree has no content hunk besides the header hash; `--resolve-present` PNG unchanged. Pixel cause not sourced.

All other dirty fields/PNGs attributed to `8f7d98fd`, `964c9636`, and/or `891c9786` as above.

---

## 8. Counts

| | n |
|---|---:|
| Families | 40 |
| Families with all **text** fields attributed | 40 |
| Families with an UNATTRIBUTED PNG | 2 |
| UNATTRIBUTED deltas | 2 |
| Dirty PNGs | 34 |
| Fingerprint-only families (no tree/PNG content) | 31 |
| Families with a11y-tree content | 9 (`explorer-*`, `run-failed`, `run-group`, `run-queued`, `run-running`, `run-open-gate`, `run-member-gate`, `run-parked-write`, `run-receipt-populated`) |

`c1e57a44` / DCC-between-`4ad93cb4`-and-`13175b13` dashboard commits: **no additional dirty tree lines** in this corpus beyond the hashes landed at `8f7d98fd`.
