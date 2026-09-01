# DCA joined parity JSON persistence repair 14

Date: 2026-08-31  
Role: `sup_terra_parity_json_persistence_repair`  
Worktree: `/Users/julianhein/.codex/worktrees/7b25/r-dca-units/dca4`  
HEAD: `eda17b2708286e36542e1e18e9f8ef6a06cf3187`  
Index: empty

## Outcome

The reporter-owned persistence seam is implemented and light-gate complete. Playwright keeps the existing list reporter and now also emits deterministic built-in JSON at `tests/parity/.output/results.json`. Both existing body accessibility attachments compute SHA-256 from the exact snapshot string passed to `attach`, then expose a unique annotation whose type names the attachment and whose description carries that digest.

The D132 architecture test now pins the exact reporter tuple and output location, rejects a reference-directed output, requires the exact attachment-body/digest/annotation sequence in both owning specs, and carries an in-memory mutation control proving that digesting altered text is rejected. Existing content assertions, screenshot paths, parity thresholds, references, and all prior negatives remain unchanged.

## Scoped files

| Path | Before SHA-256 / bytes | After SHA-256 / bytes | Purpose |
| --- | --- | --- | --- |
| `playwright.parity.config.ts` | `4da79d6166cc57a46d901bf002fa9a8307d6e78004b70bddb3044555be71f070` / 3236 | `76b685be64e6eb5d274f66c3cf7ce80984db026a192d125df5dbdf7d8727433b` / 3312 | Add built-in JSON reporter under parity output. |
| `tests/unit/architecture/parity-reference-authority.test.ts` | `042c054f0e92f7d9aacb28029da9d2efc39fa5e58a12be3ee4fdf219bfd50b22` / 22207 | `32605fa75178e57899365e8b15e3102a9fd1e08b36199fed75e40a6cfb4afc04` / 24365 | Pin persistence authority and exact-body digest binding. |
| `tests/parity/diagnostic-bundle-dialog.spec.ts` | `2a5aee9a35bdfa5854a0c71dd72c713bbb1b0e146584fd87823d8c8da4fcc75a` / 54690 | `e7e8f710fceaf6cb6b20a9a7e7d1dc2f07e6a0e7074f8572eba08bcaf4b4b3a1` / 54909 | Annotate its existing exact body a11y attachment digest. |
| `tests/parity/run-captures.spec.ts` | `682ece1fc2ec1ed54e66ececf5fb4729e1f5337c0ba29a571f306683d2ae8629` / 25511 | `e2491b1809873b58aa7e41ec5c80d12e9587eb8ef23ed435e2b1e6974df2aaf2` / 25730 | Annotate its existing exact body a11y attachment digest. |

No AGENTS lesson was added: this is a test-output persistence mechanism pinned at its owning configuration and D132 architecture boundary, with no product or operator contract change.

## TDD and controls

All Vitest commands used `VITEST_MAX_WORKERS=1` and `HRAUTO_LEGACY_REPO=/Users/julianhein/Projects/hr-automation`.

| Proof | Session | Exit | Result |
| --- | ---: | ---: | --- |
| Initial architecture red | 99143 | 1 | 1 failed / 13 passed: exact reporter assertion observed list-only configuration. |
| Reporter-only red | 73434 | 1 | 1 failed / 13 passed: reporter passed; exact body attachment digest binding remained absent. |
| First green | 8349 | 0 | 14 / 14 passed. |
| Reference-path control | 86406 | 1 | Targeted case rejected `tests/parity/references/results.json`; 1 failed / 13 skipped. Config restored byte-exact. |
| Altered-body digest control | 68913 | 1 | Targeted case rejected ``.update(`${snapshot}mutated`)``; 1 failed / 13 skipped. Capture spec restored byte-exact. |
| Final focused suite | 17055 | 0 | 14 / 14 passed after both restorations. |
| Locked typecheck | 96060 | 0 | `tsc --noEmit` passed. |
| Locked lint | 83842 | 0 | ESLint passed with zero warnings. |

Restoration receipts pin config SHA-256 `76b685be64e6eb5d274f66c3cf7ce80984db026a192d125df5dbdf7d8727433b` after the reference-path control and captures-spec SHA-256 `e2491b1809873b58aa7e41ec5c80d12e9587eb8ef23ed435e2b1e6974df2aaf2` after the altered-body control.

Complete commands, times, chunk ids, raw-log paths, exits, log byte counts, and log SHA-256 values are consolidated in `evidence/dca-joined-parity-json-persistence-gate-index.json`; each command also has its original `*-execution.json` receipt and direct raw log.

## Freeze

- Before candidate: 89 non-coordination changed paths, aggregate `b058545bd44228d11457a8d56232962ee42ba2c72983e0cb3545594abe5a4894`.
- After candidate: 91 non-coordination changed paths, aggregate `54a68e6c15c4d4564dbfb843d0eb0ba6fce1acb66af8dbcf69b4b08ff6ed3c63`. The count increase is exactly the newly changed config and architecture-test paths; both parity specs were already candidate paths.
- Protected inventory excluding the four scoped files: 1886 paths; sorted-object digest stayed exactly `85399329540e1169351c404b98ef0183e5cecf4e2a583581093c0974c2cecbf3`.
- `git diff --check`: green.
- Isolated patch: `evidence/dca-joined-parity-json-persistence-isolated.patch`, SHA-256 `ed1f0892eec010140bec3d9b91296b1a8bceb32ec450cc21a5b967cd31ae15eb`.
- `git apply --reverse --check` against the isolated patch: green.
- After identity: `evidence/dca-joined-parity-json-persistence-after.json`, SHA-256 `e6ac7e73df31cf81917fd3048a3066e5292854b2bdfd2e15e7163b6684264824`.

The first freeze read appeared to show a protected digest mismatch because the bounded recomputation mistakenly used the candidate row recipe for the protected inventory. Re-running the exact original recipes reproduced both before hashes: candidate rows use `path + NUL + file SHA`, LF-joined; protected identity uses a byte-sorted path-to-SHA object serialized as JSON. File mtimes also showed only the four scoped paths changed after the before pin. There was no protected-source mutation.

Two evidence-only helper attempts failed without source mutation: an initial backup helper used unavailable `atob` after the before JSON had already been written, and a read-only zsh pair-splitting diff attempt formed invalid combined paths. Exact backups were then captured and the explicit isolated diff/reverse-check succeeded. Neither failure ran a gate or altered candidate files.

## Boundaries and pending proof

- Preserved browser13 as the system red: its two browser cases passed while list output exposed zero a11y attachment bodies.
- No browser, build, coverage, parity, reference update, staging, commit, product edit, custom reporter, raw writer, allowlist, helper, bundle normalization, or reference-store change ran in this unit.
- A later allocated browser proof remains required: run the affected cases, parse `tests/parity/.output/results.json`, recover each persisted attachment, and verify annotation attachment-name/digest against the exact persisted attachment bytes. This unit does not claim that browser proof.

Writer and light-lane ownership are relinquished with this frozen receipt.
