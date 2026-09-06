# Task 2 · Prove the dashboard against a real run
<!-- roadmap: track-c -->

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

<!-- roadmap-status: track-c -->
- [x] one pass end to end — plan, start, gate park, approve through the B1 ceremony, resume, preview terminal (`docs/rebuild/migrations/separations.md` §9.22, items 1–8)
- [x] every UI assertion paired against a direct authority read or the served wire — thirteen paired rows, all MET
- [x] zero writes proved from authority, not from logs — `write_intents` 2 / `write_attempts` 3 / `durable_outbox` 2, byte-for-byte the 2026-08-04 controlled commit's counts
- [x] the four defects the pass found (§9.22 item 3) plus the archive unblock (§9.22 item 6), all fixed the same day — the ticking served clock (D256), the panel that follows its run (D257), the always-on shape hazard, the `replayed` timeline arm (D259), the archive unblocked (D258)
- [x] D261 the start door — `resolve-action` derives the action id from a typed document number; live run `sp-105225-1e0b`, 13 checkpoints, gate open, zero writes
- [x] the ONE deliberate parity re-freeze — 139 references re-frozen, every drift attributed to a wave-2 decision, 151 assert-mode cases green (`81287bb1`)
> 2026-08-20 | docs-cohesion 03a | verified against separations §9.22 and §9.24 and against the re-freeze commit; the commit's own message is the source for 139 references and 151 assert-mode cases
<!-- /roadmap-status -->

Wave 2's dashboard work had been proved by unit, architecture and scenario gates and by nothing that
connected the two halves. Track C is that connection, and it is the reason this phase can claim more
than "the tests pass".

**What the pass was.** A fresh BFF and vite booted from the working tree — deliberately, because a
stale singleton serving a superseded descriptor fingerprint is a failure mode this program has hit
before and `GET /api/v1/explorer` answers it in one request. A composed `separations` DRY run planned
and started through the real ingress; the identity gate approved through the dashboard's own
ceremony; every surface claim paired with an independent read of `sqlite3 .tracker-rebuild/state.db`
or of the wire the BFF actually served. Three runs, item `c9837287`, attempts 7 · 8 · 9, the third
reaching the preview terminal in 8 m 20 s including six minutes parked.

**What it found is the argument for doing it.** Four defects (§9.22 item 3) plus the archive
unblock (§9.22 item 6, D258), none visible to any gate, all fixed the same day. A REPLAYED node
was indistinguishable from a node that never ran on every surface that folds spans, so a finished run's pipeline reported eight steps `pending` — including the identity
category whose gate the operator had personally approved a minute earlier. Every live elapsed on the
screen was frozen at page load, because `boot.serverClock.now` is the instant one bootstrap fetch
happened at. The `wf <hash>` shape hazard compared a run's one-workflow fingerprint against the
bootstrap's whole-SET hash — two kinds of value that can never be equal, so the warning was
structurally always on. And the open run-detail panel never followed its run, because `detailNonce`
moved only on a dispatched command.

**Then the door.** §9.22's one connection gap was that `separations` had no start surface at all —
it sat in the modal's "not startable" list. D260 ruled correctly that a typed-text start surface
carries exactly ONE varying value per run; the operator chose the document number; D261 made the
action id a graph OUTPUT read off the Action-List row's `href`, and the whole thing was live-proved
the same day off one typed `4502`.

**The re-freeze closes it.** One deliberate `PARITY_UPDATE=1` pass after the fixes landed, so the
corpus photographs the corrected surfaces rather than the defective ones, with every content drift
attributed to a ratified wave-2 decision before the operator approved it.
