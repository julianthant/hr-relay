# Phase 3a decision-brief coverage — 2026-08-25

This is the coverage ledger for the six operator sheets dated 2026-08-25. `L1`, `L2`, and
`L3` mean the shell/queue/start, run-detail, and standing-surfaces audits under
`docs/plans/2026-08-21-03a-fidelity-*.md`. A live item is one numbered decision in one sheet;
the inventory below contains each live item exactly once. Related audit rows may be discussed
together, but an exact, resolved, ruled, repair-only, or producer-owned row is not counted as a
second operator decision.

## Count gate

| Sheet | File | Live items |
|---|---|---:|
| Worker pool | `2026-08-25-03a-worker-pool-semantics.md` | 5 |
| Shell, queue, and start | `2026-08-25-03a-demo-fidelity-core.md` | 9 |
| Run detail | `2026-08-25-03a-demo-fidelity-run-detail.md` | 10 |
| Standing product surfaces | `2026-08-25-03a-demo-fidelity-standing-product.md` | 10 |
| Standing-surface conventions | `2026-08-25-03a-demo-fidelity-standing-conventions.md` | 10 |
| Standing-surface copy and served facts | `2026-08-25-03a-demo-fidelity-standing-copy.md` | 5 |
| **Total** |  | **49** |

No sheet exceeds the decision-brief limit of ten items. All 49 items have the fixed
`Situation` → `Options` → `Recommendation` → `Notes` shape. None needs a separate `Visual`
block: the options are decidable from the named files, source rows, and concrete UI behavior;
no screenshot or diagram is required to distinguish the alternatives.

## One-to-one live-item inventory

The `Brief item` column is the stable local number presented in its sheet. Source references use
the audit's row IDs or its numbered roll-up groups; code and contract evidence remains in those
audits and their cited files.

### Worker pool

| Brief item | Source evidence |
|---|---|
| `worker-pool` #1 | `ref execution-and-sessions` §11 — stop versus capacity |
| `worker-pool` #2 | `ref execution-and-sessions` §11 — graceful timeout, `SIGTERM`, and `SIGKILL` |
| `worker-pool` #3 | `ref execution-and-sessions` §11 — maximum pool size |
| `worker-pool` #4 | `ref execution-and-sessions` §11 — crash and replacement policy |
| `worker-pool` #5 | `ref execution-and-sessions` §11 — supervisor ownership after restart |

### L1 — shell, queue, and run start

| Brief item | Source rows |
|---|---|
| `demo-fidelity-core` #1 | A65 |
| `demo-fidelity-core` #2 | A81, A82, A168, A169, A170 |
| `demo-fidelity-core` #3 | A16, A174, B141 |
| `demo-fidelity-core` #4 | A122, A126 |
| `demo-fidelity-core` #5 | B155, B164, B165, B172, B173, B174, B195, B196 |
| `demo-fidelity-core` #6 | B57, B80 |
| `demo-fidelity-core` #7 | B112 |
| `demo-fidelity-core` #8 | C57, C61, C69, C107, C108, C109 |
| `demo-fidelity-core` #9 | C28, C48, C72, C81, C83, C84, C94 |

### L2 — run detail

| Brief item | Source rows |
|---|---|
| `demo-fidelity-run-detail` #1 | A3, A13, A18, A19, A35, A37, A38, A41, A47 |
| `demo-fidelity-run-detail` #2 | B41, B44, B50, B57, B60, B61 |
| `demo-fidelity-run-detail` #3 | B79, B83 — empty stream, paging, and search treatment; B80 is ruled pagination, not live |
| `demo-fidelity-run-detail` #4 | A49, B87, B91 — the dot rows are one shared liveness cue |
| `demo-fidelity-run-detail` #5 | C4, C16, C21, C32, C51 |
| `demo-fidelity-run-detail` #6 | C55, C57, C70, C71 |
| `demo-fidelity-run-detail` #7 | D8, D9, D11, D13, D17, D24, D29, D39; D11/D39 are repair/proof obligations inside this evidence-vocabulary item |
| `demo-fidelity-run-detail` #8 | E4, E5, E6, E8, E9, E11, E15, E22, E30; E22/E30 retain the audit's ruled redaction/count halves and open presentation halves |
| `demo-fidelity-run-detail` #9 | F22 |
| `demo-fidelity-run-detail` #10 | F35 |

