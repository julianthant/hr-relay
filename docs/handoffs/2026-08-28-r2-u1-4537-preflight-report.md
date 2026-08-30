# Phase 3b R2/u1 — 4537 composed dry-run preflight report

**Closed:** 2026-08-28 PDT
**Verdict:** **BLOCKED — exact registry admission conflict before a run**

## Scope and authoritative admission result

The only permitted target was `separations-controlled-commit-candidate` for the composed
`separations` workflow. I did not substitute a label, document number, free-form identifier, or the
separate `separations-kuali-finalization` workflow.

The red-capable, read-only admission assertion was:

```text
./node_modules/.bin/tsx -e '<imports TEST_TARGET_REGISTRY and resolveSeparationsTestTarget; exits unless ready>'
{"expected":"ready","actual":"blocked","label":"separations-controlled-commit-candidate","reason":"blocked: needs separations-controlled-commit-candidate; registry says gone, last observed 2026-08-14"}
exit 42
```

The registry's safe fields identify the label as `workflow: separations`,
`kind: controlled-commit-candidate`, availability `gone`, document **4524**, provenance
`docs/migrations/separations.md` `§9.12, §9.16 §3`, and a completion reason dated 2026-08-14. The
composed resolver is the stated admission authority; this conflicts with the brief/board's asserted
4537 subject. The stop is therefore authoritative.

## Intake and runtime evidence

| Check | Verdict |
|---|---|
| Branch / ancestry / tracked tree | `integration/03b`; `HEAD=1fe337edea88caae76b5d58f6e1b6ea73f9026e9`; required base `f6d8d12b` is an ancestor; clean before documentation writes |
| Board blob at intake and close | `0ef85a59de1ffec7f3a60c265cb9eb95f14dda20` — unchanged, so the authorized close update was applied |
| Pacific date | 2026-08-28 PDT |
| Runtime isolation | rebuild `.tracker-rebuild`, 3938/5174, `hrauto-rebuild` |
| Browser sessions | `playwright-cli list`: no browsers |
| Pre-existing dashboard runtime | BFF PID 75525 and Vite PID 75512, both started 11:07 PDT; not owned by this unit and left untouched |
| Worker locks/processes | Historical unreleased records had dead PIDs; no live worker process was found or mutated |
| Authority runs | 3 old nonterminal `separations-kronos-timecard` records from 2026-08-12; no live worker owned a current root run |
| Storage doctor | Read-only authority inspection was healthy; command exited 1 because the verified backup was stale, not because authority was unhealthy. No remediation was in scope. |

The BFF/Vite pair and all historical records were observed only. This unit started no runtime and
therefore had nothing to close. No Playwright session, worker lock, run, or screenshot output was
created.

## Work intentionally not performed

The admission block occurred before the request's conditional execution path. Accordingly, none of
these commands/actions was run: the integrated gate, UCPath/Kuali/Kronos login smokes, a start plan
or confirm command, worker, composed `dryRun=true` rehearsal, `clear-pending` diagnostic, run audit,
or screenshot capture. There is no run/trace/result/receipt/failure ID, checkpoint count, reached
node table, or exact-run `write_intents`/`write_attempts`/`durable_outbox` evidence to report.

Restricted screenshot extraction table:

| Neutral absolute path | State | Fields read |
|---|---|---|
| `/Users/julianhein/Projects/hr-automation-rebuild/.tracker-rebuild/manual-verification/4537-2026-08-28/r2-u1/` | not created — no browser/run state reached | none |

## Documentation and review

`docs/migrations/separations.md` §9.28 now records the admission block. The authorized board ledger
and residue were updated only after re-hashing the unchanged intake blob. Doc 03b exit row 5 remains
**OPEN — all three**; this block is not controlled-commit evidence.

Review was skipped: this is authority-backed documentation/evidence only; no code, test, config,
runtime state, or product behavior changed.

Supervisor close verification independently reproduced resolver exit 42, found the roadmap fresh,
passed `git diff --check`, confirmed no Playwright browser or worker process, and observed authority
storage healthy with a stale verified backup. The full integrated code gate remains intentionally
not run because the admission authority stopped u1 before its executable path.

## Required follow-up

Do not retry or repair inside this closed unit. A separately authorized reconciliation must resolve
the conflict between the strict registry/resolver (completed doc 4524) and the brief/board's claimed
4537 identity before another u1 live authority can be considered.
