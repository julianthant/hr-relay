# DCC1 preliminary Security review

Native sup_sol, immutable target `80da38158dea35f781eb69d5e682a779935f9c96..0c115123a738f62cbe01c9b45f53b7289284479c`. No gates/live state/edits. Count: 1 · Worst: medium.

- `src/infra/config/settings-file.ts:474` **medium** — pre-existing group/world-writable Settings directory is accepted by mkdir(mode 0700); another UID with directory write can unlink private lock/prepare/settings entries. File 0600 and final-component O_NOFOLLOW do not protect parent ancestry. Fix with verified directory ownership/mode/path identity and refusal before operations, with regression tests. Conditional on unsafe directory permissions; no deployed permission claim made.

Supervisor verified the cited original code: acquireSettingsAuthorityLock derives dirname and calls mkdirSync(directory, {recursive:true,mode:0700}) without existing-directory integrity validation. Finding accepted as open for a separate focused fix after merge reconciliation.

No command-body bypass established for Origin/Host guard, server-authored provenance, closed editable fields or canonical ordered bulk replay. No production-reachable reaper race established under SQLite serialization. Inspected Settings file/schema/ingress and supporting kernel/routes/SQLite/process-identity/reconciliation immutable sources. Final candidate needs re-review; this is not acceptance of the in-progress merge.