### L3 — standing product surfaces

| Brief item | Source evidence |
|---|---|
| `standing-product` #1 | L3 roll-up group 1 — AR32–AR35, AR51 (archive virtualisation) |
| `standing-product` #2 | L3 roll-up group 2 — VB1, VB13, VB22, VB23, VB26 (major/minor authority semantics) |
| `standing-product` #3 | L3 roll-up group 3 — UK146–UK157 (the design-system specimen page) |
| `standing-product` #4 | L3 roll-up group 4 — CA1, CA16, CA23, CA36 (served catalog vocabulary) |
| `standing-product` #5 | L3 roll-up groups 5–6 — SE1–SE4, SE7, SE8, SE43, SE44 (Settings container and keyboard-help destination) |
| `standing-product` #6 | L3 roll-up group 7 — SE40–SE42 (read-only Settings sections) |
| `standing-product` #7 | L3 roll-up group 8 — CP3, CP4, CP5, CP17, CP18, CP59 (operator half of phone capture) |
| `standing-product` #8 | L3 roll-up group 9 — IN15, IN16, IN123, IN124, IN126, IN127, IN131, IN137, IN139, IN144 (Manifest and rerun stages) |
| `standing-product` #9 | L3 roll-up group 10 — IN118, IN119, IN120 (unresolved-rejection review gate) |
| `standing-product` #10 | L3 roll-up groups 11–12 — AR188–AR190, AR249, VB24–VB25 (capture viewer and bump-plan list) |

### L3 — standing-surface conventions

| Brief item | Source evidence |
|---|---|
| `standing-conventions` #1 | L3 roll-up group 18 — CA41 (catalog entry route) |
| `standing-conventions` #2 | L3 roll-up group 20 — AC12, AR9 (shared takeover wrapper) |
| `standing-conventions` #3 | L3 roll-up group 21 — AC62, AC77, AR225 (horizontal overflow) |
| `standing-conventions` #4 | L3 roll-up group 23 — AR244, AR245 (async loading and refusal panes) |
| `standing-conventions` #5 | L3 roll-up group 24 — EX66, EX87, EX88, EX127, EX133, EX165 (Explorer surplus facts) |
| `standing-conventions` #6 | L3 roll-up group 25 — EX114, EX125 (Explorer field-edit affordance) |
| `standing-conventions` #7 | L3 roll-up group 26 — archive copy and surface-shape rows AR4, AR37, AR54, AR56, AR80–AR241 as enumerated in the audit |
| `standing-conventions` #8 | L3 roll-up group 28 — intake shape rows IN21–IN24, IN30, IN32, IN34, IN46, IN47, IN55, IN56, IN61, IN70, IN75, IN97–IN100, IN102, IN103, IN107–IN109, IN111–IN114, IN117, IN122 |
| `standing-conventions` #9 | L3 roll-up group 31 — version-bump authoring structure and controls VB4–VB17, VB22–VB28, VB34, VB37, VB38, VB40 |
| `standing-conventions` #10 | L3 roll-up groups 32–35 — AC10, AC11, AC19, AC90; SE45, SE46, SE63, SE64; UK141, UK144; CA59 |

### L3 — standing-surface copy and served facts

| Brief item | Source evidence |
|---|---|
| `standing-copy` #1 | L3 roll-up group 27 — intake naming rows IN2, IN3, IN7, IN27, IN44, IN45, IN64, IN66, IN69, IN72–IN74, IN95, IN101, IN110, IN115, IN116, IN138 |
| `standing-copy` #2 | L3 roll-up group 30 — Explorer copy/geometry rows EX8, EX13, EX18, EX20, EX23, EX26, EX55, EX65, EX72–EX75, EX96, EX101, EX103, EX155, EX156, EX166, EX168, EX171, EX172 |
| `standing-copy` #3 | L3 roll-up group 31's wording/outcome subset — VB29–VB33, VB36, VB41, VB43, VB45, VB47, VB50; the structural/control rows remain with `standing-conventions` #9 |
| `standing-copy` #4 | L3 roll-up groups 32–33 — Activity AC10, AC11, AC19, AC90 and Settings storage SE45, SE46, SE63, SE64 |
| `standing-copy` #5 | L3 roll-up groups 34–35 — UK141, UK144 and CA59 |

