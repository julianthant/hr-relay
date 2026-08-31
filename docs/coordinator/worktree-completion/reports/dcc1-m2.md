# DCC1 m2 — accepted invariant disposition

Native sup_analyst_dcc1_m2, revised and verified by supervisor 2026-08-30.
Compare alternate 0c115123a738f62cbe01c9b45f53b7289284479c with frozen integrated 13175b13340fec7b5326207fe54f98078d481d7d (control plane a9b5395f).

## Accepted outcome

Preserve the integrated DCC2/DCC3 editor, preflight, readbacks and existing capture behavior. Retain the alternate hardened file authority plus exact SQLite settings_current/runtime generation/command ingress guarantees as ONE writer. Adapt existing query/projection consumers; do not retain two competing persistence engines.

| Invariant | Disposition / evidence |
|---|---|
| Closed editable command allowlist | Keep alternate EditableSettingsOverrideSchema, including its admitted URLs/capture/browser/providers/timeout arms. The baseline eight-leaf UI inventory is NOT the whole command policy. |
| Integrated eight-leaf editor | Keep baseline src/domain/dashboard/settings-editor.ts, Settings UI and query behavior. Add only four currently missing command leaves: ocr.pageConcurrency, ocr.maxValidationRetries, concurrency.defaultWorkers, paths.reportsDir. Existing actor/display/duo timeout already admitted. |
| Report output path | Baseline explicitly exposes paths.reportsDir. This is not stateRoot/artifactRoot/browserProfileRoot/credential/auth authority. Those and every other non-admitted path stay excluded. |
| Private file and atomic replacement | Retain src/infra/config/settings-file.ts no-follow/owner/mode/regular/link/size validation, hard-link lock, reaper, prepare, exact rollback/readback and post-transaction settlement. Tests in config.test.ts pin each. |
| Command/current/restart identity | Retain server/settings-runtime.ts and settings_current/runtime_config transaction evidence; exact full-envelope command identity, restart-required results, worker claim/start/fan-out fencing. |
| Single/bulk ingress | Retain exact loopback Origin + JSON guard, server-authored actor/source/accepted time, durable ordered bulk parent and exact replay. Preserve baseline routes around these guards. |
| Baseline editor adapter | Derive its existing SettingsRuntimeStatus/readback wire from the selected file/current/runtime authorities. No separate mutable persistence authority. |
| Capture | Frozen baseline still has phone capture. Retain alternate capture handoff generation fence and tests. R-DCT retirement is separate planned scope. |
| Docs | Keep baseline completed DCC2/DCC3 statements; update named file-authority path and false unbuilt server-stamping claim. Do not revert later completion docs. |
| Generated | Regenerate manifest and roadmap after final reconciliation. Intake roadmap check was already red. |

## Migration boundaries

Baseline migrations end at 18; alternate adds 19 runtime_config, 20 settings_current, 21 bulk_command_acceptances. No numeric collisions with that frozen baseline: preserve exact append-only statements/digests. This is not cross-run compatibility; DCR/DCC4 collisions are inventoried in dcc1-migrations.md and await operator disposition. Baseline Settings envelope has broad hash and no lastApplied; alternate has closed hash and lastApplied after revision 1. Do not invent speculative live-data conversion or touch runtime state. Explicitly refuse incompatible old-format fixtures; preserve exact accepted new-format tests. Any real state conversion is separately authorized work.

## Corrections made during supervision

First analyst response incorrectly called the integrated editor deferred, relying on old local branch docs; rejected. Second response incorrectly equated eight visible UI leaves with the full backend allowlist and suggested speculative migration; rejected in those parts. Final response distinguishes both contracts and finds no numeric migration collision **with the frozen v18 baseline only**. Later cross-run evidence establishes collisions with DCR/DCC4; see dcc1-migrations.md. Evidence verified against baseline doc 04 §Edit settings, baseline dashboard AGENTS, baseline domain/dashboard/settings-editor.ts and both schema/migration files.

No source edits, live authority or heavy gates occurred in m2. Worktree-only merge forecast reports 28 conflict files; the working checkout remains untouched except m1/m2 coordination artifacts.
