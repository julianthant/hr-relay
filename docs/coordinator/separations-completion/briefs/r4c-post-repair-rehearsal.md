# R4c — document 4495 post-repair rehearsal and target packet

Date: 2026-09-02. No date gate. Base: current `feature/03b-live-close` after R4b merge `31da1fe8` plus coordinator receive/admission commit.
Repository `/Users/julianhein/Projects/hr-automation-rebuild`. Board `docs/coordinator/separations-completion/board.md` is READ ONLY.
Profile/workspace/run plan: `/Users/julianhein/Projects/hr-automation-rebuild/docs/coordinator/separations-completion/{project-profile.md,run-plan.md}`.
Report: `docs/coordinator/separations-completion/reports/r4c-post-repair-rehearsal.md`. Sanitized evidence: `docs/coordinator/separations-completion/evidence/r4c/`. Exact person values, EIDs and transaction IDs stay only in ignored restricted artifacts or the operator-visible live UI; never commit them.

## Cleared boundary

R4b is received and integrated. The operator explicitly said document **4495** is the post-repair test. Use exactly 4495: do not substitute another document if it is absent, decayed, blocked or defective. This run may perform live reads and start exactly one dashboard `dryRun=true` separations run for 4495. It may not perform an actual HR write, deletion, Kuali finalization, workflow gate resolution, retry, runtime-row mutation/repair, registry/environment change, source change, master merge or push. If name-only identity opens a gate, leave it parked and report the exact decision; do not resolve it.

## u14 — one current-source 4495 rehearsal visible in the dashboard

Invoke `/supervise`, `/hr-manage`, and `/ui`; all browser operations use `playwright-cli`.

- Verify dashboard BFF/Vite health, served separations fingerprint `a6a1600a4398f7caa9d14f14821a9abc606de603ed2a3e83af58d99c72e1d81a`, and storage before state. Sweep orphan browsers. Do not restart a healthy matching stack unnecessarily.
- Inspect Kuali availability for exactly document 4495 using read-only access. If unavailable or ambiguous, stop with exact evidence; do not inspect or choose another candidate.
- Start exactly one separations run through the real dashboard UI with input 4495, `dryRun=true`, all ordinary steps included, and current default capture/browser choices. Capture restricted proof of the final confirmation before Start and record exact planned run/item IDs. Never start unless the confirmation visibly says Dry run.
- Start/drain exactly one separations worker through the supported CLI. Monitor exact authority until terminal or legitimately parked. Do not retry. If supplied EID is read back, prove no open/result gate exists and the `machine-verification` identity node is durable. If name-only identity opens a gate, leave it parked and report the exact decision needed.
- Collect exact-run explain, receipt, spans, failures, checkpoints and before/after counts. Required submit-free invariant: zero delta in `write_intents`, `write_attempts`, and `durable_outbox`. Report every reached node and honest not-reached reason. A designed dry-run transaction preview may be terminal.
- Verify the R4b regression in the live path: `read-separation-dates` must checkpoint its `source` provenance if reached. If any code defect appears, preserve immutable evidence and return residue; do not fix it in this run.

## Exact target/disposition packet for R4d

Read-only only. From the 4495 run and current UCPath/Kuali facts:

- identify whether 4495 is viable as the real filing/finalization document and whether identity is supplied/read-back or name-only;
- enumerate the exact current Pending termination set D310 classifies eligible and the protected set count/status using stable T IDs and the six-grid-fact join;
- state whether any eligible row is provably disposable from source evidence—never infer disposability from a dry run;
- propose exact restore/retain disposition and read-back checks for the independent deletion target and the filing/Kuali document;
- write a concise operator-facing request naming the exact live operations R4d would perform under one explicit authorization. Do not express these as additional workflow approval gates. If no safe disposable target is proven, name the exact missing fact.

Keep identifying packet values out of git. A restricted ignored packet may contain exact values; name its path in the report. Commit only sanitized report/evidence using explicit paths. No code or canonical product-doc change is expected. Validate manifest/roadmap checks, storage health/currentness, exact counts/fingerprints, worker/browser cleanup, dashboard health, and a clean branch. No new handoff on coherent completion.
