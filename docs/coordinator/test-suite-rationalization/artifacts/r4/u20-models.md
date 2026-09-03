# R4 u20 — pure model and Node assertions

The pure/Node audit retained every decision, transformation, strict-parser refusal, command
composition, and projection-fold case. No two collected cases shared a full behavior title, and
the apparent neighboring families used different inputs or observable seams. In particular:

| Family | Retained risk |
| --- | --- |
| `identity-ceremony.test.ts` | Unsupported and contradictory command-wire shapes; T2 only owns the real gate transition. |
| receipt/failure model files | Alternate fail-loud arms and derived evidence sentences that screenshots do not enumerate. |
| breakpoints/tokens/shell structure | Threshold arithmetic, token references, and provider/region nesting that a screenshot cannot exhaust. |
| client/transport files | Exact request, parser, abort, and refusal behavior below the scenario seam. |
| fixture contract files | Closed-boundary and schema validity; not a second assertion of product behavior. |

`queue-touch-target.test.ts` was not retained as a model test: its constants were implementation
tokens for browser geometry, not a domain decision. Its one distinct generic component contract was
re-homed as two single-behavior cases in `icon-button-semantics.test.ts`: caller class forwarding
and required accessible naming. The remaining geometry assertions moved to no new unit snapshot;
the existing browser owners remain authoritative.

The directory's Node population changes from 82 files / 786 cases to 81 files / 780 cases. That
six-case reduction is exactly the eight removed geometry cases minus the two retained primitive
semantics cases; no pure decision case was removed.

## Negative controls for the retained primitive seam

| Deliberate production mutation | Expected red |
| --- | --- |
| Omit the caller `className` from `IconButton` composition | `forwards the caller's class to the native button` failed on missing `caller-owned-class`; 1 failed / 1 passed. |
| Omit `aria-label={label}` from `IconButton` | `uses the required label as the native button's accessible name` failed on the exact missing label; 1 failed / 1 passed. |

Both mutations were restored with zero production diff, and the focused green passed 2/2.
