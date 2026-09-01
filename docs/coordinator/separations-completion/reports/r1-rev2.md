# R1 report (rev 2, re-dispatch) — BLOCKED at the dispatch gate

**Run:** R1 rev 2 (units u1–u5), supervisor session, 2026-09-01 Pacific.
**Outcome:** **BLOCKED at the dispatch gate — before any intake, before u1.** No branch created, no
browser opened, no run started, no gate requested, no write attempted, no UNKNOWN, no retry.
Doc 03b exit criterion 5 remains **OPEN — all three commits**. Separations remains **8 of 9**, not
rebuild-ready.

Two of the brief's four preconditions are still red, and both are the two the board already records
as operator-owned and un-self-clearable. This is a preflight block of the same class as
reports/r1.md, with a narrower cause: the two blockers carried forward from that run were not
cleared, and one of them got worse (the concurrent session is actively writing right now, not merely
dirty). It is not a controlled-commit claim and converts nothing into write-safety evidence.

## 1 · Dispatch gate — the four preconditions, verified in this checkout

| # | Precondition | Verdict | Evidence (exact command → exit → head) |
|---|---|---|---|
| 1 | Quiescent checkout | **RED** | `git status --porcelain` → exit 0, **5 modified + 3 untracked**: `src/dashboard/surfaces/day-search.tsx`, `log-panel.tsx`, `top-bar.tsx`, `src/infra/providers/local-vite-probe.ts`, `tests/unit/server/preflight-runners.test.ts`, `tests/parity/zz-scratch-{step-disclosure,topbar-cluster,topbar-measure}.spec.ts` |
| 2 | Backup lane green | **GREEN** | `npm run cli -- storage doctor` → **exit 0**; `authority: healthy (schema v28, generation 1291, 457 pages, quick_check ok)`; `backup: current — authority-g1291-…-5548032a… (age 30m, generation gap 0)`; `span/authority: healthy (7 current, 0 archived)`; `pending: commands 0 · write intents 0 · leases 2 · outbox 0 · terminal outbox 1` |
| 3 | Person secrets restored | **RED** | `npm run smoke:test-target-person-secrets` → **exit 1**; all three rows `state=refused` (`employeeName` · `emplId` · `timekeeperName`). Independently, names only, no values printed: the three `HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_{EMPLOYEE_NAME,EID,TIMEKEEPER_NAME}` keys are **absent** from this checkout's `.env` |
| 4 | Fresh base pin | **NOT TAKEN** (blocked by 1) | `git rev-parse --abbrev-ref HEAD` → `master`; `git rev-parse HEAD` → `136f87c655d5e8748b420cb244bbd7f9ab60b500`; `git branch --list 'feature/*'` → **empty** (`feature/03b-live-close` still absent); `git remote -v` → `origin https://github.com/julianthant/hr-automation-rebuild.git` — never-push unchanged and respected |

Per the dispatch gate's own rule — *"if any fails, STOP and report — do not proceed to live work"* —
intake stopped here. Gates 2 and 3 were still measured, so the return carries the whole picture
rather than only the first failure.

## 2 · Precondition 1 is not merely dirty — the concurrent session is writing *now*

| Path | mtime | Δ from the check at 08:55:16 PDT |
|---|---|---|
| `src/dashboard/surfaces/top-bar.tsx` | 2026-09-01 08:54:34 PDT | **42 s** |
| `src/dashboard/surfaces/day-search.tsx` | 2026-09-01 08:53:44 PDT | 92 s |
| `tests/parity/zz-scratch-topbar-measure.spec.ts` | 2026-09-01 08:51:59 PDT | 3 m |
| `tests/parity/zz-scratch-topbar-cluster.spec.ts` | 2026-09-01 08:50:39 PDT | 5 m |
| `tests/parity/zz-scratch-step-disclosure.spec.ts` | 2026-09-01 08:49:16 PDT | 6 m |
| `src/dashboard/surfaces/log-panel.tsx` | 2026-09-01 08:47:32 PDT | 8 m |

The dirty set also **grew during this session**: intake observed 3 modified files
(`log-panel.tsx`, `local-vite-probe.ts`, `preflight-runners.test.ts`); the gate check minutes later
observed 5, with `day-search.tsx` and `top-bar.tsx` added. A live writer holds this checkout.

**Consequences, and why no branch was created.** R1's live sequence needs a source tree frozen from
the u2 rehearsal through ③, and the `.auth` profile cannot be shared (§9.21's wedge is exactly
unsynchronised concurrent writers; D243/D244). Creating `feature/03b-live-close` here would move
this checkout's HEAD off `master` underneath the other session — the precise disruption
reports/r1.md §1 documents and refused. Precondition 4 is mechanical and will take ten seconds once
precondition 1 holds; it was left untaken deliberately.

