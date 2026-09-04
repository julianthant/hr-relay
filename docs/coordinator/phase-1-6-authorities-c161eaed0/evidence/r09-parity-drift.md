# R09 parity-repair evidence

**Run:** R09 · `phase-1-6-authorities` · `C161eaed0`

**Base:** `3d9c7917f7db8b83edb473582840ed595353ee4e`

**Reference commit:** `324017e754d550326d4a2b02d84712ce254dadaf`

**Captured:** 2026-09-04 in the assigned isolated worktree

## Authority and outcome

Doc 01 §1.6's ratified exception permits one serial refresh of inherited D324-derived descriptor
metadata and displayed descriptor/implementation hashes, including their screenshot and accessibility
references. It preserves all other semantic content, layout, production code, assertions, A8, and the
existing pixel tolerance.

`npm run test:parity:update` passed 269/269 and produced the reviewed reference commit. A subsequent
`npm run test:parity` assertion run passed 269/269. No production, harness, assertion, A8, or parity-
tolerance file changed.

## Baseline assertion

Before the refresh, `npm run test:parity` ran 269 cases in assertion mode and exited 1: 79 passed and
190 failed. Every JSON-reported failure first stopped on an accessibility `descriptorHash` header
mismatch. Of the 190 failures, 180 reported
`ff8c5fd78912e40100770dae22be908d41bef31f284b28e1520f6b145cb85aa2` →
`7cb1e18470ed6ad8a9a682e3bccd9c121800ed893d75d9316be116879898e39e`; 10 reported
`8a4f301b41fb502099a365c1f4ae457e7faf4001a0d1f7d236b811bb7f377f98` →
`fe74ae963f7083419f1dfa4f2da9391717c208f311a3fe0bf4eb4a9f579472c7`.

The base corpus contains 216 `.a11y.yml`, 216 `.meta.json`, and 210 `.png` files. Before update, 186
YAML/JSON pairs carried `ff8c…`, while 30 carried the separations hash `8a4f…`.

## Exact accepted transformation

The deliberate update changed 451 files: 210 `.a11y.yml`, 210 `.meta.json`, and 31 `.png`.

Every changed accessibility file equals its exact base bytes after applying only these substitutions:

| Occurrences | Old | New | Meaning |
|---:|---|---|---|
| 180 | `ff8c5fd78912e40100770dae22be908d41bef31f284b28e1520f6b145cb85aa2` | `7cb1e18470ed6ad8a9a682e3bccd9c121800ed893d75d9316be116879898e39e` | full default/person-lookup descriptor header |
| 30 | `8a4f301b41fb502099a365c1f4ae457e7faf4001a0d1f7d236b811bb7f377f98` | `fe74ae963f7083419f1dfa4f2da9391717c208f311a3fe0bf4eb4a9f579472c7` | full separations descriptor header |
| 38 | `ff8c5fd7` | `7cb1e184` | displayed default/person-lookup descriptor |
| 6 | `8191c959ec27` | `d23204eba53b` | displayed Explorer Graph implementation |
| 6 | `82196f1a4bd4` | `7ddf947b5a69` | displayed Explorer Transaction implementation |
| 2 | `2db0988e` | `77185eb4` | displayed populated-receipt descriptor |

Every changed metadata JSON file becomes structurally identical to base after deleting only
`.descriptorHash`: 180 carry the default/person-lookup mapping and 30 the separations mapping. The
comparison found zero other YAML or JSON difference.

## Exercised and inherited corpus

The current runner exercised and refreshed 210 reference names. These six unexecuted `run-receipt`
YAML/JSON pairs remained byte-identical to base and retain `ff8c…`; doc 01's exception does not
authorize ad hoc edits, and the coordinator assigns their deliberate corpus refreeze to 3.1:

- `run-receipt--graphite-warm--1280x720`
- `run-receipt--graphite-warm--1440x900`
- `run-receipt--graphite-warm--narrow-1024x768`
- `run-receipt--paper-ink--1280x720`
- `run-receipt--paper-ink--1440x900`
- `run-receipt--paper-ink--narrow-1024x768`

No PNG exists for those six inherited names; the base corpus has 216 semantic/metadata pairs and 210
PNGs for exactly that reason.

## Screenshot proof

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

For every image, pixels whose RGB-channel delta exceeded 51/255 formed one compact displayed-hash
glyph region; a one-pixel padding enclosed its antialiasing. Nineteen images had no raw RGB movement
outside that region. Twelve carried 8–74 raw noise pixels outside it (344 total); the maximum outside-
region RGB-channel delta was 13/255, which is below the unchanged 0.2 per-pixel tolerance. There was
no accessibility semantic counterpart for those sub-threshold pixels. Thus the counted raster change
is the displayed hash, while the remaining movement is the lane's already-documented tolerated noise;
no layout or other text moved.

Representative `run-running--graphite-warm--1280x720.png` SHA-256 changed from
`705bf1b92225fb5df313ba0cbd1928efcbe484eb46f2a89cfcbc1c02f62d7c51` (105,748 bytes) to
`7a463d8af9ff5aab78f508e348b256662c42cfb305bec4fee2388d480bc40c6c` (105,793 bytes). Direct
visual inspection showed only the footer stamp changing `ff8c5fd7` → `7cb1e184`.

Representative `archive-version-bump--paper-ink--1440x900.png` SHA-256 changed from
`9b71daf064a3490fa23ebbd3a217ec6680f644c77e0239b6f4792529457fe747` to
`ff4ec9ecd1538f8dfaca2f8f5cd04690f5bfae4ed4514a37f04d7bf39a18541a`. Direct visual inspection
showed the same hash-only change in the archived workflow row behind the version-bump dialog.

## Retained review artifacts

The exact ignored evidence retained for coordinator review is:

- `.tracker/r09-parity-evidence/inventory.txt`
- `.tracker/r09-parity-evidence/base-run-running--graphite-warm--1280x720.png`
- `.tracker/r09-parity-evidence/accepted-run-running--graphite-warm--1280x720.png`
- `.tracker/r09-parity-evidence/base-archive-version-bump--paper-ink--1440x900.png`
- `.tracker/r09-parity-evidence/accepted-archive-version-bump--paper-ink--1440x900.png`

The tracker location is deliberately outside Playwright's disposable `.output` directory, which the
lane clears on each invocation. These artifacts remain until the coordinator verifies the return.
