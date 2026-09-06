# Rollback window, then closure
<!-- roadmap: rollback-window -->

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

<!-- roadmap-status: rollback-window -->
- [x] the asset is defined and cannot be lost by accident — the WHOLE legacy repository (source, commands, tests) plus its verified state backup; nothing in it may be deleted through the rebuild or the initial cutover (D89/D93, `CLAUDE.md` cross-repo rules)
- [x] the asset is stronger than the one D89 originally assumed — a separate repository rather than an in-tree `src` directory, because D93 moved the rebuild's ADDRESS (D93)
- [x] re-crossing has a stated price, written before anyone needs it — after native writes, rollback requires intent/ledger reconciliation and dedupe proof before an atomic switch back (D89)
- [ ] **nothing flips yet, so no window is open.** The switch has not happened; there is no rollback bridge to verify and no window to close
- [ ] the rollback bridge verified BEFORE the switch — the `{#cutover}` node's fourth build item; unbuilt
- [!] closure — deletion or retirement of the legacy repo is OUTSIDE this cutover and needs its own operator authorization, given after the window, never inside it
> 2026-08-21 | docs-cohesion 05 | verified against `CLAUDE.md` "Cross-repo rules (D93/D94)" ("Nothing in the legacy repo may be deleted during the rebuild or the initial cutover — the whole repository is the D89 rollback asset") and `reference/decisions.md` D89/D93; nothing in `src/`, `config/` or `scripts/` implements any part of a switch, a bridge or a closure — left: the whole node, which cannot start before `{#cutover}`

<!-- /roadmap-status -->

**The window is the interval between the switch and the authorization that ends it**, and it exists
because a single all-at-once cutover has exactly one way to be wrong: it turns out the rebuild cannot
carry a real day's work. During the window the legacy repo stays intact and runnable — not archived,
not pruned, not partially deleted — so recovery is *repointing the launcher back*, the same act as
the switch, in the other direction.

**What is built: nothing.** No step of the cutover has run, so no window has opened. The rollback
bridge named in the tree's fourth `{#cutover}` build item — the verification, before the switch, that
the return path actually works — has not been written, and it is deliberately a PROOF item rather
than a code item: what it must show is that the legacy launcher starts, reaches its own state root,
and is not blocked by anything the rebuild did on the way past.

**Re-crossing is not symmetric, and that asymmetry is the whole reason the window closes.** Before
the rebuild writes anything native, rollback is a launcher repoint. After it does, the two worlds
have both filed real HR transactions and rollback requires **intent/ledger reconciliation and dedupe
proof** before the atomic switch back: every rebuild write intent must be matched against what the
external system actually holds, because the legacy engine has no fence and no permanent-key record
of what the rebuild already filed. A rollback that skips that step is how one termination gets filed
twice.

**Closure is a separate operator authorization, deliberately.** D89 puts deletion and retirement
*outside* this cutover, and `CLAUDE.md`'s cross-repo rules restate it as a standing prohibition:
nothing in the legacy repo may be deleted during the rebuild or the initial cutover. There is no
trigger, no elapsed-time rule and no automatic expiry — the window closes when the operator says it
does, and until then the honest description of the legacy repo is *frozen production reference and
rollback asset*, not *old code*.
