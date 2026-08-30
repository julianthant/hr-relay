# DCC2 — loaded doctor detail and pre-existing display omission

Coordinator receive, 2026-08-30. This is a bounded branch-local disposition, not final integration
acceptance or a ratified change to the product contract.

Source: `/Users/julianhein/.codex/worktrees/c9fb/r-dcc-units/dcc2`.
HEAD `ac40292b8e3e8ff9b66242bbf8f8288554335f40`, pending merge parent
`13175b13340fec7b5326207fe54f98078d481d7d`; tested candidate tree
`56ba105f1841097927a444d6454686c954b4e9db`.

| Claim | Classification | Evidence checked | Disposition |
|---|---|---|---|
| Candidate remains the gated tree | Proved | Index-to56ba and tracked-to-index checks each exit0; no unmerged entries | Existing full-gate attribution remains applicable before any further changes |
| Doctor wire carries degraded span evidence | Proved from retained synthetic HTTP capture | Assigned evidence/dcc2-m4/doctor-response-verified.log: HTTP200, spanAuthority degraded, streamRunCount11/liveRunCount7, four malformed span_stream diagnoses | Never turn omitted display into healthy/reconciled wire truth |
| DoctorReport omits spanAuthority on both histories | Proved | Original ac40292 renderer inspected; frozen13175 and56ba settings.tsx both blob4d53dcad1fbcceaacd99b2f470a260586bfa1ef0, no spanAuthority rendering | Pre-existing, not a DCC2 reconciliation regression |
| Loaded detail covers other doctor fields | Proved in retained accessibility snapshot; visual quality claimed by supervisor | Assigned dcc2-m4.md and evidence/dcc2-m4/storage-detail-loaded-paper-ink-1440x900.yml show authority, counts, backup, service and restore count; linked PNG not independently visually reviewed by coordinator | Do not describe this as rendered coverage of span diagnoses |
| Current owner explicitly requires exact rich wire/exit semantics | Proved | dashboard-surfaces §2.5:1397–1425; degraded/unavailable/reconciled distinction and safe span_stream diagnoses | Preserve existing backend contract and all guards |
| Current display owner explicitly enumerates spanAuthority rendering | Not established | §9.8:4523 onward lists authority, pending durable work, backup, restore candidates and service; does not expressly name spanAuthority | Do not invent a new presentation acceptance claim or silently ratify scope |

M2 explicitly preserved the frozen baseline UI. Coordinator therefore permits the already-reviewed,
fully gated backend reconciliation to commit through the existing local --no-ff workflow, provided
its product/test/reference closure stays identical to56ba and the report preserves this caveat.
No source repair, reference refresh, additional heavy allocation, final shared merge or source
worktree removal is authorized by this disposition. Final clean-head/review receive is still due.

Subsequent product merge `0b9a4de73504aeb1dc354e82927e0423960b0a37` independently verified:
tree is exactly56ba above, parents exactlyac40292/13175. Final clean c9af958a is now received
branch-locally with evidence-only changes and independently matched whitespace ledger; see
dcc2-receive.md. The open presentation follow-up below is unchanged.

**OPEN follow-up: dcc-storage-span-visibility.** Coordinator owns the residue at the declared
presentation authority `docs/rebuild/reference/dashboard-surfaces.md` §9.8. Assess whether/how the
doctor should present this already-served arm before claiming aggregate UI completion; resolve any
new product-scope choice with the operator. A later implementation requires its own explicit scope,
/ui, tests/review and gates. This item is neither fixed nor waived merely because it predates the
current branch. Preserve synthetic HTTP/snapshot/PNG evidence and the distinction from live proof.
