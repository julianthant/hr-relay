# Phase 6D · Credentials and keychain

Read the [phase overview](../README.md) for shared context, decisions and phase-wide exit criteria.


## Task shape and verification

This part delivers the named desktop capability. Its focused plan must split implementation into
concrete feature subtasks, sequential by default; only approved independent peers carry a visible
Parallel group label. Use focused tests, lint and affected static/generated checks during the part.
Its final acceptance owns full typecheck, lint, coverage and all applicable platform/phase gates,
required repairs and review under the [2026-09-19 cadence](../../../reference/guards-and-tests.md#phase-exit-gates-from-3-2). Phase 6F additionally owns the complete packaged-app proof on both operating systems.
No full-suite run is required at each subtask or intermediate integration.

## Credentials — the OS keychain behind the one reader
<!-- roadmap: desk-secrets -->

> **D336 (2026-09-06):** the credential reader is independent of ordinary settings and SQLite
> transactions. Supply the platform credential backend through that same boundary; do not redesign
> ordinary settings or reintroduce database/credential synchronization. The historical child-env
> injection option below is superseded by the preserved value-free child-environment requirement.
> Selecting and implementing the OS backend remains this phase's work unless separately reassigned.


<!-- roadmap-status: desk-secrets -->
- [ ] macOS Keychain and Windows Credential Manager as the credential source, replacing `.env` for a packaged app
- [ ] `src/domain/secrets.ts` stays the ONLY module that reads a credential — `secrets-single-source.test.ts` unchanged
- [ ] the Duo credential (`paths.duoCredential`) moved off a plain file into the same store, or its file placed under app data with the app's own protection
- [ ] a first-run setup screen that collects what is missing and names each credential it needs
- [ ] a decision recorded on HOW the keychain reaches the reader — env-block injection vs a source seam inside `secrets.ts` (they differ in exposure, see below)
- [ ] no credential ever interpolated into a message, log or crash report the app produces (`no-secret-values-in-logs.test.ts` already holds the runtime half)
> 2026-08-21 | docs-cohesion R14 | nothing built; `src/domain/secrets.ts` reads an injected `NodeJS.ProcessEnv` defaulting to `process.env`, so the seam is a map rather than an async source
<!-- /roadmap-status -->

**The guard does not move.** `secrets-single-source.test.ts` pins `src/domain/secrets.ts` as the only
module permitted to read a credential from `process.env`, and nothing about a keychain justifies
widening that. Every shape below keeps the reader exactly where it is.

**The design question is HOW the keychain's answer reaches a synchronous reader, and the two options
differ in what they expose.** `secrets.ts` takes a `NodeJS.ProcessEnv` (defaulting to `process.env`)
and answers synchronously; a keychain read is asynchronous and prompts.

- **Populate the child's environment at spawn.** The main process reads the keychain once and hands
  the BFF and each worker an env block. Nothing in `secrets.ts` changes. The cost is that credentials
  sit in a process environment block for the life of the process, which is readable by anything
  running as the same user.
- **Give `secrets.ts` a source seam.** The main process resolves the keychain before composition and
  injects a resolved map (or a small synchronous accessor) into the one reader. More work, and it
  keeps the credential out of the environment block. This is the shape to prefer unless the first one
  turns out to be forced.

Whichever is taken, it is a decision with a D-number, because it changes where a real credential
lives on a real machine.

**The first-run screen is part of the phase, not a nicety.** A packaged app has no `.env.example` to
copy, so the app must name what it needs — the SSO username and password, the Duo credential, any
provider keys — and refuse to start a workflow that is missing one, with the name of the missing
credential in the refusal. A silently missing credential turns into a login failure three layers
down, which is the fail-loud rule applied to setup.
