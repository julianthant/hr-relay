# Rebuild phase plans

This folder mirrors the existing roadmap: one folder per Phase 0–6, one Markdown file per
subphase, and one overview per phase. The [roadmap](../../roadmap/roadmap.md) owns sequencing;
these files own execution plans, tasks, evidence and exit criteria. Requirements remain in
[`reference/`](../reference/); workflow migration records remain in [`migrations/`](../migrations/).

## Find or write a plan

For `/phase-plan`, follow the assigned roadmap node's `doc:` binding to its subphase file.
Persist the complete approved assignment in that file's existing task section. Do not create a
second per-task plan or put new plans at the rebuild root. Create a new subphase file only when
the owning roadmap admits that subphase; preserve Phase 4's verification and approval boundary.

Filenames use a roadmap phase label, including its decimal or lettered part and
a descriptive slug: `phase-1/1.6-implement-canonical-run-and-settings-authorities.md`,
`phase-3/3.1-finish-the-dashboard.md`, `phase-5/5A-close-cutover-readiness-gaps.md`.
`README.md` holds phase-wide summaries, decisions and exit criteria. Subphase task labels,
roadmap node IDs, append-only journals and recorded statuses survive a move unchanged.

| Phase | Subphases |
| --- | --- |
| [Phase 0](phase-0/README.md) | 0.1–0.3 |
| [Phase 1](phase-1/README.md) | 1.1–1.6 |
| [Phase 2](phase-2/README.md) | 2.1–2.6 |
| [Phase 3](phase-3/README.md) | 3.1–3.4 |
| [Phase 4](phase-4/README.md) | 4A (admission placeholder) |
| [Phase 5](phase-5/README.md) | 5A–5B |
| [Phase 6](phase-6/README.md) | 6A–6F |

## Earlier paths

The flat phase files were split on 2026-09-06. Frozen history, source comments, pinned commit/path
citations and append-only evidence retain their original text. Resolve those earlier paths through
this table, then find the named section within that phase's subphase files. When inspecting a pinned
commit, use the path as it existed at that commit.

| Former file under `docs/rebuild/` | Current home |
| --- | --- |
| `00-design-the-foundation.md` | [phase-0](phase-0) |
| `01-build-the-spine.md` | [phase-1](phase-1) |
| `02-prove-writes-build-the-tails.md` | [phase-2](phase-2) |
| `03.2-finish-workflow-authoring.md` | [phase-3/3.2-finish-workflow-authoring.md](phase-3/3.2-finish-workflow-authoring.md) |
| `03.1-finish-the-dashboard.md` | [phase-3/3.1-finish-the-dashboard.md](phase-3/3.1-finish-the-dashboard.md) |
| `03.4-co-operate-with-claude.md` | [phase-3/3.4-co-operate-with-claude.md](phase-3/3.4-co-operate-with-claude.md) |
| `03.3-accept-person-lookup-and-separations.md` | [phase-3/3.3-accept-person-lookup-and-separations.md](phase-3/3.3-accept-person-lookup-and-separations.md) |
| `04-close-the-deferrals.md` | [phase-5/5A-close-cutover-readiness-gaps.md](phase-5/5A-close-cutover-readiness-gaps.md) |
| `05-cut-over.md` | [phase-5/5B-switch-production-authority.md](phase-5/5B-switch-production-authority.md) |
| `06-ship-the-desktop-app.md` | [phase-6](phase-6) |

`04-close-the-deferrals.md` now belongs to 5A; its controlled-desktop-updates section belongs to [6A](phase-6/6A-controlled-desktop-updates.md).
