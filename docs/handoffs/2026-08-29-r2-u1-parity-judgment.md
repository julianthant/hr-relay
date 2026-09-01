# R2 u1 parity-final — UNIT 2 judgment (read-only)

**Date:** 2026-08-29
**Status:** COMPLETE — accept / reject / decision-needed; no apply
**Route:** `/ui` → UI diff + accessibility review (hidden `ui-review`)
**stack:** React 19.2.8 + Vite 8.2.2 + Tailwind v4.2.2 + Radix (no shadcn) + lucide + TypeScript · **WIG fetched live** 2026-08-29
**Parent:** `/Users/julianhein/.codex/worktrees/a1da/hr-automation-rebuild` `codex/r2-4537-controlled-close`
**Child:** `/Users/julianhein/.codex/worktrees/a1da/r2-units/u1-parity-final` `feature/r2-u1-parity-final`
**Verified HEAD (both, still):** `6f79b4457ae8e54407ac81c9503b03937abd7430`
**Child dirty at judgment close:** 436 unstaged refs (201 a11y / 201 meta / 34 png). No child commit.
**Parent dirty at judgment close:** inventory + this file.
**Historical `4ad93cb4` is a different corpus — not cited as approval.**

Authority: `tests/parity/helpers/reference-store.ts` (one `PARITY_UPDATE=1` switch; a11y+meta+png are one pair). Contract: `docs/rebuild/reference/frontend-backend-integration.md` §7 (D132 / D145 / D187). Painted hash: `run-identity.tsx:99` `shortFingerprint` → `format.ts:175-177` (8 chars). Archive background hash: `archive.tsx:3240` `shortHash(state.current.contractFingerprint)`.

---

## Verdict rollup

| class | n | disposition |
|---|---:|---|
| Fingerprint-only families (31) | 153 a11y + 153 meta | **ACCEPT** all |
| Content-family a11y/meta (9) | 48 + 48 | **ACCEPT** all |
| PNGs explained | 33 | **ACCEPT** |
| PNGs decision-needed | 1 | **DECISION-NEEDED** |
| REJECT | 0 | — |

**Recommended accept set: 435 paths** (201 a11y + 201 meta + 33 png). Held out: `archive-version-bump--paper-ink--1440x900.png` only.

U1 inventory claim (40 families / 436 paths / 201/201 pairs / 31 fingerprint-only / 9 content / 2 UNATTRIBUTED PNGs / shared hashes / gate EID / withheld sentence): **confirmed** as inventory. The two U1-UNATTRIBUTED PNGs are **not** unexplained pixels — both are the same 8-char set-hash paint — but one remains DECISION-NEEDED because of theme-asymmetric leftover.

---

## Fingerprint-only spot-check

Checked **all 31** claimed fingerprint-only families (not a sample): every dirty a11y line is the header/meta `descriptorHash` (`09a0111b…`→`4c6200f5…` or start-picker `0d397a00…`→`eb4401b6…`) and/or explorer `impl` prefix (`fe99beff4f72`→`d880c1d4b422` on graph = `ucpath/search-person-org`; `692804fed6ae`→`4a23441dd3fd` on transaction = `ucpath/read-job-summary` at `explorer.tsx:1099`).

No extra tree content. **Do not promote any of the 31.** Causal: `8f7d98fd`.

`c1e57a44` did not add tree lines (U1 claim held).

---

## Per-content-family verdicts

Accept only when new text is current parent behavior and does not hide identity / leak secrets / invent copy.

