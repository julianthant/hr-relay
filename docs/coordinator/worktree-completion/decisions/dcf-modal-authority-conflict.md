# Decisions — DCF Run-modal authority collision — 2026-08-31

_Final operator answer: `1 A`, received 2026-08-31 after reviewing screenshots of both candidate
designs. Ratified as amended D293 in ref dashboard-surfaces §9.1 and the decision index. This sheet
is closed._

## 1 · Which Run-modal ruling survives?

**Situation.** The four commits on `codex/r-dcf-dashboard-fidelity` were authored from base
`d8554009` and ended at 12:14 PDT on 2026-08-28. They minted D284 for destination-free Start Run and
D285 for a graph-derived pre-run timeline. Current `integration/03b` later minted D284 for the sole
4537 canary at 12:36 PDT and D285 for the `Input -> Options -> Confirm` / `Customize steps` contract
at 19:07 PDT. The two histories therefore reuse the same decision ids and implement incompatible
Run-modal behavior; a normal merge reports conflicts across the owner docs, UI, wire, tests, and all
24 parity triplets.

**Options.**

- **A — SELECTED. Preserve current D284/D285; port only destination-free Start Run under the next available decision.** Keep the later 4537 and Customize-steps authorities, discard the DCF timeline implementation/references as superseded, and reimplement the still-compatible destination removal on top of current integration. This requires one bounded new source/test/parity unit but avoids undoing accepted behavior.
- **B. Replace current Run-modal D285 with the DCF timeline ruling.** Renumber the colliding decisions, remove current Customize-steps behavior, and integrate the four-commit product shape. This revokes a later accepted operator ruling and requires broad source/test/parity reconciliation.
- **C. Defer all four DCF commits as retained history.** Make no Run-modal change now. This avoids an authority rewrite but leaves the direct destination-free ruling unimplemented and preserves a permanently non-mergeable branch until final cleanup disposition.

**Decision.** A — preserve both newer screens shown in the selected screenshots: Options and the
conditional Steps screen. D293 removes only the per-start Destination section and dashboard
`requestedInstance`; D285's Customize-steps interaction and D284's later sole-canary meaning stand.

**Notes.** The answer sequence was `1A`, then temporary `1B` while the terms were being explained,
then final `1A` after the operator reviewed screenshots and said “I want these 2” about the newer
Options and Steps screens. The final visual keeps those two screens without the Destination controls.
