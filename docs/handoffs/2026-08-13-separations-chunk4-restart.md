# Handoff — separations chunk 4 restart (UCPath termination write)

**Date:** 2026-08-13
**Paused at:** chunks 1–3 landed and live-proven; chunk 4 (the UCPath termination write) needs a
FRESH dispatch after three agent failures (two 600s watchdog stalls + one API disconnect) that
landed **zero commits**. The dead agent's live findings were salvaged from its transcript and are
recorded VERBATIM in §"Salvaged chunk-4 findings" below — **they exist nowhere else; making them
durable in `docs/migrations/separations.md` §9 is the restart's FIRST commit.**
**DONE 2026-08-13** — the salvage now lives in `docs/migrations/separations.md` **§9.7**, which is the
authority for it; the section below is retained as the raw transcript record it was salvaged from.

## Task summary

Phase 3 (workflow migration) is active; the operator chose **separations first** (D193) to force
the store task libraries into existence, decomposed **bottom-up into lego chunks** — each sub-slice
provable alone, composed at chunk 6. Chunks 1–3 minted the new-kronos store (semantic-ready, live
proof CLOSED at run `sk-171645-4adf`, 39.6 s), the Kuali separation-doc rich read (5 live runs
terminal `done`, the 17-option termination-type dropdown captured, exact-match map seeded), and the
UCPath job-summary read + the **ALWAYS-GATE identity approval** (live-proven end to end: parked →
approved through the real command endpoint → `verified` receipt naming the approver, trace
`si-161551-774c`; found scenario S22 — an already-terminated employee — in the wild on doc 4510).
Platform hardening along the way: D199 (receipts bind to consumed surfaces, not the closure hash),
D200 (worker startup self-sweep), D204 (approver reaches the receipt), D205 (virtualized-grid
scroll). Chunk 4 builds the tree's second-ever commit contract family: the UCPath termination.

## Plan

- **Migration doc + questionnaire (all operator answers recorded): `docs/migrations/separations.md`**
  — READY TO BUILD; §4a–§4g + 5A/5B all ANSWERED; §3 build strategy (lego + no-frontend directive);
  §9 as-builts + mapping appendix.
- Behavior review (63 scenarios, S1–S63): `docs/migrations/separations-legacy-behavior.md` — chunk 4
  owns S44–S53.
- Store catalog: `STORES.md` (D194 rich-extraction convention). Roadmap: `ROADMAP.md`.

## Current state

- Branch: `master` @ `213d2c9`. Worktrees: none. Uncommitted: only untracked `.auth/sep4-profile/`
  — an **authenticated UCPath browser profile** the dead agent left; REUSABLE to skip a cold
  SSO/Duo ceremony for chunk 4's live steps (delete after, or move under `.auth-rebuild/` if kept).
- Decisions through **D205** in this line of work — but a CONCURRENT session also commits to this
  master (W1/W2 slices, D198 etc.); always check `docs/rebuild/04-reconciliation.md`'s tail for the
  真 next free number before minting.
- Gates at `213d2c9`: all green — 187 files / 1731 tests, parity 147, coverage floors met.
- Per-commit gate family is **D191**: `npm run typecheck && npm run lint && npm run test:coverage`
  (+ `test:parity` and `build:manifest -- --check` at slice end).

## Progress

- [x] Chunk 1 — new-kronos store + timecard-read (`8c7663c`…`8e42c73`; live proof closed by D205's
      `213d2c9`, run `sk-171645-4adf`)
- [x] Chunk 2 — kuali separation-doc read (`2615813`…`d16d882`, D197; live proof PASSED, 3 verified
      receipts: docs 4510/4502/4495)
- [x] Chunk 3 — job-summary + ALWAYS-GATE (`107f9b0`…`7b983af`, D201–D203; live-proven incl. real
      approval)
- [x] Platform: D199 `796b845` · D200 `171f27e` · D204 `605abe2` · D205 `213d2c9`
- [ ] **Chunk 4 — UCPath termination write ← RESUME HERE (fresh dispatch; nothing landed)**
- [ ] Chunk 5 — kuali finalization write (staged variables, §4e)
- [ ] Chunk 6 — compose + full live dry-run (+ fold in the re-read affordance: new item identity
      per explicit operator re-read, recorded in §"the re-run wall" item 2)

## Salvaged chunk-4 findings (from the dead agent's transcript — make durable FIRST)

### The persistence crux — ANSWERED

**ZERO durable footprint anywhere before an explicit Save click.** Verified live on prod
`ucphrprdpub.universityofcalifornia.edu` (EID 10001754, template `UC_VOL_TERM`, effdt 06/11/2026):
filled Page A (template+date) → `Create Transaction` → Page B (EID/record/effdt/reason) →
`Continue` → Page C (Job Data, Override LDW date, both comment fields) → abandoned via hard `goto`.
The "Transactions in Progress" grid (baseline 5 rows) was byte-identical before/after at every
stage, including after fully staging Page C. Persistence happens ONLY on Page C's two explicit save
buttons (`Save for Later` / `Save and Submit`). `Transaction ID` reads literal `"NEW"` pre-save.
**Conclusion: prepare may stage the ENTIRE wizard; commit = the Save-and-Submit click alone.**

