# R4 u22 — parity and T2 overlap

## Exact equivalence rulings

| Unit assertion family | Disposition | Retained owner and stronger oracle |
| --- | --- | --- |
| `queue-touch-target.test.ts` member toggle/name/info class-token geometry | Remove geometry; retain generic `IconButton` semantics separately | `tests/parity/member-touch-target.spec.ts` measures both axes, ownership/containment, adjacent-name collision, fine-pointer density, and the real built control. |
| `top-bar-search-a11y.test.ts` compact/coarse class-token geometry | Remove entire misleadingly named file | `tests/parity/top-bar-search-touch-target.spec.ts` measures two 44px coarse targets, hit ownership/non-overlap, and 24px fine density in Chromium. |

These are the same risk but a stronger seam and oracle. They are not replaced with markup snapshots.
The retained R6 lane remains 17 specs / 281 cases / 222 complete pixel-accessibility-metadata
reference triples.

## Controlled browser reds

| Mutation | Retained browser failure |
| --- | --- |
| Change Top Bar coarse overlay height from `h-11` to `h-6` | `top-bar-search-touch-target.spec.ts` failed: expected effective height `>= 44`, received `24`; 1 failed / 1 passed. |
| Change member-toggle coarse overlay from `size-11` to `size-6` | `member-touch-target.spec.ts` failed: expected effective size `>= 44`, received `25`; 1 failed / 4 passed. |

The focused wrapper also reported that a single-file run lacks the full lane's required body-backed
accessibility evidence; that is an expected secondary verifier refusal, not the geometry oracle.
Both mutations were restored with zero production diff. The complete wrapper-owned parity lane is
the final green authority.

## Retained boundaries

T2 does not replace unit command composition. For example,
`tests/scenario/dashboard/separations/identity-gate.scenario.test.ts` owns the real projection and
command effects, while `identity-ceremony.test.ts` keeps unsupported/contradictory wire shapes.
Likewise, parity screenshots and accessibility snapshots do not replace threshold arithmetic,
provider nesting, unrendered token branches, generic primitive names, alternate refusal arms, or
press/focus transitions. Those unit/jsdom families remain.
