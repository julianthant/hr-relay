# Decisions — R2b stale operator BFF — 2026-08-27
_Answer positionally: `1 A`, `1 B`, or `1 C + "note"`. Unanswered items stay open._

## 1 · How should u24′ obtain the u29 implementation?

**Situation.** u29 is committed and verified at `fdfc783c` + `eb6c9638`, but the operator-owned BFF
(pid 6081, listening on 3938 since 10:56) still serves the earlier
`new-kronos/read-separation-timecard` implementation fingerprint `0ffc422e2074…`; the tree now
declares `85d3e91cc6d8…`. A new worker would fail loud on that mismatch before it could execute the
restored range-field driver. u24′ therefore stopped in preflight: no run was planned, no worker or
browser was started, no gate opened, and authority still reads 0/0/0 write rows. The original R2b
guard says the supervisor must reuse and never restart the operator's BFF/vite, so a restart needs a
new explicit decision.

**Options.**

- **A.** Authorize the supervisor to restart only the root BFF, leave vite pid 6011 untouched, prove
  the served fingerprint equals the tree, and resume u24′ — briefly interrupts current BFF clients;
  the replacement BFF becomes the run's process and is left up unless separately directed.
- **B.** The operator restarts the root BFF at the keyboard and replies `ready`; the supervisor then
  verifies the fingerprint and resumes u24′ — preserves operator ownership but pauses the run for a
  manual step.
- **C.** Stop R2b at completed u29 and write the requested handoff — no live canary or controlled
  commit runs in this session; u24′–u28′ remain for a later supervisor after a fresh BFF exists.

**Recommendation.** A — it is the smallest bounded exception, changes no durable workflow state,
keeps vite untouched, and allows the already-approved dry run to consume the code just verified.

**Notes.** _(your notes here)_
