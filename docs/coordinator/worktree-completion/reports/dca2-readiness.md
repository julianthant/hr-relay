# DCA2 — provisional heavy-gate readiness

Verified 2026-08-30 by coordinator. **Reserved after DCC2; not slot-open.** DCR currently owns
the heavy slot. Supervisor lint4024 subsequently returned exit0 (reported collected chunk1f649e),
clearing the final pending light check; no own gate remains running.

Worktree `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca2`, branch
`feature/dca2-screenshot-gallery`, reported HEAD `eda17b2708286e36542e1e18e9f8ef6a06cf3187`.
Changes intentionally remain uncommitted until required full gates. No coordinator source writes.

| Evidence | Verification |
|---|---|
| Tracked src/tests binary diff | SHA-256 `3a969e1fa32efa6fd54da00da131142b8137a382ec0537f34ae2f944545f2783` reproduced with `git diff --binary -- src tests` |
| Full tracked scope | SHA-256 `bd94dd1eaf17e5a0c3143e33dafaee28c5ce4a0513afe4f1d522f07140f60f1d` reproduced across src/tests, both owning reference contracts and roadmap source/output |
| Seven G8 paths | All SHA-256 values independently match assigned `reports/dca2-g8.md`, including three new code/test companions omitted from Git's tracked diff |
| Final static delta | Assigned `dca2-g9.md`: independent Correctness/Performance/Security/Tests zero findings; prior Silent-failures classification retained with scope rationale |
| Focused/light evidence | G8 records restored35/35, locked typecheck/lint exit0; supervisor reports independent35/35 and final locked lint4024 exit0, collected chunk1f649e |
| Shared serving | `git diff --exit-code -- src/server/dashboard/queries/artifact-bytes.ts` exit0; mandatory dca-shared-bytes remains unresolved |
| Whitespace | `git diff --check` exit0 |

The three untracked gallery references are **not covered by the tracked diff hash and are not
accepted browser proof**. Coordinator read only their digests; supervisor must preserve original
bytes before any attributable supported refresh:

Prefix `tests/parity/references/diagnostic-bundle-gallery--graphite-warm--1280x720`:

| Suffix | SHA-256 |
|---|---|
| `.a11y.yml` | `9e9918d0d05b50ec4300d0159957915cb75e491fa3fd642f3840abc851180cc1` |
| `.meta.json` | `10bc39c3ec9bb2cb3a680fe01b79f7bb530e1683f545c0ce54f70ec9b2d2a079` |
| `.png` | `ca727914347be8ee01fa5a3d0171d9de1fbbab22150ea863b5c8eff2d2170b0e` |

After explicit allocation and re-verification of the frozen candidate: focused19-case existing
gallery parity first, then full coverage and full assert parity. Preserve build stamping,
thresholds/masks, exact image identity and attributable reference changes. Release the slot on
a repair pause. None of these heavy/browser gates has been run or accepted by this receive.

Final DCA aggregation still requires the centrally owned bounded-memory verified-serving repair,
including server cancellation/resource cleanup, across all consumers. Client abort/static review
does not prove that dependency complete.
