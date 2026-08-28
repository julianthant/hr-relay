# Decisions — R2c `clear-pending` diagnostic scope — 2026-08-28
_Answer positionally: `1 A`, `1 B`, or `1 C + "note"`. Unanswered items stay open._

## 1 · How should R2c obtain a reproducible failed page state?

**Situation.** The historical 4568 dry run failed because the SS Smart HR search produced neither
of the two settlement signals within 45 seconds, but it persisted no post-click DOM, route, frame,
or screenshot evidence. Two fresh isolated searches now show the old implementation succeeding in
under one second. Without a different live state, a regression test for a banner-first repair would
either stay green against the old code or invent an unobserved fixture.

**Options.**

- **A. Authorize one diagnostic-capture unit before u32.** Add narrowly scoped, redacted failure
  capture at the SS Smart HR settlement boundary, with tests and correctness/silent-failure review;
  then hold R2c until that instrumentation captures a real differential state. This delays the repair
  and may require waiting for the failure to recur, but preserves the reproduce-first and fail-loud
  bars.
- **B. Authorize the banner-first redesign without causal reproduction.** Implement and test the
  count-banner classifier as hardening even though the current live state also passes the old code.
  This is faster, but it cannot prove the historical bug is fixed and risks regressing unobserved
  row-before-banner or no-match states.
- **C. Park R2c and move to other Phase 3b work.** Make no diagnostic or settlement change now. This
  avoids speculative code, but exit row 5 and the 4568 rehearsal remain open with no improved evidence
  if the failure repeats.

**Recommendation.** **A** — it is the only option that can produce a real RED fixture without
weakening the repository's fail-loud rule or pretending the current successful page reproduces the
historical failure.

**Notes.** _(your notes here)_

## Answers (2026-08-28)

| # | Chosen | Note |
| --- | --- | --- |
| 1 | A | Authorize one narrowly scoped diagnostic-capture unit before u32. |

## Ratified scope

Item 1 A is the operational authority for one pre-u32 unit that captures redacted SS Smart HR
settlement facts when the search remains indeterminate. The unit must have regression tests and
independent correctness and silent-failure review; it must not change the 45-second bound, turn an
unknown state into an empty result, add a selector fallback, retry a search or workflow, expose a
person identifier, or change transaction behavior. R2c remains held before u32 until this capture
records a real differential live state that can become the regression fixture.

Options B and C are rejected for this run: B cannot prove the historical bug is repaired, while C
would leave a repeat failure with no better evidence. This sheet owns the operational scope; it does
not change a product contract and therefore creates no D-numbered architecture decision.
