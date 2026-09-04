# Run plan — Phase 1.6

**Coordination UUID:** 858cc3dc-8536-4077-8049-34b76cc31baf
**Work key:** execute-phase-1-6-from
**Coordinator:** 01a06e8e-d1fc-7260-9fc7-cda1ea031a9a · local
**Integration checkout:** /Users/julianhein/Projects/hr-automation-rebuild · master

Exact task-tool address book: `supervisors.json` (coordinator-owned). Read it before every task call; never reconstruct ids.

| Run | Phase task | Theme | Order / wave | Needs first | State |
|---|---|---|---|---|---|
| R01 | 1.6.1 | Verify the schema floor | 1 / serial | none | closed |
| R02 | 1.6.2-1 | Implement the canonical run-record service | 2 / wave 2 | none (R01 fully closed) | reserved |
| R03 | 1.6.2-2 | Implement the settings catalog and protected root | 3 / wave 2 | none (R01 fully closed) | reserved |
| R04 | 1.6.3 | Cut over executor and worker lifecycle writers | 4 / serial | R03 closed and R02 closed | planned |
| R05 | 1.6.4 | Cut over operator run commands and archive/delete writers | 5 / serial | R04 closed | planned |
| R06 | 1.6.5 | Cut over settings mutation and runtime resolution | 6 / serial | R05 closed | planned |
| R07 | 1.6.6 | Prove upgrade, rollback, recovery, and compatibility deletion | 7 / serial | R06 closed | planned |
| R08 | 1.6.7 | Close the rebuilt foundation | 8 / serial | R07 closed | planned |

Both wave peers branch from the same verified integrated repaired baseline; integrate R02 then R03. No other wave is admitted. Create exactly one supervisor task per row; completed Task 1 is verified, not rebuilt. Worker decomposition belongs to each supervisor.

## Supervisor lifecycle

Rows progress planned → reserved → active → returned → verified → integrated → closed. The JSON address book owns exact launch provenance, base/path/ref, allowance, artifact, command and cleanup fields. No task is closed until every physical, Git and sidebar resource is verified gone.

## Initial evidence

- Working tree clean at 59c8bfb1d165ca83c7b7b470fab2ca60bd16fe1b.
- Canonical Task 1 complete at merge ebc41c45, recorded in the roadmap.
- Current HEAD includes merged hash-only parity repair 59c8bfb1; R01 must verify it in assertion mode before wave admission.
- The inherited parity worktree is now fully closed; exact evidence is in inherited-lifecycle.json. R01 is the sole open auxiliary worktree.

Resume: admission repair is complete and existing R01 is executing its bounded M9/M21 proof amendment. The consumed temporary handoff was removed; board.md and supervisors.json own current status. Preserve one supervisor per immediate task; never create a duplicate.

Wave gate scheduling: R02 and R03 request GATE READY before full gates; coordinator grants one machine gate token at a time. Each owns two auxiliary-worktree slots. Shared derived manifest output is regenerated at ordered integration; neither peer edits the other's source or artifacts.
