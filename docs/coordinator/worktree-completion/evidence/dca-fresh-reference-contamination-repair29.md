# Repair29 — remove transient connection state from refreshed reference

Date: 2026-08-31  
Checkout: `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`  
Branch/HEAD: `feature/dca4-archive-evidence` / `eda17b2708286e36542e1e18e9f8ef6a06cf3187`

## Finding

The sole authorized `test:parity:update` run changed 81 tracked references. Independent authority and
UI reviews reconciled 79 paths, but rejected the pair
`run-receipt--paper-ink--narrow-1024x768.{a11y.yml,png}` because the run captured the Session Panel
while its transport was transiently `Reconnecting`. D292 owns the new `Run captures` alert; it does
not authorize a connection-state change.

The same update run also timed out before bootstrap in the separate keyboard-focus test after 200
earlier cases. Gate27 had passed that exact case in 594 ms, and the failed page never advanced beyond
`Starting…`, so the red did not reach keyboard or DCA4 behavior.

## Asserted diagnosis and repair

A two-case direct Playwright assertion ran with `PARITY_UPDATE` unset under the shared lock:

- chunk `5a0452`: keyboard focus passed in 650 ms; narrow Receipt failed only at a11y line 288,
  stored `Reconnecting` versus actual `Live`.
- the a11y reference retained the three-line D292 `Run captures` region and changed only the Session
  Panel status back to `Live`.
- the paired PNG was restored to its exact tracked pre-refresh bytes because visual comparison showed
  that its only changed pixels were the bottom-right `Reconnecting` label/dot; the D292 alert is below
  this narrow viewport's visible clip and remains represented in the a11y authority.
- chunk `35d00c`: the same two asserted cases passed, 2/2, in 3.2 seconds with update mode absent.

No second update-mode command, timeout increase, product/test change, fallback, retry policy, or
unrelated reference edit occurred.

## Current reference delta

The reviewed refresh now contains exactly 80 modified tracked references: 50 a11y, 12 PNG, and 18
metadata files. `git diff --check -- tests/parity/references` passes.

- corrected narrow a11y SHA-256:
  `da1a953fa356f44ef61fb2437b57711804b160ccee482c60f5ca3d529d8e0dd4`
- restored narrow PNG SHA-256:
  `2d8cf4f5b1558b5cd1b19f05796218a1972b44c7fae760731cac6484841d5f89`

Status: focused asserted proof is green; independent delta/UI re-review and the complete ordered gate
sequence remain required.
