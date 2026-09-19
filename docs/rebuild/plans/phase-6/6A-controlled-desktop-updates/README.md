# Phase 6A · Controlled desktop updates

Read the [phase overview](../README.md) for shared context, decisions and phase-wide exit criteria.


## Task shape and verification

This part delivers the named desktop capability. Its focused plan must split implementation into
concrete feature subtasks, sequential by default; only approved independent peers carry a visible
Parallel group label. Use focused tests, lint and affected static/generated checks during the part.
Its final acceptance owns full typecheck, lint, coverage and all applicable platform/phase gates,
required repairs and review under the [2026-09-19 cadence](../../../reference/guards-and-tests.md#phase-exit-gates-from-3-2). This optional updater remains unselected and does not block the initial desktop release.
No full-suite run is required at each subtask or intermediate integration.

## Controlled desktop updates
<!-- roadmap: def-desktop-update -->

<!-- roadmap-status: def-desktop-update -->
- [x] D297 fixes v1 delivery as a signed manual installer run IN PLACE over the existing installation; uninstall-first is not an update path
- [x] D297 fixes the later updater's invariant — discovery/download may occur while open; install/restart/force-quit may not occur while a run, worker or browser session is active
- [ ] PROOF the signed manual older→newer upgrade on macOS and Windows preserves authority rows, artifacts, profiles, settings and OS-keychain credentials
- [ ] BE one fail-loud desktop quiescence verdict and ordered shutdown that stops workers and browsers, stops the BFF, closes storage handles and releases locks before handing off to an installer
- [ ] BE only after that trigger: a controlled update channel that verifies the signed release, refuses active work by name and applies on a clean restart
> 2026-09-01 | D297 | trigger and safety boundary ratified; v1 manual upgrade and later controlled updater remain unbuilt
<!-- /roadmap-status -->

**What the deferral is.** The v1 application does not check for, download or install releases itself.
An operator updates one installed machine by running the newer signed installer over the existing
installation. That is an ordinary supported upgrade path, not an uninstall/reinstall ceremony, and
it does not relocate mutable app data into replaceable program resources.

**The decision that deferred it: D297.** This local app files real HR transactions. Updating between
a write fence and its read-back can turn a known in-flight operation into an UNKNOWN submit, so
convenience cannot own the shutdown decision. D297 keeps Electron because it already has to own the
BFF, workers, browser automation and keychain boundary, then draws the updater behind that same
process-lifecycle authority.

**Its trigger: the manual upgrade and the quiescence seam are both proved.** First, an installed
older version upgrades in place on real macOS and Windows machines while preserving the stable app-
data roots and keychain identity. Second, the desktop exposes one verdict that either names active
work and refuses or proves there is no non-terminal run and no active worker/browser child, then
performs an ordered shutdown of children, storage handles and locks. Only then is an update channel
eligible to be scheduled.

**What the later updater may do.** It may discover and download a signed release while the app is
open. It may not install, restart or force-quit until the quiescence verdict passes and the ordered
shutdown completes. The release channel carries only signed update metadata and binaries; HR data,
authority rows and credentials remain local. An air-gapped machine stays on the same signed manual
installer path.

**Not built.** Both the manual upgrade proof and the controlled updater. The former is a desktop-stage
packaging acceptance criterion; the latter remains here after that stage because the desktop stage can ship
without an update service.