| Family | a11y non-hash content | Causal | Verdict |
|---|---|---|---|
| archive-version-bump | header `descriptorHash` only (2 files) | `8f7d98fd` | **ACCEPT** a11y+meta. PNG see below. |
| run-failed | tree `- text: 09a0111b` → `4c6200f5` (6) | `8f7d98fd` `run-identity.tsx:99` | **ACCEPT** |
| run-group | same 8-char chip (6) | `8f7d98fd` | **ACCEPT** |
| run-queued | same (6) | `8f7d98fd` | **ACCEPT** |
| run-running | same on all 8 incl. `--panel-dismissed` | `8f7d98fd` | **ACCEPT** |
| run-member-gate | packet `a68ede777ed6…`→`3c270c684772…`; definition EID `10412770`→`identifier#616c84508f38` | `964c9636` `identity-evidence.ts:266` + `identity-approve.tsx:135`; hash `8f7d98fd` | **ACCEPT** |
| run-open-gate | default 6: 8-char chip only. Ceremonies 3: packet `7adf06ff1c4c…`→`ebcf06d4d57d…` + same EID digest | `8f7d98fd` / `964c9636` | **ACCEPT** |
| run-parked-write | default 6: parked sentence rewrite + 8-char chip. resolve-* 2: header hash only | `8f7d98fd` `run-detail.ts:1632-1633` + `fixture-day.ts:1070-1071` (`idempotencyKeyDigestReference("7".repeat(64))` → `key digest 777777777777…`) | **ACCEPT** |
| run-receipt-populated | `Failed CRM onboarding dates were unavailable` → `Failed CRM_UNAVAILABLE: historical diagnostic text withheld (predates diagnostic safety v1)`; descriptor `61eddfca`→`df157d2d` | `891c9786` `failure.ts:141`; fingerprint `8f7d98fd` | **ACCEPT** |

**Copy judgment.** New parked sentence is repository-authored, names intent id + park code + bounded key digest, and tells the operator the next step. It replaces a driver timeout sentence that must not cross the wire (dashboard `AGENTS.md` 2026-08-29). Receipt withheld sentence is the exact `projectFailureForOperator` reconstruction — it does not invent CRM copy. Gate definition redacts the name-search EID to `identifier#` + 12-hex (`redaction.ts:97-98`). Candidate **cards** still paint `EID 10412770` — intended: ceremony may render the served candidate EID as a React child (dashboard `AGENTS.md` 2026-08-28). Unchanged `EID read 10688204` is pre-existing, not this delta.

**WIG / a11y on the delta (not a redesign):**
- `identity-evidence.ts:266` + painted definition — longer `identifier#616c84508f38` clips `BLDG MAINT WORKER SR` to `WORKE…` on the ceremony line (WIG §6 truncate). Card still has the full title/EID. Not a reject of the redaction.
- Parked message: specific + next step (WIG §5) · `…` not `...` · **pass**.
- Receipt withheld: closed code + typed withholding · **pass**.
- Color is not the only carrier; chips/text change.

---

## Per-PNG verdicts (all 34)

Pixel counts from RGB `ImageChops.difference` of HEAD blob vs child worktree. Crops inspected. `4ad93cb4` not used as authority.

### Hash-chip class — ACCEPT (`8f7d98fd`)

Same paint: `09a0111b`→`4c6200f5` at the identity chip (`run-identity.tsx:99`). ~375–393 px. 1440 bbox typically `(936,825)–(989,835)`. 1280 unions two chip sites (sparse ~385 px). No other glyph/layout move.

