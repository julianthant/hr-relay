# Phase 6E · Signed installers

Read the [phase overview](README.md) for shared context, decisions and phase-wide exit criteria.

## Packaging — signed installers for both operating systems
<!-- roadmap: desk-package -->

<!-- roadmap-status: desk-package -->
- [ ] electron-builder configured, with the dashboard bundle and `duo-autopilot/` as app resources
- [ ] macOS: a signed and notarized `.dmg` (an unsigned build cannot launch a bundled Chromium cleanly on a current macOS)
- [ ] Windows: an installer (nsis or msix), signed
- [ ] the release version = the app version stamp `RunRecord` already carries (D179), so an archived run names the build that produced it
- [ ] both installers upgrade an existing installation IN PLACE without an uninstall and preserve app data, authority rows, artifacts, profiles, settings and keychain credentials
- [x] the v1 update policy is manual download/install and the controlled updater is a named the deferred shelf deferral with a trigger and a no-active-work install invariant (D297)
- [ ] the build is reproducible from a clean checkout by one command, and the gate family still runs against the source tree unchanged
> 2026-08-21 | docs-cohesion R14 | nothing built; no builder config and no `electron` dependency at HEAD
> 2026-09-01 | D297 | Electron retained; v1 update policy and later controlled-updater boundary ratified; implementation remains unbuilt
<!-- /roadmap-status -->

**The version stamp is already durable, and packaging should reuse it rather than mint a second
identity.** D179 put `appVersion` on `RunRecord` at the one enqueue point precisely so an archived run
can say which build produced it; the installer's version is that string. Two version numbers for one
build is how a run record starts naming something nobody can find.

**Signing is not optional on either OS, for a reason specific to this product.** The app launches a
second browser and loads an unpacked extension into it. An unsigned or un-notarized macOS build makes
that path fight Gatekeeper at exactly the moment a live run needs it, and an unsigned Windows
installer makes the operator click through a warning every update. The cost is a developer identity on
each platform, and it belongs in this stage's estimate rather than in a surprise.

**V1 updates are signed, manual and in place (D297).** One update is installed per installed machine:
the operator downloads the newer signed installer and runs it over the existing app, without first
uninstalling. Program resources are replaceable; mutable state is not. Authority rows, artifacts,
browser profiles and settings remain below the stable `app.getPath("userData")` root, while credentials
remain in the OS keychain. An upgrade that cannot preserve and migrate those stores refuses and leaves
the prior installation recoverable; it never solves schema drift by clearing app data. The packaged-app
proof includes an older-to-newer upgrade on both operating systems, not only a clean install.

**A controlled updater is LATER, with its safety boundary now decided.** It may check for and download
a signed release while the app is open, but it may not install, restart, or force-quit while any run is
non-terminal or any owned worker or browser session is active. Installation begins only from one
explicit quiescent verdict: the app refuses by name if work is active; otherwise it orderly stops the
workers and BFF, closes authority/storage handles, releases their locks, and applies the already-
verified update on a clean restart. The deferral and the trigger that ends it live in doc 04 under
`{#def-desktop-update}`. Business data and HR traffic remain local; only signed release metadata and
binaries cross the optional update channel.