## Exclusion and disposition ledger

These are named so a future sweep does not mistake a resolved row, a duplicated cue, or an
implementation repair for an unanswered operator choice.

| Disposition | Prompt(s) / rows | Evidence and why it is excluded from the 49 |
|---|---|---|
| Exact at audit | L1 A159, B46; L2 B65 | The source rows are `exact` in their respective ledgers: the keyboard tab binding, queue opening paragraph, and step-grouped stream already match. They need no ruling. |
| Already ruled, not a new question | L2 B80; L2 B45; all L1/L2 rows whose verdict reason begins `ruled:` or `unserved:` | L2 B80 is the strict wire's cursor pagination; B45 is the D225 recorded tension. The ledger's “Verdicts and reasons” contract says a `ruled:`/`unserved:` reason is not an `OPEN — operator call`. |
| Ported/closed before this brief | L2 D25, D27, D31, D32, E19, E20, E24, E25 | `ported cf2ee74a` and `ported df5ea509` in the L2 rows document the code closure: `evidenceSourceMeta`, receipt fingerprints/failure identity, and failure occurred/run/page/action facts now render. |
| Resolved L3 groups | L3 groups 13, 14, 15, and 22 | Group 13 cites `3d461962`/`d1f87916`; group 14 cites `d1f87916`; group 15 cites `4e09fb49`; group 22 cites `d1f87916`/`4da19fd7`. Their rows are resolved at HEAD, not operator decisions. |
| Repair, not permission | L2 D11 and D39; L3 group 16 (`EX180`); L3 group 17 (`UK66`, `UK67`, `UK69`, `UK158`); L3 group 19 (`IN155`) | D11 is constrained by the receipt schema/D238 and cannot authorize a fabricated invariant banner; D39 is a stale `receipt.tsx` placeholder comment. EX180 is a stale `skippedAboveBoundary` port claim. UK66/67/69/158 are binding-doc/guard claims checked against `src/dashboard/DESIGN.md` and `ratchet-arms.ts`. IN155 is the D173 “CONSTANTS RENDER READ-ONLY” wording/code inconsistency. These are source repairs or documentation corrections, not choices to ask. |
| Duplicate evidence folded into one item | L2 A49/B87; L1 B57/B80; L3 AR188–AR190/AR249; L3 VB24/VB25 | The first pair is one live dot cue; the L1 pair is one checked-by-you state; the capture rows are one viewer decision; and the bump rows are one reviewed-list decision. The sheets retain one number per coherent decision rather than asking the same choice repeatedly. |
| Producer/projection scope, not copy permission | L3 group 29 (`IN8`, `IN9`, `IN53`, `IN82`, `IN106`, `IN121`, `IN126`, `IN127`, `IN131`) and other rows explicitly marked `unserved:` | The L3 audit names these as wire-served facts dropped by the surface, while their handling belongs to the named projection/producer contracts. No current sheet silently decides to invent or rename those values; the fail-loud rule keeps them outside this visual brief. |
| Cross-cutting rows assigned by dimension | L3 group 31 and groups 32–35 | A row about structure/control belongs to `standing-conventions`; a row about wording/outcome belongs to `standing-copy`. The allocation tables state the split explicitly, so the current five-item copy sheet does not create phantom IDs or duplicate a seventh-item predecessor. |

## Audit conclusion

The evidence-backed correction is to retain the planned **49 live decisions** and repair the
coverage references above. No decision was renumbered. The only local numbering change reflected
here is the current five-item `standing-copy` sheet, whose coverage now uses `#1`–`#5` exactly.