| PNG | px | bbox | Verdict |
|---|---:|---|---|
| run-failed--graphite-warm--1280x720.png | 385 | (20,16)–(829,655) | ACCEPT `8f7d98fd` |
| run-failed--graphite-warm--1440x900.png | 375 | (936,825)–(989,835) | ACCEPT `8f7d98fd` |
| run-failed--paper-ink--1280x720.png | 393 | (12,16)–(829,655) | ACCEPT `8f7d98fd` |
| run-failed--paper-ink--1440x900.png | 385 | (936,63)–(1428,835) sparse; crop is chip only | ACCEPT `8f7d98fd` |
| run-group--graphite-warm--1280x720.png | 385 | same 1280 union | ACCEPT `8f7d98fd` |
| run-group--graphite-warm--1440x900.png | 375 | chip | ACCEPT `8f7d98fd` |
| run-group--paper-ink--1280x720.png | 393 | 1280 union | ACCEPT `8f7d98fd` |
| run-group--paper-ink--1440x900.png | 379 | chip | ACCEPT `8f7d98fd` |
| run-queued--graphite-warm--1280x720.png | 385 | 1280 union | ACCEPT `8f7d98fd` |
| run-queued--graphite-warm--1440x900.png | 375 | chip | ACCEPT `8f7d98fd` |
| run-queued--paper-ink--1280x720.png | 379 | (776,645)–(829,655) chip | ACCEPT `8f7d98fd` |
| run-queued--paper-ink--1440x900.png | 379 | chip | ACCEPT `8f7d98fd` |
| run-running--graphite-warm--1280x720.png | 385 | 1280 union | ACCEPT `8f7d98fd` |
| run-running--graphite-warm--1440x900.png | 375 | chip | ACCEPT `8f7d98fd` |
| run-running--graphite-warm--1440x900--panel-dismissed.png | 375 | chip | ACCEPT `8f7d98fd` |
| run-running--paper-ink--1280x720.png | 379 | chip | ACCEPT `8f7d98fd` |
| run-running--paper-ink--1440x900.png | 379 | chip | ACCEPT `8f7d98fd` |
| run-running--paper-ink--1440x900--panel-dismissed.png | 379 | chip | ACCEPT `8f7d98fd` |
| run-open-gate--graphite-warm--1280x720.png | 385 | 1280 union | ACCEPT `8f7d98fd` |
| run-open-gate--graphite-warm--1440x900.png | 375 | chip | ACCEPT `8f7d98fd` |
| run-open-gate--paper-ink--1280x720.png | 393 | 1280 union | ACCEPT `8f7d98fd` |
| run-open-gate--paper-ink--1440x900.png | 379 | chip | ACCEPT `8f7d98fd` |

Narrow siblings for these families stay clean: 8-char substitution stayed under §7 threshold 0.2 at that size. Not a broken pair (a11y moved; pixels did not fail `maxDiffPixels: 0` @ 0.2).

### Gate ceremonies — ACCEPT (`964c9636` + `8f7d98fd`)

| PNG | px | What moved | Verdict |
|---|---:|---|---|
| run-member-gate--graphite-warm--1440x900--gate-type-eid.png | 2744 | packet 12-char + definition EID digest + identity chip | ACCEPT |
| run-open-gate--graphite-warm--1440x900--gate-choose.png | 2800 | packet + EID digest + chip | ACCEPT |
| run-open-gate--graphite-warm--1440x900--gate-refused.png | 2793 | same | ACCEPT |
| run-open-gate--graphite-warm--1440x900--gate-reject.png | 2800 | same | ACCEPT |

Cards still show raw `EID 10412770` (ceremony). Definition line clips job title (WIG note above).

### Parked-write copy — ACCEPT (`8f7d98fd`)

| PNG | px | What moved | Verdict |
|---|---:|---|---|
| run-parked-write--graphite-warm--1280x720.png | 6882 | new parked sentence + chip | ACCEPT |
| run-parked-write--graphite-warm--1440x900.png | 7003 | same | ACCEPT |
| run-parked-write--paper-ink--1280x720.png | 6889 | same | ACCEPT |
| run-parked-write--paper-ink--1440x900.png | 7009 | same | ACCEPT |
| run-parked-write--graphite-warm--narrow-1024x768.png | 690 | 3 scanlines y=716–718; a11y has full new sentence + chip; message is clipped at this viewport — remnant AA of `8f7d98fd` copy | ACCEPT |
| run-parked-write--paper-ink--narrow-1024x768.png | 691 | same 3-line remnant | ACCEPT |
| run-parked-write--graphite-warm--1440x900--resolve-absent.png | 368 | U1 UNATTRIBUTED. Crop is the identity chip `09a0111b`→`4c6200f5` at `(936,825)–(989,835)`. a11y omits the 8-char (dialog tree). `--resolve-present` PNG clean because that bbox is dialog buttons, not the chip. | **ACCEPT** `8f7d98fd` (U1 attribution upgraded) |

