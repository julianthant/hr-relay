# R4a — fresh rehearsal and target-packet report

Date: 2026-09-02

Status: **NEEDS COORDINATOR — document 4502 passes login, employee lookup, and timecard read, but a replayed dates checkpoint lacks required provenance, so D309/D310 and the controlled-write packet were not reached.**

## Outcome

The fresh current-source rehearsal used Kuali document `4579`, the first viable non-future document in the supplied inspection order. The one brief-authorized dashboard run was visibly `dryRun=true` and failed at New Kronos employee search with `EMPLOYEE_NOT_FOUND`. At the operator's direct request, the same item was retried once through the dashboard after network reachability was restored. The retry reproduced the same failure fingerprint in 34 seconds.

The run-owned screenshot proves login succeeded: it shows the authenticated New Kronos home page and the Employee Search panel returning “There are no items to display.” This is an identity/availability mismatch in New Kronos, not a Wi-Fi or login failure.

The operator then selected document `4502`. Its dry run completed Kuali extraction, UCPath identity/job-summary reads, New Kronos employee lookup, and the New Kronos timecard read. It failed on replay of the `read-separation-dates` checkpoint because required provenance for output field `source` was absent. The terminal browser capture is an authenticated 1440×900 timecard grid, proving this failure is neither login nor employee-not-found.

No HR write occurred. Global and exact-run counts for `write_intents`, `write_attempts`, and `durable_outbox` are all zero. No workflow gate was opened or approved.

## Run status

| # | Subject | Run / trace | Attempt | State | Gate | Write intent | Result / transaction id | Next action |
|---:|---|---|---:|---|---|---|---|---|
| 1 | Kuali `4579` | `0bb750ee-3cc3-4bf2-86ec-f916323da412` / `sp-120825-0bb7` | 3 | failed at New Kronos timecard search | absent | none | `EMPLOYEE_NOT_FOUND` / none | Retained as the brief-authorized rehearsal |
| 2 | Same item | `6d1746f5-cfb6-49a4-9ccc-2cdccbda25da` / `sp-122139-6d17` | 5 | failed at New Kronos timecard search | absent | none | `EMPLOYEE_NOT_FOUND` / none | Superseded by operator selection of 4502 |
| 3 | Kuali `4502` | `05d9d8fa-22e0-4b5c-9e38-2df095162284` / `sp-122836-05d9` | 3 | failed after live timecard read | absent | none | `UNHANDLED` / none | Repair or invalidate the replayed dates checkpoint so required `source` provenance is present, then run under a new brief |

Attempt 4 was already present as a cancelled history row before the operator-authorized retry; it was neither started nor cancelled by this run.

## Candidate packet state

Read-only Kuali inspection was limited to `4593, 4579, 4564, 4544, 4502, 4495`; all six were present. Document `4579` was initially selected because it was the first viable non-future row. After its New Kronos lookup failed, the operator explicitly selected `4502`, which resolved through Kuali, UCPath, and New Kronos to a real timecard.

The controlled-write packet cannot honestly be completed from this rehearsal:

- D309 `identity-approval` was not reached for 4502 because the replayed dates checkpoint failed provenance validation first, so there is no durable supplied/read-back machine-verification result and no name-only parked gate to resolve.
- D310 `pending-set` was not reached, so there is no exact eligible/protected set, six-grid-fact digest, or stable-T-ID packet from the workflow.
- No source evidence establishes any eligible row as disposable. Dry-run history cannot establish disposability.
- No independent deletion target or final filing/Kuali disposition can be proposed without inventing authority.

The exact technical prerequisite is a dates checkpoint whose output field `source` carries the required provenance, or invalidation/recollection of the stale checkpoint under the current contract. Only after that repair lets the read path reach D309/D310 can the coordinator ask for one explicit operational authorization naming the eligible deletion target, real filing/finalization document, and restore-or-retain disposition for each.

## Authority and evidence

