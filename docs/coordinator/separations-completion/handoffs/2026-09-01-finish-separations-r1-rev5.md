# Handoff — Finish separations R1 revision 5

**Date:** 2026-09-01 · **Paused at:** u1 required safety stop; u2–u5 blocked · **Cleanup owner:**
the supervisor that resumes after the operator names a replacement canary · **Remove when:** a new
canary completes u1–u5, the coordinator reconciles the board, and deletion is committed.

## Durable state

- u0 / D300 is complete: one closed document-number environment reference, composed live derivation
  of person facts, strict smoke, reconciled tests/docs, and all eight `AGENTS.md` / `CLAUDE.md`
  pairs byte-identical.
- u1 ran once. Scenario result `62ea22fd-798c-4982-b4d7-8a211c6ec954`, run
  `325cd998-bd05-4ffd-a863-99e0cc5c0ebe`, trace `sp-142939-325c`, failure
  `b5f34a55-75c5-423e-a7c2-d7fa8548b392` prove `DOCUMENT_NOT_IN_ACTION_LIST`,
  `writeState: not-attempted`, and exact-run `0/0/0` write rows.
- No gate was requested, no approval was consumed, no write was prepared/submitted, and no UNKNOWN
  exists. Do not start u2–u5 and do not retry this canary.
- `finalization-canary` is retained as `gone`, last observed 2026-09-01. D284 forbids an inferred
  substitute. The operator must name the next controlled-commit canary.
- The direct scenario-start queue-root bug exposed by the live run is fixed and regression-pinned.
  D301's reviewed offline recovery preserved the historical 2,422-byte prefix by digest and
  appended one exact authority reconstruction. Storage doctor is now exit 0 with 8/8 stream/live
  runs reconciled and current generation-1335 authority/backup; an exact repeat changed no byte,
  and BFF bootstrap served healthy/current storage.
- Final branch gates: typecheck 0; lint 0; coverage 368/368 and 4583/4583; manifest current; roadmap
  fresh; parity 289/289; instruction pairs 8/8 identical; diff check clean.
- Full evidence is `docs/coordinator/separations-completion/reports/r1-rev3.md` §6 and
  `docs/migrations/separations.md` §9.33.

## Resume only after the operator names a replacement canary

1. Verify local `master`, clean git state, no listeners on 3938/5174, the current report, and this
   handoff. Never push.
2. Re-verify storage doctor remains exit 0. D301 closed the prior `span-stream-invalid` by an
   append-only authority reconstruction; never insert, truncate or hand-edit diagnostic history.
3. Register the operator-named canary with a dated observation and its one closed D300 document-number
   reference. Preserve the gone 4537 row.
4. Run the strict smoke, fresh read/S7 observation, and one composed dry-run. Require exact-run
   `write_intents=0`, `write_attempts=0`, `durable_outbox=0` and a green terminal before any approval.
5. Execute ② UCPath filing → immediate ① pending sweep → ③ Kuali finalization. Take each of the three
   ALWAYS-GATE approvals separately. Freeze source/canonical input from the green rehearsal through
   ③, forbid `reRead` after ②, and stop without retry on UNKNOWN.
6. Preserve receipts, reconcile only the owning phase/migration/decision documents, ask the
   coordinator to update the board, then remove this handoff in the same verified closeout.

The verified R1 work was merged locally into `master` at `0e0d2c55` with `--no-ff`, and its feature
branch was deleted. D301 storage recovery followed on local master. No remote push is authorized.
