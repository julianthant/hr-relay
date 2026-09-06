# Phase 6C · Worker lifecycle

Read the [phase overview](README.md) for shared context, decisions and phase-wide exit criteria.

## Worker lifecycle — the pool the app owns
<!-- roadmap: desk-worker -->

<!-- roadmap-status: desk-worker -->
- [ ] workers as managed child processes — start and stop from the dashboard, which IS `{#parallel-runs}`' pool
- [ ] Playwright's full bundled Chromium available to a packaged app — shipped with it, or installed on first run into app data
- [ ] Duo Autopilot placed under app data and `paths.duoExtensionDir` pointed at it (it is a hard runtime dependency, D244)
- [ ] browser profiles under app data, keeping doc 05's `(worker, system, instance, configFingerprint)` partition intact
- [ ] Windows: the extension path, the profile root and the Chromium launch verified on a real Windows box
- [ ] a worker that dies is reported to the operator with its exit reason, and its claim released through the D200 lease sweep rather than by guessing
> 2026-08-21 | docs-cohesion R14 | nothing built; `createDashboardWorkerSupervisor` (`src/server/dashboard/compose.ts:322-331`) still refuses spawn by name and tells the operator to run npm
<!-- /roadmap-status -->

**This node does not invent a worker pool — it consumes `{#parallel-runs}`'.** The kernel's worker
command arms exist and are validated; what refuses is the process effect behind them. Building a
second spawn path inside the Electron main process would mean two supervisors with two lifetimes over
one authority table, which is the shape D200 already warned about from the other side (a recovery
mechanism living inside the thing it recovers). The app's job is to be the process parent, not to be
a second scheduler.

**Chromium and the extension are the packaging risk in this node.** The browser session factory
launches Playwright's **full** bundled Chromium (`channel: "chromium"`, a persistent context, with the
Duo Autopilot MV3 extension loaded) — the lightweight headless shell cannot load an extension, so
there is no smaller option. Two shapes are available and the choice is `{#desk-package}`'s to make
with this node's input: ship the browser inside the installer (large, deterministic, offline) or
install it on first run into app data (small installer, a network dependency, a first-run screen). The
extension itself is vendored in `duo-autopilot/` and must land at a real path on disk, because
`paths.duoExtensionDir` is an absolute path leaf and D244 makes it a hard runtime dependency of every
authenticated login.

**Profiles keep their partition.** Doc 05 partitions a profile per `(worker, system, instance,
configFingerprint)` and D216 makes the roots repo-relative so two checkouts never collide. Under app
data the same partition holds, with the root moving — and it matters more here than it did in a
checkout, because a shared profile is how D243's counter hazard gets a second front door.
