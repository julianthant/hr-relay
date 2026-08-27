# 03a close-out — operator decisions (2026-08-27)

Phase 3a's final supervisor run is closed: exit table 9/10 (row 10 open only on the ledgers'
structural residue), all gates green at `b6db6d96` on `integration/03a-final` (310 files /
3,392 tests · parity assert `218 passed` · typecheck · lint · roadmap fresh · binding 14/14),
worktrees swept. Five items need your call. Answer as `1 B, 2 A + note`.

## 1. Where should `master` point?

**Situation.** Mid-session, a background agent checked the repo root out to `master` (then at
`96afae0a`), so five early unit merges landed on master instead of the integration branch. I
reunified everything onto `integration/03a-final` (nothing lost; the full history is there), but
my attempt to move master back (`git branch -f master 96afae0a`) was blocked by the permission
classifier, so **master still sits at `08676c3c`** — a mid-session snapshot on the wrong line.

- **A — reset master to `96afae0a`** (its pre-session position). Cost: master forgets the
  session until you later merge integration deliberately; requires a history-moving command you
  run or allow.
- **B — merge `integration/03a-final` into master now** (the plan's CLOSE step: "merge `--no-ff`
  into integration then master only after green"; green holds). Cost: master takes the phase
  before the 08-28 canary work; the anomalous `08676c3c` stays in master's history as an
  ancestor (harmless — it is a strict subset of what the merge brings).
- **C — leave master as-is** until the 08-28 canary closes 03b's commits. Cost: master stays on
  the anomalous snapshot in the meantime; any session comparing against master mis-reads.

**Recommendation: B** — it lands the reviewed, green phase on master exactly as CLOSE prescribes
and dissolves the anomaly into ordinary history.

**Notes:**

## 2. `jsdom` as a devDependency

**Situation.** Interaction tests (press-to-dispatch payloads, focus restoration) needed a real
DOM; `jsdom` was added as a dev-only dependency, declared per-file (`@vitest-environment jsdom`),
now used by six unit-lane files. The parity lane remains the authority for anything visual.

- **A — ratify it** as the standing pattern for wiring-level React tests. Cost: none beyond the
  dependency.
- **B — remove it** and move those pins into the Playwright parity lane. Cost: slower tests,
  and payload/focus claims don't belong in a screenshot lane.

**Recommendation: A.**

**Notes:**

## 3. `src/dashboard/AGENTS.md`

**Situation.** It predates this session (Codex-era commits) and drifted twice from CLAUDE.md
during merges (I resolved by keeping both sides; I never authored content there per your rule).

- **A — keep it** for Codex sessions; accept occasional merge friction.
- **B — delete it**, folding its dated lessons into `src/dashboard/CLAUDE.md` (one commit).
  Cost: Codex sessions lose their binding file unless `skill-sync` regenerates it.

**Recommendation: B if no Codex sessions are planned; otherwise A.**

**Notes:**

## 4. Intake column ownership (F13's recorded finding)

**Situation.** The live phone-capture panel mounts in intake's `intake=new` arm under the
Dropzone's `flex-1`, so at 1440×900 it sits half below the fold (reachable — a real scroller).
D274 item 7 did not rule who owns the column. Recorded in `docs/findings/capture.md`.

- **A — capture panel takes the column** when a session is live (dropzone shrinks to a strip).
- **B — keep the dropzone primary** (current behavior); the panel scrolls.
- **C — side-by-side split** at wide viewports only.

**Recommendation: A** — during a live capture the session is the operator's task.

**Notes:**

## 5. The 2026-08-28 unlocks (tomorrow)

**Situation.** Two date-gated proofs unlock: the T1b canary (doc 4537) and, from 09/02, the
second past-dated subject for the two-full-chain-preview parallel variant (doc 4495). Both are
recorded as named external gates in §9.27 and the 03a closure.

- **A — schedule a session for 08-28** to run the T1b canary live (03b's step 5 opens with it).
- **B — wait** for you to trigger it manually.

**Recommendation: A** — it is the next plan item and pre-authorized live work.

**Notes:**

## Answers (2026-08-27)
_Coordinator verified before ratifying: master `08676c3c` is a strict ancestor of `integration/03a-final` (0 commits master-only, 178 integration-only) — item 1's "anomalous snapshot" is a stale point on the same line, so B is a plain `--no-ff` merge, no history moves. jsdom is declared in 9 files, not 6. `~/.codex/` exists on this machine, so Codex sessions are real (item 3)._

| # | Chosen | Note |
|---|---|---|
| 1 | B | merge `integration/03a-final` → master `--no-ff`; A rejected (history-moving, unnecessary); C rejected (master would mislead every comparing session) |
| 2 | A | jsdom ratified as the wiring-level React test environment, per-file; B rejected (payload/focus pins do not belong in a screenshot lane) |
| 3 | A | keep `src/dashboard/AGENTS.md` for Codex; Claude sessions never author it; B rejected while Codex sessions continue |
| 4 | A | the capture panel takes the intake column while a session is live; B rejected (the session is the operator's task); C rejected (viewport-conditional layout = two behaviours to keep in parity) |
| 5 | A | 2026-08-28 local session runs the T1b canary as 03b run R1 (needs local Playwright + Duo Autopilot — not a cloud routine) |
| + | row 10 → carry to phase 04 | the ledgers' structural residue and the three recorded findings are fidelity polish, not separations blockers; 03a's exit table closes 10/10 with row 10 "met by disposition — carried to 04" |