## 3 · What each red still gates

- **(1) quiescence** gates the *entire* run: the rehearsal freeze (u2), the `.auth`/Duo profile the
  live read and all three writes share (u1, u3), and the branch pin (u4/u5 integration).
- **(3) the three person secrets** gate the smoke check and ③'s standalone finalization ingress.
  They do **not** gate u2's composed rehearsal — R1 already proved `timekeeperName` resolves as a
  literal in the chain's canonical input `[documentNumber, searchTimeoutMs, timekeeperName]`. ③ is
  the step that cannot run without them, and ③ is the last of the three writes, so starting without
  them would strand the sequence mid-sitting after two real UCPath writes. That is why the brief
  requires all four up front, and this run upholds it.
- **(2) backups** is green and was re-verified at dispatch as required: g1291, age 30 m, gap 0. The
  99 historical invalid manifests are superseded by it and remain owned outside this workspace.

## 4 · S7 and the live read — again deliberately NOT established

No live form was read, so this run asserts nothing about doc 4537's Last Day Worked, Transaction
Number, or openness. §9.31's `08/28/2026` LDW stays what the brief calls it: stale input, not a
verdict. Recording an arithmetic S7 pass would be exactly the unverified substitution the root
CLAUDE.md forbids.

`playwright-cli list` → `(no browsers)` — nothing to sweep, at the stop as at the start.

## 5 · New operator input this dispatch — three document numbers, unresolved

The dispatch message carried an image of three Kuali document numbers — **4570 · 4567 · 4566** —
with the words "and the 3 are". They appear **nowhere** in this repository's markdown
(`grep -rnE '\b(4570|4567|4566)\b' --include='*.md' docs` returns only unrelated `10-4567` EID-format
examples in ref data-intake-and-edit-data and D151's pointer row).

R1 did not act on them, and states plainly what it cannot resolve: whether they are a new candidate
subject set, the operator's current Kuali action list, or context for a different run. Both readings
collide with standing authority this supervisor may not overrule — **D284 makes 4537 the sole
registered subject**, and the brief scopes out "any subject but 4537". Substituting or adding a
subject is a scope-and-product-truth decision reserved to the operator/coordinator. Carried to
§Questions.

## 6 · Unit ledger

| Unit | Status | Evidence |
|---|---|---|
| u1 admission + fresh 4537/S7 | **not started** | dispatch gate stopped intake before u1; no live read; no commit |
| u2 rehearsal + exact-run 0/0/0 | **not started** | gated on u1 |
| u3 ② → ① → ③ | **not started** | gated on u2 + three operator ALWAYS-GATE approvals |
| u4 A5 measurements | **not started** | rides inside u3 |
| u5 A8 close-out + merge | **not started** | gated on u3/u4 |

No commit was made by this run on any branch except this report and the authorized board write-back,
staged as explicit paths on `master`. No branch was created, no branch pointer moved, no merge, no
push. No step of the D287 sequence was consumed, so none needs re-authorizing.

## 7 · What must be true before R1 is re-dispatched (rev 3)

1. **The checkout is quiescent and exclusively R1's** — the concurrent Codex D295 session finishes
   and commits, `git status --porcelain` is empty, and the operator holds it serialized for the
   window. This is the only blocker that stops *everything*.
2. **The three person secrets are restored to `.env`**, `npm run smoke:test-target-person-secrets`
   exits 0. Operator-owned; the values are not recoverable from the repo.
3. Re-verify `npm run cli -- storage doctor` exit 0 with a current backup at dispatch (green today).
4. Recreate `feature/03b-live-close` from the fresh clean master HEAD and record the pin.
5. **Resolve 4570/4567/4566** — either "context only, subject stays 4537" or an explicit
   coordinator/operator ruling that changes the registered subject, which would need D284 amended in
   its owner before any run consumes it.
6. Re-confirm the ALWAYS-GATE window; the 08-31 one went unused and today's was never opened.

## 8 · Residue

- Unchanged and still open: 03b criterion 5 (A2–A5, A8); separations 8/9.
- Still owned outside this workspace: the three absent `.env` person secrets; the v28
  backup-manifest invalidation (now superseded operationally by the current valid backup).
- Untouched as scoped out: 4568/R3 (§9.29), storage-span visibility (Phase 4), Run-modal touch
  targets (Phase 4), 03c.
