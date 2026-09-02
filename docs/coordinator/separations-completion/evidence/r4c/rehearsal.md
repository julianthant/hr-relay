# R4c document 4495 post-repair rehearsal evidence

Date: 2026-09-02 (America/Los_Angeles)

## Admission and one-start boundary

- Base: `3e7747b8`; branch: `feature/r4c-post-repair-rehearsal`.
- Dashboard BFF and Vite answered on `127.0.0.1:3938` and `127.0.0.1:5174`.
- Served separations fingerprint:
  `a6a1600a4398f7caa9d14f14821a9abc606de603ed2a3e83af58d99c72e1d81a`.
- Pre-run storage was healthy, schema 29, generation 2282, backup current, and span authority
  reconciled 24/24. Pending commands, unresolved write intents, and durable outbox were zero.
- A read-only Kuali Action List search found the exact anchored document `4495` links. No other
  candidate was inspected.
- The dashboard confirmation visibly showed document `4495`, `Dry run: On`, browser `Headed`,
  browser screenshots `On`, and all ordinary steps (Customize steps remained off).
- Exactly one dashboard start was issued. The server plan named run
  `26e7eaa2-1111-4a88-be5e-b71e4432b4f7`, item
  `829a6aac-7e49-5f55-8514-b73d773c8a20`, and trace `sp-132417-26e7`.
- The bounded run window contains exactly one durable command: family `start`, type `start-run`,
  targeting the exact server plan. It contains no retry or gate command.
- Exactly one supported worker ran with pool index 1 and `--drain`; it stopped idle with outcome
  `failed`. The durable row is attempt 2 because the match key had prior item history; this run's
  receipt says `retryOf: absent`. No Run again/retry command was issued.

## Exact-run authority

The run terminated failed at `pending-set`, task `ucpath/read-pending-termination-set`, at
`2026-09-02T20:27:36.877Z`:

- failure `85895513-780e-445f-87c3-6a5a42f69eb5`;
- code `UNEXPECTED_PAGE_STATE`;
- fingerprint `d811fe253c4fa59c5eea9dc13b310c8599a9430d85d3e0b60e4f4c1ae1a4f7ab`;
- write state `not-attempted`;
- source diagnostic: the SS Smart HR transaction scan rendered neither a result row nor
  PeopleSoft's explicit no-results marker within 45 seconds.

Receipt `1d4d3577-c843-5cf5-87e9-40174183a7cd` is `failed` / confidence `unknown`. It records these
verified nodes:

`resolve-action`, `document`, `plan`, `termination-type`, `name-search`, `subject`, `job-summary`,
`employment`, `department-option`, `timecard-search`, `timecard`, `dates`, `comparison`, `approval`.

The receipt records `identity-approval` absent because its condition was false and no operator
decision was made. The durable `approval` output says `authority: machine-verification`; the gate
projection has zero rows for this run. `pending-set` is unknown. `clear-pending`, `file-termination`,
`receipt`, `filing-presence`, and `finalize-kuali` were not reached.

R4b's repair is live-proven: the durable `dates` checkpoint is provenance-complete and its recorded
leaf paths include `source` beside the other fourteen dates leaves.

## Submit-free invariant

| Authority | Before global | After global | Exact run | Delta |
|---|---:|---:|---:|---:|
| `write_intents` | 0 | 0 | 0 | 0 |
| `write_attempts` | 0 | 0 | 0 | 0 |
| `durable_outbox` | 0 | 0 | 0 | 0 |

The exact-run span extract contains 47 events / 48,975 bytes; SHA-256
`5a0158174254bad4604179ac7a7665a60bc6b600c7dd4da384bde1eaa7236142`.

## Target and disposition boundary

- Kuali document 4495 is present, and its supplied identifier was independently read back through
  D309 with machine-verification authority. It is therefore conditionally viable as the filing and
  finalization document, but it is not admitted for a real sequence because D310 did not establish
  the current Pending set.
- No eligible or protected transaction set is available from this run. No stable T identifiers or
  six-grid-fact digest were produced.
- No eligible row is proved disposable. A dry run and a timed-out search cannot establish that fact.
- Retain document 4495. Do not delete, file, restore, or finalize anything from this evidence.
- The exact missing fact is an authoritative D310 scan that returns either the complete eligible and
  protected sets with their stable T identifiers and six-grid-fact evidence, or PeopleSoft's explicit
  no-results state. Until then there is no exact independent deletion target and no safe R4d request.

The ignored exact packet is
`.tracker-rebuild/restricted/r4c/target-disposition-packet.json`, SHA-256
`6ba5bfdceb005fdbab476035102656a221c61d277166e8fa402b1b71f8afe6ec`. It contains identifying
values and is intentionally not committed.

## Cleanup and close health

- `playwright-cli list`: no browsers.
- The owned worker exited `stopped: idle`; no worker process was left running.
- Dashboard BFF/Vite remained available on 3938/5174 with the required fingerprint.
- Post-run storage: healthy, schema 29, generation 2405, quick check `ok`, zero foreign-key or
  invariant violations, backup current at generation 2405, span authority reconciled 25/25.
- Post-run pending commands, unresolved write intents, and durable outbox: 0/0/0.
- `npm run build:manifest:check`, `npm run roadmap:check`, and `git diff --check` passed.

## Restricted authority inventory

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `checkpoints.json` | 54,694 | `b02c9b0b0f0bbd82140b3225b7d10a950e9993ffa3ec0ea5cb72190860a477fa` |
| `after-write-counts.json` | 201 | `6412e3bf44cd842be4a5ab868ff2b3dd650639975e6a67d510042c0cf1c9771c` |
| `explain-record.json` | 10,026 | `69a852865a28b0446e0a70667d60b8ff1ffeb512139790e2a8243710b19c5e66` |
| `failures.json` | 1,879 | `8f659591faf9423c3ee5ef1628d223eec21af1e91e973a809794bebcbefb22c2` |
| `receipts.json` | 128,960 | `fc9a52281a1a35b42106c4cef6d9a86db9785348cfe9e61b086441b22c79b46f` |
| `spans.jsonl` | 48,975 | `5a0158174254bad4604179ac7a7665a60bc6b600c7dd4da384bde1eaa7236142` |
| `post-doctor.json` | 102,863 | `c078b945af84c6c12d831aeae48d751b564942600dccea3055a50fd8f1661380` |
| `run-window-commands.json` | 920 | `55fca8c6a875c812bd2043206833eba23b5bed309342499027289cd42eb0a3b8` |

## Residue

- The new immutable failed run and its failure/receipt rows remain authority; no row was repaired or
  rewritten.
- Four existing leases and three existing run-terminal-outbox rows were present before the run and
  remained after it. The dashboard also showed one pre-existing expired worker lease needing
  attention before R4c started. R4c did not clear or mutate unrelated runtime history.
