# R4a — fresh submit-free rehearsal and exact live target packet

Date: 2026-09-02. No date gate. Base: `4d4804ec` plus coordinator receive/admission commit.
Repository `/Users/julianhein/Projects/hr-automation-rebuild`, branch `feature/03b-live-close`.
Profile/workspace/board/run plan: `/Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/separations-completion/{project-profile.md,board.md,run-plan.md}`. Board READ ONLY.
Report: `docs/coordinator/separations-completion/reports/r4a-fresh-rehearsal-and-target-packet.md`.
Sanitized evidence: `docs/coordinator/separations-completion/evidence/r4a/`. Person values, EIDs and transaction IDs stay only in ignored restricted artifacts or the operator-visible live UI; never commit them.

## Cleared boundary
R3a/D309 and R3b/D310 are received complete. This run performs live reads and exactly one `dryRun=true` rehearsal; it performs no real HR write, deletion, Kuali finalization, workflow gate approval, retry, registry/environment mutation or source change. Dry-run/live read access is standing-authorized. Supplied/read-back EID should proceed without a workflow gate; a name-only run must park for actual operator approval and R4a must not resolve it.

## u13 — fresh current-source rehearsal visible in the dashboard
Use `/hr-manage` and `/ui`; all browser operations use `playwright-cli`.
- Verify dashboard BFF/Vite health, current manifest/served separations fingerprint and storage before state. Close orphan browsers first. Do not restart a healthy matching stack unnecessarily.
- Inspect current Kuali availability for exactly the operator-supplied sequence `4593, 4579, 4564, 4544, 4502, 4495` using read-only access. These supersede the older candidate list for current testing. Choose the first currently viable document for this submit-free rehearsal only. This does not register it as a controlled-write target or change `config/test-subjects.json`/`.env`.
- Start exactly one separations run through the real dashboard UI with `dryRun=true`, all ordinary steps included, current default capture/browser options unless a current source fact requires a narrower safe choice. Screenshot the final confirmation before Start and record exact planned run/item IDs. Never start if the confirmation does not visibly say Dry run.
- Start/drain exactly one separations worker through the supported CLI. Monitor exact authority until terminal or legitimately parked. Do not retry. If name-only identity opens a gate, leave it parked and report the exact decision needed. If supplied EID is read back, prove no gate result/open gate exists and the machine-verification node is durable.
- Collect the exact-run receipt/explain/spans plus before/after counts. Required submit-free invariant: zero delta in write_intents, write_attempts and durable_outbox. Report every reached node and honest not-reached reason; a dry-run transaction preview may be the designed terminal. Capture a restricted rendered screenshot and sanitized metadata. Leave dashboard healthy, worker drained/stopped, owned browsers closed.

## u14 — exact candidate packet for the remaining controlled proof
Read-only only. From the fresh rehearsal subject and current UCPath/Kuali facts, prepare an operator decision packet without making any change:
- identify the real separation document proposed for filing/finalization and whether its EID is supplied/read-back or name-only;
- enumerate the exact current Pending termination set that D310 would classify eligible and the protected set count/status, using stable T IDs and the six-grid-fact join;
- say whether the eligible row can be established as disposable from source evidence. Never infer disposability from dashboard dry-run history: dry runs create no UCPath rows;
- propose the exact final disposition for the independent deletion target and the real filing/Kuali document (restore or retain), including how each would be read back;
- provide a concise operator-facing request naming the exact live operations that would occur under one explicit operational authorization. Do not frame these as extra workflow approval gates. If no safe disposable target is proven, say what exact fact the operator must provide.

Keep identifying packet values out of git. The committed report cites only document references already public in project history plus counts/digests/redacted stable-ID references. A restricted ignored file may contain the exact operator packet for this task; name its path in the report without committing it.

No code/docs implementation change is expected. If live rehearsal reveals a code defect, preserve exact evidence and return it as residue; do not broaden into a fix without a new run brief. Validate storage health/currentness, exact counts, fingerprints, worker/browser cleanup, git clean, manifest/roadmap checks and no source movement. Commit only sanitized report/evidence with explicit paths. No push/master merge, no board write, no new handoff on coherent completion.