### Live-verified anchors (Smart HR wizard, 0 iframes)

- Entry: `.../c/ADMINISTER_WORKFORCE_(GBL).HR_TBH_JOB.GBL`
- **Page A**: template `#HR_TBH_WRK_TBH_TMPL_ID` (+ `$prompt` lookup modal `#ptModFrame_0`, close
  `#ICCancel` inside frame) · date `#UC_HR_TBH_WRK_TRANSACTION_DATE` (MM/DD/YYYY) · Create =
  `#HR_TBH_WRK_TBH_ADD` (~7–8 s render). Template modal captured 22 templates incl.
  `UC_VOL_TERM`="Voluntary Termination", `UC_INVOL_TERM`="Involuntary Termination".
- **Page B** ("Enter Transaction Details"): EID `#HR_TBH_WRK_EMPLID_PROMPT2` (blur/Tab triggers
  name+record lookup ~4–6 s) · record `#HR_TBH_WRK_EMPL_RCD_CHAR` · effdt `#HR_TBH_WRK_JOB_EFFDT` ·
  reason `#HR_TBH_WRK_ACTION_REASON` · Continue `#HR_TBH_WRK_TBH_NEXT` · Cancel
  `#HR_TBH_WRK_TBH_CANCEL` · displayed name `#PERSON_NAME_NAME_DISPLAY` ← **best beat-③ subject
  anchor (Page C's identity block is unstyled spans in `#myDIV`, no stable ids)**.
- **Page C** ("Enter Transaction Information"): Save-and-Submit `#HR_TBH_WRK_TBH_SAVE` ·
  Save-for-Later `#HR_TBH_WRK_TBH_LATER` · LDW checkbox `#HR_TBH_SCR_WRK_TBH_CHK2$3` + date
  `#HR_TBH_SCR_WRK_TBH_DATE$3` · initiator comments `#HR_TBH_WRK_DESCRLONG_NOTES` · transaction
  comments `#UC_SS_TRANSACT_COMMENTS` · txn-id display `#UC_SS_TRANSACT_UC_TRANSACT_ID`.
- **Probe surface (S44)**: page `UC_EXTENSIONS.UC_SS_TBH.GBL` ("SS Smart HR Transactions" search) —
  NOT the "Smart HR Transaction Status" dashboard (no T# column; returned 0 rows). EID filter
  `#UC_SS_TBH_DVW_EMPLID` + op `#UC_SS_TBH_DVW_EMPLID$op` (`2` = "=") · search
  `#PTS_CFG_CL_WRK_PTS_SRCH_BTN` · rows keyed `T\d{6,}` · detail `?Action=U&UC_TRANSACT_ID=T…` with
  `#UC_SS_TRANSACT_UC_TRANSACT_ID`, `#UC_SS_TRANSACT_APPR_STATUS`, `#UC_SS_TBH_VW_START_DT$0`,
  `#UC_SS_TBH_VW_ACTION$0`, `#NAME$0`.

### Reason codes captured live

- `UC_VOL_TERM` (18): CAR/XFR/TR1/AAJ/SCH/DWJ/JAB/LAJ/MIL/MOA/NRG("No Reason Given")/PER/QWN/SLF/
  FRL/TIL/VSP.
- `UC_INVOL_TERM` (25): AIP/APR/ATA/ACE/**DEA("Death")**/ATT/FLS/MIS/NLC/PRF/DNP/DNR/NSV/GCE/INV/
  LHC/RRR/SEV/RDS/MED/**NSE("Never Started Employment")**/GRD/PDR/TR2/PRO/VIS.
- → **NSE exists live**, which is exactly what §4a's open item (a) wanted confirmed: mapping
  `Never Started Employment` → involuntary `NSE` is now one map line awaiting the operator's final
  go-ahead (recorded as an open operator item below).

### Live facts + timings

- EID 10001799 already carries a real **Pending** involuntary termination `T002209631`
  (effdt 06/11/2026, filed 2026-08-11 by requester 10002079) plus an Approved `T002197996` — a
  ready-made real probe/dedupe subject that needs NO write to exercise `already-present`.
- Timings: fill tmpl+date 172 ms · Create Transaction 7.3 s · fill EID 4.2 s · reason 3.1 s ·
  Continue 9.2 s · LDW 6.2 s · comments 2.2 s · probe-search open 4.6 s / run 7.4 s · probe-detail
  4.9 s normal — **one probe-detail call spiked to ~16 min (972 s): almost certainly the first
  stall's cause. EVERY live step in the restart must carry a hard ~90 s bound.**
- S48 (invalid EID) arm: attempted, result never read back — **inconclusive; re-observe**.

### Design conclusions the dead agent reached (unwritten until now)

- Contracts: `ucpath/probe-termination` (S44 read) · `ucpath/prepare-termination` (stage all three
  wizard pages) · `ucpath/create-termination` (commit = the Save-and-Submit click only) ·
  `ucpath/verify-termination` (re-probe for T#; unreadable/unknown **parks**, never success). Doc 09
  §12's worked example uses `fill-termination`/`submit-termination` naming — same shape; follow the
  repo's naming rules.
- Doc 09 §5 requires BOTH probe kinds ported: the idempotency probe (EID+effdt+"Terminatn") AND the
  date-agnostic pending-sweep (legacy `deletePendingTransaction` deletes ALL in-progress Terminat
  rows for the EID) → its own transaction `ucpath/clear-pending-terminations`, composed before the
  termination.
- `src/domain/separations/termination-type.ts` (exact-match map, no fuzzy/default) already exists —
  wire it, don't re-mint.
- The agent died right after opening `src/stores/ucpath/driver/ui-registry.ts`'s
  `ElementDefinitionSchema` — registry entries for the anchors above are the next unstarted step.

## Chunk-4 restart instructions (the stall lesson is structural)

Dispatch a FRESH Opus agent (never resume the dead transcript). **Build-first, live-later**:

1. FIRST commit: move the salvage above into `docs/migrations/separations.md` §9 (mapping appendix
   + chunk-4 section) so it survives any later failure.
2. ALL code work next, committed by logical step with D191 gates — registry entries, the four
   contracts, `clear-pending-terminations`, sequencer wiring (permanent key = EID + effective date;
   subject binding on `#PERSON_NAME_NAME_DISPLAY` per beat ③; §4a map refusals pre-fence;
   S44–S53 every arm typed; post-fence uncertainty parks), the sub-workflow + scenarios, dry-run
   structurally commit-free.
3. Live steps LAST and separately: reuse `.auth/sep4-profile` to skip the cold ceremony; hard ~90 s
   bound per step (the 16-minute probe-detail spike is the enemy); the dry-run proof + §4f3
   `probeToFenceMaxMs` measurement + the free `already-present` dedupe observation on EID 10001799's
   existing `T002209631`. Honest NOT-RUN beats a stall. `playwright-cli close-all` after.
4. **The controlled real commit is NOT chunk 4** — it stays OPEN waiting on the operator-named
   canary (§4f2 answer: option ii). NOTHING is ever submitted to UCPath in this chunk.

## Open questions / operator items

- ~~**Q: `Never Started Employment` mapping**~~ — **ANSWERED (operator), 2026-08-13: APPROVED.**
  `Never Started Employment` → `{template: UC_INVOL_TERM, reasonCode: NSE}`, on the strength of chunk
  4's live capture of the real `UC_INVOL_TERM` reason list. Ratified in `separations.md` §4a
  (2026-08-13 addendum) and §9.3 row 7; wired in `src/domain/separations/termination-type.ts`.
- ~~**Q: zero-hour "Observed" holiday codes**~~ — **ANSWERED (operator), 2026-08-13: option A, keep
  legacy-identical.** `Juneteenth Observed` / `Independence Day Observed` (amount `0.00`) do NOT count
  toward the separation date; no classifier change, and they stay surfaced in `unclassifiedPayCodes`.
  Ratified at `separations.md` §9.1's open item.
- **Q: live gate-REJECTION path** — accepted test-pinned for now; exercising it live means
  rejecting a real document's identity (operator act).
- Standing directives in force: **no frontend work** (wire/endpoints only — recorded in the
  migration doc §3); subagents **Opus or Sonnet on high only**; decision briefs as markdown/website,
  never chat dumps; D194 rich extraction for every new read task; map everything observed (§4f4);
  never push; commit-as-you-go.

## Verification before resuming

```bash
cd /Users/julianhein/Projects/hr-automation-rebuild
git status                      # expect clean except .auth/sep4-profile/ (untracked)
git log --oneline -5            # expect 213d2c9 at tail (concurrent sessions may have added more)
npm run typecheck && npm run lint && npm run test:coverage   # D191 family — all green
npm run test:parity             # 147
npm run build:manifest -- --check
npm run rebuild:cli phase       # completedThrough 2j · active 3-workflow-migration
```

## Pointers

- `CLAUDE.md` (root) — conventions, fail-loud, write-safety lessons (read the D199/D200/D204/D205
  dated entries)
- `docs/migrations/separations.md` + `separations-legacy-behavior.md` — the migration SSOT
- `docs/rebuild/09-write-safety.md` — beats ①–⑦, §5 probe kinds, §12 worked example, §14 gate
- `STORES.md` · `ROADMAP.md` — derived views, keep synced
- Memory: `~/.claude/projects/-Users-julianhein-Projects-hr-automation-rebuild/memory/` —
  `subagent-dispatch-policy.md`, `deliverable-format-policy.md`
