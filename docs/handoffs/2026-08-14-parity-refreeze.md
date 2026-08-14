# Handoff — parity corpus re-freeze (one deliberate pass, sequenced LAST)

**Date:** 2026-08-14
**Paused at:** corpus red lane-wide; re-freeze deliberately deferred.

## Task summary

`npm run test:parity` fails on ~135/147 references. Two causes stack: (1) a corpus-wide
`descriptorHash` shift from the separations/descriptor work (every reference drifts at line
4 before content compares), and (2) deliberate presentation drift from the 2026-08-14
fidelity slate (top-bar catalog glyph removed, workflow-panel spacing, queue-row wrap,
archive/explorer/activity rewrites — the archive corpus, explorer corpus, activity corpus
and queue/run references all changed on purpose). The re-freeze must happen ONCE, after the
descriptor churn settles — doing it mid-churn means doing it twice.

## Sequencing rule

Do this ONLY when: the separations session's descriptor work is landed and quiet, AND any
taxonomy/wire-gap sessions that change wire schemas or the registry have landed (each of
those moves references again). Ask the operator if unsure whether the churn is done.

**2026-08-14 update — the taxonomy session (D219) has LANDED** (commits `c7486f6`, `a631231`,
`b42f46f`, `0d64441`): every workflow module declares a `role`, both wires serve it, and chunk
harnesses render nested under their composition on rail/picker/explorer. Its expected reference
drift was isolated by a two-worktree controlled re-freeze and is confined to **three fixtures × 6
variants, a11y-deterministic**:

- `explorer-graph`, `explorer-transaction` — the four `separations-*` harnesses move into a
  `list "Proving harnesses of Separation"` under the composition's listitem; each button's
  accessible name gains `a proving harness of Separation`; `Separation Timecard` stays top-level
  under Timekeeping, marked (the cross-category rule — its own category is `timekeeping`).
- `start-run` — the picker's rows gain real `list`/`listitem` semantics, and the "not startable"
  list gains category headings (now matching the startable list above it).

No other a11y reference moves from D219 (the parity corpus's bootstrap serves one standalone
workflow, so the rail renders identically). Anything else that moves is one of the two
pre-existing causes above — or a defect; do not attribute it to D219.

## How

```bash
git log --oneline -10          # confirm no in-flight descriptor work
npm run test:parity            # capture the failing set first
npm run test:parity:update     # the ONE deliberate re-freeze switch (PARITY_UPDATE=1)
npm run test:parity            # must be green
```

Then REVIEW the reference diffs before committing — this is the step that makes the
re-freeze deliberate rather than a self-rewriting corpus (D132's whole point):
- Screenshot diffs: open a sample per surface and confirm the new pixels are the intended
  presentation (paper-ink theme must be LIGHT — D187's dark-corpus defect; check one
  `paper-ink` reference by eye).
- A11y diffs: expect the catalog button gone from the top bar, archive/explorer/activity
  trees restructured, queue footer text wrapping.
- Anything unexplained by the fidelity slate or the descriptor hash → STOP and investigate;
  do not freeze a defect in.

Commit the corpus as one `test(parity): re-freeze …` commit naming what moved. No push.

## Pointers

- `CLAUDE.md` root — the D132 lesson ("a reference corpus that rewrites itself…") and D187.
- The fidelity commits whose drift is expected: `8e89a6d`, `8f55a16`, `6deaeb4`, `1a716ab`,
  `793e2a5`, `a2ff17f`.

## Working mode (operator's standing dispatch policy)

This task is small enough to run INLINE — one re-freeze, one review, one commit. If the
diff review surfaces real repair work, the standing policy applies to that work: act as
orchestrator and dispatch NARROW subagent briefs — **Opus or Sonnet only, high effort,
~300k tokens max per subagent** — keeping doc reads, judgment, gates and verification
yourself. Sequential-on-master; never push.