- Served separations fingerprint: `a6a1600a4398f7caa9d14f14821a9abc606de603ed2a3e83af58d99c72e1d81a`.
- Attempt-5 failure fingerprint: `229736d37c06b88c262d7a1345c02da7a5c744535ce1998208d1dcbdd2e1bac2`; same fingerprint seen four times.
- Attempt-5 receipt: `8a09a747-8c86-5c55-b24f-5e1e58ff556f`, failed/unknown, write state `not-attempted`.
- 4502 failure fingerprint: `d0e11f1e85783ee4067addac7c971b8963a145dbffaac248b535bcccf0591644`; exact failure is missing provenance for `read-separation-dates` output field `source`.
- Post-run storage: authority healthy, schema 29; span authority reconciled, 24/24; zero pending commands, unresolved write intents, or durable outbox rows. The operator explicitly waived waiting for backup currentness; backup staleness remains visible residue.
- Sanitized rehearsal evidence: [`../evidence/r4a/rehearsal.md`](../evidence/r4a/rehearsal.md).
- Sanitized screenshot inventory: [`../evidence/r4a/screenshots.json`](../evidence/r4a/screenshots.json).

Restricted ignored artifacts in the primary runtime checkout:

- `.tracker-rebuild/restricted/r4a-kuali-candidates.json` — exact six-document read-only fields; SHA-256 `384c988e4298a52c3277f1e64099dae95c88d90beea0cdf05f6123fd94529ac3`.
- `.tracker-rebuild/restricted/r4a-attempt-3-explain.json` — exact first-run explain; SHA-256 `3551ea6f62a758c8d5cc89c0eb9b2018d56ea6b45519018ffd0bffea71357bb6`.
- `.tracker-rebuild/restricted/r4a-attempt-5-explain.json` — exact retry explain; SHA-256 `f5fcf58945d994148a334be362a26dd78abcb572c352f843d72d493077f09b7d`.
- `.tracker-rebuild/restricted/r4a-attempt-5-spans.jsonl` — exact retry spans; SHA-256 `7d1275e0ecda6faade9944e5d2f68533e906cf30a11b1a01714f460e7b7da129`.
- `.tracker-rebuild/restricted/r4a-attempt-5-browser-capture.png` — authenticated New Kronos empty-result page; SHA-256 `809e2649160d84352d56307747e9f2cebc9b180bd0dc84b369ded9e91fd46884`.
- `.tracker-rebuild/restricted/r4a-4502-explain.json` — exact 4502 explain; SHA-256 `dadab674e33396320104788b739d23af86b855f8703b2705e50d1bdf4e2bebbc`.
- `.tracker-rebuild/restricted/r4a-4502-spans.jsonl` — exact 4502 spans; SHA-256 `3d9e0edddb83d1be60c7c2253ec1f1df537d557c20dcd8e67e5b6fb3cd7af6e2`.
- `.tracker-rebuild/restricted/r4a-4502-browser-terminal.png` — authenticated 1440×900 New Kronos timecard; SHA-256 `890622e996daf77deabdd237bc6c0803cca325054fb52e486fa269ba380af454`.

## Boundary and residue

- No source, registry, environment, board, roadmap, or canonical specification file was changed. At the operator's request, dashboard display settings were changed from 2560×1440 to 1440×900 and adopted by a clean dashboard restart.
- The read-only coordinator board changed concurrently during the run: intake SHA-256 `5532af0e1375d86e1765b239e354fdf3e0b10ce699ca92c3a7244ca11edb882a`; close SHA-256 `180b7fb39c644ece8fe680a7ac322e8ebb55dc58d42a4982fe4923f46e0019e4`. R4a did not edit, stage, or commit the board; the coordinator must reconcile this report against the newer board revision.
- No real HR write, deletion, Kuali finalization, workflow gate approval, push, or master merge occurred.
- The original no-retry boundary was superseded only by the operator's direct “try again” instruction; the retry stayed on the same dry-run item.
- Dashboard screenshots were taken before the original start, at the original terminal state, at retry confirmation, queued, session starting, active New Kronos search, retry terminal state, display-setting save/readback, and every 4502 wizard/progress/terminal stage. Image bytes remain restricted and ignored.
- The worker drained and stopped idle after the terminal failure.

## Supervisor disposition

The `sup_scout` operational map and `sup_analyst` D309/D310 authority check were read-only and required no implementation review. Consequential live authority and the final packet judgment were reviewed by the supervisor. No implementation change was made, so no source-code review axis applied.
