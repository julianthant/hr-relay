# New Kronos store

Inherits the repository-root `AGENTS.md`. This file owns Codex-facing store invariants and dated
lessons. The sibling `CLAUDE.md` is platform-specific and is not authoritative for Codex where it
conflicts with this file or the migration evidence.

## Range-field invariant

- **2026-08-27 — WFD's masked range field is never proved by an intermediate clear or selection
  shape (§9.30).** `#startDateTimeInput` is a top-level visible `input[type=text]` bound directly to
  Angular's formatted/ISO date model; there is no hidden model input to drive instead. `fill("")`
  read the non-empty default at 0/100/200/500/1000 ms, while Home+Delete and End+Backspace left it
  unchanged. Do not restore any of those paths, add a longer wait, or gate on an empty state.
- The live keyboard mechanism is click → `ControlOrMeta+a` → `pressSequentially`. Select-all may
  expose the whole ten-character value or retain the current date segment; it is only an input
  gesture. On a fresh range panel, real keystrokes advanced the mask from `05/27/2026` to
  `05/08/2026` even from the `0..2` month segment. The ONE success/refusal authority is the bounded
  final read-back parsed and compared as the requested calendar day.
- A final mismatch must name both `priorValue` and the last observed value. This keeps the known
  mid-year silent-selection failure (`6/1/2026` → `11/20/2626`, §9.28) diagnosable without accepting
  it. `readSeparationTimecard` sets start, end, then start again; the third start re-proof retains the
  same final equality veto.

This live probe supersedes for Codex the sibling `CLAUDE.md` u21 claim that select-all never selects
and `fill("")` is the proven clear. That text is intentionally untouched under the repository's
platform-document ownership rule.
