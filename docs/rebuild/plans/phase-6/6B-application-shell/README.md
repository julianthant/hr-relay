# Phase 6B · Application shell

Read the [phase overview](../README.md) for shared context, decisions and phase-wide exit criteria.

## Electron shell — the main process, the window, the single instance
<!-- roadmap: desk-shell -->

<!-- roadmap-status: desk-shell -->
- [ ] the Electron main process, the app lifecycle, and one BrowserWindow
- [ ] the BFF started and supervised by the main process (recommendation: as a managed CHILD process — see below)
- [ ] the renderer loads `dist/dashboard` from app resources, with an API base that is not `window.location.origin` under `file://`
- [ ] single instance — `app.requestSingleInstanceLock()` on top of D181's `server` role lock, with a second launch focusing the open window
- [ ] every runtime root resolved under `app.getPath("userData")` instead of `process.cwd()`, with the `runtime-isolation.json` names unchanged
- [ ] the app version stamped on a `RunRecord` (D179) read from a source that survives packaging
- [ ] an application menu, and keep-awake while any run is in flight — a suspended worker mid-run is a real failure, not an inconvenience
> 2026-08-21 | docs-cohesion R14 | nothing built; the four obstacles above were read out of `src/server/dashboard/compose.ts`, `src/domain/config/schema.ts` and `src/dashboard/app/main.tsx`
<!-- /roadmap-status -->

**The one design question this node settles: in-process or child process?** The recommendation is a
**managed child process**, and the reasons are all about locks and lifetimes rather than taste.

- **The role lock is per-PROCESS.** `acquireRuntimeProcessLock({ … name: "server", pid: process.pid })`
  atomically claims one singleton server record, and `cli storage restore` composes its stopped-system
  proof from that record plus the per-start worker aggregate (D181). A child process holds a lock whose pid is a real,
  observable BFF; an in-process BFF makes the Electron main process the `server` holder, so the app
  cannot be running while the BFF is stopped — which is exactly the state a restore needs.
- **A BFF crash must not take the window with it.** In-process, an unhandled rejection in the API
  layer kills the app; as a child, the main process observes the exit, tells the operator what died,
  and can restart it under the same lock discipline.
- **The composition root already assumes a process.** `src/cli.ts` registers composers and calls
  `startRebuildRuntime` at top level; the BFF is a command, not a library entry. A child process runs
  that entry unchanged, with an explicit cwd and env, and the app's Node and Electron's Node stay
  separate concerns.
- **The cost is honest and small:** one more process to supervise, and the app must forward its
  stderr somewhere the operator can read.

**What the window loads.** `dist/dashboard` ships in app resources and the renderer is the same bundle
`npm run web:build` already produces — the desktop does not fork the frontend. The API base is the one
thing that must change, and it must change EXPLICITLY (obstacle 2 above): a wrong base under `file://`
does not fail at build time, it fails as a dashboard that renders and then reports every request as a
network error.

**Keep-awake is a correctness item, not a nicety.** A worker holds a claim with a heartbeat, and a
claim that stops beating is swept and requeued; a machine that sleeps mid-run with a browser open on a
half-staged UCPath page is the state doc 09's recovery lane exists for. The app should hold a power
save blocker while any run is in flight, and if it cannot get one, say so rather than proceed quietly.
