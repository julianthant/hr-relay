# Task 11-3 · Finish Archive, versions, relaunch, and deletion
<!-- roadmap: dash-archive -->

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

- [ ] Derive every view from canonical runs and prove frozen evidence, versioning, export, relaunch
  lineage, terminal-only delete/tombstone, idempotence, storage delta, and convergence.

> 2026-09-04 | phase-0-3-authority-design C31da5310 R04 | consumes `ref dashboard-surfaces` §D330.8 — archive binds one immutable
> `archived_runs` record to a `terminal` row, and `delete-archived-run` cites that archive's exact
> `contentDigest` — and §D330.7, under which relaunch is a FRESH run planned from the archived raw
> submission through the CURRENT descriptor, carrying `archive_relaunches` lineage and never `retryOf`.
> §D332.7 item 7 fixes that archive visibility is unchanged across the upgrade: the same archived rows
> under the same `contentDigest`. No redesign.
