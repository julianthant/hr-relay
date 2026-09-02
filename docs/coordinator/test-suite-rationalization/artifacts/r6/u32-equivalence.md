# R6 u32 — parity equivalence and red capability

## Result

Commit `da4d51ff` reduced the lane from 287 to 281 cases and from 228 to 222 complete reference triples while preserving every distinct failure mode found in the inventory.

### Consolidation: explicit `run-receipt`

- Removed one six-variant matrix row and its 18 reference files.
- Mapped survivor: `run-done` for the same completed run, same default Receipt section, same theme/viewport matrix, same PNG and accessibility oracles.
- Controlled negative: temporarily changed the missing-receipt title in `src/dashboard/surfaces/receipt.tsx` to `No receipt NEGATIVE CONTROL`.
- Red evidence: the retained Graphite 1280×720 `run-done` case failed on exact accessibility reference drift at line 265, showing expected `No receipt` versus actual `No receipt NEGATIVE CONTROL`.
- The production mutation was immediately reverted; `git diff -- src/dashboard/surfaces/receipt.tsx` was empty afterward.

### Repair: `intake-rerun`

- Added a scene anchor that selects the `Rerun diff` tab and requires both the exact changed-plan explanation and the `Changed input hashes` table.
- Red evidence before refresh: all six named `intake-rerun` cases failed because the stored Review accessibility/pixel state changed to the real Rerun Diff.
- A deliberate `npm run test:parity:update` was used only after that independent expectation proof. It passed 281/281 and updated exactly the six `intake-rerun` PNG/accessibility pairs; their metadata identity was unchanged.
- All six new PNGs were inspected at original resolution. Both themes and all three viewports show the Rerun Diff, added/removed memberships, changed-input evidence, and contained footer/actions without clipping or blank regions.

### Strengthening: reduced motion

- The case now proves `matchMedia('(prefers-reduced-motion: reduce)')` and the computed root values of seven duration tokens, two travel tokens, and the entry-scale token.
- Controlled negative: temporarily changed `--ds-dur-1` from `0ms` to `1ms` in `src/dashboard/ds/tokens.css`.
- Red evidence: the focused case failed with received `1ms` instead of canonical computed `0s`.
- The production mutation was immediately reverted; `git diff -- src/dashboard/ds/tokens.css` was empty afterward.

## Gates

| Gate | Outcome |
| --- | --- |
| Focused repaired/surviving cases | 8/8 passed in 22.3s |
| Deliberate full refresh | 281/281 passed in 113.95s real |
| Reference inventory | 222 PNG + 222 accessibility YAML + 222 metadata JSON |
| Pixel/a11y strictness | Unchanged: `maxDiffPixels: 0`, threshold 0.2, coupled deliberate refresh only |

The refresh runtime is evidence of regeneration cost, not the final assertion-lane runtime. The final ordinary assertion run is recorded in the R6 report.