### Theme-asymmetric leftover — DECISION-NEEDED

| PNG | px | What moved | Verdict |
|---|---:|---|---|
| archive-version-bump--paper-ink--1440x900.png | 264 | U1 UNATTRIBUTED. Crop `(131,320)–(170,329)` is background registry `shortHash(contractFingerprint)` (`archive.tsx:3240`) behind the bump dialog: `okup 09a0111`→`4c6200f5`. a11y is header-only because the dialog hides the table from the tree (D187: pixels see it, tree does not). **Graphite sibling PNG is not dirty and still paints `09a011…`** — dimmed under the dark overlay, change stayed under threshold 0.2. Accepting paper freezes a theme-asymmetric short-hash. | **DECISION-NEEDED** |

---

## DECISION-NEEDED (supervisor questions — no `/decision-brief` file)

1. **`archive-version-bump--paper-ink--1440x900.png`**
   - Situation: pixels are the explained `8f7d98fd` 8-char set/contract hash in the versions table behind the modal. Graphite committed PNG still shows `09a011`. Both themes' a11y/meta already carry the new full `descriptorHash`.
   - A — Accept the paper PNG with the rest of the 435. Live with graphite PNG still showing `09a011` until a later recapture. **Cost:** theme-asymmetric painted hash; D132 tension (graphite a11y header ≠ painted short hash).
   - B — Hold this 1 PNG out (recommended accept = 435 as above). Recapture graphite in a later update so both themes move together. **Cost:** paper a11y/meta new, paper PNG old, until that recapture — same D132 tension on paper.
   - C — Hold the whole archive-version-bump dirty set (2 a11y + 2 meta + 1 png = 5) so that family stays on HEAD pixels. **Cost:** archive-version-bump header hash lags the other 39 families.
   - **Recommendation: A** if the operator wants one hash across the corpus and will recapture graphite later; **B** if this batch must not introduce a theme-asymmetric PNG. Analyst does not pick for the operator.

---

## Recommended accept path counts

| include | paths |
|---|---:|
| Fingerprint-only a11y+meta (31 families) | 306 |
| Content a11y+meta (9 families) | 96 |
| Explained PNGs | 33 |
| **ACCEPT total** | **435** |
| Held (DN) | 1 (`archive-version-bump--paper-ink--1440x900.png`) |
| REJECT | 0 |

Unit 3 must not treat the held PNG as approved. Do not run `test:parity:update`.

---

## ALSO NOTED

- Ceremony cards still show raw `EID 10412770` / `EID read 10688204` — intended, not this delta.
- `identifier#` length clips the definition job title (WIG §6).
- Narrow run-* hash PNGs stayed clean while a11y moved — §7 threshold, not a missing file.
- `run-parked-write --resolve-present` PNG clean: dialog chrome covers the chip site.
- Remaining work after this artifact: Unit 3 apply/commit of the accepted set only; operator answer on question 1; no further family census.

---

## ui-review (delta only)

`stack: React 19.2.8 + Vite 8 + Tailwind v4.2.2 + Radix/lucide, no shadcn · WIG fetched live`

### src/domain/separations/identity-evidence.ts
`identity-evidence.ts:266` — definition string grows; ceremony line clips job title (WIG §6). Card still complete.

### src/server/dashboard/queries/run-detail.ts
`run-detail.ts:1632-1633` — parked copy is specific + next step. ✓ pass against WIG §5.

### src/domain/trust/failure.ts
`failure.ts:141` — withheld sentence is typed, not invented. ✓ pass.

### src/dashboard/surfaces/archive.tsx
`archive.tsx:3240` — background `shortHash` still paints under an open dialog; a11y omits it (D187). Theme-asymmetric PNG is the finding, not a source defect to fix in this unit.
