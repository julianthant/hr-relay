# Phase 6F · Packaged-app proof

Read the [phase overview](../README.md) for shared context, decisions and phase-wide exit criteria.

## Proof — a dry run from the packaged app on both operating systems
<!-- roadmap: desk-proof -->

<!-- roadmap-status: desk-proof -->
- [ ] a full workflow **dry run** driven from the INSTALLED app on macOS — R10's T1 tier, run against the package rather than the checkout
- [ ] the same on Windows, on real hardware
- [ ] R10's T3 tier attached — a dashboard condition driven through the app's own window while the run is parked
- [ ] the parity corpus rendered in the Electron renderer, so the operator's actual pixels are the ones the corpus pins
- [ ] the result recorded durably the way every other dry-run scenario is: an evidence row plus a dated line here
- [ ] the recovery drill (`cli storage restore`) exercised through the app's own lock files — D181's proof composes from them, and the app is what writes them now
> 2026-08-21 | docs-cohesion R14 | nothing built; `{#test-tiers}` owns T1–T4 and no workflow has a T1 pair at HEAD
<!-- /roadmap-status -->

**The proof is a dry run, not a demo, and the distinction is R10's.** A T1 scenario is a live
`dryRun=true` run of a real workflow with its checkpoints asserted over authority — nodes reached,
checkpoints written, gate results, intents, receipt shape — against a named canary subject. Running
one from the packaged app proves the thing installers usually break: that the app's roots, its
Chromium, its extension, its keychain and its worker supervision all line up on a machine that never
saw the repository. A screenshot of the dashboard proves none of that.

**Both operating systems, on real hardware.** A Windows VM is acceptable for iteration and is not
acceptable as the proof: the two items most likely to break there — the extension path and the
Chromium launch — are exactly the ones a VM's file system and GPU stack make unrepresentative.

**Parity in the renderer is worth its own line, because of what D187 found.** The parity corpus was
photographed against a browser the harness controlled, and for the whole life of the corpus it
photographed the wrong theme while every gate stayed green. The Electron renderer is a different
browser with a different default surface, and the operator's eye is the acceptance bar — so the corpus
runs there before the app is called done.
