# Decision — integrated DCA reference refresh — 2026-09-01

## Decision

The operator chose **A**: authorize one deliberate update-mode parity run for the 30 asserted
Archive, diagnostic Gallery, and Receipt failures produced by joining DCA with the current
`integration/03b` source.

The authorization was consumed exactly once by:

```text
HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation npm run test:parity:update
```

The command passed 301/301 tests. Before/after inventories found 42 changed reference files:
18 accessibility snapshots, 20 screenshots, and 4 metadata records. Every changed path belongs to
the authorized families; none escaped scope. Representative pixel review confirmed the intended
Run Captures panel, fail-loud comparison state, and the resulting diagnostic screenshot byte/digest
change. Archive changed accessibility/descriptor metadata only.

The required update-disabled rerun then passed 301/301 tests. Evidence is preserved under
`docs/coordinator/worktree-completion/evidence/integration-dca-refresh-20260901T024758Z/`.
