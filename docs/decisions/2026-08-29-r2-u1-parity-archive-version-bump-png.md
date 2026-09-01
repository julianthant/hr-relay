# Decisions — R2 u1 parity-final archive-version-bump PNG — 2026-08-29
_Answer positionally: `1 A`, `1 B`, `1 C + "note"`, or `all recommended`. Unanswered items stay open._

## 1 · What should we keep for the Archive “version bump” snapshots?

**Situation.** The dashboard screenshot tests freeze each screen as three files: a picture
(`.png`), an accessibility tree (`.a11y.yml`), and a small metadata record (`.meta.json`). Those
three must describe the same screen (D132). For Archive → Versions & bumps → “Bump Person Lookup”
at 1440×900, a tiny hash in the dimmed table behind the dialog changed from `09a0111` to `4c6200f5`.
The dialog itself hides that table from the accessibility tree, so only the picture shows it.

The child already committed **435** other snapshot files as `4a87373b` (option B as previously
written). Paper’s picture was left out. Screenshot tests are **238 pass / 1 fail** (paper picture,
29 pixels). Graphite’s picture never moved — too dim to cross the 0.2 colour threshold — but its
text files in that commit already carry the new hash. Independent review (2026-08-30) called that
graphite split **high**: the test stays green while the picture is stale. Merging as-is does not
make the suite green. No 4537, HR login, or live write.

**Options.**

- **A. Add the paper picture and merge 436 files.** Paper’s screenshot then matches the new hash.
  Cost: graphite’s screenshot still shows `09a011`; paper and graphite disagree until a later
  recapture of graphite.
- **B. Merge the 435 as they sit (current child).** Paper’s failing 29-pixel test stays red and
  loud. Cost: graphite is green with a stale picture; paper’s text files no longer match its
  picture. A later one-file refresh of paper would hide that split.
- **C. Drop the whole Archive version-bump set from this freeze (2 trees + 2 metadata; picture
  already at the parent).** Child then matches the parent for that family; the other 39 families
  still freeze. Cost: this family’s header hash lags the rest until a later paired recapture of
  **both** themes together. Needs one follow-up commit on the child before merge.

**Recommendation.** **C** — do not ship a known split pair. Review found B leaves graphite quietly
wrong and paper loudly wrong; A only fixes paper and still splits the themes. Recapture both
pictures later as one update.

**Visual.** Compare
`tests/parity/references/archive-version-bump--paper-ink--1440x900.png` (held, 29 px off current
paint) with
`tests/parity/references/archive-version-bump--graphite-warm--1440x900.png` (not in the commit,
still `09a011` under the overlay). The chip is in the table behind the modal, not in the dialog
copy.

**Notes.** _(your notes here)_

## Answers (2026-08-30)

| # | chosen | note |
|---|---|---|
| 1 | **C** | Operator: “do your recommend.” |
