# R09 parity-drift evidence

**Run:** R09 · `phase-1-6-authorities` · `C161eaed0`

**Base:** `3d9c7917f7db8b83edb473582840ed595353ee4e`

**Captured:** 2026-09-04 in the assigned isolated worktree

## Baseline assertion

`npm run test:parity` ran 269 cases in assertion mode and exited 1: 79 passed and 190 failed.
Every JSON-reported failure was an accessibility reference whose first mismatch was the
`descriptorHash` provenance header. Of the 190 failures, 180 reported
`ff8c5fd78912e40100770dae22be908d41bef31f284b28e1520f6b145cb85aa2` →
`7cb1e18470ed6ad8a9a682e3bccd9c121800ed893d75d9316be116879898e39e`; 10 reported the
separations descriptor change
`8a4f301b41fb502099a365c1f4ae457e7faf4001a0d1f7d236b811bb7f377f98` →
`fe74ae963f7083419f1dfa4f2da9391717c208f311a3fe0bf4eb4a9f579472c7`.

The base corpus contains 216 `.a11y.yml`, 216 `.meta.json`, and 210 `.png` files. Before update,
186 YAML/JSON pairs carried `ff8c…`, while 30 carried separations hash `8a4f…`.

## Deliberate update result

`npm run test:parity:update` passed 269/269. Its working-tree diff against the exact base contained
451 files: 210 `.a11y.yml`, 210 `.meta.json`, and 31 `.png`. The six unexecuted `run-receipt`
YAML/JSON pairs remained at `ff8c…`; no claim is made that update mode refreshed them.

Deleting only the YAML `# descriptorHash:` header before comparison left 52 semantic differences:

- 38 files changed visible `ff8c5fd7` to `7cb1e184`.
- 6 Explorer Graph files changed visible implementation hash `8191c959ec27` to `d23204eba53b`.
- 6 Explorer Transaction files changed visible implementation hash `82196f1a4bd4` to `7ddf947b5a69`.
- 2 populated-receipt files changed visible descriptor `2db0988e` to `77185eb4`.

Deleting `.descriptorHash` from each changed metadata JSON made all 210 JSON pairs identical to
base. Thus the JSON changes are metadata-only; the YAML and PNG changes are not.

## Screenshot-byte differences

Fresh capture changed these 31 PNG blobs:

- `archive-version-bump--paper-ink--1440x900.png`
- `run-failed--graphite-warm--1280x720.png`
- `run-failed--graphite-warm--1440x900.png`
- `run-failed--paper-ink--1280x720.png`
- `run-failed--paper-ink--1440x900.png`
- `run-group--graphite-warm--1280x720.png`
- `run-group--graphite-warm--1440x900.png`
- `run-group--paper-ink--1280x720.png`
- `run-group--paper-ink--1440x900.png`
- `run-member-gate--graphite-warm--1440x900--gate-type-eid.png`
- `run-open-gate--graphite-warm--1280x720.png`
- `run-open-gate--graphite-warm--1440x900--gate-choose.png`
- `run-open-gate--graphite-warm--1440x900--gate-reject.png`
- `run-open-gate--graphite-warm--1440x900.png`
- `run-open-gate--paper-ink--1280x720.png`
- `run-open-gate--paper-ink--1440x900.png`
- `run-parked-write--graphite-warm--1280x720.png`
- `run-parked-write--graphite-warm--1440x900--resolve-absent.png`
- `run-parked-write--graphite-warm--1440x900.png`
- `run-parked-write--paper-ink--1280x720.png`
- `run-parked-write--paper-ink--1440x900.png`
- `run-queued--graphite-warm--1280x720.png`
- `run-queued--graphite-warm--1440x900.png`
- `run-queued--paper-ink--1280x720.png`
- `run-queued--paper-ink--1440x900.png`
- `run-running--graphite-warm--1280x720.png`
- `run-running--graphite-warm--1440x900--panel-dismissed.png`
- `run-running--graphite-warm--1440x900.png`
- `run-running--paper-ink--1280x720.png`
- `run-running--paper-ink--1440x900--panel-dismissed.png`
- `run-running--paper-ink--1440x900.png`

Representative `run-running--graphite-warm--1280x720.png` SHA-256 changed from
`705bf1b92225fb5df313ba0cbd1928efcbe484eb46f2a89cfcbc1c02f62d7c51` (105,748 bytes) to
`7a463d8af9ff5aab78f508e348b256662c42cfb305bec4fee2388d480bc40c6c` (105,793 bytes).
Direct visual inspection showed the footer stamp changing from `ff8c5fd7` to `7cb1e184`; the
screenshots are not byte-identical and the difference is operator-visible.

## Safe disposition

The generated update was not accepted. All reference files were restored byte-for-byte to the
exact base before reporting. R09 cannot make assertion-mode parity green without either accepting
the semantic/PNG refreeze or changing production/harness behavior, both explicitly outside its
current authority.
