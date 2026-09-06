# Run the built dashboard without the dev server
<!-- roadmap: def-byte-path -->

Read the [subphase overview](README.md) before this assignment for shared scope, dependencies, decisions and gates.

<!-- roadmap-status: def-byte-path -->
- [ ] BE the BFF static handler — port the parity fixture's traversal-checked, content-typed `serveStatic` (`tests/parity/helpers/fixture-bff.ts:298`); every unrouted path 404s today
- [ ] BE `--prod` parsed by `startRebuildRuntime` — the flag `package.json:12` passes is read by nothing (`src/core/runtime-composition.ts:162-200`), so `npm run dashboard:prod` is byte-identical to `npm run cli -- dashboard`
> 2026-08-31 | D294 | Capture Mode's page, ingress, tunnel, and host gate are retired. Only ordinary local static serving remains.
<!-- /roadmap-status -->

**What the deferral is.** The production BFF **serves no frontend bytes.** Every dashboard byte you
have ever seen came from the Vite dev server on 5174; the BFF on 3938 answers `/api/v1/**` and
`/events/v1` and 404s everything else. The dashboard therefore has no way to run without the dev server.

**The decision that deferred it: D189** (round 45, 2026-08-09), amended by D294, is a named local
operator-dashboard gap with an owner rather than a waiver. D193(a) fixes what "production" means
here: **LOCAL** — the day this repo
becomes the operator's daily tool on their own machine, never a hosting platform.

**Its trigger is standalone dashboard completion.** It no longer depends on a workflow migration.

**Not built.** Two things remain: **`npm run dashboard:prod` names a mode the runtime never parsed** — `package.json:12` passes
`--prod` and `startRebuildRuntime` dispatches on `args[0]` alone, so the flag reaches nothing — and
the BFF has no static handler for the built dashboard.
