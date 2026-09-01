# Run plan — separations completion — 2026-08-31

| Run | Theme | Units | Roles | Base | Integration target | Needs first | Exit evidence |
|---|---|---|---|---|---|---|---|
| R1 | live controlled completion of separations (03b criterion 5) | u1–u5 | sup-fable supervisor; sup-scout for read-only mapping | fresh master pin at dispatch (clean, quiescent) | feature/03b-live-close (recreate) → master --no-ff | P1 quiescent checkout · P3 secrets in .env · re-confirmed gate window (P2 backups CLEARED 2026-09-01; P4 pin mechanical) | 9/9 exit criteria, integrated gate table green, board updated |

R1 attempt 1 (2026-08-31→09-01) closed BLOCKED at admission — reports/r1.md. Brief reworked to
rev 2 with a four-precondition dispatch gate; sequence unchanged, nothing consumed.

> **2026-09-01, rev 3.** "Needs first" precondition P3 ("secrets in .env", the three person
> secrets) is SUPERSEDED by D300: the admission is now the single document-number key
> `HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER` in `.env`, proved by
> `npm run smoke:test-target-document-number` exit 0. See
> handoffs/2026-09-01-finish-separations-r1-rev3.md.

## Units

### u1 — runtime admission + fresh subject/S7 observation
- Scope: primary checkout runtime; read-only live re-read of Kuali doc 4537 and current S7 from the
  real clock. No writes.
- Acceptance: admission passes past runner import (§9.32 refusal resolved by running in the primary
  checkout whose `.env` exists); a dated fresh observation recorded (§9.33) showing 4537 present,
  mapped as §9.19/§9.31 expect, S7 current.
- Dependency: none. STOP-and-report if 4537 absent/changed or S7 fails.

### u2 — composed dryRun=true rehearsal + exact-run 0/0/0 (D287)
- Scope: one composed rehearsal run on 4537 to its declared preview terminal.
- Acceptance: preview terminal reached; exact-run authority proves zero `write_intents`, zero
  `write_attempts`, zero `durable_outbox`; run/trace ids recorded; source + canonical input FROZEN
  from this rehearsal through ③.
- Dependency: u1 green.

### u3 — controlled commits ② → immediate ① → ③ (A2–A4)
- Scope: ② UCPath filing, ① UCPath pending sweep on the row ② creates (run immediately, before an
  approver clears it — ①'s only honest COMMITTED witness), ③ Kuali finalization with the real
  transaction number. Each write behind its OWN operator ALWAYS-GATE.
- Acceptance: three durable results with authority rows/receipts; no `reRead` after ②; UNKNOWN
  stops without retry and is never re-run.
- Dependency: u2 green + per-write operator approval.

### u4 — A5 measurements riding the commits
- Scope: `probeToFenceMaxMs` per beat (§4f3); D207's 30 s `stabilized` recovery-absence window on
  this write's own evidence; the seven Kuali payload shapes; D215's `would-prepare` preview arm
  against a real settlement; D217's two date write-back WIRE SHAPES (epoch-ms model values).
- Acceptance: each observation recorded in §9.33 with authority evidence; T1b manifest run live and
  recorded `met`.
- Dependency: rides inside u3's runs; cannot be separately scheduled.

### u5 — A8 close-out to rebuild-ready
- Scope: regression scenarios + knowledge records for anything the live lane found; capability
  dispositions; docs to as-built (03b Track A + exit table to 9/9, migrations/separations.md STATUS
  + §6 + §9.33, `npm run roadmap`); lesson if non-obvious; full gates; merge `--no-ff` to master.
- Acceptance: integrated gate table green at the merge commit; board write-back.
- Dependency: u3/u4 complete (or a coherent stop with truthful docs if a blocker stops the sequence).

## Decisions gating runs
- None open. D284/D287/D290–D293 ratified. The three ALWAYS-GATE approvals are in-run operator
  actions, not pre-run decisions.

## Residue carried in
- From worktree-completion close: R2 live-admission residue (this run IS that item).
- NOT in scope: doc 4568 WFD range-field clear (R3, §9.29); dcc-storage-span-visibility
  (dashboard-surfaces §9.8, Phase 4); Run-modal touch targets (Phase 4).
